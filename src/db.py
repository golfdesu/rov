"""SQLite-backed multi-user authentication and isolated per-user persistence."""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import threading
import time
from collections import Counter, OrderedDict, deque
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

from src.schemas import RecordedDraftGameSchema

if TYPE_CHECKING:
    from src.schemas import DraftHistoryNameTarget

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_.-]{3,32}$")
SESSION_COOKIE_NAME = "rov_session"
SESSION_TTL_SECONDS = 30 * 24 * 60 * 60  # 30 days (> 15-day open window)
MAX_USERS_DEFAULT = 2000
DISPLAY_NAME_FREE_CHANGES = 3
DISPLAY_NAME_COOLDOWN_SECONDS = 14 * 24 * 60 * 60
GROUP_CAPACITY = {"duo": 2, "team_pro": 5}
TEAM_HISTORY_LIMIT = 500
FREE_HISTORY_LIMIT = 14
PAID_HISTORY_LIMIT = 500
FREE_HERO_POOL_LIMIT = 2
PAID_HERO_POOL_LIMIT = 50
TEAM_HERO_POOL_LIMIT = 50
HERO_POOL_LANES = ("DS_Lane", "Jungle", "Mid", "Dragon_Lane", "Roam")
BILLING_TABLES = {
    "billing_passes": """
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        tier TEXT NOT NULL CHECK(tier IN ('pro', 'duo', 'team_pro')),
        expires_at INTEGER NOT NULL
    """,
    "billing_orders": """
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        tier TEXT NOT NULL CHECK(tier IN ('pro', 'duo', 'team_pro')),
        days INTEGER NOT NULL CHECK(days IN (30, 90)),
        amount INTEGER NOT NULL CHECK(amount > 0),
        return_origin TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'closed')),
        stripe_session_id TEXT UNIQUE,
        stripe_payment_id TEXT UNIQUE,
        paid_at INTEGER
    """,
}


def billing_purchase_block(active_tier: str | None, requested_tier: str) -> str | None:
    if active_tier == requested_tier:
        return "pass_active"
    if active_tier == "pro":
        return None
    if active_tier == "team_pro":
        return "team_active"
    if active_tier is not None and (active_tier == "duo" or requested_tier == "duo"):
        return "duo_transition"
    return None


def normalize_username(username: str) -> str:
    """Validate and normalize a username to lowercase ASCII."""
    cleaned = username.strip()
    if not USERNAME_RE.fullmatch(cleaned):
        raise ValueError("Username must be 3-32 characters using only letters, numbers, '_', '-', or '.'")
    return cleaned.lower()


def hash_password(password: str) -> str:
    """Hash a password using scrypt with a random 16-byte salt."""
    if len(password) < 6 or len(password) > 128:
        raise ValueError("Password must be between 6 and 128 characters")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt$16384$8$1${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify a plaintext password against a stored scrypt digest in constant time."""
    try:
        algo, n_s, r_s, p_s, salt_hex, digest_hex = stored_hash.split("$", 5)
        if algo != "scrypt":
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=int(n_s),
            r=int(r_s),
            p=int(p_s),
            dklen=len(expected),
        )
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def hash_session_token(token: str) -> str:
    """Hash an opaque session token with SHA-256 before storing or querying."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class AuthUser:
    id: int
    username: str
    display_name: str
    created_at: int
    email: str | None = None
    auth_provider: str = "password"
    display_name_is_custom: bool = False
    display_name_change_count: int = 0
    display_name_changed_at: int = 0

    @property
    def display_label(self) -> str:
        name = self.display_name.strip()
        if self.display_name_is_custom and name:
            return name
        if self.auth_provider == "google" and name:
            first_name = name.split(maxsplit=1)[0]
            if "@" not in first_name:
                return first_name
        return f"@{self.username}"

    @property
    def display_name_changes_remaining(self) -> int:
        return max(0, DISPLAY_NAME_FREE_CHANGES - self.display_name_change_count)

    @property
    def display_name_next_change_at(self) -> int | None:
        if self.display_name_changes_remaining:
            return None
        return self.display_name_changed_at + DISPLAY_NAME_COOLDOWN_SECONDS


class DisplayNameCooldownError(ValueError):
    def __init__(self, available_at: int, retry_after: int):
        super().__init__("Display name is on cooldown")
        self.available_at = available_at
        self.retry_after = retry_after


class RateLimiter:
    """Thread-safe sliding-window rate limiter with lockout-preserving LRU eviction."""

    def __init__(self, max_attempts: int = 20, window_seconds: int = 60, max_keys: int = 8192):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self.max_keys = max_keys
        self._lock = threading.Lock()
        self._hits: OrderedDict[str, deque[float]] = OrderedDict()

    def _evict_if_full(self, cutoff: float) -> None:
        if len(self._hits) < self.max_keys:
            return
        # Purge expired timestamps/keys first so active lockouts are not displaced by spray traffic.
        expired = []
        unlocked = []
        for k, dq in self._hits.items():
            while dq and dq[0] < cutoff:
                dq.popleft()
            if not dq:
                expired.append(k)
            elif len(dq) < self.max_attempts:
                unlocked.append(k)
        for k in expired:
            del self._hits[k]
        while len(self._hits) >= self.max_keys and unlocked:
            del self._hits[unlocked.pop(0)]
        while len(self._hits) >= self.max_keys:
            self._hits.popitem(last=False)

    def check_allowed(self, key: str) -> bool:
        """Return whether ``key`` is currently below max_attempts without recording a hit."""
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            q = self._hits.get(key)
            if q is None:
                return True
            while q and q[0] < cutoff:
                q.popleft()
            if not q:
                del self._hits[key]
                return True
            return len(q) < self.max_attempts

    def check_and_record(self, key: str) -> bool:
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            q = self._hits.get(key)
            if q is None:
                self._evict_if_full(cutoff)
                q = deque()
                self._hits[key] = q
            else:
                self._hits.move_to_end(key, last=True)
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= self.max_attempts:
                return False
            q.append(now)
            return True


_DUMMY_PASSWORD_HASH = hash_password("dummy-timing-shield-password")


def _reject_nonfinite_json(val: str) -> None:
    raise ValueError(f"Non-standard JSON constant {val!r} is not allowed")


def _safe_json_loads(raw: str) -> dict | None:
    try:
        parsed = json.loads(raw, parse_constant=_reject_nonfinite_json)
        return parsed if isinstance(parsed, dict) else None
    except ValueError:
        return None


def _entry_recorded_ms(entry: dict) -> int | None:
    raw = entry.get("recordedAt")
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        dt = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


class UserDatabase:
    """Thread-safe SQLite storage isolating draft and combat data per user."""

    def __init__(self, db_path: Path, max_users: int = MAX_USERS_DEFAULT):
        self.db_path = db_path
        self.max_users = max_users
        self._lock = threading.Lock()
        self._initialized_path: Path | None = None

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path, timeout=5.0, check_same_thread=False)
        try:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA busy_timeout=5000")
            with conn:
                yield conn
        finally:
            conn.close()

    def ensure_schema(self) -> None:
        if self._initialized_path == self.db_path and self.db_path.exists():
            return
        with self._lock:
            if self._initialized_path == self.db_path and self.db_path.exists():
                return
            with self._connect() as conn:
                conn.execute("PRAGMA journal_mode=WAL")
                conn.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        username TEXT NOT NULL UNIQUE,
                        display_name TEXT NOT NULL,
                        password_hash TEXT NOT NULL,
                        created_at INTEGER NOT NULL,
                        google_sub TEXT,
                        email TEXT,
                        display_name_is_custom INTEGER NOT NULL DEFAULT 0,
                        display_name_change_count INTEGER NOT NULL DEFAULT 0,
                        display_name_changed_at INTEGER NOT NULL DEFAULT 0
                    );

                    CREATE TABLE IF NOT EXISTS auth_sessions (
                        token_hash TEXT PRIMARY KEY,
                        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        created_at INTEGER NOT NULL,
                        expires_at INTEGER NOT NULL
                    );

                    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires
                        ON auth_sessions(expires_at);

                    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_created
                        ON auth_sessions(user_id, created_at);

                    CREATE TABLE IF NOT EXISTS user_draft_states (
                        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                        payload_json TEXT NOT NULL,
                        updated_at INTEGER NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS user_combat_builds (
                        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                        payload_json TEXT NOT NULL,
                        updated_at INTEGER NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS user_practice_histories (
                        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                        payload_json TEXT NOT NULL,
                        updated_at INTEGER NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS user_oauth_accounts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        provider TEXT NOT NULL,
                        provider_user_id TEXT NOT NULL,
                        email TEXT,
                        created_at INTEGER NOT NULL,
                        UNIQUE(provider, provider_user_id)
                    );

                    CREATE INDEX IF NOT EXISTS idx_user_oauth_user
                        ON user_oauth_accounts(user_id, created_at DESC);

                    CREATE TABLE IF NOT EXISTS pricing_survey_responses (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                        client_id TEXT,
                        choice TEXT NOT NULL CHECK(choice IN ('willing', 'not_willing')),
                        is_guest INTEGER NOT NULL DEFAULT 0,
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL
                    );

                    CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_survey_user
                        ON pricing_survey_responses(user_id) WHERE user_id IS NOT NULL;

                    CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_survey_client
                        ON pricing_survey_responses(client_id) WHERE client_id IS NOT NULL;

                    CREATE TABLE IF NOT EXISTS user_feedback (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                        client_id TEXT,
                        message TEXT NOT NULL,
                        is_guest INTEGER NOT NULL DEFAULT 0,
                        page_context TEXT,
                        created_at INTEGER NOT NULL
                    );

                    CREATE INDEX IF NOT EXISTS idx_user_feedback_created
                        ON user_feedback(created_at DESC, id DESC);

                    CREATE INDEX IF NOT EXISTS idx_user_feedback_user
                        ON user_feedback(user_id, created_at DESC) WHERE user_id IS NOT NULL;

                    CREATE TABLE IF NOT EXISTS daily_visits (
                        client_id TEXT NOT NULL,
                        visit_date TEXT NOT NULL,
                        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                        first_seen_date TEXT NOT NULL,
                        created_at INTEGER NOT NULL,
                        PRIMARY KEY (client_id, visit_date)
                    );

                    CREATE INDEX IF NOT EXISTS idx_daily_visits_date
                        ON daily_visits(visit_date);

                    CREATE INDEX IF NOT EXISTS idx_daily_visits_first_seen
                        ON daily_visits(first_seen_date);

                    CREATE TABLE IF NOT EXISTS user_usage_daily (
                        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        usage_date TEXT NOT NULL,
                        predict_count INTEGER NOT NULL DEFAULT 0,
                        draft_save_count INTEGER NOT NULL DEFAULT 0,
                        last_seen_at INTEGER NOT NULL DEFAULT 0,
                        PRIMARY KEY (user_id, usage_date)
                    );

                    CREATE INDEX IF NOT EXISTS idx_user_usage_daily_date
                        ON user_usage_daily(usage_date);

                    CREATE TABLE IF NOT EXISTS site_events_daily (
                        event_date TEXT NOT NULL,
                        metric_key TEXT NOT NULL,
                        count INTEGER NOT NULL DEFAULT 0,
                        PRIMARY KEY (event_date, metric_key)
                    );

                    CREATE INDEX IF NOT EXISTS idx_site_events_daily_key
                        ON site_events_daily(metric_key, event_date);

                    CREATE TABLE IF NOT EXISTS team_memberships (
                        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        tier TEXT NOT NULL CHECK(tier IN ('duo', 'team_pro')),
                        CHECK(user_id <> owner_id)
                    );
                    CREATE INDEX IF NOT EXISTS idx_team_members_owner ON team_memberships(owner_id, tier);
                    CREATE TABLE IF NOT EXISTS team_invites (
                        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        tier TEXT NOT NULL CHECK(tier IN ('duo', 'team_pro')),
                        expires_at INTEGER NOT NULL,
                        PRIMARY KEY(owner_id, user_id),
                        CHECK(user_id <> owner_id)
                    );
                    CREATE INDEX IF NOT EXISTS idx_team_invites_user ON team_invites(user_id);
                    CREATE TABLE IF NOT EXISTS team_history (
                        id INTEGER PRIMARY KEY,
                        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        tier TEXT NOT NULL CHECK(tier IN ('duo', 'team_pro')),
                        author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                        source_id TEXT NOT NULL,
                        game_json TEXT NOT NULL,
                        UNIQUE(owner_id, tier, author_id, source_id)
                    );
                    CREATE INDEX IF NOT EXISTS idx_team_history_owner ON team_history(owner_id, tier, id DESC);
                    CREATE TABLE IF NOT EXISTS hero_pools (
                        id INTEGER PRIMARY KEY,
                        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        scope TEXT NOT NULL CHECK(scope IN ('personal', 'team')),
                        tier TEXT NOT NULL DEFAULT '' CHECK(tier IN ('', 'duo', 'team_pro')),
                        team_name TEXT NOT NULL,
                        normalized_name TEXT NOT NULL,
                        lanes_json TEXT NOT NULL,
                        updated_at INTEGER NOT NULL,
                        UNIQUE(owner_id, scope, tier, normalized_name)
                    );
                    CREATE INDEX IF NOT EXISTS idx_hero_pools_owner ON hero_pools(owner_id, scope, tier, updated_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_hero_pools_owner_sort ON hero_pools(owner_id, scope, tier, updated_at DESC, id DESC);
                    """
                )
                conn.execute("BEGIN IMMEDIATE")
                self._ensure_billing_schema(conn)
                cols = {str(r["name"]) for r in conn.execute("PRAGMA table_info(users)").fetchall()}
                if "google_sub" not in cols:
                    conn.execute("ALTER TABLE users ADD COLUMN google_sub TEXT")
                if "email" not in cols:
                    conn.execute("ALTER TABLE users ADD COLUMN email TEXT")
                for column in ("display_name_is_custom", "display_name_change_count", "display_name_changed_at"):
                    if column not in cols:
                        conn.execute(f"ALTER TABLE users ADD COLUMN {column} INTEGER NOT NULL DEFAULT 0")
                conn.execute(
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL"
                )
                idx_row = conn.execute(
                    "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_auth_sessions_user_created'"
                ).fetchone()
                if idx_row and idx_row["sql"] and "DESC" in str(idx_row["sql"]).upper():
                    conn.execute("DROP INDEX idx_auth_sessions_user_created")
                    conn.execute(
                        "CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_created "
                        "ON auth_sessions(user_id, created_at)"
                    )
                visit_cols = {str(r["name"]) for r in conn.execute("PRAGMA table_info(daily_visits)").fetchall()}
                if "predict_count" not in visit_cols:
                    conn.execute("ALTER TABLE daily_visits ADD COLUMN predict_count INTEGER NOT NULL DEFAULT 0")
                if "device_type" not in visit_cols:
                    conn.execute("ALTER TABLE daily_visits ADD COLUMN device_type TEXT")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL")
                conn.execute(
                    """
                    INSERT OR IGNORE INTO user_oauth_accounts (user_id, provider, provider_user_id, email, created_at)
                    SELECT id, 'google', google_sub, email, created_at
                    FROM users
                    WHERE google_sub IS NOT NULL
                    """
                )
            self._initialized_path = self.db_path

    @staticmethod
    def _ensure_billing_schema(conn: sqlite3.Connection) -> None:
        for table, definition in BILLING_TABLES.items():
            source = conn.execute("SELECT sql FROM sqlite_master WHERE name = ?", (table,)).fetchone()
            if source is None:
                conn.execute(f"CREATE TABLE {table} ({definition})")
            elif "'duo'" not in source["sql"]:
                conn.execute(f"ALTER TABLE {table} RENAME TO {table}_previous")
                conn.execute(f"CREATE TABLE {table} ({definition})")
                conn.execute(f"INSERT INTO {table} SELECT * FROM {table}_previous")
                conn.execute(f"DROP TABLE {table}_previous")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_billing_orders_user_created ON billing_orders(user_id, created_at DESC, id DESC)"
        )
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_orders_pending ON billing_orders(user_id) WHERE status = 'pending'"
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS promo_claims (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                promo_key TEXT NOT NULL,
                claimed_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, promo_key)
            )
            """
        )

    def _prune_stale_if_full(self, conn: sqlite3.Connection, now: int) -> None:
        count_row = conn.execute("SELECT COUNT(*) AS cnt FROM users").fetchone()
        if count_row and int(count_row["cnt"]) >= self.max_users:
            # Prune stale unused accounts (>30d old, no active session, no saved states) before denying signup.
            stale_cutoff = now - SESSION_TTL_SECONDS
            conn.execute(
                """
                DELETE FROM users
                WHERE id IN (
                    SELECT u.id FROM users u
                    WHERE u.created_at < ?
                      AND NOT EXISTS (
                          SELECT 1 FROM auth_sessions s WHERE s.user_id = u.id AND s.expires_at > ?
                      )
                      AND NOT EXISTS (SELECT 1 FROM user_draft_states d WHERE d.user_id = u.id)
                      AND NOT EXISTS (SELECT 1 FROM user_combat_builds c WHERE c.user_id = u.id)
                      AND NOT EXISTS (SELECT 1 FROM user_practice_histories p WHERE p.user_id = u.id)
                      AND NOT EXISTS (SELECT 1 FROM billing_orders o WHERE o.user_id = u.id)
                      AND NOT EXISTS (SELECT 1 FROM team_memberships m WHERE m.user_id = u.id AND EXISTS (
                          SELECT 1 FROM billing_passes b
                          WHERE b.user_id = m.owner_id AND b.tier = m.tier AND b.expires_at > ?
                      ))
                    ORDER BY u.created_at ASC
                    LIMIT 100
                )
                """,
                (stale_cutoff, now, now),
            )
            count_row = conn.execute("SELECT COUNT(*) AS cnt FROM users").fetchone()
        if count_row and int(count_row["cnt"]) >= self.max_users:
            raise RuntimeError("User registration limit reached on this server")

    def can_claim_free_pro_promo(self, user_id: int, expires_at: int | None) -> bool:
        now = int(time.time())
        if expires_at is None or now >= expires_at:
            return False
        promo_key = f"free_pro_{expires_at}"
        self.ensure_schema()
        with self._connect() as conn:
            if self._is_paid_user(conn, user_id, now):
                return False
            claimed = conn.execute(
                "SELECT 1 FROM promo_claims WHERE user_id = ? AND promo_key = ?", (user_id, promo_key)
            ).fetchone()
            return claimed is None

    def claim_free_pro_promo(self, user_id: int, expires_at: int | None) -> dict:
        now = int(time.time())
        if expires_at is None or now >= expires_at:
            raise ValueError("promo_ended")
        promo_key = f"free_pro_{expires_at}"
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            claimed = conn.execute(
                "SELECT 1 FROM promo_claims WHERE user_id = ? AND promo_key = ?", (user_id, promo_key)
            ).fetchone()
            if claimed is not None:
                raise ValueError("promo_already_claimed")
            if self._is_paid_user(conn, user_id, now):
                raise ValueError("pass_active")
            conn.execute(
                "INSERT INTO promo_claims(user_id, promo_key, claimed_at) VALUES (?, ?, ?)",
                (user_id, promo_key, now),
            )
            conn.execute(
                """
                INSERT INTO billing_passes(user_id, tier, expires_at)
                VALUES (?, 'pro', ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    tier = 'pro',
                    expires_at = excluded.expires_at
                """,
                (user_id, expires_at),
            )
            return {"tier": "pro", "expires_at": expires_at, "is_owner": True}

    def billing_summary(self, user_id: int) -> tuple[sqlite3.Row | None, list[sqlite3.Row]]:
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute("BEGIN")
            now = int(time.time())
            active_pass = self._active_team(conn, user_id, now)
            if active_pass is None:
                active_pass = conn.execute(
                    "SELECT tier, expires_at FROM billing_passes WHERE user_id = ? AND expires_at > ?",
                    (user_id, now),
                ).fetchone()
            orders = conn.execute(
                """
                SELECT id, tier, days, amount, status, paid_at
                FROM billing_orders WHERE user_id = ?
                ORDER BY created_at DESC, id DESC LIMIT 10
                """,
                (user_id,),
            ).fetchall()
        return active_pass, orders

    def reserve_billing_order(self, user_id: int, tier: str, days: int, amount: int, origin: str) -> sqlite3.Row:
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            now = int(time.time())
            team = self._active_team(conn, user_id, now)
            if team is not None and not team["is_owner"]:
                raise ValueError("group_member")
            active_pass = conn.execute(
                "SELECT tier FROM billing_passes WHERE user_id = ? AND expires_at > ?", (user_id, now)
            ).fetchone()
            block = billing_purchase_block(active_pass["tier"] if active_pass else None, tier)
            if block:
                raise ValueError(block)
            pending = conn.execute(
                "SELECT * FROM billing_orders WHERE user_id = ? AND status = 'pending'", (user_id,)
            ).fetchone()
            if pending:
                if (pending["tier"], pending["days"]) != (tier, days):
                    raise ValueError("pending_order")
                return pending
            order_id = secrets.token_hex(16)
            return conn.execute(
                """
                INSERT INTO billing_orders (id, user_id, tier, days, amount, return_origin, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *
                """,
                (order_id, user_id, tier, days, amount, origin, now),
            ).fetchone()

    def get_billing_order(self, user_id: int, order_id: str) -> sqlite3.Row | None:
        self.ensure_schema()
        with self._connect() as conn:
            return conn.execute(
                "SELECT * FROM billing_orders WHERE id = ? AND user_id = ?", (order_id, user_id)
            ).fetchone()

    def attach_billing_session(self, order_id: str, session_id: str) -> None:
        with self._connect() as conn:
            if not conn.execute(
                """
                UPDATE billing_orders SET stripe_session_id = ?
                WHERE id = ? AND (stripe_session_id IS NULL OR stripe_session_id = ?)
                """,
                (session_id, order_id, session_id),
            ).rowcount:
                raise ValueError("checkout_session_mismatch")

    def close_uncreated_billing_order(self, order_id: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE billing_orders SET status = 'closed' WHERE id = ? AND status = 'pending' AND stripe_session_id IS NULL",
                (order_id,),
            )

    def settle_billing_order(self, order_id: str, session_id: str, amount: int, payment_id: str | None) -> None:
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            order = conn.execute("SELECT * FROM billing_orders WHERE id = ?", (order_id,)).fetchone()
            if order is None:
                return  # The signing endpoint can also receive events from other sandbox apps.
            if order["amount"] != amount or order["stripe_session_id"] not in (None, session_id):
                raise ValueError("checkout_order_mismatch")
            if order["status"] != "pending":
                return
            if payment_id is None:
                conn.execute(
                    "UPDATE billing_orders SET status = 'closed', stripe_session_id = ? WHERE id = ?",
                    (session_id, order_id),
                )
                return

            now = int(time.time())
            conn.execute(
                """
                UPDATE billing_orders
                SET status = 'paid', stripe_session_id = ?, stripe_payment_id = ?, paid_at = ? WHERE id = ?
                """,
                (session_id, payment_id, now, order_id),
            )
            current = conn.execute(
                "SELECT tier, expires_at FROM billing_passes WHERE user_id = ?", (order["user_id"],)
            ).fetchone()
            tier = order["tier"]
            day = 24 * 60 * 60
            expires_at = now + order["days"] * day
            if current and current["expires_at"] > now:
                if current["tier"] == tier:
                    expires_at = current["expires_at"] + order["days"] * day
                elif current["tier"] == "pro" and tier == "duo":
                    remaining_days = (current["expires_at"] - now) // day
                    expires_at += remaining_days // 2 * day
                elif tier == "team_pro":
                    remaining_days = (current["expires_at"] - now) // day
                    expires_at += remaining_days // 3 * day
                else:
                    raise ValueError("team_active")
            conn.execute(
                """
                INSERT INTO billing_passes (user_id, tier, expires_at) VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET tier = excluded.tier, expires_at = excluded.expires_at
                """,
                (order["user_id"], tier, expires_at),
            )

    @staticmethod
    def _active_team(conn: sqlite3.Connection, user_id: int, now: int) -> sqlite3.Row | None:
        return conn.execute(
            """
            SELECT b.user_id AS owner_id, u.username AS owner_username, b.tier, b.expires_at, 1 AS is_owner
            FROM billing_passes b JOIN users u ON u.id = b.user_id
            WHERE b.user_id = ? AND b.tier IN ('duo', 'team_pro') AND b.expires_at > ?
            UNION ALL
            SELECT b.user_id, u.username, b.tier, b.expires_at, 0
            FROM team_memberships m JOIN billing_passes b ON b.user_id = m.owner_id AND b.tier = m.tier
            JOIN users u ON u.id = b.user_id WHERE m.user_id = ? AND b.expires_at > ?
            LIMIT 1
            """,
            (user_id, now, user_id, now),
        ).fetchone()

    @classmethod
    def _active_team_pro(cls, conn: sqlite3.Connection, user_id: int, now: int) -> sqlite3.Row | None:
        team = cls._active_team(conn, user_id, now)
        return team if team is not None and str(team["tier"]) == "team_pro" else None

    @classmethod
    def _is_paid_user(cls, conn: sqlite3.Connection, user_id: int, now: int) -> bool:
        own_pass = conn.execute(
            "SELECT 1 FROM billing_passes WHERE user_id = ? AND expires_at > ?", (user_id, now)
        ).fetchone()
        return bool(own_pass or cls._active_team(conn, user_id, now))

    def is_paid_user(self, user_id: int) -> bool:
        self.ensure_schema()
        with self._connect() as conn:
            return self._is_paid_user(conn, user_id, int(time.time()))

    @classmethod
    def _personal_history_limit(cls, conn: sqlite3.Connection, user_id: int) -> int:
        return PAID_HISTORY_LIMIT if cls._is_paid_user(conn, user_id, int(time.time())) else FREE_HISTORY_LIMIT

    def personal_history_limit(self, user_id: int) -> int:
        self.ensure_schema()
        with self._connect() as conn:
            return self._personal_history_limit(conn, user_id)

    @staticmethod
    def _team_member_count(conn: sqlite3.Connection, team: sqlite3.Row) -> int:
        return (
            1
            + conn.execute(
                "SELECT COUNT(*) FROM team_memberships WHERE owner_id = ? AND tier = ?",
                (team["owner_id"], team["tier"]),
            ).fetchone()[0]
        )

    def team_overview(self, user_id: int) -> dict:
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute("BEGIN")
            now = int(time.time())
            team = self._active_team(conn, user_id, now)
            received = conn.execute(
                """
                SELECT i.owner_id, u.username AS owner_username, i.tier
                FROM team_invites i JOIN users u ON u.id = i.owner_id
                JOIN billing_passes b ON b.user_id = i.owner_id AND b.tier = i.tier
                WHERE i.user_id = ? AND i.expires_at > ? AND b.expires_at > ?
                ORDER BY i.expires_at
                """,
                (user_id, now, now),
            ).fetchall()
            if team is None:
                return {"team": None, "received": [dict(row) for row in received]}
            owner_id, tier = team["owner_id"], team["tier"]
            members = conn.execute(
                """
                SELECT u.id, u.username FROM team_memberships m JOIN users u ON u.id = m.user_id
                WHERE m.owner_id = ? AND m.tier = ? ORDER BY u.username
                """,
                (owner_id, tier),
            ).fetchall()
            sent = (
                conn.execute(
                    """
                    SELECT u.id, u.username FROM team_invites i JOIN users u ON u.id = i.user_id
                    WHERE i.owner_id = ? AND i.tier = ? AND i.expires_at > ? ORDER BY u.username
                    """,
                    (owner_id, tier, now),
                ).fetchall()
                if team["is_owner"]
                else []
            )
        return {
            "team": {
                **dict(team),
                "capacity": GROUP_CAPACITY[tier],
                "members": [{"id": owner_id, "username": team["owner_username"]}, *map(dict, members)],
                "sent": list(map(dict, sent)),
            },
            "received": list(map(dict, received)),
        }

    def invite_team_member(self, owner_id: int, username: str) -> None:
        self.ensure_schema()
        username = normalize_username(username)
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            now = int(time.time())
            team = self._active_team(conn, owner_id, now)
            if team is None or not team["is_owner"]:
                raise PermissionError("owner_required")
            target = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
            if target is None or target["id"] == owner_id:
                raise ValueError("invite_unavailable")
            member_id, tier = target["id"], team["tier"]
            if self._active_team(conn, member_id, now) is not None:
                raise ValueError("already_in_group")
            pending = conn.execute(
                """
                SELECT COUNT(*) FROM team_invites WHERE owner_id = ? AND tier = ? AND expires_at > ? AND user_id <> ?
                """,
                (owner_id, tier, now, member_id),
            ).fetchone()[0]
            if self._team_member_count(conn, team) + pending >= GROUP_CAPACITY[tier]:
                raise ValueError("team_full")
            conn.execute(
                """
                INSERT INTO team_invites(owner_id, user_id, tier, expires_at) VALUES (?, ?, ?, ?)
                ON CONFLICT(owner_id, user_id)
                DO UPDATE SET tier = excluded.tier, expires_at = excluded.expires_at
                """,
                (owner_id, member_id, tier, team["expires_at"]),
            )

    def respond_to_team_invite(self, user_id: int, owner_id: int, accept: bool) -> None:
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            now = int(time.time())
            if accept:
                team = self._active_team(conn, owner_id, now)
                invite = conn.execute(
                    "SELECT tier FROM team_invites WHERE owner_id = ? AND user_id = ? AND expires_at > ?",
                    (owner_id, user_id, now),
                ).fetchone()
                current = self._active_team(conn, user_id, now)
                if current and current["owner_id"] == owner_id and not current["is_owner"]:
                    return
                if not invite or not team or not team["is_owner"] or invite["tier"] != team["tier"]:
                    raise LookupError("invite_unavailable")
                if current:
                    raise ValueError("already_in_group")
                if conn.execute(
                    "SELECT 1 FROM billing_orders WHERE user_id = ? AND status = 'pending'", (user_id,)
                ).fetchone():
                    raise ValueError("pending_order")
                if self._team_member_count(conn, team) >= GROUP_CAPACITY[team["tier"]]:
                    raise ValueError("team_full")
                conn.execute(
                    """
                    INSERT INTO team_memberships(user_id, owner_id, tier) VALUES (?, ?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET owner_id = excluded.owner_id, tier = excluded.tier
                    """,
                    (user_id, owner_id, team["tier"]),
                )
            conn.execute("DELETE FROM team_invites WHERE owner_id = ? AND user_id = ?", (owner_id, user_id))

    def manage_team_member(self, owner_id: int, member_id: int, *, revoke_invite: bool) -> None:
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            team = self._active_team(conn, owner_id, int(time.time()))
            if team is None or not team["is_owner"]:
                raise PermissionError("owner_required")
            table = "team_invites" if revoke_invite else "team_memberships"
            conn.execute(
                f"DELETE FROM {table} WHERE owner_id = ? AND tier = ? AND user_id = ?",
                (owner_id, team["tier"], member_id),
            )

    def leave_team(self, user_id: int, owner_id: int) -> None:
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute("DELETE FROM team_memberships WHERE user_id = ? AND owner_id = ?", (user_id, owner_id))

    def team_history(self, user_id: int) -> list[dict]:
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute("BEGIN")
            team = self._active_team_pro(conn, user_id, int(time.time()))
            if team is None:
                raise PermissionError("membership_required")
            rows = conn.execute(
                """
                SELECT h.id, h.game_json, u.username AS author
                FROM team_history h LEFT JOIN users u ON u.id = h.author_id
                WHERE h.owner_id = ? AND h.tier = ? ORDER BY h.id DESC
                """,
                (team["owner_id"], team["tier"]),
            ).fetchall()
        return [{"id": row["id"], "game": json.loads(row["game_json"]), "author": row["author"]} for row in rows]

    @staticmethod
    def _series_key(game: dict) -> tuple[str, str]:
        if series_id := game.get("seriesId"):
            return "id", series_id
        if name := (game.get("seriesName") or "").strip():
            return "name", name
        blue = (game.get("blueTeamName") or "").strip() or "BLUE"
        red = (game.get("redTeamName") or "").strip() or "RED"
        return "name", f"{red} vs {blue}" if game.get("blueSideTeam") == "B" else f"{blue} vs {red}"

    @staticmethod
    def _recorded_team_names(game: dict) -> dict[str, str]:
        if game.get("blueSideTeam") == "B":
            return {"teamAName": game["redTeamName"], "teamBName": game["blueTeamName"]}
        return {"teamAName": game["blueTeamName"], "teamBName": game["redTeamName"]}

    @classmethod
    def _set_recorded_team_names(cls, game: dict, teams: dict[str, str]) -> dict:
        swapped = game.get("blueSideTeam") == "B"
        anchored = {} if game.get("seriesId") else {"seriesName": cls._series_key(game)[1]}
        return {
            **game,
            **anchored,
            "blueTeamName": teams["teamBName" if swapped else "teamAName"],
            "redTeamName": teams["teamAName" if swapped else "teamBName"],
            "teamNamesShared": True,
        }

    @staticmethod
    def _team_group_rows(conn: sqlite3.Connection, owner_id: int, tier: str) -> list[sqlite3.Row]:
        return conn.execute(
            "SELECT id, author_id, game_json FROM team_history WHERE owner_id = ? AND tier = ? ORDER BY id",
            (owner_id, tier),
        ).fetchall()

    @classmethod
    def _team_history_metadata(
        cls, conn: sqlite3.Connection, owner_id: int, tier: str
    ) -> tuple[dict[tuple[str, str], dict], dict[str, dict], dict[tuple[str, str], dict[str, str]]]:
        series: dict[tuple[str, str], dict] = {}
        tournaments: dict[str, dict] = {}
        teams: dict[tuple[str, str], dict[str, str]] = {}
        for row in cls._team_group_rows(conn, owner_id, tier):
            game = json.loads(row["game_json"])
            tournament = game.get("tournament")
            key = cls._series_key(game)
            metadata = series.setdefault(key, {"tournament": tournament, "seriesTitle": game.get("seriesTitle")})
            if game.get("gameNameShared"):
                metadata.update(gameNameShared=True)
                metadata.setdefault("gameName", game.get("gameName"))
            if tournament:
                tournaments.setdefault(tournament["id"], tournament)
            if game.get("teamNamesShared"):
                teams.setdefault(key, cls._recorded_team_names(game))
        return series, tournaments, teams

    @classmethod
    def _apply_team_history_metadata(
        cls,
        game: dict,
        series: dict[tuple[str, str], dict],
        tournaments: dict[str, dict],
        teams: dict[tuple[str, str], dict[str, str]],
    ) -> dict:
        key = cls._series_key(game)
        if key not in series:
            series[key] = {"tournament": game.get("tournament"), "seriesTitle": game.get("seriesTitle")}
            if game.get("gameNameShared"):
                series[key].update(gameNameShared=True, gameName=game.get("gameName"))
            if game.get("teamNamesShared"):
                teams[key] = cls._recorded_team_names(game)
        metadata = series[key]
        tournament = metadata["tournament"]
        if tournament:
            tournament = tournaments.setdefault(tournament["id"], tournament)
        saved = {**game, "gameNameShared": False, "teamNamesShared": False, **metadata, "tournament": tournament}
        return cls._set_recorded_team_names(saved, teams[key]) if key in teams else saved

    def _read_team_history_for_edit(self, conn: sqlite3.Connection, user_id: int) -> tuple[bool, dict]:
        team = self._active_team_pro(conn, user_id, int(time.time()))
        if team is None:
            raise PermissionError("membership_required")
        games = {
            row["id"]: (row["author_id"], json.loads(row["game_json"]))
            for row in self._team_group_rows(conn, team["owner_id"], team["tier"])
        }
        return team["is_owner"], games

    def assign_team_series_tournaments(self, user_id: int, game_ids: list[int], tournament: dict | None) -> None:
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            is_owner, games = self._read_team_history_for_edit(conn, user_id)
            if any(game_id not in games for game_id in game_ids):
                raise LookupError("game_not_found")
            if tournament:
                tournament = next(
                    (
                        existing
                        for _, game in games.values()
                        if (existing := game.get("tournament")) and existing["id"] == tournament["id"]
                    ),
                    tournament,
                )
            series_keys = {self._series_key(games[game_id][1]) for game_id in game_ids}
            updates = []
            for game_id, (author_id, game) in games.items():
                if self._series_key(game) not in series_keys:
                    continue
                if not is_owner and author_id != user_id:
                    raise PermissionError("owner_required")
                game["tournament"] = tournament
                updates.append((json.dumps(game, ensure_ascii=False, allow_nan=False), game_id))
            conn.executemany("UPDATE team_history SET game_json = ? WHERE id = ?", updates)

    def rename_team_history_item(
        self, user_id: int, game_id: int, target: DraftHistoryNameTarget, name: str | None
    ) -> None:
        if target != "tournament":
            field = "seriesTitle" if target == "series" else "gameName"
            self.edit_team_history_series(user_id, game_id, {field: name})
            return
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            is_owner, games = self._read_team_history_for_edit(conn, user_id)
            if game_id not in games:
                raise LookupError("game_not_found")
            anchor = games[game_id][1]
            tournament = anchor.get("tournament")
            if not tournament:
                raise LookupError("game_not_found")
            tournament_id = tournament["id"]
            matching_ids = [
                row_id
                for row_id, (_, game) in games.items()
                if (game.get("tournament") or {}).get("id") == tournament_id
            ]
            changes = {"tournament": {"id": tournament_id, "name": name}}
            if not is_owner and any(games[row_id][0] != user_id for row_id in matching_ids):
                raise PermissionError("owner_required")
            updates = [
                (json.dumps({**games[row_id][1], **changes}, ensure_ascii=False, allow_nan=False), row_id)
                for row_id in matching_ids
            ]
            conn.executemany("UPDATE team_history SET game_json = ? WHERE id = ?", updates)

    def edit_team_history_series(self, user_id: int, game_id: int, edit: dict) -> None:
        changes = {field: edit[field] for field in ("seriesTitle", "gameName") if field in edit}
        if "gameName" in changes:
            changes["gameNameShared"] = True
        teams = edit.get("teams")
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            is_owner, games = self._read_team_history_for_edit(conn, user_id)
            if game_id not in games:
                raise LookupError("game_not_found")
            key = self._series_key(games[game_id][1])
            updates = []
            for row_id, (author_id, game) in games.items():
                if self._series_key(game) != key:
                    continue
                if not is_owner and author_id != user_id:
                    raise PermissionError("owner_required")
                updated = {**game, **changes}
                if teams:
                    updated = self._set_recorded_team_names(updated, teams)
                updates.append((json.dumps(updated, ensure_ascii=False, allow_nan=False), row_id))
            conn.executemany("UPDATE team_history SET game_json = ? WHERE id = ?", updates)

    def save_team_game(self, user_id: int, owner_id: int, tier: str, game_id: str, game: dict | None = None) -> int:
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            team = self._active_team_pro(conn, user_id, int(time.time()))
            if team is None or (team["owner_id"], team["tier"]) != (owner_id, tier):
                raise PermissionError("membership_required")
            existing = conn.execute(
                "SELECT id FROM team_history WHERE owner_id = ? AND tier = ? AND author_id = ? AND source_id = ?",
                (owner_id, tier, user_id, game_id),
            ).fetchone()
            if existing:
                return existing["id"]
            if (
                conn.execute(
                    "SELECT COUNT(*) FROM team_history WHERE owner_id = ? AND tier = ?", (owner_id, tier)
                ).fetchone()[0]
                >= TEAM_HISTORY_LIMIT
            ):
                raise ValueError("history_full")
            if game is None:
                saved = conn.execute(
                    "SELECT payload_json FROM user_draft_states WHERE user_id = ?", (user_id,)
                ).fetchone()
                state = (_safe_json_loads(saved["payload_json"]) or {}) if saved else {}
                game = next((item for item in state.get("seriesGames", []) if item.get("id") == game_id), None)
                if game is None:
                    raise LookupError("game_not_found")
                game = RecordedDraftGameSchema.model_validate(game).model_dump()
            metadata = self._team_history_metadata(conn, owner_id, tier)
            game = self._apply_team_history_metadata(game, *metadata)
            return conn.execute(
                """
                INSERT INTO team_history(owner_id, tier, author_id, source_id, game_json)
                VALUES (?, ?, ?, ?, ?) RETURNING id
                """,
                (owner_id, tier, user_id, game_id, json.dumps(game, ensure_ascii=False, allow_nan=False)),
            ).fetchone()["id"]

    def save_team_games(
        self,
        user_id: int,
        owner_id: int,
        tier: str,
        game_ids: list[str],
        games: list[dict] | None = None,
    ) -> dict[str, int]:
        """Atomically copy an ordered batch of personal series games into shared team history."""
        unique_ids = list(dict.fromkeys(game_ids))
        if not unique_ids:
            return {"copied": 0, "skipped": 0}
        provided_by_id = {
            item["id"]: item for item in (games or ()) if isinstance(item, dict) and isinstance(item.get("id"), str)
        }
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            team = self._active_team_pro(conn, user_id, int(time.time()))
            if team is None or (team["owner_id"], team["tier"]) != (owner_id, tier):
                raise PermissionError("membership_required")
            placeholders = ",".join("?" for _ in unique_ids)
            existing_rows = conn.execute(
                f"""
                SELECT source_id FROM team_history
                WHERE owner_id = ? AND tier = ? AND author_id = ? AND source_id IN ({placeholders})
                """,
                (owner_id, tier, user_id, *unique_ids),
            ).fetchall()
            existing_ids = {row["source_id"] for row in existing_rows}
            pending_ids = [gid for gid in unique_ids if gid not in existing_ids]
            if not pending_ids:
                return {"copied": 0, "skipped": len(unique_ids)}
            current_count = conn.execute(
                "SELECT COUNT(*) FROM team_history WHERE owner_id = ? AND tier = ?", (owner_id, tier)
            ).fetchone()[0]
            if current_count + len(pending_ids) > TEAM_HISTORY_LIMIT:
                raise ValueError("history_full")
            saved = conn.execute("SELECT payload_json FROM user_draft_states WHERE user_id = ?", (user_id,)).fetchone()
            state = (_safe_json_loads(saved["payload_json"]) or {}) if saved else {}
            by_id = {
                item["id"]: item
                for item in state.get("seriesGames", [])
                if isinstance(item, dict) and isinstance(item.get("id"), str)
            }
            games_to_insert: list[tuple[str, str]] = []
            metadata = self._team_history_metadata(conn, owner_id, tier)
            for gid in pending_ids:
                if stored_game := by_id.get(gid):
                    game = RecordedDraftGameSchema.model_validate(stored_game).model_dump()
                else:
                    game = provided_by_id.get(gid)
                    if game is None:
                        raise LookupError("game_not_found")
                game = self._apply_team_history_metadata(game, *metadata)
                games_to_insert.append((gid, json.dumps(game, ensure_ascii=False, allow_nan=False)))
            conn.executemany(
                """
                INSERT INTO team_history(owner_id, tier, author_id, source_id, game_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                [(owner_id, tier, user_id, gid, payload) for gid, payload in games_to_insert],
            )
        return {"copied": len(pending_ids), "skipped": len(unique_ids) - len(pending_ids)}

    def delete_team_game(self, user_id: int, game_id: int) -> None:
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            team = self._active_team_pro(conn, user_id, int(time.time()))
            if team is None:
                raise PermissionError("membership_required")
            if not conn.execute(
                """
                DELETE FROM team_history WHERE id = ? AND owner_id = ? AND tier = ? AND (author_id = ? OR ?)
                """,
                (game_id, team["owner_id"], team["tier"], user_id, team["is_owner"]),
            ).rowcount:
                raise LookupError("game_not_found")

    @staticmethod
    def _sanitize_pool_lanes(lanes: dict[str, list[str]]) -> dict[str, list[str]]:
        sanitized: dict[str, list[str]] = {}
        for lane in HERO_POOL_LANES:
            seen: set[str] = set()
            clean: list[str] = []
            for raw_hero in lanes.get(lane, ()):
                hero = str(raw_hero).strip()
                if not hero or hero in seen:
                    continue
                seen.add(hero)
                clean.append(hero)
                if len(clean) >= 60:
                    break
            sanitized[lane] = clean
        return sanitized

    @staticmethod
    def _row_to_hero_pool(row: sqlite3.Row) -> dict:
        raw_lanes = _safe_json_loads(str(row["lanes_json"])) or {}
        lanes = {lane: list(raw_lanes.get(lane, [])) for lane in HERO_POOL_LANES}
        return {
            "id": int(row["id"]),
            "scope": str(row["scope"]),
            "team_name": str(row["team_name"]),
            "lanes": lanes,
            "updated_at": int(row["updated_at"]),
        }

    def list_hero_pools(self, user_id: int) -> dict:
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute("BEGIN")
            now = int(time.time())
            is_paid = self._is_paid_user(conn, user_id, now)
            team = self._active_team_pro(conn, user_id, now)
            personal_rows = conn.execute(
                """
                SELECT id, scope, team_name, lanes_json, updated_at
                FROM hero_pools
                WHERE owner_id = ? AND scope = 'personal' AND tier = ''
                ORDER BY updated_at DESC, id DESC
                """,
                (user_id,),
            ).fetchall()
            team_rows = (
                conn.execute(
                    """
                    SELECT id, scope, team_name, lanes_json, updated_at
                    FROM hero_pools
                    WHERE owner_id = ? AND scope = 'team' AND tier = ?
                    ORDER BY updated_at DESC, id DESC
                    """,
                    (team["owner_id"], team["tier"]),
                ).fetchall()
                if team is not None
                else []
            )
        return {
            "personal": [self._row_to_hero_pool(row) for row in personal_rows],
            "team": [self._row_to_hero_pool(row) for row in team_rows],
            "personal_limit": PAID_HERO_POOL_LIMIT if is_paid else FREE_HERO_POOL_LIMIT,
            "team_limit": TEAM_HERO_POOL_LIMIT if team is not None else 0,
            "is_paid": is_paid,
            "team_tier": str(team["tier"]) if team is not None else None,
        }

    def upsert_hero_pool(
        self,
        user_id: int,
        scope: str,
        team_name: str,
        lanes: dict[str, list[str]],
        create_only: bool = False,
        pool_id: int | None = None,
    ) -> dict:
        clean_name = team_name.strip()
        if not clean_name or len(clean_name) > 32:
            raise ValueError("invalid_team_name")
        norm = clean_name.casefold()
        clean_lanes = self._sanitize_pool_lanes(lanes)
        encoded_lanes = json.dumps(clean_lanes, ensure_ascii=False, allow_nan=False)
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            now = int(time.time())
            if scope == "personal":
                owner_id = user_id
                tier = ""
                limit = PAID_HERO_POOL_LIMIT if self._is_paid_user(conn, user_id, now) else FREE_HERO_POOL_LIMIT
            elif scope == "team":
                team = self._active_team_pro(conn, user_id, now)
                if team is None:
                    raise PermissionError("membership_required")
                owner_id = int(team["owner_id"])
                tier = str(team["tier"])
                limit = TEAM_HERO_POOL_LIMIT
            else:
                raise ValueError("invalid_scope")
            if pool_id is not None:
                target = conn.execute(
                    "SELECT id FROM hero_pools WHERE id = ? AND owner_id = ? AND scope = ? AND tier = ?",
                    (pool_id, owner_id, scope, tier),
                ).fetchone()
                if target is None:
                    raise LookupError("pool_not_found")
                conflict = conn.execute(
                    """
                    SELECT id FROM hero_pools
                    WHERE owner_id = ? AND scope = ? AND tier = ? AND normalized_name = ? AND id != ?
                    """,
                    (owner_id, scope, tier, norm, pool_id),
                ).fetchone()
                if conflict is not None:
                    raise ValueError("duplicate_team_name")
                row = conn.execute(
                    """
                    UPDATE hero_pools
                    SET team_name = ?, normalized_name = ?, lanes_json = ?, updated_at = ?
                    WHERE id = ?
                    RETURNING id, scope, team_name, lanes_json, updated_at
                    """,
                    (clean_name, norm, encoded_lanes, now, pool_id),
                ).fetchone()
                return self._row_to_hero_pool(row)
            exists = conn.execute(
                """
                SELECT id FROM hero_pools
                WHERE owner_id = ? AND scope = ? AND tier = ? AND normalized_name = ?
                """,
                (owner_id, scope, tier, norm),
            ).fetchone()
            if exists is not None and create_only:
                raise ValueError("duplicate_team_name")
            if exists is None:
                count = int(
                    conn.execute(
                        "SELECT COUNT(*) FROM hero_pools WHERE owner_id = ? AND scope = ? AND tier = ?",
                        (owner_id, scope, tier),
                    ).fetchone()[0]
                )
                if count >= limit:
                    raise ValueError("pool_limit_reached")
            row = conn.execute(
                """
                INSERT INTO hero_pools(owner_id, scope, tier, team_name, normalized_name, lanes_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(owner_id, scope, tier, normalized_name)
                DO UPDATE SET
                    team_name = excluded.team_name,
                    lanes_json = excluded.lanes_json,
                    updated_at = excluded.updated_at
                RETURNING id, scope, team_name, lanes_json, updated_at
                """,
                (owner_id, scope, tier, clean_name, norm, encoded_lanes, now),
            ).fetchone()
            return self._row_to_hero_pool(row)

    def delete_hero_pool(self, user_id: int, pool_id: int) -> None:
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT id, owner_id, scope, tier FROM hero_pools WHERE id = ?",
                (pool_id,),
            ).fetchone()
            if row is None:
                raise LookupError("pool_not_found")
            if row["scope"] == "personal":
                if int(row["owner_id"]) != user_id:
                    raise LookupError("pool_not_found")
            else:
                team = self._active_team_pro(conn, user_id, int(time.time()))
                if team is None or (int(team["owner_id"]), str(team["tier"])) != (
                    int(row["owner_id"]),
                    str(row["tier"]),
                ):
                    raise PermissionError("membership_required")
            conn.execute("DELETE FROM hero_pools WHERE id = ?", (pool_id,))

    def register_user(
        self,
        username: str,
        password: str,
        display_name: str | None = None,
    ) -> AuthUser:
        norm = normalize_username(username)
        disp = (display_name or "").strip() or username.strip()
        if len(disp) > 40:
            raise ValueError("Display name must be at most 40 characters")
        pw_hash = hash_password(password)
        now = int(time.time())
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            self._prune_stale_if_full(conn, now)
            try:
                cur = conn.execute(
                    "INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)",
                    (norm, disp, pw_hash, now),
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError("Username is already taken") from exc
            return AuthUser(id=int(cur.lastrowid), username=norm, display_name=disp, created_at=now)

    def update_display_name(self, user: AuthUser, display_name: str) -> AuthUser | None:
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            # Serialize the quota check and update across concurrent sessions and server processes.
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                """
                SELECT display_name, display_name_is_custom, display_name_change_count, display_name_changed_at
                FROM users WHERE id = ?
                """,
                (user.id,),
            ).fetchone()
            if row is None:
                return None
            current = replace(
                user,
                display_name=str(row["display_name"]),
                display_name_is_custom=bool(row["display_name_is_custom"]),
                display_name_change_count=int(row["display_name_change_count"]),
                display_name_changed_at=int(row["display_name_changed_at"]),
            )
            if display_name == current.display_label:
                return current
            now = int(time.time())
            available_at = current.display_name_next_change_at
            if available_at is not None and now < available_at:
                raise DisplayNameCooldownError(available_at, available_at - now)
            updated = replace(
                current,
                display_name=display_name,
                display_name_is_custom=True,
                display_name_change_count=current.display_name_change_count + 1,
                display_name_changed_at=now,
            )
            conn.execute(
                """
                UPDATE users SET display_name = ?, display_name_is_custom = 1,
                    display_name_change_count = ?, display_name_changed_at = ?
                WHERE id = ?
                """,
                (updated.display_name, updated.display_name_change_count, updated.display_name_changed_at, updated.id),
            )
            return updated

    def upsert_oauth_user(
        self,
        provider: str,
        provider_user_id: str,
        email: str | None = None,
        preferred_username: str | None = None,
        display_name: str | None = None,
        email_verified: bool = False,
    ) -> AuthUser:
        prov = provider.strip().lower()
        if prov not in {"google", "discord"}:
            raise ValueError(f"Unsupported OAuth provider: {provider}")
        sub = provider_user_id.strip()
        if not sub:
            raise ValueError("Invalid OAuth provider user id")
        clean_email = email.strip().lower() if email and "@" in email else None
        verified_email = clean_email if (clean_email and email_verified) else None
        disp = (display_name or "").strip()[:40]
        now = int(time.time())
        self.ensure_schema()

        with self._lock, self._connect() as conn:
            row = conn.execute(
                """
                SELECT u.id, u.username, u.display_name, u.created_at, u.email, u.display_name_is_custom,
                       u.display_name_change_count, u.display_name_changed_at
                FROM user_oauth_accounts a
                JOIN users u ON u.id = a.user_id
                WHERE a.provider = ? AND a.provider_user_id = ?
                """,
                (prov, sub),
            ).fetchone()
            if row is not None:
                effective_email = verified_email or (str(row["email"]) if row["email"] else None)
                if verified_email and str(row["email"] or "").lower() != verified_email:
                    conn.execute("UPDATE users SET email = ? WHERE id = ?", (verified_email, int(row["id"])))
                    conn.execute(
                        "UPDATE user_oauth_accounts SET email = ? WHERE provider = ? AND provider_user_id = ?",
                        (verified_email, prov, sub),
                    )
                return AuthUser(
                    id=int(row["id"]),
                    username=str(row["username"]),
                    display_name=str(row["display_name"]),
                    created_at=int(row["created_at"]),
                    email=effective_email,
                    auth_provider=prov,
                    display_name_is_custom=bool(row["display_name_is_custom"]),
                    display_name_change_count=int(row["display_name_change_count"]),
                    display_name_changed_at=int(row["display_name_changed_at"]),
                )

            if verified_email:
                email_row = conn.execute(
                    "SELECT id, username, display_name, created_at, email, display_name_is_custom, "
                    "display_name_change_count, display_name_changed_at "
                    "FROM users WHERE email = ?",
                    (verified_email,),
                ).fetchone()
                if email_row is not None:
                    uid = int(email_row["id"])
                    conn.execute(
                        "INSERT INTO user_oauth_accounts (user_id, provider, provider_user_id, email, created_at) "
                        "VALUES (?, ?, ?, ?, ?)",
                        (uid, prov, sub, verified_email, now),
                    )
                    if prov == "google":
                        conn.execute("UPDATE users SET google_sub = COALESCE(google_sub, ?) WHERE id = ?", (sub, uid))
                    return AuthUser(
                        id=uid,
                        username=str(email_row["username"]),
                        display_name=str(email_row["display_name"]),
                        created_at=int(email_row["created_at"]),
                        email=verified_email,
                        auth_provider=prov,
                        display_name_is_custom=bool(email_row["display_name_is_custom"]),
                        display_name_change_count=int(email_row["display_name_change_count"]),
                        display_name_changed_at=int(email_row["display_name_changed_at"]),
                    )

            self._prune_stale_if_full(conn, now)
            seed = (preferred_username or "").strip() or (clean_email.split("@", 1)[0] if clean_email else "")
            local_part = re.sub(r"[^a-z0-9_.-]", "", seed.lower())
            base = local_part[:25] if len(local_part) >= 3 else f"{prov}_{local_part}"[:25]
            if len(base) < 3:
                base = f"{prov}_user"

            final_disp = disp or base
            for _attempt in range(12):
                candidate = base if _attempt == 0 else f"{base[:25]}_{secrets.token_hex(2)}"
                try:
                    cur = conn.execute(
                        "INSERT INTO users (username, display_name, password_hash, created_at, google_sub, email) "
                        "VALUES (?, ?, '!oauth', ?, ?, ?)",
                        (candidate, final_disp, now, sub if prov == "google" else None, verified_email),
                    )
                    uid = int(cur.lastrowid)
                    conn.execute(
                        "INSERT INTO user_oauth_accounts (user_id, provider, provider_user_id, email, created_at) "
                        "VALUES (?, ?, ?, ?, ?)",
                        (uid, prov, sub, verified_email, now),
                    )
                    return AuthUser(
                        id=uid,
                        username=candidate,
                        display_name=final_disp,
                        created_at=now,
                        email=verified_email,
                        auth_provider=prov,
                    )
                except sqlite3.IntegrityError:
                    continue
            raise RuntimeError(f"Could not allocate unique username for {prov} account")

    def upsert_google_user(
        self,
        google_sub: str,
        email: str,
        display_name: str | None = None,
    ) -> AuthUser:
        return self.upsert_oauth_user(
            "google",
            google_sub,
            email=email,
            display_name=display_name,
            email_verified=True,
        )

    def authenticate_user(self, username: str, password: str) -> AuthUser | None:
        try:
            norm = normalize_username(username)
        except ValueError:
            verify_password(password, _DUMMY_PASSWORD_HASH)
            return None
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT id, username, display_name, password_hash, created_at, google_sub, email, "
                "display_name_is_custom, display_name_change_count, display_name_changed_at "
                "FROM users WHERE username = ?",
                (norm,),
            ).fetchone()
        if row is None:
            verify_password(password, _DUMMY_PASSWORD_HASH)
            return None
        if not verify_password(password, str(row["password_hash"])):
            return None
        return AuthUser(
            id=int(row["id"]),
            username=str(row["username"]),
            display_name=str(row["display_name"]),
            created_at=int(row["created_at"]),
            email=str(row["email"]) if row["email"] else None,
            auth_provider="google" if row["google_sub"] else "password",
            display_name_is_custom=bool(row["display_name_is_custom"]),
            display_name_change_count=int(row["display_name_change_count"]),
            display_name_changed_at=int(row["display_name_changed_at"]),
        )

    def create_session(self, user_id: int, ttl_seconds: int = SESSION_TTL_SECONDS) -> str:
        token = secrets.token_urlsafe(32)
        token_hash = hash_session_token(token)
        now = int(time.time())
        expires_at = now + ttl_seconds
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM auth_sessions WHERE expires_at <= ?", (now,))
            conn.execute(
                """
                DELETE FROM auth_sessions
                WHERE user_id = ? AND token_hash NOT IN (
                    SELECT token_hash FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 9
                )
                """,
                (user_id, user_id),
            )
            conn.execute(
                "INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                (token_hash, user_id, now, expires_at),
            )
        return token

    def get_user_by_token(self, token: str | None) -> AuthUser | None:
        if not token:
            return None
        token_hash = hash_session_token(token)
        now = int(time.time())
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            row = conn.execute(
                """
                SELECT u.id, u.username, u.display_name, u.created_at, u.google_sub, u.email,
                       u.display_name_is_custom, u.display_name_change_count, u.display_name_changed_at, s.expires_at,
                       (
                           SELECT a.provider FROM user_oauth_accounts a
                           WHERE a.user_id = u.id
                           ORDER BY a.id DESC LIMIT 1
                       ) AS oauth_provider
                FROM auth_sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token_hash = ?
                """,
                (token_hash,),
            ).fetchone()
            if row is None:
                return None
            if int(row["expires_at"]) <= now:
                conn.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash,))
                return None
            provider = (
                str(row["oauth_provider"]) if row["oauth_provider"] else ("google" if row["google_sub"] else "password")
            )
            return AuthUser(
                id=int(row["id"]),
                username=str(row["username"]),
                display_name=str(row["display_name"]),
                created_at=int(row["created_at"]),
                email=str(row["email"]) if row["email"] else None,
                auth_provider=provider,
                display_name_is_custom=bool(row["display_name_is_custom"]),
                display_name_change_count=int(row["display_name_change_count"]),
                display_name_changed_at=int(row["display_name_changed_at"]),
            )

    def delete_session(self, token: str | None) -> None:
        if not token:
            return
        token_hash = hash_session_token(token)
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash,))

    _USER_STATE_TABLES = ("user_draft_states", "user_combat_builds", "user_practice_histories")

    def _get_user_json_state(self, table: str, user_id: int) -> dict | None:
        if table not in self._USER_STATE_TABLES:
            raise ValueError(f"Unsupported user state table: {table}")
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            row = conn.execute(
                f"SELECT payload_json FROM {table} WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        if row is None:
            return None
        return _safe_json_loads(str(row["payload_json"]))

    def _save_user_json_state(
        self, table: str, user_id: int, payload: dict, updated_at: int, *, limit_draft_history: bool = False
    ) -> dict:
        if table not in self._USER_STATE_TABLES:
            raise ValueError(f"Unsupported user state table: {table}")
        encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False)
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            if limit_draft_history:
                conn.execute("BEGIN IMMEDIATE")
                previous = conn.execute(
                    "SELECT payload_json, updated_at FROM user_draft_states WHERE user_id = ?", (user_id,)
                ).fetchone()
                if previous is None or updated_at >= previous["updated_at"]:
                    self._check_history_capacity(conn, user_id, payload, previous)
            conn.execute(
                f"""
                INSERT INTO {table} (user_id, payload_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at
                WHERE excluded.updated_at >= {table}.updated_at
                """,
                (user_id, encoded, updated_at),
            )
            row = conn.execute(
                f"SELECT payload_json FROM {table} WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        if row is not None:
            parsed = _safe_json_loads(str(row["payload_json"]))
            if parsed is not None:
                return parsed
        return payload

    @classmethod
    def _check_history_capacity(
        cls, conn: sqlite3.Connection, user_id: int, payload: dict, previous: sqlite3.Row | None
    ) -> None:
        games = payload.get("seriesGames", [])
        if len(games) <= cls._personal_history_limit(conn, user_id):
            return
        stored = (_safe_json_loads(previous["payload_json"]) or {}) if previous else {}

        def game_slot(game: dict) -> tuple[str, str, int]:
            kind, key = cls._series_key(game)
            return kind, key.casefold() if kind == "name" else key, game.get("gameNumber", 1)

        stored_games = stored.get("seriesGames", [])
        known_slots = {game_slot(game) for game in stored_games}
        if len(games) > len(stored_games) or any(game_slot(game) not in known_slots for game in games):
            raise ValueError("history_full")

    def _clear_user_json_state(self, table: str, user_id: int) -> int:
        # Store a tombstone strictly newer than any stored updated_at so clock-skewed writes cannot survive delete.
        if table not in self._USER_STATE_TABLES:
            raise ValueError(f"Unsupported user state table: {table}")
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute(f"SELECT updated_at FROM {table} WHERE user_id = ?", (user_id,)).fetchone()
            prev_ts = int(existing["updated_at"]) if existing is not None else 0
            tombstone_at = max(int(time.time() * 1000), prev_ts + 1)
            encoded = json.dumps({"updatedAt": tombstone_at}, ensure_ascii=False, allow_nan=False)
            conn.execute(
                f"""
                INSERT INTO {table} (user_id, payload_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at
                """,
                (user_id, encoded, tombstone_at),
            )
        return tombstone_at

    def get_user_draft_state(self, user_id: int) -> dict | None:
        return self._get_user_json_state("user_draft_states", user_id)

    def save_user_draft_state(
        self, user_id: int, payload: dict, updated_at: int, *, limit_draft_history: bool = False
    ) -> dict:
        return self._save_user_json_state(
            "user_draft_states", user_id, payload, updated_at, limit_draft_history=limit_draft_history
        )

    def clear_user_draft_state(self, user_id: int) -> int:
        return self._clear_user_json_state("user_draft_states", user_id)

    def get_user_combat_builds(self, user_id: int) -> dict | None:
        return self._get_user_json_state("user_combat_builds", user_id)

    def save_user_combat_builds(self, user_id: int, payload: dict, updated_at: int) -> dict:
        return self._save_user_json_state("user_combat_builds", user_id, payload, updated_at)

    def clear_user_combat_builds(self, user_id: int) -> None:
        self._clear_user_json_state("user_combat_builds", user_id)

    def get_user_practice_history(self, user_id: int) -> dict | None:
        return self._get_user_json_state("user_practice_histories", user_id)

    def save_user_practice_history(self, user_id: int, payload: dict, updated_at: int) -> dict:
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT payload_json, updated_at FROM user_practice_histories WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            existing = _safe_json_loads(str(row["payload_json"])) if row is not None else None
            existing_updated_at = int(row["updated_at"]) if row is not None else 0
            existing_cleared_at = int((existing or {}).get("clearedAt") or 0)
            effective_cleared_at = max(existing_cleared_at, int(payload.get("clearedAt") or 0))

            if existing is not None and effective_cleared_at > 0 and updated_at < effective_cleared_at:
                return existing

            existing_entries = [e for e in (existing or {}).get("entries", []) if isinstance(e, dict)]
            incoming_entries = [e for e in payload.get("entries", []) if isinstance(e, dict)]
            existing_deleted = [str(d) for d in (existing or {}).get("deletedIds", []) if isinstance(d, str) and d]
            incoming_deleted = [str(d) for d in (payload.get("deletedIds") or []) if isinstance(d, str) and d]
            deleted_ids = list(dict.fromkeys([*incoming_deleted, *existing_deleted]))[:100]
            deleted_set = set(deleted_ids)

            if (
                existing is not None
                and not incoming_entries
                and not incoming_deleted
                and updated_at < existing_updated_at
            ):
                return existing

            # Newer payload wins per entry id; distinct games from concurrent devices are preserved.
            if updated_at >= existing_updated_at:
                primary, secondary = incoming_entries, existing_entries
            else:
                primary, secondary = existing_entries, incoming_entries

            merged_entries: list[dict] = []
            seen_ids: set[str] = set()
            seen_sigs: set[str] = set()
            for entry in [*primary, *secondary]:
                eid = str(entry.get("id") or "").strip()
                sig = str(entry.get("signature") or "").strip()
                if not eid or eid in deleted_set or eid in seen_ids:
                    continue
                if effective_cleared_at > 0:
                    rec_ms = _entry_recorded_ms(entry)
                    if rec_ms is not None and rec_ms < effective_cleared_at:
                        continue
                if sig and sig in seen_sigs:
                    continue
                seen_ids.add(eid)
                if sig:
                    seen_sigs.add(sig)
                merged_entries.append(entry)

            merged_entries.sort(key=lambda e: str(e.get("recordedAt") or ""), reverse=True)
            merged_entries = merged_entries[:100]
            merged_updated_at = max(existing_updated_at, int(updated_at or 0))
            changed = (
                (merged_entries != existing_entries)
                or (deleted_ids != existing_deleted)
                or (effective_cleared_at != existing_cleared_at)
            )
            if existing is not None and changed and merged_updated_at <= existing_updated_at:
                # Server-issued monotonic bump so concurrent devices detect merges from older client clocks.
                merged_updated_at = max(existing_updated_at + 1, int(time.time() * 1000))
            stored_payload: dict = {
                "entries": merged_entries,
                "updatedAt": merged_updated_at,
                "deletedIds": deleted_ids,
                "clearedAt": effective_cleared_at,
            }

            encoded = json.dumps(stored_payload, ensure_ascii=False, allow_nan=False)
            conn.execute(
                """
                INSERT INTO user_practice_histories (user_id, payload_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at
                """,
                (user_id, encoded, merged_updated_at),
            )
            return stored_payload

    def clear_user_practice_history(self, user_id: int) -> None:
        tombstone_at = int(time.time() * 1000)
        cleared_payload = {"entries": [], "updatedAt": tombstone_at, "clearedAt": tombstone_at, "deletedIds": []}
        encoded = json.dumps(cleared_payload, ensure_ascii=False, allow_nan=False)
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO user_practice_histories (user_id, payload_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at
                """,
                (user_id, encoded, tombstone_at),
            )

    def get_pricing_survey_choice(self, user_id: int) -> str | None:
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT choice FROM pricing_survey_responses WHERE user_id = ? LIMIT 1",
                (user_id,),
            ).fetchone()
        if row is None:
            return None
        choice = str(row["choice"])
        return choice if choice in {"willing", "not_willing"} else None

    def has_answered_pricing_survey(self, user_id: int) -> bool:
        return self.get_pricing_survey_choice(user_id) is not None

    def record_pricing_survey(self, user_id: int | None, client_id: str | None, choice: str) -> None:
        if choice not in {"willing", "not_willing"}:
            raise ValueError("Invalid survey choice")
        norm_client_id = client_id.strip()[:64] if client_id and client_id.strip() else None
        now = int(time.time())
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            if user_id is not None:
                existing_user = conn.execute(
                    "SELECT id FROM pricing_survey_responses WHERE user_id = ?",
                    (user_id,),
                ).fetchone()
                if existing_user is not None:
                    conn.execute(
                        "UPDATE pricing_survey_responses SET choice = ?, updated_at = ? WHERE id = ?",
                        (choice, now, int(existing_user["id"])),
                    )
                    return
                if norm_client_id is not None:
                    existing_client = conn.execute(
                        "SELECT id, user_id FROM pricing_survey_responses WHERE client_id = ?",
                        (norm_client_id,),
                    ).fetchone()
                    if existing_client is not None:
                        if existing_client["user_id"] is None:
                            conn.execute(
                                """
                                UPDATE pricing_survey_responses
                                SET user_id = ?, choice = ?, is_guest = 0, updated_at = ?
                                WHERE id = ?
                                """,
                                (user_id, choice, now, int(existing_client["id"])),
                            )
                            return
                        # Another account already claimed this browser client_id; store this user independently.
                        norm_client_id = None
                conn.execute(
                    """
                    INSERT INTO pricing_survey_responses
                        (user_id, client_id, choice, is_guest, created_at, updated_at)
                    VALUES (?, ?, ?, 0, ?, ?)
                    """,
                    (user_id, norm_client_id, choice, now, now),
                )
                return

            if norm_client_id is not None:
                existing_client = conn.execute(
                    "SELECT id FROM pricing_survey_responses WHERE client_id = ?",
                    (norm_client_id,),
                ).fetchone()
                if existing_client is not None:
                    conn.execute(
                        "UPDATE pricing_survey_responses SET choice = ?, updated_at = ? WHERE id = ?",
                        (choice, now, int(existing_client["id"])),
                    )
                    return
            conn.execute(
                """
                INSERT INTO pricing_survey_responses
                    (user_id, client_id, choice, is_guest, created_at, updated_at)
                VALUES (NULL, ?, ?, 1, ?, ?)
                """,
                (norm_client_id, choice, now, now),
            )

    def record_user_feedback(
        self,
        user_id: int | None,
        client_id: str | None,
        message: str,
        page_context: str | None = None,
    ) -> dict[str, Any]:
        """Store text feedback from either an authenticated user or a guest browser client."""
        clean_msg = message.strip()[:1500]
        if len(clean_msg) < 2:
            raise ValueError("Feedback message must be at least 2 characters")
        norm_client_id = client_id.strip()[:64] if client_id and client_id.strip() else None
        norm_ctx = page_context.strip()[:32] if page_context and page_context.strip() else None
        now = int(time.time())
        tz_th = timezone(timedelta(hours=7))
        created_at_th = datetime.fromtimestamp(now, tz_th).strftime("%Y-%m-%d %H:%M:%S")
        is_guest = 1 if user_id is None else 0
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO user_feedback (user_id, client_id, message, is_guest, page_context, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user_id, norm_client_id, clean_msg, is_guest, norm_ctx, now),
            )
            row_id = int(cursor.lastrowid or 0)
        return {
            "recorded": True,
            "id": row_id,
            "created_at_th": created_at_th,
        }

    def get_admin_feedback(self, limit: int = 300) -> dict[str, Any]:
        """Return written user/guest feedback entries newest-first for owner inspection."""
        safe_limit = max(1, min(500, int(limit)))
        self.ensure_schema()
        now = int(time.time())
        tz_th = timezone(timedelta(hours=7))
        now_dt = datetime.fromtimestamp(now, tz_th)
        today_start = int(datetime(now_dt.year, now_dt.month, now_dt.day, 0, 0, 0, tzinfo=tz_th).timestamp())
        with self._lock, self._connect() as conn:
            agg_row = conn.execute(
                """
                SELECT
                    COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS today,
                    COALESCE(SUM(CASE WHEN is_guest = 0 THEN 1 ELSE 0 END), 0) AS member_total,
                    COALESCE(SUM(CASE WHEN is_guest = 1 THEN 1 ELSE 0 END), 0) AS guest_total
                FROM user_feedback
                """,
                (today_start,),
            ).fetchone()
            rows = conn.execute(
                """
                SELECT
                    f.id,
                    f.message,
                    f.is_guest,
                    f.client_id,
                    f.page_context,
                    f.created_at,
                    u.username,
                    u.display_name,
                    u.email
                FROM user_feedback f
                LEFT JOIN users u ON u.id = f.user_id
                ORDER BY f.created_at DESC, f.id DESC
                LIMIT ?
                """,
                (safe_limit,),
            ).fetchall()
        items = [
            {
                "id": int(r["id"]),
                "message": str(r["message"]),
                "is_guest": bool(r["is_guest"]),
                "username": str(r["username"]) if r["username"] else None,
                "display_name": str(r["display_name"]) if r["display_name"] else None,
                "email": str(r["email"]) if r["email"] else None,
                "client_id": str(r["client_id"]) if r["client_id"] else None,
                "page_context": str(r["page_context"]) if r["page_context"] else None,
                "created_at_th": datetime.fromtimestamp(int(r["created_at"]), tz_th).strftime("%Y-%m-%d %H:%M:%S"),
            }
            for r in rows
        ]
        return {
            "generated_at_th": now_dt.strftime("%Y-%m-%d %H:%M:%S"),
            "total": int(agg_row["total"] or 0),
            "today": int(agg_row["today"] or 0),
            "member_total": int(agg_row["member_total"] or 0),
            "guest_total": int(agg_row["guest_total"] or 0),
            "items": items,
        }

    def record_daily_visit(
        self,
        *,
        client_id: str,
        user_id: int | None,
        device_type: str | None = None,
        visit_date_override: str | None = None,
    ) -> str:
        """Record at most one visit row per client_id per UTC+7 calendar day."""
        self.ensure_schema()
        now = int(time.time())
        tz_th = timezone(timedelta(hours=7))
        today_str = visit_date_override or datetime.fromtimestamp(now, tz_th).strftime("%Y-%m-%d")
        norm_device = device_type if device_type in {"mobile", "desktop"} else None

        with self._lock, self._connect() as conn:
            already_today = conn.execute(
                "SELECT 1 FROM daily_visits WHERE client_id = ? AND visit_date = ?",
                (client_id, today_str),
            ).fetchone()
            row = conn.execute(
                "SELECT MIN(visit_date) AS first_seen FROM daily_visits WHERE client_id = ?",
                (client_id,),
            ).fetchone()
            existing_first = str(row["first_seen"]) if row and row["first_seen"] else None
            first_seen = min(existing_first, today_str) if existing_first else today_str
            conn.execute(
                """
                INSERT INTO daily_visits (client_id, visit_date, user_id, first_seen_date, created_at, device_type)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(client_id, visit_date) DO UPDATE SET
                    user_id = COALESCE(daily_visits.user_id, excluded.user_id),
                    device_type = COALESCE(daily_visits.device_type, excluded.device_type)
                """,
                (client_id, today_str, user_id, first_seen, now, norm_device),
            )
            if already_today is None and norm_device is not None:
                conn.execute(
                    """
                    INSERT INTO site_events_daily (event_date, metric_key, count)
                    VALUES (?, ?, 1)
                    ON CONFLICT(event_date, metric_key) DO UPDATE SET
                        count = site_events_daily.count + 1
                    """,
                    (today_str, f"device_{norm_device}"),
                )
            conn.commit()
        return today_str

    def record_site_events(self, events: dict[str, int]) -> None:
        """Batch-increment daily site_events_daily counters."""
        clean = [(str(k), int(v)) for k, v in events.items() if int(v) > 0]
        if not clean:
            return
        self.ensure_schema()
        tz_th = timezone(timedelta(hours=7))
        today_str = datetime.fromtimestamp(int(time.time()), tz_th).strftime("%Y-%m-%d")
        with self._lock, self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO site_events_daily (event_date, metric_key, count)
                VALUES (?, ?, ?)
                ON CONFLICT(event_date, metric_key) DO UPDATE SET
                    count = site_events_daily.count + excluded.count
                """,
                [(today_str, key, delta) for key, delta in clean],
            )

    def record_predict_telemetry(
        self,
        *,
        user_id: int | None,
        client_id: str | None,
        elapsed_ms: int,
        use_lookahead: bool,
    ) -> None:
        """Record member/guest prediction counts, latency histogram buckets, and per-client/user counters."""
        self.ensure_schema()
        now = int(time.time())
        tz_th = timezone(timedelta(hours=7))
        today_str = datetime.fromtimestamp(now, tz_th).strftime("%Y-%m-%d")
        lat = max(0, int(elapsed_ms))
        if lat < 25:
            bucket = "lat_lt_25ms"
        elif lat < 100:
            bucket = "lat_25_100ms"
        elif lat < 500:
            bucket = "lat_100_500ms"
        else:
            bucket = "lat_gt_500ms"

        events = [
            (today_str, "predict_member" if user_id is not None else "predict_guest", 1),
            (today_str, "predict_lat_count", 1),
            (today_str, "predict_lat_sum_ms", lat),
            (today_str, bucket, 1),
        ]
        if use_lookahead:
            events.append((today_str, "predict_lookahead_count", 1))

        valid_cid = (
            client_id.strip() if client_id and re.fullmatch(r"^[a-zA-Z0-9_-]{8,64}$", client_id.strip()) else None
        )
        with self._lock, self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO site_events_daily (event_date, metric_key, count)
                VALUES (?, ?, ?)
                ON CONFLICT(event_date, metric_key) DO UPDATE SET
                    count = site_events_daily.count + excluded.count
                """,
                events,
            )
            if user_id is not None:
                conn.execute(
                    """
                    INSERT INTO user_usage_daily (user_id, usage_date, predict_count, draft_save_count, last_seen_at)
                    VALUES (?, ?, 1, 0, ?)
                    ON CONFLICT(user_id, usage_date) DO UPDATE SET
                        predict_count = user_usage_daily.predict_count + 1,
                        last_seen_at = MAX(user_usage_daily.last_seen_at, excluded.last_seen_at)
                    """,
                    (user_id, today_str, now),
                )
            elif valid_cid is not None:
                conn.execute(
                    """
                    INSERT INTO daily_visits
                        (client_id, visit_date, user_id, first_seen_date, created_at, predict_count)
                    VALUES (?, ?, NULL, ?, ?, 1)
                    ON CONFLICT(client_id, visit_date) DO UPDATE SET
                        predict_count = daily_visits.predict_count + 1
                    """,
                    (valid_cid, today_str, today_str, now),
                )

    def get_admin_statistical_analytics(self) -> dict[str, Any]:
        """Compute quantitative probability, stochastic & statistical inference analytics."""
        from src.analytics import build_statistical_analytics

        self.ensure_schema()
        now = int(time.time())
        tz_th = timezone(timedelta(hours=7))
        now_dt = datetime.fromtimestamp(now, tz_th)
        today_str = now_dt.strftime("%Y-%m-%d")
        with self._lock, self._connect() as conn:
            report = build_statistical_analytics(conn, today_str)
        report["generated_at_th"] = now_dt.strftime("%Y-%m-%d %H:%M:%S")
        return report

    def get_admin_stats(self) -> dict[str, Any]:
        self.ensure_schema()
        now = int(time.time())
        tz_th = timezone(timedelta(hours=7))
        now_dt = datetime.fromtimestamp(now, tz_th)
        today_start = int(datetime(now_dt.year, now_dt.month, now_dt.day, 0, 0, 0, tzinfo=tz_th).timestamp())

        with self._lock, self._connect() as conn:
            total_users = int(conn.execute("SELECT COUNT(*) FROM users").fetchone()[0])
            new_users_today = int(
                conn.execute("SELECT COUNT(*) FROM users WHERE created_at >= ?", (today_start,)).fetchone()[0]
            )
            active_sessions = int(
                conn.execute("SELECT COUNT(*) FROM auth_sessions WHERE expires_at > ?", (now,)).fetchone()[0]
            )
            active_session_users = int(
                conn.execute(
                    "SELECT COUNT(DISTINCT user_id) FROM auth_sessions WHERE expires_at > ?",
                    (now,),
                ).fetchone()[0]
            )
            saved_draft_states = int(conn.execute("SELECT COUNT(*) FROM user_draft_states").fetchone()[0])

            oauth_rows = conn.execute(
                "SELECT provider, COUNT(*) AS cnt FROM user_oauth_accounts GROUP BY provider"
            ).fetchall()
            oauth_map = {str(r["provider"]): int(r["cnt"]) for r in oauth_rows}
            password_only_users = int(
                conn.execute(
                    "SELECT COUNT(*) FROM users WHERE id NOT IN (SELECT DISTINCT user_id FROM user_oauth_accounts)"
                ).fetchone()[0]
            )

            created_rows = conn.execute("SELECT created_at FROM users").fetchall()
            by_day_counter = Counter(
                datetime.fromtimestamp(int(r["created_at"]), tz_th).strftime("%Y-%m-%d") for r in created_rows
            )
            signups_by_day = [{"date": d, "count": cnt} for d, cnt in sorted(by_day_counter.items(), reverse=True)[:7]]

            survey_rows = conn.execute(
                "SELECT choice, is_guest, COUNT(*) AS cnt FROM pricing_survey_responses GROUP BY choice, is_guest"
            ).fetchall()
            willing_member = 0
            willing_guest = 0
            not_willing_member = 0
            not_willing_guest = 0
            for r in survey_rows:
                ch = str(r["choice"])
                guest_flag = int(r["cnt"])
                if ch == "willing":
                    if int(r["is_guest"]) == 1:
                        willing_guest += guest_flag
                    else:
                        willing_member += guest_flag
                elif ch == "not_willing":
                    if int(r["is_guest"]) == 1:
                        not_willing_guest += guest_flag
                    else:
                        not_willing_member += guest_flag

            willing_total = willing_member + willing_guest
            not_willing_total = not_willing_member + not_willing_guest
            survey_total = willing_total + not_willing_total
            willing_pct = round((willing_total / survey_total) * 100.0, 1) if survey_total > 0 else 0.0

            recent_rows = conn.execute(
                """
                SELECT p.id, p.choice, p.is_guest, p.updated_at, u.username, u.display_name, u.email
                FROM pricing_survey_responses p
                LEFT JOIN users u ON u.id = p.user_id
                ORDER BY p.updated_at DESC, p.id DESC
                LIMIT 500
                """
            ).fetchall()
            recent_votes = [
                {
                    "id": int(r["id"]),
                    "choice": str(r["choice"]),
                    "is_guest": bool(r["is_guest"]),
                    "username": str(r["username"]) if r["username"] else None,
                    "display_name": str(r["display_name"]) if r["display_name"] else None,
                    "email": str(r["email"]) if r["email"] else None,
                    "updated_at_th": datetime.fromtimestamp(int(r["updated_at"]), tz_th).strftime("%Y-%m-%d %H:%M:%S"),
                }
                for r in recent_rows
            ]

            today_str = now_dt.strftime("%Y-%m-%d")
            cutoff_7d = (now_dt - timedelta(days=6)).strftime("%Y-%m-%d")
            ret_row = conn.execute(
                """
                WITH client_stats AS (
                    SELECT
                        client_id,
                        MIN(visit_date) AS first_date,
                        MAX(visit_date) AS last_date,
                        COUNT(*) AS visit_days,
                        MAX(CASE WHEN visit_date = ? THEN 1 ELSE 0 END) AS visited_today
                    FROM daily_visits
                    GROUP BY client_id
                )
                SELECT
                    COUNT(*) AS total_tracked_clients,
                    COALESCE(SUM(CASE WHEN visit_days >= 2 THEN 1 ELSE 0 END), 0) AS returning_clients,
                    COALESCE(SUM(CASE WHEN visit_days >= 2 AND last_date >= ? THEN 1 ELSE 0 END), 0) AS active_returning_7d,
                    COALESCE(SUM(CASE WHEN visit_days >= 3 AND last_date >= ? THEN 1 ELSE 0 END), 0) AS active_repeat_3plus_7d,
                    COALESCE(SUM(CASE WHEN visit_days = 2 AND last_date >= ? THEN 1 ELSE 0 END), 0) AS active_returned_once_7d,
                    COALESCE(SUM(CASE WHEN visit_days >= 2 AND last_date < ? THEN 1 ELSE 0 END), 0) AS dormant_returning,
                    COALESCE(SUM(CASE WHEN visited_today = 1 AND first_date = ? THEN 1 ELSE 0 END), 0) AS today_new,
                    COALESCE(SUM(CASE WHEN visited_today = 1 AND first_date < ? THEN 1 ELSE 0 END), 0) AS today_returning,
                    COALESCE(SUM(CASE WHEN first_date < ? THEN 1 ELSE 0 END), 0) AS d1_eligible,
                    COALESCE(SUM(CASE WHEN first_date < ? AND visit_days >= 2 THEN 1 ELSE 0 END), 0) AS d1_retained
                FROM client_stats
                """,
                (
                    today_str,
                    cutoff_7d,
                    cutoff_7d,
                    cutoff_7d,
                    cutoff_7d,
                    today_str,
                    today_str,
                    today_str,
                    today_str,
                ),
            ).fetchone()
            total_tracked_clients = int(ret_row["total_tracked_clients"] or 0)
            returning_clients = int(ret_row["returning_clients"] or 0)
            returning_pct = (
                round((returning_clients / total_tracked_clients) * 100.0, 1) if total_tracked_clients > 0 else 0.0
            )
            active_returning_7d = int(ret_row["active_returning_7d"] or 0)
            active_returning_7d_pct = (
                round((active_returning_7d / total_tracked_clients) * 100.0, 1) if total_tracked_clients > 0 else 0.0
            )
            active_repeat_3plus_7d = int(ret_row["active_repeat_3plus_7d"] or 0)
            active_returned_once_7d = int(ret_row["active_returned_once_7d"] or 0)
            dormant_returning = int(ret_row["dormant_returning"] or 0)
            today_new = int(ret_row["today_new"] or 0)
            today_returning = int(ret_row["today_returning"] or 0)
            today_dau = today_new + today_returning
            d1_eligible = int(ret_row["d1_eligible"] or 0)
            d1_retained = int(ret_row["d1_retained"] or 0)
            d1_pct = round((d1_retained / d1_eligible) * 100.0, 1) if d1_eligible > 0 else 0.0

            breakdown_rows = conn.execute(
                """
                WITH first_seen AS (
                    SELECT client_id, MIN(visit_date) AS first_date
                    FROM daily_visits
                    GROUP BY client_id
                )
                SELECT
                    dv.visit_date AS date,
                    SUM(CASE WHEN dv.visit_date = fs.first_date THEN 1 ELSE 0 END) AS new_cnt,
                    SUM(CASE WHEN dv.visit_date > fs.first_date THEN 1 ELSE 0 END) AS returning_cnt,
                    COUNT(*) AS total_cnt
                FROM daily_visits dv
                JOIN first_seen fs ON fs.client_id = dv.client_id
                GROUP BY dv.visit_date
                ORDER BY dv.visit_date DESC
                LIMIT 7
                """
            ).fetchall()
            daily_breakdown = [
                {
                    "date": str(r["date"]),
                    "new": int(r["new_cnt"] or 0),
                    "returning": int(r["returning_cnt"] or 0),
                    "total": int(r["total_cnt"] or 0),
                }
                for r in breakdown_rows
            ]

            feedback_row = conn.execute(
                """
                SELECT
                    COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS today
                FROM user_feedback
                """,
                (today_start,),
            ).fetchone()
            feedback_total = int(feedback_row["total"] or 0)
            feedback_today = int(feedback_row["today"] or 0)

            pass_rows = conn.execute(
                """
                WITH paid_agg AS (
                    SELECT
                        user_id,
                        COUNT(*) AS paid_orders,
                        COALESCE(SUM(amount), 0) AS paid_amount_satang
                    FROM billing_orders
                    WHERE status = 'paid'
                    GROUP BY user_id
                ),
                promo_agg AS (
                    SELECT
                        user_id,
                        MAX(claimed_at) AS promo_claimed_at
                    FROM promo_claims
                    GROUP BY user_id
                )
                SELECT
                    bp.user_id,
                    bp.tier,
                    bp.expires_at,
                    u.username,
                    u.display_name,
                    u.email,
                    COALESCE(po.paid_orders, 0) AS paid_orders,
                    COALESCE(po.paid_amount_satang, 0) AS paid_amount_satang,
                    pr.promo_claimed_at
                FROM billing_passes bp
                JOIN users u ON u.id = bp.user_id
                LEFT JOIN paid_agg po ON po.user_id = bp.user_id
                LEFT JOIN promo_agg pr ON pr.user_id = bp.user_id
                WHERE bp.expires_at > ?
                """,
                (now,),
            ).fetchall()
            total_promo_claims = int(conn.execute("SELECT COUNT(*) FROM promo_claims").fetchone()[0])
            paid_totals_row = conn.execute(
                """
                SELECT
                    COUNT(*) AS paid_orders,
                    COALESCE(SUM(amount), 0) AS revenue_satang
                FROM billing_orders
                WHERE status = 'paid'
                """
            ).fetchone()
            total_paid_orders = int(paid_totals_row["paid_orders"] or 0)
            total_revenue_thb = round(int(paid_totals_row["revenue_satang"] or 0) / 100.0, 2)

            active_passes: list[dict[str, Any]] = []
            pass_by_user_id: dict[int, dict[str, Any]] = {}
            active_paid_by_tier = {"pro": 0, "duo": 0, "team_pro": 0}
            active_by_tier = {"pro": 0, "duo": 0, "team_pro": 0}
            active_paid_users = 0
            active_promo_users = 0
            active_team_members = 0
            active_manual_users = 0

            for pr in pass_rows:
                uid = int(pr["user_id"])
                tier_code = str(pr["tier"])
                expires_at = int(pr["expires_at"])
                paid_orders_cnt = int(pr["paid_orders"] or 0)
                promo_claimed_at = int(pr["promo_claimed_at"]) if pr["promo_claimed_at"] else None
                if paid_orders_cnt > 0:
                    source = "paid"
                    active_paid_users += 1
                    active_paid_by_tier[tier_code] = active_paid_by_tier.get(tier_code, 0) + 1
                elif promo_claimed_at is not None:
                    source = "promo_free"
                    active_promo_users += 1
                else:
                    source = "manual"
                    active_manual_users += 1
                active_by_tier[tier_code] = active_by_tier.get(tier_code, 0) + 1
                days_left = max(0, (expires_at - now + 86399) // 86400)
                item = {
                    "user_id": uid,
                    "username": str(pr["username"]),
                    "display_name": str(pr["display_name"]),
                    "email": str(pr["email"]) if pr["email"] else None,
                    "tier": tier_code,
                    "source": source,
                    "paid_orders": paid_orders_cnt,
                    "paid_amount_thb": round(int(pr["paid_amount_satang"] or 0) / 100.0, 2),
                    "expires_at": expires_at,
                    "expires_at_th": datetime.fromtimestamp(expires_at, tz_th).strftime("%Y-%m-%d %H:%M"),
                    "days_left": days_left,
                    "claimed_at_th": (
                        datetime.fromtimestamp(promo_claimed_at, tz_th).strftime("%Y-%m-%d %H:%M")
                        if promo_claimed_at
                        else None
                    ),
                    "team_owner_username": None,
                    "team_tier": None,
                }
                active_passes.append(item)
                pass_by_user_id[uid] = item

            member_rows = conn.execute(
                """
                SELECT
                    tm.user_id,
                    tm.tier,
                    bp.expires_at,
                    u.username,
                    u.display_name,
                    u.email,
                    owner.username AS team_owner_username
                FROM team_memberships tm
                JOIN billing_passes bp ON bp.user_id = tm.owner_id AND bp.tier = tm.tier AND bp.expires_at > ?
                JOIN users u ON u.id = tm.user_id
                JOIN users owner ON owner.id = tm.owner_id
                """,
                (now,),
            ).fetchall()
            for mr in member_rows:
                uid = int(mr["user_id"])
                tier_code = str(mr["tier"])
                expires_at = int(mr["expires_at"])
                owner_username = str(mr["team_owner_username"])
                active_team_members += 1
                existing = pass_by_user_id.get(uid)
                if existing is not None:
                    existing["team_owner_username"] = owner_username
                    existing["team_tier"] = tier_code
                    continue
                active_by_tier[tier_code] = active_by_tier.get(tier_code, 0) + 1
                days_left = max(0, (expires_at - now + 86399) // 86400)
                active_passes.append(
                    {
                        "user_id": uid,
                        "username": str(mr["username"]),
                        "display_name": str(mr["display_name"]),
                        "email": str(mr["email"]) if mr["email"] else None,
                        "tier": tier_code,
                        "source": "team_member",
                        "paid_orders": 0,
                        "paid_amount_thb": 0.0,
                        "expires_at": expires_at,
                        "expires_at_th": datetime.fromtimestamp(expires_at, tz_th).strftime("%Y-%m-%d %H:%M"),
                        "days_left": days_left,
                        "claimed_at_th": None,
                        "team_owner_username": owner_username,
                        "team_tier": tier_code,
                    }
                )

            source_rank = {"paid": 0, "team_member": 1, "manual": 2, "promo_free": 3}
            active_passes.sort(
                key=lambda item: (source_rank.get(item["source"], 4), -int(item["expires_at"]), int(item["user_id"]))
            )

        return {
            "generated_at_th": now_dt.strftime("%Y-%m-%d %H:%M:%S"),
            "users": {
                "total": total_users,
                "new_today": new_users_today,
                "google": oauth_map.get("google", 0),
                "discord": oauth_map.get("discord", 0),
                "password_only": password_only_users,
                "saved_draft_states": saved_draft_states,
                "active_sessions": active_sessions,
                "active_session_users": active_session_users,
                "signups_by_day": signups_by_day,
            },
            "survey": {
                "total": survey_total,
                "willing_total": willing_total,
                "willing_member": willing_member,
                "willing_guest": willing_guest,
                "not_willing_total": not_willing_total,
                "not_willing_member": not_willing_member,
                "not_willing_guest": not_willing_guest,
                "willing_pct": willing_pct,
                "recent": recent_votes,
            },
            "feedback": {
                "total": feedback_total,
                "today": feedback_today,
            },
            "billing": {
                "active_total": len(active_passes),
                "active_paid_users": active_paid_users,
                "active_promo_users": active_promo_users,
                "active_team_members": active_team_members,
                "active_manual_users": active_manual_users,
                "active_paid_by_tier": active_paid_by_tier,
                "active_by_tier": active_by_tier,
                "total_promo_claims": total_promo_claims,
                "total_paid_orders": total_paid_orders,
                "total_revenue_thb": total_revenue_thb,
                "active_passes": active_passes,
            },
            "retention": {
                "today_dau": today_dau,
                "today_new": today_new,
                "today_returning": today_returning,
                "total_tracked_clients": total_tracked_clients,
                "returning_clients": returning_clients,
                "returning_pct": returning_pct,
                "active_returning_7d": active_returning_7d,
                "active_returning_7d_pct": active_returning_7d_pct,
                "active_repeat_3plus_7d": active_repeat_3plus_7d,
                "active_returned_once_7d": active_returned_once_7d,
                "dormant_returning": dormant_returning,
                "d1_eligible": d1_eligible,
                "d1_retained": d1_retained,
                "d1_pct": d1_pct,
                "daily_breakdown": daily_breakdown,
            },
        }

    def record_user_usage(
        self,
        user_id: int,
        *,
        predict_delta: int = 0,
        draft_save_delta: int = 0,
    ) -> None:
        """Increment daily AI prediction and draft save counters for an authenticated user."""
        if predict_delta <= 0 and draft_save_delta <= 0:
            return
        self.ensure_schema()
        now = int(time.time())
        tz_th = timezone(timedelta(hours=7))
        today_str = datetime.fromtimestamp(now, tz_th).strftime("%Y-%m-%d")
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO user_usage_daily (user_id, usage_date, predict_count, draft_save_count, last_seen_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id, usage_date) DO UPDATE SET
                    predict_count = user_usage_daily.predict_count + excluded.predict_count,
                    draft_save_count = user_usage_daily.draft_save_count + excluded.draft_save_count,
                    last_seen_at = MAX(user_usage_daily.last_seen_at, excluded.last_seen_at)
                """,
                (user_id, today_str, max(0, int(predict_delta)), max(0, int(draft_save_delta)), now),
            )

    def get_admin_users_report(self) -> dict[str, Any]:
        """Return per-user activity leaderboard and top returning unlinked guest clients."""
        self.ensure_schema()
        now = int(time.time())
        tz_th = timezone(timedelta(hours=7))
        now_dt = datetime.fromtimestamp(now, tz_th)

        def _fmt_epoch(raw_val: int | None, is_ms: bool = False) -> str | None:
            if not raw_val or int(raw_val) <= 0:
                return None
            secs = int(raw_val) / 1000.0 if is_ms else int(raw_val)
            return datetime.fromtimestamp(secs, tz_th).strftime("%Y-%m-%d %H:%M:%S")

        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                WITH visit_agg AS (
                    SELECT
                        user_id,
                        COUNT(DISTINCT visit_date) AS active_days,
                        MIN(visit_date) AS first_visit,
                        MAX(visit_date) AS last_visit
                    FROM daily_visits
                    WHERE user_id IS NOT NULL
                    GROUP BY user_id
                ),
                usage_agg AS (
                    SELECT
                        user_id,
                        COALESCE(SUM(predict_count), 0) AS predict_calls,
                        COALESCE(SUM(draft_save_count), 0) AS draft_save_calls
                    FROM user_usage_daily
                    GROUP BY user_id
                ),
                session_agg AS (
                    SELECT
                        user_id,
                        COUNT(*) AS active_sessions
                    FROM auth_sessions
                    WHERE expires_at > ?
                    GROUP BY user_id
                ),
                oauth_agg AS (
                    SELECT
                        user_id,
                        MIN(provider) AS oauth_provider
                    FROM user_oauth_accounts
                    GROUP BY user_id
                ),
                paid_agg AS (
                    SELECT
                        user_id,
                        COUNT(*) AS paid_orders
                    FROM billing_orders
                    WHERE status = 'paid'
                    GROUP BY user_id
                ),
                promo_agg AS (
                    SELECT
                        user_id,
                        MAX(claimed_at) AS promo_claimed_at
                    FROM promo_claims
                    GROUP BY user_id
                ),
                team_mem_agg AS (
                    SELECT
                        tm.user_id,
                        tm.tier AS team_tier,
                        bp.expires_at AS team_expires_at,
                        owner.username AS team_owner_username
                    FROM team_memberships tm
                    JOIN billing_passes bp ON bp.user_id = tm.owner_id AND bp.tier = tm.tier AND bp.expires_at > ?
                    JOIN users owner ON owner.id = tm.owner_id
                )
                SELECT
                    u.id,
                    u.username,
                    u.display_name,
                    u.email,
                    u.created_at,
                    u.google_sub,
                    oa.oauth_provider,
                    COALESCE(va.active_days, 0) AS active_days,
                    va.first_visit,
                    va.last_visit,
                    COALESCE(json_array_length(json_extract(ds.payload_json, '$.seriesGames')), 0) AS saved_series_games,
                    COALESCE(CAST(json_extract(ds.payload_json, '$.stepIndex') AS INTEGER), 0) AS draft_step_index,
                    COALESCE(ds.updated_at, 0) AS draft_updated_at,
                    COALESCE(json_array_length(json_extract(ph.payload_json, '$.entries')), 0) AS practice_games,
                    COALESCE(ph.updated_at, 0) AS practice_updated_at,
                    COALESCE(ua.predict_calls, 0) AS predict_calls,
                    COALESCE(ua.draft_save_calls, 0) AS draft_save_calls,
                    COALESCE(sa.active_sessions, 0) AS active_sessions,
                    ps.choice AS survey_choice,
                    bp.tier AS pass_tier,
                    bp.expires_at AS pass_expires_at,
                    COALESCE(po.paid_orders, 0) AS paid_orders,
                    pr.promo_claimed_at AS promo_claimed_at,
                    tma.team_tier AS team_tier,
                    tma.team_expires_at AS team_expires_at,
                    tma.team_owner_username AS team_owner_username
                FROM users u
                LEFT JOIN visit_agg va ON va.user_id = u.id
                LEFT JOIN usage_agg ua ON ua.user_id = u.id
                LEFT JOIN session_agg sa ON sa.user_id = u.id
                LEFT JOIN oauth_agg oa ON oa.user_id = u.id
                LEFT JOIN user_draft_states ds ON ds.user_id = u.id
                LEFT JOIN user_practice_histories ph ON ph.user_id = u.id
                LEFT JOIN pricing_survey_responses ps ON ps.user_id = u.id
                LEFT JOIN billing_passes bp ON bp.user_id = u.id AND bp.expires_at > ?
                LEFT JOIN paid_agg po ON po.user_id = u.id
                LEFT JOIN promo_agg pr ON pr.user_id = u.id
                LEFT JOIN team_mem_agg tma ON tma.user_id = u.id
                ORDER BY
                    COALESCE(va.active_days, 0) DESC,
                    (COALESCE(json_array_length(json_extract(ds.payload_json, '$.seriesGames')), 0)
                     + COALESCE(json_array_length(json_extract(ph.payload_json, '$.entries')), 0)) DESC,
                    COALESCE(ua.predict_calls, 0) DESC,
                    u.id DESC
                """,
                (now, now, now),
            ).fetchall()

            guest_rows = conn.execute(
                """
                SELECT
                    client_id,
                    COUNT(*) AS active_days,
                    MIN(visit_date) AS first_visit,
                    MAX(visit_date) AS last_visit,
                    COALESCE(SUM(predict_count), 0) AS predict_calls,
                    MAX(device_type) AS device_type
                FROM daily_visits
                WHERE user_id IS NULL
                GROUP BY client_id
                ORDER BY active_days DESC, predict_calls DESC, last_visit DESC
                LIMIT 50
                """
            ).fetchall()

        users_list: list[dict[str, Any]] = []
        for r in rows:
            provider = str(r["oauth_provider"] or ("google" if r["google_sub"] else "password"))
            survey_val = str(r["survey_choice"]) if r["survey_choice"] in {"willing", "not_willing"} else None
            pass_tier = str(r["pass_tier"]) if r["pass_tier"] else None
            pass_expires_raw = int(r["pass_expires_at"]) if r["pass_expires_at"] else None
            team_owner_username = str(r["team_owner_username"]) if r["team_owner_username"] else None
            if pass_tier and pass_expires_raw:
                if int(r["paid_orders"] or 0) > 0:
                    pass_source = "paid"
                elif r["promo_claimed_at"]:
                    pass_source = "promo_free"
                else:
                    pass_source = "manual"
                pass_expires_at_th = datetime.fromtimestamp(pass_expires_raw, tz_th).strftime("%Y-%m-%d %H:%M")
                pass_days_left = max(0, (pass_expires_raw - now + 86399) // 86400)
                pass_team_owner = team_owner_username
            elif r["team_tier"] and r["team_expires_at"]:
                team_expires_raw = int(r["team_expires_at"])
                pass_tier = str(r["team_tier"])
                pass_source = "team_member"
                pass_expires_at_th = datetime.fromtimestamp(team_expires_raw, tz_th).strftime("%Y-%m-%d %H:%M")
                pass_days_left = max(0, (team_expires_raw - now + 86399) // 86400)
                pass_team_owner = team_owner_username
            else:
                pass_source = None
                pass_expires_at_th = None
                pass_days_left = None
                pass_team_owner = None
            users_list.append(
                {
                    "id": int(r["id"]),
                    "username": str(r["username"]),
                    "display_name": str(r["display_name"]),
                    "email": str(r["email"]) if r["email"] else None,
                    "auth_provider": provider,
                    "created_at_th": _fmt_epoch(int(r["created_at"])) or "",
                    "active_days": int(r["active_days"] or 0),
                    "first_visit": str(r["first_visit"]) if r["first_visit"] else None,
                    "last_visit": str(r["last_visit"]) if r["last_visit"] else None,
                    "saved_series_games": int(r["saved_series_games"] or 0),
                    "draft_step_index": int(r["draft_step_index"] or 0),
                    "last_draft_save_th": _fmt_epoch(int(r["draft_updated_at"] or 0), is_ms=True),
                    "practice_games": int(r["practice_games"] or 0),
                    "last_practice_save_th": _fmt_epoch(int(r["practice_updated_at"] or 0), is_ms=True),
                    "predict_calls": int(r["predict_calls"] or 0),
                    "draft_save_calls": int(r["draft_save_calls"] or 0),
                    "active_sessions": int(r["active_sessions"] or 0),
                    "survey_choice": survey_val,
                    "pass_tier": pass_tier,
                    "pass_source": pass_source,
                    "pass_expires_at_th": pass_expires_at_th,
                    "pass_days_left": pass_days_left,
                    "pass_team_owner": pass_team_owner,
                }
            )

        guests_list = [
            {
                "client_id": str(g["client_id"]),
                "active_days": int(g["active_days"] or 0),
                "first_visit": str(g["first_visit"]) if g["first_visit"] else None,
                "last_visit": str(g["last_visit"]) if g["last_visit"] else None,
                "predict_calls": int(g["predict_calls"] or 0),
                "device_type": str(g["device_type"]) if g["device_type"] else None,
            }
            for g in guest_rows
        ]

        return {
            "generated_at_th": now_dt.strftime("%Y-%m-%d %H:%M:%S"),
            "total_users": len(users_list),
            "users": users_list,
            "top_guest_clients": guests_list,
        }

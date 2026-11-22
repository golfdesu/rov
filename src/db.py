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
from typing import Any

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_.-]{3,32}$")
SESSION_COOKIE_NAME = "rov_session"
SESSION_TTL_SECONDS = 30 * 24 * 60 * 60  # 30 days (> 15-day open window)
MAX_USERS_DEFAULT = 2000
DISPLAY_NAME_FREE_CHANGES = 3
DISPLAY_NAME_COOLDOWN_SECONDS = 14 * 24 * 60 * 60


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
                    """
                )
                conn.execute("BEGIN IMMEDIATE")
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
                    ORDER BY u.created_at ASC
                    LIMIT 100
                )
                """,
                (stale_cutoff, now),
            )
            count_row = conn.execute("SELECT COUNT(*) AS cnt FROM users").fetchone()
        if count_row and int(count_row["cnt"]) >= self.max_users:
            raise RuntimeError("User registration limit reached on this server")

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

    def _save_user_json_state(self, table: str, user_id: int, payload: dict, updated_at: int) -> dict:
        if table not in self._USER_STATE_TABLES:
            raise ValueError(f"Unsupported user state table: {table}")
        encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False)
        self.ensure_schema()
        with self._lock, self._connect() as conn:
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

    def _clear_user_json_state(self, table: str, user_id: int) -> None:
        # Store an empty tombstone with current timestamp so stale offline clients cannot resurrect cleared state.
        tombstone_at = int(time.time() * 1000)
        self._save_user_json_state(table, user_id, {"updatedAt": tombstone_at}, tombstone_at)

    def get_user_draft_state(self, user_id: int) -> dict | None:
        return self._get_user_json_state("user_draft_states", user_id)

    def save_user_draft_state(self, user_id: int, payload: dict, updated_at: int) -> dict:
        return self._save_user_json_state("user_draft_states", user_id, payload, updated_at)

    def clear_user_draft_state(self, user_id: int) -> None:
        self._clear_user_json_state("user_draft_states", user_id)

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
            ret_row = conn.execute(
                """
                WITH client_stats AS (
                    SELECT
                        client_id,
                        MIN(visit_date) AS first_date,
                        COUNT(*) AS visit_days,
                        MAX(CASE WHEN visit_date = ? THEN 1 ELSE 0 END) AS visited_today
                    FROM daily_visits
                    GROUP BY client_id
                )
                SELECT
                    COUNT(*) AS total_tracked_clients,
                    COALESCE(SUM(CASE WHEN visit_days >= 2 THEN 1 ELSE 0 END), 0) AS returning_clients,
                    COALESCE(SUM(CASE WHEN visited_today = 1 AND first_date = ? THEN 1 ELSE 0 END), 0) AS today_new,
                    COALESCE(SUM(CASE WHEN visited_today = 1 AND first_date < ? THEN 1 ELSE 0 END), 0) AS today_returning,
                    COALESCE(SUM(CASE WHEN first_date < ? THEN 1 ELSE 0 END), 0) AS d1_eligible,
                    COALESCE(SUM(CASE WHEN first_date < ? AND visit_days >= 2 THEN 1 ELSE 0 END), 0) AS d1_retained
                FROM client_stats
                """,
                (today_str, today_str, today_str, today_str, today_str),
            ).fetchone()
            total_tracked_clients = int(ret_row["total_tracked_clients"] or 0)
            returning_clients = int(ret_row["returning_clients"] or 0)
            returning_pct = (
                round((returning_clients / total_tracked_clients) * 100.0, 1) if total_tracked_clients > 0 else 0.0
            )
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
            "retention": {
                "today_dau": today_dau,
                "today_new": today_new,
                "today_returning": today_returning,
                "total_tracked_clients": total_tracked_clients,
                "returning_clients": returning_clients,
                "returning_pct": returning_pct,
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
                    ps.choice AS survey_choice
                FROM users u
                LEFT JOIN visit_agg va ON va.user_id = u.id
                LEFT JOIN usage_agg ua ON ua.user_id = u.id
                LEFT JOIN session_agg sa ON sa.user_id = u.id
                LEFT JOIN oauth_agg oa ON oa.user_id = u.id
                LEFT JOIN user_draft_states ds ON ds.user_id = u.id
                LEFT JOIN user_practice_histories ph ON ph.user_id = u.id
                LEFT JOIN pricing_survey_responses ps ON ps.user_id = u.id
                ORDER BY
                    COALESCE(va.active_days, 0) DESC,
                    (COALESCE(json_array_length(json_extract(ds.payload_json, '$.seriesGames')), 0)
                     + COALESCE(json_array_length(json_extract(ph.payload_json, '$.entries')), 0)) DESC,
                    COALESCE(ua.predict_calls, 0) DESC,
                    u.id DESC
                """,
                (now,),
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

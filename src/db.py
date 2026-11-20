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
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_.-]{3,32}$")
SESSION_COOKIE_NAME = "rov_session"
SESSION_TTL_SECONDS = 30 * 24 * 60 * 60  # 30 days (> 15-day open window)
MAX_USERS_DEFAULT = 2000


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
                        email TEXT
                    );

                    CREATE TABLE IF NOT EXISTS auth_sessions (
                        token_hash TEXT PRIMARY KEY,
                        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        created_at INTEGER NOT NULL,
                        expires_at INTEGER NOT NULL
                    );

                    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires
                        ON auth_sessions(expires_at);

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
                    """
                )
                cols = {str(r["name"]) for r in conn.execute("PRAGMA table_info(users)").fetchall()}
                if "google_sub" not in cols:
                    conn.execute("ALTER TABLE users ADD COLUMN google_sub TEXT")
                if "email" not in cols:
                    conn.execute("ALTER TABLE users ADD COLUMN email TEXT")
                conn.execute(
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL"
                )
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
                SELECT u.id, u.username, u.display_name, u.created_at, u.email
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
                )

            if verified_email:
                email_row = conn.execute(
                    "SELECT id, username, display_name, created_at, email FROM users WHERE email = ?",
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
                "SELECT id, username, display_name, password_hash, created_at, google_sub, email "
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
                SELECT u.id, u.username, u.display_name, u.created_at, u.google_sub, u.email, s.expires_at,
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
            )

    def delete_session(self, token: str | None) -> None:
        if not token:
            return
        token_hash = hash_session_token(token)
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash,))

    def get_user_draft_state(self, user_id: int) -> dict | None:
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT payload_json FROM user_draft_states WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        if row is None:
            return None
        return _safe_json_loads(str(row["payload_json"]))

    def save_user_draft_state(self, user_id: int, payload: dict, updated_at: int) -> None:
        encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False)
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO user_draft_states (user_id, payload_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at
                WHERE excluded.updated_at >= user_draft_states.updated_at
                """,
                (user_id, encoded, updated_at),
            )

    def clear_user_draft_state(self, user_id: int) -> None:
        # Store an empty tombstone with current timestamp so stale offline clients cannot resurrect cleared state.
        tombstone_at = int(time.time() * 1000)
        self.save_user_draft_state(user_id, {"updatedAt": tombstone_at}, tombstone_at)

    def get_user_combat_builds(self, user_id: int) -> dict | None:
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT payload_json FROM user_combat_builds WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        if row is None:
            return None
        return _safe_json_loads(str(row["payload_json"]))

    def save_user_combat_builds(self, user_id: int, payload: dict, updated_at: int) -> None:
        encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False)
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO user_combat_builds (user_id, payload_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at
                WHERE excluded.updated_at >= user_combat_builds.updated_at
                """,
                (user_id, encoded, updated_at),
            )

    def clear_user_combat_builds(self, user_id: int) -> None:
        # Store an empty tombstone with current timestamp so stale offline clients cannot resurrect cleared builds.
        tombstone_at = int(time.time() * 1000)
        self.save_user_combat_builds(user_id, {"updatedAt": tombstone_at}, tombstone_at)

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
        visit_date_override: str | None = None,
    ) -> str:
        """Record at most one visit row per client_id per UTC+7 calendar day."""
        self.ensure_schema()
        now = int(time.time())
        tz_th = timezone(timedelta(hours=7))
        today_str = visit_date_override or datetime.fromtimestamp(now, tz_th).strftime("%Y-%m-%d")

        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT MIN(visit_date) AS first_seen FROM daily_visits WHERE client_id = ?",
                (client_id,),
            ).fetchone()
            existing_first = str(row["first_seen"]) if row and row["first_seen"] else None
            first_seen = min(existing_first, today_str) if existing_first else today_str
            conn.execute(
                """
                INSERT INTO daily_visits (client_id, visit_date, user_id, first_seen_date, created_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(client_id, visit_date) DO UPDATE SET
                    user_id = COALESCE(daily_visits.user_id, excluded.user_id)
                """,
                (client_id, today_str, user_id, first_seen, now),
            )
            conn.commit()
        return today_str

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
            visit_rows = conn.execute("SELECT client_id, visit_date FROM daily_visits").fetchall()
            client_days: dict[str, set[str]] = {}
            for r in visit_rows:
                cid = str(r["client_id"])
                vdate = str(r["visit_date"])
                client_days.setdefault(cid, set()).add(vdate)

            first_seen = {cid: min(days) for cid, days in client_days.items()}
            total_tracked_clients = len(client_days)
            returning_clients = sum(1 for days in client_days.values() if len(days) >= 2)
            returning_pct = (
                round((returning_clients / total_tracked_clients) * 100.0, 1) if total_tracked_clients > 0 else 0.0
            )
            today_new = sum(
                1 for cid, days in client_days.items() if today_str in days and first_seen[cid] == today_str
            )
            today_returning = sum(
                1 for cid, days in client_days.items() if today_str in days and first_seen[cid] < today_str
            )
            today_dau = today_new + today_returning
            d1_eligible = sum(1 for fs in first_seen.values() if fs < today_str)
            d1_retained = sum(
                1
                for cid, days in client_days.items()
                if first_seen[cid] < today_str and any(d > first_seen[cid] for d in days)
            )
            d1_pct = round((d1_retained / d1_eligible) * 100.0, 1) if d1_eligible > 0 else 0.0

            daily_map: dict[str, dict[str, int]] = {}
            for cid, days in client_days.items():
                fs = first_seen[cid]
                for d in days:
                    bucket = daily_map.setdefault(d, {"new": 0, "returning": 0, "total": 0})
                    if d == fs:
                        bucket["new"] += 1
                    else:
                        bucket["returning"] += 1
                    bucket["total"] += 1
            daily_breakdown = [
                {"date": d, "new": counts["new"], "returning": counts["returning"], "total": counts["total"]}
                for d, counts in sorted(daily_map.items(), reverse=True)[:7]
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

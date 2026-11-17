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
from collections import OrderedDict, deque
from dataclasses import dataclass
from pathlib import Path

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

    def _connect(self) -> sqlite3.Connection:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path, timeout=5.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

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
                """,
                (user_id, encoded, updated_at),
            )

    def clear_user_combat_builds(self, user_id: int) -> None:
        # Store an empty tombstone with current timestamp so stale offline clients cannot resurrect cleared builds.
        tombstone_at = int(time.time() * 1000)
        self.save_user_combat_builds(user_id, {"updatedAt": tombstone_at}, tombstone_at)

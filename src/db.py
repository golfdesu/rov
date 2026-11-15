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
from collections import defaultdict, deque
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


class RateLimiter:
    """Simple thread-safe sliding-window per-IP rate limiter for auth endpoints."""

    def __init__(self, max_attempts: int = 20, window_seconds: int = 60):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._lock = threading.Lock()
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check_and_record(self, key: str) -> bool:
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            q = self._hits[key]
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= self.max_attempts:
                return False
            q.append(now)
            return True


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
        conn.execute("PRAGMA journal_mode=WAL")
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
                conn.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        username TEXT NOT NULL UNIQUE,
                        display_name TEXT NOT NULL,
                        password_hash TEXT NOT NULL,
                        created_at INTEGER NOT NULL
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
                    """
                )
            self._initialized_path = self.db_path

    def register_user(self, username: str, password: str, display_name: str | None = None) -> AuthUser:
        norm = normalize_username(username)
        disp = (display_name or "").strip() or username.strip()
        if len(disp) > 40:
            raise ValueError("Display name must be at most 40 characters")
        pw_hash = hash_password(password)
        now = int(time.time())
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            count_row = conn.execute("SELECT COUNT(*) AS cnt FROM users").fetchone()
            if count_row and int(count_row["cnt"]) >= self.max_users:
                raise RuntimeError("User registration limit reached on this server")
            try:
                cur = conn.execute(
                    "INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)",
                    (norm, disp, pw_hash, now),
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError("Username is already taken") from exc
            return AuthUser(id=int(cur.lastrowid), username=norm, display_name=disp, created_at=now)

    def authenticate_user(self, username: str, password: str) -> AuthUser | None:
        try:
            norm = normalize_username(username)
        except ValueError:
            return None
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT id, username, display_name, password_hash, created_at FROM users WHERE username = ?",
                (norm,),
            ).fetchone()
        if row is None or not verify_password(password, str(row["password_hash"])):
            return None
        return AuthUser(
            id=int(row["id"]),
            username=str(row["username"]),
            display_name=str(row["display_name"]),
            created_at=int(row["created_at"]),
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
                SELECT u.id, u.username, u.display_name, u.created_at, s.expires_at
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
            return AuthUser(
                id=int(row["id"]),
                username=str(row["username"]),
                display_name=str(row["display_name"]),
                created_at=int(row["created_at"]),
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
        return json.loads(str(row["payload_json"]))

    def save_user_draft_state(self, user_id: int, payload: dict, updated_at: int) -> None:
        encoded = json.dumps(payload, ensure_ascii=False)
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
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM user_draft_states WHERE user_id = ?", (user_id,))

    def get_user_combat_builds(self, user_id: int) -> dict | None:
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT payload_json FROM user_combat_builds WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        if row is None:
            return None
        return json.loads(str(row["payload_json"]))

    def save_user_combat_builds(self, user_id: int, payload: dict, updated_at: int) -> None:
        encoded = json.dumps(payload, ensure_ascii=False)
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
        self.ensure_schema()
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM user_combat_builds WHERE user_id = ?", (user_id,))

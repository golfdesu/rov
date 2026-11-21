import base64
import hashlib
import hmac
import ipaddress
import json
import logging
import math
import posixpath
import re
import secrets
import threading
import time
import uuid
from pathlib import Path
from typing import Literal
from urllib.parse import urlencode, urlparse

import httpx
import pandas as pd
from fastapi import Cookie, Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from google.auth.transport import requests as google_auth_requests
from google.oauth2 import id_token as google_id_token

from src.combat_calculator import DEFAULT_ITEM_ALIASES, Build, get_engine
from src.config import config
from src.db import (
    SESSION_COOKIE_NAME,
    SESSION_TTL_SECONDS,
    AuthUser,
    DisplayNameCooldownError,
    RateLimiter,
    UserDatabase,
)
from src.predictor import RoVDraftPredictor
from src.schemas import (
    AdminStatsResponse,
    AuthLoginRequest,
    AuthProfileRequest,
    AuthRegisterRequest,
    AuthStatusResponse,
    AuthUserSchema,
    CombatBuildsSyncSchema,
    CombatCatalogResponse,
    CombatDuelRequest,
    CombatDuelResponse,
    CombatRuneRecommendationResponse,
    CombatStatsRequest,
    CombatStatsResponse,
    DailyVisitRequest,
    DailyVisitResponse,
    DraftPredictionResponse,
    DraftSessionStateSchema,
    DraftStateRequest,
    HealthResponse,
    PricingSurveyRequest,
    PricingSurveyResponse,
    _canon_hero_key,
)
from src.search.draft_mcts import DRAFT_STEPS

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
FRONTEND_DIST = config.resolve_frontend_dist()
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
HEROES_DIR = Path(__file__).resolve().parent.parent / "heroes"
ITEMS_DIR = Path(__file__).resolve().parent.parent / "item"
HERO_FOLDER_ALIASES = {
    "Mortos": "Arthur",
    "Celica": "Brunhilda",
    "Riktor": "Richter",
}
ITEM_FOLDER_ALIASES = {
    **DEFAULT_ITEM_ALIASES,
    **get_engine().item_aliases,
}
ITEM_FOLDER_ALIASES_LOWER = {k.lower(): v for k, v in ITEM_FOLDER_ALIASES.items()}

app = FastAPI(
    title="RoV SOTA Draft Intelligence API",
    description="Production-grade MOBA Draft Pick/Ban Recommendation & Win-Probability Serving Engine.",
    version="2.0.0",
    docs_url=None if config.is_production else "/docs",
    redoc_url=None if config.is_production else "/redoc",
    openapi_url=None if config.is_production else "/openapi.json",
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_request: Request, exc: RequestValidationError):
    safe_errors = jsonable_encoder(
        list(exc.errors()),
        custom_encoder={float: lambda v: str(v) if not math.isfinite(v) else v},
    )
    return JSONResponse(status_code=422, content={"detail": safe_errors})


app.add_middleware(
    CORSMiddleware,
    allow_origins=config.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Accept", "X-Expected-User"],
)

_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "X-Permitted-Cross-Domain-Policies": "none",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self' https://static.cloudflareinsights.com; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        "img-src 'self' data: blob:; "
        "connect-src 'self' https://cloudflareinsights.com; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none'"
    ),
}
_PROD_BLOCKED_PREFIXES = (
    "/docs/",
    "/redoc/",
    "/openapi.json/",
    "/heroes-media",
    "/items-media",
    "/items/",
    "/enchantments/",
    "/skills/",
)
_PROD_BLOCKED_EXACT = frozenset(
    {
        "/docs",
        "/redoc",
        "/openapi.json",
        "/dataset_metadata.json",
        "/items",
        "/enchantments",
        "/skills",
    }
)


_MAX_PROD_BODY_BYTES = 256 * 1024


class _MaxBodySizeMiddleware:
    """ASGI guard capping production request bodies across Content-Length and chunked streams."""

    def __init__(self, app_inner):
        self.app_inner = app_inner

    async def __call__(self, scope, receive, send) -> None:
        if (
            scope.get("type") != "http"
            or not config.is_production
            or scope.get("method") not in {"POST", "PUT", "PATCH"}
        ):
            await self.app_inner(scope, receive, send)
            return

        headers = {k.lower(): v for k, v in scope.get("headers", ())}
        raw_cl = headers.get(b"content-length")
        if raw_cl is not None:
            try:
                cl = int(raw_cl.decode("ascii").strip())
            except (UnicodeDecodeError, ValueError):
                resp = JSONResponse({"detail": "Invalid Content-Length"}, status_code=400, headers=_SECURITY_HEADERS)
                await resp(scope, receive, send)
                return
            if cl < 0:
                resp = JSONResponse({"detail": "Invalid Content-Length"}, status_code=400, headers=_SECURITY_HEADERS)
                await resp(scope, receive, send)
                return
            if cl > _MAX_PROD_BODY_BYTES:
                resp = JSONResponse({"detail": "Payload Too Large"}, status_code=413, headers=_SECURITY_HEADERS)
                await resp(scope, receive, send)
                return

        received_bytes = 0
        too_large = False
        sent_413 = False

        async def guarded_receive():
            nonlocal received_bytes, too_large
            if too_large:
                return {"type": "http.request", "body": b"", "more_body": False}
            message = await receive()
            if message.get("type") == "http.request":
                received_bytes += len(message.get("body", b""))
                if received_bytes > _MAX_PROD_BODY_BYTES:
                    too_large = True
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        async def tracked_send(message):
            nonlocal sent_413
            if too_large:
                if message.get("type") == "http.response.body" and not message.get("more_body", False) and not sent_413:
                    sent_413 = True
                    resp = JSONResponse({"detail": "Payload Too Large"}, status_code=413, headers=_SECURITY_HEADERS)
                    await resp(scope, receive, send)
                return
            await send(message)

        await self.app_inner(scope, guarded_receive, tracked_send)
        if too_large and not sent_413:
            sent_413 = True
            resp = JSONResponse({"detail": "Payload Too Large"}, status_code=413, headers=_SECURITY_HEADERS)
            await resp(scope, receive, send)


def _extract_origin(raw_url: str) -> str | None:
    try:
        parsed = urlparse(raw_url.strip())
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


def _is_same_or_allowed_origin(request: Request, candidate_origin: str) -> bool:
    allowed = {o.rstrip("/").lower() for o in config.cors_origins}
    host = (request.headers.get("host") or request.url.netloc or "").strip().lower()
    if host:
        scheme = "https" if _is_https_request(request) else request.url.scheme.lower()
        allowed.add(f"{scheme}://{host}")
        allowed.add(f"{request.url.scheme.lower()}://{host}")
    return candidate_origin.rstrip("/").lower() in allowed


def _normalize_request_path(raw_path: str) -> str:
    cleaned = (raw_path or "/").replace("\\", "/")
    collapsed = re.sub(r"/+", "/", cleaned)
    norm = posixpath.normpath(collapsed)
    if not norm.startswith("/"):
        norm = "/" + norm
    return norm.lower()


@app.middleware("http")
async def security_and_lockdown_middleware(request: Request, call_next):
    norm_path = _normalize_request_path(request.url.path)
    if config.is_production and (norm_path in _PROD_BLOCKED_EXACT or norm_path.startswith(_PROD_BLOCKED_PREFIXES)):
        return JSONResponse({"detail": "Not Found"}, status_code=404, headers=_SECURITY_HEADERS)
    if config.is_production and request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        origin_hdr = request.headers.get("origin", "").strip()
        if origin_hdr:
            origin_val = _extract_origin(origin_hdr)
            if origin_val is None or not _is_same_or_allowed_origin(request, origin_val):
                return JSONResponse({"detail": "Forbidden origin"}, status_code=403, headers=_SECURITY_HEADERS)
        elif SESSION_COOKIE_NAME in request.cookies:
            referer_hdr = request.headers.get("referer", "").strip()
            if referer_hdr:
                ref_origin = _extract_origin(referer_hdr)
                if ref_origin is None or not _is_same_or_allowed_origin(request, ref_origin):
                    return JSONResponse({"detail": "Forbidden referer"}, status_code=403, headers=_SECURITY_HEADERS)
    response = await call_next(request)
    for k, v in _SECURITY_HEADERS.items():
        if k == "Content-Security-Policy" and not config.is_production:
            v = v.replace(
                "img-src 'self' data: blob:;",
                "img-src 'self' https://cdngarenanow-a.akamaihd.net data: blob:;",
            )
        response.headers.setdefault(k, v)
    if config.is_production and _is_https_request(request):
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    if norm_path.startswith(
        ("/health", "/heroes", "/auth/", "/draft/session", "/predict", "/combat/", "/survey/", "/admin/")
    ):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


app.add_middleware(_MaxBodySizeMiddleware)


predictor = RoVDraftPredictor()


logger = logging.getLogger(__name__)

# Precompute rich hero metadata catalog
hero_summary_path = DATA_DIR / "heroes_130_summary.csv"
hero_draft_stats_path = DATA_DIR / "hero_draft_stats.csv"
hero_images_path = FRONTEND_DIR / "public" / "hero_images.json"
hero_tier_stats_path = (
    DATA_DIR.parent / "exports" / "RoV_Pro_Draft_Intelligence_2026" / "raw_csv" / "hero_tier_stats_2026.csv"
)
hero_tier_overrides_path = getattr(config.paths, "hero_tier_overrides_path", DATA_DIR / "hero_tier_overrides.json")

hero_details_cache: list[dict] = []
try:
    summary_df = pd.read_csv(hero_summary_path).set_index("name") if hero_summary_path.exists() else None
    draft_stats_df = pd.read_csv(hero_draft_stats_path).set_index("name") if hero_draft_stats_path.exists() else None
    tier_stats_df = pd.read_csv(hero_tier_stats_path).set_index("Hero") if hero_tier_stats_path.exists() else None
    images_dict = json.loads(hero_images_path.read_text(encoding="utf-8")) if hero_images_path.exists() else {}

    tier_overrides: dict[str, str] = {}
    tier_reasons: dict[str, str] = {}
    if hero_tier_overrides_path.exists():
        try:
            raw_overrides = json.loads(hero_tier_overrides_path.read_text(encoding="utf-8"))
            for k, v in raw_overrides.get("overrides", {}).items():
                tier_overrides[k] = v["tier"] if isinstance(v, dict) and "tier" in v else str(v)
                if isinstance(v, dict) and "reason" in v:
                    tier_reasons[k] = str(v["reason"])
        except Exception:
            logger.exception("Failed to parse hero_tier_overrides.json")
            tier_overrides = {}
            tier_reasons = {}

    canonical_to_legacy = {"Mortos": "Arthur", "Celica": "Brunhilda", "Riktor": "Richter"}
    legacy_to_canonical = {"Arthur": "Mortos", "Brunhilda": "Celica", "Richter": "Riktor"}
    role_fallback = {
        "Fighter": "DS_Lane",
        "Warrior": "DS_Lane",
        "Assassin": "Jungle",
        "Mage": "Mid",
        "Carry": "Dragon_Lane",
        "Marksman": "Dragon_Lane",
        "Support": "Roam",
        "Tank": "Roam",
    }

    def normalize_role(r: str) -> str:
        aliases = {"Warrior": "Fighter", "Marksman": "Carry"}
        return aliases.get(r, r)

    lane_cols = [
        ("DS_Lane", "DS_Lane_Share"),
        ("Jungle", "Jungle_Share"),
        ("Mid", "Mid_Share"),
        ("Dragon_Lane", "Dragon_Lane_Share"),
        ("Roam", "Roam_Share"),
    ]
    draft_lane_cols = [
        ("DS_Lane", "ds_lane_picks"),
        ("Jungle", "jungle_picks"),
        ("Mid", "mid_picks"),
        ("Dragon_Lane", "dragon_lane_picks"),
        ("Roam", "roam_picks"),
    ]

    for i, name in enumerate(predictor.hero_names):
        lookup_name = legacy_to_canonical.get(name, name)
        role = "Fighter"
        tier = "C"
        rank = 999
        main_pro_lane = "DS_Lane"
        lane = "DS_Lane"
        presence_rate = 0.0
        pick_rate = 0.0
        ban_rate = 0.0
        win_rate = 50.0
        total_picks = 0
        total_bans = 0

        if tier_stats_df is not None and lookup_name in tier_stats_df.index:
            t_row = tier_stats_df.loc[lookup_name]
            if isinstance(t_row, pd.DataFrame):
                t_row = t_row.iloc[0]
            rank = int(t_row["Rank"]) if pd.notna(t_row.get("Rank")) else 999
            tier = str(t_row["Tier_2026"]) if pd.notna(t_row.get("Tier_2026")) else "C"
            role = normalize_role(str(t_row["Primary_Role"])) if pd.notna(t_row.get("Primary_Role")) else "Fighter"
            main_pro_lane = str(t_row["Main_Pro_Lane"]) if pd.notna(t_row.get("Main_Pro_Lane")) else "Unpicked"
            presence_col = (
                "Presence_Rate"
                if pd.notna(t_row.get("Presence_Rate"))
                else ("Annual_Presence" if pd.notna(t_row.get("Annual_Presence")) else None)
            )
            if presence_col is not None:
                presence_rate = round(float(t_row[presence_col]) * 100, 1)
            if pd.notna(t_row.get("Pick_Rate")):
                pick_rate = round(float(t_row["Pick_Rate"]) * 100, 1)
            if pd.notna(t_row.get("Ban_Rate")):
                ban_rate = round(float(t_row["Ban_Rate"]) * 100, 1)
            if pd.notna(t_row.get("Win_Rate")):
                win_rate = round(float(t_row["Win_Rate"]) * 100, 1)
            if pd.notna(t_row.get("Total_Picks")):
                total_picks = int(t_row["Total_Picks"])
            if pd.notna(t_row.get("Total_Bans")):
                total_bans = int(t_row["Total_Bans"])

            if main_pro_lane == "Unpicked":
                lane = role_fallback.get(role, "DS_Lane")
            else:
                active_lanes = [main_pro_lane]
                for lname, col in lane_cols:
                    if lname != main_pro_lane and pd.notna(t_row.get(col)) and float(t_row[col]) >= 0.15:
                        active_lanes.append(lname)
                lane = ", ".join(active_lanes)
        elif summary_df is not None and lookup_name in summary_df.index:
            row = summary_df.loc[lookup_name]
            if isinstance(row, pd.DataFrame):
                row = row.iloc[0]
            role = normalize_role(str(row["primary_role"])) if pd.notna(row.get("primary_role")) else "Fighter"
            tier = str(row["meta_tier_2026"]) if pd.notna(row.get("meta_tier_2026")) else "C"
            lane = role_fallback.get(role, "DS_Lane")
            main_pro_lane = lane
            if pd.notna(row.get("pro_win_rate_2026")):
                win_rate = round(float(row["pro_win_rate_2026"]), 1)
            if pd.notna(row.get("pro_pick_rate_2026")):
                pick_rate = round(float(row["pro_pick_rate_2026"]), 1)
            if pd.notna(row.get("pro_ban_rate_2026")):
                ban_rate = round(float(row["pro_ban_rate_2026"]), 1)
            presence_rate = round(pick_rate + ban_rate, 1)

            if draft_stats_df is not None and lookup_name in draft_stats_df.index:
                d_row = draft_stats_df.loc[lookup_name]
                if isinstance(d_row, pd.DataFrame):
                    d_row = d_row.iloc[0]
                if pd.notna(d_row.get("picks")):
                    total_picks = int(d_row["picks"])
                b1 = int(d_row["bans_phase1"]) if pd.notna(d_row.get("bans_phase1")) else 0
                b2 = int(d_row["bans_phase2"]) if pd.notna(d_row.get("bans_phase2")) else 0
                total_bans = b1 + b2
                if pd.notna(d_row.get("main_pro_lane")) and str(d_row["main_pro_lane"]) != "Unpicked":
                    main_pro_lane = str(d_row["main_pro_lane"])
                    lane_totals = [float(d_row[col]) if pd.notna(d_row.get(col)) else 0.0 for _, col in draft_lane_cols]
                    sum_lanes = sum(lane_totals)
                    active_lanes = [main_pro_lane]
                    if sum_lanes > 0:
                        for (lname, _), val in zip(draft_lane_cols, lane_totals):
                            if lname != main_pro_lane and (val / sum_lanes) >= 0.15:
                                active_lanes.append(lname)
                    lane = ", ".join(active_lanes)

        if name in tier_overrides:
            tier = tier_overrides[name]
        elif lookup_name in tier_overrides:
            tier = tier_overrides[lookup_name]

        tier_reason = tier_reasons.get(name) or tier_reasons.get(lookup_name) or ""

        img_url = (
            images_dict.get(name)
            or images_dict.get(legacy_to_canonical.get(name, ""))
            or images_dict.get(canonical_to_legacy.get(name, ""))
        )
        hero_details_cache.append(
            {
                "id": i,
                "name": name,
                "role": role,
                "lane": lane,
                "main_pro_lane": main_pro_lane,
                "tier": tier,
                "rank": rank,
                "presence_rate": presence_rate,
                "win_rate": win_rate,
                "pick_rate": pick_rate,
                "ban_rate": ban_rate,
                "total_picks": total_picks,
                "total_bans": total_bans,
                "tier_reason": tier_reason,
                "image_url": img_url,
            }
        )

    # Assign fallback 1..N presence ranks when exports CSV is absent (e.g. inside Docker container)
    if hero_details_cache and all(h["rank"] == 999 for h in hero_details_cache):
        sorted_by_presence = sorted(
            hero_details_cache,
            key=lambda h: (-h["presence_rate"], -h["pick_rate"], h["name"]),
        )
        for idx, h_entry in enumerate(sorted_by_presence, start=1):
            h_entry["rank"] = idx
except Exception:
    logger.exception("Failed to initialize hero_details_cache; falling back to default catalog")
    hero_details_cache = [
        {"id": i, "name": name, "role": "Fighter", "lane": "DS_Lane", "tier": "A"}
        for i, name in enumerate(predictor.hero_names)
    ]


_PUBLIC_HERO_KEYS = ("id", "name", "role", "lane", "main_pro_lane", "tier", "image_url")
public_hero_details_cache = [{k: h[k] for k in _PUBLIC_HERO_KEYS if k in h} for h in hero_details_cache]

dataset_metadata_path = DATA_DIR / "dataset_metadata.json"


def get_dataset_metadata() -> dict | None:
    if dataset_metadata_path.exists():
        try:
            return json.loads(dataset_metadata_path.read_text(encoding="utf-8"))
        except Exception:
            logger.exception("Failed to load dataset_metadata.json")
    return None


_session_lock = threading.Lock()
_db_lock = threading.Lock()
_user_db: UserDatabase | None = None
_auth_rate_limiter = RateLimiter(max_attempts=20, window_seconds=60)
_login_user_limiter = RateLimiter(max_attempts=10, window_seconds=300)
_account_login_limiter = RateLimiter(max_attempts=20, window_seconds=300)
_global_reg_limiter = RateLimiter(max_attempts=40, window_seconds=3600)
_predict_rate_limiter = RateLimiter(max_attempts=120, window_seconds=60)
_survey_rate_limiter = RateLimiter(max_attempts=10, window_seconds=60)
_scrypt_semaphore = threading.BoundedSemaphore(4)


def get_user_db() -> UserDatabase:
    global _user_db
    target_path = config.paths.app_db_path
    with _db_lock:
        if _user_db is None or _user_db.db_path != target_path:
            _user_db = UserDatabase(target_path)
            _user_db.ensure_schema()
        return _user_db


def _is_trusted_proxy(host: str | None) -> bool:
    if not host:
        return False
    raw = host.strip().lower()
    trusted = getattr(config, "trusted_proxies", ("loopback",))
    if raw == "localhost":
        return "loopback" in trusted or "localhost" in trusted or "127.0.0.1" in trusted
    try:
        ip = ipaddress.ip_address(raw)
    except ValueError:
        return False
    for rule in trusted:
        if rule == "loopback" and ip.is_loopback:
            return True
        if rule == "private" and (ip.is_loopback or ip.is_private):
            return True
        try:
            if "/" in rule:
                if ip in ipaddress.ip_network(rule, strict=False):
                    return True
            elif ip == ipaddress.ip_address(rule):
                return True
        except ValueError:
            continue
    return False


def _parse_valid_ip(raw: str) -> str | None:
    candidate = raw.strip()
    if not candidate:
        return None
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return None


def _client_ip(request: Request) -> str:
    peer = request.client.host if request.client else ""
    if _is_trusted_proxy(peer):
        cf_ip = request.headers.get("cf-connecting-ip", "").strip()
        if cf_ip:
            valid_cf = _parse_valid_ip(cf_ip.split(",")[0])
            if valid_cf:
                return valid_cf
        xff = request.headers.get("x-forwarded-for", "").strip()
        if xff:
            parts = [p.strip() for p in xff.split(",") if p.strip()]
            for candidate in reversed(parts):
                valid_ip = _parse_valid_ip(candidate)
                if valid_ip and not _is_trusted_proxy(valid_ip):
                    return valid_ip
            for candidate in reversed(parts):
                valid_ip = _parse_valid_ip(candidate)
                if valid_ip:
                    return valid_ip
    return peer or "unknown"


def _is_https_request(request: Request) -> bool:
    if request.url.scheme == "https":
        return True
    peer = request.client.host if request.client else ""
    if _is_trusted_proxy(peer):
        proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
        if proto == "https":
            return True
    if config.is_production:
        host = (request.url.hostname or request.headers.get("host", "")).split(":")[0].strip().lower()
        if host and host not in {"127.0.0.1", "localhost", "testserver"}:
            return True
    return False


def _set_session_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=_is_https_request(request),
        path="/",
    )


def _clear_session_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        samesite="lax",
        secure=_is_https_request(request),
        path="/",
    )


def _to_user_schema(user: AuthUser) -> AuthUserSchema:
    return AuthUserSchema(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        email=user.email,
        auth_provider=user.auth_provider,  # type: ignore[arg-type]
        display_name_is_custom=user.display_name_is_custom,
        display_label=user.display_label,
        display_name_changes_remaining=user.display_name_changes_remaining,
        display_name_next_change_at=user.display_name_next_change_at,
    )


def get_optional_user(
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> AuthUser | None:
    if not session_token:
        return None
    return get_user_db().get_user_by_token(session_token)


def get_required_user(user: AuthUser | None = Depends(get_optional_user)) -> AuthUser:
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


def require_development() -> None:
    if config.is_production:
        raise HTTPException(status_code=404, detail="Not Found")


@app.get("/health", response_model=HealthResponse, response_model_exclude_none=True)
def health_check():
    if config.is_production:
        return HealthResponse(
            status="healthy",
            model_loaded=predictor.model is not None,
        )
    return HealthResponse(
        status="healthy",
        model_loaded=predictor.model is not None,
        architecture=predictor.architecture,
        num_heroes=len(predictor.hero_names),
        val_loss=round(predictor.val_loss, 5),
        dataset_metadata=get_dataset_metadata(),
    )


@app.get("/heroes")
def list_heroes():
    details = public_hero_details_cache if config.is_production else hero_details_cache
    return {
        "count": len(predictor.hero_names),
        "heroes": predictor.hero_names,
        "hero_details": details,
    }


@app.get("/draft/steps")
def get_draft_steps():
    return {
        "steps": [
            {
                "step": s[0],
                "phase": s[1],
                "action": "pick" if s[2] == 1 else "ban",
                "side": "blue" if s[3] == 0 else "red",
            }
            for s in DRAFT_STEPS
        ]
    }


_OAUTH_STATE_COOKIE_NAME = "rov_oauth_state"
_OAUTH_STATE_TTL_SECONDS = 600


def _oauth_secret_for(provider: str) -> str:
    return config.discord_client_secret if provider == "discord" else config.google_client_secret


def _sign_oauth_state(provider: str, payload: dict[str, object]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    b64 = base64.urlsafe_b64encode(raw).decode("ascii")
    secret = _oauth_secret_for(provider).encode("utf-8")
    sig = hmac.new(secret, b64.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{b64}.{sig}"


def _verify_oauth_state(provider: str, token: str | None) -> dict[str, object] | None:
    if not token or "." not in token:
        return None
    b64, _, sig = token.partition(".")
    secret = _oauth_secret_for(provider).encode("utf-8")
    expected = hmac.new(secret, b64.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        padded = b64 + "=" * (-len(b64) % 4)
        parsed = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
    except Exception:
        return None
    if (
        not isinstance(parsed, dict)
        or parsed.get("provider") != provider
        or int(parsed.get("exp") or 0) <= int(time.time())
    ):
        return None
    return parsed


def _resolve_oauth_redirect_uri(request: Request, provider: str, explicit_uri: str, route_name: str) -> str:
    if explicit_uri:
        return explicit_uri
    host = (request.headers.get("host") or request.url.netloc or "").strip()
    if host:
        scheme = "https" if _is_https_request(request) else request.url.scheme
        candidate = f"{scheme}://{host}"
        if _is_same_or_allowed_origin(request, candidate) or not config.is_production:
            return f"{candidate}/auth/{provider}/callback"
    return str(request.url_for(route_name))


def _auth_status_response(user: AuthUser | None) -> AuthStatusResponse:
    survey_choice = get_user_db().get_pricing_survey_choice(user.id) if user is not None else None
    return AuthStatusResponse(
        authenticated=user is not None,
        user=_to_user_schema(user) if user is not None else None,
        google_login_enabled=config.google_oauth_enabled,
        discord_login_enabled=config.discord_oauth_enabled,
        pricing_survey_answered=survey_choice is not None,
        pricing_survey_choice=survey_choice,  # type: ignore[arg-type]
        is_admin=config.is_admin_username(user.username) if user is not None else False,
    )


def _start_oauth_login(
    request: Request,
    provider: str,
    authorize_url: str,
    client_id: str,
    redirect_uri: str,
    scope: str,
    extra_params: dict[str, str] | None = None,
) -> RedirectResponse:
    client_ip = _client_ip(request)
    if not _auth_rate_limiter.check_and_record(f"oauth:{provider}:{client_ip}"):
        raise HTTPException(status_code=429, detail="Too many login attempts, please try again in a minute")

    state = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")
    query_params: dict[str, str] = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": scope,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    if extra_params:
        query_params.update(extra_params)

    resp = RedirectResponse(url=f"{authorize_url}?{urlencode(query_params)}", status_code=302)
    signed_state = _sign_oauth_state(
        provider,
        {
            "provider": provider,
            "state": state,
            "verifier": verifier,
            "exp": int(time.time()) + _OAUTH_STATE_TTL_SECONDS,
        },
    )
    resp.set_cookie(
        key=_OAUTH_STATE_COOKIE_NAME,
        value=signed_state,
        max_age=_OAUTH_STATE_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=_is_https_request(request),
        path=f"/auth/{provider}",
    )
    return resp


def _oauth_error_redirect(request: Request, provider: str, reason: str) -> RedirectResponse:
    resp = RedirectResponse(url=f"/?auth_error={reason}", status_code=302)
    resp.delete_cookie(
        key=_OAUTH_STATE_COOKIE_NAME,
        httponly=True,
        samesite="lax",
        secure=_is_https_request(request),
        path=f"/auth/{provider}",
    )
    return resp


def _oauth_success_redirect(request: Request, provider: str, session_token: str) -> RedirectResponse:
    resp = RedirectResponse(url="/", status_code=302)
    _set_session_cookie(resp, request, session_token)
    resp.delete_cookie(
        key=_OAUTH_STATE_COOKIE_NAME,
        httponly=True,
        samesite="lax",
        secure=_is_https_request(request),
        path=f"/auth/{provider}",
    )
    return resp


def _read_public_text_asset(filename: str) -> str | None:
    """Read a static public text file from built dist first, falling back to frontend/public."""
    for candidate in (FRONTEND_DIST / filename, FRONTEND_DIR / "public" / filename):
        if candidate.is_file():
            return candidate.read_text(encoding="utf-8")
    return None


@app.get("/privacy", response_class=HTMLResponse)
def privacy_policy():
    content = _read_public_text_asset("privacy.html")
    if content is not None:
        return HTMLResponse(content=content, status_code=200)
    raise HTTPException(status_code=404, detail="Privacy policy page not found")


@app.get("/robots.txt", response_class=PlainTextResponse)
def robots_txt():
    content = _read_public_text_asset("robots.txt")
    if content is not None:
        return PlainTextResponse(content=content, status_code=200)
    raise HTTPException(status_code=404, detail="robots.txt not found")


@app.get("/sitemap.xml")
def sitemap_xml():
    content = _read_public_text_asset("sitemap.xml")
    if content is not None:
        return Response(content=content, media_type="application/xml; charset=utf-8", status_code=200)
    raise HTTPException(status_code=404, detail="sitemap.xml not found")


@app.get("/auth/me", response_model=AuthStatusResponse)
def auth_me(user: AuthUser | None = Depends(get_optional_user)):
    return _auth_status_response(user)


@app.put("/auth/profile", response_model=AuthStatusResponse)
def auth_update_profile(
    payload: AuthProfileRequest,
    user: AuthUser | None = Depends(get_optional_user),
) -> AuthStatusResponse:
    if user is None:
        raise HTTPException(status_code=401, detail="Session expired or logged out")
    if user.id != payload.user_id:
        raise HTTPException(status_code=409, detail="Active account changed in another session")
    try:
        updated = get_user_db().update_display_name(user, payload.display_name)
    except DisplayNameCooldownError as exc:
        raise HTTPException(
            status_code=429,
            detail={"code": "display_name_cooldown", "available_at": exc.available_at},
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
    if updated is None:
        raise HTTPException(status_code=401, detail="Account no longer exists")
    return _auth_status_response(updated)


@app.post("/auth/register", response_model=AuthStatusResponse, status_code=201)
def auth_register(payload: AuthRegisterRequest, request: Request, response: Response):
    client_ip = _client_ip(request)
    if not _auth_rate_limiter.check_and_record(f"reg:{client_ip}"):
        raise HTTPException(status_code=429, detail="Too many attempts, please try again in a minute")
    if config.is_production and not _global_reg_limiter.check_allowed("global:reg"):
        raise HTTPException(status_code=503, detail="Registration is temporarily unavailable, please try again later")
    db = get_user_db()
    if not _scrypt_semaphore.acquire(timeout=2.0):
        raise HTTPException(status_code=503, detail="Authentication service busy, please try again shortly")
    try:
        user = db.register_user(
            payload.username,
            payload.password,
            payload.display_name,
        )
    except ValueError as exc:
        status = 409 if "already taken" in str(exc).lower() else 400
        raise HTTPException(status_code=status, detail=str(exc)) from exc
    except RuntimeError as exc:
        detail = "Registration is temporarily unavailable" if config.is_production else str(exc)
        raise HTTPException(status_code=503, detail=detail) from exc
    finally:
        _scrypt_semaphore.release()
    if config.is_production:
        _global_reg_limiter.check_and_record("global:reg")
    token = db.create_session(user.id)
    _set_session_cookie(response, request, token)
    return _auth_status_response(user)


@app.post("/auth/login", response_model=AuthStatusResponse)
def auth_login(payload: AuthLoginRequest, request: Request, response: Response):
    client_ip = _client_ip(request)
    norm_user = payload.username.strip().lower()
    if not _auth_rate_limiter.check_and_record(f"login:{client_ip}"):
        raise HTTPException(status_code=429, detail="Too many login attempts, please try again in a minute")
    login_pair_key = f"pair:{client_ip}:{norm_user}"
    account_key = f"acct:{norm_user}"
    if config.is_production and (
        not _login_user_limiter.check_allowed(login_pair_key) or not _account_login_limiter.check_allowed(account_key)
    ):
        raise HTTPException(status_code=429, detail="Too many failed login attempts, please wait a few minutes")
    db = get_user_db()
    if not _scrypt_semaphore.acquire(timeout=2.0):
        raise HTTPException(status_code=503, detail="Authentication service busy, please try again shortly")
    try:
        user = db.authenticate_user(payload.username, payload.password)
    finally:
        _scrypt_semaphore.release()
    if user is None:
        if config.is_production:
            _login_user_limiter.check_and_record(login_pair_key)
            _account_login_limiter.check_and_record(account_key)
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = db.create_session(user.id)
    _set_session_cookie(response, request, token)
    return _auth_status_response(user)


@app.get("/auth/google/login")
def auth_google_login(request: Request):
    if not config.google_oauth_enabled:
        raise HTTPException(status_code=503, detail="Google login is not configured")
    redirect_uri = _resolve_oauth_redirect_uri(request, "google", config.google_redirect_uri, "auth_google_callback")
    return _start_oauth_login(
        request,
        "google",
        "https://accounts.google.com/o/oauth2/v2/auth",
        config.google_client_id,
        redirect_uri,
        "openid email profile",
        extra_params={"prompt": "select_account"},
    )


@app.get("/auth/google/callback", name="auth_google_callback")
def auth_google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    oauth_cookie: str | None = Cookie(default=None, alias=_OAUTH_STATE_COOKIE_NAME),
):
    if not config.google_oauth_enabled:
        return _oauth_error_redirect(request, "google", "google_unavailable")
    if error:
        return _oauth_error_redirect(
            request, "google", "google_cancelled" if error == "access_denied" else "google_failed"
        )
    if not _auth_rate_limiter.check_and_record(f"gcb:{_client_ip(request)}"):
        return _oauth_error_redirect(request, "google", "rate_limited")

    stored = _verify_oauth_state("google", oauth_cookie)
    if not stored or not code or not state or not hmac.compare_digest(str(stored.get("state") or ""), state):
        return _oauth_error_redirect(request, "google", "invalid_state")

    verifier = str(stored.get("verifier") or "")
    redirect_uri = _resolve_oauth_redirect_uri(request, "google", config.google_redirect_uri, "auth_google_callback")
    try:
        token_resp = httpx.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": config.google_client_id,
                "client_secret": config.google_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
                "code_verifier": verifier,
            },
            timeout=10.0,
        )
        token_data = token_resp.json()
        raw_id_token = str(token_data.get("id_token") or "")
        if token_resp.status_code >= 400 or not raw_id_token:
            return _oauth_error_redirect(request, "google", "google_failed")

        id_info = google_id_token.verify_oauth2_token(
            raw_id_token,
            google_auth_requests.Request(),
            config.google_client_id,
            clock_skew_in_seconds=60,
        )
        if id_info.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}:
            return _oauth_error_redirect(request, "google", "google_failed")
        if id_info.get("email_verified") is not True:
            return _oauth_error_redirect(request, "google", "email_unverified")

        sub = str(id_info.get("sub") or "")
        email = str(id_info.get("email") or "")
        display_name = str(id_info.get("name") or "")
        db = get_user_db()
        user = db.upsert_google_user(sub, email, display_name)
        session_token = db.create_session(user.id)
    except RuntimeError:
        return _oauth_error_redirect(request, "google", "registration_full")
    except Exception:
        logging.getLogger(__name__).exception("Google OAuth callback error")
        return _oauth_error_redirect(request, "google", "google_failed")

    return _oauth_success_redirect(request, "google", session_token)


@app.get("/auth/discord/login")
def auth_discord_login(request: Request):
    if not config.discord_oauth_enabled:
        raise HTTPException(status_code=503, detail="Discord login is not configured")
    redirect_uri = _resolve_oauth_redirect_uri(request, "discord", config.discord_redirect_uri, "auth_discord_callback")
    return _start_oauth_login(
        request,
        "discord",
        "https://discord.com/oauth2/authorize",
        config.discord_client_id,
        redirect_uri,
        "identify email",
    )


@app.get("/auth/discord/callback", name="auth_discord_callback")
def auth_discord_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    oauth_cookie: str | None = Cookie(default=None, alias=_OAUTH_STATE_COOKIE_NAME),
):
    if not config.discord_oauth_enabled:
        return _oauth_error_redirect(request, "discord", "discord_unavailable")
    if error:
        return _oauth_error_redirect(
            request, "discord", "discord_cancelled" if error == "access_denied" else "discord_failed"
        )
    if not _auth_rate_limiter.check_and_record(f"dcb:{_client_ip(request)}"):
        return _oauth_error_redirect(request, "discord", "rate_limited")

    stored = _verify_oauth_state("discord", oauth_cookie)
    if not stored or not code or not state or not hmac.compare_digest(str(stored.get("state") or ""), state):
        return _oauth_error_redirect(request, "discord", "discord_invalid_state")

    verifier = str(stored.get("verifier") or "")
    redirect_uri = _resolve_oauth_redirect_uri(request, "discord", config.discord_redirect_uri, "auth_discord_callback")
    try:
        token_resp = httpx.post(
            "https://discord.com/api/oauth2/token",
            data={
                "client_id": config.discord_client_id,
                "client_secret": config.discord_client_secret,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "code_verifier": verifier,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10.0,
        )
        token_data = token_resp.json()
        access_token = str(token_data.get("access_token") or "")
        if token_resp.status_code >= 400 or not access_token:
            return _oauth_error_redirect(request, "discord", "discord_failed")

        profile_resp = httpx.get(
            "https://discord.com/api/users/@me",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10.0,
        )
        profile = profile_resp.json()
        if profile_resp.status_code >= 400 or not isinstance(profile, dict) or not profile.get("id"):
            return _oauth_error_redirect(request, "discord", "discord_failed")

        discord_id = str(profile["id"])
        discord_username = str(profile.get("username") or "")
        display_name = str(profile.get("global_name") or discord_username or "")
        email = str(profile.get("email") or "") or None
        email_verified = bool(profile.get("verified"))
        db = get_user_db()
        user = db.upsert_oauth_user(
            "discord",
            discord_id,
            email=email,
            preferred_username=discord_username,
            display_name=display_name,
            email_verified=email_verified,
        )
        session_token = db.create_session(user.id)
    except RuntimeError:
        return _oauth_error_redirect(request, "discord", "registration_full")
    except Exception:
        logging.getLogger(__name__).exception("Discord OAuth callback error")
        return _oauth_error_redirect(request, "discord", "discord_failed")

    return _oauth_success_redirect(request, "discord", session_token)


@app.post("/auth/logout", response_model=AuthStatusResponse)
def auth_logout(
    request: Request,
    response: Response,
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
):
    if session_token:
        get_user_db().delete_session(session_token)
    _clear_session_cookie(response, request)
    return _auth_status_response(None)


def _verify_expected_user(user: AuthUser | None, expected_user: str | None) -> None:
    """Reject stale/cross-tab requests when the client expects a specific logged-in username."""
    if not expected_user:
        return
    expected = expected_user.strip().lower()
    if not expected:
        return
    if user is None:
        raise HTTPException(status_code=401, detail="Session expired or logged out")
    if user.username.lower() != expected:
        raise HTTPException(status_code=409, detail="Active account changed in another session")


@app.get("/draft/session", response_model=DraftSessionStateSchema)
def get_draft_session(
    user: AuthUser | None = Depends(get_optional_user),
    x_expected_user: str | None = Header(default=None, alias="X-Expected-User"),
):
    _verify_expected_user(user, x_expected_user)
    if user is not None:
        raw_user_state = get_user_db().get_user_draft_state(user.id)
        if not raw_user_state:
            return DraftSessionStateSchema()
        try:
            state = DraftSessionStateSchema.model_validate(raw_user_state)
            return state.model_copy(update={"engine": "sota"})
        except Exception:
            return DraftSessionStateSchema()

    if config.is_production:
        return DraftSessionStateSchema()

    session_path = config.paths.draft_session_path
    with _session_lock:
        if not session_path.exists():
            return DraftSessionStateSchema()
        try:
            raw = json.loads(session_path.read_text(encoding="utf-8"))
            state = DraftSessionStateSchema.model_validate(raw)
            return state.model_copy(update={"engine": "sota"})
        except Exception:
            return DraftSessionStateSchema()


@app.put("/draft/session", response_model=DraftSessionStateSchema)
def save_draft_session(
    session: DraftSessionStateSchema,
    user: AuthUser | None = Depends(get_optional_user),
    x_expected_user: str | None = Header(default=None, alias="X-Expected-User"),
):
    _verify_expected_user(user, x_expected_user)
    session = session.model_copy(update={"engine": "sota"})
    if user is not None:
        dumped = session.model_dump()
        get_user_db().save_user_draft_state(user.id, dumped, int(session.updatedAt or 0))
        return session

    if config.is_production:
        return session

    session_path = config.paths.draft_session_path
    session_path.parent.mkdir(parents=True, exist_ok=True)
    with _session_lock:
        payload = json.dumps(session.model_dump(), ensure_ascii=False, indent=2)
        tmp_path = session_path.with_name(f"{session_path.stem}_{uuid.uuid4().hex[:8]}.tmp")
        try:
            tmp_path.write_text(payload, encoding="utf-8")
            for attempt in range(3):
                try:
                    tmp_path.replace(session_path)
                    break
                except PermissionError:
                    if attempt == 2:
                        session_path.write_text(payload, encoding="utf-8")
                    else:
                        time.sleep(0.05)
        finally:
            tmp_path.unlink(missing_ok=True)
    return session


@app.delete("/draft/session", response_model=DraftSessionStateSchema)
def clear_draft_session(
    user: AuthUser | None = Depends(get_optional_user),
    x_expected_user: str | None = Header(default=None, alias="X-Expected-User"),
):
    _verify_expected_user(user, x_expected_user)
    if user is not None:
        get_user_db().clear_user_draft_state(user.id)
        return DraftSessionStateSchema()

    if config.is_production:
        return DraftSessionStateSchema()

    session_path = config.paths.draft_session_path
    with _session_lock:
        if session_path.exists():
            session_path.unlink(missing_ok=True)
    return DraftSessionStateSchema()


@app.get("/combat/builds", response_model=CombatBuildsSyncSchema)
def get_combat_builds(
    _guard: None = Depends(require_development),
    user: AuthUser = Depends(get_required_user),
    x_expected_user: str | None = Header(default=None, alias="X-Expected-User"),
):
    _verify_expected_user(user, x_expected_user)
    raw = get_user_db().get_user_combat_builds(user.id)
    if not raw:
        return CombatBuildsSyncSchema()
    try:
        return CombatBuildsSyncSchema.model_validate(raw)
    except Exception:
        return CombatBuildsSyncSchema()


@app.put("/combat/builds", response_model=CombatBuildsSyncSchema)
def save_combat_builds(
    builds: CombatBuildsSyncSchema,
    _guard: None = Depends(require_development),
    user: AuthUser = Depends(get_required_user),
    x_expected_user: str | None = Header(default=None, alias="X-Expected-User"),
):
    _verify_expected_user(user, x_expected_user)
    dumped = builds.model_dump()
    get_user_db().save_user_combat_builds(user.id, dumped, int(builds.updatedAt or 0))
    return builds


@app.delete("/combat/builds", response_model=CombatBuildsSyncSchema)
def clear_combat_builds(
    _guard: None = Depends(require_development),
    user: AuthUser = Depends(get_required_user),
    x_expected_user: str | None = Header(default=None, alias="X-Expected-User"),
):
    _verify_expected_user(user, x_expected_user)
    get_user_db().clear_user_combat_builds(user.id)
    return CombatBuildsSyncSchema()


_telemetry_rate_limiter = RateLimiter(max_attempts=30, window_seconds=60)


@app.post("/telemetry/visit", response_model=DailyVisitResponse)
def record_daily_visit(
    payload: DailyVisitRequest,
    request: Request,
    user: AuthUser | None = Depends(get_optional_user),
):
    """Record at most one daily visit per browser client_id for returning-user retention analytics."""
    client_ip = _client_ip(request)
    if not _telemetry_rate_limiter.check_and_record(f"visit:{client_ip}"):
        raise HTTPException(status_code=429, detail="Too many telemetry requests")
    visit_date = get_user_db().record_daily_visit(
        client_id=payload.client_id,
        user_id=user.id if user is not None else None,
    )
    return DailyVisitResponse(recorded=True, visit_date=visit_date)


@app.post("/survey/pricing", response_model=PricingSurveyResponse)
def submit_pricing_survey(
    payload: PricingSurveyRequest,
    request: Request,
    user: AuthUser | None = Depends(get_optional_user),
):
    """Record user or guest willingness-to-pay survey response."""
    client_ip = _client_ip(request)
    if not _survey_rate_limiter.check_and_record(f"survey:{client_ip}"):
        raise HTTPException(status_code=429, detail="Too many survey submissions, please try again shortly")
    get_user_db().record_pricing_survey(
        user_id=user.id if user is not None else None,
        client_id=payload.client_id,
        choice=payload.choice,
    )
    return PricingSurveyResponse(recorded=True, choice=payload.choice)


_cf_stats_lock = threading.Lock()
_cf_stats_cache: dict[str, object] = {"at": 0.0, "data": None}


def _normalize_referer_host(host: str) -> str:
    """Group Cloudflare RUM refererHost subdomains into clean channel labels."""
    clean = host.strip().lower()
    if not clean:
        return "Direct / แอปแชต"
    if clean == "facebook.com" or clean.endswith(".facebook.com") or clean == "fb.com" or clean.endswith(".fb.com"):
        return "Facebook"
    if clean == "accounts.google.com":
        return "Google OAuth"
    if (
        clean == "com.google.android.googlequicksearchbox"
        or clean == "google.com"
        or clean.endswith(".google.com")
        or clean == "google.co.th"
        or clean.endswith(".google.co.th")
    ):
        return "Google Search"
    if clean == "instagram.com" or clean.endswith(".instagram.com"):
        return "Instagram"
    if clean in {"discord.com", "discordapp.com"} or clean.endswith(".discord.com"):
        return "Discord"
    if clean in {"bing.com", "www.bing.com"} or clean.endswith(".bing.com"):
        return "Bing"
    if clean in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}:
        return "YouTube"
    if clean in {"t.co", "x.com", "twitter.com", "www.x.com", "mobile.twitter.com"}:
        return "X (Twitter)"
    if clean == "tiktok.com" or clean.endswith(".tiktok.com"):
        return "TikTok"
    if clean == "line.me" or clean.endswith(".line.me"):
        return "LINE"
    return clean.removeprefix("www.")


def _aggregate_referers(rows: object) -> list[dict[str, object]]:
    """Aggregate RUM refererHost rows by normalized channel, returning top 10."""
    if not isinstance(rows, list):
        return []
    totals: dict[str, int] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        dims = row.get("dimensions") or {}
        sums = row.get("sum") or {}
        if not isinstance(dims, dict) or not isinstance(sums, dict):
            continue
        visits = int(sums.get("visits") or 0)
        if visits <= 0:
            continue
        label = _normalize_referer_host(str(dims.get("refererHost") or ""))
        totals[label] = totals.get(label, 0) + visits
    ranked = sorted(totals.items(), key=lambda item: item[1], reverse=True)[:10]
    return [{"source": source, "visits": count} for source, count in ranked]


def _fetch_cloudflare_stats() -> dict[str, object] | None:
    if not (config.cf_api_token and config.cf_account_id and config.cf_zone_id):
        return None
    now_mono = time.monotonic()
    with _cf_stats_lock:
        cached_at = float(_cf_stats_cache.get("at") or 0.0)
        cached_data = _cf_stats_cache.get("data")
        if isinstance(cached_data, dict) and (now_mono - cached_at) < 60.0:
            return cached_data

    from datetime import datetime, timedelta, timezone

    now_utc = datetime.now(timezone.utc)
    tz_th = timezone(timedelta(hours=7))
    now_th = now_utc.astimezone(tz_th)
    today_start_utc = datetime(now_th.year, now_th.month, now_th.day, 0, 0, 0, tzinfo=tz_th).astimezone(timezone.utc)
    today_start_str = today_start_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    start_7d_str = (now_utc - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    end_dt_str = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    end_date_str = now_utc.strftime("%Y-%m-%d")

    query = f"""
    {{
      viewer {{
        zones(filter: {{zoneTag: "{config.cf_zone_id}"}}) {{
          all_time: httpRequests1dGroups(limit: 1, filter: {{date_geq: "2026-11-18", date_leq: "{end_date_str}"}}) {{
            sum {{ requests pageViews }}
            uniq {{ uniques }}
          }}
          today_th: httpRequests1hGroups(limit: 1, filter: {{datetime_geq: "{today_start_str}", datetime_leq: "{end_dt_str}"}}) {{
            sum {{ requests pageViews }}
            uniq {{ uniques }}
          }}
        }}
        accounts(filter: {{accountTag: "{config.cf_account_id}"}}) {{
          rum_today_th: rumPageloadEventsAdaptiveGroups(limit: 1, filter: {{datetime_geq: "{today_start_str}", datetime_leq: "{end_dt_str}"}}) {{
            count
            sum {{ visits }}
          }}
          rum_all: rumPageloadEventsAdaptiveGroups(limit: 1, filter: {{datetime_geq: "2026-11-18T00:00:00Z", datetime_leq: "{end_dt_str}"}}) {{
            count
            sum {{ visits }}
          }}
          rum_ref_today: rumPageloadEventsAdaptiveGroups(limit: 25, filter: {{datetime_geq: "{today_start_str}", datetime_leq: "{end_dt_str}"}}, orderBy: [sum_visits_DESC]) {{
            dimensions {{ refererHost }}
            sum {{ visits }}
          }}
          rum_ref_7d: rumPageloadEventsAdaptiveGroups(limit: 25, filter: {{datetime_geq: "{start_7d_str}", datetime_leq: "{end_dt_str}"}}, orderBy: [sum_visits_DESC]) {{
            dimensions {{ refererHost }}
            sum {{ visits }}
          }}
        }}
      }}
    }}
    """
    try:
        resp = httpx.post(
            "https://api.cloudflare.com/client/v4/graphql",
            json={"query": query},
            headers={
                "Authorization": f"Bearer {config.cf_api_token}",
                "Content-Type": "application/json",
            },
            timeout=6.0,
        )
        if resp.status_code != 200:
            return None
        viewer = (resp.json().get("data") or {}).get("viewer") or {}
        zones = (viewer.get("zones") or [{}])[0]
        accounts = (viewer.get("accounts") or [{}])[0]
        all_z = (zones.get("all_time") or [{}])[0]
        tod_z = (zones.get("today_th") or [{}])[0]
        rum_t = (accounts.get("rum_today_th") or [{}])[0]
        rum_a = (accounts.get("rum_all") or [{}])[0]
        result: dict[str, object] = {
            "today_uniques": int((tod_z.get("uniq") or {}).get("uniques") or 0),
            "today_page_views": int((tod_z.get("sum") or {}).get("pageViews") or 0),
            "today_requests": int((tod_z.get("sum") or {}).get("requests") or 0),
            "today_rum_visits": int((rum_t.get("sum") or {}).get("visits") or 0),
            "today_rum_pageloads": int(rum_t.get("count") or 0),
            "total_uniques": int((all_z.get("uniq") or {}).get("uniques") or 0),
            "total_page_views": int((all_z.get("sum") or {}).get("pageViews") or 0),
            "total_requests": int((all_z.get("sum") or {}).get("requests") or 0),
            "total_rum_visits": int((rum_a.get("sum") or {}).get("visits") or 0),
            "total_rum_pageloads": int(rum_a.get("count") or 0),
            "referers_today": _aggregate_referers(accounts.get("rum_ref_today")),
            "referers_7d": _aggregate_referers(accounts.get("rum_ref_7d")),
        }
        with _cf_stats_lock:
            _cf_stats_cache["at"] = now_mono
            _cf_stats_cache["data"] = result
        return result
    except Exception:
        return None


@app.get("/admin/stats", response_model=AdminStatsResponse)
def get_admin_stats(user: AuthUser | None = Depends(get_optional_user)):
    """Owner-only live production & survey analytics endpoint (404 for non-admins)."""
    if user is None or not config.is_admin_username(user.username):
        raise HTTPException(status_code=404, detail="Not Found")
    db_stats = get_user_db().get_admin_stats()
    cf_stats = _fetch_cloudflare_stats()
    return AdminStatsResponse(
        generated_at_th=str(db_stats["generated_at_th"]),
        users=db_stats["users"],
        survey=db_stats["survey"],
        cloudflare=cf_stats,
        retention=db_stats.get("retention"),
    )


@app.post("/predict", response_model=DraftPredictionResponse)
def predict_draft(
    request: DraftStateRequest,
    http_request: Request,
):
    restricted_prod = config.is_production
    if restricted_prod:
        if not _predict_rate_limiter.check_and_record(f"pred:{_client_ip(http_request)}"):
            raise HTTPException(status_code=429, detail="Too many prediction requests, please slow down")
        universal_keys = {_canon_hero_key(h) for h in request.global_bans}
        blue_gb_keys = {_canon_hero_key(h) for h in request.blue_global_bans}
        red_gb_keys = {_canon_hero_key(h) for h in request.red_global_bans}
        if request.mode == "ban":
            masked_side_keys = red_gb_keys if request.side == "blue" else blue_gb_keys
        else:
            masked_side_keys = blue_gb_keys if request.side == "blue" else red_gb_keys
        effective_masked = universal_keys | masked_side_keys
        if len(universal_keys) > 20 or len(blue_gb_keys) > 30 or len(red_gb_keys) > 30 or len(effective_masked) > 40:
            raise HTTPException(status_code=400, detail="Global Ban count exceeds single-series limit")
        if request.top_k > 25 or request.lookahead_depth > 2:
            request = request.model_copy(
                update={
                    "top_k": min(request.top_k, 25),
                    "lookahead_depth": min(request.lookahead_depth, 2),
                }
            )
    try:
        result = predictor.predict(request)
    except (ValueError, KeyError, IndexError) as exc:
        detail = "Invalid draft request or unknown hero name" if restricted_prod else str(exc)
        raise HTTPException(status_code=422, detail=detail) from exc
    if restricted_prod:
        return result.model_copy(update={"architecture": "RoV Draft AI"})
    return result


_combat_catalog_cache = None


@app.get("/combat/catalog", response_model=CombatCatalogResponse)
def combat_catalog(_guard: None = Depends(require_development)):
    global _combat_catalog_cache
    if _combat_catalog_cache is None:
        _combat_catalog_cache = get_engine().catalog()
    return _combat_catalog_cache


@app.post("/combat/stats", response_model=CombatStatsResponse)
def combat_stats(request: CombatStatsRequest, _guard: None = Depends(require_development)):
    engine = get_engine()
    try:
        build = Build(**request.build.model_dump())
        result = engine.build_stats(build)
        if request.target is not None:
            target = engine.build_stats(Build(**request.target.model_dump()))
            skills = engine.skill_damage(result, target, build)
            result["skills"] = skills
            result["basic_attack"] = engine.basic_attack(result, target)
            result["burst"] = round(engine.burst(build, target), 1)
            result["procs"] = engine._procs(result, build, target, skills=skills)
        return result
    except (ValueError, KeyError, IndexError, ZeroDivisionError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/combat/duel", response_model=CombatDuelResponse)
def combat_duel(request: CombatDuelRequest, _guard: None = Depends(require_development)):
    try:
        return get_engine().duel(Build(**request.a.model_dump()), Build(**request.b.model_dump()))
    except (ValueError, KeyError, IndexError, ZeroDivisionError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/combat/rune-recommendation", response_model=CombatRuneRecommendationResponse)
def get_rune_recommendation(
    my_hero: str = Query(..., description="My hero name"),
    enemy_hero: str = Query(..., description="Enemy hero name"),
    lane: Literal["DS_Lane", "Jungle", "Mid", "Dragon_Lane", "Roam", "Support"] = Query(
        "DS_Lane", description="Lane: DS_Lane, Jungle, Mid, Dragon_Lane, Roam"
    ),
    level: int = Query(2, ge=1, le=15, description="Hero level (1-15)"),
    _guard: None = Depends(require_development),
):
    try:
        return get_engine().recommend_matchup_runes(my_hero=my_hero, enemy_hero=enemy_hero, lane=lane, level=level)
    except (ValueError, KeyError, IndexError, ZeroDivisionError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _natural_sort_key(file_path: Path):
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r"(\d+)", file_path.name)]


def _skill_sort_key(file_path: Path):
    stem = file_path.stem.lower()
    form_group = 1 if any(tag in stem for tag in ("_form2", "_fox", "_awakened")) else 0
    if stem.startswith("passive"):
        slot_rank = 0
    elif stem.startswith("skill1"):
        slot_rank = 1
    elif stem.startswith("skill2"):
        slot_rank = 2
    elif stem.startswith("ultimate") or stem.startswith("skill3"):
        slot_rank = 3
    elif stem.startswith("skill4"):
        slot_rank = 4
    elif stem.startswith("skill5"):
        slot_rank = 5
    else:
        slot_rank = 9
    variant_rank = 2 if "_v2" in stem else (1 if "_cannon" in stem else 0)
    return (form_group, slot_rank, variant_rank, _natural_sort_key(file_path))


@app.get("/combat/hero-screenshots/{hero}")
def get_hero_screenshots(hero: str, _guard: None = Depends(require_development)):
    # Security check: prevent directory traversal and drive-relative paths
    if not hero.strip() or hero.strip() == "." or ".." in hero or "/" in hero or "\\" in hero or ":" in hero:
        raise HTTPException(status_code=400, detail="Invalid hero name")

    folder_name = HERO_FOLDER_ALIASES.get(hero, hero)
    hero_dir = HEROES_DIR / folder_name
    actual_folder = folder_name
    if not hero_dir.is_dir() and (HEROES_DIR / hero).is_dir():
        hero_dir = HEROES_DIR / hero
        actual_folder = hero

    try:
        resolved_base = HEROES_DIR.resolve()
        resolved_target = hero_dir.resolve()
        if resolved_target.parent != resolved_base or not resolved_target.is_relative_to(resolved_base):
            raise HTTPException(status_code=400, detail="Invalid hero name")
    except (ValueError, RuntimeError):
        raise HTTPException(status_code=400, detail="Invalid hero name")

    if not hero_dir.is_dir():
        return {"hero": hero, "folder": actual_folder, "skill_screenshots": [], "status_screenshots": []}

    skill_dir = hero_dir / "skill"
    status_dir = hero_dir / "status"

    skill_files = []
    if skill_dir.is_dir():
        skill_files = [
            f"/heroes-media/{actual_folder}/skill/{f.name}"
            for f in sorted(
                [f for f in skill_dir.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png")],
                key=_skill_sort_key,
            )
        ]

    status_files = []
    if status_dir.is_dir():
        status_files = [
            f"/heroes-media/{actual_folder}/status/{f.name}"
            for f in sorted(
                [f for f in status_dir.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png")],
                key=_natural_sort_key,
            )
        ]

    return {
        "hero": hero,
        "folder": actual_folder,
        "skill_screenshots": skill_files,
        "status_screenshots": status_files,
    }


_manifest_items_cache: dict[str, list[dict]] = {}
_manifest_path = DATA_DIR / "screenshots_manifest.json"
if _manifest_path.exists():
    try:
        _raw_manifest = json.loads(_manifest_path.read_text(encoding="utf-8"))
        _manifest_items_cache = _raw_manifest.get("items", {})
    except Exception as exc:
        logger.warning("Failed to load screenshots_manifest.json for items: %s", exc)


@app.get("/combat/item-screenshots/{item_name}")
def get_item_screenshots(item_name: str, _guard: None = Depends(require_development)):
    # Security check: prevent directory traversal and drive-relative paths
    if (
        not item_name.strip()
        or item_name.strip() == "."
        or ".." in item_name
        or "/" in item_name
        or "\\" in item_name
        or ":" in item_name
    ):
        raise HTTPException(status_code=400, detail="Invalid item name")

    resolved_name = ITEM_FOLDER_ALIASES.get(
        item_name,
        ITEM_FOLDER_ALIASES_LOWER.get(item_name.lower(), item_name),
    )
    item_dir = ITEMS_DIR / resolved_name
    try:
        resolved_base = ITEMS_DIR.resolve()
        resolved_target = item_dir.resolve()
        if resolved_target.parent != resolved_base or not resolved_target.is_relative_to(resolved_base):
            raise HTTPException(status_code=400, detail="Invalid item name")
    except (ValueError, RuntimeError):
        raise HTTPException(status_code=400, detail="Invalid item name")

    pages_info = _manifest_items_cache.get(resolved_name, _manifest_items_cache.get(item_name, []))
    details = pages_info[0] if pages_info else None
    screenshots: list[str] = []
    if item_dir.is_dir():
        screenshots = [
            f"/items-media/{resolved_name}/{f.name}"
            for f in sorted(
                [f for f in item_dir.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png")],
                key=_natural_sort_key,
            )
        ]

    return {
        "item": item_name,
        "folder": resolved_name,
        "screenshots": screenshots,
        "details": details,
        "pages_info": pages_info,
    }


# Serve hero & item in-game screenshot media directly
if HEROES_DIR.is_dir():
    app.mount("/heroes-media", StaticFiles(directory=HEROES_DIR), name="heroes_media")
if ITEMS_DIR.is_dir():
    app.mount("/items-media", StaticFiles(directory=ITEMS_DIR), name="items_media")


class _FrontendStaticFiles(StaticFiles):
    """Serve frontend static assets while returning 404 (not 405) for unmatched non-GET/HEAD API paths."""

    async def __call__(self, scope, receive, send) -> None:
        if scope.get("type") == "http" and scope.get("method") not in ("GET", "HEAD"):
            resp = JSONResponse({"detail": "Not Found"}, status_code=404)
            await resp(scope, receive, send)
            return
        await super().__call__(scope, receive, send)


# Mounted last so the API routes above take precedence over static files.
if FRONTEND_DIST.is_dir():
    app.mount("/", _FrontendStaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

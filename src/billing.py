"""MiniDraft prepaid passes and sandbox-only Stripe Checkout fulfillment."""

from __future__ import annotations

import sqlite3
import time
from typing import Annotated, Literal
from urllib.parse import urlparse

import stripe
from pydantic import BaseModel, Field, field_validator, model_validator

from src.db import TEAM_HISTORY_LIMIT, UserDatabase
from src.schemas import (
    ArchivedDraftGameSchema,
    DraftHistoryNameTarget,
    HistoryDisplayName,
    RecordedDraftGameSchema,
    TournamentRefSchema,
)

Tier = Literal["pro", "duo", "team_pro"]
PassDays = Literal[30, 90]
PRICE_SATANG: dict[tuple[Tier, PassDays], int] = {
    ("pro", 30): 5900,
    ("pro", 90): 13900,
    ("duo", 30): 10900,
    ("duo", 90): 25900,
    ("team_pro", 30): 23900,
    ("team_pro", 90): 56900,
}
TIER_NAMES = {"pro": "Pro", "duo": "Duo", "team_pro": "Business"}
BILLING_EVENT_TYPES = frozenset(
    {
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
        "checkout.session.async_payment_failed",
        "checkout.session.expired",
    }
)


class CheckoutRequest(BaseModel):
    tier: Tier
    days: PassDays
    expected_username: str = Field(min_length=3, max_length=32)


class CancelCheckoutRequest(BaseModel):
    expected_username: str = Field(min_length=3, max_length=32)


class BillingPackage(BaseModel):
    tier: Tier
    days: PassDays
    amount: int


class BillingOrder(BillingPackage):
    id: str
    status: Literal["pending", "paid", "closed"]
    paid_at: int | None


class BillingPass(BaseModel):
    tier: Tier
    expires_at: int
    is_owner: bool = True
    source: Literal["paid", "promo_free", "team_member", "manual"] | None = None


class BillingSummary(BaseModel):
    packages: list[BillingPackage]
    active_pass: BillingPass | None
    orders: list[BillingOrder]
    promo_claimable: bool = False
    promo_expires_at: int | None = None
    is_owner_account: bool = False


class PromoClaimRequest(BaseModel):
    expected_username: str


class CheckoutResponse(BaseModel):
    url: str | None


GroupTier = Literal["duo", "team_pro"]


class TeamAccount(BaseModel):
    id: int
    username: str


class TeamInvitation(BaseModel):
    owner_id: int
    owner_username: str
    tier: GroupTier


class TeamDetails(TeamInvitation):
    expires_at: int
    is_owner: bool
    capacity: int
    members: list[TeamAccount]
    sent: list[TeamAccount]


class TeamOverview(BaseModel):
    team: TeamDetails | None
    received: list[TeamInvitation]


class TeamInviteRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_.-]+$")


class TeamGameRequest(BaseModel):
    owner_id: int = Field(gt=0)
    tier: GroupTier
    source_id: str = Field(min_length=1, max_length=128)
    game: RecordedDraftGameSchema | None = None

    @model_validator(mode="after")
    def validate_game_id(self):
        if self.game is not None and self.game.id != self.source_id:
            raise ValueError("The game ID must match the source ID")
        return self


class TeamSeriesCopyRequest(BaseModel):
    owner_id: int = Field(gt=0)
    tier: GroupTier
    source_ids: list[str] = Field(min_length=1, max_length=50)
    games: list[RecordedDraftGameSchema] | None = Field(default=None, max_length=50)

    @field_validator("source_ids")
    @classmethod
    def validate_source_ids(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        seen: set[str] = set()
        for raw_id in value:
            if not isinstance(raw_id, str) or not (1 <= len(raw_id) <= 128):
                raise ValueError("Each source ID must be between 1 and 128 characters")
            if raw_id not in seen:
                seen.add(raw_id)
                cleaned.append(raw_id)
        return cleaned


class TeamSeriesCopyResponse(BaseModel):
    copied: int
    skipped: int


class TeamGame(BaseModel):
    id: int
    author: str | None
    game: ArchivedDraftGameSchema


class TeamTournamentAssignment(BaseModel):
    tournament: TournamentRefSchema | None


class TeamTournamentBatchAssignment(TeamTournamentAssignment):
    game_ids: list[Annotated[int, Field(gt=0)]] = Field(min_length=1, max_length=TEAM_HISTORY_LIMIT)


class TeamHistoryRename(BaseModel):
    target: DraftHistoryNameTarget
    name: HistoryDisplayName | None

    @model_validator(mode="after")
    def require_group_name(self):
        if self.target != "game" and self.name is None:
            raise ValueError("A tournament or series name is required")
        return self


class HistorySeriesTeams(BaseModel):
    teamAName: HistoryDisplayName
    teamBName: HistoryDisplayName


class HistorySeriesEdit(BaseModel):
    seriesTitle: HistoryDisplayName | None = None
    gameName: HistoryDisplayName | None = None
    teams: HistorySeriesTeams | None = None

    @model_validator(mode="after")
    def validate_changes(self):
        if not self.model_fields_set:
            raise ValueError("Provide at least one change")
        for field in self.model_fields_set - {"gameName"}:
            if getattr(self, field) is None:
                raise ValueError("Series and team names cannot be empty")
        return self


HeroPoolScope = Literal["personal", "team"]
HeroPoolLane = Literal["DS_Lane", "Jungle", "Mid", "Dragon_Lane", "Roam"]


class HeroPoolUpsertRequest(BaseModel):
    scope: HeroPoolScope = "personal"
    team_name: str = Field(min_length=1, max_length=32)
    lanes: dict[HeroPoolLane, list[str]] = Field(default_factory=dict)
    create_only: bool = False
    pool_id: int | None = Field(default=None, gt=0)


class HeroPoolItem(BaseModel):
    id: int
    scope: HeroPoolScope
    team_name: str
    lanes: dict[HeroPoolLane, list[str]]
    updated_at: int


class HeroPoolOverview(BaseModel):
    personal: list[HeroPoolItem]
    team: list[HeroPoolItem]
    personal_limit: int
    team_limit: int
    is_paid: bool
    team_tier: GroupTier | None


def make_stripe_client(secret_key: str) -> stripe.StripeClient:
    return stripe.StripeClient(secret_key, http_client=stripe.RequestsClient(timeout=10), max_network_retries=1)


def checkout_session(
    client: stripe.StripeClient, db: UserDatabase, order: sqlite3.Row, *, livemode: bool = False
) -> stripe.checkout.Session:
    sessions = client.v1.checkout.sessions
    session_id = order["stripe_session_id"]
    if session_id:
        return sessions.retrieve(session_id)

    origin = order["return_origin"]
    tier_name = TIER_NAMES[order["tier"]]
    days = order["days"]
    mode_prefix = "live" if livemode else "sandbox"
    try:
        session = sessions.create(
            {
                "mode": "payment",
                "allowed_payment_method_types": ["promptpay"],
                "adaptive_pricing": {"enabled": False},
                "client_reference_id": order["id"],
                "metadata": {"minidraft_order_id": order["id"]},
                "success_url": f"{origin}/profile",
                "cancel_url": f"{origin}/profile",
                "expires_at": max(order["created_at"] + 3600, int(time.time()) + 1860),
                "line_items": [
                    {
                        "quantity": 1,
                        "price_data": {
                            "currency": "thb",
                            "unit_amount": order["amount"],
                            "product_data": {"name": f"MiniDraft {tier_name} · {days} days"},
                        },
                    }
                ],
            },
            {"idempotency_key": f"minidraft-{mode_prefix}-{order['id']}"},
        )
    except stripe.InvalidRequestError as error:
        if error.code != "idempotency_key_in_use":
            db.close_uncreated_billing_order(order["id"])
        raise
    db.attach_billing_session(order["id"], session.id)
    return session


def hosted_checkout_url(session: stripe.checkout.Session, *, expected_livemode: bool = False) -> str:
    url = session.url or ""
    parsed = urlparse(url)
    if (
        session.status != "open"
        or bool(session.livemode) != expected_livemode
        or parsed.scheme != "https"
        or parsed.netloc != "checkout.stripe.com"
    ):
        raise ValueError("checkout_unavailable")
    return url


def apply_checkout_result(
    db: UserDatabase, session: stripe.checkout.Session, event_type: str, *, expected_livemode: bool = False
) -> None:
    data = session.to_dict()
    order_id = (data.get("metadata") or {}).get("minidraft_order_id")
    if not order_id:
        return
    expected_prefix = "cs_live_" if expected_livemode else "cs_test_"
    if (
        data.get("livemode") is not expected_livemode
        or data.get("mode") != "payment"
        or data.get("currency") != "thb"
        or data.get("client_reference_id") != order_id
        or data.get("payment_method_types") != ["promptpay"]
        or not isinstance(data.get("amount_total"), int)
        or not isinstance(data.get("id"), str)
        or not session.id.startswith(expected_prefix)
    ):
        raise ValueError("checkout_session_mismatch")
    if data.get("payment_status") == "paid" and data.get("status") == "complete":
        payment_id = data.get("payment_intent")
        if not isinstance(payment_id, str) or not payment_id.startswith("pi_"):
            raise ValueError("checkout_payment_mismatch")
        db.settle_billing_order(order_id, session.id, session.amount_total, payment_id)
    elif data.get("status") == "expired" or event_type == "checkout.session.async_payment_failed":
        db.settle_billing_order(order_id, session.id, session.amount_total, None)

import re
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    StringConstraints,
    field_validator,
    model_validator,
)

HeroStr = Annotated[str, Field(min_length=1, max_length=64)]
ShortStr = Annotated[str, Field(max_length=64)]
FinitePct = Annotated[float, Field(allow_inf_nan=False, ge=0.0, le=100.0)]
LaneKey = Literal["DS_Lane", "Jungle", "Mid", "Dragon_Lane", "Roam"]


def _validate_pick_lane_keys(value: dict[str, LaneKey]) -> dict[str, LaneKey]:
    if any(not hero.strip() for hero in value):
        raise ValueError("Empty hero name in pickLanes")
    return value


PickLaneAssignments = Annotated[dict[HeroStr, LaneKey], Field(max_length=10), AfterValidator(_validate_pick_lane_keys)]

_SCHEMA_HERO_ALIASES: dict[str, str] = {
    "riktor": "riktor",
    "richter": "riktor",
    "mortos": "mortos",
    "arthur": "mortos",
    "celica": "celica",
    "brunhilda": "celica",
    "diaochan": "diaochan",
    "batman": "kaine",
    "joker": "stuart",
    "thejoker": "stuart",
    "payna": "helen",
    "peura": "helen",
    "kilgrooth": "kilgroth",
    "flowborn": "flowbornmarksman",
    "flowbornmm": "flowbornmarksman",
    "flowbornarcher": "flowbornmarksman",
    "doria": "dolia",
    "jinna": "jinnar",
    "illumia": "ilumia",
    "wiro": "wiro",
    "wirosableng": "wiro",
    "mingshiyin": "ming",
    "sikongzhen": "boltbaron",
}


def _canon_hero_key(name: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]", "", name.strip().lower())
    return _SCHEMA_HERO_ALIASES.get(cleaned, cleaned)


class DraftStateRequest(BaseModel):
    mode: Literal["pick", "ban"] = Field(
        default="pick",
        description="Current draft action type: 'pick' or 'ban'",
    )
    side: Literal["blue", "red"] = Field(
        default="blue",
        description="Acting team side: 'blue' or 'red'",
    )
    phase: int = Field(
        default=1,
        ge=1,
        le=2,
        description="Draft phase: 1 (first ban/pick phase) or 2 (second ban/pick phase)",
    )
    ally_picks: list[HeroStr] = Field(
        default_factory=list,
        max_length=5,
        description="Heroes already picked by the acting team (0 to 4 heroes if mode='pick', up to 5 if mode='ban')",
    )
    enemy_picks: list[HeroStr] = Field(
        default_factory=list,
        max_length=5,
        description="Heroes already picked by the opposing team (0 to 5 heroes)",
    )
    ally_bans: list[HeroStr] = Field(
        default_factory=list,
        max_length=4,
        description="Heroes already banned by the acting team (0 to 4 heroes)",
    )
    enemy_bans: list[HeroStr] = Field(
        default_factory=list,
        max_length=4,
        description="Heroes already banned by the opposing team (0 to 4 heroes)",
    )
    global_bans: list[HeroStr] = Field(
        default_factory=list,
        max_length=60,
        description="Heroes unavailable due to Global Ban Pick rule from previous games in the series",
    )
    blue_global_bans: list[HeroStr] = Field(
        default_factory=list,
        max_length=35,
        description="Heroes unavailable specifically for Blue team due to being used in previous games",
    )
    red_global_bans: list[HeroStr] = Field(
        default_factory=list,
        max_length=35,
        description="Heroes unavailable specifically for Red team due to being used in previous games",
    )
    top_k: int = Field(
        default=5,
        ge=1,
        le=60,
        description="Number of top hero recommendations to return",
    )
    use_lookahead: bool = Field(
        default=False,
        description="Whether to execute multi-step Minimax lookahead search using Value Head",
    )
    lookahead_depth: int = Field(
        default=2,
        ge=1,
        le=4,
        description="Minimax search depth (lookahead turns)",
    )
    league: Literal["RPL", "AOG", "GCS", "INTL", "APL", "AIC", "GLOBAL"] = Field(
        default="GLOBAL",
        description="Target regional pro league meta conditioning: 'RPL' (TH), 'AOG' (VN), 'GCS' (TW), 'INTL'/'APL'/'AIC' (international), or 'GLOBAL' (performance-adjusted global blend)",
    )
    series_winning_heroes: list[HeroStr] = Field(
        default_factory=list,
        max_length=35,
        description="Heroes that won previous games in the current series and remain available for steal-pick or target-ban adaptation",
    )
    ally_pick_lanes: dict[HeroStr, LaneKey] = Field(
        default_factory=dict,
        max_length=5,
        description="Optional manual lane overrides for acting team's picked heroes",
    )
    enemy_pick_lanes: dict[HeroStr, LaneKey] = Field(
        default_factory=dict,
        max_length=5,
        description="Optional manual lane overrides for opposing team's picked heroes",
    )
    ally_pool: list[HeroStr] = Field(
        default_factory=list,
        max_length=130,
        description="Optional acting team's Hero Pool for pick prioritization or strict pool filtering",
    )
    enemy_pool: list[HeroStr] = Field(
        default_factory=list,
        max_length=130,
        description="Optional opponent's Hero Pool for target-ban prioritization",
    )
    pool_only: bool = Field(
        default=False,
        description="When true with available ally_pool (pick) or enemy_pool (ban) heroes, restrict recommendations strictly to that pool",
    )
    pool_mode: Literal["off", "low", "high"] | None = Field(
        default=None,
        description="Hero Pool influence mode: 'off' (pure meta), 'low' (mixture prior boost), 'high' (strict pool filter in pick/ban modes)",
    )
    ally_pool_lanes: dict[LaneKey, Annotated[list[HeroStr], Field(max_length=130)]] = Field(
        default_factory=dict,
        description="Optional acting team's 5-lane Hero Pool mapping so flex picks match the team's assigned lanes",
    )

    @model_validator(mode="after")
    def validate_no_duplicate_or_overlapping_heroes(self) -> "DraftStateRequest":
        buckets: dict[str, list[str]] = {
            "ally_picks": self.ally_picks,
            "enemy_picks": self.enemy_picks,
            "ally_bans": self.ally_bans,
            "enemy_bans": self.enemy_bans,
        }
        seen_by_field: dict[str, set[str]] = {}
        for field_name, items in buckets.items():
            seen: set[str] = set()
            for raw in items:
                key = _canon_hero_key(raw)
                if not key:
                    raise ValueError(f"Empty hero name in {field_name}")
                if key in seen:
                    raise ValueError(f"Duplicate hero '{raw}' in {field_name}")
                seen.add(key)
            seen_by_field[field_name] = seen

        for extra_name, extra_items in (
            ("global_bans", self.global_bans),
            ("blue_global_bans", self.blue_global_bans),
            ("red_global_bans", self.red_global_bans),
            ("series_winning_heroes", self.series_winning_heroes),
        ):
            extra_seen: set[str] = set()
            for raw in extra_items:
                key = _canon_hero_key(raw)
                if not key:
                    raise ValueError(f"Empty hero name in {extra_name}")
                if key in extra_seen:
                    raise ValueError(f"Duplicate hero '{raw}' in {extra_name}")
                extra_seen.add(key)

        ap, ep = seen_by_field["ally_picks"], seen_by_field["enemy_picks"]
        ab, eb = seen_by_field["ally_bans"], seen_by_field["enemy_bans"]
        if ap & ep:
            raise ValueError(f"Overlapping heroes between ally_picks and enemy_picks: {sorted(ap & ep)}")
        if ab & eb:
            raise ValueError(f"Overlapping heroes between ally_bans and enemy_bans: {sorted(ab & eb)}")
        picked = ap | ep
        banned = ab | eb
        if picked & banned:
            raise ValueError(f"Heroes cannot be both picked and banned: {sorted(picked & banned)}")
        return self


class HeroRecommendation(BaseModel):
    rank: int
    hero_name: str
    probability_pct: float
    predicted_win_rate_pct: float
    lookahead_win_rate_pct: float | None = Field(
        default=None,
        description="Minimax adversarial lookahead expected win rate percentage",
    )
    primary_lane: str
    primary_role: str
    synergy_edge_pct: float
    counter_edge_pct: float
    capabilities: list[str]
    triggered_by: list[str] = Field(
        default_factory=list,
        description="Bans or picks that statistically triggered/unlocked this recommendation",
    )
    trigger_reason: Literal["counter", "combo", "ban_unlock", "protect"] | None = Field(
        default=None,
        description="Reason category for triggered_by: counter | combo | ban_unlock | protect",
    )


class DraftPredictionResponse(BaseModel):
    architecture: str
    mode: Literal["pick", "ban"]
    side: Literal["blue", "red"]
    phase: int
    missing_ally_lanes: list[str]
    recommendations: list[HeroRecommendation]
    blue_next_picks: list[HeroRecommendation] = Field(
        default_factory=list,
        description="Predicted next up to 2 picks for Blue side (ghost slot forecast)",
    )
    red_next_picks: list[HeroRecommendation] = Field(
        default_factory=list,
        description="Predicted next up to 2 picks for Red side (ghost slot forecast)",
    )
    blue_next_bans: list[HeroRecommendation] = Field(
        default_factory=list,
        description="Predicted next up to 2 bans for Blue side based on picked heroes",
    )
    red_next_bans: list[HeroRecommendation] = Field(
        default_factory=list,
        description="Predicted next up to 2 bans for Red side based on picked heroes",
    )
    ban_unlocked_heroes: list[HeroRecommendation] = Field(
        default_factory=list,
        description="Heroes unlocked / made significantly stronger by current bans on the board",
    )


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    architecture: str | None = None
    num_heroes: int | None = None
    val_loss: float | None = None
    dataset_metadata: dict[str, Any] | None = None


class CombatBuildRequest(BaseModel):
    hero: HeroStr
    level: StrictInt = Field(default=1, ge=1, le=15)
    items: list[ShortStr] = Field(default_factory=list, max_length=6)
    arcana: dict[ShortStr, StrictInt] = Field(
        default_factory=dict,
        max_length=30,
        description="Tier 3 arcana name -> slot count",
    )
    primary_faction: ShortStr | None = None
    primary_enchantments: list[ShortStr] = Field(default_factory=list, max_length=3)
    secondary_faction: ShortStr | None = None
    secondary_enchantments: list[ShortStr] = Field(default_factory=list, max_length=2)
    skill_levels: dict[ShortStr, StrictInt] = Field(
        default_factory=dict,
        max_length=16,
        description="Override auto skill point allocation",
    )
    skill_hits: dict[ShortStr, StrictInt] = Field(
        default_factory=dict,
        max_length=16,
        description="Hits per cast for multi-hit skills",
    )
    skill_charges: dict[ShortStr, float] = Field(
        default_factory=dict,
        max_length=16,
        description="Charge ratio (0.0 to 1.0) for charging skills",
    )
    active_combo_slots: list[ShortStr] | None = Field(
        default=None,
        max_length=16,
        description="Active skill slots included in combo/duel",
    )
    enable_kiting: bool = Field(default=True, description="Whether ranged heroes kite melee opponents in 1v1 duels")
    enable_actives: bool = Field(
        default=True,
        description="Whether active item effects (Rock Shield, Bow of Slaughter, etc.) trigger automatically in 1v1 duels",
    )


class CombatStatsRequest(BaseModel):
    build: CombatBuildRequest
    target: CombatBuildRequest | None = Field(default=None, description="Optional target for skill damage")


class CombatDuelRequest(BaseModel):
    a: CombatBuildRequest
    b: CombatBuildRequest


class CombatCatalogResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    heroes: list[dict[str, Any]]
    max_level: int
    skills: dict[str, list[dict[str, Any]]]
    items: list[dict[str, Any]]
    arcana: list[dict[str, Any]]
    arcana_slots_per_color: int
    factions: list[str]
    enchantments: list[dict[str, Any]]


class CombatStatsResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    hero: str
    level: int
    is_ranged: bool
    stats: dict[str, float]
    sources: dict[str, dict[str, float]]
    build_cost: int
    items_missing_price: list[str] = Field(default_factory=list)
    item_warnings: list[str] = Field(default_factory=list)
    enchantments_modeled: list[str] = Field(default_factory=list)
    enchantments_unmodeled: list[str] = Field(default_factory=list)
    skills: list[dict[str, Any]] | None = None
    basic_attack: dict[str, float] | None = None
    burst: float | None = None
    procs: list[dict[str, Any]] | None = None


class CombatDuelResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    a: dict[str, Any]
    b: dict[str, Any]
    simulation: dict[str, Any]
    assumptions: list[str]


class CombatRuneRecommendationResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    my_hero: str
    enemy_hero: str
    lane: str
    level: int
    standard_preset: dict[str, Any]
    recommended_preset: dict[str, Any]
    hp_advantage: float
    trade_verdict: str
    detailed_runes: list[dict[str, Any]]


class DraftHistoryItemSchema(BaseModel):
    stepIndex: int = Field(default=0, ge=0, le=20)
    bluePicks: list[ShortStr] = Field(default_factory=list, max_length=5)
    redPicks: list[ShortStr] = Field(default_factory=list, max_length=5)
    blueBans: list[ShortStr] = Field(default_factory=list, max_length=4)
    redBans: list[ShortStr] = Field(default_factory=list, max_length=4)


class GlobalBanListsSchema(BaseModel):
    teamAUsed: list[ShortStr] = Field(default_factory=list, max_length=60)
    teamBUsed: list[ShortStr] = Field(default_factory=list, max_length=60)
    universalBans: list[ShortStr] = Field(default_factory=list, max_length=60)


DraftGroupId = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")]
DraftSeriesAnchor = Annotated[str, Field(max_length=132)]
HistoryDisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
DraftHistoryNameTarget = Literal["tournament", "series", "game"]


class TournamentRefSchema(BaseModel):
    id: DraftGroupId
    name: ShortStr

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not (name := value.strip()):
            raise ValueError("Tournament name is required")
        return name


class GlobalBanStateSchema(GlobalBanListsSchema):
    seriesName: DraftSeriesAnchor = Field(
        default="", description="Optional custom or derived series matchup name e.g. BRU vs FS"
    )
    seriesId: DraftGroupId | None = None
    seriesTitle: HistoryDisplayName | None = None
    tournament: TournamentRefSchema | None = None
    teamAName: ShortStr = "TEAM A"
    teamBName: ShortStr = "TEAM B"
    blueSideTeam: Literal["A", "B"] = "A"
    gameNumber: int = Field(default=1, ge=1, le=7)


class ArchivedDraftGameSchema(BaseModel):
    """A saved snapshot whose pick and ban slots are preserved for history sync."""

    id: ShortStr
    gameNumber: int = Field(default=1, ge=1, le=7)
    timestamp: str = Field(max_length=32)
    seriesName: DraftSeriesAnchor = Field(default="", description="Group or series matchup name e.g. BRU vs FS")
    seriesId: DraftGroupId | None = None
    seriesTitle: HistoryDisplayName | None = None
    gameName: HistoryDisplayName | None = None
    gameNameShared: bool = False
    teamNamesShared: bool = False
    tournament: TournamentRefSchema | None = None
    blueTeamName: ShortStr
    redTeamName: ShortStr
    blueSideTeam: Literal["A", "B"] = "A"
    blueBans: list[ShortStr] = Field(default_factory=list, max_length=4)
    redBans: list[ShortStr] = Field(default_factory=list, max_length=4)
    bluePicks: list[ShortStr] = Field(default_factory=list, max_length=5)
    redPicks: list[ShortStr] = Field(default_factory=list, max_length=5)
    pickLanes: PickLaneAssignments = Field(default_factory=dict)
    globalBans: GlobalBanListsSchema | None = None
    blueWinRate: FinitePct = 50.0
    winner: Literal["A", "B"] | None = None
    locked: bool = False


class RecordedDraftGameSchema(ArchivedDraftGameSchema):
    @model_validator(mode="after")
    def validate_unique_game_heroes(self):
        seen: set[str] = set()
        for slot in (*self.blueBans, *self.redBans, *self.bluePicks, *self.redPicks):
            raw = slot.strip()
            if not raw:
                continue
            key = _canon_hero_key(raw)
            if key in seen:
                raise ValueError(f"Duplicate hero within draft game: {raw}")
            seen.add(key)
        return self


class DraftSessionStateSchema(BaseModel):
    stepIndex: int = Field(default=0, ge=0, le=20)
    bluePicks: list[ShortStr] = Field(default_factory=list, max_length=5)
    redPicks: list[ShortStr] = Field(default_factory=list, max_length=5)
    blueBans: list[ShortStr] = Field(default_factory=list, max_length=4)
    redBans: list[ShortStr] = Field(default_factory=list, max_length=4)
    pickLanes: PickLaneAssignments = Field(default_factory=dict)
    history: list[DraftHistoryItemSchema] = Field(default_factory=list, max_length=25)
    winHistory: list[FinitePct | None] = Field(default_factory=list, max_length=25)
    blueWinRate: FinitePct = 50.0
    useLookahead: bool = False
    engine: Literal["sota"] = "sota"
    league: Literal["RPL", "AOG", "GCS", "INTL", "APL", "AIC", "GLOBAL"] = "GLOBAL"
    globalBans: GlobalBanStateSchema = Field(default_factory=GlobalBanStateSchema)
    fromTeamHistory: bool = False
    seriesGames: list[ArchivedDraftGameSchema] = Field(default_factory=list, max_length=500)
    updatedAt: int = Field(
        default=0,
        ge=0,
        le=9223372036854775807,
        description="Epoch milliseconds of last state update",
    )

    @field_validator("engine", mode="before")
    @classmethod
    def force_sota_engine(cls, _value: Any) -> Literal["sota"]:
        return "sota"


class AuthRegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=6, max_length=128)
    display_name: str | None = Field(default=None, max_length=40)


class AuthLoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=1, max_length=128)


class AuthProfileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: int = Field(gt=0)
    display_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]


class AuthUserSchema(BaseModel):
    id: int
    username: str
    display_name: str
    email: str | None = None
    auth_provider: Literal["password", "google", "discord"] = "password"
    display_name_is_custom: bool = False
    display_label: str
    display_name_changes_remaining: int
    display_name_next_change_at: int | None = None
    stripe_sandbox_enabled: bool = False
    stripe_livemode: bool = False
    draft_history_limit: int | None = None
    practice_history_limit: int | None = None
    is_paid: bool = False
    pass_tier: Literal["pro", "duo", "team_pro"] | None = None
    pass_source: Literal["paid", "promo_free", "team_member", "manual"] | None = None
    pass_expires_at: int | None = None


class AuthStatusResponse(BaseModel):
    authenticated: bool
    user: AuthUserSchema | None = None
    google_login_enabled: bool = False
    discord_login_enabled: bool = False
    pricing_survey_answered: bool = False
    pricing_survey_choice: Literal["willing", "not_willing"] | None = None
    is_admin: bool = False
    stripe_sandbox_enabled: bool = False
    stripe_livemode: bool = False
    free_promo_until: int | None = None


class AdminStatsResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    generated_at_th: str
    users: dict[str, Any]
    survey: dict[str, Any]
    feedback: dict[str, Any] | None = None
    billing: dict[str, Any] | None = None
    cloudflare: dict[str, Any] | None = None
    retention: dict[str, Any] | None = None


class AdminUserActivitySchema(BaseModel):
    id: int
    username: str
    display_name: str
    email: str | None = None
    auth_provider: str = "password"
    created_at_th: str
    active_days: int = 0
    first_visit: str | None = None
    last_visit: str | None = None
    saved_series_games: int = 0
    draft_step_index: int = 0
    last_draft_save_th: str | None = None
    practice_games: int = 0
    last_practice_save_th: str | None = None
    predict_calls: int = 0
    draft_save_calls: int = 0
    active_sessions: int = 0
    survey_choice: Literal["willing", "not_willing"] | None = None
    pass_tier: str | None = None
    pass_source: Literal["paid", "promo_free", "team_member", "manual"] | None = None
    pass_expires_at_th: str | None = None
    pass_days_left: int | None = None
    pass_team_owner: str | None = None


class AdminGuestClientSchema(BaseModel):
    client_id: str
    active_days: int = 0
    first_visit: str | None = None
    last_visit: str | None = None
    predict_calls: int = 0
    device_type: str | None = None


class AdminUsersResponse(BaseModel):
    generated_at_th: str
    total_users: int
    users: list[AdminUserActivitySchema]
    top_guest_clients: list[AdminGuestClientSchema]


TelemetryMetricKey = Literal[
    "draft_completed_18",
    "practice_completed_18",
    "ai_adopt_top1",
    "ai_adopt_top2_5",
    "ai_adopt_top6_10",
    "ai_adopt_offmeta",
    "league_GLOBAL",
    "league_RPL",
    "league_GCS",
    "league_AOG",
    "league_INTL",
    "mode_bo1",
    "mode_bo3",
    "mode_bo5",
    "mode_bo7",
    "feat_timer_start",
    "feat_pick_lane",
    "feat_replace_hero",
    "feat_practice_hints_off",
    "tab_practice",
    "tab_analytics",
    "tab_plans",
    "tab_profile",
    "feat_scouting_pdf",
    "feat_hero_pools",
    "feat_global_ban",
    "feat_practice_history",
    "feat_practice_review",
    "draft_started",
    "practice_started",
    "auth_skip_guest",
]


class TelemetryEventRequest(BaseModel):
    events: dict[TelemetryMetricKey, int] = Field(default_factory=dict, max_length=20)
    client_id: str | None = Field(default=None, min_length=8, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")

    @field_validator("events")
    @classmethod
    def validate_event_counts(cls, value: dict[TelemetryMetricKey, int]) -> dict[TelemetryMetricKey, int]:
        for k, v in value.items():
            if v < 1 or v > 50:
                raise ValueError(f"Invalid event increment for {k}")
        return value


class TelemetryEventResponse(BaseModel):
    recorded: bool


class AdminAnalyticsResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    generated_at_th: str
    markov_retention: dict[str, Any]
    kaplan_meier_survival: dict[str, Any] = Field(default_factory=dict)
    btyd_alive: dict[str, Any] = Field(default_factory=dict)
    bayesian_wtp: dict[str, Any]
    member_vs_guest_retention: dict[str, Any]
    usage_distribution: dict[str, Any]
    load_forecast: dict[str, Any]
    ai_trust: dict[str, Any]
    latency: dict[str, Any]
    guest_vs_member_predicts: dict[str, Any]
    feature_usage: dict[str, Any]
    behavioral_signals: list[dict[str, Any]] = Field(default_factory=list)
    experiment_guardrails: dict[str, Any] = Field(default_factory=dict)
    user_btyd_scores: dict[str, dict[str, Any]] = Field(default_factory=dict)


class DailyVisitRequest(BaseModel):
    client_id: str = Field(..., min_length=8, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    device_type: Literal["mobile", "desktop"] | None = None


class DailyVisitResponse(BaseModel):
    recorded: bool
    visit_date: str


class PricingSurveyRequest(BaseModel):
    choice: Literal["willing", "not_willing"]
    client_id: str | None = Field(default=None, min_length=8, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")


class PricingSurveyResponse(BaseModel):
    recorded: bool
    choice: Literal["willing", "not_willing"]


class FeedbackSubmitRequest(BaseModel):
    message: str = Field(..., min_length=2, max_length=1500)
    client_id: str | None = Field(default=None, min_length=8, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    page_context: str | None = Field(default=None, max_length=32, pattern=r"^[a-zA-Z0-9_-]+$")

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str) -> str:
        clean = value.strip()
        if len(clean) < 2:
            raise ValueError("Feedback message must be at least 2 characters")
        if len(clean) > 1500:
            raise ValueError("Feedback message must not exceed 1500 characters")
        return clean


class FeedbackSubmitResponse(BaseModel):
    recorded: bool
    id: int
    created_at_th: str


class AdminFeedbackItemSchema(BaseModel):
    id: int
    message: str
    is_guest: bool
    username: str | None = None
    display_name: str | None = None
    email: str | None = None
    client_id: str | None = None
    page_context: str | None = None
    created_at_th: str


class AdminFeedbackResponse(BaseModel):
    generated_at_th: str
    total: int
    today: int
    member_total: int
    guest_total: int
    items: list[AdminFeedbackItemSchema]


class CombatBuildsSyncSchema(BaseModel):
    a: CombatBuildRequest | None = None
    b: CombatBuildRequest | None = None
    enable_kiting: bool = True
    enable_actives: bool = True
    updatedAt: int = Field(default=0, ge=0, le=9223372036854775807)


class PracticeHistoryEntrySchema(BaseModel):
    id: ShortStr
    signature: str = Field(min_length=1, max_length=512)
    recordedAt: str = Field(min_length=1, max_length=64)
    gameNumber: int = Field(default=1, ge=1, le=7)
    gameCount: Literal[1, 3, 5, 7] = 1
    startingSide: Literal["blue", "red"] = "blue"
    playerSide: Literal["blue", "red"] = "blue"
    bluePicks: list[ShortStr] = Field(min_length=5, max_length=5)
    redPicks: list[ShortStr] = Field(min_length=5, max_length=5)
    blueBans: list[ShortStr] = Field(default_factory=list, max_length=4)
    redBans: list[ShortStr] = Field(default_factory=list, max_length=4)
    playerEstimate: FinitePct = 50.0
    previousEstimates: dict[int, FinitePct | None] | None = Field(default=None, max_length=7)
    globalBans: GlobalBanStateSchema | None = None
    seriesGames: list[RecordedDraftGameSchema] | None = Field(default=None, max_length=7)

    @field_validator("previousEstimates")
    @classmethod
    def validate_previous_estimate_keys(cls, value: dict[int, float | None] | None) -> dict[int, float | None] | None:
        if value is None:
            return None
        for key in value:
            if key < 1 or key > 7:
                raise ValueError("Game number in previousEstimates must be between 1 and 7")
        return value


class PracticeHistorySyncSchema(BaseModel):
    entries: list[PracticeHistoryEntrySchema] = Field(default_factory=list, max_length=1000)
    updatedAt: int = Field(default=0, ge=0, le=9223372036854775807)
    deletedIds: list[ShortStr] = Field(default_factory=list, max_length=100)
    clearedAt: int = Field(default=0, ge=0, le=9223372036854775807)

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator

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
    ally_picks: list[str] = Field(
        default_factory=list,
        max_length=5,
        description="Heroes already picked by the acting team (0 to 4 heroes if mode='pick', up to 5 if mode='ban')",
    )
    enemy_picks: list[str] = Field(
        default_factory=list,
        max_length=5,
        description="Heroes already picked by the opposing team (0 to 5 heroes)",
    )
    ally_bans: list[str] = Field(
        default_factory=list,
        max_length=4,
        description="Heroes already banned by the acting team (0 to 4 heroes)",
    )
    enemy_bans: list[str] = Field(
        default_factory=list,
        max_length=4,
        description="Heroes already banned by the opposing team (0 to 4 heroes)",
    )
    global_bans: list[str] = Field(
        default_factory=list,
        description="Heroes unavailable due to Global Ban Pick rule from previous games in the series",
    )
    blue_global_bans: list[str] = Field(
        default_factory=list,
        description="Heroes unavailable specifically for Blue team due to being used in previous games",
    )
    red_global_bans: list[str] = Field(
        default_factory=list,
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
    series_winning_heroes: list[str] = Field(
        default_factory=list,
        description="Heroes that won previous games in the current series and remain available for steal-pick or target-ban adaptation",
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
    architecture: str
    num_heroes: int
    val_loss: float
    dataset_metadata: dict[str, Any] | None = None


class CombatBuildRequest(BaseModel):
    hero: str
    level: StrictInt = Field(default=1, ge=1, le=15)
    items: list[str] = Field(default_factory=list, max_length=6)
    arcana: dict[str, StrictInt] = Field(default_factory=dict, description="Tier 3 arcana name -> slot count")
    primary_faction: str | None = None
    primary_enchantments: list[str] = Field(default_factory=list, max_length=3)
    secondary_faction: str | None = None
    secondary_enchantments: list[str] = Field(default_factory=list, max_length=2)
    skill_levels: dict[str, StrictInt] = Field(default_factory=dict, description="Override auto skill point allocation")
    skill_hits: dict[str, StrictInt] = Field(default_factory=dict, description="Hits per cast for multi-hit skills")
    skill_charges: dict[str, float] = Field(
        default_factory=dict, description="Charge ratio (0.0 to 1.0) for charging skills"
    )
    active_combo_slots: list[str] | None = Field(default=None, description="Active skill slots included in combo/duel")
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
    stepIndex: int = Field(default=0, ge=0, le=18)
    bluePicks: list[str] = Field(default_factory=list)
    redPicks: list[str] = Field(default_factory=list)
    blueBans: list[str] = Field(default_factory=list)
    redBans: list[str] = Field(default_factory=list)


class GlobalBanStateSchema(BaseModel):
    seriesName: str = Field(default="", description="Optional custom or derived series matchup name e.g. BRU vs FS")
    teamAName: str = "TEAM A"
    teamBName: str = "TEAM B"
    teamAUsed: list[str] = Field(default_factory=list)
    teamBUsed: list[str] = Field(default_factory=list)
    universalBans: list[str] = Field(default_factory=list)
    blueSideTeam: Literal["A", "B"] = "A"
    gameNumber: int = Field(default=1, ge=1, le=7)


class RecordedDraftGameSchema(BaseModel):
    id: str
    gameNumber: int = Field(default=1, ge=1, le=7)
    timestamp: str
    seriesName: str = Field(default="", description="Group or series matchup name e.g. BRU vs FS")
    blueTeamName: str
    redTeamName: str
    blueSideTeam: Literal["A", "B"] = "A"
    blueBans: list[str] = Field(default_factory=list)
    redBans: list[str] = Field(default_factory=list)
    bluePicks: list[str] = Field(default_factory=list)
    redPicks: list[str] = Field(default_factory=list)
    blueWinRate: float = 50.0
    winner: Literal["A", "B"] | None = None


class DraftSessionStateSchema(BaseModel):
    stepIndex: int = Field(default=0, ge=0, le=18)
    bluePicks: list[str] = Field(default_factory=list)
    redPicks: list[str] = Field(default_factory=list)
    blueBans: list[str] = Field(default_factory=list)
    redBans: list[str] = Field(default_factory=list)
    history: list[DraftHistoryItemSchema] = Field(default_factory=list)
    winHistory: list[float | None] = Field(default_factory=list)
    blueWinRate: float = 50.0
    useLookahead: bool = False
    engine: Literal["sota", "heuristic", "matrix"] = "sota"
    league: Literal["RPL", "AOG", "GCS", "INTL", "APL", "AIC", "GLOBAL"] = "GLOBAL"
    globalBans: GlobalBanStateSchema = Field(default_factory=GlobalBanStateSchema)
    seriesGames: list[RecordedDraftGameSchema] = Field(default_factory=list)
    updatedAt: int = Field(default=0, description="Epoch milliseconds of last state update")


class AuthRegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=6, max_length=128)
    display_name: str | None = Field(default=None, max_length=40)


class AuthLoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=1, max_length=128)


class AuthUserSchema(BaseModel):
    id: int
    username: str
    display_name: str


class AuthStatusResponse(BaseModel):
    authenticated: bool
    user: AuthUserSchema | None = None


class CombatBuildsSyncSchema(BaseModel):
    a: CombatBuildRequest | None = None
    b: CombatBuildRequest | None = None
    enable_kiting: bool = True
    enable_actives: bool = True
    updatedAt: int = Field(default=0, ge=0)

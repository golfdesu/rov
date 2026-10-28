from typing import Literal

from pydantic import BaseModel, Field


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
        le=20,
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


class CombatBuildRequest(BaseModel):
    hero: str
    level: int = Field(default=1, ge=1, le=15)
    items: list[str] = Field(default_factory=list, max_length=6)
    arcana: dict[str, int] = Field(default_factory=dict, description="Tier 3 arcana name -> slot count")
    primary_faction: str | None = None
    primary_enchantments: list[str] = Field(default_factory=list, max_length=3)
    secondary_faction: str | None = None
    secondary_enchantments: list[str] = Field(default_factory=list, max_length=2)
    skill_levels: dict[str, int] = Field(default_factory=dict, description="Override auto skill point allocation")
    skill_hits: dict[str, int] = Field(default_factory=dict, description="Hits per cast for multi-hit skills")
    skill_charges: dict[str, float] = Field(
        default_factory=dict, description="Charge ratio (0.0 to 1.0) for charging skills"
    )
    active_combo_slots: list[str] | None = Field(default=None, description="Active skill slots included in combo/duel")


class CombatStatsRequest(BaseModel):
    build: CombatBuildRequest
    target: CombatBuildRequest | None = Field(default=None, description="Optional target for skill damage")


class CombatDuelRequest(BaseModel):
    a: CombatBuildRequest
    b: CombatBuildRequest


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
    globalBans: GlobalBanStateSchema = Field(default_factory=GlobalBanStateSchema)
    seriesGames: list[RecordedDraftGameSchema] = Field(default_factory=list)
    updatedAt: int = Field(default=0, description="Epoch milliseconds of last state update")

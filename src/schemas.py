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


class DraftPredictionResponse(BaseModel):
    architecture: str
    mode: Literal["pick", "ban"]
    side: Literal["blue", "red"]
    phase: int
    missing_ally_lanes: list[str]
    recommendations: list[HeroRecommendation]


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    architecture: str
    num_heroes: int
    val_loss: float

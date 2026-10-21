"""Draft states replayed from real pro games, used to pin predictor output across refactors."""

import json

from src.config import config
from src.schemas import DraftStateRequest

# (step_idx, phase, action, side) of the 18 tournament draft steps
_STEPS = [
    (1, "ban", "blue"), (1, "ban", "red"), (1, "ban", "blue"), (1, "ban", "red"),
    (1, "pick", "blue"), (1, "pick", "red"), (1, "pick", "red"), (1, "pick", "blue"),
    (1, "pick", "blue"), (1, "pick", "red"),
    (2, "ban", "red"), (2, "ban", "blue"), (2, "ban", "red"), (2, "ban", "blue"),
    (2, "pick", "red"), (2, "pick", "blue"), (2, "pick", "blue"), (2, "pick", "red"),
]  # fmt: skip

GAME_INDICES = (0, 1000, 2500, 4100)
STEP_INDICES = (0, 3, 4, 6, 9, 10, 13, 15, 17)


def golden_requests() -> list[tuple[str, DraftStateRequest]]:
    """Replays a few real games to several draft steps, with and without lookahead."""
    matches = json.loads(config.paths.matches_json_path.read_text(encoding="utf-8"))
    out: list[tuple[str, DraftStateRequest]] = []
    for g in GAME_INDICES:
        m = matches[g]
        for step in STEP_INDICES:
            done = {("blue", "pick"): 0, ("red", "pick"): 0, ("blue", "ban"): 0, ("red", "ban"): 0}
            for phase, action, side in _STEPS[:step]:
                done[(side, action)] += 1
            phase, action, side = _STEPS[step]
            other = "red" if side == "blue" else "blue"
            for lookahead in (False, True):
                req = DraftStateRequest(
                    mode=action,
                    side=side,
                    phase=phase,
                    ally_picks=m[f"{side}_picks"][: done[(side, "pick")]],
                    enemy_picks=m[f"{other}_picks"][: done[(other, "pick")]],
                    ally_bans=m[f"{side}_bans"][: done[(side, "ban")]],
                    enemy_bans=m[f"{other}_bans"][: done[(other, "ban")]],
                    top_k=20,
                    use_lookahead=lookahead,
                )
                out.append((f"g{g}_s{step}_{'la' if lookahead else 'nola'}", req))
    return out

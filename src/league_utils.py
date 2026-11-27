"""Zero-dependency regional league conditioning helpers shared across training and inference."""

from __future__ import annotations

# Order: 0 = RPL (TH), 1 = AOG (VN), 2 = GCS (TW), 3 = INTL (APL / AIC)
LEAGUE_NAMES = ("RPL", "AOG", "GCS", "INTL")
# Grounded in APL+AIC 2025-2026 international win rates: RPL (53.7%), GCS (52.3%), AOG (44.7%)
PERFORMANCE_GLOBAL_LEAGUE_WEIGHTS = (0.32, 0.20, 0.30, 0.18)
# Rebalances domestic match volume (AOG=34.5%, RPL=31.0%, GCS=19.0% 6-team league, INTL=15.5%)
LEAGUE_SAMPLE_WEIGHTS = (1.05, 0.75, 1.35, 1.15)


def encode_league_id(league_str: str) -> int:
    """Map tournament/league string to canonical index: 0=RPL, 1=AOG, 2=GCS, 3=INTL."""
    s = str(league_str or "").strip().upper()
    if "RPL" in s or "ROV PRO LEAGUE" in s:
        return 0
    if "AOG" in s or "ARENA OF GLORY" in s:
        return 1
    if "GCS" in s or "GARENA CHALLENGER" in s:
        return 2
    return 3


def get_league_vector(league_mode: str = "GLOBAL") -> tuple[float, float, float, float]:
    """Return 4-dim regional conditioning vector (RPL, AOG, GCS, INTL)."""
    mode = str(league_mode or "GLOBAL").strip().upper()
    if mode in ("RPL", "TH", "ROV PRO LEAGUE"):
        return (1.0, 0.0, 0.0, 0.0)
    if mode in ("AOG", "VN", "ARENA OF GLORY"):
        return (0.0, 1.0, 0.0, 0.0)
    if mode in ("GCS", "TW", "GARENA CHALLENGER SERIES"):
        return (0.0, 0.0, 1.0, 0.0)
    if mode in ("INTL", "APL", "AIC"):
        return (0.0, 0.0, 0.0, 1.0)
    return PERFORMANCE_GLOBAL_LEAGUE_WEIGHTS

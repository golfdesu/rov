"""Generate high-precision numerical skill data for all 63 RoV heroes."""

PATCHES: dict[str, list[dict]] = {}


def add_hero(name: str, skills: list[dict]):
    PATCHES[name] = skills

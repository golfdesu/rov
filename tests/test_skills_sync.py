"""`.agents/skills/` is the source of truth; `.claude/skills/` is a copy so Claude Code discovers them.

After editing a skill, re-copy it:  cp -r .agents/skills/. .claude/skills/
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / ".agents" / "skills"
MIRROR = ROOT / ".claude" / "skills"


def _files(base: Path) -> dict[str, bytes]:
    return {
        p.relative_to(base).as_posix(): p.read_bytes().replace(b"\r\n", b"\n")
        for p in base.rglob("*")
        if p.is_file() and "__pycache__" not in p.parts
    }


def test_claude_skills_mirror_agents_skills():
    source, mirror = _files(SOURCE), _files(MIRROR)
    assert source, f"no skills found in {SOURCE}"
    assert sorted(source) == sorted(mirror), "file lists differ; re-copy .agents/skills/ to .claude/skills/"
    stale = [name for name in source if source[name] != mirror[name]]
    assert not stale, f"out of date in .claude/skills/: {stale}"


def test_every_skill_has_frontmatter_name_matching_folder():
    for skill_md in SOURCE.glob("*/SKILL.md"):
        lines = skill_md.read_text(encoding="utf-8").splitlines()
        assert lines[0] == "---", f"{skill_md} must start with YAML frontmatter"
        name = next(line.split(":", 1)[1].strip() for line in lines if line.startswith("name:"))
        assert name == skill_md.parent.name, f"{skill_md}: name '{name}' != folder '{skill_md.parent.name}'"

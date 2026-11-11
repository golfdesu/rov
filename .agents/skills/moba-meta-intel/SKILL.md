---
name: moba-meta-intel
description: >-
  Professional tournament meta analytics engine for RPL, APL, AIC, AOG, and GCS (4,329 pro games).
  Extracts contested pick/ban rates, lane presence, duo/trio synergies, flex-pick versatility,
  counter-pick effectiveness, and win-rate trends across seasons (2024-2026).
---

# RoV MOBA Meta Intelligence Skill

Use this skill to query, analyze, and synthesize competitive esports draft data across **4,329 professional games** from RPL, APL, AIC, AOG, and GCS tournaments. Incorporates patch recency weighting, hand-maintained tier overrides (`data/hero_tier_overrides.json`), patch history alignment (`data/hero_patch_history.json`), and Bayesian smoothed win rates.

---

## 1. Quick Programmatic Meta Queries

```bash
# 1. Dataset Overview
python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --summary

# 2. Patch-Aware Tier List with Overrides and Patch Badges (Top 25)
python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --tier-list --top 25

# 3. Emerging Meta Surge (Top rising heroes in 2026 vs past baseline)
python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --emerging --top 15

# 4. Deep Hero Profile with Patch History & Override Reasoning
python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --hero-stats Evita --verbose
python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --hero-stats Zanis --verbose

# 5. Flex-Lane Versatility (Heroes played in 2+ roles with >= 15% share)
python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --flex-picks

# 6. Top Winning Duo Synergies (Carry + Support / Jungle duos with >= 20 games)
python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --duo-synergy --min-games 20

# 7. Raw Unweighted / No-Override Historical Analysis
python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --tier-list --all-time --no-overrides
```

---

## 2. Analytical Capabilities & Use Cases

1. **Patch-Aware & Recency-Weighted Meta Tiers**:
   - Uses recency weighting (2026 = 1.0, 2025 = 0.5, 2024 = 0.2) to prevent obsolete past seasons from diluting current priorities.
   - Integrates `data/hero_tier_overrides.json` for heroes with low pro tournament sample size lag, newly released champions (e.g. `Evita [S*]`, `Tamyn [S*]`), and recent balance reworks (e.g. `Zanis [A*]`, `Ata [A*]`).
   - Displays patch alignment badges directly from `data/hero_patch_history.json` (e.g. `[BUFF 10/26]`, `[NEW 2026]`, `[NERF 10/26]`).
   - Uses Laplace Bayesian smoothed win rates `(wins + 3.0) / (picks + 6.0) * 100` to prevent low-sample win rate distortions.
2. **Emerging Meta Surge (`--emerging`)**:
   - Calculates pick/ban rate surge delta between current 2026 season and historical baseline (2024–2025).
   - Instantly highlights rising champions, playoff pocket picks, and high-velocity meta shifters.
3. **Flex Pick Detection (`--flex-picks`)**:
   - Identifies multi-lane versatility (e.g. Eland'orr Dragon/Jungle, Marja Mid/DS, Taara DS/Jungle/Roam).
   - Helps drafting coaches execute flex pick strategies that disguise composition intent.
4. **Synergy Edge Mining (`--duo-synergy`)**:
   - Evaluates win rates of paired heroes across competitive tournaments to discover high-synergy combinations.
5. **Side Asymmetry & Deep Profiles (`--hero-stats`)**:
   - Evaluates Blue Side vs Red Side win rates and top 5 most frequent tournament teammates.

---

## 3. Data Integrity & Mapping Rules

1. **Canonical Names Only**: Always query using official Thai server names (`Mortos`, `Celica`, `Riktor`). The script normalizes legacy Liquipedia aliases (`Arthur`, `Brunhilda`, `Richter`) automatically.
2. **2024 Exclusion for Active Meta**: When answering questions about the *current* meta, filter by `--min-year 2025` or specific 2026 tournaments to eliminate obsolete 2024 hero dynamics.

---

## 4. Related Skills

- [`rov-data-guardian`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/rov-data-guardian/SKILL.md): Manages canonical datasets, hero skills, and `data/hero_tier_overrides.json`.
- [`draft-screenshot-reader`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/draft-screenshot-reader/SKILL.md): Ingests true chronological pick orders from broadcast screenshots into `data/true_pick_order.json`.
- [`rov-draft-serving`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/rov-draft-serving/SKILL.md): Serves recommendations and draft prediction models in API and web UI.

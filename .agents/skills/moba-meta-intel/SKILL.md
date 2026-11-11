---
name: moba-meta-intel
description: >-
  Professional tournament meta analytics engine for RPL, APL, AIC, AOG, and GCS (4,329 pro games).
  Extracts contested pick/ban rates, lane presence, duo/trio synergies, flex-pick versatility,
  counter-pick effectiveness, and win-rate trends across seasons (2024-2026).
---

# RoV MOBA Meta Intelligence Skill

Use this skill to query, analyze, and synthesize competitive esports draft data across **4,329 professional games** from RPL, APL, AIC, AOG, and GCS tournaments.

---

## 1. Quick Programmatic Meta Queries

```bash
# 1. Dataset Overview
python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --summary

# 2. Tournament Tier List (Top 15 Contested Heroes in RPL 2026)
python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --tier-list --league RPL --top 15

# 3. Flex-Lane Versatility (Heroes played in 2+ roles)
python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --flex-picks

# 4. Top Winning Duo Synergies (e.g. Carry + Support duos with >= 15 games)
python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --duo-synergy --min-games 15

# 5. Deep Hero Profile
python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --hero-stats Capheny
```

---

## 2. Analytical Capabilities & Use Cases

1. **Meta Tier Classification**:
   - Analyzes **Presence Rate** (`(Picks + Bans) / Total Games`):
     - **Tier S+ (Perma-ban / Priority)**: Presence >= 80% (e.g. Dolia, Rouie, Eland'orr).
     - **Tier S (Meta Staples)**: Presence 50%–79% (e.g. Florentino, Stuart, Toro).
     - **Tier A (Reliable Core)**: Presence 25%–49% (e.g. Skud, Liliana, Keera).
     - **Tier B (Situational / Pocket)**: Presence 10%–24%.
2. **Flex Pick Detection**:
   - Identifies heroes deployed across multiple competitive roles (e.g. Mina, Maloch, Amily, Erin, Ata, Zanis).
   - Prevents draft predictability by understanding when a pick disguises team strategy.
3. **Synergy Edge Mining**:
   - Evaluates win rates of paired heroes vs their isolated baseline win rates.
   - Discovers high-synergy wombo-combos (e.g. Rouie + Capheny/Eland'orr, Maloch + Iggy).
4. **Blue vs Red Side Asymmetry**:
   - Evaluates First Pick advantage (Blue Side) vs Counter Pick advantage (Red Side Last Pick).

---

## 3. Data Integrity & Mapping Rules

1. **Canonical Names Only**: Always query using official Thai server names (`Mortos`, `Celica`, `Riktor`). The script normalizes legacy Liquipedia aliases (`Arthur`, `Brunhilda`, `Richter`) automatically.
2. **2024 Exclusion for Active Meta**: When answering questions about the *current* meta, filter by `--min-year 2025` or specific 2026 tournaments to eliminate obsolete 2024 hero dynamics.

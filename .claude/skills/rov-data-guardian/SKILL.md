---
name: rov-data-guardian
description: >-
  Audits, validates, and updates the 130 RoV hero skill database, the 4,329 professional
  tournament draft records, and the screenshot-verified true pick order dataset. Use this
  skill whenever inspecting data integrity, adding a new RoV hero (131st+), scraping new
  tournament matches from Liquipedia, rebuilding synergy/counter graph matrices, or editing
  data/true_pick_order.json.
---

# RoV Data Guardian & Schema Integrity Skill

Use this skill to verify and maintain the canonical datasets in `data/` without introducing hero name mismatches or corrupting draft phase sequences.

---

## 1. Quick Programmatic Audit (Run First and Last)

```bash
python .agents/skills/rov-data-guardian/scripts/audit_rov_data.py
```

It checks:
- 130 heroes in `heroes_130_full.json`, `heroes_130_summary.csv`, `hero_draft_stats.csv`
- every game in `matches_draft_full.json` has 5 + 5 picks and 0 unmapped hero names
- every game in `true_pick_order.json` exists in Liquipedia data (`series_id` + `game_number`), has no duplicate entry, uses exactly the same 5 heroes per side (only the order may differ), has `source` = `screenshot` / `manual`, and its screenshot file exists
- every entry in `hero_tier_overrides.json` corresponds to a valid hero in the 130-hero catalog and assigns a valid tier (`S+`, `S`, `A`, `B`, `C`, `D`)

---

## 2. Critical Data Invariants (NEVER VIOLATE)

1. **Exact 130 Hero Count (Up to Evita & Tamyn)**:
   - 129 unique hero names up to **Evita** (Oct 2026) and **Tamyn** (Jul 2026), plus **Flowborn** as two role/skill entries, `Flowborn (Marksman)` and `Flowborn (Mage)`: **130 heroes**.
   - Every hero in `data/heroes_130_full.json` MUST have `>= 4` skills and all 10 boolean capability flags (`has_true_damage`, `has_physical_damage`, `has_magic_damage`, `has_hard_cc`, `has_soft_cc`, `has_suppress`, `has_mobility`, `has_immunity`, `has_heal_sustain`, `has_shield`).
2. **Liquipedia Draft Column Ordering Trap**:
   - `t1b1..t1b4` / `t2b1..t2b4` are chronological: **Ban Phase 1** (`b1, b2`) then **Ban Phase 2** (`b3, b4`).
   - `t1h1..t1h5` / `t2h1..t2h5` are ordered by the **5 in-game lanes** (`h1 = DS_Lane`, `h2 = Jungle`, `h3 = Mid`, `h4 = Dragon_Lane`, `h5 = Roam`), **NOT** pick order.
   - So `src/build_draft_stats.py` uses `h1..h5` positions for lane distributions, and `src/train_sota_model.py` uses `order_team_picks_by_draft_logic()` to estimate Phase 1 (`P1..P3`) vs Phase 2 (`P4..P5`) picks.
   - That estimate is only about 54% right per pick slot and 79% right on phase (measured on screenshot games, see `CHANGELOG.md`). Prefer `data/true_pick_order.json` wherever a game has it.
3. **Hero Alias Normalization**:
   - Normalize Liquipedia aliases (`"Richter" -> "Riktor"`, `"Arthur" -> "Mortos"`, `"Brunhilda" -> "Celica"`, `"Diaochan" -> "Diao Chan"`) so there are **0 unmapped hero names**.
   - Thai server names (`Mortos`, `Celica`, `Riktor`) are the canonical default across `data/`, the model checkpoint, and the web UI.
4. **Training Dataset vs. Match Archive (2024 Exclusion)**:
   - `data/matches_draft_full.json` (4,329 games) is the historical archival repository covering 2024–2026.
   - `data/matches_training.json` is the **curated training dataset** containing **3,512 games strictly from 2025–2026**.
   - All 817 games from 2024 are excluded to prevent legacy meta noise and obsolete pick habits from polluting the SOTA model.
   - Includes all 1,810 games from 2026 with 100% verified true pick order.
   - True Pick Order coverage is 51.5% (1,810 / 3,512 games).
   - Rebuild tool: `python src/build_training_dataset.py --min-year 2025`.

---

## 3. True Pick Order Dataset (`data/true_pick_order.json`)

- `{"description", "pick_turn_order", "games": [...]}`; each game has `series_id`, `game_number`, `date`, `blue_team`, `red_team`, `blue_picks` / `red_picks` in true chronological order, `source` (`screenshot` / `manual`), and `screenshot` (path relative to `data/draft_screenshots/`).
- Ban order is NOT stored there: Liquipedia `blue_bans` / `red_bans` are already chronological.
- To add games from broadcast screenshots, follow the `draft-screenshot-reader` skill.

---

## 4. Standard Update Pipeline

If a new tournament or hero is added, run in strict sequence:
```bash
python src/scrape_heroes.py
python src/scrape_matches.py
python src/build_draft_stats.py
python .agents/skills/rov-data-guardian/scripts/audit_rov_data.py
pytest tests/test_data_integrity.py -v
```

Changing match data or stats changes predictor output, so `tests/test_predictor_golden.py` will fail. That is expected: regenerate the golden fixture (see `rov-draft-serving`) and note it in `CHANGELOG.md`.

---

## 5. Hero Tier Overrides (`data/hero_tier_overrides.json`)

- Provides hand-maintained tier corrections for newly released champions, recent reworks, or high-ban pocket picks that suffer from tournament sample lag (e.g. `Evita`, `Tamyn`, `Zanis`, `Ata`).
- Each entry in `overrides` specifies `tier` (`S+`, `S`, `A`, `B`, `C`, `D`) and a mandatory `reason` string.
- Audited automatically by `audit_rov_data.py` and tested by `test_data_integrity.py`.
- Consumed by `src/api.py` (populates `/heroes` details) and `moba-meta-intel` (`scripts/query_meta_intel.py --tier-list`).

---

## 6. Off-Limits

`data/vod_analytics/` is the owner's paused WIP. Never read, modify, move, or "tidy" anything there unless the user mentions it first in the current session.

---

## 7. Related Skills

- [`draft-screenshot-reader`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/draft-screenshot-reader/SKILL.md): Read true chronological pick order from broadcast screenshots to extend `data/true_pick_order.json`.
- [`moba-meta-intel`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/moba-meta-intel/SKILL.md): Query tournament meta intelligence, patch recency, and tier list overrides across all 4,329 games.
- [`rov-draft-serving`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/rov-draft-serving/SKILL.md): Serve API and web UI, run CLI predictions, and verify golden test suites.
- [`regression-guard`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/regression-guard/SKILL.md): Automated regression testing against 72 pro draft states and combat duel benchmarks.

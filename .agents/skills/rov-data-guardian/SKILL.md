---
name: rov-data-guardian
description: >-
  Audits, validates, and updates the 130 RoV hero skill database and 4,208 professional
  tournament draft records. Use this skill whenever inspecting data integrity, adding a
  new RoV hero (131st+), scraping new tournament matches from Liquipedia, or rebuilding
  synergy/counter graph matrices.
---

# RoV Data Guardian & Schema Integrity Skill

Use this skill to verify and maintain the canonical datasets in `data/` without introducing hero name mismatches or corrupting draft phase sequences.

---

## 1. Quick Programmatic Audit (Run First)

Before modifying any data or training script, run the automated audit script:
```bash
python .agents/skills/rov-data-guardian/scripts/audit_rov_data.py
```

---

## 2. Critical Data Invariants (NEVER VIOLATE)

1. **Exact 130 Hero Count (Up to Evita & Tamyn)**:
   - There are 129 unique hero names in RoV up to **Evita** (Oct 2026) and **Tamyn** (Jul 2026), and **Flowborn** has two distinct role/skill entries: `Flowborn (Marksman)` and `Flowborn (Mage)`, totaling **130 heroes**.
   - Every hero in `data/heroes_130_full.json` MUST have `>= 4` skills and all 10 boolean combat capability flags (`has_true_damage`, `has_physical_damage`, `has_magic_damage`, `has_hard_cc`, `has_soft_cc`, `has_suppress`, `has_mobility`, `has_immunity`, `has_heal_sustain`, `has_shield`).
2. **Liquipedia Draft Column Ordering Trap**:
   - In Liquipedia HTML tables (`src/scrape_matches.py`), `t1b1..t1b4` and `t2b1..t2b4` are chronological **Ban Phase 1** (`b1, b2`) and **Ban Phase 2** (`b3, b4`).
   - However, `t1h1..t1h5` and `t2h1..t2h5` are ordered by the **5 in-game lanes** (`h1 = DS_Lane`, `h2 = Jungle`, `h3 = Mid`, `h4 = Dragon_Lane`, `h5 = Roam`), **NOT** chronological pick order!
   - Therefore:
     - `src/build_draft_stats.py` uses `h1..h5` slot positions to compute exact pro lane distributions.
     - `src/train_sota_model.py` uses `order_team_picks_by_draft_logic()` (combining Enemy Phase 2 Ban lane targeting + hero presence priority) to reconstruct Phase 1 (`P1..P3`) vs Phase 2 (`P4..P5`) pick sequences.
3. **Hero Alias Normalization**:
   - Always normalize Liquipedia aliases (`"Riktor" -> "Richter"`, `"Diaochan" -> "Diao Chan"`, `"Chaugnar"`, etc.) so there are **0 unmapped hero names** across all 4,208 games.

---

## 3. Standard Update Pipeline

If a new tournament or hero is added, execute these 3 scripts in strict sequence:
```bash
python src/scrape_heroes.py
python src/scrape_matches.py
python src/build_draft_stats.py
python .agents/skills/rov-data-guardian/scripts/audit_rov_data.py
```

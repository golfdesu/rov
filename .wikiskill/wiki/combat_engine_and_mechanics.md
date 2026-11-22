# Combat Engine, Skill Mechanics & 130x130 Matchups

The deterministic combat simulation subsystem (`src/combat_calculator.py` and `src/skill_mechanics.py`) powers both the dev-only **Stat & Duel Lab** (`/#lab`) and the **130 x 130 mechanical matchup discovery** pipeline (`scripts/discover_mechanical_matchups.py`).

---

## 1. Core Mathematical Invariants (`src/combat_calculator.py`)

- **Armor & Magic Defense Mitigation Formula**:
  ```text
  mitigation = 600 / (600 + max(0, (def - flat_pierce) * (1 - pct_pierce)))
  ```
  Flat and percentage pierce values are parsed directly from item passive descriptions (`data/items.json`).
- **Stat Aggregation**:
  - Combines hero level scaling (`data/hero_level_stats.json`, Lv. 1–15) + 6-slot items (`items.json`) + 30 Tier-III Arcana slots (`data/arcana.json`) + 5 Enchantment slots (`data/enchantments.json`), enforcing the 40% CDR cap.
- **Known Data Gaps (Do Not Fabricate)**:
  - `hero_level_stats.json` lacks per-level attack speed and mana growth; `BASE_ATTACKS_PER_SEC = 1.0` is assumed as the baseline attack rate.
  - Only enchantments explicitly registered in `ENCHANTMENT_EFFECTS` alter combat numbers; their parsed numerical values are pending full in-game verification. Never invent values for unregistered enchantments.

---

## 2. Full-Roster Mechanics Coverage (`src/skill_mechanics.py`)

- Covers **130 / 130 heroes and all 534 skills** (verified via in-game screenshots in `heroes/*/skill/` and `heroes/*/status/`) using a `dt = 0.05s` simulation step.
- Models **stack & stateful passives** (`HERO_STACK_PASSIVES`, `STATEFUL_PASSIVE_HEROES`—e.g., `Omen` Thirst, `Mina` Sweet Revenge, `Kil'Groth` The Fanatic, `Stuart` Drain Charge, `Thane` Royal Power, `Dirak` Arcane Body, `Maloch` Plunder, `Tachi` Spellbound, `Yue` Borrowed Might), **133+ active/passive skill overrides** (`HERO_SKILL_EFFECTS`: shields, heals, DR, invulnerability frames, defense shreds, CD resets), and **poke spacing** (`compute_kite_params()`, e.g., `Yue` vs `Ilumia`).

---

## 3. 130x130 Matchup Discovery & Counter-Item Flips

Documented in full in [`docs/MECHANICAL_MATCHUP_DISCOVERY.md`](../../docs/MECHANICAL_MATCHUP_DISCOVERY.md):

- **Scale**: `8,385` unique pairs = **`16,770` directional 1v1 matchups** simulated across **3 game stages** (`25,155` duels total):
  - **Early (`Lv.4`)**: Boots + starter item + Arcana + Enchantments.
  - **Mid (`Lv.10`)**: Boots + 2 core role/archetype items (including `Bruiser_OnHit`).
  - **Late (`Lv.15`)**: Full 6-item build + actives + ranged kiting.
- **Single-Item Counter Flips (`data/counter_item_flips.csv`)**: Discovered **`235` Lv.15 matchup reversals** triggered by swapping 1 defensive/anti-heal item:
  - `Medallion of Troy`: `149` reversals (anti-AP burst)
  - `Mail of Pain`: `57` reversals (anti-physical DPS/crit)
  - `Curse of Death`: `16` reversals (`40%` physical anti-heal)
  - `Soul Scroll`: `13` reversals (`40%` magic anti-heal)

---

## Related Wiki Articles

- [`system_architecture_and_data.md`](system_architecture_and_data.md)
- [`../../docs/MECHANICAL_MATCHUP_DISCOVERY.md`](../../docs/MECHANICAL_MATCHUP_DISCOVERY.md)

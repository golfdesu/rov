# 130 x 130 Mechanical + Full 534-Skill / Passive / Item Matchup Discovery

> [!IMPORTANT]
> **Ground-Truth Data Sources**
> - **130 / 130 Heroes / All 534 Skills (100% Coverage)** (`8,385` unique pairs = `16,770` directional matchups) simulated via the upgraded `CombatEngine` ([src/combat_calculator.py](file:///C:/Users/chaya/Documents/Program/Project/ROV/src/combat_calculator.py)) + [src/skill_mechanics.py](file:///C:/Users/chaya/Documents/Program/Project/ROV/src/skill_mechanics.py) (`dt = 0.05s`).
> - **Combat Simulation Mechanics Modeled Live**:
>   - **Stack & Stateful Passives (`HERO_STACK_PASSIVES` & `STATEFUL_PASSIVE_HEROES`)**: `Omen` (`Thirst`: +25+2%/Lv AS, +60 True Dmg/hit, +25% double-strike, -1s S1/S2 CD/hit), `Bijan` (`Sand's Gift` + heal), `Max` (`Static Shock` True DoT + 40% anti-heal), `Taara` (`Fighting Spirit`), `Mina` (`Sweet Revenge` True spin + heal), `Kil'Groth` (`The Fanatic` +70% AS), `Stuart` (`Drain Charge` +80% AS), `Errol`, `Dextra`, `Elsu`, `Thorne`, `Keera`, `Wukong`, `Arduin`, `Thane` (`Royal Power` <30% HP: 40% DR + 24% Max HP HoT, 75s CD), `Zephys` (missing-HP DR up to 33.3%), `Dirak` (`Arcane Body`: 1 Mana absorbs 1.5 lethal overflow damage), `Amily` (`Duel` +50% 1v1 normal attack), `Maloch` (`Plunder` true-dmg `Cleave` + heal), `Tachi` (`Spellbound` 4-mark shield/heal/true dmg), `Yue` (`Borrowed Might` 2x sweet spot + CD reset), `Ilumia` (`Goddess` stack + empowered S1), `Flowborn`, plus ~38 additional stack/proc passives across the roster.
>   - **100% Auto-Extracted + Curated Skill Effects (`133+` Active/Passive Overrides in `HERO_SKILL_EFFECTS`)**: Shields (`shield_base/ad/ap/own_hp_pct/max_hp_pct`), heals (`heal_base/ad/ap/lost_hp_pct/max_hp_pct`), DR (`dr_pct`), invulnerability (`Keera` S2, `Riktor` S2, `Zata` Ult, `Dextra`/`Allain`/`Errol`/`Marja`), defense shreds (`opp_armor_shred`, `opp_mdef_shred`, `opp_def_shred_pct`), bonus pierce/lifesteal, CD resets (`Airi` Ult->S2, `Lauriel` S3 zone, `Yue`, `Ilumia`), and poke-mage vs immobile-mage spacing in `compute_kite_params()` (`Yue` vs `Ilumia`).
> - **3 Game Stages (`25,155` Duels)**:
>   - **Early (`Lv.4`)**: Boots + starter item + 30 Tier-III Arcana + 5 Enchantments.
>   - **Mid (`Lv.10` 3-Item Spike)**: Boots + 2 core role/archetype items (including `Bruiser_OnHit` for Omen/Kil'Groth/Allain/Dextra/Errol).
>   - **Late (`Lv.15` Full 6-Item Build)**: 6 Tier-3 items + actives + ranged kiting (`compute_kite_params`).
> - **Cross-Referenced with `4,340` Pro Tournament Games ([data/counter_matrix.csv](file:///C:/Users/chaya/Documents/Program/Project/ROV/data/counter_matrix.csv))**.

---

## 1. Same-Lane Counters & Hidden Gems

### 1.1 Dark Slayer Lane (`DS_Lane`)

| Winner (Counter) | Loser (Target) | Counter Score (`Rel / Raw`) | `Lv.4 / Lv.10 / Lv.15` Margin | Pro Record | Key Mechanical Reason |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Murad** | **Kil'Groth** | `+66.5 / +54.2` | `+100% / +100% / +97% HP` | `0g` | Invuln S2/Ult dodges auto-attack DPS windows while bursting cleanly |
| **Omen** | **Biron** | `+60.7 / +77.4` | `+33% / +89% / +76% HP` | `8g` | `Thirst` True Damage + `Untouchable` 60% DR + Ult `-20%` dmg + `Suppress` lock |
| **Murad** | **Florentino** | `+60.5 / +51.1` | `+83% / +79% / +76% HP` | `39g` | Invuln frames disrupt Florentino's Triple Threat window across all stages |
| **Omen** | **Charlotte** | `+56.2 / +69.6` | `+45% / +84% / +82% HP` | `4g` | Blocks 7-Star Sword burst with S2 DR and shreds through sustain |
| **Riktor** | **Murad** | `+44.5 / +36.2` | `+48% / +62% / +56% HP` | `18g` | S2 `0.75s` invuln blocks Murad Ult + jungle/river form burst |
| **Omen** | **Bijan** | `+19.6 / +37.0` | `+24% / +77% / +60% HP` | `0g` | `S2` DR + `Death's Embrace` `-20%` dmg + `Fafnir/Blitz/Thirst` destroys Bijan at every stage |
| **Kil'Groth** *(Hidden Gem)* | **Charlotte** | `+50.6 / +62.3` | `+48% / +94% / +89% HP` | **`0g` (Unseen)** | `The Fanatic` + `Enraged Spear` sustain out-brawls Charlotte |

### 1.2 Jungle (`Jungle`)

| Winner (Counter) | Loser (Target) | Counter Score (`Rel / Raw`) | `Lv.4 / Lv.10 / Lv.15` Margin | Pro Record | Key Mechanical Reason |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Tachi** *(Hidden Gem)* | **Rourke / Volkath** | `+54.9..61.4 / +58.4..83.2` | `+60..85% / +92..96% / +65..94% HP` | **`0–12g`** | `Spellbound` 4-mark shield/heal + True Damage melts shield brawlers |
| **Keera** | **Zuka** | `+48.7 / +67.8` | `+63% / +75% / +80% HP` | `26g` | `S2` invuln + `Ult` CD reset + magic basic attacks shred AD bruisers |
| **Errol** | **Keera** | `+48.3 / +51.3` | `+27% / +73% / +78% HP` | `4g` | `Blood Drinker` (`+70% AS`, `+25%` LS) + lost-HP healing + `1.5s` invuln Ult |
| **Volkath** *(Hidden Gem)* | **Wonder Woman** | `+43.8 / +55.6` | `+70% / +91% / +91% HP` | **`0g` (Unseen)** | `Doom Lord` 4-hit burst + `15% Max HP` shield sustains through shield brawls |

### 1.3 Mid Lane (`Mid`)

| Winner (Counter) | Loser (Target) | Counter Score (`Rel / Raw`) | `Lv.4 / Lv.10 / Lv.15` Margin | Pro Record | Key Mechanical Reason |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Zata** *(Hidden Gem)* | **Raz / Gildur** | `+51.6..60.4 / +71.9..74.5` | `+81..97% / +100% / +100% HP` | **`0–6g`** | Multi-dash untargetable `Ascend` dives immobile/combo mages cleanly |
| **Natalya** | **Ignis / Gildur / Diao Chan** | `+42.3..56.6 / +65.0..75.0` | `+100% / +100% / +100% HP` | `0–7g` | High-shield `Lethal Rays` Ult + concentrated S1/S2 burst overwhelms mages |
| **Liliana** | **Ishar / Veera** | `+48.2..51.8 / +72.3..78.4` | `+68..78% / +67..89% / +60..61% HP` | **`0g` (Unseen)** | Dual-form burst (`Reiki Shot` + Fox lunge) deletes squishy mages |
| **Yue** *(Poke Spacing)* | **Ilumia** | `+6.9 / +23.3` | `+55% / +100% / -32% HP` | **`0g`** | `Borrowed Might` double-fan `2x` sweet spot + long-range poke dominates early/mid (`+55%/+100%` HP; bare Lv.15 duel Yue wins `+30.9%` HP) |

### 1.4 Abyssal Dragon Lane (`Dragon_Lane`)

| Winner (Counter) | Loser (Target) | Counter Score (`Rel / Raw`) | `Lv.4 / Lv.10 / Lv.15` Margin | Pro Record | Key Mechanical Reason |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Stuart** | **Wisp / Yorn / Teeri / Tel'Annas** | `+56.6 to +77.1` | `+65..73% / +81..90% / +81..97% HP` | `0–51g` | **S2 (`2.0s` Physical Immunity)** + `Drain Charge` (`+80% AS`) crushes physical crit marksmen |
| **Hayate** | **Capheny / Slimz** | `+57.6 to +58.8` | `+23..68% / +75..84% / +60..72% HP` | `11–166g` | `Blood of the Dragon` True Damage + `Shadowstep` damage amp |
| **Laville** *(Hidden Gem)* | **Valhein** | `+40.6 / +51.9` | `+34% / +53% / +93% HP` | **`0g`** | `Protective Bubble` S2 shield + multi-bolt crit scaling dominates late duels |

### 1.5 Roam / Support (`Roam`)

| Winner (Counter) | Loser (Target) | Counter Score (`Rel / Raw`) | `Lv.4 / Lv.10 / Lv.15` Margin | Pro Record | Key Mechanical Reason |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Arum** *(Hidden Gem)* | **Dextra / Chaugnar** | `+50.2..61.0 / +69.8..70.8` | `+79..91% / +94..99% / +87..95% HP` | **`0g` (Unseen)** | Passive `Spirit Beasts` sustain + `Snare` Ult locks down sustain tanks |
| **Cresht** | **TeeMee** | `+43.7 / +67.4` | `+81% / +67% / +58% HP` | `22g` | `Metamorphosis` huge HP shield + DR overwhelms utility roamers |
| **Mina** | **Arduin / Taara / Omega** | `+41.6..58.8` | `+35..78% / +66..88% / +57..93% HP` | `0–18g` | `Sweet Revenge` True spin + S1 `%Max HP` + `8%` missing-HP heal wins attrition tank brawls |

---

## 2. Cross-Lane Tactical Counters & 2026 Heroes

- **Marksmen vs Junglers (`Dragon_Lane -> Jungle`)**:
  - **`Stuart > Kriknak`** (`Rel +77.8`, `+74% / +100% / +84% HP`), **`Hayate > Zill`** (`Rel +49.6`, `+55% / +100% / +100% HP`), **`Thorne > Volkath`** (`Rel +45.7`).
- **Roam Lockdown (`Roam -> Jungle`)**:
  - **`Arum > Bolt Baron`** (`Rel +53.4`, `0g`), **`Arduin > Lu Bu`** (`Rel +45.3`, `0g`), **`Baldum > Keera`** (`Rel +43.4`, `12g`).
- **Backline vs Offlane (`Dragon_Lane -> DS_Lane`)**:
  - **`Capheny > Florentino`** (`Rel +68.4`, `38g`), **`Stuart > Charlotte`** (`Rel +63.0`, `4g`), **`Thorne > Biron`** (`Rel +51.7`, `0g`).
- **2026 Hero Highlights**:
  - **`Biron`**: beats `Annette` (`Rel +41.0`), `Marja` (`+37.8`), `Aya` (`+36.9`), countered by `Omen` (`+60.7`), `Tachi` (`+56.5`), `Volkath` (`+55.3`).
  - **`Tamyn`**: beats `Marja` (`Rel +26.9`), `Mganga` (`+22.6`), `Sephera` (`+22.1`), countered by `Stuart` (`+58.9`), `Omen` (`+48.8`), `Murad` (`+47.5`).
  - **`Billow`**: beats `Aya` (`Rel +17.7`), `Goverra` (`+16.2`), `Marja` (`+16.2`), countered by `Omen` (`+51.0`), `Murad` (`+41.2`), `Capheny` (`+36.6`).
  - **`Evita`**: beats `Krixi` (`Rel +20.0`), `Aleister` (`+17.8`), `Azzen'Ka` (`+14.1`), countered by `Tachi` (`+46.1`), `Florentino` (`+45.3`), `Riktor` (`+42.4`).
  - **`Flowborn (Mage)`**: beats `Eland'orr` (`Rel +22.9`), `Rouie` (`+22.5`), `Dyadia` (`+15.5`), countered by `Heino` (`+45.6`), `Fennik` (`+40.8`), `Florentino` (`+40.4`).
  - **`Flowborn (Marksman)`**: beats `Billow` (`Rel +30.5`), `Biron` (`+29.8`), `Diao Chan` (`+27.1`), countered by `Stuart` (`+69.9`), `Mina` (`+36.0`), `Laville` (`+31.3`).

---

## 3. Single-Item Counter Flips (`206` Matchup Reversals at Lv.15)

- **`Medallion of Troy` (`136` reversals)**: e.g. `Natalya vs Heino` (`-52.8% -> +100.0%`, `+152.8%` swing), `Erin vs Bonnie` (`-56.6% -> +79.4%`, `+136.0%` swing), `Raz vs Azzen'Ka` (`+134.0%` swing), `Raz vs Flowborn (Mage)` (`+133.6%` swing).
- **`Mail of Pain` (`55` reversals)**: reflects physical DPS / crit burst back onto auto-attackers.
- **`Curse of Death` (`15` reversals)**: shuts down high-heal / lifesteal duelists (`Tachi`, `Errol`, `Taara`, etc.) with `40%` anti-heal.

---

## 4. Repository Artifacts & Reproducibility

- **Skill Mechanics Registry (100% 534-Skill Extractor)**: [src/skill_mechanics.py](file:///C:/Users/chaya/Documents/Program/Project/ROV/src/skill_mechanics.py)
- **Generator Script**: `python scripts/discover_mechanical_matchups.py` ([scripts/discover_mechanical_matchups.py](file:///C:/Users/chaya/Documents/Program/Project/ROV/scripts/discover_mechanical_matchups.py))
- **Full `16,770`-Row Directional Dataset**: [data/mechanical_matchups_130x130.csv](file:///C:/Users/chaya/Documents/Program/Project/ROV/data/mechanical_matchups_130x130.csv)
- **`206` Counter-Item Flip Dataset**: [data/counter_item_flips.csv](file:///C:/Users/chaya/Documents/Program/Project/ROV/data/counter_item_flips.csv)
- **Structured JSON Summary**: [data/mechanical_matchup_summary.json](file:///C:/Users/chaya/Documents/Program/Project/ROV/data/mechanical_matchup_summary.json)

# RoV (Arena of Valor) Pro Draft Intelligence — SOTA GNN-Transformer

Comprehensive hero database covering all **130 heroes (up to Evita)**, pro match dataset with **4,208 complete games (RPL, APL, AIC, AOG, GCS from 2024–2026)**, and State-of-the-Art architecture (**`RoVDraftGNNTransformer`**) for sequential draft recommendation (Next-Pick / Next-Ban) and win rate estimation (`PredWin%`) under **Global Ban Pick** rules.

---

## Repository Structure

* `data/heroes_130_full.json` & `data/heroes_130_summary.csv` — Full 130-hero dataset with detailed skill descriptions and 10 capability flags.
* `data/matches_draft_full.json` & `data/matches_draft_flat.csv` — 4,208 pro match drafts with chronological ban/pick sequences and per-series Global Ban tracking.
* `data/hero_draft_stats.csv`, `data/synergy_matrix.csv`, `data/counter_matrix.csv` — Lane distribution stats across 5 main lanes, ally synergy matrix (2,605 pairs), and enemy counter matrix (6,234 pairs).
* `src/train_sota_model.py` — SOTA **`RoVDraftGNNTransformer`** model (Multi-Relational Hero GNN + Multi-Head Draft Transformer + Bounded Neural Temperature Gate + Dual Policy & Win-Value Heads).
* `src/predict_draft_cli.py` — CLI draft simulator and tournament scenario runner.
* `src/api.py` — FastAPI service endpoints (`/health`, `/heroes`, `/draft/steps`, `/predict`, `/combat/catalog`, `/combat/stats`, `/combat/duel`) and static file serving from `frontend/dist`.
* `src/combat_calculator.py` — Combat calculations: hero attributes (level + items + Tier-3 arcana + enchantments), mitigated skill damage (armor/magic defense/flat and percentage pierce), and 1v1 duel simulator (**Stat & Duel Lab** tab in web UI, direct link: `/#lab`).
* `frontend/` — Broadcast-style draft web UI (React 19 + Vite + Tailwind CSS 4) displaying Thai server names (e.g. Mortos, Celica, Riktor).
* `scripts/fetch_hero_icons.py` — Downloads 130 square hero icons to `frontend/public/avatars/`.
* `data/items.json` — 114 items (numeric stats, gold price, passives) from rovmeta.com with patch note corrections via `data/items_overrides.json` (rov.in.th).
* `data/hero_patch_history.json` — 334 numerical hero balance adjustments across 92 characters translated from official Taiwan patch notes (Garena TW) via `scripts/parse_tw_hero_patches.py`.
* `data/hero_level_stats.json` & `data/hero_level_stats.csv` — Exact level 1–15 stats scaling tables for all 130 heroes (1,950 rows) built via `scripts/build_hero_level_stats.py`.
* `data/hero_skills_full.json` — Structured numerical catalog of 525 hero skills for all 130 heroes (cooldowns, mana costs, base damage, and AD/AP/HP scaling ratios across all skill levels) built via `scripts/build_hero_skills_catalog.py`.
* `data/arcana.json` — 90 official Arcana runes (Red/Purple/Green across Tiers I–III) with exact numerical stats and icon mappings.
* `data/enchantments.json` — 33 official Enchantments across 4 factions (Veda, Lokheim, Afata, League of Humans).
* `scripts/fetch_arcana_and_enchantments.py` — Scrapes and parses 90 Arcana runes and 33 Enchantments.
* `scripts/build_hero_skills_catalog.py` — Multi-source parser extracting and calculating exact skill numbers, cooldowns, and level scalings for all 130 heroes.
* `scripts/download_rov_apk.py` — Inspects APK/XAPK package structure and downloads official Garena RoV game client assets via HTTP Range Requests.
* `run_sota_rov_h100.sbatch` — SLURM job script for large-scale training on **NVIDIA H100 (`gpu-h100`)** nodes on **ERAWAN HPC**.

---

## Running on ERAWAN HPC (NVIDIA H100)

```bash
git clone https://github.com/golfdesu/rov.git
cd rov
sbatch run_sota_rov_h100.sbatch
```

Monitor job output:
```bash
tail -f logs/rov_sota_h100_*.out
```

---

## Inference via CLI

1. **Run 4 preset pro league draft scenarios:**
```bash
python src/predict_draft_cli.py --demo
```

2. **Custom draft scenario:**
```bash
python src/predict_draft_cli.py \
  --mode pick \
  --side blue \
  --phase 1 \
  --ally-bans "Rouie,Eland'orr" \
  --enemy-bans "Valhein,Florentino" \
  --ally-picks "Skud,Billow" \
  --enemy-picks "TeeMee,Hayate" \
  --global-bans "Toro,Marja"
```

---

## Web UI

```bash
cd frontend
npm install
npm run build
cd ..
uvicorn src.api:app --port 8000
```

Open `http://localhost:8000`.

**Stat & Duel Lab Tab**: Select heroes for both sides, configure level, 6-slot items, Tier-3 arcana (10 slots per color), and enchantments (Primary core 1-3 + Secondary 1-2) to inspect real-time stats, mitigated skill damage, effective HP (EHP), combo damage curves, and duel outcomes. (Note: parsed enchantment numbers originate from descriptions and are pending in-game verification in `ENCHANTMENT_EFFECTS` inside `src/combat_calculator.py`).

Keyboard shortcuts: `/` search hero, `Enter` lock top AI recommendation, `Ctrl+Z` undo last step.

Frontend hot reload development: run uvicorn on port 8000, then in a separate terminal:
```bash
cd frontend && npm run dev
```
Open `http://localhost:3000`.

Or run via Docker (automatically builds frontend):
```bash
docker build -t rov-draft .
docker run -p 8000:8000 rov-draft
```

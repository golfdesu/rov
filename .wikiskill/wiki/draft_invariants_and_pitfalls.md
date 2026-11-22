# Draft Invariants, Traps & Pitfalls Catalog

Every rule below was learned from hard bugs or empirical training failures. Violating any of these invalidates model quality or corrupts dataset integrity.

---

## 1. Liquipedia Lane Order vs Chronological Pick Order (`t1h1..t1h5`)

- **The Trap**: In scraped Liquipedia match records, `t1b1..t1b4` and `t2b1..t2b4` are chronological bans (`Phase 1 = b1, b2`; `Phase 2 = b3, b4`). However, **`t1h1..t1h5` are ordered strictly by the 5 in-game lanes** (`h1 = DS_Lane`, `h2 = Jungle`, `h3 = Mid`, `h4 = Dragon_Lane`, `h5 = Roam`), **NOT** chronological pick order.
- **Mitigation**:
  1. For all 2026 games (`1,833` games), use screenshot-verified sequences in `data/true_pick_order.json`.
  2. When true pick order is unavailable (2025 games), always call `order_team_picks_by_draft_logic()` in `src/train_sota_model.py` to reconstruct Phase 1 (`P1..P3`) vs Phase 2 (`P4..P5`) order.

---

## 2. Broadcast Screenshot Pre-Swap Trap (`data/draft_screenshots/`)

- **The Trap**: Broadcast screenshots are captured at the exact moment the 10th pick locks, **before players swap heroes into their in-game lanes**.
  - On-screen slots represent **chronological pick sequence only** (`B1..B5` left -> right on Blue; `R1..R5` right -> left mirrored on Red).
  - Players routinely pick high-priority flex or power picks for teammates before swapping. **NEVER** bind the player name displayed under an on-screen slot to their Liquipedia `h1..h5` lane.
- **Side & Turn Rules**:
  - Pick turn sequence: `B1 | R1 R2 | B2 B3 | R3 | (Phase-2 Bans) | R4 | B4 B5 | R5`.
  - Match each game by its unique 10-hero set against `data/matches_draft_full.json` (`series_id` + `game_number`) to determine Blue vs Red side—never guess side from filenames.
  - Liquipedia ban order is already chronological; do not rewrite it from the mirrored Red side.

---

## 3. Screenshot Naming & Team Code Invariants

- **Canonical Match Naming**: `<teamA>_vs_<teamB>` in screenshot filenames for a BoX series MUST stay locked to Game 1's team ordering across all games (`G1–G7`). Never swap `<teamA>` and `<teamB>` when sides swap in Game 2+.
- **Canonical Team Codes**: Saigon Phantom is strictly `sgp` (never `sp`); Supernova is `spn`.

---

## 4. Data Augmentation Overfitting (`augment_factor`)

- **Empirical Failure**: Setting `augment_factor > 2` or permuting picks across Phase 1 (`P1..P3`) and Phase 2 (`P4..P5`) boundaries destroys temporal draft causality and causes severe overfitting (`Val Loss > 4.30`).
- **Rule**: Keep `augment_factor <= 2`. In the 80-trial H100 HPO, **`augment_factor = 1`** won all Top-5 rankings.

---

## 5. Transformer Depth Overparameterization (`num_layers`)

- **Architecture Guardrail**: A full RoV draft sequence is short (`<= 17` tokens before the final slot). A single Transformer layer (`num_layers = 1`, `d_model = 256`, `nhead = 4`) already achieves a 100% global receptive field across all prior bans and picks.
- **Empirical Finding**: Increasing depth to `num_layers >= 3` degrades validation generalization. Production capacity is locked at `d_model = 256, num_layers = 1, nhead = 4` (edge compact option: `d_model = 128, num_layers = 1, nhead = 4`).

---

## 6. 2024 Legacy Meta Exclusion (`data/matches_training.json`)

- **Rule**: **STRICTLY FORBIDDEN** to train production models on 2024 data. All 817 games from 2024 contain obsolete hero reworks and outdated meta priorities (e.g., pre-rework Wonder Woman, 2024 Erin dynamics) that degrade current-meta predictions.
- **Command**: Rebuild the curated 2025–2026 dataset (`3,535` games) only with:
  ```bash
  python src/build_training_dataset.py --min-year 2025
  ```

---

## 7. Canonical Thai Server Hero Names & CLI Flags

- **Thai Server Default**: Canonical names across `data/`, `models/`, `src/`, and `frontend/` are `Mortos` (not Arthur), `Celica` (not Brunhilda), `Riktor` (not Richter), `Kaine`, `Stuart`, `Helen`. Legacy Liquipedia aliases are normalized in `src/scrape_matches.py` and `src/predictor.py`.
- **CLI Action Flag**: `src/predict_draft_cli.py` uses `--mode pick` or `--mode ban` (never `--action`).

---

## Related Wiki Articles

- [`system_architecture_and_data.md`](system_architecture_and_data.md)
- [`production_hyperparameters_and_hpo.md`](production_hyperparameters_and_hpo.md)
- [`../traces/h100_hpo_and_training_trace.md`](../traces/h100_hpo_and_training_trace.md)

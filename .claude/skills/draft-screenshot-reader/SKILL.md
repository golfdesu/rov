---
name: draft-screenshot-reader
description: >-
  Reads true chronological pick order from broadcast draft screenshots in
  data/draft_screenshots/, identifies each game against Liquipedia data, renames and files
  the images, and records results in data/true_pick_order.json. Use this skill whenever the
  user adds draft screenshots, asks to read or verify pick order from images, or wants to
  extend the true pick order dataset.
---

# Draft Screenshot Reader Skill

Turns broadcast draft screenshots into ground-truth pick order (`data/true_pick_order.json`). Liquipedia lists picks by lane, not by pick order, so these screenshots are the only source of real pick order.

---

## 1. What a Screenshot Shows

- Captured the moment the **last hero is locked**, before players swap heroes into lanes. The on-screen slot order **is** the chronological pick order. Never treat it as in-game HUD / lane order.
- **Left side (first pick / blue)**: picks and bans read **left -> right**.
- **Right side (second pick / red)**: picks and bans read **right -> left** (mirrored).
- Pick turn order: `B1 | R1 R2 | B2 B3 | R3 | (phase-2 bans) | R4 | B4 B5 | R5`.
- Teams swap sides between games. Get blue/red for each game from `data/matches_draft_full.json` by `series_id` + `game_number`; never assume it from the filename or the previous game.

---

## 2. Liquipedia Lane Order vs Broadcast Swap Trap (CRITICAL)

- **Liquipedia's Lane Order (`h1..h5`)**:
  - Liquipedia always lists picks by in-game lane: `h1 = DS_Lane (Offlane)`, `h2 = Jungle`, `h3 = Mid`, `h4 = Abyssal Dragon (Carry)`, `h5 = Roam (Support)`.
  - **Differentiating 2 Tanks / Flex Picks**: When a team selects 2 tanks (e.g. Skud and Toro, or Taara and Thane), Liquipedia definitively tells you which hero is played in which role: `h1` is the Offlane tank (Skud, Taara) and `h5` is the Support tank (Toro, Thane).
  - This lane mapping holds across all seasons and tournaments (RPL, AOG, GCS, APL).
- **The Pre-Swap Broadcast Trap (Anti-Bug Guardrail)**:
  - Screenshots are captured at the moment the 10th hero is locked, **before players swap heroes** into their actual lanes during the 30-second swap phase.
  - In pro matches, players pick high-priority or flex heroes for each other regardless of who is in that seat (e.g., Player 1 SRY picks Rouie in B1, even though SRY is the offlaner who will later play Skud).
  - **STRICTLY FORBIDDEN**: Never assume the player name under a screen slot indicates which hero that player plays in game, and never associate a screen slot with Liquipedia's `h1..h5` by player name! A screen slot represents ONLY the chronological pick turn (`B1..B5` on blue, `R1..R5` on red).
- **Candidate Pool & Safe Elimination**:
  - Liquipedia provides the exact 5-hero candidate set `{h1, h2, h3, h4, h5}`.
  - If an on-screen slot is hidden (e.g. card back with league logo still flipping at timer 00:55, such as R5 in `2026_w2_d4_m1_g1`) and the other 4 slots on that team are identified with 100% certainty, the 5th hero can be deduced safely by eliminating the 4 known heroes from Liquipedia's 5-hero set.

---

## 3. Workflow & Automated Pipeline

### 3.1 Automated Fast Ingestion (`scripts/process_draft_screenshots.py`)
For batch processing new screenshots rapidly with Global Hungarian Bipartite Matching:
1. Ensure the reference template bank is populated in `data/broadcast_templates/` (harvests median card portraits across AOG, APL, RPL, and GCS):
   ```bash
   python -m scripts.build_broadcast_templates
   ```
2. Run automated global bipartite Hungarian matching (`--league` is auto-inferred from the folder path if omitted):
   ```bash
   # Dry-run check on a specific tournament/stage directory
   python -m scripts.process_draft_screenshots data/draft_screenshots/2026_apl/swiss_stage --dry-run --league apl
   # Ingest, rename in-place (two-phase safe move), and record in data/true_pick_order.json
   python -m scripts.process_draft_screenshots data/draft_screenshots/2026_apl/swiss_stage --league apl
   ```
   - Supported `--league` presets: `aog`, `rpl`, `gcs`, `apl`.
   - Solves a **5 x 5 Hungarian assignment** (`scipy.optimize.linear_sum_assignment`) per team side and a **Global N x M Hungarian assignment** across the entire batch of screenshots against unrecorded candidate games in `data/matches_draft_full.json` (preventing duplicate game collisions).
   - Emits a `[WARN] High single-slot L1 error (> 62.0)` alert whenever a slot portrait diverges from Liquipedia's candidate hero set (catching broadcast overlay operator glitches or unharvested skins).

### 3.2 Manual / Diagnostic Fallback Steps
1. **Find new images**: anything in `data/draft_screenshots/` (or a stage subfolder) not yet referenced by a `screenshot` field in `true_pick_order.json`.
2. **Read each image**: note the on-screen title (league, week/day, match, game), team tags, and the 5 + 5 picked heroes in on-screen order. Identify heroes by comparing with `data/broadcast_templates/` or `frontend/public/avatars/` (name -> file map in `frontend/public/hero_images.json`).
3. **Identify the game**: match the 10-hero set against `data/matches_draft_full.json`. Every game's 10-hero set is unique. Use the title to confirm. Filenames are only a hint.
4. **Validate**: both sides' hero sets must equal Liquipedia's exactly. If they do not match (e.g. broadcast overlay glitch showing banned/prior-game heroes), **flag the image to the user instead of guessing**.
5. **Map sides**: from the Liquipedia record, decide which on-screen side is blue. Convert screen order to chronological order (left side as-is, right side reversed).
6. **Rename and file**:
   - **Domestic Leagues (`RPL`, `AOG`, `GCS`)**:
     `data/draft_screenshots/<year>_<league>_<season>/week<N>/<year>_w<week>_d<day>_m<match>_g<game>_<season>_<league>_<teamA>_vs_<teamB>.png`
     (e.g. `2026_rpl_winter/week1/2026_w1_d1_m1_g1_win_rpl_kog_vs_bru.png`, `2026_aog_winter/week1/2026_w1_d1_m1_g1_win_aog_sp_vs_boom.png`).
   - **International Tournaments (`APL`)**:
     `data/draft_screenshots/2026_apl/<stage>/2026_<stage_code>_d<day>_m<match>_g<game>_apl_<teamA>_vs_<teamB>.png`
     where `<stage>` / `<stage_code>` is `wildcard` (`wc`), `swiss_stage` (`ss`), or `playoffs` (`po`), and `<match>` is the chronological match number within that day (e.g. `2026_apl/wildcard/2026_wc_d1_m1_g1_apl_cfx_vs_box.png`).
   - **Team codes (lowercase)**:
     - RPL: `kog`, `bru`, `gjc`, `hd`, `ten`, `fs`, `bac`, `ea`, `slx`
     - AOG: `rrq`, `boom`, `fl`, `fpl`, `gam`, `box`, `1s`, `secret`, `sp`
     - GCS & APL: `cfx`, `tl`, `one`, `hka`, `ank`, `bmg`, `dcg`, `fw`, `lit`
7. **Record** in `data/true_pick_order.json` under `games`:
   ```json
   {
     "series_id": "Arena_of_Valor_Premier_League_2026_Wildcard_S279",
     "game_number": 1,
     "date": "May 21, 2026 - 15:00",
     "blue_team": "CARNIFEX",
     "red_team": "BOX",
     "blue_picks": ["Stuart", "Billow", "Baldum", "Volkath", "Liliana"],
     "red_picks": ["Y'bneth", "Flowborn (Marksman)", "Lorion", "Keera", "Skud"],
     "source": "screenshot",
     "screenshot": "2026_apl/wildcard/2026_wc_d1_m1_g1_apl_cfx_vs_box.png"
   }
   ```
   Ban order is **not** stored: Liquipedia bans are already chronological. Do not "fix" them from the mirrored right side.
8. **Verify**: `python .agents/skills/rov-data-guardian/scripts/audit_rov_data.py`. It fails on wrong hero sets, missing screenshots, duplicates, or unknown games.
9. **Measure (optional)**: compare the new games with `order_team_picks_by_draft_logic()` in `src/train_sota_model.py` (per-slot and per-phase accuracy) and report the numbers in `CHANGELOG.md`, as earlier entries did.

---

## 4. Guardrails

- Use canonical hero names (`Arthur`, `Brunhilda`, `Richter`), not Thai display names (`Mortos`, `Celica`, `Riktor`).
- `Flowborn (Marksman)` and `Flowborn (Mage)` share one portrait, so the image cannot tell them apart. Take the role from the Liquipedia record for that game (Mage is rare: 9 of 4,252 games).
- **Reworked Azzen'Ka vs Default Taara Trap**:
  - Azzen'Ka has a remodeled female appearance (dark hair with purple fringe, tiara, purple eyes as shown in `frontend/public/avatars/Azzen_Ka.jpg`), NOT the old classic sand wraith.
  - Taara's default appearance is the full heavy steel/blue armor with horned helmet and glowing blue eyes (`frontend/public/avatars/Taara.jpg`).
  - Do NOT confuse the female face of reworked Azzen'Ka for Taara, nor Taara's default horned helmet for a wraith/monster.
- Screenshot timestamps do not always follow game order. Always match each image by its 10-hero set (and on-screen game/team header when disambiguating), never by file order.
- Broadcast overlay glitches (e.g., APL 2026 Wildcard `S281 G2` `ONE vs TIMELESS`, where the broadcast operator displayed banned/Game-1 heroes on Blue slots 2-5; or APL 2026 Swiss Stage `S258 G2` `BRU vs BMG`, where Blue B4 displayed Tel'Annas portrait but was Fennik in-game/Liquipedia, and Iggy wore a special cadet skin with cyan hair/cap), hero set mismatches, unreadable portraits, or ambiguous titles: stop and flag to the user instead of guessing. Never fill a slot by elimination unless the other 4 slots on that side are 100% certain and the set check passes.
- Do not touch `data/vod_analytics/` (owner's paused WIP).
- Retraining on true pick order is on hold until more games are collected; do not start it unless asked.

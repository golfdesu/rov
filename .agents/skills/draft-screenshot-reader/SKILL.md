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

## 2. Workflow

1. **Find new images**: anything in `data/draft_screenshots/` that is not in a `week<N>/` folder, or any `week<N>/` image not yet referenced by a `screenshot` field in `true_pick_order.json`.
2. **Read each image**: note the on-screen title (league, week/day, match, game), team tags, and the 5 + 5 picked heroes in on-screen order. Identify heroes by comparing with `frontend/public/avatars/` (name -> file map in `frontend/public/hero_images.json`).
3. **Identify the game**: match the 10-hero set against `data/matches_draft_full.json`. Every game's 10-hero set is unique. Use the title to confirm. Filenames are only a hint.
4. **Validate**: both sides' hero sets must equal Liquipedia's exactly. If they do not match, **flag the image to the user instead of guessing**, and do not write that game.
5. **Map sides**: from the Liquipedia record, decide which on-screen side is blue. Convert screen order to chronological order (left side as-is, right side reversed).
6. **Rename and file** to `data/draft_screenshots/week<N>/<year>_w<week>_d<day>_m<match>_g<game>_<season>_<league>_<teamA>_vs_<teamB>.png`, e.g. `week1/2026_w1_d1_m1_g1_win_rpl_kog_vs_bru.png` (RPL 2026 Winter, week 1, day 1, match 1, game 1). Team codes are lowercase (`kog`, `bru`, `gjc`, `hd`, `ten`, `fs`, `bac`, `ea`, `slx`).
7. **Record** in `data/true_pick_order.json` under `games`:
   ```json
   {
     "series_id": "RoV_Pro_League_2026_Winter/Group_Stage_S605",
     "game_number": 1,
     "date": "August 22, 2026 - 12:00",
     "blue_team": "KOG",
     "red_team": "BRU",
     "blue_picks": ["Rouie", "Toro", "Capheny", "Edras", "Skud"],
     "red_picks": ["Enzo", "Eland'orr", "Lorion", "Billow", "Biron"],
     "source": "screenshot",
     "screenshot": "week1/2026_w1_d1_m1_g1_win_rpl_kog_vs_bru.png"
   }
   ```
   Ban order is **not** stored: Liquipedia bans are already chronological. Do not "fix" them from the mirrored right side.
8. **Verify**: `python .agents/skills/rov-data-guardian/scripts/audit_rov_data.py`. It fails on wrong hero sets, missing screenshots, duplicates, or unknown games.
9. **Measure (optional)**: compare the new games with `order_team_picks_by_draft_logic()` in `src/train_sota_model.py` (per-slot and per-phase accuracy) and report the numbers in `CHANGELOG.md`, as earlier entries did.

---

## 3. Guardrails

- Use canonical hero names (`Arthur`, `Brunhilda`, `Richter`), not Thai display names (`Mortos`, `Celica`, `Riktor`).
- `Flowborn (Marksman)` and `Flowborn (Mage)` share one portrait, so the image cannot tell them apart. Take the role from the Liquipedia record for that game (Mage is rare: 9 of 4,208 games).
- Screenshot timestamps do not always follow game order. Always match each image by its 10-hero set, never by file order.
- Hero set mismatch, unreadable portrait, or ambiguous title: stop and ask. Never fill a slot by elimination unless the other 9 are certain and the set check passes.
- Do not touch `data/vod_analytics/` (owner's paused WIP).
- Retraining on true pick order is on hold until more games are collected; do not start it unless asked.

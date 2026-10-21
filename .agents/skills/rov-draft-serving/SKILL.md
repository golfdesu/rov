---
name: rov-draft-serving
description: >-
  Guides running, testing, and serving the RoV SOTA Draft Recommendation system via CLI
  (src/predict_draft_cli.py), OOP Predictor (src/predictor.py), FastAPI Server (src/api.py),
  the React draft UI (frontend/), and automated Pytest verification (tests/). Use this skill
  when testing draft scenarios, launching the API or UI, changing predictor/search code, or
  verifying code changes before committing.
---

# RoV Draft Serving, Simulation & Verification Skill

Use this skill to run draft predictions, serve the FastAPI application and web UI, or execute the automated verification suite.

---

## 1. Automated Verification Suite (Run Before Every Commit)

```bash
python .agents/skills/rov-data-guardian/scripts/audit_rov_data.py
pytest -v
ruff check --fix . && ruff format .
# Frontend changes only:
cd frontend && npm run build && npm run lint && cd ..
```

`npm run build` runs `tsc -b` with `strict: true`, so it doubles as the type check.

---

## 2. Predictor Golden Test (`tests/test_predictor_golden.py`)

`tests/fixtures/predict_golden.json` pins the full `predict()` output for 72 draft states replayed from real pro games (`tests/golden_scenarios.py`: 4 games x 9 steps x lookahead on/off).

- A **refactor or optimisation** of `src/predictor.py` or `src/search/draft_mcts.py` must pass it unchanged. A failure means behaviour changed: fix the code, never the fixture.
- Regenerate **only** for an intended behaviour change (new checkpoint, data refresh, new scoring rule), and say so in `CHANGELOG.md`:
  ```bash
  python -c "from tests.test_predictor_golden import regenerate; regenerate()"
  ```
- Record the fixture from the **old** code before starting a refactor if you are unsure it is current.

### Predictor internals worth knowing
- All model inputs go through `ModelInput` + `encode_batch()` + `run_model()` in `src/search/draft_mcts.py`. Do not add another one-hot / sequence-token builder.
- `predict()` batches the main position with both teams' next-ban and first next-pick forecasts in one forward pass; the second forecast pick is a second pass. Keep new per-request model calls inside that batching.
- Per-hero display fields (`_main_lane`, `_lane_key`, `_primary_role`, `_capabilities`) are lists indexed by hero id. Do not use `heroes_df.loc` / `stats_df.loc` in request paths.

---

## 3. CLI Draft Simulation (`src/predict_draft_cli.py`)

```bash
python src/predict_draft_cli.py --demo
```

Custom state. Use `--mode pick|ban` (NOT `--action`), `--side blue|red`, `--phase 1|2`:
```bash
python src/predict_draft_cli.py \
  --mode pick \
  --side blue \
  --phase 1 \
  --ally-picks "Lumburr,Krixi" \
  --enemy-picks "Billow,Hayate" \
  --ally-bans "Goverra,Dyadia" \
  --enemy-bans "Heino,Dolia" \
  --global-bans "Marja" \
  --top-k 5
```

---

## 4. FastAPI Serving + Web UI (`src/api.py`, `frontend/`)

```bash
cd frontend && npm install && npm run build && cd ..   # once, or after frontend changes
uvicorn src.api:app --reload --port 8000
```

| Route | Purpose |
| :--- | :--- |
| `GET /` | Draft UI and Stat & Duel Lab (`#lab`), served from `frontend/dist` |
| `GET /health` | Health check |
| `GET /heroes` | 130 heroes + `hero_details` (role, lane, tier, `image_url`) |
| `GET /draft/steps` | 18-step draft order |
| `POST /predict` | Next pick/ban recommendations + both teams' forecasts |
| `GET /combat/catalog` | Heroes, items, arcana, enchantments for the lab |
| `POST /combat/stats` | Build stats for one hero build |
| `POST /combat/duel` | 1v1 duel simulation for builds `a` and `b` |
| `GET /docs` | Swagger UI |

Frontend dev server with hot reload (proxies the routes above to `:8000`):
```bash
cd frontend && npm run dev   # http://localhost:3000
```
When adding a new top-level API route, also add it to the proxy regex in `frontend/vite.config.ts`.

### Frontend conventions (see `frontend/README.md`)
- API calls go through `frontend/src/api/client.ts` (`getJson` / `postJson`), never raw `fetch`.
- Draft state transitions live in the pure `draftReducer` (`frontend/src/utils/draft.ts`); `useDraft` only does I/O.
- Dialogs use `components/Modal.tsx`; error banners use `components/Alert.tsx`.
- Thai display names are display-only (`utils/heroNames.ts`); API calls use canonical names.

### Checking the UI in a real browser
Playwright (Python) and Chromium are installed. Build the frontend, start uvicorn on a spare port, then drive the page headless: lock all 18 steps with `Enter`, `Ctrl+Z` to undo, open `#lab`, open both modals and check `Escape` / focus. Fail on any `pageerror` or console error. Stop the server and delete scratch scripts afterwards.

---

## 5. Full 18-Step Self-Play Simulation (`scripts/simulate_draft_selfplay.py`)

```bash
python scripts/simulate_draft_selfplay.py --blue-strategy lookahead --red-strategy greedy --depth 2
```

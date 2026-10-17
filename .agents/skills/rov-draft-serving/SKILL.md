---
name: rov-draft-serving
description: >-
  Guides running, testing, and serving the RoV SOTA Draft Recommendation system via CLI
  (src/predict_draft_cli.py), OOP Predictor (src/predictor.py), FastAPI Server (src/api.py),
  and automated Pytest verification (tests/). Use this skill when testing draft scenarios,
  launching the API, or verifying code changes before committing.
---

# RoV Draft Serving, Simulation & Verification Skill

Use this skill to run draft predictions, serve the FastAPI application, or execute the automated verification suite.

---

## 1. Automated Verification Suite (Run Before Every Commit)

Always run these two commands to verify 100% system integrity before committing:
```bash
python .agents/skills/rov-data-guardian/scripts/audit_rov_data.py
pytest -v
```

---

## 2. CLI Draft Simulation (`src/predict_draft_cli.py`)

### Run Built-In Pro Tournament Demo Scenarios
```bash
python src/predict_draft_cli.py --demo
```

### Run Custom Draft State Prediction
Note: Use `--mode pick` or `--mode ban` (NOT `--action`), `--side blue` or `--side red`, and `--phase 1` or `--phase 2`:
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

## 3. Production FastAPI Serving (`src/api.py`)

### Launch Local API Server
```bash
uvicorn src.api:app --reload --port 8000
```
- **Health Check**: `GET http://localhost:8000/health`
- **List All 130 Heroes**: `GET http://localhost:8000/heroes`
- **Predict Next Pick/Ban**: `POST http://localhost:8000/predict`
- **Interactive Swagger UI**: `http://localhost:8000/docs`

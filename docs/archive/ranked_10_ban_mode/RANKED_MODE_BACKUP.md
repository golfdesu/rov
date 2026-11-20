# Ranked 10-Ban Mode Backup (`RANKED · 10 BAN`)

Archived on **2026-11-20** after deciding to keep the app focused on **Pro / Tournament Global Ban** drafting (`PRO · GLOBAL BAN`) rather than real-time Ranked 10-ban mode (where short in-game turn timers make manual 10-ban + 10-pick mirror entry impractical).

## Archived Files

- **[ranked_10_ban_mode.patch](file:///C:/Users/chaya/Documents/Program/Project/ROV/docs/archive/ranked_10_ban_mode/ranked_10_ban_mode.patch)** — Clean unified diff covering all 15 files (Frontend UI/State, Backend Schemas/Predictor/MCTS Search, and Pytest coverage) to restore Ranked 10-Ban mode (`10` upfront bans + `1-2-2-2-2-1` pick order).

## What Was Archived

1. **Frontend (`frontend/src/`):**
   - `types/draft.ts` (`DraftMode`, `RANKED_PICK_STEPS`, `draftMode` / `rankedBanPhaseComplete` payload fields)
   - `utils/draft.ts` (`getDraftSteps`, `getCurrentDraftStep`, `draftReducer` ranked actions, `reconstructDraftHistory`, `buildPredictPayload` ranked mode)
   - `hooks/useDraft.ts` & `hooks/useDraftTimer.ts` (`setDraftMode`, `removeRankedBan`, `rankedBanPhaseComplete`, ranked turn grouping)
   - `components/DraftBoardView.tsx`, `TeamColumn.tsx`, `AiPanel.tsx`, `ScoreBar.tsx`, `DraftTimeline.tsx`, `DraftHistoryModal.tsx` (mode switcher, unified 10-ban strip, ranked history display)
2. **Backend & Search (`src/`):**
   - `schemas.py` (`draft_mode: Literal["tournament", "ranked"]`, 5-ban cap in ranked)
   - `search/draft_mcts.py` (`RANKED_PICK_STEPS`, `RANKED_PICK_MODEL_STEPS`, `_RANKED_BAN_SLOTS`, `_ranked_sequence_events`, `DraftSearchState.ranked_ban_side`)
   - `predictor.py` (`_model_input`, `_next_pick_slots`, `_next_ban_slots`, `_evaluate_with_forecasts`, `predict` ranked handling)
3. **Tests (`tests/`):**
   - `tests/test_api.py::test_ranked_10_ban_mode_api_and_validation`
   - `tests/test_rl_search.py::test_ranked_10_ban_search_transitions_and_sequence`

## How to Restore

```bash
git apply --ignore-whitespace --check docs/archive/ranked_10_ban_mode/ranked_10_ban_mode.patch
git apply --ignore-whitespace docs/archive/ranked_10_ban_mode/ranked_10_ban_mode.patch
```

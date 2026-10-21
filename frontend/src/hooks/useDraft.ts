import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { getJson, isAbortError, postJson } from "../api/client";
import { CANONICAL_DRAFT_STEPS, type DraftPredictionResponse, type Hero } from "../types/draft";
import {
  buildPredictPayload,
  draftReducer,
  EMPTY_PREDICTION,
  INITIAL_DRAFT_STATE,
  type PredictionState,
  prioritizeMissingLanes,
  unavailableSet,
} from "../utils/draft";

// Fetch a wider candidate pool so lane-filling heroes can be promoted into the top 5
const CANDIDATE_POOL = 20;
const GLOBAL_BANS: readonly string[] = [];

function useHeroCatalog() {
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    async function load() {
      try {
        const data = await getJson<{ hero_details?: Hero[] }>("/heroes", ctrl.signal);
        if (data.hero_details) {
          setHeroes(data.hero_details);
          return;
        }
      } catch (err) {
        if (isAbortError(err)) return;
        console.warn("Could not fetch /heroes from FastAPI, falling back to local images:", err);
      }

      // Fallback: build a minimal catalog from /hero_images.json
      try {
        const images = await getJson<Record<string, string>>("/hero_images.json", ctrl.signal);
        setHeroes(
          Object.entries(images).map(([name, image_url], idx) => ({
            id: idx,
            name,
            role: "Warrior",
            lane: "DS_Lane (ออฟเลน)",
            tier: "A",
            image_url,
          })),
        );
        setIsFallback(true);
      } catch (err) {
        if (!isAbortError(err)) setError("Failed to load hero database");
      }
    }
    load().finally(() => {
      if (!ctrl.signal.aborted) setIsLoading(false);
    });
    return () => ctrl.abort();
  }, []);

  return { heroes, isLoading, isFallback, error };
}

export function useDraft() {
  const catalog = useHeroCatalog();
  const [state, dispatch] = useReducer(draftReducer, INITIAL_DRAFT_STATE);
  const [useLookahead, setUseLookahead] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [predictError, setPredictError] = useState<string | null>(null);

  const { stepIndex, bluePicks, redPicks, blueBans, redBans } = state;
  const currentStep = CANONICAL_DRAFT_STEPS[stepIndex] ?? null;

  const heroMap = useMemo(() => new Map(catalog.heroes.map((h) => [h.name, h])), [catalog.heroes]);

  const unavailableHeroes = useMemo(
    () => unavailableSet({ bluePicks, redPicks, blueBans, redBans }, GLOBAL_BANS),
    [bluePicks, redPicks, blueBans, redBans],
  );

  // Fetch AI recommendations whenever the draft or lookahead setting changes.
  // Aborting on cleanup guarantees stale responses never overwrite newer state.
  useEffect(() => {
    const ctrl = new AbortController();
    const draft = { bluePicks, redPicks, blueBans, redBans };
    const step = CANONICAL_DRAFT_STEPS[stepIndex];

    async function run() {
      setIsLoading(true);
      setPredictError(null);
      try {
        const data = await postJson<DraftPredictionResponse>(
          "/predict",
          buildPredictPayload(stepIndex, draft, GLOBAL_BANS, useLookahead, CANDIDATE_POOL),
          ctrl.signal,
        );

        if (!step) {
          // Draft is complete: only the final matchup win rate matters
          const finalWin = data.recommendations[0]?.predicted_win_rate_pct ?? null;
          dispatch({ type: "predicted", stepIndex, prediction: EMPTY_PREDICTION, blueWinRate: finalWin });
          return;
        }

        const missing = data.missing_ally_lanes ?? [];
        const prediction: PredictionState = {
          recommendations:
            step.action === "pick" ? prioritizeMissingLanes(data.recommendations, missing) : data.recommendations,
          blueNextPicks: data.blue_next_picks ?? [],
          redNextPicks: data.red_next_picks ?? [],
          blueNextBans: data.blue_next_bans ?? [],
          redNextBans: data.red_next_bans ?? [],
          banUnlockedHeroes: data.ban_unlocked_heroes ?? [],
          missingAllyLanes: missing,
        };

        // Win estimate uses the model's own top choice, not the lane-adjusted one
        const top = data.recommendations[0];
        let blueWin: number | null = null;
        if (top) {
          const recWin = top.lookahead_win_rate_pct ?? top.predicted_win_rate_pct;
          blueWin = Number((step.side === "blue" ? recWin : 100.0 - recWin).toFixed(1));
        }
        dispatch({ type: "predicted", stepIndex, prediction, blueWinRate: blueWin });
      } catch (err) {
        if (isAbortError(err)) return;
        console.error("Predict error:", err);
        if (step) {
          setPredictError(err instanceof Error ? err.message : "Draft AI service error");
        } else {
          // A failed final evaluation keeps the last estimate but clears the step suggestions
          dispatch({ type: "predicted", stepIndex, prediction: EMPTY_PREDICTION, blueWinRate: null });
        }
      } finally {
        if (!ctrl.signal.aborted) setIsLoading(false);
      }
    }

    run();
    return () => ctrl.abort();
  }, [stepIndex, bluePicks, redPicks, blueBans, redBans, useLookahead]);

  const lockHero = useCallback((hero: string) => dispatch({ type: "lock", hero }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const reset = useCallback(() => {
    dispatch({ type: "reset" });
    setPredictError(null);
  }, []);

  return {
    heroes: catalog.heroes,
    heroMap,
    currentStepIndex: stepIndex,
    currentStep,
    totalSteps: CANONICAL_DRAFT_STEPS.length,
    bluePicks,
    redPicks,
    blueBans,
    redBans,
    unavailableHeroes,
    useLookahead,
    setUseLookahead,
    ...state.prediction,
    blueWinRate: state.blueWinRate,
    winHistory: state.winHistory,
    isLoading,
    isHeroesLoading: catalog.isLoading,
    error: predictError ?? catalog.error,
    heroesFallback: catalog.isFallback,
    lockHero,
    undo,
    reset,
    canUndo: state.history.length > 0,
  };
}

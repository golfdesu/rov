import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CANONICAL_DRAFT_STEPS,
  type DraftHistoryItem,
  type DraftPredictionResponse,
  type DraftStep,
  type Hero,
  type HeroRecommendation,
} from "../types/draft";

export function useDraft() {
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [bluePicks, setBluePicks] = useState<string[]>([]);
  const [redPicks, setRedPicks] = useState<string[]>([]);
  const [blueBans, setBlueBans] = useState<string[]>([]);
  const [redBans, setRedBans] = useState<string[]>([]);
  const [globalBans] = useState<string[]>([]);
  const [useLookahead, setUseLookahead] = useState<boolean>(false);
  const [history, setHistory] = useState<DraftHistoryItem[]>([]);

  const [recommendations, setRecommendations] = useState<HeroRecommendation[]>([]);
  const [missingAllyLanes, setMissingAllyLanes] = useState<string[]>([]);
  const [blueWinRate, setBlueWinRate] = useState<number>(50.0);
  // Blue win-rate estimate recorded at each draft step (index = step), used for trend + deltas
  const [winHistory, setWinHistory] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isHeroesLoading, setIsHeroesLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Active step (or null if draft completed)
  const currentStep: DraftStep | null = useMemo(() => {
    if (currentStepIndex < CANONICAL_DRAFT_STEPS.length) {
      return CANONICAL_DRAFT_STEPS[currentStepIndex];
    }
    return null;
  }, [currentStepIndex]);

  // Fast hero lookup map
  const heroMap = useMemo(() => {
    const map = new Map<string, Hero>();
    heroes.forEach((h) => map.set(h.name, h));
    return map;
  }, [heroes]);

  // Set of all unavailable heroes (picked or banned)
  const unavailableHeroes = useMemo(() => {
    return new Set<string>([
      ...bluePicks,
      ...redPicks,
      ...blueBans,
      ...redBans,
      ...globalBans,
    ]);
  }, [bluePicks, redPicks, blueBans, redBans, globalBans]);

  // 1. Initial Load: Fetch Hero Catalog
  useEffect(() => {
    let isMounted = true;
    async function loadHeroes() {
      try {
        setIsHeroesLoading(true);
        const res = await fetch("/heroes");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (isMounted && data.hero_details) {
          setHeroes(data.hero_details);
          setIsHeroesLoading(false);
          return;
        }
      } catch (err) {
        console.warn("Could not fetch /heroes from FastAPI, falling back to local images:", err);
      }

      // Fallback: try loading /hero_images.json directly
      try {
        const res = await fetch("/hero_images.json");
        const images: Record<string, string> = await res.json();
        const fallbackHeroes: Hero[] = Object.keys(images).map((name, idx) => ({
          id: idx,
          name,
          role: "Warrior",
          lane: "DS_Lane (ออฟเลน)",
          tier: "A",
          image_url: images[name],
        }));
        if (isMounted) {
          setHeroes(fallbackHeroes);
        }
      } catch {
        if (isMounted) setError("Failed to load hero database");
      } finally {
        if (isMounted) setIsHeroesLoading(false);
      }
    }

    loadHeroes();
    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Fetch AI Recommendations when draft state changes
  const abortControllerRef = useRef<AbortController | null>(null);

  const recordWin = useCallback((stepIdx: number, value: number) => {
    setWinHistory((prev) => {
      const next = prev.slice(0, stepIdx);
      next[stepIdx] = value;
      return next;
    });
  }, []);

  const fetchRecommendations = useCallback(
    async (
      stepIdx: number,
      bPicks: string[],
      rPicks: string[],
      bBans: string[],
      rBans: string[],
      lookahead: boolean
    ) => {
      if (stepIdx >= CANONICAL_DRAFT_STEPS.length) {
        // Draft is complete! Evaluate final matchup win rate
        try {
          setIsLoading(true);
          const res = await fetch("/predict", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "pick",
              side: "blue",
              phase: 2,
              ally_picks: bPicks,
              enemy_picks: rPicks,
              ally_bans: bBans,
              enemy_bans: rBans,
              global_bans: globalBans,
              top_k: 1,
              use_lookahead: false,
            }),
          });
          if (res.ok) {
            const data: DraftPredictionResponse = await res.json();
            if (data.recommendations.length > 0) {
              const finalWin = data.recommendations[0].predicted_win_rate_pct;
              setBlueWinRate(finalWin);
              recordWin(stepIdx, finalWin);
            }
          }
        } catch (e) {
          console.error("Final prediction error:", e);
        } finally {
          setIsLoading(false);
        }
        setRecommendations([]);
        return;
      }

      const step = CANONICAL_DRAFT_STEPS[stepIdx];
      const isBlue = step.side === "blue";

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      try {
        setIsLoading(true);
        setError(null);

        const payload = {
          mode: step.action,
          side: step.side,
          phase: step.phase,
          ally_picks: isBlue ? bPicks : rPicks,
          enemy_picks: isBlue ? rPicks : bPicks,
          ally_bans: isBlue ? bBans : rBans,
          enemy_bans: isBlue ? rBans : bBans,
          global_bans: globalBans,
          top_k: 5,
          use_lookahead: lookahead,
          lookahead_depth: 2,
        };

        const res = await fetch("/predict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: abortControllerRef.current.signal,
        });

        if (!res.ok) {
          throw new Error(`Server returned ${res.status}: ${await res.text()}`);
        }

        const data: DraftPredictionResponse = await res.json();
        setRecommendations(data.recommendations);
        setMissingAllyLanes(data.missing_ally_lanes || []);

        if (data.recommendations && data.recommendations.length > 0) {
          const top = data.recommendations[0];
          const recWin = top.lookahead_win_rate_pct ?? top.predicted_win_rate_pct;
          // Calculate Blue Win Rate: if Blue turn, recWin is Blue's; if Red turn, Blue is 100 - recWin
          const blueWin = isBlue ? recWin : 100.0 - recWin;
          setBlueWinRate(Number(blueWin.toFixed(1)));
          recordWin(stepIdx, Number(blueWin.toFixed(1)));
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        console.error("Predict error:", err);
        setError(err instanceof Error ? err.message : "Draft AI service error");
      } finally {
        setIsLoading(false);
      }
    },
    [globalBans, recordWin]
  );

  // Trigger prediction fetch on state or lookahead change
  // Deferred to a timer so rapid state changes collapse into one request
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchRecommendations(currentStepIndex, bluePicks, redPicks, blueBans, redBans, useLookahead);
    }, 0);
    return () => clearTimeout(timer);
  }, [
    currentStepIndex,
    bluePicks,
    redPicks,
    blueBans,
    redBans,
    useLookahead,
    fetchRecommendations,
  ]);

  // 3. Draft Actions
  const lockHero = useCallback(
    (heroName: string) => {
      if (currentStepIndex >= CANONICAL_DRAFT_STEPS.length) return;
      if (unavailableHeroes.has(heroName)) return;

      const step = CANONICAL_DRAFT_STEPS[currentStepIndex];

      // Save history for undo
      setHistory((prev) => [
        ...prev,
        {
          stepIndex: currentStepIndex,
          bluePicks: [...bluePicks],
          redPicks: [...redPicks],
          blueBans: [...blueBans],
          redBans: [...redBans],
        },
      ]);

      if (step.action === "ban") {
        if (step.side === "blue") {
          setBlueBans((prev) => [...prev, heroName]);
        } else {
          setRedBans((prev) => [...prev, heroName]);
        }
      } else {
        if (step.side === "blue") {
          setBluePicks((prev) => [...prev, heroName]);
        } else {
          setRedPicks((prev) => [...prev, heroName]);
        }
      }

      setCurrentStepIndex((prev) => prev + 1);
    },
    [currentStepIndex, unavailableHeroes, bluePicks, redPicks, blueBans, redBans]
  );

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    setCurrentStepIndex(last.stepIndex);
    setBluePicks(last.bluePicks);
    setRedPicks(last.redPicks);
    setBlueBans(last.blueBans);
    setRedBans(last.redBans);
    setHistory((prev) => prev.slice(0, -1));
  }, [history]);

  const reset = useCallback(() => {
    setCurrentStepIndex(0);
    setBluePicks([]);
    setRedPicks([]);
    setBlueBans([]);
    setRedBans([]);
    setHistory([]);
    setRecommendations([]);
    setMissingAllyLanes([]);
    setBlueWinRate(50.0);
    setWinHistory([]);
    setError(null);
  }, []);

  return {
    heroes,
    heroMap,
    currentStepIndex,
    currentStep,
    totalSteps: CANONICAL_DRAFT_STEPS.length,
    isDraftComplete: currentStepIndex >= CANONICAL_DRAFT_STEPS.length,
    bluePicks,
    redPicks,
    blueBans,
    redBans,
    globalBans,
    unavailableHeroes,
    useLookahead,
    setUseLookahead,
    recommendations,
    missingAllyLanes,
    blueWinRate,
    winHistory,
    isLoading,
    isHeroesLoading,
    error,
    lockHero,
    undo,
    reset,
    canUndo: history.length > 0,
  };
}

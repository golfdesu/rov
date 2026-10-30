import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { deleteJson, getJson, isAbortError, postJson, putJson } from "../api/client";
import {
  CANONICAL_DRAFT_STEPS,
  type DraftPredictionResponse,
  type DraftSessionPayload,
  type GlobalBanState,
  type Hero,
  type RecordedDraftGame,
} from "../types/draft";
import {
  blueTeamName,
  buildPredictPayload,
  DEFAULT_WIN_RATE,
  type DraftMachineState,
  draftReducer,
  EMPTY_GLOBAL_BANS,
  EMPTY_PREDICTION,
  getGameSeriesGroup,
  getGameUnlockStatus,
  getMaxUnlockedGame,
  INITIAL_DRAFT_STATE,
  type PredictionState,
  prioritizeMissingLanes,
  reconstructDraftHistory,
  redTeamName,
  resolveSeriesName,
  syncSeriesGlobalBans,
  unavailableSet,
} from "../utils/draft";

// Fetch a wider candidate pool so lane-filling heroes can be promoted into the top 5
const CANDIDATE_POOL = 20;
const SESSION_STORAGE_KEY = "rov_draft_session_v1";

function sanitizeWinHistory(arr: unknown): number[] {
  if (!Array.isArray(arr)) return [];
  const out: number[] = [];
  arr.forEach((v, i) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      out[i] = v;
    }
  });
  return out;
}

function loadLocalSession(key = SESSION_STORAGE_KEY): DraftSessionPayload | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftSessionPayload>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      stepIndex: typeof parsed.stepIndex === "number" ? parsed.stepIndex : 0,
      bluePicks: Array.isArray(parsed.bluePicks) ? parsed.bluePicks : [],
      redPicks: Array.isArray(parsed.redPicks) ? parsed.redPicks : [],
      blueBans: Array.isArray(parsed.blueBans) ? parsed.blueBans : [],
      redBans: Array.isArray(parsed.redBans) ? parsed.redBans : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
      winHistory: Array.isArray(parsed.winHistory) ? parsed.winHistory : [],
      blueWinRate: typeof parsed.blueWinRate === "number" ? parsed.blueWinRate : DEFAULT_WIN_RATE,
      useLookahead: Boolean(parsed.useLookahead),
      globalBans: parsed.globalBans ? { ...EMPTY_GLOBAL_BANS, ...parsed.globalBans } : EMPTY_GLOBAL_BANS,
      seriesGames: Array.isArray(parsed.seriesGames) ? parsed.seriesGames : [],
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

function saveLocalSession(payload: DraftSessionPayload, key = SESSION_STORAGE_KEY): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

function initMachineState(session: DraftSessionPayload | null): DraftMachineState {
  if (!session) return INITIAL_DRAFT_STATE;
  const reconstructed =
    session.history.length > 0
      ? { stepIndex: session.stepIndex, history: session.history }
      : reconstructDraftHistory({
          bluePicks: session.bluePicks,
          redPicks: session.redPicks,
          blueBans: session.blueBans,
          redBans: session.redBans,
        });
  return {
    stepIndex: reconstructed.stepIndex,
    bluePicks: session.bluePicks,
    redPicks: session.redPicks,
    blueBans: session.blueBans,
    redBans: session.redBans,
    history: reconstructed.history,
    prediction: EMPTY_PREDICTION,
    blueWinRate: session.blueWinRate ?? DEFAULT_WIN_RATE,
    winHistory: sanitizeWinHistory(session.winHistory),
  };
}

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

export interface UseDraftOptions {
  engine?: "sota" | "matrix";
  persistSession?: boolean;
  storageKey?: string;
}

export function useDraft(options: UseDraftOptions = {}) {
  const {
    engine = "sota",
    persistSession = true,
    storageKey = SESSION_STORAGE_KEY,
  } = options;

  const catalog = useHeroCatalog();
  const [initialSession] = useState<DraftSessionPayload | null>(() => loadLocalSession(storageKey));

  const [state, dispatch] = useReducer(draftReducer, initialSession, initMachineState);
  const [globalBans, setGlobalBans] = useState<GlobalBanState>(
    () => initialSession?.globalBans ?? EMPTY_GLOBAL_BANS,
  );
  const [useLookahead, setUseLookahead] = useState<boolean>(() => initialSession?.useLookahead ?? false);
  const [seriesGames, setSeriesGames] = useState<RecordedDraftGame[]>(
    () => initialSession?.seriesGames ?? [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const [predictError, setPredictError] = useState<string | null>(null);

  const lastSavedAtRef = useRef<number>(initialSession?.updatedAt ?? 0);
  const isHydratingRemoteRef = useRef<boolean>(false);
  const hasCompletedInitialSyncRef = useRef<boolean>(false);

  const { stepIndex, bluePicks, redPicks, blueBans, redBans } = state;
  const currentStep = CANONICAL_DRAFT_STEPS[stepIndex] ?? null;

  // On mount: synchronize with backend /draft/session so state survives browser cache clears or new windows
  useEffect(() => {
    if (!persistSession) return;
    const ctrl = new AbortController();
    async function syncFromServer() {
      try {
        const remote = await getJson<DraftSessionPayload>("/draft/session", ctrl.signal);
        if (remote && remote.updatedAt > lastSavedAtRef.current) {
          isHydratingRemoteRef.current = true;
          lastSavedAtRef.current = remote.updatedAt;
          const hydrated = initMachineState(remote);
          dispatch({
            type: "hydrate",
            payload: {
              stepIndex: hydrated.stepIndex,
              bluePicks: hydrated.bluePicks,
              redPicks: hydrated.redPicks,
              blueBans: hydrated.blueBans,
              redBans: hydrated.redBans,
              history: hydrated.history,
              blueWinRate: hydrated.blueWinRate,
              winHistory: hydrated.winHistory,
            },
          });
          setGlobalBans({ ...EMPTY_GLOBAL_BANS, ...remote.globalBans });
          setUseLookahead(Boolean(remote.useLookahead));
          setSeriesGames(Array.isArray(remote.seriesGames) ? remote.seriesGames : []);
          saveLocalSession(remote, storageKey);
        }
      } catch (err) {
        if (!isAbortError(err)) {
          console.warn("Could not fetch /draft/session from server, using local storage:", err);
        }
      } finally {
        hasCompletedInitialSyncRef.current = true;
      }
    }
    syncFromServer();
    return () => ctrl.abort();
  }, [persistSession, storageKey]);

  // Persist every draft/series change to both localStorage (instant F5 reload) and backend disk (/draft/session)
  useEffect(() => {
    if (isHydratingRemoteRef.current) {
      isHydratingRemoteRef.current = false;
      return;
    }
    const isDefaultEmpty =
      stepIndex === 0 &&
      bluePicks.length === 0 &&
      redPicks.length === 0 &&
      blueBans.length === 0 &&
      redBans.length === 0 &&
      seriesGames.length === 0 &&
      globalBans.teamAUsed.length === 0 &&
      globalBans.teamBUsed.length === 0 &&
      globalBans.universalBans.length === 0 &&
      globalBans.gameNumber === 1 &&
      globalBans.teamAName === "TEAM A" &&
      globalBans.teamBName === "TEAM B";

    // Avoid overwriting a non-empty remote session before initial GET /draft/session finishes
    if (persistSession && !hasCompletedInitialSyncRef.current && isDefaultEmpty && lastSavedAtRef.current === 0) {
      return;
    }

    const now = Date.now();
    lastSavedAtRef.current = now;
    const payload: DraftSessionPayload = {
      stepIndex,
      bluePicks,
      redPicks,
      blueBans,
      redBans,
      history: state.history,
      winHistory: state.winHistory.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null)),
      blueWinRate: state.blueWinRate,
      useLookahead,
      globalBans,
      seriesGames,
      updatedAt: now,
    };
    saveLocalSession(payload, storageKey);

    if (!persistSession) return;

    const ctrl = new AbortController();
    putJson("/draft/session", payload, ctrl.signal).catch((err) => {
      if (!isAbortError(err)) {
        console.warn("Could not persist /draft/session to server:", err);
      }
    });
    return () => ctrl.abort();
  }, [
    persistSession,
    storageKey,
    stepIndex,
    bluePicks,
    redPicks,
    blueBans,
    redBans,
    state.history,
    state.winHistory,
    state.blueWinRate,
    useLookahead,
    globalBans,
    seriesGames,
  ]);

  const heroMap = useMemo(() => new Map(catalog.heroes.map((h) => [h.name, h])), [catalog.heroes]);

  const unavailableHeroes = useMemo(
    () => unavailableSet({ bluePicks, redPicks, blueBans, redBans }, globalBans, stepIndex),
    [bluePicks, redPicks, blueBans, redBans, globalBans, stepIndex],
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
        const endpoint = engine === "matrix" ? "/predict/matrix" : "/predict";
        const data = await postJson<DraftPredictionResponse>(
          endpoint,
          buildPredictPayload(stepIndex, draft, globalBans, useLookahead, CANDIDATE_POOL),
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
  }, [engine, stepIndex, bluePicks, redPicks, blueBans, redBans, globalBans, useLookahead]);

  const lockHero = useCallback(
    (hero: string) => {
      if (unavailableHeroes.has(hero)) return;
      dispatch({ type: "lock", hero });
    },
    [unavailableHeroes],
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const reset = useCallback(() => {
    dispatch({ type: "reset" });
    setPredictError(null);
  }, []);

  const swapTeamSides = useCallback(() => {
    setGlobalBans((prev) => ({
      ...prev,
      blueSideTeam: prev.blueSideTeam === "A" ? "B" : "A",
    }));
  }, []);

  const recordGameToSeries = useCallback(
    (swapAfter = false) => {
      const currentGroup = resolveSeriesName(globalBans);
      const hasAnyAction = bluePicks.length + redPicks.length + blueBans.length + redBans.length > 0;
      const overwrittenGames = seriesGames.filter(
        (g) => getGameSeriesGroup(g) === currentGroup && g.gameNumber === globalBans.gameNumber,
      );

      let nextSeriesGames = seriesGames;
      if (hasAnyAction) {
        const snapshot: RecordedDraftGame = {
          id: `${Date.now()}-g${globalBans.gameNumber}`,
          gameNumber: globalBans.gameNumber,
          timestamp: new Date().toLocaleTimeString("th-TH", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          seriesName: currentGroup,
          blueTeamName: blueTeamName(globalBans),
          redTeamName: redTeamName(globalBans),
          blueSideTeam: globalBans.blueSideTeam,
          blueBans: [...blueBans],
          redBans: [...redBans],
          bluePicks: [...bluePicks],
          redPicks: [...redPicks],
          blueWinRate: state.blueWinRate,
        };
        nextSeriesGames = [
          snapshot,
          ...seriesGames.filter(
            (g) => !(getGameSeriesGroup(g) === currentGroup && g.gameNumber === globalBans.gameNumber),
          ),
        ];
        setSeriesGames(nextSeriesGames);
      }

      setGlobalBans((prev) => {
        const blueIsA = prev.blueSideTeam === "A";
        const addToA = blueIsA ? bluePicks : redPicks;
        const addToB = blueIsA ? redPicks : bluePicks;
        const nextGame = Math.min(prev.gameNumber + 1, 7);
        const synced = syncSeriesGlobalBans(prev, nextSeriesGames, nextGame, overwrittenGames);
        return {
          ...prev,
          teamAUsed: Array.from(new Set([...synced.teamAUsed, ...addToA])),
          teamBUsed: Array.from(new Set([...synced.teamBUsed, ...addToB])),
          gameNumber: nextGame,
          blueSideTeam: swapAfter ? (prev.blueSideTeam === "A" ? "B" : "A") : prev.blueSideTeam,
        };
      });
      dispatch({ type: "reset" });
      setPredictError(null);
    },
    [bluePicks, redPicks, blueBans, redBans, globalBans, seriesGames, state.blueWinRate],
  );

  const saveCurrentDraftSnapshot = useCallback(() => {
    const hasAnyAction = bluePicks.length + redPicks.length + blueBans.length + redBans.length > 0;
    if (!hasAnyAction) return;
    const currentGroup = resolveSeriesName(globalBans);
    const snapshot: RecordedDraftGame = {
      id: `${Date.now()}-g${globalBans.gameNumber}`,
      gameNumber: globalBans.gameNumber,
      timestamp: new Date().toLocaleTimeString("th-TH", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      seriesName: currentGroup,
      blueTeamName: blueTeamName(globalBans),
      redTeamName: redTeamName(globalBans),
      blueSideTeam: globalBans.blueSideTeam,
      blueBans: [...blueBans],
      redBans: [...redBans],
      bluePicks: [...bluePicks],
      redPicks: [...redPicks],
      blueWinRate: state.blueWinRate,
    };
    setSeriesGames((prev) => [
      snapshot,
      ...prev.filter((g) => !(getGameSeriesGroup(g) === currentGroup && g.gameNumber === globalBans.gameNumber)),
    ]);
  }, [bluePicks, redPicks, blueBans, redBans, globalBans, state.blueWinRate]);

  const loadRecordedGame = useCallback(
    (game: RecordedDraftGame, gamesListOverride?: RecordedDraftGame[]) => {
      const activeSeriesGames = gamesListOverride ?? seriesGames;
      const reconstructed = reconstructDraftHistory({
        bluePicks: game.bluePicks,
        redPicks: game.redPicks,
        blueBans: game.blueBans,
        redBans: game.redBans,
      });
      dispatch({
        type: "hydrate",
        payload: {
          stepIndex: reconstructed.stepIndex,
          bluePicks: [...game.bluePicks],
          redPicks: [...game.redPicks],
          blueBans: [...game.blueBans],
          redBans: [...game.redBans],
          history: reconstructed.history,
          blueWinRate: game.blueWinRate,
          winHistory: [],
        },
      });
      const targetGroup = getGameSeriesGroup(game);
      const teamAName = game.blueSideTeam === "A" ? game.blueTeamName : game.redTeamName;
      const teamBName = game.blueSideTeam === "A" ? game.redTeamName : game.blueTeamName;
      setGlobalBans((prev) => {
        const sameSeries = resolveSeriesName(prev) === targetGroup;
        const baseState: GlobalBanState = sameSeries
          ? prev
          : {
              ...prev,
              seriesName: game.seriesName || targetGroup,
              teamAName: teamAName || prev.teamAName,
              teamBName: teamBName || prev.teamBName,
              teamAUsed: [],
              teamBUsed: [],
            };
        const synced = syncSeriesGlobalBans(baseState, activeSeriesGames, game.gameNumber, [], targetGroup);
        return {
          ...baseState,
          ...synced,
          gameNumber: game.gameNumber,
          blueSideTeam: game.blueSideTeam,
        };
      });
      setPredictError(null);
    },
    [seriesGames],
  );

  const selectGameNumber = useCallback(
    (nextGameNumber: number) => {
      if (nextGameNumber === globalBans.gameNumber) return;

      const currentGroup = resolveSeriesName(globalBans);
      const hasCurrentActions =
        bluePicks.length + redPicks.length + blueBans.length + redBans.length > 0;

      let nextSeriesGames = seriesGames;
      const overwrittenGames = hasCurrentActions
        ? seriesGames.filter(
            (g) => getGameSeriesGroup(g) === currentGroup && g.gameNumber === globalBans.gameNumber,
          )
        : [];

      if (hasCurrentActions) {
        const snapshot: RecordedDraftGame = {
          id: `${Date.now()}-g${globalBans.gameNumber}`,
          gameNumber: globalBans.gameNumber,
          timestamp: new Date().toLocaleTimeString("th-TH", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          seriesName: currentGroup,
          blueTeamName: blueTeamName(globalBans),
          redTeamName: redTeamName(globalBans),
          blueSideTeam: globalBans.blueSideTeam,
          blueBans: [...blueBans],
          redBans: [...redBans],
          bluePicks: [...bluePicks],
          redPicks: [...redPicks],
          blueWinRate: state.blueWinRate,
        };
        nextSeriesGames = [
          snapshot,
          ...seriesGames.filter(
            (g) => !(getGameSeriesGroup(g) === currentGroup && g.gameNumber === globalBans.gameNumber),
          ),
        ];
      }

      const unlockStatus = getGameUnlockStatus(nextGameNumber, globalBans, nextSeriesGames);
      if (!unlockStatus.isUnlocked) {
        return;
      }

      if (hasCurrentActions) {
        setSeriesGames(nextSeriesGames);
      }

      const targetGame = nextSeriesGames.find(
        (g) => getGameSeriesGroup(g) === currentGroup && g.gameNumber === nextGameNumber,
      );

      if (targetGame) {
        loadRecordedGame(targetGame, nextSeriesGames);
      } else {
        dispatch({ type: "reset" });
        setPredictError(null);
        setGlobalBans((prev) => {
          const synced = syncSeriesGlobalBans(prev, nextSeriesGames, nextGameNumber, overwrittenGames);
          return {
            ...prev,
            ...synced,
            gameNumber: nextGameNumber,
          };
        });
      }
    },
    [
      globalBans,
      seriesGames,
      bluePicks,
      redPicks,
      blueBans,
      redBans,
      state.blueWinRate,
      loadRecordedGame,
    ],
  );

  const deleteRecordedGame = useCallback(
    (id: string) => {
      const deleted = seriesGames.find((g) => g.id === id);
      const nextSeriesGames = seriesGames.filter((g) => g.id !== id);
      setSeriesGames(nextSeriesGames);
      if (deleted) {
        setGlobalBans((prev) => {
          if (getGameSeriesGroup(deleted) !== resolveSeriesName(prev)) return prev;
          const synced = syncSeriesGlobalBans(prev, nextSeriesGames, prev.gameNumber, [deleted]);
          const candidate: GlobalBanState = {
            ...prev,
            ...synced,
          };
          const maxUnlocked = getMaxUnlockedGame(candidate, nextSeriesGames);
          const clampedGame = Math.min(prev.gameNumber, maxUnlocked);
          const finalSynced =
            clampedGame !== prev.gameNumber
              ? syncSeriesGlobalBans(candidate, nextSeriesGames, clampedGame)
              : synced;
          return {
            ...prev,
            ...finalSynced,
            gameNumber: clampedGame,
          };
        });
      }
    },
    [seriesGames],
  );

  const deleteSeriesGroup = useCallback((groupName: string) => {
    setSeriesGames((prev) => prev.filter((g) => getGameSeriesGroup(g) !== groupName));
    setGlobalBans((prev) => {
      if (resolveSeriesName(prev) !== groupName) return prev;
      return {
        ...prev,
        teamAUsed: [],
        teamBUsed: [],
        gameNumber: 1,
      };
    });
  }, []);

  const startNewSeries = useCallback(
    (teamAName: string, teamBName: string, customSeriesName?: string) => {
      const hasAnyAction = bluePicks.length + redPicks.length + blueBans.length + redBans.length > 0;
      if (hasAnyAction) {
        saveCurrentDraftSnapshot();
      }

      const tA = teamAName.trim() || "TEAM A";
      const tB = teamBName.trim() || "TEAM B";
      const sName = customSeriesName?.trim() || `${tA} vs ${tB}`;

      dispatch({ type: "reset" });
      setPredictError(null);

      setGlobalBans({
        seriesName: sName,
        teamAName: tA,
        teamBName: tB,
        teamAUsed: [],
        teamBUsed: [],
        universalBans: [],
        blueSideTeam: "A",
        gameNumber: 1,
      });
    },
    [bluePicks, redPicks, blueBans, redBans, saveCurrentDraftSnapshot],
  );

  const switchSeries = useCallback(
    (groupName: string) => {
      const currentGroup = resolveSeriesName(globalBans);
      const hasCurrentActions =
        bluePicks.length + redPicks.length + blueBans.length + redBans.length > 0;

      let nextSeriesGames = seriesGames;
      if (hasCurrentActions) {
        const snapshot: RecordedDraftGame = {
          id: `${Date.now()}-g${globalBans.gameNumber}`,
          gameNumber: globalBans.gameNumber,
          timestamp: new Date().toLocaleTimeString("th-TH", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          seriesName: currentGroup,
          blueTeamName: blueTeamName(globalBans),
          redTeamName: redTeamName(globalBans),
          blueSideTeam: globalBans.blueSideTeam,
          blueBans: [...blueBans],
          redBans: [...redBans],
          bluePicks: [...bluePicks],
          redPicks: [...redPicks],
          blueWinRate: state.blueWinRate,
        };
        nextSeriesGames = [
          snapshot,
          ...seriesGames.filter(
            (g) => !(getGameSeriesGroup(g) === currentGroup && g.gameNumber === globalBans.gameNumber),
          ),
        ];
        setSeriesGames(nextSeriesGames);
      }

      const groupGames = nextSeriesGames.filter((g) => getGameSeriesGroup(g) === groupName);
      if (groupGames.length === 0) return;

      const sorted = [...groupGames].sort((a, b) => a.gameNumber - b.gameNumber);
      const latest = sorted[sorted.length - 1];

      if (latest.bluePicks.length < 5 || latest.redPicks.length < 5) {
        loadRecordedGame(latest, nextSeriesGames);
        return;
      }

      const teamAName = latest.blueSideTeam === "A" ? latest.blueTeamName : latest.redTeamName;
      const teamBName = latest.blueSideTeam === "A" ? latest.redTeamName : latest.blueTeamName;
      const targetGameNumber = Math.min(latest.gameNumber + 1, 7);

      const baseBans: GlobalBanState = {
        seriesName: latest.seriesName || groupName,
        teamAName,
        teamBName,
        teamAUsed: [],
        teamBUsed: [],
        universalBans: [],
        blueSideTeam: latest.blueSideTeam,
        gameNumber: targetGameNumber,
      };
      const synced = syncSeriesGlobalBans(baseBans, nextSeriesGames, targetGameNumber, [], groupName);
      const candidate: GlobalBanState = { ...baseBans, ...synced };
      const maxUnlocked = getMaxUnlockedGame(candidate, nextSeriesGames, groupName);
      const finalGameNumber = Math.min(targetGameNumber, maxUnlocked);
      const finalSynced =
        finalGameNumber !== targetGameNumber
          ? syncSeriesGlobalBans(baseBans, nextSeriesGames, finalGameNumber, [], groupName)
          : synced;

      dispatch({ type: "reset" });
      setPredictError(null);
      setGlobalBans({
        ...baseBans,
        ...finalSynced,
        gameNumber: finalGameNumber,
      });
    },
    [
      seriesGames,
      globalBans,
      bluePicks,
      redPicks,
      blueBans,
      redBans,
      state.blueWinRate,
      loadRecordedGame,
    ],
  );

  const clearAllHistory = useCallback(() => {
    dispatch({ type: "reset" });
    setGlobalBans(EMPTY_GLOBAL_BANS);
    setSeriesGames([]);
    setPredictError(null);
    lastSavedAtRef.current = Date.now();
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    if (persistSession) {
      deleteJson("/draft/session").catch(() => {
        // ignore
      });
    }
  }, [persistSession, storageKey]);

  const importDraft = useCallback(
    (draft: {
      bluePicks: string[];
      redPicks: string[];
      blueBans: string[];
      redBans: string[];
      globalBans?: GlobalBanState;
    }) => {
      const reconstructed = reconstructDraftHistory({
        bluePicks: draft.bluePicks,
        redPicks: draft.redPicks,
        blueBans: draft.blueBans,
        redBans: draft.redBans,
      });
      dispatch({
        type: "hydrate",
        payload: {
          stepIndex: reconstructed.stepIndex,
          bluePicks: [...draft.bluePicks],
          redPicks: [...draft.redPicks],
          blueBans: [...draft.blueBans],
          redBans: [...draft.redBans],
          history: reconstructed.history,
          blueWinRate: DEFAULT_WIN_RATE,
          winHistory: [],
        },
      });
      if (draft.globalBans) {
        setGlobalBans(draft.globalBans);
      }
      setPredictError(null);
    },
    [],
  );

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
    globalBans,
    setGlobalBans,
    selectGameNumber,
    seriesGames,
    saveCurrentDraftSnapshot,
    startNewSeries,
    switchSeries,
    loadRecordedGame,
    deleteRecordedGame,
    deleteSeriesGroup,
    clearAllHistory,
    swapTeamSides,
    recordGameToSeries,
    importDraft,
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

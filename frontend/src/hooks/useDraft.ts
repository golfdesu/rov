import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ApiError, deleteJson, getJson, isAbortError, postJson, putJson } from "../api/client";
import {
  type DraftPredictionResponse,
  type DraftSessionPayload,
  type GlobalBanState,
  type Hero,
  type LaneKey,
  type LeagueCode,
  type RecordedDraftGame,
  type TeamId,
} from "../types/draft";
import {
  activeGlobalBansForStep,
  blueTeamName,
  buildPredictPayload,
  DEFAULT_WIN_RATE,
  type DraftMachineState,
  draftReducer,
  EMPTY_GLOBAL_BANS,
  EMPTY_PREDICTION,
  getCurrentDraftStep,
  getGameSeriesGroup,
  getGameUnlockStatus,
  getMaxUnlockedGame,
  getSeriesWinningHeroes,
  INITIAL_DRAFT_STATE,
  LANE_CYCLE,
  type PredictionState,
  prioritizeMissingLanes,
  reconstructDraftHistory,
  redTeamName,
  resolveSeriesName,
  syncSeriesGlobalBans,
  unavailableSet,
} from "../utils/draft";
import { displayName } from "../utils/heroNames";

// Fetch a wider candidate pool so lane-filling and per-lane filtered heroes always have 5+ candidates
const CANDIDATE_POOL = 50;
export const MAX_SERIES_GAMES = 100;
const SESSION_STORAGE_KEY = "rov_draft_session_v1";
const VALID_LEAGUES: readonly LeagueCode[] = ["GLOBAL", "RPL", "GCS", "AOG", "INTL"];

function upsertSeriesGame(list: RecordedDraftGame[], snapshot: RecordedDraftGame, currentGroup: string): RecordedDraftGame[] {
  const filtered = list.filter(
    (g) => !(getGameSeriesGroup(g) === currentGroup && g.gameNumber === snapshot.gameNumber),
  );
  return [snapshot, ...filtered].slice(0, MAX_SERIES_GAMES);
}

function sanitizeLeague(v: unknown): LeagueCode {
  if (v === "APL" || v === "AIC") return "INTL";
  return typeof v === "string" && VALID_LEAGUES.includes(v as LeagueCode) ? (v as LeagueCode) : "GLOBAL";
}

function sanitizeEngine(_v: unknown): "sota" {
  return "sota";
}

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

function normalizeHeroList(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of arr) {
    if (typeof h !== "string") continue;
    const canonical = displayName(h);
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      out.push(canonical);
    }
  }
  return out;
}

function normalizePickLanes(raw: unknown): Record<string, LaneKey> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, LaneKey> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || typeof v !== "string") continue;
    if (!LANE_CYCLE.includes(v as LaneKey)) continue;
    const canonical = displayName(k);
    if (canonical) out[canonical] = v as LaneKey;
  }
  return out;
}

export function normalizeSessionPayload(parsed: Partial<DraftSessionPayload>): DraftSessionPayload {
  const rawGb = parsed.globalBans ? { ...EMPTY_GLOBAL_BANS, ...parsed.globalBans } : EMPTY_GLOBAL_BANS;
  const globalBans: GlobalBanState = {
    ...rawGb,
    teamAUsed: normalizeHeroList(rawGb.teamAUsed),
    teamBUsed: normalizeHeroList(rawGb.teamBUsed),
    universalBans: normalizeHeroList(rawGb.universalBans),
  };
  const seriesGames: RecordedDraftGame[] = Array.isArray(parsed.seriesGames)
    ? parsed.seriesGames.map((g) => ({
        ...g,
        bluePicks: normalizeHeroList(g.bluePicks),
        redPicks: normalizeHeroList(g.redPicks),
        blueBans: normalizeHeroList(g.blueBans),
        redBans: normalizeHeroList(g.redBans),
      }))
    : [];

  return {
    stepIndex: typeof parsed.stepIndex === "number" ? parsed.stepIndex : 0,
    bluePicks: normalizeHeroList(parsed.bluePicks),
    redPicks: normalizeHeroList(parsed.redPicks),
    blueBans: normalizeHeroList(parsed.blueBans),
    redBans: normalizeHeroList(parsed.redBans),
    pickLanes: normalizePickLanes(parsed.pickLanes),
    history: Array.isArray(parsed.history)
      ? parsed.history.map((entry) => ({
          ...entry,
          bluePicks: normalizeHeroList(entry.bluePicks),
          redPicks: normalizeHeroList(entry.redPicks),
          blueBans: normalizeHeroList(entry.blueBans),
          redBans: normalizeHeroList(entry.redBans),
        }))
      : [],
    winHistory: Array.isArray(parsed.winHistory) ? parsed.winHistory : [],
    blueWinRate: typeof parsed.blueWinRate === "number" ? parsed.blueWinRate : DEFAULT_WIN_RATE,
    useLookahead: Boolean(parsed.useLookahead),
    engine: sanitizeEngine(parsed.engine),
    league: sanitizeLeague(parsed.league),
    globalBans,
    seriesGames,
    updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
  };
}

/**
 * Merges a guest draft session into an existing account session without discarding
 * the account's saved series history (`seriesGames`).
 */
export function mergeGuestIntoAccountSession(
  rawGuest: Partial<DraftSessionPayload>,
  rawAccount: Partial<DraftSessionPayload> | null,
): DraftSessionPayload {
  const guest = normalizeSessionPayload(rawGuest);
  const account = rawAccount ? normalizeSessionPayload(rawAccount) : normalizeSessionPayload({});

  const guestBoardCount =
    guest.bluePicks.length + guest.redPicks.length + guest.blueBans.length + guest.redBans.length;
  const guestGbCount =
    guest.globalBans.teamAUsed.length + guest.globalBans.teamBUsed.length + guest.globalBans.universalBans.length;
  const useGuestBoard = guestBoardCount > 0 || guestGbCount > 0;
  const boardSource = useGuestBoard ? guest : account;

  const seenIds = new Set<string>();
  const mergedSeriesGames: RecordedDraftGame[] = [];
  for (const game of [...guest.seriesGames, ...account.seriesGames]) {
    const gid = typeof game.id === "string" ? game.id.trim() : "";
    if (gid) {
      if (seenIds.has(gid)) continue;
      seenIds.add(gid);
    }
    mergedSeriesGames.push(game);
    if (mergedSeriesGames.length >= MAX_SERIES_GAMES) break;
  }

  return {
    ...boardSource,
    seriesGames: mergedSeriesGames,
    updatedAt: Math.max(Date.now(), account.updatedAt + 1),
  };
}

function loadLocalSession(key = SESSION_STORAGE_KEY): DraftSessionPayload | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftSessionPayload>;
    if (!parsed || typeof parsed !== "object") return null;
    return normalizeSessionPayload(parsed);
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
      ? {
          stepIndex: session.stepIndex,
          history: session.history,
        }
      : reconstructDraftHistory({
          bluePicks: session.bluePicks,
          redPicks: session.redPicks,
          blueBans: session.blueBans,
          redBans: session.redBans,
        });
  return {
    ...INITIAL_DRAFT_STATE,
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

let cachedHeroesCatalog: { heroes: Hero[]; isFallback: boolean } | null = null;
let inflightHeroesPromise: Promise<{ heroes: Hero[]; isFallback: boolean }> | null = null;

async function fetchHeroCatalogOnce(): Promise<{ heroes: Hero[]; isFallback: boolean }> {
  if (cachedHeroesCatalog) return cachedHeroesCatalog;
  if (inflightHeroesPromise) return inflightHeroesPromise;

  inflightHeroesPromise = (async () => {
    try {
      const data = await getJson<{ hero_details?: Hero[] }>("/heroes");
      if (data.hero_details && data.hero_details.length > 0) {
        const res = { heroes: data.hero_details, isFallback: false };
        cachedHeroesCatalog = res;
        return res;
      }
    } catch (err) {
      console.warn("Could not fetch /heroes from FastAPI, falling back to local images:", err);
    }

    const images = await getJson<Record<string, string>>("/hero_images.json");
    const heroes = Object.entries(images).map(([name, image_url], idx) => ({
      id: idx,
      name,
      role: "Fighter" as const,
      lane: "DS_Lane (ออฟเลน)",
      tier: "A" as const,
      image_url,
    }));
    const res = { heroes, isFallback: true };
    cachedHeroesCatalog = res;
    return res;
  })().finally(() => {
    inflightHeroesPromise = null;
  });

  return inflightHeroesPromise;
}

function isSameRecordedDraft(
  saved: RecordedDraftGame | undefined,
  blueSideTeam: TeamId,
  blueBans: string[],
  redBans: string[],
  bluePicks: string[],
  redPicks: string[],
): boolean {
  if (!saved) return false;
  const sameArr = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  return (
    saved.blueSideTeam === blueSideTeam &&
    sameArr(saved.blueBans, blueBans) &&
    sameArr(saved.redBans, redBans) &&
    sameArr(saved.bluePicks, bluePicks) &&
    sameArr(saved.redPicks, redPicks)
  );
}

function useHeroCatalog() {
  const [heroes, setHeroes] = useState<Hero[]>(() => cachedHeroesCatalog?.heroes ?? []);
  const [isLoading, setIsLoading] = useState<boolean>(() => cachedHeroesCatalog === null);
  const [isFallback, setIsFallback] = useState<boolean>(() => cachedHeroesCatalog?.isFallback ?? false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cachedHeroesCatalog) return;
    let cancelled = false;
    fetchHeroCatalogOnce()
      .then((res) => {
        if (!cancelled) {
          setHeroes(res.heroes);
          setIsFallback(res.isFallback);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load hero database");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { heroes, isLoading, isFallback, error };
}

export interface UseDraftOptions {
  persistSession?: boolean;
  storageKey?: string;
  enabled?: boolean;
}

export function useDraft(options: UseDraftOptions = {}) {
  const {
    persistSession = true,
    storageKey = SESSION_STORAGE_KEY,
    enabled = true,
  } = options;

  const catalog = useHeroCatalog();
  const [initialSession] = useState<DraftSessionPayload | null>(() => loadLocalSession(storageKey));
  const engine = "sota" as const;
  const [state, dispatch] = useReducer(draftReducer, initialSession, initMachineState);
  const [globalBans, setGlobalBans] = useState<GlobalBanState>(
    () => initialSession?.globalBans ?? EMPTY_GLOBAL_BANS,
  );
  const [useLookahead, setUseLookahead] = useState<boolean>(() => initialSession?.useLookahead ?? false);
  const [league, setLeague] = useState<LeagueCode>(() => sanitizeLeague(initialSession?.league));
  const [pickLanes, setPickLanes] = useState<Record<string, LaneKey>>(() => initialSession?.pickLanes ?? {});
  const [seriesGames, setSeriesGames] = useState<RecordedDraftGame[]>(
    () => initialSession?.seriesGames ?? [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const [predictError, setPredictError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [predictRetryKey, setPredictRetryKey] = useState(0);
  const [pausePredict, setPausePredict] = useState(false);
  const predictCacheRef = useRef<Map<string, DraftPredictionResponse>>(new Map());
  const lastPredictedKeyRef = useRef<string | null>(null);
  const handledRetryKeyRef = useRef<number>(0);
  const unsavedDraftsRef = useRef<
    Record<
      string,
      {
        stepIndex: number;
        bluePicks: string[];
        redPicks: string[];
        blueBans: string[];
        redBans: string[];
        history: typeof state.history;
        winHistory: typeof state.winHistory;
        blueWinRate: number;
        blueSideTeam: TeamId;
        pickLanes: Record<string, LaneKey>;
      }
    >
  >({});

  const lastSavedAtRef = useRef<number>(initialSession?.updatedAt ?? 0);
  const isHydratingRemoteRef = useRef<boolean>(false);
  const initialSnapshotKeyRef = useRef<string | null>(null);
  const lastLocalSnapshotKeyRef = useRef<string | null>(null);
  const lastSyncedSnapshotKeyRef = useRef<string | null>(null);
  const hasCompletedInitialSyncRef = useRef<boolean>(!persistSession);
  const hasDirtyLocalChangesRef = useRef<boolean>(false);
  const [initialSyncTick, setInitialSyncTick] = useState(0);

  const { stepIndex, bluePicks, redPicks, blueBans, redBans } = state;
  const currentStep = getCurrentDraftStep(stepIndex);

  // On mount: synchronize with backend /draft/session so state survives browser cache clears or new windows
  useEffect(() => {
    if (!persistSession) {
      hasCompletedInitialSyncRef.current = true;
      return;
    }
    const ctrl = new AbortController();
    hasCompletedInitialSyncRef.current = false;
    async function syncFromServer() {
      try {
        const rawRemote = await getJson<DraftSessionPayload>("/draft/session", ctrl.signal);
        if (rawRemote && rawRemote.updatedAt > lastSavedAtRef.current && !hasDirtyLocalChangesRef.current) {
          const remote = normalizeSessionPayload(rawRemote);
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
          setGlobalBans(remote.globalBans);
          setUseLookahead(Boolean(remote.useLookahead));
          setLeague(sanitizeLeague(remote.league));
          setPickLanes(remote.pickLanes ?? {});
          setSeriesGames(remote.seriesGames);
          saveLocalSession(remote, storageKey);
        }
      } catch (err) {
        if (!isAbortError(err)) {
          console.warn("Could not fetch /draft/session from server, using local storage:", err);
        }
      } finally {
        if (!ctrl.signal.aborted) {
          hasCompletedInitialSyncRef.current = true;
          if (hasDirtyLocalChangesRef.current) {
            setInitialSyncTick((t) => t + 1);
          }
        }
      }
    }
    syncFromServer();
    return () => ctrl.abort();
  }, [persistSession, storageKey]);

  const activePickLanes = useMemo(() => {
    const picked = new Set([...bluePicks, ...redPicks]);
    const out: Record<string, LaneKey> = {};
    for (const [hero, lane] of Object.entries(pickLanes)) {
      if (picked.has(hero)) out[hero] = lane;
    }
    return out;
  }, [pickLanes, bluePicks, redPicks]);

  const heroMap = useMemo(() => new Map(catalog.heroes.map((h) => [h.name, h])), [catalog.heroes]);

  const unavailableHeroes = useMemo(
    () => unavailableSet({ bluePicks, redPicks, blueBans, redBans }, globalBans, stepIndex),
    [bluePicks, redPicks, blueBans, redBans, globalBans, stepIndex],
  );

  const rawSeriesWinningHeroes = getSeriesWinningHeroes(seriesGames, resolveSeriesName(globalBans), globalBans.gameNumber);
  const seriesWinningHeroesKey = rawSeriesWinningHeroes.join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- stabilize reference by value so typing names does not refire /predict
  const seriesWinningHeroes = useMemo(() => rawSeriesWinningHeroes, [seriesWinningHeroesKey]);

  // Isolate inference dependencies from team/series name edits so typing names never fires /predict
  const predictGlobalBans = useMemo<GlobalBanState>(
    () => ({
      seriesName: "",
      teamAName: "TEAM A",
      teamBName: "TEAM B",
      teamAUsed: globalBans.teamAUsed,
      teamBUsed: globalBans.teamBUsed,
      universalBans: globalBans.universalBans,
      blueSideTeam: globalBans.blueSideTeam,
      gameNumber: globalBans.gameNumber,
    }),
    [
      globalBans.teamAUsed,
      globalBans.teamBUsed,
      globalBans.universalBans,
      globalBans.blueSideTeam,
      globalBans.gameNumber,
    ],
  );

  // Persist every draft/series change to both localStorage (instant F5 reload) and backend disk (/draft/session)
  useEffect(() => {
    const syncIdentity = {
      stepIndex,
      bluePicks,
      redPicks,
      blueBans,
      redBans,
      pickLanes: activePickLanes,
      history: state.history,
      useLookahead,
      engine,
      league,
      globalBans,
      seriesGames,
    };
    const syncIdentityKey = JSON.stringify(syncIdentity);
    const bodyWithoutTimestamp = {
      ...syncIdentity,
      winHistory: state.winHistory.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null)),
      blueWinRate: state.blueWinRate,
    };
    const fullSnapshotKey = JSON.stringify(bodyWithoutTimestamp);

    if (isHydratingRemoteRef.current) {
      isHydratingRemoteRef.current = false;
      initialSnapshotKeyRef.current = syncIdentityKey;
      lastLocalSnapshotKeyRef.current = fullSnapshotKey;
      lastSyncedSnapshotKeyRef.current = syncIdentityKey;
      return;
    }

    if (initialSnapshotKeyRef.current === null) {
      initialSnapshotKeyRef.current = syncIdentityKey;
      lastLocalSnapshotKeyRef.current = fullSnapshotKey;
      lastSyncedSnapshotKeyRef.current = syncIdentityKey;
    }

    // In StrictMode or before initial GET /draft/session settles, ignore unchanged mount state
    if (persistSession && !hasCompletedInitialSyncRef.current && syncIdentityKey === initialSnapshotKeyRef.current) {
      return;
    }

    if (fullSnapshotKey !== lastLocalSnapshotKeyRef.current) {
      lastLocalSnapshotKeyRef.current = fullSnapshotKey;
      const now = Date.now();
      lastSavedAtRef.current = now;
      saveLocalSession(
        {
          ...bodyWithoutTimestamp,
          updatedAt: now,
        },
        storageKey,
      );
    }

    if (!persistSession) return;

    // Wait for initial GET /draft/session before uploading to avoid overwriting newer remote state
    if (!hasCompletedInitialSyncRef.current) {
      hasDirtyLocalChangesRef.current = true;
      return;
    }

    // Skip redundant server PUT when the effective user draft state matches the last synced snapshot
    if (syncIdentityKey === lastSyncedSnapshotKeyRef.current) {
      hasDirtyLocalChangesRef.current = false;
      return;
    }

    // Defer remote PUT while GlobalBanModal is open or an uncached /predict call is in-flight
    // so the pick/ban and the resulting blueWinRate/winHistory coalesce into a single PUT.
    const predictPayloadKey = JSON.stringify(
      buildPredictPayload(
        stepIndex,
        { bluePicks, redPicks, blueBans, redBans },
        predictGlobalBans,
        useLookahead,
        CANDIDATE_POOL,
        league,
        seriesWinningHeroes,
        activePickLanes,
      ),
    );
    const isPredictNetworkPending =
      enabled &&
      !pausePredict &&
      !predictError &&
      (isLoading ||
        (lastPredictedKeyRef.current !== predictPayloadKey && !predictCacheRef.current.has(predictPayloadKey)));
    if (pausePredict || isPredictNetworkPending) {
      return;
    }
    hasDirtyLocalChangesRef.current = false;

    const payload: DraftSessionPayload = {
      ...bodyWithoutTimestamp,
      updatedAt: lastSavedAtRef.current || Date.now(),
    };

    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      putJson("/draft/session", payload, ctrl.signal)
        .then(() => {
          if (!ctrl.signal.aborted) {
            lastSyncedSnapshotKeyRef.current = syncIdentityKey;
            setSyncError(null);
          }
        })
        .catch((err) => {
          if (!isAbortError(err)) {
            console.warn("Could not persist /draft/session to server:", err);
            setSyncError(
              `ซิงก์ข้อมูลขึ้นเซิร์ฟเวอร์ไม่สำเร็จ (${err instanceof Error ? err.message : "Network error"}) — ข้อมูลถูกเก็บไว้ในเครื่องชั่วคราวแล้ว`,
            );
          }
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [
    enabled,
    pausePredict,
    isLoading,
    predictError,
    persistSession,
    storageKey,
    initialSyncTick,
    stepIndex,
    bluePicks,
    redPicks,
    blueBans,
    redBans,
    state.history,
    state.winHistory,
    state.blueWinRate,
    useLookahead,
    engine,
    league,
    activePickLanes,
    globalBans,
    predictGlobalBans,
    seriesGames,
    seriesWinningHeroes,
  ]);

  // Fetch AI recommendations whenever the draft or lookahead setting changes.
  // Reuses exact payload cache (0 requests on no-op swaps/undo) and debounces rapid bursts.
  useEffect(() => {
    if (!enabled || pausePredict) return;
    const draft = { bluePicks, redPicks, blueBans, redBans };
    const step = getCurrentDraftStep(stepIndex);
    const predictPayload = buildPredictPayload(
      stepIndex,
      draft,
      predictGlobalBans,
      useLookahead,
      CANDIDATE_POOL,
      league,
      seriesWinningHeroes,
      activePickLanes,
    );
    const payloadKey = JSON.stringify(predictPayload);
    const isRetry = predictRetryKey !== handledRetryKeyRef.current;
    handledRetryKeyRef.current = predictRetryKey;

    if (!isRetry && lastPredictedKeyRef.current === payloadKey) {
      return;
    }

    function applyPrediction(data: DraftPredictionResponse) {
      lastPredictedKeyRef.current = payloadKey;
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
    }

    if (!isRetry) {
      const cached = predictCacheRef.current.get(payloadKey);
      if (cached) {
        setPredictError(null);
        setIsLoading(false);
        applyPrediction(cached);
        return;
      }
    }

    const ctrl = new AbortController();
    const delayMs = isRetry ? 0 : 100;
    setIsLoading(true);
    setPredictError(null);

    const timer = window.setTimeout(async () => {
      try {
        const data = await postJson<DraftPredictionResponse>("/predict", predictPayload, ctrl.signal);
        const cache = predictCacheRef.current;
        if (cache.size >= 64) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey !== undefined) cache.delete(oldestKey);
        }
        cache.set(payloadKey, data);
        applyPrediction(data);
      } catch (err) {
        if (isAbortError(err)) return;
        console.error("Predict error:", err);
        lastPredictedKeyRef.current = null;
        const msg =
          err instanceof ApiError && err.status === 429
            ? "คำขอแนะนำ AI ถี่เกินไปชั่วคราว กรุณารอสักครู่แล้วกดลองใหม่"
            : err instanceof Error
              ? err.message
              : "Draft AI service error";
        setPredictError(msg);
        if (!step) {
          dispatch({ type: "predicted", stepIndex, prediction: EMPTY_PREDICTION, blueWinRate: null });
        }
      } finally {
        if (!ctrl.signal.aborted) setIsLoading(false);
      }
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [
    enabled,
    pausePredict,
    engine,
    stepIndex,
    bluePicks,
    redPicks,
    blueBans,
    redBans,
    predictGlobalBans,
    useLookahead,
    league,
    seriesWinningHeroes,
    activePickLanes,
    predictRetryKey,
  ]);

  const retryPredict = useCallback(() => {
    setPredictError(null);
    setPredictRetryKey((k) => k + 1);
  }, []);

  const lockHero = useCallback(
    (hero: string) => {
      if (unavailableHeroes.has(hero)) return;
      dispatch({ type: "lock", hero });
    },
    [unavailableHeroes],
  );
  const undo = useCallback(() => {
    const prevEntry = state.history.at(-1);
    if (prevEntry) {
      const stillPicked = new Set([...prevEntry.bluePicks, ...prevEntry.redPicks]);
      setPickLanes((prev) => {
        let changed = false;
        const next: Record<string, LaneKey> = {};
        for (const [hero, lane] of Object.entries(prev)) {
          if (stillPicked.has(hero)) {
            next[hero] = lane;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
    dispatch({ type: "undo" });
  }, [state.history]);
  const redo = useCallback(() => {
    const next = state.future?.at(-1);
    if (!next) return;
    const step = getCurrentDraftStep(stepIndex);
    const restricted = new Set(activeGlobalBansForStep(globalBans, stepIndex));
    const newlyBluePicks = next.bluePicks.filter((h) => !bluePicks.includes(h));
    const newlyRedPicks = next.redPicks.filter((h) => !redPicks.includes(h));
    const newlyBlueBans = next.blueBans.filter((h) => !blueBans.includes(h));
    const newlyRedBans = next.redBans.filter((h) => !redBans.includes(h));
    const blocked = [...newlyBluePicks, ...newlyRedPicks, ...newlyBlueBans, ...newlyRedBans].find((h) =>
      restricted.has(h),
    );
    if (blocked && step) {
      setPredictError(`ไม่สามารถ Redo ${displayName(blocked)} ได้ เนื่องจากถูกเพิ่มเข้า Global Ban แล้ว`);
      return;
    }
    setPredictError(null);
    dispatch({ type: "redo" });
  }, [
    state.future,
    stepIndex,
    globalBans,
    bluePicks,
    redPicks,
    blueBans,
    redBans,
  ]);
  const setPickLane = useCallback(
    (heroName: string, lane?: LaneKey) => {
      const teamPicks = bluePicks.includes(heroName)
        ? bluePicks
        : redPicks.includes(heroName)
          ? redPicks
          : [];
      setPickLanes((prev) => {
        if (lane) {
          const conflict = teamPicks.some((teammate) => teammate !== heroName && prev[teammate] === lane);
          if (conflict) return prev;
        }
        const updated = { ...prev };
        if (lane) {
          updated[heroName] = lane;
        } else {
          delete updated[heroName];
        }
        return updated;
      });
    },
    [bluePicks, redPicks],
  );

  const reset = useCallback(() => {
    const draftKey = `${resolveSeriesName(globalBans)}::g${globalBans.gameNumber}`;
    delete unsavedDraftsRef.current[draftKey];
    lastPredictedKeyRef.current = "";
    dispatch({ type: "reset" });
    setPickLanes({});
    setPredictError(null);
  }, [globalBans]);

  const swapTeamSides = useCallback(() => {
    setGlobalBans((prev) => ({
      ...prev,
      blueSideTeam: prev.blueSideTeam === "A" ? "B" : "A",
    }));
  }, []);

  const loadRecordedGame = useCallback(
    (
      game: RecordedDraftGame,
      gamesListOverride?: RecordedDraftGame[],
      globalBansOverride?: GlobalBanState,
    ) => {
      let activeSeriesGames = gamesListOverride ?? seriesGames;
      const isDirectHistoryLoad = gamesListOverride === undefined && globalBansOverride === undefined;
      const hasUnsavedActions =
        isDirectHistoryLoad && bluePicks.length + redPicks.length + blueBans.length + redBans.length > 0;
      if (hasUnsavedActions) {
        const currentGroup = resolveSeriesName(globalBans);
        if (!(currentGroup === getGameSeriesGroup(game) && globalBans.gameNumber === game.gameNumber)) {
          const overwritten = activeSeriesGames.filter(
            (g) => getGameSeriesGroup(g) === currentGroup && g.gameNumber === globalBans.gameNumber,
          );
          if (
            !isSameRecordedDraft(
              overwritten[0],
              globalBans.blueSideTeam,
              blueBans,
              redBans,
              bluePicks,
              redPicks,
            )
          ) {
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
              winner: overwritten[0]?.winner,
            };
            activeSeriesGames = upsertSeriesGame(activeSeriesGames, snapshot, currentGroup);
            setSeriesGames(activeSeriesGames);
          }
        }
      }
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
        const effectivePrev = globalBansOverride ?? prev;
        const sameSeries = resolveSeriesName(effectivePrev) === targetGroup;
        const baseState: GlobalBanState = sameSeries
          ? effectivePrev
          : {
              ...effectivePrev,
              seriesName: game.seriesName || targetGroup,
              teamAName: teamAName || effectivePrev.teamAName,
              teamBName: teamBName || effectivePrev.teamBName,
              teamAUsed: [],
              teamBUsed: [],
              universalBans: [],
            };
        const synced = syncSeriesGlobalBans(baseState, activeSeriesGames, game.gameNumber, [], targetGroup);
        return {
          ...baseState,
          ...synced,
          gameNumber: game.gameNumber,
          blueSideTeam: game.blueSideTeam,
        };
      });
      setPickLanes({});
      setPredictError(null);
    },
    [seriesGames, bluePicks, redPicks, blueBans, redBans, globalBans, state.blueWinRate],
  );

  const recordGameToSeries = useCallback(
    (swapAfter = false, winner?: TeamId) => {
      if (bluePicks.length < 5 || redPicks.length < 5) return;

      const currentGroup = resolveSeriesName(globalBans);
      delete unsavedDraftsRef.current[`${currentGroup}::g${globalBans.gameNumber}`];
      const overwrittenGames = seriesGames.filter(
        (g) => getGameSeriesGroup(g) === currentGroup && g.gameNumber === globalBans.gameNumber,
      );
      const effectiveWinner = winner ?? overwrittenGames[0]?.winner;

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
        winner: effectiveWinner,
      };
      const nextSeriesGames = upsertSeriesGame(seriesGames, snapshot, currentGroup);
      setSeriesGames(nextSeriesGames);

      if (globalBans.gameNumber >= 7) {
        setGlobalBans((prev) => {
          const synced = syncSeriesGlobalBans(prev, nextSeriesGames, 7, overwrittenGames);
          return {
            ...prev,
            ...synced,
            blueSideTeam: swapAfter ? (prev.blueSideTeam === "A" ? "B" : "A") : prev.blueSideTeam,
          };
        });
        return;
      }

      const nextGame = globalBans.gameNumber + 1;
      const existingNextGame = nextSeriesGames.find(
        (g) => getGameSeriesGroup(g) === currentGroup && g.gameNumber === nextGame,
      );
      if (existingNextGame) {
        loadRecordedGame(existingNextGame, nextSeriesGames);
        return;
      }

      setGlobalBans((prev) => {
        const blueIsA = prev.blueSideTeam === "A";
        const addToA = blueIsA ? bluePicks : redPicks;
        const addToB = blueIsA ? redPicks : bluePicks;
        const synced = syncSeriesGlobalBans(prev, nextSeriesGames, nextGame, overwrittenGames);
        // Side switching is strictly manual via Swap Sides; finishing a game keeps the current side assignment.
        const nextBlueSide: TeamId = swapAfter
          ? prev.blueSideTeam === "A"
            ? "B"
            : "A"
          : prev.blueSideTeam;
        return {
          ...prev,
          teamAUsed: Array.from(new Set([...synced.teamAUsed, ...addToA])),
          teamBUsed: Array.from(new Set([...synced.teamBUsed, ...addToB])),
          gameNumber: nextGame,
          blueSideTeam: nextBlueSide,
        };
      });
      dispatch({ type: "reset" });
      setPickLanes({});
      setPredictError(null);
    },
    [
      bluePicks,
      redPicks,
      blueBans,
      redBans,
      globalBans,
      seriesGames,
      state.blueWinRate,
      loadRecordedGame,
    ],
  );

  const setRecordedGameWinner = useCallback((id: string, winner?: TeamId) => {
    setSeriesGames((prev) => prev.map((g) => (g.id === id ? { ...g, winner } : g)));
  }, []);

  const saveCurrentDraftSnapshot = useCallback(() => {
    const hasAnyAction = bluePicks.length + redPicks.length + blueBans.length + redBans.length > 0;
    if (!hasAnyAction) return;
    const currentGroup = resolveSeriesName(globalBans);
    delete unsavedDraftsRef.current[`${currentGroup}::g${globalBans.gameNumber}`];
    setSeriesGames((prev) => {
      const overwrittenGames = prev.filter(
        (g) => getGameSeriesGroup(g) === currentGroup && g.gameNumber === globalBans.gameNumber,
      );
      if (
        isSameRecordedDraft(
          overwrittenGames[0],
          globalBans.blueSideTeam,
          blueBans,
          redBans,
          bluePicks,
          redPicks,
        )
      ) {
        return prev;
      }
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
        winner: overwrittenGames[0]?.winner,
      };
      return upsertSeriesGame(prev, snapshot, currentGroup);
    });
  }, [bluePicks, redPicks, blueBans, redBans, globalBans, state.blueWinRate]);

  const selectGameNumber = useCallback(
    (nextGameNumber: number, globalBansOverride?: GlobalBanState, skipAutoSave = false) => {
      if (nextGameNumber === globalBans.gameNumber) {
        if (globalBansOverride) {
          setGlobalBans(globalBansOverride);
        }
        return;
      }

      const effectiveGlobalBans = globalBansOverride ?? globalBans;
      const currentGroup = resolveSeriesName(effectiveGlobalBans);
      const unlockStatus = getGameUnlockStatus(nextGameNumber, effectiveGlobalBans, seriesGames);
      if (!unlockStatus.isUnlocked) {
        return;
      }

      const hasCurrentActions =
        !skipAutoSave && bluePicks.length + redPicks.length + blueBans.length + redBans.length > 0;
      const currentDraftKey = `${currentGroup}::g${globalBans.gameNumber}`;
      const existingCurrentGame = seriesGames.find(
        (g) => getGameSeriesGroup(g) === currentGroup && g.gameNumber === globalBans.gameNumber,
      );

      // Preserve in-progress unsaved drafts in an isolated scratchpad instead of auto-saving them into seriesGames
      if (
        hasCurrentActions &&
        !isSameRecordedDraft(
          existingCurrentGame,
          effectiveGlobalBans.blueSideTeam,
          blueBans,
          redBans,
          bluePicks,
          redPicks,
        )
      ) {
        unsavedDraftsRef.current[currentDraftKey] = {
          stepIndex,
          bluePicks: [...bluePicks],
          redPicks: [...redPicks],
          blueBans: [...blueBans],
          redBans: [...redBans],
          history: [...state.history],
          winHistory: [...state.winHistory],
          blueWinRate: state.blueWinRate,
          blueSideTeam: effectiveGlobalBans.blueSideTeam,
          pickLanes: { ...pickLanes },
        };
      } else if (!hasCurrentActions) {
        delete unsavedDraftsRef.current[currentDraftKey];
      }

      const targetDraftKey = `${currentGroup}::g${nextGameNumber}`;
      const unsavedTarget = unsavedDraftsRef.current[targetDraftKey];
      const targetGame = seriesGames.find(
        (g) => getGameSeriesGroup(g) === currentGroup && g.gameNumber === nextGameNumber,
      );

      if (unsavedTarget) {
        dispatch({
          type: "hydrate",
          payload: {
            stepIndex: unsavedTarget.stepIndex,
            bluePicks: [...unsavedTarget.bluePicks],
            redPicks: [...unsavedTarget.redPicks],
            blueBans: [...unsavedTarget.blueBans],
            redBans: [...unsavedTarget.redBans],
            history: [...unsavedTarget.history],
            winHistory: [...unsavedTarget.winHistory],
            blueWinRate: unsavedTarget.blueWinRate,
          },
        });
        setPickLanes({ ...unsavedTarget.pickLanes });
        setPredictError(null);
        setGlobalBans((prev) => {
          const base = globalBansOverride ?? prev;
          const synced = syncSeriesGlobalBans(base, seriesGames, nextGameNumber, []);
          return {
            ...base,
            ...synced,
            blueSideTeam: unsavedTarget.blueSideTeam,
            gameNumber: nextGameNumber,
          };
        });
      } else if (targetGame) {
        loadRecordedGame(targetGame, seriesGames, effectiveGlobalBans);
      } else {
        dispatch({ type: "reset" });
        setPickLanes({});
        setPredictError(null);
        setGlobalBans((prev) => {
          const base = globalBansOverride ?? prev;
          const synced = syncSeriesGlobalBans(base, seriesGames, nextGameNumber, []);
          return {
            ...base,
            ...synced,
            blueSideTeam: base.blueSideTeam,
            gameNumber: nextGameNumber,
          };
        });
      }
    },
    [
      globalBans,
      seriesGames,
      stepIndex,
      bluePicks,
      redPicks,
      blueBans,
      redBans,
      state.history,
      state.winHistory,
      state.blueWinRate,
      pickLanes,
      loadRecordedGame,
    ],
  );

  const deleteRecordedGame = useCallback(
    (id: string) => {
      const deleted = seriesGames.find((g) => g.id === id);
      const nextSeriesGames = seriesGames.filter((g) => g.id !== id);
      setSeriesGames(nextSeriesGames);
      if (deleted) {
        const currentGroup = resolveSeriesName(globalBans);
        if (getGameSeriesGroup(deleted) !== currentGroup) return;

        const isDeletedActiveGame = deleted.gameNumber === globalBans.gameNumber;
        const synced = syncSeriesGlobalBans(globalBans, nextSeriesGames, globalBans.gameNumber, [deleted]);
        const candidate: GlobalBanState = {
          ...globalBans,
          ...synced,
        };
        const maxUnlocked = getMaxUnlockedGame(candidate, nextSeriesGames);
        const clampedGame = Math.min(globalBans.gameNumber, maxUnlocked);
        const finalSynced =
          clampedGame !== globalBans.gameNumber
            ? syncSeriesGlobalBans(candidate, nextSeriesGames, clampedGame)
            : synced;
        const finalState: GlobalBanState = {
          ...globalBans,
          ...finalSynced,
          gameNumber: clampedGame,
        };

        if (clampedGame !== globalBans.gameNumber) {
          const targetGame = nextSeriesGames.find(
            (g) => getGameSeriesGroup(g) === currentGroup && g.gameNumber === clampedGame,
          );
          if (targetGame) {
            loadRecordedGame(targetGame, nextSeriesGames, finalState);
          } else {
            const nextBlueSide: TeamId =
              deleted.gameNumber === clampedGame ? deleted.blueSideTeam : globalBans.blueSideTeam;
            dispatch({ type: "reset" });
            setPickLanes({});
            setPredictError(null);
            setGlobalBans({
              ...finalState,
              blueSideTeam: nextBlueSide,
            });
          }
          return;
        }

        if (isDeletedActiveGame) {
          dispatch({ type: "reset" });
          setPickLanes({});
          setPredictError(null);
          setGlobalBans({
            ...finalState,
            blueSideTeam: deleted.blueSideTeam,
          });
          return;
        }

        setGlobalBans(finalState);
      }
    },
    [seriesGames, globalBans, loadRecordedGame],
  );

  const deleteSeriesGroup = useCallback(
    (groupName: string) => {
      setSeriesGames((prev) => prev.filter((g) => getGameSeriesGroup(g) !== groupName));
      if (resolveSeriesName(globalBans) === groupName) {
        dispatch({ type: "reset" });
        setPickLanes({});
        setPredictError(null);
        setGlobalBans((prev) => ({
          ...prev,
          teamAUsed: [],
          teamBUsed: [],
          gameNumber: 1,
        }));
      }
    },
    [globalBans],
  );

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
      setPickLanes({});
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
        const overwrittenGames = seriesGames.filter(
          (g) => getGameSeriesGroup(g) === currentGroup && g.gameNumber === globalBans.gameNumber,
        );
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
          winner: overwrittenGames[0]?.winner,
        };
        nextSeriesGames = upsertSeriesGame(seriesGames, snapshot, currentGroup);
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
      const nextBlueSide: TeamId = latest.blueSideTeam;

      const baseBans: GlobalBanState = {
        seriesName: latest.seriesName || groupName,
        teamAName,
        teamBName,
        teamAUsed: [],
        teamBUsed: [],
        universalBans: [],
        blueSideTeam: nextBlueSide,
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
      setPickLanes({});
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
    isHydratingRemoteRef.current = true;
    unsavedDraftsRef.current = {};
    lastPredictedKeyRef.current = "";
    dispatch({ type: "reset" });
    setPickLanes({});
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
      seriesGames?: RecordedDraftGame[];
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
      if (draft.seriesGames) {
        setSeriesGames(draft.seriesGames);
      }
      if (draft.globalBans) {
        setGlobalBans(draft.globalBans);
      }
      setPickLanes({});
      setPredictError(null);
    },
    [],
  );

  return {
    heroes: catalog.heroes,
    heroMap,
    currentStepIndex: stepIndex,
    currentStep,
    totalSteps: 18,
    bluePicks,
    redPicks,
    blueBans,
    redBans,
    pickLanes: activePickLanes,
    setPickLane,
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
    setRecordedGameWinner,
    importDraft,
    unavailableHeroes,
    useLookahead,
    setUseLookahead,
    engine,
    league,
    setLeague,
    ...state.prediction,
    blueWinRate: state.blueWinRate,
    winHistory: state.winHistory,
    isLoading,
    isHeroesLoading: catalog.isLoading,
    error: predictError ?? catalog.error,
    syncError,
    retryPredict,
    setPausePredict,
    heroesFallback: catalog.isFallback,
    lockHero,
    undo,
    redo,
    reset,
    canUndo: state.history.length > 0,
    canRedo: (state.future?.length ?? 0) > 0,
  };
}

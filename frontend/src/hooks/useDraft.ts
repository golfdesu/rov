import type { Message } from "../i18n/language";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ApiError, deleteJson, getJson, isAbortError, postJson, putJson } from "../api/client";
import {
  CANONICAL_DRAFT_STEPS,
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
  type DraftSlot,
  type DraftState,
  draftReducer,
  draftSlotKey,
  EMPTY_GLOBAL_BANS,
  EMPTY_PREDICTION,
  getCurrentDraftStep,
  getDraftSlotStep,
  getGameSeriesGroup,
  getGameUnlockStatus,
  getMaxUnlockedGame,
  getSeriesWinningHeroes,
  INITIAL_DRAFT_STATE,
  isSameRecordedDraft,
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

type ParkedDraft = Pick<
  DraftMachineState,
  "stepIndex" | "bluePicks" | "redPicks" | "blueBans" | "redBans" | "history" | "blueWinRate"
> & {
  winHistory: DraftSessionPayload["winHistory"];
  blueSideTeam: TeamId;
  pickLanes: Record<string, LaneKey>;
};

// Parked drafts are kept with the local board snapshot, scoped to its guest or account storage key.
type LocalDraftSession = DraftSessionPayload & { parkedDrafts?: Record<string, ParkedDraft> };

function findGlobalBanConflicts(draft: DraftState, globalBans: GlobalBanState) {
  const conflicts: { hero: string; slot: DraftSlot }[] = [];
  const next = { bluePicks: 0, redPicks: 0, blueBans: 0, redBans: 0 };
  for (const step of CANONICAL_DRAFT_STEPS) {
    const key = draftSlotKey(step);
    const index = next[key]++;
    const hero = draft[key][index];
    if (hero && activeGlobalBansForStep(globalBans, step.step).includes(hero)) {
      conflicts.push({ hero, slot: { side: step.side, action: step.action, index } });
    }
  }
  return conflicts;
}

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

function filterPickLanes(pickLanes: Record<string, LaneKey>, bluePicks: string[], redPicks: string[]) {
  const picked = new Set([...bluePicks, ...redPicks]);
  return Object.fromEntries(Object.entries(pickLanes).filter(([hero]) => picked.has(hero)));
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
    ? parsed.seriesGames.map((g) => {
        const bluePicks = normalizeHeroList(g.bluePicks);
        const redPicks = normalizeHeroList(g.redPicks);
        return {
          ...g,
          bluePicks,
          redPicks,
          blueBans: normalizeHeroList(g.blueBans),
          redBans: normalizeHeroList(g.redBans),
          pickLanes: filterPickLanes(normalizePickLanes(g.pickLanes), bluePicks, redPicks),
        };
      })
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

function loadLocalSession(key = SESSION_STORAGE_KEY): LocalDraftSession | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalDraftSession>;
    if (!parsed || typeof parsed !== "object") return null;
    return { ...normalizeSessionPayload(parsed), parkedDrafts: parsed.parkedDrafts };
  } catch {
    return null;
  }
}

function saveLocalSession(payload: LocalDraftSession, key = SESSION_STORAGE_KEY): void {
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
  const [initialSession] = useState(() => loadLocalSession(storageKey));
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
  const [predictError, setPredictError] = useState<Message | null>(null);
  const [syncError, setSyncError] = useState<Message | null>(null);
  const [predictRetryKey, setPredictRetryKey] = useState(0);
  const [pausePredict, setPausePredict] = useState(false);
  const predictCacheRef = useRef<Map<string, DraftPredictionResponse>>(new Map());
  const activePredictRequestRef = useRef<AbortController | null>(null);
  const lastPredictedKeyRef = useRef<string | null>(null);
  const handledRetryKeyRef = useRef<number>(0);
  const unsavedDraftsRef = useRef(initialSession?.parkedDrafts ?? {});
  const redoPickLanesRef = useRef(new Map<string, LaneKey>());

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
  useEffect(() => {
    if (!state.future?.length) redoPickLanesRef.current.clear();
  }, [state.future]);

  const globalBanConflicts = useMemo(
    () => findGlobalBanConflicts({ bluePicks, redPicks, blueBans, redBans }, globalBans),
    [bluePicks, redPicks, blueBans, redBans, globalBans],
  );
  const conflictingHero = globalBanConflicts[0]?.hero;

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
          saveLocalSession({ ...remote, parkedDrafts: unsavedDraftsRef.current }, storageKey);
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

  const activePickLanes = useMemo(
    () => filterPickLanes(pickLanes, bluePicks, redPicks),
    [pickLanes, bluePicks, redPicks],
  );
  const draftToRecord = useMemo(
    () => ({ bluePicks, redPicks, blueBans, redBans, blueSideTeam: globalBans.blueSideTeam, pickLanes: activePickLanes }),
    [bluePicks, redPicks, blueBans, redBans, globalBans.blueSideTeam, activePickLanes],
  );

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
    const localSnapshot = { ...bodyWithoutTimestamp, parkedDrafts: unsavedDraftsRef.current };
    const fullSnapshotKey = JSON.stringify(localSnapshot);

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
          ...localSnapshot,
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
      !conflictingHero &&
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
              ["ซิงก์ข้อมูลขึ้นเซิร์ฟเวอร์ไม่สำเร็จ ({0}) — ข้อมูลถูกเก็บไว้ในเครื่องชั่วคราวแล้ว", err instanceof Error ? err.message : "Network error"],
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
    conflictingHero,
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
    if (conflictingHero) {
      setIsLoading(false);
      return;
    }
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
    activePredictRequestRef.current = ctrl;
    setIsLoading(true);
    setPredictError(null);

    const timer = window.setTimeout(async () => {
      try {
        const data = await postJson<DraftPredictionResponse>("/predict", predictPayload, ctrl.signal);
        if (ctrl.signal.aborted) return;
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
    conflictingHero,
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
      if (conflictingHero || unavailableHeroes.has(hero)) return;
      dispatch({ type: "lock", hero });
    },
    [conflictingHero, unavailableHeroes],
  );

  const getUnavailableHeroesForSlot = (slot: DraftSlot) =>
    unavailableSet(state, globalBans, getDraftSlotStep(slot)?.step);

  const replaceHero = (slot: DraftSlot, hero: string): boolean => {
    const oldHero = state[draftSlotKey(slot)][slot.index];
    if (!oldHero || !heroMap.has(hero) || getUnavailableHeroesForSlot(slot).has(hero)) return false;

    activePredictRequestRef.current?.abort();
    dispatch({ type: "replace", slot, hero, globalBans });
    if (slot.action === "pick") {
      setPickLanes((prev) => {
        if (!prev[oldHero]) return prev;
        const next = { ...prev };
        delete next[oldHero];
        return next;
      });
    }
    lastPredictedKeyRef.current = null;
    setPredictError(null);
    return true;
  };
  const undo = useCallback(() => {
    const prevEntry = state.history.at(-1);
    if (prevEntry) {
      const stillPicked = new Set([...prevEntry.bluePicks, ...prevEntry.redPicks]);
      for (const hero of [...bluePicks, ...redPicks]) {
        if (stillPicked.has(hero)) continue;
        const lane = pickLanes[hero];
        if (lane) redoPickLanesRef.current.set(hero, lane);
        else redoPickLanesRef.current.delete(hero);
      }

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
  }, [state.history, bluePicks, redPicks, pickLanes]);
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
      setPredictError(["ไม่สามารถ Redo {0} ได้ เนื่องจากถูกเพิ่มเข้า Global Ban แล้ว", displayName(blocked)]);
      return;
    }

    const restoredLanes = { ...pickLanes };
    for (const [addedPicks, teamPicks] of [[newlyBluePicks, next.bluePicks], [newlyRedPicks, next.redPicks]]) {
      for (const hero of addedPicks) {
        const lane = redoPickLanesRef.current.get(hero);
        redoPickLanesRef.current.delete(hero);
        if (lane && !teamPicks.some((teammate) => teammate !== hero && restoredLanes[teammate] === lane)) {
          restoredLanes[hero] = lane;
        }
      }
    }
    if (newlyBluePicks.length || newlyRedPicks.length) setPickLanes(restoredLanes);

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
    pickLanes,
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

  const parkCurrentDraft = useCallback(
    (blueSideTeam = globalBans.blueSideTeam) => {
      const draftKey = `${resolveSeriesName(globalBans)}::g${globalBans.gameNumber}`;
      const { stepIndex, bluePicks, redPicks, blueBans, redBans, history, winHistory, blueWinRate } = state;
      unsavedDraftsRef.current[draftKey] = {
        stepIndex,
        bluePicks,
        redPicks,
        blueBans,
        redBans,
        history,
        winHistory,
        blueWinRate,
        blueSideTeam,
        pickLanes,
      };
    },
    [globalBans, state, pickLanes],
  );

  const restoreParkedDraft = useCallback((draftKey: string) => {
    const draft = unsavedDraftsRef.current[draftKey];
    if (draft) {
      delete unsavedDraftsRef.current[draftKey];
      const { stepIndex, bluePicks, redPicks, blueBans, redBans, history, blueWinRate, winHistory } = draft;
      dispatch({
        type: "hydrate",
        payload: {
          stepIndex, bluePicks, redPicks, blueBans, redBans, history, blueWinRate,
          winHistory: sanitizeWinHistory(winHistory),
        },
      });
      setPickLanes(draft.pickLanes);
    } else {
      dispatch({ type: "reset" });
      setPickLanes({});
    }
    setPredictError(null);
  }, []);

  const createRecordedGame = useCallback(
    (seriesName: string, winner?: TeamId): RecordedDraftGame => ({
      ...draftToRecord,
      id: `${Date.now()}-g${globalBans.gameNumber}`,
      gameNumber: globalBans.gameNumber,
      timestamp: new Date().toLocaleTimeString("th-TH", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      seriesName,
      blueTeamName: blueTeamName(globalBans),
      redTeamName: redTeamName(globalBans),
      blueWinRate: state.blueWinRate,
      winner,
    }),
    [draftToRecord, globalBans, state.blueWinRate],
  );

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
          if (conflictingHero) {
            parkCurrentDraft();
          } else if (!isSameRecordedDraft(overwritten[0], draftToRecord)) {
            const snapshot = createRecordedGame(currentGroup, overwritten[0]?.winner);
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
      setPickLanes(game.pickLanes ?? {});
      setPredictError(null);
    },
    [seriesGames, bluePicks, redPicks, blueBans, redBans, globalBans, draftToRecord, conflictingHero, parkCurrentDraft, createRecordedGame],
  );

  const recordGameToSeries = useCallback(
    (swapAfter = false, winner?: TeamId) => {
      if (conflictingHero || bluePicks.length < 5 || redPicks.length < 5) return;

      const currentGroup = resolveSeriesName(globalBans);
      delete unsavedDraftsRef.current[`${currentGroup}::g${globalBans.gameNumber}`];
      const overwrittenGames = seriesGames.filter(
        (g) => getGameSeriesGroup(g) === currentGroup && g.gameNumber === globalBans.gameNumber,
      );
      const effectiveWinner = winner ?? overwrittenGames[0]?.winner;

      const snapshot = createRecordedGame(currentGroup, effectiveWinner);
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
      const nextDraftKey = `${currentGroup}::g${nextGame}`;
      const nextDraft = unsavedDraftsRef.current[nextDraftKey];
      const existingNextGame = nextSeriesGames.find(
        (g) => getGameSeriesGroup(g) === currentGroup && g.gameNumber === nextGame,
      );
      const synced = syncSeriesGlobalBans(globalBans, nextSeriesGames, nextGame, overwrittenGames);
      const nextGlobalBans = { ...globalBans, ...synced, gameNumber: nextGame };
      if (!nextDraft && existingNextGame) {
        loadRecordedGame(existingNextGame, nextSeriesGames, nextGlobalBans);
        return;
      }

      const nextBlueSide = swapAfter
        ? globalBans.blueSideTeam === "A" ? "B" : "A"
        : globalBans.blueSideTeam;
      setGlobalBans({
        ...nextGlobalBans,
        blueSideTeam: nextDraft?.blueSideTeam ?? nextBlueSide,
      });
      restoreParkedDraft(nextDraftKey);
    },
    [
      bluePicks,
      redPicks,
      globalBans,
      seriesGames,
      createRecordedGame,
      loadRecordedGame,
      conflictingHero,
      restoreParkedDraft,
    ],
  );

  const setRecordedGameWinner = useCallback((id: string, winner?: TeamId) => {
    setSeriesGames((prev) => prev.map((g) => (g.id === id ? { ...g, winner } : g)));
  }, []);

  const saveCurrentDraftSnapshot = useCallback(() => {
    const hasAnyAction = bluePicks.length + redPicks.length + blueBans.length + redBans.length > 0;
    if (!hasAnyAction || conflictingHero) return;
    const currentGroup = resolveSeriesName(globalBans);
    delete unsavedDraftsRef.current[`${currentGroup}::g${globalBans.gameNumber}`];
    setSeriesGames((prev) => {
      const overwrittenGames = prev.filter(
        (g) => getGameSeriesGroup(g) === currentGroup && g.gameNumber === globalBans.gameNumber,
      );
      if (isSameRecordedDraft(overwrittenGames[0], draftToRecord)) {
        return prev;
      }
      const snapshot = createRecordedGame(currentGroup, overwrittenGames[0]?.winner);
      return upsertSeriesGame(prev, snapshot, currentGroup);
    });
  }, [bluePicks, redPicks, blueBans, redBans, globalBans, draftToRecord, conflictingHero, createRecordedGame]);

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
        !isSameRecordedDraft(existingCurrentGame, { ...draftToRecord, blueSideTeam: effectiveGlobalBans.blueSideTeam })
      ) {
        parkCurrentDraft(effectiveGlobalBans.blueSideTeam);
      } else if (!hasCurrentActions) {
        delete unsavedDraftsRef.current[currentDraftKey];
      }

      const targetDraftKey = `${currentGroup}::g${nextGameNumber}`;
      const unsavedTarget = unsavedDraftsRef.current[targetDraftKey];
      const targetGame = seriesGames.find(
        (g) => getGameSeriesGroup(g) === currentGroup && g.gameNumber === nextGameNumber,
      );

      if (!unsavedTarget && targetGame) {
        loadRecordedGame(targetGame, seriesGames, effectiveGlobalBans);
        return;
      }

      restoreParkedDraft(targetDraftKey);
      const synced = syncSeriesGlobalBans(effectiveGlobalBans, seriesGames, nextGameNumber);
      setGlobalBans({
        ...effectiveGlobalBans,
        ...synced,
        blueSideTeam: unsavedTarget?.blueSideTeam ?? effectiveGlobalBans.blueSideTeam,
        gameNumber: nextGameNumber,
      });
    },
    [
      globalBans,
      seriesGames,
      bluePicks,
      redPicks,
      blueBans,
      redBans,
      draftToRecord,
      loadRecordedGame,
      parkCurrentDraft,
      restoreParkedDraft,
    ],
  );

  const deleteRecordedGame = useCallback(
    (id: string) => {
      const deleted = seriesGames.find((g) => g.id === id);
      const nextSeriesGames = seriesGames.filter((g) => g.id !== id);
      setSeriesGames(nextSeriesGames);
      if (deleted) {
        const deletedGroup = getGameSeriesGroup(deleted);
        delete unsavedDraftsRef.current[`${deletedGroup}::g${deleted.gameNumber}`];
        const currentGroup = resolveSeriesName(globalBans);
        if (deletedGroup !== currentGroup) return;

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
          if (!isDeletedActiveGame && bluePicks.length + redPicks.length + blueBans.length + redBans.length > 0) {
            parkCurrentDraft();
          }
          const targetDraftKey = `${currentGroup}::g${clampedGame}`;
          const parked = unsavedDraftsRef.current[targetDraftKey];
          const targetGame = nextSeriesGames.find(
            (g) => getGameSeriesGroup(g) === currentGroup && g.gameNumber === clampedGame,
          );
          if (targetGame && !parked) {
            loadRecordedGame(targetGame, nextSeriesGames, finalState);
          } else {
            const nextBlueSide: TeamId =
              deleted.gameNumber === clampedGame ? deleted.blueSideTeam : globalBans.blueSideTeam;
            restoreParkedDraft(targetDraftKey);
            setGlobalBans({
              ...finalState,
              blueSideTeam: parked?.blueSideTeam ?? nextBlueSide,
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
    [seriesGames, globalBans, bluePicks, redPicks, blueBans, redBans, parkCurrentDraft, loadRecordedGame, restoreParkedDraft],
  );

  const deleteSeriesGroup = useCallback(
    (groupName: string) => {
      for (let gameNumber = 1; gameNumber <= 7; gameNumber++) {
        delete unsavedDraftsRef.current[`${groupName}::g${gameNumber}`];
      }
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
      if (conflictingHero) {
        parkCurrentDraft();
      } else if (hasAnyAction) {
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
    [bluePicks, redPicks, blueBans, redBans, conflictingHero, parkCurrentDraft, saveCurrentDraftSnapshot],
  );

  const switchSeries = useCallback(
    (groupName: string) => {
      const currentGroup = resolveSeriesName(globalBans);
      const hasCurrentActions =
        bluePicks.length + redPicks.length + blueBans.length + redBans.length > 0;

      let nextSeriesGames = seriesGames;
      if (conflictingHero) {
        parkCurrentDraft();
      } else if (hasCurrentActions) {
        const overwrittenGames = seriesGames.filter(
          (g) => getGameSeriesGroup(g) === currentGroup && g.gameNumber === globalBans.gameNumber,
        );
        const snapshot = createRecordedGame(currentGroup, overwrittenGames[0]?.winner);
        nextSeriesGames = upsertSeriesGame(seriesGames, snapshot, currentGroup);
        delete unsavedDraftsRef.current[`${currentGroup}::g${globalBans.gameNumber}`];
        setSeriesGames(nextSeriesGames);
      }

      const groupGames = nextSeriesGames.filter((g) => getGameSeriesGroup(g) === groupName);
      if (groupGames.length === 0) return;

      const sorted = [...groupGames].sort((a, b) => a.gameNumber - b.gameNumber);
      const latest = sorted[sorted.length - 1];

      const latestIncomplete = latest.bluePicks.length < 5 || latest.redPicks.length < 5;
      const latestParked = unsavedDraftsRef.current[`${groupName}::g${latest.gameNumber}`];
      if (latestIncomplete && !latestParked) {
        loadRecordedGame(latest, nextSeriesGames);
        return;
      }

      const teamAName = latest.blueSideTeam === "A" ? latest.blueTeamName : latest.redTeamName;
      const teamBName = latest.blueSideTeam === "A" ? latest.redTeamName : latest.blueTeamName;
      const targetGameNumber = latestIncomplete ? latest.gameNumber : Math.min(latest.gameNumber + 1, 7);
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
      const targetDraftKey = `${groupName}::g${finalGameNumber}`;
      const parked = unsavedDraftsRef.current[targetDraftKey];
      const recordedTarget = groupGames.find((g) => g.gameNumber === finalGameNumber);
      if (!parked && recordedTarget) {
        loadRecordedGame(recordedTarget, nextSeriesGames, baseBans);
        return;
      }

      const finalSynced =
        finalGameNumber !== targetGameNumber
          ? syncSeriesGlobalBans(baseBans, nextSeriesGames, finalGameNumber, [], groupName)
          : synced;

      restoreParkedDraft(targetDraftKey);
      setGlobalBans({
        ...baseBans,
        ...finalSynced,
        gameNumber: finalGameNumber,
        blueSideTeam: parked?.blueSideTeam ?? nextBlueSide,
      });
    },
    [
      seriesGames,
      globalBans,
      bluePicks,
      redPicks,
      blueBans,
      redBans,
      createRecordedGame,
      conflictingHero,
      loadRecordedGame,
      parkCurrentDraft,
      restoreParkedDraft,
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

  const conflictError: Message | null = conflictingHero
    ? ["{0} ติด Global Ban แล้ว กดย้อนกลับไปก่อนเลือกหรือแบนฮีโร่ตัวนี้ แล้วดราฟต์ต่อ", displayName(conflictingHero)]
    : null;

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
    globalBanConflicts,
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
    error: conflictError ?? predictError ?? catalog.error,
    syncError,
    retryPredict,
    setPausePredict,
    heroesFallback: catalog.isFallback,
    lockHero,
    replaceHero,
    getUnavailableHeroesForSlot,
    undo,
    redo,
    reset,
    canUndo: state.history.length > 0,
    canRedo: (state.future?.length ?? 0) > 0,
  };
}

import { ArrowRight, Bot, History, PlusCircle, RotateCcw, Shuffle, Sparkles, Trophy, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteJson, getJson, isAbortError, putJson } from "../api/client";
import { useDraft } from "../hooks/useDraft";
import { type Message, translateMessage, useLanguage } from "../i18n/language";
import { CANONICAL_DRAFT_STEPS, type DraftStep } from "../types/draft";
import {
  blueUsedHeroes,
  heroesByStep,
  heroOriginGameMap,
  LANE_SHORT,
  laneKey,
  reconstructDraftHistory,
  redUsedHeroes,
  resolveSeriesName,
} from "../utils/draft";
import { displayName } from "../utils/heroNames";
import { type TelemetryMetricKey, trackTelemetryEvent } from "../utils/telemetry";
import {
  appendPracticeHistoryEntry,
  buildPracticeSignature,
  clearPracticeActiveRound,
  createPracticeSessionId,
  DEFAULT_PRACTICE_GLOBAL_BANS,
  filterEntriesAfterClear,
  loadPracticeHistoryState,
  loadPracticeMeta,
  mergePracticeHistoryEntries,
  PRACTICE_GAME_COUNTS,
  type PracticeGameCount,
  type PracticeHistoryEntry,
  type PracticeHistorySyncPayload,
  type PracticeRoundMeta,
  practiceDraftStorageKey,
  practiceHistoryStorageKey,
  sanitizePracticeHistoryEntries,
  savePracticeHistoryState,
  savePracticeMeta,
} from "../utils/practiceHistory";
import { AiPanel } from "./AiPanel";
import { Alert } from "./Alert";
import { HeroGrid } from "./HeroGrid";
import { HeroPortrait } from "./HeroPortrait";
import { LaneIcon } from "./LaneIcon";
import { PracticeHistoryModal } from "./PracticeHistoryModal";
import { StableButtonLabel } from "./StableButtonLabel";
import { TeamColumn } from "./TeamColumn";

type Side = DraftStep["side"];
const AI_MIN_THINK_MS = 1000;
const HISTORY_REFRESH_COOLDOWN_MS = 15_000;
const SIDES = [
  { value: "blue", label: "ฝั่งน้ำเงิน", color: "text-blue" },
  { value: "red", label: "ฝั่งแดง", color: "text-red" },
] as const;

const BUTTON_CLASS =
  "inline-flex min-h-7 items-center justify-center gap-1.5 border px-2 font-display text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-gold sm:px-2.5";
const HEADER_ACTION_CLASS =
  "inline-flex min-h-7 min-w-7 items-center justify-center gap-1 border px-1.5 font-display text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-gold sm:gap-1.5 sm:px-2.5";

interface PracticeDraftViewProps {
  scope: string;
  persistSession?: boolean;
}

export function PracticeDraftView({ scope, persistSession = false }: PracticeDraftViewProps) {
  const [meta, setMeta] = useState<PracticeRoundMeta>(() => loadPracticeMeta(scope));
  const [historyState, setHistoryState] = useState<PracticeHistorySyncPayload>(() => loadPracticeHistoryState(scope));
  const [roundId, setRoundId] = useState(0);

  const historyRef = useRef(historyState);
  const lastSavedAtRef = useRef(historyState.updatedAt);
  const hasDirtyLocalRef = useRef(Boolean(historyState.deletedIds?.length));
  const lastRemoteFetchAtRef = useRef(0);
  const pushSeqRef = useRef(0);

  useEffect(() => {
    historyRef.current = historyState;
  }, [historyState]);

  const pushToServer = useCallback(
    async (payload: PracticeHistorySyncPayload) => {
      if (!persistSession) return;
      const seq = ++pushSeqRef.current;
      try {
        const res = await putJson<PracticeHistorySyncPayload>("/draft/practice-history", payload);
        if (seq !== pushSeqRef.current) return;
        const serverUpdatedAt = typeof res?.updatedAt === "number" ? res.updatedAt : payload.updatedAt;
        const serverClearedAt = Math.max(
          typeof res?.clearedAt === "number" ? res.clearedAt : 0,
          payload.clearedAt ?? 0,
          historyRef.current.clearedAt ?? 0,
        );
        const serverEntries = sanitizePracticeHistoryEntries(res?.entries);
        const nextState: PracticeHistorySyncPayload = {
          entries: filterEntriesAfterClear(res?.entries ? serverEntries : payload.entries, serverClearedAt),
          updatedAt: Math.max(serverUpdatedAt, lastSavedAtRef.current),
          ...(serverClearedAt > 0 ? { clearedAt: serverClearedAt } : {}),
        };
        lastSavedAtRef.current = nextState.updatedAt;
        historyRef.current = nextState;
        savePracticeHistoryState(scope, nextState);
        setHistoryState(nextState);
        hasDirtyLocalRef.current = false;
      } catch (err) {
        if (!isAbortError(err)) {
          console.warn("Could not sync practice history to server:", err);
        }
      }
    },
    [persistSession, scope],
  );

  useEffect(() => {
    const expectedKey = practiceHistoryStorageKey(scope);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== expectedKey) return;
      const reloaded = loadPracticeHistoryState(scope);
      lastSavedAtRef.current = reloaded.updatedAt;
      historyRef.current = reloaded;
      setHistoryState(reloaded);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [scope]);

  useEffect(() => {
    if (!persistSession) return;
    const ctrl = new AbortController();

    async function syncFromServer(signal?: AbortSignal, force = false) {
      const now = Date.now();
      if (!force && now - lastRemoteFetchAtRef.current < HISTORY_REFRESH_COOLDOWN_MS) return;
      lastRemoteFetchAtRef.current = now;
      try {
        const remote = await getJson<PracticeHistorySyncPayload>("/draft/practice-history", signal);
        const remoteUpdatedAt = typeof remote?.updatedAt === "number" ? remote.updatedAt : 0;
        const remoteClearedAt = typeof remote?.clearedAt === "number" ? remote.clearedAt : 0;
        const effectiveClearedAt = Math.max(remoteClearedAt, historyRef.current.clearedAt ?? 0);
        const remoteEntries = filterEntriesAfterClear(sanitizePracticeHistoryEntries(remote?.entries), effectiveClearedAt);
        const remoteDeletedIds = Array.isArray(remote?.deletedIds) ? remote.deletedIds : [];
        const pendingDeleted = historyRef.current.deletedIds ?? [];
        const localAfterClear = filterEntriesAfterClear(historyRef.current.entries, effectiveClearedAt);
        if (remoteUpdatedAt > lastSavedAtRef.current && !hasDirtyLocalRef.current) {
          const mergedEntries =
            remoteEntries.length === 0 && localAfterClear.length > 0 && remoteUpdatedAt > 0
              ? []
              : mergePracticeHistoryEntries(remoteEntries, localAfterClear, remoteDeletedIds);
          lastSavedAtRef.current = remoteUpdatedAt;
          const nextState: PracticeHistorySyncPayload = {
            entries: mergedEntries,
            updatedAt: remoteUpdatedAt,
            ...(effectiveClearedAt > 0 ? { clearedAt: effectiveClearedAt } : {}),
          };
          historyRef.current = nextState;
          savePracticeHistoryState(scope, nextState);
          setHistoryState(nextState);
        } else if (
          lastSavedAtRef.current > remoteUpdatedAt &&
          (localAfterClear.length > 0 || pendingDeleted.length > 0 || hasDirtyLocalRef.current)
        ) {
          await pushToServer({
            entries: localAfterClear,
            updatedAt: lastSavedAtRef.current,
            ...(pendingDeleted.length > 0 ? { deletedIds: pendingDeleted } : {}),
            ...(effectiveClearedAt > 0 ? { clearedAt: effectiveClearedAt } : {}),
          });
        } else if (pendingDeleted.length > 0 || hasDirtyLocalRef.current) {
          const combinedDeleted = Array.from(new Set([...pendingDeleted, ...remoteDeletedIds])).slice(0, 100);
          const mergedEntries = mergePracticeHistoryEntries(
            localAfterClear,
            remoteEntries,
            combinedDeleted,
          );
          await pushToServer({
            entries: mergedEntries,
            updatedAt: Math.max(lastSavedAtRef.current, remoteUpdatedAt + 1),
            ...(pendingDeleted.length > 0 ? { deletedIds: pendingDeleted } : {}),
            ...(effectiveClearedAt > 0 ? { clearedAt: effectiveClearedAt } : {}),
          });
        }
      } catch (err) {
        if (!isAbortError(err)) {
          console.warn("Could not fetch practice history from server:", err);
        }
      }
    }

    void syncFromServer(ctrl.signal, true);

    const onFocusOrVisible = () => {
      if (document.visibilityState === "visible") {
        void syncFromServer(undefined, false);
      }
    };
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);
    return () => {
      ctrl.abort();
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
    };
  }, [persistSession, pushToServer, scope]);

  const commitHistoryEntries = useCallback(
    (nextEntries: PracticeHistoryEntry[], deletedIds?: string[]) => {
      const nextUpdatedAt = Math.max(Date.now(), lastSavedAtRef.current + 1);
      lastSavedAtRef.current = nextUpdatedAt;
      hasDirtyLocalRef.current = true;
      const mergedDeletedIds = Array.from(
        new Set([...(historyRef.current.deletedIds ?? []), ...(deletedIds ?? [])]),
      ).slice(0, 100);
      const currentClearedAt = historyRef.current.clearedAt ?? 0;
      const nextState: PracticeHistorySyncPayload = {
        entries: nextEntries,
        updatedAt: nextUpdatedAt,
        ...(mergedDeletedIds.length > 0 ? { deletedIds: mergedDeletedIds } : {}),
        ...(currentClearedAt > 0 ? { clearedAt: currentClearedAt } : {}),
      };
      historyRef.current = nextState;
      savePracticeHistoryState(scope, nextState);
      setHistoryState({
        entries: nextEntries,
        updatedAt: nextUpdatedAt,
        ...(currentClearedAt > 0 ? { clearedAt: currentClearedAt } : {}),
      });
      if (persistSession) {
        void pushToServer(nextState);
      }
    },
    [persistSession, pushToServer, scope],
  );

  const handleRecordHistoryEntry = useCallback(
    (entryInput: Omit<PracticeHistoryEntry, "id" | "recordedAt">) => {
      const next = appendPracticeHistoryEntry(historyRef.current.entries, entryInput);
      if (next === historyRef.current.entries) return;
      commitHistoryEntries(next);
    },
    [commitHistoryEntries],
  );

  const handleDeleteHistoryEntry = useCallback(
    (id: string) => {
      const next = historyRef.current.entries.filter((item) => item.id !== id);
      commitHistoryEntries(next, [id]);
    },
    [commitHistoryEntries],
  );

  const handleClearHistory = useCallback(() => {
    const nextUpdatedAt = Math.max(Date.now(), lastSavedAtRef.current + 1);
    lastSavedAtRef.current = nextUpdatedAt;
    hasDirtyLocalRef.current = true;
    const cleared: PracticeHistorySyncPayload = {
      entries: [],
      updatedAt: nextUpdatedAt,
      clearedAt: nextUpdatedAt,
    };
    historyRef.current = cleared;
    savePracticeHistoryState(scope, cleared);
    setHistoryState(cleared);
    if (persistSession) {
      void (async () => {
        try {
          const res = await deleteJson<PracticeHistorySyncPayload>("/draft/practice-history");
          if (typeof res?.updatedAt === "number" && res.updatedAt >= lastSavedAtRef.current) {
            const clearedAt = typeof res?.clearedAt === "number" && res.clearedAt > 0 ? res.clearedAt : res.updatedAt;
            lastSavedAtRef.current = res.updatedAt;
            const synced: PracticeHistorySyncPayload = { entries: [], updatedAt: res.updatedAt, clearedAt };
            historyRef.current = synced;
            savePracticeHistoryState(scope, synced);
            setHistoryState(synced);
          }
          hasDirtyLocalRef.current = false;
        } catch (err) {
          if (!isAbortError(err)) {
            console.warn("Could not clear remote practice history:", err);
          }
        }
      })();
    }
  }, [persistSession, scope]);

  function updateMeta(updater: (prev: PracticeRoundMeta) => PracticeRoundMeta) {
    setMeta((prev) => {
      const next = updater(prev);
      savePracticeMeta(scope, next);
      return next;
    });
  }

  function startNewRound(nextSide: Side) {
    const fresh = clearPracticeActiveRound(scope, nextSide, meta.gameCount, meta.showHints);
    setMeta(fresh);
    setRoundId((id) => id + 1);
  }

  return (
    <PracticeRound
      key={roundId}
      scope={scope}
      meta={meta}
      historyEntries={historyState.entries}
      onUpdateMeta={updateMeta}
      onRecordHistoryEntry={handleRecordHistoryEntry}
      onDeleteHistoryEntry={handleDeleteHistoryEntry}
      onClearHistory={handleClearHistory}
      onSwitchSide={startNewRound}
      onRestart={() => startNewRound(meta.startingSide)}
    />
  );
}

interface PracticeRoundProps {
  scope: string;
  meta: PracticeRoundMeta;
  historyEntries: PracticeHistoryEntry[];
  onUpdateMeta: (updater: (prev: PracticeRoundMeta) => PracticeRoundMeta) => void;
  onRecordHistoryEntry: (entryInput: Omit<PracticeHistoryEntry, "id" | "recordedAt">) => void;
  onDeleteHistoryEntry: (id: string) => void;
  onClearHistory: () => void;
  onSwitchSide: (nextSide: Side) => void;
  onRestart: () => void;
}

function PracticeRound({
  scope,
  meta,
  historyEntries,
  onUpdateMeta,
  onRecordHistoryEntry,
  onDeleteHistoryEntry,
  onClearHistory,
  onSwitchSide,
  onRestart,
}: PracticeRoundProps) {
  const { t } = useLanguage();
  const { startingSide, gameCount, showHints, previousEstimates } = meta;
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const aiTurnStartedAt = useRef(0);
  const handledSignaturesRef = useRef<Set<string>>(new Set(historyEntries.map((item) => item.signature)));
  const playerTeam = startingSide === "blue" ? "A" : "B";
  const aiTeam = playerTeam === "A" ? "B" : "A";
  const draft = useDraft({
    persistSession: false,
    storageKey: practiceDraftStorageKey(scope),
    predictionTeam: showHints ? undefined : aiTeam,
  });
  const { currentStep, currentStepIndex, hasPrediction, isLoading, lockHero, recommendations, unavailableHeroes } = draft;
  const gameNumber = draft.globalBans.gameNumber;
  const playerSide = draft.globalBans.blueSideTeam === playerTeam ? "blue" : "red";
  const playerTurn = currentStep?.side === playerSide;
  const aiTurn = currentStep !== null && !playerTurn;
  const finalBlueEstimate = draft.winHistory[draft.totalSteps];
  const playerEstimate = Number.isFinite(finalBlueEstimate)
    ? playerSide === "blue"
      ? finalBlueEstimate
      : 100 - finalBlueEstimate
    : null;
  const evaluationFailed = !isLoading && Boolean(draft.error);
  const aiCandidates = useMemo(
    () => recommendations.filter(({ hero_name }) => draft.heroMap.has(hero_name) && !unavailableHeroes.has(hero_name)).slice(0, 3),
    [draft.heroMap, recommendations, unavailableHeroes],
  );
  const hintedRanks = useMemo(
    () => new Map(showHints ? recommendations.slice(0, 10).map((hero) => [hero.hero_name, hero.rank]) : []),
    [recommendations, showHints],
  );

  useEffect(() => {
    if (aiTurn) aiTurnStartedAt.current = performance.now();
  }, [aiTurn, currentStepIndex, gameNumber]);

  useEffect(() => {
    if (!aiTurn || isLoading || !draft.heroMap.size || aiCandidates.length === 0) return;
    const remainingThinkTime = Math.max(0, Math.ceil(AI_MIN_THINK_MS - (performance.now() - aiTurnStartedAt.current)));
    const timer = window.setTimeout(() => {
      const roll = Math.random();
      const candidateIndex = roll < 0.65 ? 0 : roll < 0.9 ? 1 : 2;
      const choice = aiCandidates[Math.min(candidateIndex, aiCandidates.length - 1)];
      lockHero(choice.hero_name, currentStepIndex);
    }, remainingThinkTime);
    return () => window.clearTimeout(timer);
  }, [aiCandidates, aiTurn, currentStepIndex, draft.heroMap.size, gameNumber, isLoading, lockHero]);

  // Record synced remote signatures so hydrated history entries are never re-recorded as duplicates
  useEffect(() => {
    for (const item of historyEntries) {
      handledSignaturesRef.current.add(item.signature);
    }
  }, [historyEntries]);

  // Auto-save completed 18-step AI draft once model win evaluation is ready
  useEffect(() => {
    if (
      currentStep !== null ||
      isLoading ||
      playerEstimate === null ||
      draft.bluePicks.length !== 5 ||
      draft.redPicks.length !== 5
    ) {
      return;
    }
    const signature = buildPracticeSignature(meta.sessionId, gameNumber, playerSide, {
      bluePicks: draft.bluePicks,
      redPicks: draft.redPicks,
      blueBans: draft.blueBans,
      redBans: draft.redBans,
    });
    if (meta.recordedSignatures.includes(signature) || handledSignaturesRef.current.has(signature)) return;
    handledSignaturesRef.current.add(signature);
    trackTelemetryEvent("practice_completed_18");
    trackTelemetryEvent(`mode_bo${gameCount}` as TelemetryMetricKey);
    onUpdateMeta((prev) =>
      prev.recordedSignatures.includes(signature)
        ? prev
        : { ...prev, recordedSignatures: [...prev.recordedSignatures.slice(-19), signature] },
    );

    onRecordHistoryEntry({
      signature,
      gameNumber,
      gameCount,
      startingSide,
      playerSide,
      bluePicks: [...draft.bluePicks],
      redPicks: [...draft.redPicks],
      blueBans: [...draft.blueBans],
      redBans: [...draft.redBans],
      playerEstimate,
      previousEstimates: { ...previousEstimates },
      globalBans: {
        ...draft.globalBans,
        teamAUsed: [...draft.globalBans.teamAUsed],
        teamBUsed: [...draft.globalBans.teamBUsed],
        universalBans: [...draft.globalBans.universalBans],
      },
      seriesGames: [...draft.seriesGames],
    });
  }, [
    currentStep,
    draft.blueBans,
    draft.bluePicks,
    draft.globalBans,
    draft.redBans,
    draft.redPicks,
    draft.seriesGames,
    gameCount,
    gameNumber,
    isLoading,
    meta.recordedSignatures,
    meta.sessionId,
    onRecordHistoryEntry,
    onUpdateMeta,
    playerEstimate,
    playerSide,
    previousEstimates,
    startingSide,
  ]);

  const aiError: Message | null =
    aiTurn && !isLoading && aiCandidates.length === 0
      ? draft.error ?? (hasPrediction && !draft.isHeroesLoading ? "AI ยังหาฮีโร่ที่เลือกได้ไม่เจอ" : null)
      : null;
  const turnText = !currentStep
    ? t("ดราฟต์จบแล้ว")
    : playerTurn
      ? t(currentStep.action === "ban" ? "เทิร์นคุณ · แบนฮีโร่" : "เทิร์นคุณ · เลือกฮีโร่")
      : t(currentStep.action === "ban" ? "AI กำลังแบน" : "AI กำลังเลือกฮีโร่");

  const blueTeamName = t(playerSide === "blue" ? "คุณ" : "AI");
  const redTeamName = t(playerSide === "red" ? "คุณ" : "AI");
  const bUsed = useMemo(() => blueUsedHeroes(draft.globalBans), [draft.globalBans]);
  const rUsed = useMemo(() => redUsedHeroes(draft.globalBans), [draft.globalBans]);
  const originMap = useMemo(
    () => heroOriginGameMap(draft.seriesGames, resolveSeriesName(draft.globalBans)),
    [draft.seriesGames, draft.globalBans],
  );
  const blueOriginGames = draft.globalBans.blueSideTeam === "A" ? originMap.teamAGameByHero : originMap.teamBGameByHero;
  const redOriginGames = draft.globalBans.blueSideTeam === "A" ? originMap.teamBGameByHero : originMap.teamAGameByHero;

  const lastPlayerStep = useMemo(
    () => CANONICAL_DRAFT_STEPS.slice(0, currentStepIndex).findLast((step) => step.side === playerSide),
    [currentStepIndex, playerSide],
  );
  const hasAnyAction = draft.bluePicks.length + draft.redPicks.length + draft.blueBans.length + draft.redBans.length > 0;
  const canUndoPlayerTurn = Boolean(lastPlayerStep);

  function handlePlayerLock(hero: string): boolean {
    if (!playerTurn || unavailableHeroes.has(hero)) return false;
    lockHero(hero, currentStepIndex);
    return true;
  }

  function handleUndoPlayerTurn() {
    if (!lastPlayerStep) return;
    const { history } = reconstructDraftHistory(draft);
    const snapshot = history[lastPlayerStep.step];
    if (!snapshot) return;
    draft.importDraft(snapshot);
  }

  function handleNextGame(nextSide: Side) {
    if (currentStep || gameNumber >= gameCount || (playerEstimate === null && !evaluationFailed)) return;
    onUpdateMeta((prev) => ({
      ...prev,
      previousEstimates: { ...prev.previousEstimates, [gameNumber]: playerEstimate },
    }));
    draft.recordGameToSeries(nextSide !== playerSide);
  }

  function handleLoadHistoryEntry(entry: PracticeHistoryEntry) {
    const entrySessionId = entry.signature.split("|")[0] || createPracticeSessionId();
    handledSignaturesRef.current.add(entry.signature);
    onUpdateMeta((prev) => ({
      ...prev,
      sessionId: entrySessionId,
      startingSide: entry.startingSide,
      gameCount: entry.gameCount,
      previousEstimates: entry.previousEstimates ?? {},
      recordedSignatures: prev.recordedSignatures.includes(entry.signature)
        ? prev.recordedSignatures
        : [...prev.recordedSignatures.slice(-19), entry.signature],
    }));
    draft.importDraft({
      bluePicks: entry.bluePicks,
      redPicks: entry.redPicks,
      blueBans: entry.blueBans,
      redBans: entry.redBans,
      globalBans: entry.globalBans ?? {
        ...DEFAULT_PRACTICE_GLOBAL_BANS,
        blueSideTeam: entry.playerSide === entry.startingSide ? "A" : "B",
        gameNumber: entry.gameNumber,
      },
      seriesGames: entry.seriesGames ?? [],
    });
  }

  const teamShared = {
    pickLanes: draft.pickLanes,
    gameNumber,
    heroMap: draft.heroMap,
    currentStep,
    predictedNextPicks: showHints ? draft.blueNextPicks : [],
    predictedNextBans: showHints ? draft.blueNextBans : [],
    onLockHero: playerTurn ? handlePlayerLock : undefined,
  };
  const blueTeam = {
    ...teamShared,
    side: "blue" as const,
    teamName: blueTeamName,
    picks: draft.bluePicks,
    bans: draft.blueBans,
    usedHeroes: bUsed,
    usedHeroOriginGames: blueOriginGames,
    rawUsedCount:
      draft.globalBans.blueSideTeam === "A" ? draft.globalBans.teamAUsed.length : draft.globalBans.teamBUsed.length,
  };
  const redTeam = {
    ...teamShared,
    side: "red" as const,
    teamName: redTeamName,
    picks: draft.redPicks,
    bans: draft.redBans,
    usedHeroes: rUsed,
    usedHeroOriginGames: redOriginGames,
    rawUsedCount:
      draft.globalBans.blueSideTeam === "A" ? draft.globalBans.teamBUsed.length : draft.globalBans.teamAUsed.length,
    predictedNextPicks: showHints ? draft.redNextPicks : [],
    predictedNextBans: showHints ? draft.redNextBans : [],
  };

  const showWinBar = showHints || !currentStep;
  const safeBlue = Number.isFinite(draft.blueWinRate) ? draft.blueWinRate : 50.0;
  const bluePct = Math.min(Math.max(safeBlue, 0), 100);
  const redPct = 100 - bluePct;
  const progressPct = Math.min(100, Math.round((currentStepIndex / draft.totalSteps) * 100));

  const renderCenterBar = (compact: boolean) => (
    <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2.5">
      <div className="shrink-0 text-right leading-none">
        <span className="mr-1.5 hidden font-display text-[10px] font-semibold tracking-widest text-blue sm:inline">
          {blueTeamName}
        </span>
        {showWinBar ? (
          <span
            className={`font-mono font-bold tabular-nums ${
              compact ? "text-xs sm:text-base" : "text-sm sm:text-lg lg:text-xl"
            } ${bluePct >= 50 ? "text-blue" : "text-muted"}`}
          >
            {bluePct.toFixed(1)}
            <span className="text-[10px] text-dim">%</span>
          </span>
        ) : (
          <span className="font-mono text-xs font-bold text-blue">BLUE</span>
        )}
      </div>

      {showWinBar ? (
        <div
          className={`relative w-full overflow-hidden bg-panel-2 ${
            compact ? "h-2" : "h-2.5 min-w-[40px] flex-1 sm:h-3 sm:min-w-[56px]"
          }`}
        >
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-deep to-blue transition-[width] duration-700 ease-out"
            style={{ width: `${bluePct}%` }}
          />
          <div
            className="absolute inset-y-0 right-0 bg-gradient-to-l from-red-deep to-red transition-[width] duration-700 ease-out"
            style={{ width: `${redPct}%` }}
          />
          {isLoading && <div className="absolute inset-0 animate-pulse bg-ink/10" />}
        </div>
      ) : (
        <div
          role="progressbar"
          aria-label={t("ความคืบหน้าดราฟต์")}
          aria-valuenow={currentStepIndex}
          aria-valuemin={0}
          aria-valuemax={draft.totalSteps}
          title={t("เปิดตัวช่วยเพื่อดูโอกาสชนะระหว่างดราฟต์")}
          className={`relative w-full overflow-hidden bg-panel-2 ${compact ? "h-2" : "h-2.5 flex-1 sm:h-3"}`}
        >
          <div
            className={`h-full transition-[width] duration-300 ease-out ${
              playerTurn ? "bg-gold/80" : "bg-muted/60"
            }`}
            style={{ width: `${progressPct}%` }}
          />
          {aiTurn && <div className="absolute inset-0 animate-pulse bg-ink/10" />}
        </div>
      )}

      <div className="shrink-0 leading-none">
        {showWinBar ? (
          <span
            className={`font-mono font-bold tabular-nums ${
              compact ? "text-xs sm:text-base" : "text-sm sm:text-lg lg:text-xl"
            } ${redPct >= 50 ? "text-red" : "text-muted"}`}
          >
            {redPct.toFixed(1)}
            <span className="text-[10px] text-dim">%</span>
          </span>
        ) : (
          <span className="font-mono text-xs font-bold text-red">RED</span>
        )}
        <span className="ml-1.5 hidden font-display text-[10px] font-semibold tracking-widest text-red sm:inline">
          {redTeamName}
        </span>
      </div>
    </div>
  );

  const stepTone = !currentStep
    ? "text-gold"
    : playerTurn
      ? playerSide === "blue"
        ? "text-blue"
        : "text-red"
      : playerSide === "blue"
        ? "text-red"
        : "text-blue";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Sub-Header Controls Bar (Single compact row on mobile, full bar on >= sm) */}
      <div className="shrink-0 border-b border-line bg-panel/60 px-2 py-1 sm:px-3 sm:py-1.5 xl:px-4">
        <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-1 sm:flex-wrap sm:gap-1.5">
          {/* Left: Mode badge + Series BoX selector + Game Status */}
          <div className="flex min-w-0 items-center gap-1 sm:flex-wrap sm:gap-2">
            <div className="hidden items-center gap-1.5 sm:flex">
              <Bot className="size-4 shrink-0 text-gold" aria-hidden="true" />
              <span className="font-display text-xs font-bold tracking-wider text-ink sm:text-sm">
                {t("ฝึกดราฟต์ vs AI")}
              </span>
            </div>

            <select
              aria-label={t("จำนวนเกม")}
              value={gameCount}
              onChange={(e) => onUpdateMeta((prev) => ({ ...prev, gameCount: Number(e.target.value) as PracticeGameCount }))}
              className="h-7 shrink-0 border border-line bg-bg px-1 font-mono text-[11px] font-bold text-gold focus:border-gold/60 focus:outline-none sm:hidden"
            >
              {PRACTICE_GAME_COUNTS.map((count) => (
                <option key={count} value={count} disabled={count < gameNumber} className="bg-panel text-ink">
                  Bo{count}
                </option>
              ))}
            </select>

            <div
              role="radiogroup"
              aria-label={t("จำนวนเกม")}
              className="hidden shrink-0 items-center border border-line bg-bg p-0.5 sm:inline-flex"
            >
              {PRACTICE_GAME_COUNTS.map((count) => {
                const lockedBelowCurrent = count < gameNumber;
                const active = gameCount === count;
                return (
                  <button
                    key={count}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={lockedBelowCurrent}
                    onClick={() => onUpdateMeta((prev) => ({ ...prev, gameCount: count }))}
                    className={`h-6 min-w-8 px-2 font-mono text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                      active ? "bg-gold text-bg" : "text-muted hover:bg-panel-2 hover:text-ink"
                    }`}
                  >
                    Bo{count}
                  </button>
                );
              })}
            </div>

            <span className="shrink-0 border border-gold/40 bg-gold/10 px-1.5 py-0.5 font-mono text-[11px] font-bold text-gold sm:px-2">
              <span className="sm:hidden">G{gameNumber}/{gameCount}</span>
              <span className="hidden sm:inline">{t("เกม {0}/{1}", gameNumber, gameCount)}</span>
            </span>

            {gameNumber > 1 && (
              <span className="hidden border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-muted sm:inline-block">
                {gameNumber === 7 ? t("G7 ใช้ฮีโร่เดิมได้") : "Global Ban"}
              </span>
            )}
          </div>

          {/* Right: Side switcher + AI Hints + History + New Round */}
          <div className="flex shrink-0 items-center gap-1 sm:flex-wrap sm:gap-1.5">
            <div className="inline-flex shrink-0 items-center border border-line bg-bg p-0.5">
              <button
                type="button"
                aria-pressed={startingSide === "blue" && gameNumber === 1}
                aria-label={t("ฝั่งน้ำเงิน")}
                title={t("ฝั่งน้ำเงิน")}
                onClick={() => onSwitchSide("blue")}
                className={`h-6 px-1.5 font-display text-[11px] font-bold transition-colors sm:px-2 ${
                  playerSide === "blue"
                    ? "bg-blue/20 text-blue"
                    : "text-muted hover:text-blue"
                }`}
              >
                <span className="sm:hidden">BLUE</span>
                <span className="hidden sm:inline"><StableButtonLabel message="ฝั่งน้ำเงิน" /></span>
              </button>
              <button
                type="button"
                aria-pressed={startingSide === "red" && gameNumber === 1}
                aria-label={t("ฝั่งแดง")}
                title={t("ฝั่งแดง")}
                onClick={() => onSwitchSide("red")}
                className={`h-6 px-1.5 font-display text-[11px] font-bold transition-colors sm:px-2 ${
                  playerSide === "red"
                    ? "bg-red/20 text-red"
                    : "text-muted hover:text-red"
                }`}
              >
                <span className="sm:hidden">RED</span>
                <span className="hidden sm:inline"><StableButtonLabel message="ฝั่งแดง" /></span>
              </button>
              <button
                type="button"
                title={t("สุ่มฝั่ง")}
                aria-label={t("สุ่มฝั่ง")}
                onClick={() => onSwitchSide(Math.random() < 0.5 ? "blue" : "red")}
                className="inline-flex h-6 items-center gap-1 border-l border-line px-1.5 font-display text-[11px] font-semibold text-muted transition-colors hover:text-gold sm:px-2"
              >
                <Shuffle className="size-3 shrink-0" aria-hidden="true" />
                <span className="hidden md:inline"><StableButtonLabel message="สุ่มฝั่ง" /></span>
              </button>
            </div>

            {currentStep && (
              <button
                type="button"
                aria-pressed={showHints}
                aria-label={t("ตัวช่วย")}
                title={t("ตัวช่วย")}
                onClick={() => {
                  if (showHints) trackTelemetryEvent("feat_practice_hints_off");
                  onUpdateMeta((prev) => ({ ...prev, showHints: !prev.showHints }));
                }}
                className={`${HEADER_ACTION_CLASS} ${
                  showHints
                    ? "border-gold bg-gold/15 text-gold shadow-sm"
                    : "border-line-strong bg-panel text-muted hover:border-gold/50 hover:text-ink"
                }`}
              >
                <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline"><StableButtonLabel message="ตัวช่วย" /></span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsHistoryOpen(true)}
              aria-label={t("ประวัติการดราฟต์แข่งกับ AI")}
              title={t("ประวัติการดราฟต์แข่งกับ AI")}
              className={`${HEADER_ACTION_CLASS} ${
                historyEntries.length > 0
                  ? "border-gold/50 bg-gold/10 text-gold hover:bg-gold hover:text-bg"
                  : "border-line-strong bg-panel text-muted hover:border-gold/50 hover:text-ink"
              }`}
            >
              <History className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline"><StableButtonLabel message="ประวัติ" /></span>
              <span className="border border-current/25 bg-bg/50 px-1 font-mono text-[10px] leading-tight">
                {historyEntries.length}
              </span>
            </button>

            <button
              type="button"
              onClick={onRestart}
              aria-label={t("เริ่มรอบใหม่")}
              title={t("เริ่มรอบใหม่")}
              className={`${HEADER_ACTION_CLASS} border-gold bg-gold font-bold text-bg hover:bg-gold/90`}
            >
              <PlusCircle className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline"><StableButtonLabel message="เริ่มรอบใหม่" /></span>
            </button>
          </div>
        </div>
      </div>

      {/* Broadcast Score & Turn Status Header (Matches ScoreBar layout) */}
      <header className="shrink-0 border-b border-line bg-bg/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-2 px-2.5 py-1.5 sm:gap-4 sm:px-4 sm:py-2">
          <div role="status" className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div className="hidden h-8 w-8 place-items-center bg-panel-2 clip-chamfer-sm sm:grid">
              <Bot className="size-4 text-gold" aria-hidden="true" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-mono text-[9.5px] font-semibold text-dim sm:text-xs">
                STEP {currentStep ? currentStepIndex + 1 : draft.totalSteps}/{draft.totalSteps}
              </span>
              <strong className={`font-display text-xs font-bold tracking-wide sm:text-base ${stepTone}`}>
                {turnText}
              </strong>
            </div>
          </div>

          <div className="hidden min-w-0 max-w-3xl flex-1 items-center px-4 lg:flex xl:max-w-4xl">
            {renderCenterBar(false)}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              disabled={!canUndoPlayerTurn}
              onClick={handleUndoPlayerTurn}
              title={t("ย้อนเทิร์นของคุณ")}
              aria-label={t("ย้อนเทิร์นของคุณ")}
              className="flex h-8 items-center gap-1.5 border border-ink/30 bg-panel-2 px-2.5 font-display text-xs font-bold text-ink transition-colors hover:border-ink hover:bg-line-strong disabled:pointer-events-none disabled:opacity-35 sm:h-8.5"
            >
              <Undo2 className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline"><StableButtonLabel message="ย้อนกลับ" /></span>
            </button>
            <button
              type="button"
              disabled={!hasAnyAction}
              onClick={draft.reset}
              title={t("รีเซ็ตเกมนี้")}
              aria-label={t("รีเซ็ตเกมนี้")}
              className="flex h-8 items-center gap-1.5 border border-red/50 bg-red/10 px-2.5 font-display text-xs font-bold text-red transition-colors hover:bg-red hover:text-ink disabled:pointer-events-none disabled:opacity-35 sm:h-8.5"
            >
              <RotateCcw className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden xl:inline">RESET</span>
            </button>
          </div>
        </div>

        <div className="border-t border-line/60 bg-panel/60 px-2.5 py-1.5 sm:px-4 lg:hidden">
          <div className="mx-auto flex max-w-[1920px] items-center gap-2">
            {renderCenterBar(true)}
          </div>
        </div>
      </header>

      {/* Main 3-Column Broadcast Workspace */}
      <main className="mx-auto flex min-h-0 w-full max-w-[1920px] flex-1 flex-col gap-1.5 overflow-hidden px-2 py-1.5 sm:px-3 sm:py-2">
        {aiError && (
          <div className="shrink-0">
            <Alert className="flex flex-wrap items-center justify-between gap-2">
              <span>{translateMessage(t, aiError)}</span>
              <button
                type="button"
                className={`${BUTTON_CLASS} border-red/50 bg-red/15 text-ink hover:bg-red hover:text-bg`}
                onClick={() => {
                  aiTurnStartedAt.current = performance.now();
                  draft.retryPredict();
                }}
              >
                <StableButtonLabel message="ให้ AI ลองอีกครั้ง" />
              </button>
            </Alert>
          </div>
        )}

        {/* Compact Top Matchup HUD (< lg) */}
        <div className="grid shrink-0 grid-cols-2 gap-1.5 sm:gap-2 lg:hidden">
          <TeamColumn {...blueTeam} variant="compact" />
          <TeamColumn {...redTeam} variant="compact" />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 md:grid md:grid-cols-12 md:gap-3 lg:grid-cols-[240px_minmax(0,1fr)_240px] lg:gap-3 xl:grid-cols-[300px_minmax(0,1fr)_300px] xl:gap-3.5 2xl:grid-cols-[340px_minmax(0,1fr)_340px]">
          <div className="hidden min-h-0 flex-col lg:order-1 lg:flex">
            <TeamColumn {...blueTeam} />
          </div>
          <div className="hidden min-h-0 flex-col lg:order-3 lg:flex">
            <TeamColumn {...redTeam} />
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 md:col-span-12 md:grid md:grid-cols-12 md:gap-2.5 lg:order-2 lg:col-span-1 lg:flex lg:flex-col lg:gap-2">
            {currentStep ? (
              <>
                {showHints && (
                  <>
                    <div className="shrink-0 md:hidden">
                      <AiPanel
                        variant="ribbon"
                        recommendations={recommendations}
                        banUnlockedHeroes={draft.banUnlockedHeroes}
                        missingAllyLanes={draft.missingAllyLanes}
                        currentStep={currentStep}
                        heroMap={draft.heroMap}
                        isLoading={isLoading}
                        blueWinRate={draft.blueWinRate}
                        winHistory={draft.winHistory}
                        allowLock={playerTurn}
                        onLockHero={handlePlayerLock}
                      />
                    </div>
                    <div className="hidden min-h-0 flex-col md:col-span-5 md:flex lg:shrink-0">
                      <AiPanel
                        variant="full"
                        recommendations={recommendations}
                        banUnlockedHeroes={draft.banUnlockedHeroes}
                        missingAllyLanes={draft.missingAllyLanes}
                        currentStep={currentStep}
                        heroMap={draft.heroMap}
                        isLoading={isLoading}
                        blueWinRate={draft.blueWinRate}
                        winHistory={draft.winHistory}
                        allowLock={playerTurn}
                        onLockHero={handlePlayerLock}
                      />
                    </div>
                  </>
                )}
                <div
                  className={`flex min-h-0 flex-1 flex-col ${
                    showHints ? "md:col-span-7" : "md:col-span-12"
                  }`}
                >
                  <HeroGrid
                    heroes={draft.heroes}
                    unavailableHeroes={unavailableHeroes}
                    blueUsedHeroes={bUsed}
                    redUsedHeroes={rUsed}
                    universalBans={draft.globalBans.universalBans}
                    blueTeamName={blueTeamName}
                    redTeamName={redTeamName}
                    recommendedRanks={hintedRanks}
                    missingAllyLanes={showHints ? draft.missingAllyLanes : []}
                    currentStep={currentStep}
                    allowLock={playerTurn}
                    isLoading={showHints && isLoading}
                    isHeroesLoading={draft.isHeroesLoading}
                    onLockHero={handlePlayerLock}
                  />
                </div>
              </>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto md:col-span-12">
                <PracticeReview
                  draft={draft}
                  playerSide={playerSide}
                  playerEstimate={playerEstimate}
                  evaluationFailed={evaluationFailed}
                  gameCount={gameCount}
                  previousEstimates={previousEstimates}
                  onNextGame={handleNextGame}
                />
              </div>
            )}
          </div>
        </div>
      </main>

      {isHistoryOpen && (
        <PracticeHistoryModal
          entries={historyEntries}
          heroMap={draft.heroMap}
          onLoadEntry={handleLoadHistoryEntry}
          onDeleteEntry={onDeleteHistoryEntry}
          onClearAll={onClearHistory}
          onClose={() => setIsHistoryOpen(false)}
        />
      )}
    </div>
  );
}

interface PracticeReviewProps {
  draft: ReturnType<typeof useDraft>;
  playerSide: Side;
  playerEstimate: number | null;
  evaluationFailed: boolean;
  gameCount: PracticeGameCount;
  previousEstimates: Record<number, number | null>;
  onNextGame: (side: Side) => void;
}

function PracticeReview({
  draft,
  playerSide,
  playerEstimate,
  evaluationFailed,
  gameCount,
  previousEstimates,
  onNextGame,
}: PracticeReviewProps) {
  const { t } = useLanguage();
  const [nextSide, setNextSide] = useState<Side>(playerSide);
  const stepHeroes = heroesByStep(draft);
  const { history } = reconstructDraftHistory(draft);
  const playerPicks = CANONICAL_DRAFT_STEPS.filter((step) => step.side === playerSide && step.action === "pick");
  const gameNumber = draft.globalBans.gameNumber;
  const seriesFinished = gameCount > 1 && gameNumber === gameCount;

  const blueWin =
    playerEstimate !== null ? (playerSide === "blue" ? playerEstimate : 100 - playerEstimate) : 50;
  const redWin = 100 - blueWin;
  const playerFavoured = playerEstimate !== null && playerEstimate >= 50;

  return (
    <div className="flex flex-col gap-3">
      {/* Broadcast Post-Draft Verdict Banner */}
      <section className="border border-line bg-panel p-3.5 clip-chamfer sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center border border-gold/40 bg-gold/10 text-gold">
              <Trophy className="size-5" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-base font-bold tracking-wide text-ink sm:text-lg">
                  {t("ทบทวนดราฟต์")}
                </h2>
                <span className="border border-gold/40 bg-gold/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-gold">
                  {t("เกม {0}/{1}", gameNumber, gameCount)}
                </span>
              </div>
              {playerEstimate !== null ? (
                <p className={`text-xs font-semibold sm:text-sm ${playerFavoured ? "text-good" : "text-muted"}`}>
                  {t("โมเดลประเมินโอกาสชนะของฝั่งคุณ {0}%", playerEstimate.toFixed(1))}
                </p>
              ) : evaluationFailed ? (
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-red">
                  <span>{t("ยังประเมินดราฟต์ไม่ได้")}</span>
                  <button type="button" className={`${BUTTON_CLASS} border-line-strong bg-bg text-ink`} onClick={draft.retryPredict}>
                    <StableButtonLabel message="ลองอีกครั้ง" />
                  </button>
                </div>
              ) : (
                <p role="status" className="text-xs text-muted">{t("กำลังประเมินดราฟต์…")}</p>
              )}
            </div>
          </div>

          {playerEstimate !== null && (
            <div className="w-full max-w-xs space-y-1 sm:w-64">
              <div className="flex items-center justify-between font-mono text-xs font-bold tabular-nums">
                <span className="text-blue">
                  {t(playerSide === "blue" ? "คุณ" : "AI")} · {blueWin.toFixed(1)}%
                </span>
                <span className="text-red">
                  {redWin.toFixed(1)}% · {t(playerSide === "red" ? "คุณ" : "AI")}
                </span>
              </div>
              <div className="relative flex h-2 w-full overflow-hidden bg-panel-2">
                <div className="h-full bg-gradient-to-r from-blue-deep to-blue" style={{ width: `${blueWin}%` }} />
                <div className="h-full flex-1 bg-gradient-to-l from-red-deep to-red" />
              </div>
            </div>
          )}
        </div>

        {/* Next Game Action Bar */}
        {gameNumber < gameCount && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5 border-t border-line pt-3">
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="sr-only">{t("ฝั่งเกมถัดไป")}</legend>
              <span className="font-display text-xs font-semibold text-muted">{t("ฝั่งเกมถัดไป")}:</span>
              <div className="inline-flex border border-line bg-bg p-0.5">
                {SIDES.map(({ value, label, color }) => {
                  const selected = nextSide === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setNextSide(value)}
                      className={`h-7 px-3 font-display text-xs font-bold transition-colors ${
                        selected ? `bg-gold/15 ${color} ring-1 ring-gold/60 ring-inset` : "text-muted hover:text-ink"
                      }`}
                    >
                      <StableButtonLabel message={label} />
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <button
              type="button"
              className="inline-flex min-h-8 items-center justify-center gap-1.5 border border-gold bg-gold px-4 font-display text-xs font-bold text-bg transition-colors hover:bg-gold/90 disabled:opacity-50"
              disabled={playerEstimate === null && !evaluationFailed}
              onClick={() => onNextGame(nextSide)}
            >
              <StableButtonLabel message="เกมถัดไป" />
              <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
            </button>
          </div>
        )}
      </section>

      {/* Series Summary Card (Bo3/Bo5/Bo7) */}
      {seriesFinished && (
        <section className="space-y-2.5 border border-line bg-panel p-3.5 sm:p-4">
          <h3 className="font-display text-sm font-bold tracking-wide text-gold">{t("ผลประเมินทั้งซีรีส์")}</h3>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {Array.from({ length: gameCount }, (_, index) => {
              const game = index + 1;
              const estimate = game === gameNumber ? playerEstimate : previousEstimates[game] ?? null;
              const good = estimate !== null && estimate >= 50;
              return (
                <div key={game} className="min-w-0 border border-line bg-bg px-2.5 py-2">
                  <dt className="font-mono text-[10px] font-semibold text-dim">{t("เกม {0}", game)}</dt>
                  <dd className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${estimate === null ? "text-muted" : good ? "text-good" : "text-ink"}`}>
                    {estimate === null ? t("ยังไม่มีผลประเมิน") : `${estimate.toFixed(1)}%`}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      )}

      {/* 5-Pick Replay Cards with Hero Portraits */}
      <section className="space-y-2.5 border border-line bg-panel p-3.5 sm:p-4">
        <p className="text-xs text-muted">{t("เลือกจังหวะที่จะลองใหม่ แล้วดราฟต์ต่อจากจุดนั้นกับ AI")}</p>
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          {playerPicks.map((step, pickIdx) => {
            if (!step || !history[step.step]) return null;
            const hero = stepHeroes[step.step];
            if (!hero) return null;
            const heroObj = draft.heroMap.get(hero);
            const lane = heroObj
              ? laneKey(heroObj.main_pro_lane && heroObj.main_pro_lane !== "Unpicked" ? heroObj.main_pro_lane : heroObj.lane)
              : "";
            const reply = CANONICAL_DRAFT_STEPS.slice(step.step + 1).find((later) => later.side !== playerSide);
            const replyHero = reply ? stepHeroes[reply.step] : null;
            return (
              <button
                key={step.step}
                type="button"
                className="group flex min-h-14 items-center justify-between gap-3 border border-line-strong bg-bg p-2 text-left transition-colors hover:border-gold/60 hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-gold"
                onClick={() => draft.importDraft(history[step.step])}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <div className={`relative size-11 shrink-0 overflow-hidden border ${playerSide === "blue" ? "border-blue/50" : "border-red/50"}`}>
                    <HeroPortrait name={hero} hero={heroObj} />
                    {lane && (
                      <span className="absolute right-0 bottom-0 grid size-4 place-items-center bg-bg/90">
                        <LaneIcon lane={lane} className="size-3" />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-display text-sm font-bold text-ink group-hover:text-gold">
                        {t("ลอง Pick {0} ใหม่ · {1}", pickIdx + 1, displayName(hero))}
                      </span>
                      {lane && LANE_SHORT[lane] && (
                        <span className="shrink-0 border border-line bg-panel px-1 font-mono text-[9px] font-bold text-muted">
                          {LANE_SHORT[lane].en}
                        </span>
                      )}
                    </div>
                    {reply && replyHero && (
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                        <div className="size-4 shrink-0 overflow-hidden border border-line">
                          <HeroPortrait name={replyHero} hero={draft.heroMap.get(replyHero)} />
                        </div>
                        <span className="truncate">
                          {t(reply.action === "pick" ? "เทิร์นถัดไปของ AI เลือก {0}" : "เทิร์นถัดไปของ AI แบน {0}", displayName(replyHero))}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-1 border border-gold/40 bg-gold/10 px-2 py-1 font-display text-[11px] font-bold text-gold transition-colors group-hover:bg-gold group-hover:text-bg">
                  <RotateCcw className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="hidden sm:inline"><StableButtonLabel message="ลองใหม่" /></span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

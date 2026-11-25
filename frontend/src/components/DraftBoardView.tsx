import { type Message, translateMessage, useLanguage } from "../i18n/language";
import {
  ArrowLeftRight,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  History,
  LayoutGrid,
  Lock,
  PlusCircle,
  Sparkles,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  findMatchingHeroPool,
  getHeroPools,
  getPoolHeroSet,
  getSavedPoolTeamNames,
  type HeroPoolOverview,
  POOL_LANES,
} from "../api/heroPools";
import { MAX_SERIES_GAMES, type useDraft } from "../hooks/useDraft";
import { useDraftTimer } from "../hooks/useDraftTimer";
import type { LaneKey, TournamentRef } from "../types/draft";
import {
  blueTeamName,
  blueUsedHeroes,
  buildPoolHeroLaneMap,
  type DraftSlot,
  draftSlotKey,
  getDraftSlotStep,
  getGameSeriesGroup,
  getGameSeriesKey,
  getGameUnlockStatus,
  getMaxUnlockedGame,
  getSeriesScore,
  heroFitsLaneSet,
  heroOriginGameMap,
  isSameRecordedDraft,
  listTournaments,
  missingLaneKeys,
  type PoolMode,
  redTeamName,
  redUsedHeroes,
  resolveSeriesName,
  resolveSeriesKey,
} from "../utils/draft";
import { displayName } from "../utils/heroNames";
import { aiAdoptionMetricForRank, type TelemetryMetricKey, trackTelemetryEvent } from "../utils/telemetry";
import { AiPanel } from "./AiPanel";
import { Alert } from "./Alert";
import { ConfirmDialog } from "./ConfirmDialog";
import type { GlobalBanCategoryKey } from "./GlobalBanModal";
import { HeroGrid } from "./HeroGrid";
import { HeroPortrait } from "./HeroPortrait";
import { Modal } from "./Modal";
import { ScoreBar } from "./ScoreBar";
import { StableButtonLabel } from "./StableButtonLabel";
import { TeamColumn } from "./TeamColumn";

const DraftHistoryModal = lazy(() =>
  import("./DraftHistoryModal").then((m) => ({ default: m.DraftHistoryModal })),
);
const DraftPickActions = lazy(() =>
  import("./DraftPickActions").then((m) => ({ default: m.DraftPickActions })),
);
const FinishGameModal = lazy(() =>
  import("./FinishGameModal").then((m) => ({ default: m.FinishGameModal })),
);
const GlobalBanModal = lazy(() =>
  import("./GlobalBanModal").then((m) => ({ default: m.GlobalBanModal })),
);
const HeroPoolsModal = lazy(() =>
  import("./HeroPoolsModal").then((m) => ({ default: m.HeroPoolsModal })),
);
const NewSeriesModal = lazy(() =>
  import("./NewSeriesModal").then((m) => ({ default: m.NewSeriesModal })),
);
const PickLaneModal = lazy(() =>
  import("./PickLaneModal").then((m) => ({ default: m.PickLaneModal })),
);
const HeroPickerModal = lazy(() =>
  import("./lab/HeroPickerModal").then((m) => ({ default: m.HeroPickerModal })),
);

const EMPTY_RECOMMENDED_RANKS = new Map<string, number>();
const EMPTY_MISSING_LANES: string[] = [];
const RESULT_MESSAGES = { save: "บันทึกผล", saved: "บันทึกแล้ว", update: "อัปเดตผล", locked: "ล็อกอยู่" };
const MOBILE_MEDIA_QUERY = "(max-width: 767px)";

function subscribeMobileViewport(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(MOBILE_MEDIA_QUERY);
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getIsMobileViewport() {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

export type MobileDraftView = "draft" | "ai" | "teams";

const MOBILE_TAB_CLASS =
  "flex min-h-10 min-w-0 items-center justify-center gap-1 px-1.5 py-2 font-display text-[11px] font-bold tracking-wide transition-colors sm:flex-col sm:gap-0.5 sm:text-xs";

export interface DraftBoardViewProps {
  draft: ReturnType<typeof useDraft>;
  isActiveTab: boolean;
  disableShortcuts?: boolean;
  assistantEnabled?: boolean;
  onToggleAssistant?: () => void;
  teamHistoryUsername?: string;
  isPaidUser?: boolean;
  isAuthenticated?: boolean;
  onOpenAuthModal?: () => void;
  activeDraftTool?: "pools" | null;
  onCloseDraftTool?: () => void;
}

function getVisibleDraftSlot({ side, action, index }: DraftSlot) {
  const slots = document.querySelectorAll<HTMLElement>(`[data-draft-slot="${side}-${action}-${index}"]`);
  return Array.from(slots).find((slot) => slot.getClientRects().length > 0);
}

export function DraftBoardView({
  draft,
  isActiveTab,
  disableShortcuts = false,
  assistantEnabled = true,
  onToggleAssistant,
  teamHistoryUsername,
  isPaidUser = false,
  isAuthenticated = false,
  onOpenAuthModal,
  activeDraftTool = null,
  onCloseDraftTool,
}: DraftBoardViewProps) {
  const { language, t } = useLanguage();
  const {
    heroes,
    heroMap,
    currentStepIndex,
    currentStep,
    totalSteps,
    bluePicks,
    redPicks,
    blueBans,
    redBans,
    pickLanes,
    setPickLane,
    globalBans,
    setGlobalBans,
    selectGameNumber,
    seriesGames,
    saveCurrentDraftSnapshot,
    currentDraftSnapshot,
    personalHistoryLimit,
    startNewSeries,
    switchSeries,
    loadRecordedGame,
    fromTeamHistory,
    currentSavedGameId,
    isCurrentGameLocked,
    deleteRecordedGame,
    deleteSeriesGroup,
    clearAllHistory,
    swapTeamSides,
    swapTeamAndBoardSides,
    recordGameToSeries,
    globalBanConflicts,
    setRecordedGameWinner,
    toggleRecordedGameLock,
    importSeriesGames,
    unavailableHeroes,
    league,
    setLeague,
    recommendations,
    blueNextPicks,
    redNextPicks,
    blueNextBans,
    redNextBans,
    banUnlockedHeroes,
    missingAllyLanes,
    blueWinRate,
    winHistory,
    isLoading,
    isHeroesLoading,
    error,
    syncError,
    retryPredict,
    setPausePredict,
    setPoolContext,
    heroesFallback,
    lockHero,
    replaceHero,
    getUnavailableHeroesForSlot,
    undo,
    redo,
    reset,
    canUndo,
    canRedo,
  } = draft;

  const searchRef = useRef<HTMLInputElement>(null);
  const heroGridSpotlightRef = useRef<HTMLDivElement>(null);
  const conflictAnimationRef = useRef<Animation | null>(null);
  const conflictMessageId = useId();
  const [mobileView, setMobileView] = useState<MobileDraftView>("draft");
  const [globalBanModalCat, setGlobalBanModalCatState] = useState<GlobalBanCategoryKey | null>(null);
  const setGlobalBanModalCat = useCallback(
    (cat: GlobalBanCategoryKey | null) => {
      setGlobalBanModalCatState(cat);
      setPausePredict?.(cat !== null);
    },
    [setPausePredict],
  );
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [newSeriesContext, setNewSeriesContext] = useState<{ tournament: TournamentRef | null; options?: TournamentRef[] } | null>(null);
  const isNewSeriesModalOpen = newSeriesContext !== null;
  const [isFinishGameModalOpen, setIsFinishGameModalOpen] = useState(false);
  const [historyUpgradeOpen, setHistoryUpgradeOpen] = useState(false);
  const historyUpgradeTitleId = useId();
  const isPoolsModalOpen = activeDraftTool === "pools";
  const [heroPoolOverview, setHeroPoolOverview] = useState<HeroPoolOverview | null>(null);
  const [poolRevision, setPoolRevision] = useState(0);
  const lastPoolRefreshAtRef = useRef(0);
  const [timerSettingsOpen, setTimerSettingsOpen] = useState(false);
  const [poolMode, setPoolMode] = useState<PoolMode>("low");
  const cyclePoolMode = useCallback(
    () => setPoolMode((m) => (m === "low" ? "high" : m === "high" ? "off" : "low")),
    [],
  );
  const [slotEditor, setSlotEditor] = useState<{ slot: DraftSlot; view: "actions" | "hero" | "lane" } | null>(null);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmLabel: Message;
    cancelLabel?: string;
    tone?: "gold" | "danger";
    onConfirm: () => void;
  } | null>(null);
  const [swapCount, setSwapCount] = useState(0);
  const [swapMenuOpen, setSwapMenuOpen] = useState(false);
  const swapMenuRef = useRef<HTMLDivElement>(null);
  const [laneResetKey, setLaneResetKey] = useState(0);
  const [lateHeroMap, setLateHeroMap] = useState<
    Record<string, { gameKey: string; reason: "late" | "autolock" }>
  >({});
  const currentGameKey = `${resolveSeriesKey(globalBans)}#${globalBans.gameNumber}`;
  const [globalBanConflict] = globalBanConflicts;
  const conflictingHero = globalBanConflict?.hero;
  const isMobileViewport = useSyncExternalStore(subscribeMobileViewport, getIsMobileViewport, () => false);
  const editingHero = slotEditor
    ? { bluePicks, redPicks, blueBans, redBans }[draftSlotKey(slotEditor.slot)][slotEditor.slot.index]
    : undefined;
  const activeSlotEditor = editingHero && !isCurrentGameLocked ? slotEditor : null;
  const editingSlot = !isMobileViewport && activeSlotEditor?.view === "hero" ? activeSlotEditor.slot : null;
  const editingSlotStep = editingSlot ? (getDraftSlotStep(editingSlot) ?? currentStep) : currentStep;
  const activeUnavailableHeroes = editingSlot ? getUnavailableHeroesForSlot(editingSlot) : unavailableHeroes;

  useEffect(() => () => conflictAnimationRef.current?.cancel(), [globalBanConflict]);

  const emphasizeGlobalBanConflict = useCallback(() => {
    if (!globalBanConflict) return;
    const slot = getVisibleDraftSlot(globalBanConflict.slot);
    const outline = slot?.querySelector<HTMLElement>("[data-conflict-outline]");
    if (!slot || !outline) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (window.matchMedia("(max-width: 767px)").matches) {
      slot.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion ? "instant" : "smooth" });
    }
    conflictAnimationRef.current?.cancel();
    // Reduced motion uses a held outline that clears after the same interval.
    conflictAnimationRef.current = reducedMotion
      ? outline.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 840 })
      : outline.animate(
          [{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }],
          { duration: 420, iterations: 2, easing: "ease-in-out" },
        );
  }, [globalBanConflict]);

  const closeSlotEditor = useCallback(() => {
    if (!slotEditor) return;
    const { slot } = slotEditor;
    setSlotEditor(null);
    window.requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return;
      getVisibleDraftSlot(slot)?.focus({ preventScroll: true });
    });
  }, [slotEditor]);

  const openHeroReplace = useCallback((slot: DraftSlot) => {
    setSlotEditor({ slot, view: "hero" });
  }, []);

  useEffect(() => {
    if (!editingSlot) return;
    window.requestAnimationFrame(() => {
      searchRef.current?.focus({ preventScroll: true });
    });
  }, [editingSlot]);

  const fallbackTimerHero = useMemo(
    () =>
      (assistantEnabled ? recommendations.find((r) => !unavailableHeroes.has(r.hero_name))?.hero_name : undefined) ??
      heroes.find((h) => !unavailableHeroes.has(h.name))?.name ??
      null,
    [assistantEnabled, heroes, recommendations, unavailableHeroes],
  );

  const handleAutoLockWithTimer = useCallback(
    (heroName: string) => {
      if (conflictingHero || unavailableHeroes.has(heroName)) return;
      setLateHeroMap((prev) => ({
        ...prev,
        [heroName]: { gameKey: currentGameKey, reason: "autolock" },
      }));
      lockHero(heroName);
    },
    [conflictingHero, unavailableHeroes, currentGameKey, lockHero],
  );

  const timer = useDraftTimer({
    currentStep,
    currentStepIndex,
    resetSignal: currentGameKey,
    isBusy:
      isLoading ||
      isHeroesLoading ||
      Boolean(conflictingHero) ||
      (assistantEnabled && currentStep !== null && recommendations.length === 0 && !error),
    suspended: Boolean(
      activeSlotEditor ||
        globalBanConflict ||
        timerSettingsOpen ||
        !isActiveTab ||
        globalBanModalCat !== null ||
        isHistoryModalOpen ||
        isNewSeriesModalOpen ||
        isFinishGameModalOpen ||
        historyUpgradeOpen ||
        isPoolsModalOpen ||
        confirmState !== null,
    ),
    fallbackHero: fallbackTimerHero,
    onExpireAutoLock: handleAutoLockWithTimer,
  });

  const canSwapBoardAndTeams =
    currentStep === null &&
    bluePicks.length === 5 &&
    redPicks.length === 5 &&
    blueBans.length === 4 &&
    redBans.length === 4;
  const isSwapMenuOpen = canSwapBoardAndTeams && swapMenuOpen && !isCurrentGameLocked;

  useEffect(() => {
    if (!isSwapMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!swapMenuRef.current?.contains(event.target as Node)) {
        setSwapMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSwapMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSwapMenuOpen]);

  const handleSwapTeamOnly = () => {
    if (isCurrentGameLocked) return;
    swapTeamSides();
    setSwapCount((c) => c + 1);
    setSwapMenuOpen(false);
  };

  const handleSwapTeamAndBoard = () => {
    if (isCurrentGameLocked) return;
    swapTeamAndBoardSides();
    setSwapCount((c) => c + 1);
    setSwapMenuOpen(false);
  };

  const handleSwapSides = () => {
    if (isCurrentGameLocked) return;
    if (canSwapBoardAndTeams) {
      setSwapMenuOpen((open) => !open);
      return;
    }
    handleSwapTeamOnly();
  };

  const bUsed = useMemo(() => blueUsedHeroes(globalBans), [globalBans]);
  const rUsed = useMemo(() => redUsedHeroes(globalBans), [globalBans]);
  const bName = blueTeamName(globalBans);
  const rName = redTeamName(globalBans);
  const effectiveHistoryLimit = personalHistoryLimit ?? MAX_SERIES_GAMES;
  const currentSeriesKey = resolveSeriesKey(globalBans);
  const isUpdatingSavedGame = seriesGames.some(
    (game) => getGameSeriesKey(game) === currentSeriesKey && game.gameNumber === globalBans.gameNumber,
  );
  const isPersonalHistoryBlocked =
    !isPaidUser && personalHistoryLimit !== undefined && seriesGames.length >= effectiveHistoryLimit && !isUpdatingSavedGame;

  useEffect(() => {
    if (!teamHistoryUsername) return;
    const ctrl = new AbortController();
    getHeroPools(ctrl.signal)
      .then((data) => {
        if (!ctrl.signal.aborted) {
          lastPoolRefreshAtRef.current = Date.now();
          setHeroPoolOverview(data);
        }
      })
      .catch(() => {
        // Keep previously loaded Hero Pools on transient network failures.
      });
    return () => ctrl.abort();
  }, [teamHistoryUsername, poolRevision]);

  useEffect(() => {
    if (!teamHistoryUsername) return;
    const onBillingChange = () => setPoolRevision((v) => v + 1);
    const onFocus = () => {
      if (Date.now() - lastPoolRefreshAtRef.current < 30_000) return;
      setPoolRevision((v) => v + 1);
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("billingchange", onBillingChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("billingchange", onBillingChange);
    };
  }, [teamHistoryUsername]);

  const activePoolOverview = teamHistoryUsername ? heroPoolOverview : null;
  const bluePool = useMemo(() => findMatchingHeroPool(bName, activePoolOverview), [bName, activePoolOverview]);
  const redPool = useMemo(() => findMatchingHeroPool(rName, activePoolOverview), [rName, activePoolOverview]);
  const bluePoolHeroes = useMemo(() => getPoolHeroSet(bluePool), [bluePool]);
  const redPoolHeroes = useMemo(() => getPoolHeroSet(redPool), [redPool]);
  const savedPoolTeamNames = useMemo(() => getSavedPoolTeamNames(activePoolOverview), [activePoolOverview]);
  const activeAllyPool = currentStep?.side === "red" ? redPool : bluePool;
  const activeEnemyPool = currentStep?.side === "red" ? bluePool : redPool;
  const activeAllyPoolHeroes = currentStep?.side === "red" ? redPoolHeroes : bluePoolHeroes;
  const activeEnemyPoolHeroes = currentStep?.side === "red" ? bluePoolHeroes : redPoolHeroes;
  const allyPoolHeroLanes = useMemo(() => buildPoolHeroLaneMap(activeAllyPool?.lanes), [activeAllyPool]);
  const effectivePoolHeroLanes = poolMode === "off" ? undefined : allyPoolHeroLanes;

  const recommendedRanks = useMemo(() => {
    if (!assistantEnabled) return EMPTY_RECOMMENDED_RANKS;
    const missing = currentStep?.action === "ban" ? new Set<string>() : missingLaneKeys(missingAllyLanes);
    const fits =
      missing.size > 0 && missing.size < 5
        ? recommendations.filter((r) => heroFitsLaneSet(r.hero_name, r.primary_lane, missing, effectivePoolHeroLanes))
        : recommendations;
    const poolForRanks = fits.length > 0 ? fits : recommendations;
    return new Map(poolForRanks.slice(0, 10).map((r, i) => [r.hero_name, i + 1]));
  }, [assistantEnabled, currentStep?.action, missingAllyLanes, recommendations, effectivePoolHeroLanes]);

  const handleLockHeroWithTimer = useCallback(
    (heroName: string) => {
      if (isCurrentGameLocked) return false;
      if (globalBanConflict) {
        emphasizeGlobalBanConflict();
        return false;
      }
      if (unavailableHeroes.has(heroName)) return false;
      if (timer.enabled && timer.isExpired) {
        setLateHeroMap((prev) => ({
          ...prev,
          [heroName]: { gameKey: currentGameKey, reason: "late" },
        }));
      } else {
        setLateHeroMap((prev) => {
          if (!prev[heroName]) return prev;
          const next = { ...prev };
          delete next[heroName];
          return next;
        });
      }
      if (assistantEnabled && recommendations.length > 0) {
        trackTelemetryEvent(aiAdoptionMetricForRank(recommendedRanks.get(heroName)));
      }
      lockHero(heroName);
    },
    [
      isCurrentGameLocked,
      assistantEnabled,
      recommendations.length,
      recommendedRanks,
      globalBanConflict,
      emphasizeGlobalBanConflict,
      unavailableHeroes,
      timer.enabled,
      timer.isExpired,
      currentGameKey,
      lockHero,
    ],
  );

  const handleSelectOrLockHero = useCallback(
    (heroName: string) => {
      if (isCurrentGameLocked) return false;
      if (editingSlot && editingHero) {
        if (!replaceHero(editingSlot, heroName)) return false;
        trackTelemetryEvent("feat_replace_hero");
        setLateHeroMap((prev) => {
          if (!prev[editingHero]) return prev;
          const next = { ...prev };
          delete next[editingHero];
          return next;
        });
        setSlotEditor(null);
        setLaneResetKey((k) => k + 1);
        return true;
      }
      const locked = handleLockHeroWithTimer(heroName);
      if (locked !== false) {
        setLaneResetKey((k) => k + 1);
      }
      return locked;
    },
    [isCurrentGameLocked, editingSlot, editingHero, replaceHero, handleLockHeroWithTimer],
  );

  useEffect(() => {
    setPoolContext({
      allyPool: Array.from(activeAllyPoolHeroes),
      enemyPool: Array.from(activeEnemyPoolHeroes),
      poolMode,
      allyPoolLanes: activeAllyPool?.lanes,
    });
  }, [activeAllyPool, activeAllyPoolHeroes, activeEnemyPoolHeroes, poolMode, setPoolContext]);
  const seriesScore = useMemo(
    () => getSeriesScore(seriesGames, resolveSeriesKey(globalBans)),
    [seriesGames, globalBans],
  );
  const blueCategoryKey: GlobalBanCategoryKey = globalBans.blueSideTeam === "A" ? "teamAUsed" : "teamBUsed";
  const redCategoryKey: GlobalBanCategoryKey = globalBans.blueSideTeam === "A" ? "teamBUsed" : "teamAUsed";

  const originMap = useMemo(
    () => heroOriginGameMap(fromTeamHistory ? [] : seriesGames, resolveSeriesKey(globalBans)),
    [seriesGames, globalBans, fromTeamHistory],
  );
  const blueOriginGames = globalBans.blueSideTeam === "A" ? originMap.teamAGameByHero : originMap.teamBGameByHero;
  const redOriginGames = globalBans.blueSideTeam === "A" ? originMap.teamBGameByHero : originMap.teamAGameByHero;

  const promptLockedGame = (g: number) => {
    const unlockStatus = getGameUnlockStatus(g, globalBans, seriesGames);
    const missingStr = unlockStatus.missingGames.map((mg) => `Game ${mg}`).join(", ");
    const teamAName = globalBans.teamAName || "Team A";
    const teamBName = globalBans.teamBName || "Team B";
    setConfirmState({
      title: t("Game {0} ยังไม่ปลดล็อก", g),
      message: t("ต้องบันทึกผล {1} หรือใส่ Global Ban ฝั่งละ {2} ตัวขึ้นไป\nปัจจุบัน: {3} {4}/{5} · {6} {7}/{8}", g, missingStr, unlockStatus.requiredCount, teamAName, unlockStatus.aCount, unlockStatus.requiredCount, teamBName, unlockStatus.bCount, unlockStatus.requiredCount),
      confirmLabel: "เปิด Global Ban",
      cancelLabel: "ปิด",
      tone: "gold",
      onConfirm: () => {
        setConfirmState(null);
        setGlobalBanModalCat(blueCategoryKey);
      },
    });
  };

  const removeUsedHero = useCallback(
    (catKey: "teamAUsed" | "teamBUsed", heroName: string) => {
      const candidateState = {
        ...globalBans,
        [catKey]: globalBans[catKey].filter((n) => n !== heroName),
      };
      const statusAfter = getGameUnlockStatus(globalBans.gameNumber, candidateState, seriesGames);
      if (!fromTeamHistory && globalBans.gameNumber > 1 && !statusAfter.isUnlocked) {
        const maxUnlocked = getMaxUnlockedGame(candidateState, seriesGames);
        setConfirmState({
          title: t("ยืนยันการลบ {0}?", displayName(heroName)),
          message: t(
            "การลบ {0} จะทำให้จำนวน Global Ban ไม่ครบตามเงื่อนไขของ Game {1} (ต้องมีอย่างน้อยฝั่งละ {2} ตัว)\n\nระบบจะย้อนกลับไปยัง Game {3} อัตโนมัติ",
            displayName(heroName),
            globalBans.gameNumber,
            statusAfter.requiredCount,
            maxUnlocked,
          ),
          confirmLabel: ["ย้อนไป Game {0}", maxUnlocked],
          cancelLabel: "ยกเลิก",
          tone: "danger",
          onConfirm: () => {
            setConfirmState(null);
            setIsFinishGameModalOpen(false);
            selectGameNumber(maxUnlocked, candidateState);
          },
        });
        return;
      }
      setGlobalBans(candidateState);
    },
    [globalBans, seriesGames, fromTeamHistory, t, setGlobalBans, selectGameNumber],
  );

  const hasAnyAction = bluePicks.length + redPicks.length + blueBans.length + redBans.length > 0;
  const isDraftComplete = currentStep === null;
  const prevDraftCompleteRef = useRef(isDraftComplete);
  useEffect(() => {
    if (!prevDraftCompleteRef.current && isDraftComplete) {
      trackTelemetryEvent("draft_completed_18");
    }
    prevDraftCompleteRef.current = isDraftComplete;
  }, [isDraftComplete]);
  const conflictCount = globalBanConflicts.length;
  const conflictCountLabel = conflictCount === 1 ? t("เหลือ 1 ช่อง") : t("เหลือ {0} ช่อง", conflictCount);
  const conflictMessage = globalBanConflict
    ? t(globalBanConflict.slot.action === "pick"
      ? "{0} ติด Global Ban แล้ว แก้ Pick {1} ก่อนดราฟต์ต่อ"
      : "{0} ติด Global Ban แล้ว แก้ Ban {1} ก่อนดราฟต์ต่อ",
      displayName(globalBanConflict.hero), globalBanConflict.slot.index + 1)
    : null;
  const activeBoardHeroes = useMemo(
    () => new Set([...bluePicks, ...redPicks, ...blueBans, ...redBans]),
    [bluePicks, redPicks, blueBans, redBans],
  );
  const timedOutHeroes = useMemo(() => {
    const out: Record<string, "late" | "autolock"> = {};
    for (const [hero, entry] of Object.entries(lateHeroMap)) {
      if (entry.gameKey === currentGameKey && activeBoardHeroes.has(hero)) {
        out[hero] = entry.reason;
      }
    }
    return out;
  }, [lateHeroMap, currentGameKey, activeBoardHeroes]);
  const existingSeriesNames = useMemo(
    () => Array.from(new Set(seriesGames.map(getGameSeriesGroup).filter(Boolean))),
    [seriesGames],
  );
  const currentSeriesGroup = resolveSeriesKey(globalBans);
  const savedCurrentGame = useMemo(
    () =>
      seriesGames.find(
        (g) => getGameSeriesKey(g) === currentSeriesGroup && g.gameNumber === globalBans.gameNumber,
      ) ?? null,
    [seriesGames, currentSeriesGroup, globalBans.gameNumber],
  );
  const isCurrentGameSavedUnchanged = isSameRecordedDraft(savedCurrentGame, {
    blueSideTeam: globalBans.blueSideTeam,
    blueBans,
    redBans,
    bluePicks,
    redPicks,
    pickLanes,
  });
  const isResultSaved = isDraftComplete && isCurrentGameSavedUnchanged;
  const resultMessage = RESULT_MESSAGES[isResultSaved ? "saved" : savedCurrentGame ? "update" : "save"];

  const { enabled: timerEnabled, isExpired: timerExpired, resetTurnTimer } = timer;
  const handleUndoWithTimer = useCallback(() => {
    if (isCurrentGameLocked) return;
    if (timerEnabled && timerExpired) {
      resetTurnTimer();
    }
    undo();
  }, [isCurrentGameLocked, timerEnabled, timerExpired, resetTurnTimer, undo]);

  // Keyboard shortcuts: "/" focus search, Enter lock top suggestion, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo
  useEffect(() => {
    if (
      !isActiveTab ||
      disableShortcuts ||
      globalBanModalCat !== null ||
      isHistoryModalOpen ||
      isNewSeriesModalOpen ||
      isFinishGameModalOpen ||
      historyUpgradeOpen ||
      isPoolsModalOpen ||
      activeSlotEditor?.view === "actions" ||
      activeSlotEditor?.view === "lane" ||
      (activeSlotEditor?.view === "hero" && isMobileViewport) ||
      confirmState !== null
    ) {
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (typeof document !== "undefined" && document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        return;
      }
      if (e.key === "Escape" && editingSlot) {
        e.preventDefault();
        closeSlotEditor();
        return;
      }
      if (e.key === "Tab" && editingSlot) {
        const container = heroGridSpotlightRef.current;
        if (!container) return;
        const focusables = Array.from(
          container.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.getClientRects().length > 0);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const activeEl = document.activeElement as HTMLElement | null;
        if (!activeEl || !container.contains(activeEl)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
          return;
        }
        if (e.shiftKey && activeEl === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && activeEl === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      const typing =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement;
      if (typing) return;

      if (!isCurrentGameLocked && !editingSlot && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          handleUndoWithTimer();
        }
      } else if (!isCurrentGameLocked && !editingSlot && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (
        !isCurrentGameLocked &&
        e.key === "Enter" &&
        !editingSlot &&
        !(e.target instanceof HTMLButtonElement) &&
        !(e.target instanceof HTMLAnchorElement) &&
        !(e.target instanceof HTMLElement && e.target.getAttribute("role") === "button")
      ) {
        if (globalBanConflict && currentStep) {
          emphasizeGlobalBanConflict();
          return;
        }
        const top = assistantEnabled ? recommendations[0] : undefined;
        if (top && currentStep && !isLoading && !unavailableHeroes.has(top.hero_name)) {
          handleLockHeroWithTimer(top.hero_name);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    isActiveTab,
    disableShortcuts,
    isCurrentGameLocked,
    assistantEnabled,
    globalBanModalCat,
    isHistoryModalOpen,
    isNewSeriesModalOpen,
    isFinishGameModalOpen,
    historyUpgradeOpen,
    isPoolsModalOpen,
    slotEditor,
    activeSlotEditor,
    editingSlot,
    isMobileViewport,
    closeSlotEditor,
    confirmState,
    handleUndoWithTimer,
    redo,
    handleLockHeroWithTimer,
    recommendations,
    currentStep,
    isLoading,
    unavailableHeroes,
    globalBanConflict,
    emphasizeGlobalBanConflict,
  ]);

  const handleTeamEditSlot = useCallback(
    (slot: DraftSlot) => {
      if (isCurrentGameLocked) return;
      if (
        editingSlot &&
        editingSlot.side === slot.side &&
        editingSlot.action === slot.action &&
        editingSlot.index === slot.index
      ) {
        closeSlotEditor();
        return;
      }
      if (slot.action === "pick") {
        setSlotEditor({ slot, view: "actions" });
      } else {
        openHeroReplace(slot);
      }
    },
    [isCurrentGameLocked, editingSlot, closeSlotEditor, openHeroReplace],
  );

  const conflictingSlots = useMemo(() => globalBanConflicts.map(({ slot }) => slot), [globalBanConflicts]);
  const openBlueGlobalBan = useCallback(() => {
    if (!isCurrentGameLocked) setGlobalBanModalCat(blueCategoryKey);
  }, [isCurrentGameLocked, setGlobalBanModalCat, blueCategoryKey]);
  const openRedGlobalBan = useCallback(() => {
    if (!isCurrentGameLocked) setGlobalBanModalCat(redCategoryKey);
  }, [isCurrentGameLocked, setGlobalBanModalCat, redCategoryKey]);
  const removeBlueUsedHero = useCallback((heroName: string) => {
    if (!isCurrentGameLocked) removeUsedHero(blueCategoryKey, heroName);
  }, [isCurrentGameLocked, removeUsedHero, blueCategoryKey]);
  const removeRedUsedHero = useCallback((heroName: string) => {
    if (!isCurrentGameLocked) removeUsedHero(redCategoryKey, heroName);
  }, [isCurrentGameLocked, removeUsedHero, redCategoryKey]);

  const bluePoolLaneStats = useMemo(() => {
    if (!bluePool) return [];
    const poolUsedSet = new Set([...bUsed, ...globalBans.universalBans, ...activeBoardHeroes]);
    return POOL_LANES.flatMap((lane) => {
      const list = bluePool.lanes[lane] ?? [];
      if (list.length === 0) return [];
      const remaining = list.filter((h) => !poolUsedSet.has(h)).length;
      return [{ lane, remaining, total: list.length }];
    });
  }, [bluePool, bUsed, globalBans.universalBans, activeBoardHeroes]);

  const redPoolLaneStats = useMemo(() => {
    if (!redPool) return [];
    const poolUsedSet = new Set([...rUsed, ...globalBans.universalBans, ...activeBoardHeroes]);
    return POOL_LANES.flatMap((lane) => {
      const list = redPool.lanes[lane] ?? [];
      if (list.length === 0) return [];
      const remaining = list.filter((h) => !poolUsedSet.has(h)).length;
      return [{ lane, remaining, total: list.length }];
    });
  }, [redPool, rUsed, globalBans.universalBans, activeBoardHeroes]);

  const gameUnlockStatuses = useMemo(() => {
    const effectiveGb = fromTeamHistory
      ? { ...globalBans, teamAUsed: [], teamBUsed: [], universalBans: [] }
      : globalBans;
    const effectiveGames = fromTeamHistory ? [] : seriesGames;
    return [1, 2, 3, 4, 5, 6, 7].map((g) => getGameUnlockStatus(g, effectiveGb, effectiveGames));
  }, [fromTeamHistory, globalBans, seriesGames]);

  const blueTeamColumnProps = useMemo(
    () => ({
      side: "blue" as const,
      teamName: bName,
      picks: bluePicks,
      bans: blueBans,
      pickLanes,
      timedOutHeroes,
      conflictingSlots,
      editingSlot,
      banOpensDialog: isMobileViewport,
      onEditSlot: isCurrentGameLocked ? undefined : handleTeamEditSlot,
      usedHeroes: bUsed,
      usedHeroOriginGames: blueOriginGames,
      rawUsedCount: globalBans.blueSideTeam === "A" ? globalBans.teamAUsed.length : globalBans.teamBUsed.length,
      gameNumber: globalBans.gameNumber,
      poolLaneStats: bluePoolLaneStats,
      heroMap,
      currentStep,
      predictedNextPicks: assistantEnabled ? blueNextPicks : [],
      predictedNextBans: assistantEnabled ? blueNextBans : [],
      onLockHero: isCurrentGameLocked ? undefined : handleLockHeroWithTimer,
      onOpenGlobalBanForTeam: isCurrentGameLocked ? undefined : openBlueGlobalBan,
      onRemoveUsedHero: isCurrentGameLocked ? undefined : removeBlueUsedHero,
    }),
    [
      isCurrentGameLocked,
      bName,
      bluePicks,
      blueBans,
      pickLanes,
      timedOutHeroes,
      conflictingSlots,
      editingSlot,
      isMobileViewport,
      handleTeamEditSlot,
      bUsed,
      blueOriginGames,
      globalBans.blueSideTeam,
      globalBans.teamAUsed.length,
      globalBans.teamBUsed.length,
      globalBans.gameNumber,
      bluePoolLaneStats,
      heroMap,
      currentStep,
      assistantEnabled,
      blueNextPicks,
      blueNextBans,
      handleLockHeroWithTimer,
      openBlueGlobalBan,
      removeBlueUsedHero,
    ],
  );

  const redTeamColumnProps = useMemo(
    () => ({
      side: "red" as const,
      teamName: rName,
      picks: redPicks,
      bans: redBans,
      pickLanes,
      timedOutHeroes,
      conflictingSlots,
      editingSlot,
      banOpensDialog: isMobileViewport,
      onEditSlot: isCurrentGameLocked ? undefined : handleTeamEditSlot,
      usedHeroes: rUsed,
      usedHeroOriginGames: redOriginGames,
      rawUsedCount: globalBans.blueSideTeam === "A" ? globalBans.teamBUsed.length : globalBans.teamAUsed.length,
      gameNumber: globalBans.gameNumber,
      poolLaneStats: redPoolLaneStats,
      heroMap,
      currentStep,
      predictedNextPicks: assistantEnabled ? redNextPicks : [],
      predictedNextBans: assistantEnabled ? redNextBans : [],
      onLockHero: isCurrentGameLocked ? undefined : handleLockHeroWithTimer,
      onOpenGlobalBanForTeam: isCurrentGameLocked ? undefined : openRedGlobalBan,
      onRemoveUsedHero: isCurrentGameLocked ? undefined : removeRedUsedHero,
    }),
    [
      isCurrentGameLocked,
      rName,
      redPicks,
      redBans,
      pickLanes,
      timedOutHeroes,
      conflictingSlots,
      editingSlot,
      isMobileViewport,
      handleTeamEditSlot,
      rUsed,
      redOriginGames,
      globalBans.blueSideTeam,
      globalBans.teamBUsed.length,
      globalBans.teamAUsed.length,
      globalBans.gameNumber,
      redPoolLaneStats,
      heroMap,
      currentStep,
      assistantEnabled,
      redNextPicks,
      redNextBans,
      handleLockHeroWithTimer,
      openRedGlobalBan,
      removeRedUsedHero,
    ],
  );

  const promptNewMatchAfterGame7 = () => {
    setConfirmState({
      title: t("บันทึกเกมที่ 7 เรียบร้อยแล้ว"),
      message: t('ซีรีส์ "{0}" จบครบ 7 เกมแล้ว เริ่มซีรีส์ใหม่เลยไหม?', resolveSeriesName(globalBans)),
      confirmLabel: "เริ่มซีรีส์ใหม่",
      cancelLabel: "ภายหลัง",
      tone: "gold",
      onConfirm: () => {
        setConfirmState(null);
        setIsHistoryModalOpen(false);
        setNewSeriesContext({ tournament: globalBans.tournament ?? null });
      },
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Sub-header mode & series bar */}
      <div className="shrink-0 border-b border-line bg-panel/60 px-2 py-1.5 sm:px-3 xl:px-4">
        <div className="mx-auto flex max-w-[1920px] flex-wrap items-center justify-between gap-1.5 sm:flex-nowrap xl:gap-2">
          {/* Series name */}
          <div className="hidden min-w-0 flex-1 items-center gap-2 sm:flex">
            {globalBans.tournament && (
              <span title={globalBans.tournament.name} className="max-w-40 truncate border border-gold/35 bg-gold/10 px-1.5 py-0.5 text-[10px] font-semibold text-gold">
                {globalBans.tournament.name}
              </span>
            )}
            <span
              className="max-w-[200px] truncate font-display text-xs font-bold tracking-wider text-muted"
              title={resolveSeriesName(globalBans)}
            >
              {resolveSeriesName(globalBans)}
              {seriesScore.aWins + seriesScore.bWins > 0 && (
                <span className="ml-1.5 font-mono text-[11px] text-ink">
                  ({seriesScore.aWins}-{seriesScore.bWins})
                </span>
              )}
            </span>
          </div>

          {/* Right: Series/Global Ban Controls */}
          <div
            aria-label="Series and Draft Mode Controls"
            className="flex w-full shrink-0 items-center justify-between gap-1 whitespace-nowrap sm:w-auto sm:justify-end xl:gap-1.5"
          >
            <div className="flex shrink-0 items-center gap-1 xl:gap-1.5">
                <button
                  type="button"
                  onClick={() => setNewSeriesContext({ tournament: globalBans.tournament ?? null })}
                  aria-label={t("เริ่มแมตช์ / ซีรีส์ใหม่")}
                  title={t("เริ่มแมตช์ / ซีรีส์ใหม่ (แยกประวัติออกจากแมตช์เดิม)")}
                  className="flex h-8 shrink-0 items-center gap-1.5 border border-line-strong bg-panel-2 px-2 font-display text-xs font-semibold tracking-wide whitespace-nowrap text-ink transition-colors hover:border-gold/60 hover:text-gold sm:h-7"
                >
                  <PlusCircle className="h-3.5 w-3.5 shrink-0 text-gold" />
                  <span className="hidden sm:inline"><StableButtonLabel message="แมตช์ใหม่" /></span>
                </button>

                {/* Mobile & iPad Compact Game Selector Dropdown (< lg) */}
                <div className="relative inline-flex shrink-0 items-center lg:hidden">
                  <select
                    aria-label="Select Game Number"
                    value={globalBans.gameNumber}
                    onChange={(e) => {
                      const g = Number(e.target.value);
                      const unlockStatus = gameUnlockStatuses[g - 1] ?? gameUnlockStatuses[0];
                      if (!unlockStatus.isUnlocked) {
                        promptLockedGame(g);
                        return;
                      }
                      setIsFinishGameModalOpen(false);
                      selectGameNumber(g);
                    }}
                    className="h-8 w-[86px] truncate border border-line-strong bg-panel px-1.5 font-mono text-xs font-bold text-ink cursor-pointer focus:border-gold/60 focus:outline-none sm:h-7 sm:w-32 sm:px-2"
                  >
                    {[1, 2, 3, 4, 5, 6, 7].map((g, idx) => {
                      const unlockStatus = gameUnlockStatuses[idx];
                      return (
                        <option key={g} value={g} className="bg-panel text-ink py-1">
                          Game {g}
                          {g === 7 ? " (Ult)" : ""}
                          {!unlockStatus.isUnlocked && globalBans.gameNumber !== g ? t(" [ล็อก]") : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Desktop Full 7-Button Game Selector (lg+) */}
                <div className="relative hidden shrink-0 items-center border border-line bg-bg p-0.5 lg:inline-flex">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0.5 left-0.5 w-6.5 bg-ink motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out motion-reduce:transition-none"
                    style={{ transform: `translateX(${(globalBans.gameNumber - 1) * 100}%)` }}
                  />
                  {[1, 2, 3, 4, 5, 6, 7].map((g, idx) => {
                    const unlockStatus = gameUnlockStatuses[idx];
                    const isUnlocked = unlockStatus.isUnlocked;
                    const isCurrent = globalBans.gameNumber === g;

                    let buttonTitle = `Game ${g}`;
                    if (!isUnlocked) {
                      const missingStr = unlockStatus.missingGames.map((mg) => `G${mg}`).join(", ");
                      buttonTitle = t("Game {0} ถูกล็อก: ต้องจบ {1} หรือใส่ Global Ban ฝั่งละอย่างน้อย {2} ตัว (Team A: {3}/{4}, Team B: {5}/{6})", g, missingStr, unlockStatus.requiredCount, unlockStatus.aCount, unlockStatus.requiredCount, unlockStatus.bCount, unlockStatus.requiredCount);
                    } else if (g === 7) {
                      buttonTitle = t("Game 7 Ultimate Battle — รีเซ็ต Global Ban ของทั้งสองทีม");
                    } else {
                      buttonTitle = t("Game {0} (ซิงค์ Global Ban จากเกมก่อนหน้าอัตโนมัติ)", g);
                    }

                    return (
                      <button
                        key={g}
                        type="button"
                        onClick={() => {
                          if (!isUnlocked) {
                            promptLockedGame(g);
                            return;
                          }
                          setIsFinishGameModalOpen(false);
                          selectGameNumber(g);
                        }}
                        title={buttonTitle}
                        aria-current={isCurrent ? "step" : undefined}
                        className={`relative h-6 w-6.5 px-1.5 font-mono text-[11px] font-bold transition-colors focus-visible:z-10 ${
                          isCurrent
                            ? "text-bg"
                            : !isUnlocked
                              ? "cursor-not-allowed text-dim hover:bg-panel-2/40 hover:text-muted"
                              : "text-muted hover:bg-panel-2 hover:text-ink"
                        }`}
                      >
                        G{g}
                      </button>
                    );
                  })}
                </div>
              </div>

            {/* Direct 1-Tap Swap (or 2-Mode Menu when 10 picks complete), History & Record Result Actions */}
            <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
              <div ref={swapMenuRef} className="relative">
                <button
                  type="button"
                  disabled={isCurrentGameLocked}
                  onClick={handleSwapSides}
                  aria-label={t("สลับฝั่งทีม")}
                  aria-haspopup={canSwapBoardAndTeams ? "menu" : undefined}
                  aria-expanded={canSwapBoardAndTeams ? isSwapMenuOpen : undefined}
                  title={
                    isCurrentGameLocked
                      ? t("เกมนี้ถูกล็อกไว้ — ปลดล็อกก่อนสลับฝั่ง")
                      : canSwapBoardAndTeams
                        ? t("สลับฝั่ง ({0} ⇄ {1}) — เลือกสลับเฉพาะทีมหรือสลับพร้อมฮีโร่บนกระดาน", bName, rName)
                        : t("สลับฝั่งทีม ({0} ⇄ {1}) — ฮีโร่ที่แต่ละทีมเคยใช้จะย้ายฝั่งตามทีมไปอัตโนมัติ", bName, rName)
                  }
                  className={`flex h-8 shrink-0 items-center gap-1.5 border px-2 font-display text-xs font-semibold whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-35 sm:h-7 ${
                    isSwapMenuOpen
                      ? "border-gold/70 bg-gold/10 text-gold"
                      : "border-line-strong bg-panel-2 text-ink hover:border-gold/60 hover:text-gold"
                  }`}
                >
                  <ArrowLeftRight
                    className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-300 ${
                      swapCount % 2 === 1 ? "rotate-180" : "rotate-0"
                    }`}
                  />
                  <span className="hidden md:inline"><StableButtonLabel message="สลับฝั่ง" /></span>
                  {canSwapBoardAndTeams && (
                    <ChevronDown
                      className={`h-3 w-3 shrink-0 text-gold transition-transform ${
                        isSwapMenuOpen ? "rotate-180" : ""
                      }`}
                    />
                  )}
                </button>
                {isSwapMenuOpen && (
                  <div
                    role="menu"
                    aria-label={t("ตัวเลือกสลับฝั่ง")}
                    className="absolute left-1/2 top-full z-40 mt-1 w-64 max-w-[calc(100vw-1.5rem)] -translate-x-1/2 whitespace-normal border border-line-strong bg-panel p-1 shadow-2xl sm:left-auto sm:right-0 sm:translate-x-0"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleSwapTeamOnly}
                      className="flex min-h-10 w-full flex-col items-start gap-0.5 px-2.5 py-2 text-left transition-colors hover:bg-panel-2"
                    >
                      <span className="max-w-full font-display text-xs font-bold break-words text-ink">{t("สลับเฉพาะฝั่งทีม")}</span>
                      <span className="max-w-full text-[11px] leading-snug break-words text-muted">
                        {t("สลับชื่อทีม, Global Ban และ Hero Pool (ฮีโร่บนกระดานอยู่เดิม)")}
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleSwapTeamAndBoard}
                      className="mt-0.5 flex min-h-10 w-full flex-col items-start gap-0.5 border-t border-line px-2.5 py-2 text-left transition-colors hover:bg-gold/10"
                    >
                      <span className="max-w-full font-display text-xs font-bold break-words text-gold">{t("สลับทั้งทีมและฮีโร่บนกระดาน")}</span>
                      <span className="max-w-full text-[11px] leading-snug break-words text-muted">
                        {t("สลับชื่อทีม, Global Ban และย้าย Pick/Ban ทั้งหมดข้ามฝั่ง")}
                      </span>
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setIsHistoryModalOpen(true)}
                aria-label={t("ประวัติซีรีส์")}
                title={t("ดูประวัติการดราฟต์แยกตามกลุ่มซีรีส์ (บันทึกสูงสุด {0} เกมล่าสุด)", personalHistoryLimit ?? MAX_SERIES_GAMES)}
                className="flex h-8 shrink-0 items-center gap-1.5 border border-line-strong bg-panel-2 px-2 font-display text-xs font-semibold whitespace-nowrap text-ink transition-colors hover:border-gold/60 hover:text-gold sm:h-7"
              >
                <History className="h-3.5 w-3.5 shrink-0 text-muted" />
                <span className="hidden md:inline"><StableButtonLabel message="ประวัติ" /></span>
                <span
                  className={`min-w-[calc(7ch+0.5rem+2px)] border px-1 py-0.5 text-center font-mono text-[10px] font-bold leading-none tabular-nums sm:min-w-[calc(7ch+0.75rem+2px)] sm:px-1.5 ${
                    seriesGames.length > 0 ? "border-ink/40 bg-bg text-ink" : "border-line-strong bg-bg text-muted"
                  }`}
                >
                  {seriesGames.length}/{personalHistoryLimit ?? MAX_SERIES_GAMES}
                </span>
              </button>

              {isCurrentGameLocked && currentSavedGameId ? (
                <button
                  type="button"
                  onClick={() => toggleRecordedGameLock(currentSavedGameId)}
                  aria-label={t("ปลดล็อกเกมนี้")}
                  title={t("เกมนี้ล็อกอยู่ — คลิกเพื่อปลดล็อก")}
                  className="flex h-8 shrink-0 items-center gap-1.5 border border-gold/60 bg-gold/15 px-2 font-display text-xs font-bold whitespace-nowrap text-gold transition-colors hover:bg-gold hover:text-bg sm:h-7"
                >
                  <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <StableButtonLabel
                    message={RESULT_MESSAGES.locked}
                    alternatives={Object.values(RESULT_MESSAGES)}
                    className="hidden text-center sm:grid"
                  />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!globalBanConflict && (!isDraftComplete || isResultSaved)}
                  aria-disabled={globalBanConflict ? true : undefined}
                  aria-describedby={globalBanConflict ? conflictMessageId : undefined}
                  onClick={() => {
                    if (globalBanConflict) {
                      emphasizeGlobalBanConflict();
                    } else if (isPersonalHistoryBlocked) {
                      setHistoryUpgradeOpen(true);
                    } else {
                      setIsFinishGameModalOpen(true);
                    }
                  }}
                  aria-label={language === "en" ? t(resultMessage) : t("บันทึกผลเกม")}
                  title={conflictMessage ?? (
                    isResultSaved
                      ? t("บันทึกผลแล้ว (เปลี่ยนผู้ชนะได้ที่หน้าประวัติ)")
                      : isDraftComplete
                        ? t("บันทึกผลและเพิ่มฮีโร่เข้า Global Ban")
                        : t("เลือกให้ครบ 10 ตัวก่อนจบเกม ({0}/10)", bluePicks.length + redPicks.length)
                  )}
                  className={`flex h-8 shrink-0 items-center gap-1.5 border px-2 font-display text-xs font-bold whitespace-nowrap transition-colors disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-35 sm:h-7 ${
                    isResultSaved
                      ? "border-good/50 bg-good/15 text-good disabled:opacity-75"
                      : isDraftComplete
                        ? "border-gold bg-gold text-bg hover:bg-gold/90 disabled:opacity-35"
                        : "border-good/60 bg-good/15 text-good hover:bg-good hover:text-bg disabled:opacity-35"
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <StableButtonLabel
                    message={resultMessage}
                    alternatives={Object.values(RESULT_MESSAGES)}
                    className="hidden text-center sm:grid"
                  />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <ScoreBar
        blueWinRate={blueWinRate}
        isLoading={isLoading}
        currentStep={currentStep}
        currentStepIndex={currentStepIndex}
        totalSteps={totalSteps}
        league={league}
        setLeague={(nextLeague) => {
          setLeague(nextLeague);
          trackTelemetryEvent(`league_${nextLeague}` as TelemetryMetricKey);
        }}
        assistantEnabled={assistantEnabled}
        onToggleAssistant={onToggleAssistant}
        poolToggle={
          bluePoolHeroes.size > 0 || redPoolHeroes.size > 0
            ? {
                mode: poolMode,
                activeTeamName: currentStep
                  ? currentStep.action === "ban"
                    ? (activeEnemyPool?.team_name ?? (currentStep.side === "blue" ? rName : bName))
                    : (activeAllyPool?.team_name ?? (currentStep.side === "blue" ? bName : rName))
                  : undefined,
                disabled:
                  !currentStep ||
                  (currentStep.action === "ban" ? activeEnemyPoolHeroes.size === 0 : activeAllyPoolHeroes.size === 0),
                onCycle: cyclePoolMode,
              }
            : undefined
        }
        timer={{
          enabled: timer.enabled,
          preset: timer.preset,
          soundEnabled: timer.soundEnabled,
          autoLock: timer.autoLock,
          paused: timer.paused,
          secondsLeft: timer.secondsLeft,
          totalSeconds: timer.totalSeconds,
          isWarning: timer.isWarning,
          isCritical: timer.isCritical,
          isExpired: timer.isExpired,
          onToggleEnabled: () => {
            if (!timer.enabled) trackTelemetryEvent("feat_timer_start");
            timer.toggleEnabled();
          },
          onSetEnabled: timer.setEnabled,
          onTogglePaused: timer.togglePaused,
          onResetTurn: timer.resetTurnTimer,
          onSetPreset: timer.setPreset,
          onToggleSound: timer.toggleSound,
          onToggleAutoLock: timer.toggleAutoLock,
        }}
        onTimerSettingsOpenChange={setTimerSettingsOpen}
        onUndo={handleUndoWithTimer}
        onRedo={() => {
          if (!isCurrentGameLocked) redo();
        }}
        onReset={() => {
          if (isCurrentGameLocked) return;
          setIsFinishGameModalOpen(false);
          setLateHeroMap((prev) => {
            const next: typeof prev = {};
            for (const [hero, entry] of Object.entries(prev)) {
              if (entry.gameKey !== currentGameKey) next[hero] = entry;
            }
            return next;
          });
          timer.setEnabled(false);
          reset();
        }}
        canUndo={canUndo && !isCurrentGameLocked}
        canRedo={canRedo && !isCurrentGameLocked}
      />

      <Suspense fallback={null}>
      {globalBanModalCat !== null && (
        <GlobalBanModal
          heroes={heroes}
          heroMap={heroMap}
          globalBans={globalBans}
          seriesGames={fromTeamHistory ? undefined : seriesGames}
          fromTeamHistory={fromTeamHistory}
          activeBoardHeroes={activeBoardHeroes}
          initialCategory={globalBanModalCat}
          onChange={setGlobalBans}
          onSelectGameNumber={(...args) => {
            setIsFinishGameModalOpen(false);
            selectGameNumber(...args);
          }}
          onClose={() => setGlobalBanModalCat(null)}
        />
      )}

      {isHistoryModalOpen && (
        <DraftHistoryModal
          games={seriesGames}
          heroMap={heroMap}
          hasCurrentDraftActions={hasAnyAction && !isCurrentGameSavedUnchanged && !conflictMessage}
          onSaveCurrentSnapshot={() => {
            const saved = saveCurrentDraftSnapshot();
            if (saved && globalBans.gameNumber >= 7) {
              promptNewMatchAfterGame7();
            }
            return saved;
          }}
          onHistoryFullUpgrade={
            isPaidUser
              ? undefined
              : () => {
                  setIsHistoryModalOpen(false);
                  setHistoryUpgradeOpen(true);
                }
          }
          teamHistoryUsername={teamHistoryUsername}
          currentDraftSnapshot={currentDraftSnapshot}
          personalHistoryLimit={personalHistoryLimit}
          onOpenNewSeries={(tournament, options) => setNewSeriesContext({ tournament, options })}
          onAssignTournament={draft.assignSeriesTournament}
          onRenameTournament={draft.renameHistoryTournament}
          onEditSeries={draft.editHistorySeries}
          onSwitchSeries={(...args) => {
            setIsFinishGameModalOpen(false);
            switchSeries(...args);
          }}
          onLoadGame={(game, source) => {
            setIsFinishGameModalOpen(false);
            loadRecordedGame(game, { fromTeamHistory: source === "team" });
          }}
          onSetGameWinner={setRecordedGameWinner}
          onToggleGameLock={toggleRecordedGameLock}
          onImportGames={importSeriesGames}
          onDeleteGame={(...args) => {
            setIsFinishGameModalOpen(false);
            deleteRecordedGame(...args);
          }}
          onDeleteGroup={(...args) => {
            setIsFinishGameModalOpen(false);
            deleteSeriesGroup(...args);
          }}
          onClearAllSeries={() => {
            setIsFinishGameModalOpen(false);
            clearAllHistory();
          }}
          onClose={() => setIsHistoryModalOpen(false)}
        />
      )}

      {newSeriesContext && (
        <NewSeriesModal
          currentSeriesName={resolveSeriesName(globalBans)}
          existingSeriesNames={existingSeriesNames}
          savedPoolTeamNames={savedPoolTeamNames}
          defaultTeamA={globalBans.teamAName}
          defaultTeamB={globalBans.teamBName}
          tournaments={newSeriesContext.options ?? listTournaments(seriesGames)}
          initialTournament={newSeriesContext.tournament}
          hasCurrentActions={hasAnyAction && !fromTeamHistory}
          onConfirm={(...args) => {
            setIsFinishGameModalOpen(false);
            startNewSeries(...args);
          }}
          onClose={() => setNewSeriesContext(null)}
        />
      )}

      {isPoolsModalOpen && teamHistoryUsername && (
        <HeroPoolsModal
          heroes={heroes}
          heroMap={heroMap}
          initialTeamName={bName}
          onChanged={(overview) => setHeroPoolOverview(overview)}
          onClose={() => onCloseDraftTool?.()}
        />
      )}

      {activeSlotEditor?.view === "actions" && editingHero && (
        <DraftPickActions
          heroName={editingHero}
          hero={heroMap.get(editingHero)}
          pickNumber={activeSlotEditor.slot.index + 1}
          onChoose={(view) => {
            if (view === "hero") {
              openHeroReplace(activeSlotEditor.slot);
            } else {
              setSlotEditor({ ...activeSlotEditor, view });
            }
          }}
          onClose={closeSlotEditor}
        />
      )}

      {isMobileViewport && activeSlotEditor?.view === "hero" && editingHero && (
        <HeroPickerModal
          heroes={heroes}
          currentHero={editingHero}
          heroMap={heroMap}
          title={t(
            activeSlotEditor.slot.action === "pick" ? "แก้ Pick {0} ({1})" : "แก้ Ban {0} ({1})",
            activeSlotEditor.slot.index + 1,
            displayName(editingHero),
          )}
          mobileSheet
          unavailableHeroes={getUnavailableHeroesForSlot(activeSlotEditor.slot)}
          onSelect={(hero) => {
            if (!replaceHero(activeSlotEditor.slot, hero)) return false;
            trackTelemetryEvent("feat_replace_hero");
            setLateHeroMap((prev) => {
              if (!prev[editingHero]) return prev;
              const next = { ...prev };
              delete next[editingHero];
              return next;
            });
            return true;
          }}
          onClose={closeSlotEditor}
        />
      )}

      {activeSlotEditor?.view === "lane" && editingHero && (
        <PickLaneModal
          heroName={editingHero}
          side={activeSlotEditor.slot.side}
          teamName={activeSlotEditor.slot.side === "blue" ? bName : rName}
          hero={heroMap.get(editingHero)}
          currentLane={pickLanes[editingHero]}
          lockedByLane={Object.fromEntries(
            (activeSlotEditor.slot.side === "blue" ? bluePicks : redPicks)
              .filter((h) => h !== editingHero && pickLanes[h])
              .map((h) => [pickLanes[h] as LaneKey, h]),
          )}
          onSelectLane={(lane) => {
            trackTelemetryEvent("feat_pick_lane");
            setPickLane(editingHero, lane);
          }}
          onClose={closeSlotEditor}
        />
      )}

      {isFinishGameModalOpen && isDraftComplete && !conflictMessage && (
        <FinishGameModal
          gameNumber={globalBans.gameNumber}
          seriesName={resolveSeriesName(globalBans)}
          blueTeamName={bName}
          redTeamName={rName}
          blueSideTeam={globalBans.blueSideTeam}
          blueWins={globalBans.blueSideTeam === "A" ? seriesScore.aWins : seriesScore.bWins}
          redWins={globalBans.blueSideTeam === "A" ? seriesScore.bWins : seriesScore.aWins}
          bluePickCount={bluePicks.length}
          redPickCount={redPicks.length}
          isDraftComplete={isDraftComplete}
          onConfirmWinner={(winner) => {
            timer.setEnabled(false);
            const saved = recordGameToSeries(false, winner);
            setIsFinishGameModalOpen(false);
            if (!saved && isPersonalHistoryBlocked) {
              setHistoryUpgradeOpen(true);
              return;
            }
            if (saved && globalBans.gameNumber >= 7) {
              promptNewMatchAfterGame7();
            }
          }}
          onClose={() => setIsFinishGameModalOpen(false)}
        />
      )}
      </Suspense>

      {historyUpgradeOpen && (
        <Modal
          labelledBy={historyUpgradeTitleId}
          className="max-w-lg overflow-hidden"
          onClose={() => setHistoryUpgradeOpen(false)}
        >
          {(requestClose) => (
            <>
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-gold" aria-hidden="true" />
                  <h2 id={historyUpgradeTitleId} className="font-display text-sm font-bold tracking-wider text-ink sm:text-base">
                    {t("ประวัติเกมเต็มแล้ว")}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => requestClose()}
                  aria-label={t("ปิด")}
                  className="inline-flex h-8 w-8 items-center justify-center text-dim hover:bg-panel-2 hover:text-ink"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-4 p-6 text-center">
                <Trophy className="mx-auto size-10 text-gold" aria-hidden="true" />
                <p className="font-display text-base font-bold text-ink">
                  {!isAuthenticated
                    ? t("บันทึกประวัติแบบ Guest ครบ {0} เกมแล้ว", effectiveHistoryLimit)
                    : t("ประวัติส่วนตัวแบบ Free ครบ {0} เกมแล้ว", effectiveHistoryLimit)}
                </p>
                <p className="mx-auto max-w-md text-xs text-muted">
                  {!isAuthenticated
                    ? t("เข้าสู่ระบบฟรีเพื่อปลดล็อก 14 เกม + ซิงก์ข้ามอุปกรณ์ หรืออัปเกรดเพื่อเก็บ 500 เกม")
                    : t("อัปเกรดเป็น Pro, Duo หรือ Business เพื่อเก็บ 500 เกม, Hero Pools 50 ชุด และ Scrim Analytics")}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                  {!isAuthenticated && onOpenAuthModal ? (
                    <button
                      type="button"
                      onClick={() => requestClose(() => onOpenAuthModal())}
                      className="inline-flex min-h-10 items-center justify-center border border-gold bg-gold px-5 font-display text-xs font-bold text-bg hover:bg-gold/90"
                    >
                      <StableButtonLabel message="เข้าสู่ระบบ" />
                    </button>
                  ) : (
                    <a
                      href="#plans"
                      onClick={() => requestClose()}
                      className="inline-flex min-h-10 items-center justify-center border border-gold bg-gold px-5 font-display text-xs font-bold text-bg hover:bg-gold/90"
                    >
                      <StableButtonLabel message="ดูแพ็ก" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => requestClose(() => setIsHistoryModalOpen(true))}
                    className="inline-flex min-h-10 items-center justify-center border border-line-strong bg-panel-2 px-4 font-display text-xs font-semibold text-ink hover:border-gold/60 hover:text-gold"
                  >
                    <StableButtonLabel message="จัดการประวัติ" />
                  </button>
                </div>
              </div>
            </>
          )}
        </Modal>
      )}

      {confirmState && (
        <ConfirmDialog
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          cancelLabel={confirmState.cancelLabel}
          tone={confirmState.tone}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}

      {editingSlot && (
        <div
          aria-hidden="true"
          data-replace-backdrop
          className="fixed inset-0 z-30 bg-black/65 backdrop-blur-[1px]"
        />
      )}

      <main className="mx-auto flex min-h-0 w-full max-w-[1920px] flex-1 flex-col gap-1 overflow-hidden px-2 py-1.5 sm:gap-1.5 sm:px-3 sm:py-2">
        {conflictMessage && globalBanConflict && (
          <div className="shrink-0">
            <Alert tone="warning" className="max-sm:px-2 max-sm:py-1">
              <div className="flex items-center justify-between gap-2 sm:flex-wrap">
                <span id={conflictMessageId} className="sr-only sm:not-sr-only">
                  <strong>{conflictCountLabel}</strong>{" · "}{conflictMessage}
                </span>
                <span aria-hidden="true" className="flex min-w-0 items-center gap-1 sm:hidden">
                  <span className="shrink-0">Global Ban ·</span>
                  <strong className="shrink-0">{conflictCountLabel}</strong>
                  <span className="truncate">
                    {"· "}{globalBanConflict.slot.action === "pick" ? "Pick" : "Ban"} {globalBanConflict.slot.index + 1}
                    {" ("}{displayName(globalBanConflict.hero)}{")"}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={t("แก้เทิร์นนี้")}
                  aria-haspopup={isMobileViewport ? "dialog" : undefined}
                  onClick={() => openHeroReplace(globalBanConflict.slot)}
                  className="min-h-7 min-w-12 shrink-0 border border-gold/50 bg-gold/10 px-2 font-bold text-gold hover:bg-gold/20 sm:min-h-6"
                >
                  <StableButtonLabel message="แก้" className="sm:hidden" />
                  <StableButtonLabel message="แก้เทิร์นนี้" className="hidden sm:inline-grid" />
                </button>
              </div>
            </Alert>
          </div>
        )}
        {error && !conflictMessage && (
          <div className="shrink-0">
            <Alert>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{translateMessage(t, error)}</span>
                <button
                  type="button"
                  onClick={retryPredict}
                  className="inline-flex min-h-7 items-center border border-red/50 bg-red/15 px-2.5 font-display text-[11px] font-bold text-ink transition-colors hover:bg-red hover:text-bg"
                >
                  <StableButtonLabel message="ลองใหม่" />
                </button>
              </div>
            </Alert>
          </div>
        )}
        {syncError && (
          <div className="shrink-0">
            <Alert tone="warning">{translateMessage(t, syncError)}</Alert>
          </div>
        )}
        {heroesFallback && (
          <div className="shrink-0">
            <Alert tone="warning">
              {t("โหลดข้อมูลฮีโร่จากเซิร์ฟเวอร์ไม่ได้ — ใช้รายชื่อสำรอง บทบาทและเลนอาจไม่ถูกต้อง")}
            </Alert>
          </div>
        )}

        {/* Compact Top Matchup HUD — Pinned on Mobile (except in full teams view) & iPad (< lg) */}
        <div
          className={`shrink-0 grid-cols-2 gap-1.5 sm:gap-2 lg:hidden ${
            mobileView === "teams" ? "hidden md:grid" : "grid"
          }`}
        >
          <div
            key={`compact-blue-${swapCount}`}
            className={`min-w-0 transition-opacity ${
              editingSlot
                ? editingSlot.side === "blue"
                  ? "relative z-40 pointer-events-none"
                  : "opacity-45 pointer-events-none"
                : ""
            } ${!editingSlot && swapCount > 0 ? "animate-side-swap-flash" : ""}`}
          >
            <TeamColumn variant="compact" {...blueTeamColumnProps} />
          </div>
          <div
            key={`compact-red-${swapCount}`}
            className={`min-w-0 transition-opacity ${
              editingSlot
                ? editingSlot.side === "red"
                  ? "relative z-40 pointer-events-none"
                  : "opacity-45 pointer-events-none"
                : ""
            } ${!editingSlot && swapCount > 0 ? "animate-side-swap-flash" : ""}`}
          >
            <TeamColumn variant="compact" {...redTeamColumnProps} />
          </div>
        </div>

        {/* Mobile Full Teams & Global Ban View (< md when mobileView === "teams") */}
        {mobileView === "teams" && (
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto md:hidden">
            <div
              key={`mobile-blue-${swapCount}`}
              className={`flex min-h-0 min-w-0 flex-col ${swapCount > 0 ? "animate-side-swap-flash" : ""}`}
            >
              <TeamColumn variant="full" {...blueTeamColumnProps} />
            </div>
            <div
              key={`mobile-red-${swapCount}`}
              className={`flex min-h-0 min-w-0 flex-col ${swapCount > 0 ? "animate-side-swap-flash" : ""}`}
            >
              <TeamColumn variant="full" {...redTeamColumnProps} />
            </div>
          </div>
        )}

        {/* Main Single-Screen Workspace (Mobile Draft/AI, iPad Split-View, Laptop 3-Column) */}
        <div
          className={`min-h-0 flex-1 flex-col gap-2 md:grid md:grid-cols-12 md:gap-3 lg:grid-cols-[240px_minmax(0,1fr)_240px] lg:gap-3 xl:grid-cols-[300px_minmax(0,1fr)_300px] xl:gap-3.5 2xl:grid-cols-[340px_minmax(0,1fr)_340px] ${
            mobileView === "teams" ? "hidden md:grid" : "flex"
          }`}
        >
          {/* Laptop / Desktop Left Column: Blue Team Full Board */}
          <div
            key={`desktop-blue-${swapCount}`}
            className={`hidden min-h-0 flex-col transition-opacity lg:order-1 lg:flex ${
              editingSlot
                ? editingSlot.side === "blue"
                  ? "relative z-40 pointer-events-none"
                  : "opacity-45 pointer-events-none"
                : ""
            } ${!editingSlot && swapCount > 0 ? "animate-side-swap-flash" : ""}`}
          >
            <TeamColumn variant="full" {...blueTeamColumnProps} />
          </div>

          {/* Laptop / Desktop Right Column: Red Team Full Board */}
          <div
            key={`desktop-red-${swapCount}`}
            className={`hidden min-h-0 flex-col transition-opacity lg:order-3 lg:flex ${
              editingSlot
                ? editingSlot.side === "red"
                  ? "relative z-40 pointer-events-none"
                  : "opacity-45 pointer-events-none"
                : ""
            } ${!editingSlot && swapCount > 0 ? "animate-side-swap-flash" : ""}`}
          >
            <TeamColumn variant="full" {...redTeamColumnProps} />
          </div>

          {/* Center / Split-View Workspace: AI Suggestions + Hero Grid */}
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 md:col-span-12 md:grid md:grid-cols-12 md:gap-2.5 lg:order-2 lg:col-span-1 lg:flex lg:flex-col lg:gap-2">
            {/* Mobile live AI ribbon & draft completion summary */}
            {mobileView === "draft" && assistantEnabled && (
              <div
                aria-hidden={Boolean(editingSlot)}
                className={`shrink-0 transition-opacity md:hidden ${
                  editingSlot ? "pointer-events-none select-none opacity-30" : ""
                }`}
              >
                <AiPanel
                  variant="ribbon"
                  recommendations={recommendations}
                  banUnlockedHeroes={banUnlockedHeroes}
                  missingAllyLanes={missingAllyLanes}
                  currentStep={currentStep}
                  heroMap={heroMap}
                  isLoading={isLoading}
                  blueWinRate={blueWinRate}
                  winHistory={winHistory}
                  allowLock={!editingSlot && !isCurrentGameLocked}
                  onLockHero={handleSelectOrLockHero}
                  allyPoolName={activeAllyPool?.team_name}
                  allyPoolHeroes={activeAllyPoolHeroes}
                  allyPoolHeroLanes={effectivePoolHeroLanes}
                  enemyPoolName={activeEnemyPool?.team_name}
                  enemyPoolHeroes={activeEnemyPoolHeroes}
                  filterByAllyPool={poolMode === "high"}
                />
              </div>
            )}

            {/* Full AI Panel: Shown on Mobile 'ai' view, iPad left pane (5 cols), and Laptop top deck */}
            {assistantEnabled ? (
              <div
                aria-hidden={Boolean(editingSlot)}
                className={`min-h-0 flex-col transition-opacity md:col-span-5 md:flex lg:shrink-0 ${
                  mobileView === "ai" ? "flex flex-1" : "hidden"
                } ${editingSlot ? "pointer-events-none select-none opacity-30" : ""}`}
              >
                <AiPanel
                  variant="full"
                  recommendations={recommendations}
                  banUnlockedHeroes={banUnlockedHeroes}
                  missingAllyLanes={missingAllyLanes}
                  currentStep={currentStep}
                  heroMap={heroMap}
                  isLoading={isLoading}
                  blueWinRate={blueWinRate}
                  winHistory={winHistory}
                  allowLock={!editingSlot && !isCurrentGameLocked}
                  onLockHero={handleSelectOrLockHero}
                  allyPoolName={activeAllyPool?.team_name}
                  allyPoolHeroes={activeAllyPoolHeroes}
                  allyPoolHeroLanes={effectivePoolHeroLanes}
                  enemyPoolName={activeEnemyPool?.team_name}
                  enemyPoolHeroes={activeEnemyPoolHeroes}
                  filterByAllyPool={poolMode === "high"}
                />
              </div>
            ) : (
              mobileView === "ai" && (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 border border-line bg-panel px-4 py-8 text-center md:hidden">
                  <Sparkles className="size-7 text-dim" aria-hidden="true" />
                  <p className="font-display text-sm font-bold text-ink">{t("ปิดตัวช่วยอยู่")}</p>
                  <p className="max-w-xs text-xs text-muted">
                    {t("เปิดเพื่อดูฮีโร่แนะนำและโอกาสชนะ")}
                  </p>
                  {onToggleAssistant && (
                    <button
                      type="button"
                      onClick={onToggleAssistant}
                      className="inline-flex min-h-8 items-center gap-1.5 border border-gold bg-gold px-3 font-display text-xs font-bold text-bg"
                    >
                      <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
                      <StableButtonLabel message="เปิดตัวช่วย" />
                    </button>
                  )}
                </div>
              )
            )}

            {/* Hero Grid: Shown on Mobile 'draft' view, iPad right pane (7/12 cols), and Laptop bottom pane */}
            <div
              ref={heroGridSpotlightRef}
              className={`min-h-0 flex-1 flex-col md:flex ${assistantEnabled ? "md:col-span-7" : "md:col-span-12"} ${
                mobileView === "draft" ? "flex" : "hidden"
              } ${editingSlot ? "relative z-40" : ""}`}
            >
              <HeroGrid
                ref={searchRef}
                heroes={heroes}
                unavailableHeroes={activeUnavailableHeroes}
                blueUsedHeroes={bUsed}
                redUsedHeroes={rUsed}
                universalBans={globalBans.universalBans}
                blueTeamName={bName}
                redTeamName={rName}
                recommendedRanks={editingSlot ? EMPTY_RECOMMENDED_RANKS : recommendedRanks}
                missingAllyLanes={editingSlot ? EMPTY_MISSING_LANES : assistantEnabled ? missingAllyLanes : EMPTY_MISSING_LANES}
                allyPoolHeroLanes={editingSlot ? undefined : effectivePoolHeroLanes}
                currentStep={editingSlotStep}
                allowLock={!isCurrentGameLocked}
                isLoading={assistantEnabled && isLoading}
                isHeroesLoading={isHeroesLoading}
                compactFiltersOnShortScreens
                replacingHero={editingSlot ? (editingHero ?? null) : null}
                laneResetKey={laneResetKey}
                replaceHeader={
                  editingSlot && editingHero ? (
                    <div
                      role="status"
                      aria-live="polite"
                      className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gold/50 bg-gold/12 px-2.5 py-2 sm:px-3"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex shrink-0 items-center gap-1.5">
                          <div className="size-8 overflow-hidden border border-gold bg-bg sm:size-9">
                            <HeroPortrait name={editingHero} hero={heroMap.get(editingHero)} />
                          </div>
                          <ArrowRight className="size-3.5 shrink-0 text-gold" aria-hidden="true" />
                          <div className="grid size-8 place-items-center border border-dashed border-gold bg-gold/15 font-mono text-sm font-bold text-gold animate-pulse sm:size-9">
                            ?
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`shrink-0 border px-1 py-0.2 font-mono text-[9px] font-bold tracking-wider ${
                                editingSlot.side === "blue"
                                  ? "border-blue/50 bg-blue/15 text-blue"
                                  : "border-red/50 bg-red/15 text-red"
                              }`}
                            >
                              {editingSlot.side === "blue" ? "BLUE" : "RED"}
                            </span>
                            <span className="truncate font-display text-xs font-bold text-gold sm:text-sm">
                              {t(
                                editingSlot.action === "pick" ? "แก้ Pick {0} ({1})" : "แก้ Ban {0} ({1})",
                                editingSlot.index + 1,
                                displayName(editingHero),
                              )}
                            </span>
                          </div>
                          <div className="truncate text-[11px] text-ink/85">
                            {t("เลือกฮีโร่ใหม่จากตารางด้านล่าง หรือกด Esc เพื่อยกเลิก")}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {editingSlot.action === "pick" && (
                          <button
                            type="button"
                            onClick={() => setSlotEditor({ slot: editingSlot, view: "lane" })}
                            className="min-h-7 border border-line-strong bg-panel px-2.5 font-display text-[11px] font-bold text-ink transition-colors hover:border-gold/60 hover:text-gold"
                          >
                            <StableButtonLabel message="เปลี่ยนเลน" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={closeSlotEditor}
                          className="inline-flex min-h-7 items-center gap-1 border border-gold/60 bg-panel px-2.5 font-display text-[11px] font-bold text-gold transition-colors hover:bg-gold hover:text-bg"
                        >
                          <X className="size-3.5 shrink-0" aria-hidden="true" />
                          <StableButtonLabel message="ยกเลิก" />
                        </button>
                      </div>
                    </div>
                  ) : null
                }
                onLockHero={handleSelectOrLockHero}
              />
            </div>
          </div>
        </div>
      </main>

      {/* Mobile App Bottom Navigation Bar (< md) */}
      <footer
        aria-label={t("มุมมองมือถือ")}
        className="grid shrink-0 grid-cols-3 border-t border-line bg-panel md:hidden"
      >
        <button
          type="button"
          onClick={() => setMobileView("draft")}
          className={`${MOBILE_TAB_CLASS} ${
            mobileView === "draft"
              ? "border-t-2 border-gold bg-gold/10 text-gold"
              : "border-t-2 border-transparent text-muted hover:text-ink"
          }`}
        >
          <LayoutGrid className="h-4 w-4 shrink-0 sm:h-4.5 sm:w-4.5" />
          <span className="min-w-0 truncate text-center sm:w-full">
            <StableButtonLabel message="ฮีโร่" /> ({heroes.length})
          </span>
        </button>

        <button
          type="button"
          onClick={() => setMobileView("ai")}
          className={`${MOBILE_TAB_CLASS} ${
            mobileView === "ai"
              ? "border-t-2 border-gold bg-gold/10 text-gold"
              : "border-t-2 border-transparent text-muted hover:text-ink"
          }`}
        >
          <Sparkles className="h-4 w-4 shrink-0 sm:h-4.5 sm:w-4.5" />
          <span className="min-w-0 truncate text-center sm:w-full">
            {!assistantEnabled
              ? t("ปิดตัวช่วยอยู่")
              : recommendations[0]
                ? `AI #1: ${displayName(recommendations[0].hero_name)}`
                : t("วิเคราะห์ AI")}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setMobileView("teams")}
          aria-label={`${t("กระดาน & แบน (")}${bUsed.length + rUsed.length})`}
          className={`${MOBILE_TAB_CLASS} ${
            mobileView === "teams"
              ? "border-t-2 border-gold bg-gold/10 text-gold"
              : "border-t-2 border-transparent text-muted hover:text-ink"
          }`}
        >
          <Users className="h-4 w-4 shrink-0 sm:h-4.5 sm:w-4.5" />
          <span className="min-w-0 truncate text-center sm:hidden">
            <StableButtonLabel message="กระดาน" /> ({bUsed.length + rUsed.length})
          </span>
          <span className="hidden w-full truncate text-center sm:block">
            <StableButtonLabel message="กระดาน & แบน (" />{bUsed.length + rUsed.length})
          </span>
        </button>
      </footer>
    </div>
  );
}

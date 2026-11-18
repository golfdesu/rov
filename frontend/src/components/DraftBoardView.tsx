import {
  ArrowLeftRight,
  CheckCircle2,
  History,
  LayoutGrid,
  PlusCircle,
  Sparkles,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_SERIES_GAMES, type useDraft } from "../hooks/useDraft";
import type { LaneKey } from "../types/draft";
import {
  blueTeamName,
  blueUsedHeroes,
  getGameSeriesGroup,
  getGameUnlockStatus,
  getMaxUnlockedGame,
  getSeriesScore,
  heroOriginGameMap,
  redTeamName,
  redUsedHeroes,
  resolveSeriesName,
} from "../utils/draft";
import { displayName } from "../utils/heroNames";
import { AiPanel } from "./AiPanel";
import { Alert } from "./Alert";
import { ConfirmDialog } from "./ConfirmDialog";
import { DraftHistoryModal } from "./DraftHistoryModal";
import { FinishGameModal } from "./FinishGameModal";
import { type GlobalBanCategoryKey, GlobalBanModal } from "./GlobalBanModal";
import { HeroGrid } from "./HeroGrid";
import { NewSeriesModal } from "./NewSeriesModal";
import { PickLaneModal } from "./PickLaneModal";
import { ScoreBar } from "./ScoreBar";
import { TeamColumn } from "./TeamColumn";

export type MobileDraftView = "draft" | "ai" | "teams";

export interface DraftBoardViewProps {
  draft: ReturnType<typeof useDraft>;
  isActiveTab: boolean;
  disableShortcuts?: boolean;
}

export function DraftBoardView({
  draft,
  isActiveTab,
  disableShortcuts = false,
}: DraftBoardViewProps) {
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
    startNewSeries,
    switchSeries,
    loadRecordedGame,
    deleteRecordedGame,
    deleteSeriesGroup,
    clearAllHistory,
    swapTeamSides,
    recordGameToSeries,
    setRecordedGameWinner,
    unavailableHeroes,
    league,
    setLeague,
    useLookahead,
    setUseLookahead,
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
    heroesFallback,
    lockHero,
    undo,
    redo,
    reset,
    canUndo,
    canRedo,
  } = draft;

  const searchRef = useRef<HTMLInputElement>(null);
  const [mobileView, setMobileView] = useState<MobileDraftView>("draft");
  const [globalBanModalCat, setGlobalBanModalCat] = useState<GlobalBanCategoryKey | null>(null);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isNewSeriesModalOpen, setIsNewSeriesModalOpen] = useState(false);
  const [isFinishGameModalOpen, setIsFinishGameModalOpen] = useState(false);
  const [editingPickLane, setEditingPickLane] = useState<{ heroName: string; side: "blue" | "red" } | null>(null);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    tone?: "gold" | "danger";
    onConfirm: () => void;
  } | null>(null);
  const [swapCount, setSwapCount] = useState(0);

  const handleSwapSides = () => {
    swapTeamSides();
    setSwapCount((c) => c + 1);
  };

  const bUsed = useMemo(() => blueUsedHeroes(globalBans), [globalBans]);
  const rUsed = useMemo(() => redUsedHeroes(globalBans), [globalBans]);
  const bName = blueTeamName(globalBans);
  const rName = redTeamName(globalBans);
  const seriesScore = useMemo(
    () => getSeriesScore(seriesGames, resolveSeriesName(globalBans)),
    [seriesGames, globalBans],
  );
  const blueCategoryKey: GlobalBanCategoryKey = globalBans.blueSideTeam === "A" ? "teamAUsed" : "teamBUsed";
  const redCategoryKey: GlobalBanCategoryKey = globalBans.blueSideTeam === "A" ? "teamBUsed" : "teamAUsed";

  const originMap = useMemo(
    () => heroOriginGameMap(seriesGames, resolveSeriesName(globalBans)),
    [seriesGames, globalBans],
  );
  const blueOriginGames = globalBans.blueSideTeam === "A" ? originMap.teamAGameByHero : originMap.teamBGameByHero;
  const redOriginGames = globalBans.blueSideTeam === "A" ? originMap.teamBGameByHero : originMap.teamAGameByHero;

  const promptLockedGame = (g: number) => {
    const unlockStatus = getGameUnlockStatus(g, globalBans, seriesGames);
    const missingStr = unlockStatus.missingGames.map((mg) => `Game ${mg}`).join(", ");
    const teamAName = globalBans.teamAName || "Team A";
    const teamBName = globalBans.teamBName || "Team B";
    setConfirmState({
      title: `Game ${g} ยังไม่ปลดล็อก`,
      message: `เงื่อนไขการลัดไป Game ${g}:\n• ต้องบันทึกผล ${missingStr} ให้เสร็จก่อน หรือ\n• ใส่ Global Ban ของทั้งสองทีมอย่างน้อยฝั่งละ ${unlockStatus.requiredCount} ตัวละคร\n\nสถานะปัจจุบัน:\n• ${teamAName}: ${unlockStatus.aCount}/${unlockStatus.requiredCount} ตัว\n• ${teamBName}: ${unlockStatus.bCount}/${unlockStatus.requiredCount} ตัว\n\nต้องการเปิดหน้าต่าง Global Ban เพื่อตั้งค่าฮีโร่ทันทีหรือไม่?`,
      confirmLabel: "เปิด Global Ban",
      cancelLabel: "ปิด",
      tone: "gold",
      onConfirm: () => {
        setConfirmState(null);
        setGlobalBanModalCat(blueCategoryKey);
      },
    });
  };

  const removeUsedHero = (catKey: "teamAUsed" | "teamBUsed", heroName: string) => {
    const candidateState = {
      ...globalBans,
      [catKey]: globalBans[catKey].filter((n) => n !== heroName),
    };
    const statusAfter = getGameUnlockStatus(globalBans.gameNumber, candidateState, seriesGames);
    if (globalBans.gameNumber > 1 && !statusAfter.isUnlocked) {
      const maxUnlocked = getMaxUnlockedGame(candidateState, seriesGames);
      setConfirmState({
        title: `ยืนยันการลบ ${displayName(heroName)}?`,
        message: `การลบ ${displayName(heroName)} จะทำให้จำนวน Global Ban ไม่ครบตามเงื่อนไขของ Game ${globalBans.gameNumber} (ต้องมีอย่างน้อยฝั่งละ ${statusAfter.requiredCount} ตัว)\n\nระบบจะย้อนกลับไปยัง Game ${maxUnlocked} อัตโนมัติ`,
        confirmLabel: `ย้อนไป Game ${maxUnlocked}`,
        cancelLabel: "ยกเลิก",
        tone: "danger",
        onConfirm: () => {
          setConfirmState(null);
          setIsFinishGameModalOpen(false);
          selectGameNumber(maxUnlocked, candidateState, true);
        },
      });
      return;
    }
    setGlobalBans(candidateState);
  };

  const recommendedRanks = useMemo(
    () => new Map(recommendations.slice(0, 10).map((r) => [r.hero_name, r.rank])),
    [recommendations],
  );

  const hasAnyAction = bluePicks.length + redPicks.length + blueBans.length + redBans.length > 0;
  const isDraftComplete = currentStep === null;
  const activeBoardHeroes = useMemo(
    () => new Set([...bluePicks, ...redPicks, ...blueBans, ...redBans]),
    [bluePicks, redPicks, blueBans, redBans],
  );
  const existingSeriesNames = useMemo(
    () => Array.from(new Set(seriesGames.map(getGameSeriesGroup).filter(Boolean))),
    [seriesGames],
  );
  const blueWins = globalBans.blueSideTeam === "A" ? seriesScore.aWins : seriesScore.bWins;
  const redWins = globalBans.blueSideTeam === "A" ? seriesScore.bWins : seriesScore.aWins;

  // Keyboard shortcuts: "/" focus search, Enter lock top suggestion, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo
  useEffect(() => {
    if (
      !isActiveTab ||
      disableShortcuts ||
      globalBanModalCat !== null ||
      isHistoryModalOpen ||
      isNewSeriesModalOpen ||
      isFinishGameModalOpen ||
      editingPickLane !== null ||
      confirmState !== null
    ) {
      return;
    }
    function onKey(e: KeyboardEvent) {
      const typing =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement;
      if (typing) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (
        e.key === "Enter" &&
        !(e.target instanceof HTMLButtonElement) &&
        !(e.target instanceof HTMLAnchorElement) &&
        !(e.target instanceof HTMLElement && e.target.getAttribute("role") === "button")
      ) {
        const top = recommendations[0];
        if (top && currentStep && !isLoading && !unavailableHeroes.has(top.hero_name)) lockHero(top.hero_name);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    isActiveTab,
    disableShortcuts,
    globalBanModalCat,
    isHistoryModalOpen,
    isNewSeriesModalOpen,
    isFinishGameModalOpen,
    editingPickLane,
    confirmState,
    undo,
    redo,
    lockHero,
    recommendations,
    currentStep,
    isLoading,
    unavailableHeroes,
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Sub-header series bar with compact global ban controls */}
      <div className="shrink-0 border-b border-line bg-panel/60 px-2 py-1.5 sm:px-3 xl:px-4">
        <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-1.5 xl:gap-2">
          {/* Left: Series Name (hidden on < sm so all 5 series controls stay comfortably visible on iPhone) */}
          <div className="hidden min-w-0 shrink-0 items-center gap-2 sm:flex">
            <span
              className="max-w-[220px] truncate font-display text-xs font-bold tracking-wider text-muted"
              title={globalBans.seriesName || `${bName} vs ${rName}`}
            >
              {globalBans.seriesName || `${bName} vs ${rName}`}
              {seriesScore.aWins + seriesScore.bWins > 0 && (
                <span className="ml-1.5 font-mono text-[11px] text-ink">
                  ({globalBans.seriesName ? seriesScore.aWins : blueWins}-
                  {globalBans.seriesName ? seriesScore.bWins : redWins})
                </span>
              )}
            </span>
          </div>

          {/* Right: Series & Global Ban Controls */}
          <div
            aria-label="Series and Global Ban Controls"
            className="flex w-full shrink-0 items-center justify-between gap-1 whitespace-nowrap sm:w-auto sm:justify-end xl:gap-1.5"
          >
            <div className="flex shrink-0 items-center gap-1 xl:gap-1.5">
              <button
                type="button"
                onClick={() => setIsNewSeriesModalOpen(true)}
                aria-label="เริ่มแมตช์ / ซีรีส์ใหม่"
                title="เริ่มแมตช์ / ซีรีส์ใหม่ (แยกประวัติออกจากแมตช์เดิม)"
                className="flex h-8 shrink-0 items-center gap-1.5 border border-gold bg-gold px-2 font-display text-xs font-bold tracking-wide whitespace-nowrap text-bg transition-colors hover:bg-gold/90 sm:h-7"
              >
                <PlusCircle className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">+ แมตช์ใหม่</span>
              </button>

              {/* Mobile & iPad Compact Game Selector Dropdown (< lg) */}
              <div className="relative inline-flex shrink-0 items-center lg:hidden">
                <select
                  aria-label="Select Game Number"
                  value={globalBans.gameNumber}
                  onChange={(e) => {
                    const g = Number(e.target.value);
                    const unlockStatus = getGameUnlockStatus(g, globalBans, seriesGames);
                    if (!unlockStatus.isUnlocked) {
                      promptLockedGame(g);
                      return;
                    }
                    setIsFinishGameModalOpen(false);
                    selectGameNumber(g);
                  }}
                  className="h-8 w-[86px] max-w-[86px] truncate border border-line bg-panel px-1.5 font-mono text-xs font-bold text-gold cursor-pointer focus:border-gold/60 focus:outline-none sm:h-7 sm:w-auto sm:max-w-none sm:px-2"
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((g) => {
                    const unlockStatus = getGameUnlockStatus(g, globalBans, seriesGames);
                    return (
                      <option key={g} value={g} className="bg-panel text-ink py-1">
                        Game {g}
                        {g === 7 ? " (Ult)" : ""}
                        {!unlockStatus.isUnlocked && globalBans.gameNumber !== g ? " [ล็อก]" : ""}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Desktop Full 7-Button Game Selector (lg+) */}
              <div className="hidden lg:inline-flex shrink-0 items-center border border-line bg-bg p-0.5">
                {[1, 2, 3, 4, 5, 6, 7].map((g) => {
                  const unlockStatus = getGameUnlockStatus(g, globalBans, seriesGames);
                  const isUnlocked = unlockStatus.isUnlocked;
                  const isCurrent = globalBans.gameNumber === g;

                  let buttonTitle = `Game ${g}`;
                  if (!isUnlocked) {
                    const missingStr = unlockStatus.missingGames.map((mg) => `G${mg}`).join(", ");
                    buttonTitle = `Game ${g} ถูกล็อก: ต้องจบ ${missingStr} หรือใส่ Global Ban ฝั่งละอย่างน้อย ${unlockStatus.requiredCount} ตัว (Team A: ${unlockStatus.aCount}/${unlockStatus.requiredCount}, Team B: ${unlockStatus.bCount}/${unlockStatus.requiredCount})`;
                  } else if (g === 7) {
                    buttonTitle = "Game 7 Ultimate Battle — รีเซ็ต Global Ban ของทั้งสองทีม";
                  } else {
                    buttonTitle = `Game ${g} (ซิงค์ Global Ban จากเกมก่อนหน้าอัตโนมัติ)`;
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
                      className={`h-6 min-w-6.5 px-1.5 font-mono text-[11px] font-bold transition-colors ${
                        isCurrent
                          ? "bg-gold text-bg"
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

            {/* Direct 1-Tap Swap, History & Record Result Actions (visible on all viewports) */}
            <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
              <button
                type="button"
                onClick={handleSwapSides}
                aria-label="สลับฝั่งทีม"
                title={`สลับฝั่งทีม (${bName} ⇄ ${rName}) — ฮีโร่ที่แต่ละทีมเคยใช้จะย้ายฝั่งตามทีมไปอัตโนมัติ`}
                className="flex h-8 shrink-0 items-center gap-1.5 border border-gold/60 bg-gold/10 px-2 font-display text-xs font-bold whitespace-nowrap text-gold transition-colors hover:bg-gold hover:text-bg sm:h-7"
              >
                <ArrowLeftRight
                  className={`h-3.5 w-3.5 shrink-0 transition-transform duration-300 ${
                    swapCount % 2 === 1 ? "rotate-180" : "rotate-0"
                  }`}
                />
                <span className="hidden md:inline">สลับฝั่ง</span>
              </button>

              <button
                type="button"
                onClick={() => setIsHistoryModalOpen(true)}
                aria-label="ประวัติซีรีส์"
                title={`ดูประวัติการดราฟต์แยกตามกลุ่มซีรีส์ (บันทึกสูงสุด ${MAX_SERIES_GAMES} เกมล่าสุด)`}
                className="flex h-8 shrink-0 items-center gap-1.5 border border-gold/45 bg-panel-2/80 px-2 font-display text-xs font-semibold whitespace-nowrap text-ink transition-colors hover:border-gold hover:bg-panel-2 sm:h-7"
              >
                <History className="h-3.5 w-3.5 shrink-0 text-gold" />
                <span className="hidden md:inline">ประวัติ</span>
                <span
                  className={`px-1 py-0.5 font-mono text-[10px] font-bold leading-none sm:px-1.5 ${
                    seriesGames.length > 0 ? "bg-gold text-bg" : "border border-line-strong bg-bg text-muted"
                  }`}
                >
                  {seriesGames.length}/{MAX_SERIES_GAMES}
                </span>
              </button>

              <button
                type="button"
                disabled={!isDraftComplete}
                onClick={() => setIsFinishGameModalOpen(true)}
                aria-label="บันทึกผลเกม"
                title={
                  isDraftComplete
                    ? "บันทึกผลการแข่งขัน + ฮีโร่ที่ทั้ง 2 ทีมเลือกเข้า Global Ban ของแต่ละทีม และเริ่มเกมถัดไป"
                    : `ต้องดราฟต์ให้ครบทั้ง 10 ตัวก่อนจึงจะจบเกมได้ (ปัจจุบัน ${bluePicks.length + redPicks.length}/10)`
                }
                className={`flex h-8 shrink-0 items-center gap-1.5 border px-2 font-display text-xs font-bold whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-35 sm:h-7 ${
                  isDraftComplete
                    ? "border-gold bg-gold text-bg hover:bg-gold/90"
                    : "border-good/60 bg-good/15 text-good hover:bg-good hover:text-bg"
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">บันทึกผล</span>
              </button>
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
        setLeague={setLeague}
        useLookahead={useLookahead}
        onToggleLookahead={() => setUseLookahead((prev) => !prev)}
        onUndo={undo}
        onRedo={redo}
        onReset={() => {
          setIsFinishGameModalOpen(false);
          reset();
        }}
        canUndo={canUndo}
        canRedo={canRedo}
      />

      {globalBanModalCat !== null && (
        <GlobalBanModal
          heroes={heroes}
          heroMap={heroMap}
          globalBans={globalBans}
          seriesGames={seriesGames}
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
          hasCurrentDraftActions={hasAnyAction}
          onSaveCurrentSnapshot={saveCurrentDraftSnapshot}
          onOpenNewSeries={() => setIsNewSeriesModalOpen(true)}
          onSwitchSeries={(...args) => {
            setIsFinishGameModalOpen(false);
            switchSeries(...args);
          }}
          onLoadGame={(...args) => {
            setIsFinishGameModalOpen(false);
            loadRecordedGame(...args);
          }}
          onSetGameWinner={setRecordedGameWinner}
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

      {isNewSeriesModalOpen && (
        <NewSeriesModal
          currentSeriesName={resolveSeriesName(globalBans)}
          existingSeriesNames={existingSeriesNames}
          defaultTeamA={globalBans.teamAName}
          defaultTeamB={globalBans.teamBName}
          hasCurrentActions={hasAnyAction}
          onConfirm={(...args) => {
            setIsFinishGameModalOpen(false);
            startNewSeries(...args);
          }}
          onClose={() => setIsNewSeriesModalOpen(false)}
        />
      )}

      {editingPickLane && (
        <PickLaneModal
          heroName={editingPickLane.heroName}
          side={editingPickLane.side}
          teamName={editingPickLane.side === "blue" ? bName : rName}
          hero={heroMap.get(editingPickLane.heroName)}
          currentLane={pickLanes[editingPickLane.heroName]}
          lockedByLane={Object.fromEntries(
            (editingPickLane.side === "blue" ? bluePicks : redPicks)
              .filter((h) => h !== editingPickLane.heroName && pickLanes[h])
              .map((h) => [pickLanes[h] as LaneKey, h]),
          )}
          onSelectLane={(lane) => setPickLane(editingPickLane.heroName, lane)}
          onClose={() => setEditingPickLane(null)}
        />
      )}

      {isFinishGameModalOpen && isDraftComplete && (
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
            recordGameToSeries(false, winner);
            setIsFinishGameModalOpen(false);
          }}
          onClose={() => setIsFinishGameModalOpen(false)}
        />
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

      <main className="mx-auto flex min-h-0 w-full max-w-[1920px] flex-1 flex-col gap-1.5 overflow-hidden px-2 py-1.5 sm:px-3 sm:py-2">
        {error && (
          <div className="shrink-0">
            <Alert>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{error}</span>
                <button
                  type="button"
                  onClick={retryPredict}
                  className="border border-red/50 bg-red/15 px-2 py-0.5 font-display text-[11px] font-bold text-ink transition-colors hover:bg-red hover:text-bg"
                >
                  ลองใหม่
                </button>
              </div>
            </Alert>
          </div>
        )}
        {syncError && (
          <div className="shrink-0">
            <Alert tone="warning">{syncError}</Alert>
          </div>
        )}
        {heroesFallback && (
          <div className="shrink-0">
            <Alert tone="warning">
              โหลดข้อมูลฮีโร่จากเซิร์ฟเวอร์ไม่ได้ — ใช้รายชื่อสำรอง บทบาทและเลนอาจไม่ถูกต้อง
            </Alert>
          </div>
        )}

        {/* Compact Top Matchup HUD — Pinned on Mobile (except in full teams view) & iPad (< lg) */}
        <div
          className={`shrink-0 grid-cols-2 gap-1.5 sm:gap-2 lg:hidden ${
            mobileView === "teams" ? "hidden md:grid" : "grid"
          }`}
        >
          <div key={`compact-blue-${swapCount}`} className={`min-w-0 ${swapCount > 0 ? "animate-side-swap-flash" : ""}`}>
            <TeamColumn
              variant="compact"
              side="blue"
              teamName={bName}
              picks={bluePicks}
              bans={blueBans}
              pickLanes={pickLanes}
              onEditPickLane={(heroName, side) => setEditingPickLane({ heroName, side })}
              usedHeroes={bUsed}
              usedHeroOriginGames={blueOriginGames}
              rawUsedCount={
                globalBans.blueSideTeam === "A" ? globalBans.teamAUsed.length : globalBans.teamBUsed.length
              }
              gameNumber={globalBans.gameNumber}
              heroMap={heroMap}
              currentStep={currentStep}
              predictedNextPicks={blueNextPicks}
              predictedNextBans={blueNextBans}
              onLockHero={lockHero}
              onOpenGlobalBanForTeam={() => setGlobalBanModalCat(blueCategoryKey)}
              onRemoveUsedHero={(heroName) => removeUsedHero(blueCategoryKey, heroName)}
            />
          </div>
          <div key={`compact-red-${swapCount}`} className={`min-w-0 ${swapCount > 0 ? "animate-side-swap-flash" : ""}`}>
            <TeamColumn
              variant="compact"
              side="red"
              teamName={rName}
              picks={redPicks}
              bans={redBans}
              pickLanes={pickLanes}
              onEditPickLane={(heroName, side) => setEditingPickLane({ heroName, side })}
              usedHeroes={rUsed}
              usedHeroOriginGames={redOriginGames}
              rawUsedCount={
                globalBans.blueSideTeam === "A" ? globalBans.teamBUsed.length : globalBans.teamAUsed.length
              }
              gameNumber={globalBans.gameNumber}
              heroMap={heroMap}
              currentStep={currentStep}
              predictedNextPicks={redNextPicks}
              predictedNextBans={redNextBans}
              onLockHero={lockHero}
              onOpenGlobalBanForTeam={() => setGlobalBanModalCat(redCategoryKey)}
              onRemoveUsedHero={(heroName) => removeUsedHero(redCategoryKey, heroName)}
            />
          </div>
        </div>

        {/* Mobile Full Teams & Global Ban View (< md when mobileView === "teams") */}
        {mobileView === "teams" && (
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto md:hidden">
            <div
              key={`mobile-blue-${swapCount}`}
              className={`flex min-h-0 min-w-0 flex-col ${swapCount > 0 ? "animate-side-swap-flash" : ""}`}
            >
              <TeamColumn
                variant="full"
                side="blue"
                teamName={bName}
                picks={bluePicks}
                bans={blueBans}
                pickLanes={pickLanes}
                onEditPickLane={(heroName, side) => setEditingPickLane({ heroName, side })}
                usedHeroes={bUsed}
                usedHeroOriginGames={blueOriginGames}
                rawUsedCount={
                  globalBans.blueSideTeam === "A" ? globalBans.teamAUsed.length : globalBans.teamBUsed.length
                }
                gameNumber={globalBans.gameNumber}
                heroMap={heroMap}
                currentStep={currentStep}
                predictedNextPicks={blueNextPicks}
                predictedNextBans={blueNextBans}
                onLockHero={lockHero}
                onOpenGlobalBanForTeam={() => setGlobalBanModalCat(blueCategoryKey)}
                onRemoveUsedHero={(heroName) => removeUsedHero(blueCategoryKey, heroName)}
              />
            </div>
            <div
              key={`mobile-red-${swapCount}`}
              className={`flex min-h-0 min-w-0 flex-col ${swapCount > 0 ? "animate-side-swap-flash" : ""}`}
            >
              <TeamColumn
                variant="full"
                side="red"
                teamName={rName}
                picks={redPicks}
                bans={redBans}
                pickLanes={pickLanes}
                onEditPickLane={(heroName, side) => setEditingPickLane({ heroName, side })}
                usedHeroes={rUsed}
                usedHeroOriginGames={redOriginGames}
                rawUsedCount={
                  globalBans.blueSideTeam === "A" ? globalBans.teamBUsed.length : globalBans.teamAUsed.length
                }
                gameNumber={globalBans.gameNumber}
                heroMap={heroMap}
                currentStep={currentStep}
                predictedNextPicks={redNextPicks}
                predictedNextBans={redNextBans}
                onLockHero={lockHero}
                onOpenGlobalBanForTeam={() => setGlobalBanModalCat(redCategoryKey)}
                onRemoveUsedHero={(heroName) => removeUsedHero(redCategoryKey, heroName)}
              />
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
            className={`hidden min-h-0 flex-col lg:order-1 lg:flex ${swapCount > 0 ? "animate-side-swap-flash" : ""}`}
          >
            <TeamColumn
              variant="full"
              side="blue"
              teamName={bName}
              picks={bluePicks}
              bans={blueBans}
              pickLanes={pickLanes}
              onEditPickLane={(heroName, side) => setEditingPickLane({ heroName, side })}
              usedHeroes={bUsed}
              usedHeroOriginGames={blueOriginGames}
              rawUsedCount={
                globalBans.blueSideTeam === "A" ? globalBans.teamAUsed.length : globalBans.teamBUsed.length
              }
              gameNumber={globalBans.gameNumber}
              heroMap={heroMap}
              currentStep={currentStep}
              predictedNextPicks={blueNextPicks}
              predictedNextBans={blueNextBans}
              onLockHero={lockHero}
              onOpenGlobalBanForTeam={() => setGlobalBanModalCat(blueCategoryKey)}
              onRemoveUsedHero={(heroName) => removeUsedHero(blueCategoryKey, heroName)}
            />
          </div>

          {/* Laptop / Desktop Right Column: Red Team Full Board */}
          <div
            key={`desktop-red-${swapCount}`}
            className={`hidden min-h-0 flex-col lg:order-3 lg:flex ${swapCount > 0 ? "animate-side-swap-flash" : ""}`}
          >
            <TeamColumn
              variant="full"
              side="red"
              teamName={rName}
              picks={redPicks}
              bans={redBans}
              pickLanes={pickLanes}
              onEditPickLane={(heroName, side) => setEditingPickLane({ heroName, side })}
              usedHeroes={rUsed}
              usedHeroOriginGames={redOriginGames}
              rawUsedCount={
                globalBans.blueSideTeam === "A" ? globalBans.teamBUsed.length : globalBans.teamAUsed.length
              }
              gameNumber={globalBans.gameNumber}
              heroMap={heroMap}
              currentStep={currentStep}
              predictedNextPicks={redNextPicks}
              predictedNextBans={redNextBans}
              onLockHero={lockHero}
              onOpenGlobalBanForTeam={() => setGlobalBanModalCat(redCategoryKey)}
              onRemoveUsedHero={(heroName) => removeUsedHero(redCategoryKey, heroName)}
            />
          </div>

          {/* Center / Split-View Workspace: AI Suggestions + Hero Grid */}
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 md:col-span-12 md:grid md:grid-cols-12 md:gap-2.5 lg:order-2 lg:col-span-1 lg:flex lg:flex-col lg:gap-2">
            {/* Mobile Quick AI Ribbon (Only on Mobile 'draft' view) */}
            {mobileView === "draft" && (
              <div className="shrink-0 md:hidden">
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
                  onLockHero={lockHero}
                />
              </div>
            )}

            {/* Full AI Panel: Shown on Mobile 'ai' view, iPad left pane (5 cols), and Laptop top deck */}
            <div
              className={`min-h-0 flex-col md:col-span-5 md:flex lg:shrink-0 ${
                mobileView === "ai" ? "flex flex-1" : "hidden"
              }`}
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
                onLockHero={lockHero}
              />
            </div>

            {/* Hero Grid: Shown on Mobile 'draft' view, iPad right pane (7 cols), and Laptop bottom pane */}
            <div
              className={`min-h-0 flex-1 flex-col md:col-span-7 md:flex ${
                mobileView === "draft" ? "flex" : "hidden"
              }`}
            >
              <HeroGrid
                ref={searchRef}
                heroes={heroes}
                unavailableHeroes={unavailableHeroes}
                blueUsedHeroes={bUsed}
                redUsedHeroes={rUsed}
                universalBans={globalBans.universalBans}
                blueTeamName={bName}
                redTeamName={rName}
                recommendedRanks={recommendedRanks}
                missingAllyLanes={missingAllyLanes}
                currentStep={currentStep}
                isLoading={isLoading}
                isHeroesLoading={isHeroesLoading}
                onLockHero={lockHero}
              />
            </div>
          </div>
        </div>
      </main>

      {/* Mobile App Bottom Navigation Bar (< md) */}
      <footer
        aria-label="มุมมองมือถือ"
        className="grid shrink-0 grid-cols-3 border-t border-line bg-panel md:hidden"
      >
        <button
          type="button"
          onClick={() => setMobileView("draft")}
          className={`flex min-w-0 flex-col items-center justify-center gap-0.5 px-1.5 py-2 font-display text-[11px] font-bold tracking-wide transition-colors sm:text-xs ${
            mobileView === "draft"
              ? "border-t-2 border-gold bg-gold/10 text-gold"
              : "border-t-2 border-transparent text-muted hover:text-ink"
          }`}
        >
          <LayoutGrid className="h-4 w-4 shrink-0 sm:h-4.5 sm:w-4.5" />
          <span className="w-full truncate text-center">เลือกฮีโร่ ({heroes.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileView("ai")}
          className={`flex min-w-0 flex-col items-center justify-center gap-0.5 px-1.5 py-2 font-display text-[11px] font-bold tracking-wide transition-colors sm:text-xs ${
            mobileView === "ai"
              ? "border-t-2 border-gold bg-gold/10 text-gold"
              : "border-t-2 border-transparent text-muted hover:text-ink"
          }`}
        >
          <Sparkles className="h-4 w-4 shrink-0 sm:h-4.5 sm:w-4.5" />
          <span className="w-full truncate text-center">
            {recommendations[0] ? `AI #1: ${displayName(recommendations[0].hero_name)}` : "วิเคราะห์ AI"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setMobileView("teams")}
          className={`flex min-w-0 flex-col items-center justify-center gap-0.5 px-1.5 py-2 font-display text-[11px] font-bold tracking-wide transition-colors sm:text-xs ${
            mobileView === "teams"
              ? "border-t-2 border-gold bg-gold/10 text-gold"
              : "border-t-2 border-transparent text-muted hover:text-ink"
          }`}
        >
          <Users className="h-4 w-4 shrink-0 sm:h-4.5 sm:w-4.5" />
          <span className="w-full truncate text-center">กระดาน & แบน ({bUsed.length + rUsed.length})</span>
        </button>
      </footer>
    </div>
  );
}

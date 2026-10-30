import {
  ArrowLeftRight,
  CheckCircle2,
  History,
  LayoutGrid,
  Layers,
  PlusCircle,
  Sparkles,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AiPanel } from "./components/AiPanel";
import { Alert } from "./components/Alert";
import { DraftHistoryModal } from "./components/DraftHistoryModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { type GlobalBanCategoryKey, GlobalBanModal } from "./components/GlobalBanModal";
import { HeroGrid } from "./components/HeroGrid";
import { CombatLab } from "./components/lab/CombatLab";
import { MetaLab } from "./components/meta_lab/MetaLab";
import { NewSeriesModal } from "./components/NewSeriesModal";
import { ScoreBar } from "./components/ScoreBar";
import { TeamColumn } from "./components/TeamColumn";
import { useDraft } from "./hooks/useDraft";
import {
  blueTeamName,
  blueUsedHeroes,
  getGameUnlockStatus,
  getMaxUnlockedGame,
  heroOriginGameMap,
  redTeamName,
  redUsedHeroes,
  resolveSeriesName,
} from "./utils/draft";
import { displayName } from "./utils/heroNames";

type Tab = "draft" | "metalab" | "lab";
type MobileDraftView = "draft" | "ai" | "teams";

const TABS: { key: Tab; label: string }[] = [
  { key: "draft", label: "ดราฟต์" },
  { key: "metalab", label: "Matrix Draft (สถิติ & กฎ)" },
  { key: "lab", label: "Stat & Duel Lab" },
];

function initialTab(): Tab {
  if (window.location.hash === "#metalab") return "metalab";
  if (window.location.hash === "#lab") return "lab";
  return "draft";
}

export function App() {
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
    unavailableHeroes,
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
    heroesFallback,
    lockHero,
    undo,
    reset,
    canUndo,
  } = useDraft();

  const searchRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [mobileView, setMobileView] = useState<MobileDraftView>("draft");
  const [globalBanModalCat, setGlobalBanModalCat] = useState<GlobalBanCategoryKey | null>(null);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isNewSeriesModalOpen, setIsNewSeriesModalOpen] = useState(false);

  const bUsed = useMemo(() => blueUsedHeroes(globalBans), [globalBans]);
  const rUsed = useMemo(() => redUsedHeroes(globalBans), [globalBans]);
  const bName = blueTeamName(globalBans);
  const rName = redTeamName(globalBans);
  const blueCategoryKey: GlobalBanCategoryKey = globalBans.blueSideTeam === "A" ? "teamAUsed" : "teamBUsed";
  const redCategoryKey: GlobalBanCategoryKey = globalBans.blueSideTeam === "A" ? "teamBUsed" : "teamAUsed";

  const originMap = useMemo(
    () => heroOriginGameMap(seriesGames, resolveSeriesName(globalBans)),
    [seriesGames, globalBans],
  );
  const blueOriginGames = globalBans.blueSideTeam === "A" ? originMap.teamAGameByHero : originMap.teamBGameByHero;
  const redOriginGames = globalBans.blueSideTeam === "A" ? originMap.teamBGameByHero : originMap.teamAGameByHero;

  const removeUsedHero = (catKey: "teamAUsed" | "teamBUsed", heroName: string) => {
    const candidateState = {
      ...globalBans,
      [catKey]: globalBans[catKey].filter((n) => n !== heroName),
    };
    const statusAfter = getGameUnlockStatus(globalBans.gameNumber, candidateState, seriesGames);
    if (globalBans.gameNumber > 1 && !statusAfter.isUnlocked) {
      const maxUnlocked = getMaxUnlockedGame(candidateState, seriesGames);
      const ok = window.confirm(
        `การลบ ${displayName(heroName)} จะทำให้จำนวน Global Ban ไม่ครบตามเงื่อนไขของ Game ${globalBans.gameNumber} (ต้องมีอย่างน้อยฝั่งละ ${statusAfter.requiredCount} ตัว)\n\nระบบจะย้อนกลับไปยัง Game ${maxUnlocked} อัตโนมัติ ยืนยันหรือไม่?`,
      );
      if (!ok) return;
      setGlobalBans({
        ...candidateState,
        gameNumber: maxUnlocked,
      });
      return;
    }
    setGlobalBans(candidateState);
  };

  const selectTab = (next: Tab) => {
    setTab(next);
    window.history.replaceState(null, "", next === "draft" ? "#" : `#${next}`);
  };

  const recommendedRanks = useMemo(
    () => new Map(recommendations.slice(0, 5).map((r) => [r.hero_name, r.rank])),
    [recommendations],
  );

  const hasAnyPick = bluePicks.length + redPicks.length > 0;
  const hasAnyAction = bluePicks.length + redPicks.length + blueBans.length + redBans.length > 0;
  const isDraftComplete = currentStep === null;
  const topRecommendation = recommendations[0];

  // Keyboard shortcuts: "/" focus search, Enter lock top suggestion, Ctrl/Cmd+Z undo
  useEffect(() => {
    if (tab !== "draft" || globalBanModalCat !== null || isHistoryModalOpen || isNewSeriesModalOpen) return;
    function onKey(e: KeyboardEvent) {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      } else if (!typing && e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (!typing && e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
        const top = recommendations[0];
        if (top && currentStep && !isLoading && !unavailableHeroes.has(top.hero_name)) lockHero(top.hero_name);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    tab,
    globalBanModalCat,
    isHistoryModalOpen,
    isNewSeriesModalOpen,
    undo,
    lockHero,
    recommendations,
    currentStep,
    isLoading,
    unavailableHeroes,
  ]);

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-bg">
      {/* Unified Top Navigation & Series Control Bar */}
      <nav className="shrink-0 border-b border-line bg-panel/90" aria-label="โหมด">
        <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-2 overflow-x-auto px-3 sm:px-4">
          {/* Left: Mode Tabs */}
          <div className="flex shrink-0 items-center gap-1">
            {TABS.map((t) => (
              <button
                type="button"
                key={t.key}
                onClick={() => selectTab(t.key)}
                aria-current={tab === t.key ? "page" : undefined}
                className={`border-b-2 px-3 py-2 font-display text-xs sm:text-sm font-semibold tracking-wide whitespace-nowrap ${
                  tab === t.key ? "border-gold text-ink" : "border-transparent text-dim hover:text-muted"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Right: Compact Series & Global Ban Controls (Draft Mode) */}
          {tab === "draft" && (
            <div
              aria-label="Series and Global Ban Controls"
              className="flex shrink-0 items-center gap-1.5 py-1.5 whitespace-nowrap"
            >
              <button
                type="button"
                onClick={() => setIsNewSeriesModalOpen(true)}
                title="เริ่มแมตช์ / ซีรีส์ใหม่ (แยกประวัติออกจากแมตช์เดิม)"
                className="flex h-7.5 shrink-0 items-center gap-1.5 border border-gold bg-gold px-2.5 font-display text-xs font-bold tracking-wide whitespace-nowrap text-bg transition-colors hover:bg-gold/90"
              >
                <PlusCircle className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">+ แมตช์ใหม่</span>
              </button>

              <span
                className="hidden max-w-[180px] truncate border-x border-line px-2.5 font-display text-xs font-bold tracking-wider text-gold xl:inline-block"
                title={globalBans.seriesName || `${bName} vs ${rName}`}
              >
                {globalBans.seriesName || `${bName} vs ${rName}`}
              </span>

              <div className="inline-flex shrink-0 items-center border border-line bg-bg p-0.5">
                {[1, 2, 3, 4, 5, 6, 7].map((g) => {
                  const unlockStatus = getGameUnlockStatus(g, globalBans, seriesGames);
                  const isUnlocked = unlockStatus.isUnlocked;
                  const isCurrent = globalBans.gameNumber === g;

                  let buttonTitle = `Game ${g}`;
                  if (g === 7) {
                    buttonTitle = "Game 7 Ultimate Battle — รีเซ็ต Global Ban ของทั้งสองทีม";
                  } else if (!isUnlocked) {
                    const missingStr = unlockStatus.missingGames.map((mg) => `G${mg}`).join(", ");
                    buttonTitle = `Game ${g} ถูกล็อก: ต้องจบ ${missingStr} หรือใส่ Global Ban ฝั่งละอย่างน้อย ${unlockStatus.requiredCount} ตัว (Team A: ${unlockStatus.aCount}/${unlockStatus.requiredCount}, Team B: ${unlockStatus.bCount}/${unlockStatus.requiredCount})`;
                  } else {
                    buttonTitle = `Game ${g} (ซิงค์ Global Ban จากเกมก่อนหน้าอัตโนมัติ)`;
                  }

                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => {
                        if (!isUnlocked) {
                          const missingStr = unlockStatus.missingGames.map((mg) => `Game ${mg}`).join(", ");
                          const teamAName = globalBans.teamAName || "Team A";
                          const teamBName = globalBans.teamBName || "Team B";
                          const wantOpenModal = window.confirm(
                            `Game ${g} ยังไม่ปลดล็อก!\n\nเงื่อนไขการลัดไป Game ${g}:\n- ต้องบันทึกผล ${missingStr} ให้เสร็จก่อน หรือ\n- ใส่ Global Ban ของทั้งสองทีมอย่างน้อยฝั่งละ ${unlockStatus.requiredCount} ตัวละคร\n\nสถานะปัจจุบัน:\n- ${teamAName}: ${unlockStatus.aCount}/${unlockStatus.requiredCount} ตัว\n- ${teamBName}: ${unlockStatus.bCount}/${unlockStatus.requiredCount} ตัว\n\nต้องการเปิดหน้าต่าง Global Ban เพื่อตั้งค่าฮีโร่ทันทีหรือไม่?`,
                          );
                          if (wantOpenModal) {
                            setGlobalBanModalCat(blueCategoryKey);
                          }
                          return;
                        }
                        selectGameNumber(g);
                      }}
                      title={buttonTitle}
                      className={`h-6 px-2 font-mono text-xs font-bold transition-colors ${
                        isCurrent
                          ? "bg-gold text-bg"
                          : !isUnlocked
                            ? "cursor-not-allowed text-dim/40 hover:bg-panel-2/40 hover:text-muted"
                            : "text-muted hover:bg-panel-2 hover:text-ink"
                      }`}
                    >
                      G{g}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={swapTeamSides}
                title={`สลับฝั่งทีม (${bName} ⇄ ${rName}) — ฮีโร่ที่แต่ละทีมเคยใช้จะย้ายฝั่งตามทีมไปอัตโนมัติ`}
                className="flex h-7.5 shrink-0 items-center gap-1.5 border border-gold/60 bg-gold/10 px-2.5 font-display text-xs font-bold whitespace-nowrap text-gold transition-colors hover:bg-gold hover:text-bg"
              >
                <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden md:inline">สลับฝั่ง</span>
              </button>

              <button
                type="button"
                onClick={() => setGlobalBanModalCat(blueCategoryKey)}
                title="ตั้งค่าชื่อทีม ฮีโร่ที่เคยใช้ในซีรีส์ และแบนถาวร"
                className="flex h-7.5 shrink-0 items-center gap-1.5 border border-line-strong bg-bg px-2.5 font-display text-xs font-semibold whitespace-nowrap text-muted transition-colors hover:border-gold/60 hover:text-ink"
              >
                <Layers className="h-3.5 w-3.5 shrink-0 text-gold" />
                <span className="hidden lg:inline">Global Ban</span>
                {globalBans.universalBans.length > 0 && (
                  <span className="bg-gold px-1 font-mono text-[10px] font-bold text-bg">
                    +{globalBans.universalBans.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsHistoryModalOpen(true)}
                title="ดูประวัติการดราฟต์ในซีรีส์ หรือกู้คืนกระดานเกมก่อนหน้า"
                className="flex h-7.5 shrink-0 items-center gap-1.5 border border-line-strong bg-bg px-2.5 font-display text-xs font-semibold whitespace-nowrap text-muted transition-colors hover:border-gold/60 hover:text-ink"
              >
                <History className="h-3.5 w-3.5 shrink-0 text-gold" />
                <span className="hidden lg:inline">ประวัติ</span>
                {seriesGames.length > 0 && (
                  <span className="bg-gold px-1 font-mono text-[10px] font-bold text-bg">
                    {seriesGames.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                disabled={!hasAnyPick}
                onClick={() => {
                  if (
                    !isDraftComplete &&
                    !window.confirm(
                      `Game ${globalBans.gameNumber} ยังดราฟต์ไม่ครบ 10 ตัว (${bluePicks.length + redPicks.length}/10)\n\nยืนยันต้องการจบเกมนี้และนำฮีโร่ที่เลือกเข้าสู่ Global Ban ของเกมถัดไปหรือไม่?`,
                    )
                  ) {
                    return;
                  }
                  recordGameToSeries(false);
                }}
                title="บันทึกฮีโร่ที่ทั้ง 2 ทีมเลือกในตานี้เข้า Global Ban ของแต่ละทีม และเริ่มเกมถัดไป"
                className={`flex h-7.5 shrink-0 items-center gap-1.5 border px-2.5 font-display text-xs font-bold whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-35 ${
                  isDraftComplete
                    ? "border-gold bg-gold text-bg hover:bg-gold/90"
                    : "border-good/60 bg-good/15 text-good hover:bg-good hover:text-bg"
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span>
                  จบ G{globalBans.gameNumber}→G{Math.min(globalBans.gameNumber + 1, 7)}
                </span>
              </button>
            </div>
          )}
        </div>
      </nav>

      <ErrorBoundary resetKey={tab}>
        {tab === "metalab" ? (
          <MetaLab
            heroMap={heroMap}
            mainBluePicks={bluePicks}
            mainRedPicks={redPicks}
            mainBlueBans={blueBans}
            mainRedBans={redBans}
            mainGlobalBans={globalBans}
          />
        ) : tab === "lab" ? (
          <main className="mx-auto w-full max-w-[1680px] flex-1 overflow-y-auto px-4 py-4">
            <CombatLab heroMap={heroMap} />
          </main>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <ScoreBar
              blueWinRate={blueWinRate}
              isLoading={isLoading}
              currentStep={currentStep}
              currentStepIndex={currentStepIndex}
              totalSteps={totalSteps}
              useLookahead={useLookahead}
              setUseLookahead={setUseLookahead}
              onUndo={undo}
              onReset={reset}
              canUndo={canUndo}
            />

            {globalBanModalCat !== null && (
              <GlobalBanModal
                heroes={heroes}
                heroMap={heroMap}
                globalBans={globalBans}
                seriesGames={seriesGames}
                initialCategory={globalBanModalCat}
                onChange={setGlobalBans}
                onSelectGameNumber={selectGameNumber}
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
                onSwitchSeries={switchSeries}
                onLoadGame={loadRecordedGame}
                onDeleteGame={deleteRecordedGame}
                onDeleteGroup={deleteSeriesGroup}
                onClearAllSeries={clearAllHistory}
                onClose={() => setIsHistoryModalOpen(false)}
              />
            )}

            {isNewSeriesModalOpen && (
              <NewSeriesModal
                currentSeriesName={globalBans.seriesName}
                defaultTeamA={globalBans.teamAName}
                defaultTeamB={globalBans.teamBName}
                hasCurrentActions={hasAnyAction}
                onConfirm={startNewSeries}
                onClose={() => setIsNewSeriesModalOpen(false)}
              />
            )}

            <main className="mx-auto flex min-h-0 w-full max-w-[1920px] flex-1 flex-col gap-1.5 overflow-hidden px-2 py-1.5 sm:px-3 sm:py-2">
              {error && (
                <div className="shrink-0">
                  <Alert>{error}</Alert>
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
                className={` shrink-0 grid-cols-2 gap-1.5 sm:gap-2 lg:hidden ${
                  mobileView === "teams" ? "hidden md:grid" : "grid"
                }`}
              >
                <TeamColumn
                  variant="compact"
                  side="blue"
                  teamName={bName}
                  picks={bluePicks}
                  bans={blueBans}
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
                <TeamColumn
                  variant="compact"
                  side="red"
                  teamName={rName}
                  picks={redPicks}
                  bans={redBans}
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

              {/* Mobile Full Teams & Global Ban View (< md when mobileView === "teams") */}
              {mobileView === "teams" && (
                <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto md:hidden">
                  <TeamColumn
                    variant="full"
                    side="blue"
                    teamName={bName}
                    picks={bluePicks}
                    bans={blueBans}
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
                  <TeamColumn
                    variant="full"
                    side="red"
                    teamName={rName}
                    picks={redPicks}
                    bans={redBans}
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
              )}

              {/* Main Single-Screen Workspace (Mobile Draft/AI, iPad Split-View, Laptop 3-Column) */}
              <div
                className={`min-h-0 flex-1 flex-col gap-2 md:grid md:grid-cols-12 md:gap-3 lg:grid-cols-[240px_minmax(0,1fr)_240px] lg:gap-3 xl:grid-cols-[300px_minmax(0,1fr)_300px] xl:gap-3.5 2xl:grid-cols-[340px_minmax(0,1fr)_340px] ${
                  mobileView === "teams" ? "hidden md:grid" : "flex"
                }`}
              >
                {/* Laptop / Desktop Left Column: Blue Team Full Board */}
                <div className="hidden min-h-0 flex-col lg:order-1 lg:flex">
                  <TeamColumn
                    variant="full"
                    side="blue"
                    teamName={bName}
                    picks={bluePicks}
                    bans={blueBans}
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
                <div className="hidden min-h-0 flex-col lg:order-3 lg:flex">
                  <TeamColumn
                    variant="full"
                    side="red"
                    teamName={rName}
                    picks={redPicks}
                    bans={redBans}
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
                        useLookahead={useLookahead}
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
                      useLookahead={useLookahead}
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
                  {topRecommendation ? `AI #1: ${displayName(topRecommendation.hero_name)}` : "วิเคราะห์ AI"}
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
        )}
      </ErrorBoundary>
    </div>
  );
}

export default App;

import { ArrowLeftRight, CheckCircle2, History, Layers } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AiPanel } from "./components/AiPanel";
import { Alert } from "./components/Alert";
import { DraftHistoryModal } from "./components/DraftHistoryModal";
import { DraftTimeline } from "./components/DraftTimeline";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { type GlobalBanCategoryKey, GlobalBanModal } from "./components/GlobalBanModal";
import { HeroGrid } from "./components/HeroGrid";
import { CombatLab } from "./components/lab/CombatLab";
import { ScoreBar } from "./components/ScoreBar";
import { TeamColumn } from "./components/TeamColumn";
import { useDraft } from "./hooks/useDraft";
import { blueTeamName, blueUsedHeroes, heroesByStep, redTeamName, redUsedHeroes } from "./utils/draft";

type Tab = "draft" | "lab";

const TABS: { key: Tab; label: string }[] = [
  { key: "draft", label: "ดราฟต์" },
  { key: "lab", label: "Stat & Duel Lab" },
];

function initialTab(): Tab {
  return window.location.hash === "#lab" ? "lab" : "draft";
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
    seriesGames,
    saveCurrentDraftSnapshot,
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
  const [globalBanModalCat, setGlobalBanModalCat] = useState<GlobalBanCategoryKey | null>(null);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

  const bUsed = useMemo(() => blueUsedHeroes(globalBans), [globalBans]);
  const rUsed = useMemo(() => redUsedHeroes(globalBans), [globalBans]);
  const bName = blueTeamName(globalBans);
  const rName = redTeamName(globalBans);
  const blueCategoryKey: GlobalBanCategoryKey = globalBans.blueSideTeam === "A" ? "teamAUsed" : "teamBUsed";
  const redCategoryKey: GlobalBanCategoryKey = globalBans.blueSideTeam === "A" ? "teamBUsed" : "teamAUsed";

  const globalBanCount =
    globalBans.teamAUsed.length + globalBans.teamBUsed.length + globalBans.universalBans.length;

  const removeUsedHero = (catKey: "teamAUsed" | "teamBUsed", heroName: string) => {
    setGlobalBans((prev) => ({
      ...prev,
      [catKey]: prev[catKey].filter((n) => n !== heroName),
    }));
  };

  const selectTab = (next: Tab) => {
    setTab(next);
    window.history.replaceState(null, "", next === "lab" ? "#lab" : "#");
  };

  const stepHeroes = useMemo(
    () => heroesByStep({ bluePicks, redPicks, blueBans, redBans }),
    [bluePicks, redPicks, blueBans, redBans],
  );

  const recommendedRanks = useMemo(
    () => new Map(recommendations.slice(0, 5).map((r) => [r.hero_name, r.rank])),
    [recommendations],
  );

  const hasAnyPick = bluePicks.length + redPicks.length > 0;
  const hasAnyAction = bluePicks.length + redPicks.length + blueBans.length + redBans.length > 0;
  const isDraftComplete = currentStep === null;

  // Keyboard shortcuts: "/" focus search, Enter lock top suggestion, Ctrl/Cmd+Z undo
  useEffect(() => {
    if (tab !== "draft" || globalBanModalCat !== null || isHistoryModalOpen) return;
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
  }, [tab, globalBanModalCat, isHistoryModalOpen, undo, lockHero, recommendations, currentStep, isLoading, unavailableHeroes]);

  return (
    <div className="flex min-h-screen flex-col">
      <nav className="border-b border-line bg-bg" aria-label="โหมด">
        <div className="mx-auto flex max-w-[1680px] gap-1 px-4">
          {TABS.map((t) => (
            <button
              type="button"
              key={t.key}
              onClick={() => selectTab(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              className={`border-b-2 px-3 py-2 font-display text-xs font-semibold tracking-wide ${
                tab === t.key ? "border-gold text-ink" : "border-transparent text-dim hover:text-muted"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <ErrorBoundary resetKey={tab}>
      {tab === "lab" ? (
        <main className="mx-auto w-full max-w-[1680px] flex-1 px-4 py-4">
          <CombatLab heroMap={heroMap} />
        </main>
      ) : (
        <>
          <ScoreBar
            blueWinRate={blueWinRate}
            isLoading={isLoading}
            currentStep={currentStep}
            currentStepIndex={currentStepIndex}
            totalSteps={totalSteps}
            useLookahead={useLookahead}
            setUseLookahead={setUseLookahead}
            globalBanCount={globalBanCount}
            onOpenGlobalBans={() => setGlobalBanModalCat(blueCategoryKey)}
            onUndo={undo}
            onReset={reset}
            canUndo={canUndo}
          />

          {globalBanModalCat !== null && (
            <GlobalBanModal
              heroes={heroes}
              heroMap={heroMap}
              globalBans={globalBans}
              initialCategory={globalBanModalCat}
              onChange={setGlobalBans}
              onClose={() => setGlobalBanModalCat(null)}
            />
          )}

          {isHistoryModalOpen && (
            <DraftHistoryModal
              games={seriesGames}
              heroMap={heroMap}
              hasCurrentDraftActions={hasAnyAction}
              onSaveCurrentSnapshot={saveCurrentDraftSnapshot}
              onLoadGame={loadRecordedGame}
              onDeleteGame={deleteRecordedGame}
              onDeleteGroup={deleteSeriesGroup}
              onClearAllSeries={clearAllHistory}
              onClose={() => setIsHistoryModalOpen(false)}
            />
          )}

          <main className="mx-auto flex w-full max-w-[1680px] flex-1 flex-col gap-3 px-4 py-3">
            {error && <Alert>{error}</Alert>}
            {heroesFallback && (
              <Alert tone="warning">โหลดข้อมูลฮีโร่จากเซิร์ฟเวอร์ไม่ได้ — ใช้รายชื่อสำรอง บทบาทและเลนอาจไม่ถูกต้อง</Alert>
            )}

            {/* On-Board Series & Global Ban Control Bar */}
            <section
              aria-label="Series and Global Ban Controls"
              className="flex flex-wrap items-center justify-between gap-2 border border-line bg-panel px-3 py-2"
            >
              {/* Game 1..7 Selector */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-display text-xs font-bold tracking-wider text-gold">SERIES:</span>
                {[1, 2, 3, 4, 5, 6, 7].map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGlobalBans((prev) => ({ ...prev, gameNumber: g }))}
                    title={g === 7 ? "Game 7 Ultimate Battle — รีเซ็ต Global Ban ของทั้งสองทีม" : `Game ${g}`}
                    className={`h-7 px-2 font-mono text-xs font-bold transition-colors ${
                      globalBans.gameNumber === g
                        ? "border border-gold bg-gold text-bg"
                        : "border border-line bg-bg text-muted hover:border-line-strong hover:text-ink"
                    }`}
                  >
                    {g === 7 ? "G7 ULTIMATE" : `GAME ${g}`}
                  </button>
                ))}
              </div>

              {/* Team Side Assignment & Quick Swap */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setGlobalBanModalCat(blueCategoryKey)}
                  title="คลิกเพื่อแก้ไขฮีโร่ที่ทีมฝั่ง Blue เคยใช้"
                  className="flex h-7 items-center gap-1.5 border border-blue/50 bg-blue/10 px-2.5 font-display text-xs font-bold text-blue transition-colors hover:bg-blue/20"
                >
                  <span>BLUE: {bName}</span>
                  <span className="bg-blue px-1 font-mono text-[10px] text-ink">{bUsed.length}</span>
                </button>

                <button
                  type="button"
                  onClick={swapTeamSides}
                  title="สลับฝั่งทีม (Blue ⇄ Red) — ฮีโร่ที่แต่ละทีมเคยใช้จะย้ายฝั่งตามทีมไปอัตโนมัติ"
                  className="flex h-7 items-center gap-1 border border-gold/60 bg-gold/10 px-2.5 font-display text-xs font-bold text-gold transition-colors hover:bg-gold hover:text-bg"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                  <span>สลับฝั่งทีม</span>
                </button>

                <button
                  type="button"
                  onClick={() => setGlobalBanModalCat(redCategoryKey)}
                  title="คลิกเพื่อแก้ไขฮีโร่ที่ทีมฝั่ง Red เคยใช้"
                  className="flex h-7 items-center gap-1.5 border border-red/50 bg-red/10 px-2.5 font-display text-xs font-bold text-red transition-colors hover:bg-red/20"
                >
                  <span>RED: {rName}</span>
                  <span className="bg-red px-1 font-mono text-[10px] text-ink">{rUsed.length}</span>
                </button>
              </div>

              {/* Record Game to Global Ban & Universal Ban Actions */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsHistoryModalOpen(true)}
                  title="ดูประวัติการดราฟต์ในซีรีส์ หรือกู้คืนกระดานเกมก่อนหน้า"
                  className="flex h-7 items-center gap-1.5 border border-line-strong bg-bg px-2.5 font-display text-xs font-semibold text-muted transition-colors hover:border-gold/60 hover:text-ink"
                >
                  <History className="h-3.5 w-3.5 text-gold" />
                  <span>ประวัติการดราฟต์</span>
                  {seriesGames.length > 0 && (
                    <span className="bg-gold px-1 font-mono text-[10px] font-bold text-bg">
                      {seriesGames.length}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setGlobalBanModalCat("universalBans")}
                  className="flex h-7 items-center gap-1.5 border border-line-strong bg-bg px-2.5 font-display text-xs font-semibold text-muted transition-colors hover:border-gold/60 hover:text-ink"
                >
                  <Layers className="h-3.5 w-3.5 text-gold" />
                  <span>ตั้งค่า Global Ban / ชื่อทีม</span>
                  {globalBans.universalBans.length > 0 && (
                    <span className="bg-gold px-1 font-mono text-[10px] font-bold text-bg">
                      +{globalBans.universalBans.length}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  disabled={!hasAnyPick}
                  onClick={() => recordGameToSeries(true)}
                  title="บันทึกฮีโร่ที่ทั้ง 2 ทีมเลือกในตานี้เข้า Global Ban ของแต่ละทีม สลับฝั่ง และเริ่มเกมถัดไป"
                  className={`flex h-7 items-center gap-1.5 border px-2.5 font-display text-xs font-bold transition-colors disabled:pointer-events-none disabled:opacity-35 ${
                    isDraftComplete
                      ? "border-gold bg-gold text-bg hover:bg-gold/90"
                      : "border-good/60 bg-good/15 text-good hover:bg-good hover:text-bg"
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>จบเกมนี้ → บันทึก Global Ban & สลับฝั่งเริ่ม G{Math.min(globalBans.gameNumber + 1, 7)}</span>
                </button>
              </div>
            </section>

            <DraftTimeline stepHeroes={stepHeroes} currentStepIndex={currentStepIndex} heroMap={heroMap} />

            <div className="grid grid-cols-2 gap-x-2 gap-y-4 sm:gap-4 xl:grid-cols-[minmax(260px,1fr)_minmax(0,2.3fr)_minmax(260px,1fr)]">
              <div className="xl:order-1">
                <TeamColumn
                  side="blue"
                  teamName={bName}
                  picks={bluePicks}
                  bans={blueBans}
                  usedHeroes={bUsed}
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
              <div className="xl:order-3">
                <TeamColumn
                  side="red"
                  teamName={rName}
                  picks={redPicks}
                  bans={redBans}
                  usedHeroes={rUsed}
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

              <div className="flex min-w-0 flex-col gap-4 col-span-2 xl:order-2 xl:col-span-1">
                <AiPanel
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
          </main>
        </>
      )}
      </ErrorBoundary>

      <footer className="border-t border-line px-4 py-3">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-dim">
          <span>RoV Pro Draft Intelligence · 2-layer Hero GNN + Sequence Transformer</span>
          <span className="hidden sm:inline">
            <kbd className="text-muted">/</kbd> search · <kbd className="text-muted">Enter</kbd> lock #1 ·{" "}
            <kbd className="text-muted">Ctrl+Z</kbd> undo
          </span>
        </div>
      </footer>
    </div>
  );
}

export default App;

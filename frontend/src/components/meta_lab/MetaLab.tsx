import { ArrowDownToLine, Calculator, RotateCcw, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useDraft } from "../../hooks/useDraft";
import type { GlobalBanState, Hero } from "../../types/draft";
import {
  blueTeamName,
  blueUsedHeroes,
  getGameUnlockStatus,
  getMaxUnlockedGame,
  heroOriginGameMap,
  redTeamName,
  redUsedHeroes,
  resolveSeriesName,
} from "../../utils/draft";
import { Alert } from "../Alert";
import { AiPanel } from "../AiPanel";
import { GlobalBanModal, type GlobalBanCategoryKey } from "../GlobalBanModal";
import { HeroGrid } from "../HeroGrid";
import { ScoreBar } from "../ScoreBar";
import { TeamColumn } from "../TeamColumn";

interface MetaLabProps {
  heroMap: Map<string, Hero>;
  mainBluePicks?: string[];
  mainRedPicks?: string[];
  mainBlueBans?: string[];
  mainRedBans?: string[];
  mainGlobalBans?: GlobalBanState;
}

type MobileDraftView = "draft" | "ai" | "teams";

export function MetaLab({
  heroMap,
  mainBluePicks = [],
  mainRedPicks = [],
  mainBlueBans = [],
  mainRedBans = [],
  mainGlobalBans,
}: MetaLabProps) {
  const [mobileView, setMobileView] = useState<MobileDraftView>("draft");
  const [globalBanModalCat, setGlobalBanModalCat] = useState<GlobalBanCategoryKey | null>(null);
  const [importNotification, setImportNotification] = useState<string | null>(null);

  // Initialize independent Draft state powered purely by empirical matrix rules
  const {
    heroes,
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
    unavailableHeroes,
    lockHero,
    undo,
    reset,
    canUndo,
    importDraft,
  } = useDraft({
    engine: "matrix",
    persistSession: false,
    storageKey: "rov_matrix_draft_v1",
  });

  const bName = blueTeamName(globalBans);
  const rName = redTeamName(globalBans);
  const bUsed = useMemo(() => blueUsedHeroes(globalBans), [globalBans]);
  const rUsed = useMemo(() => redUsedHeroes(globalBans), [globalBans]);
  const blueCategoryKey: GlobalBanCategoryKey = globalBans.blueSideTeam === "A" ? "teamAUsed" : "teamBUsed";
  const redCategoryKey: GlobalBanCategoryKey = globalBans.blueSideTeam === "A" ? "teamBUsed" : "teamAUsed";

  const originMap = useMemo(
    () => heroOriginGameMap(seriesGames, resolveSeriesName(globalBans)),
    [seriesGames, globalBans],
  );
  const blueOriginGames = globalBans.blueSideTeam === "A" ? originMap.teamAGameByHero : originMap.teamBGameByHero;
  const redOriginGames = globalBans.blueSideTeam === "A" ? originMap.teamBGameByHero : originMap.teamAGameByHero;

  const recommendedRanks = useMemo(() => {
    const map = new Map<string, number>();
    recommendations.forEach((r, idx) => map.set(r.hero_name, idx + 1));
    return map;
  }, [recommendations]);

  const hasMainGlobalBans =
    !!mainGlobalBans &&
    (mainGlobalBans.teamAUsed.length +
      mainGlobalBans.teamBUsed.length +
      mainGlobalBans.universalBans.length >
      0 ||
      mainGlobalBans.gameNumber > 1);
  const hasMainPicks =
    mainBluePicks.length + mainRedPicks.length + mainBlueBans.length + mainRedBans.length > 0 ||
    hasMainGlobalBans;

  const handleImport = () => {
    importDraft({
      bluePicks: mainBluePicks,
      redPicks: mainRedPicks,
      blueBans: mainBlueBans,
      redBans: mainRedBans,
      globalBans: mainGlobalBans,
    });
    setImportNotification("ดึงสถานะจากกระดานหลักเรียบร้อยแล้ว!");
    setTimeout(() => setImportNotification(null), 3000);
  };

  const removeUsedHero = (catKey: "teamAUsed" | "teamBUsed", heroName: string) => {
    setGlobalBans((prev) => {
      const candidate = {
        ...prev,
        [catKey]: prev[catKey].filter((n) => n !== heroName),
      };
      const statusAfter = getGameUnlockStatus(prev.gameNumber, candidate, seriesGames);
      if (prev.gameNumber > 1 && !statusAfter.isUnlocked) {
        const maxUnlocked = getMaxUnlockedGame(candidate, seriesGames);
        return {
          ...candidate,
          gameNumber: maxUnlocked,
        };
      }
      return candidate;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-bg">
      {/* Matrix Draft Engine Header Banner */}
      <header className="shrink-0 border-b border-line bg-panel/80 px-2 py-1.5 backdrop-blur-md sm:px-4 sm:py-2">
        <div className="mx-auto flex max-w-[1920px] flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-accent/60 bg-accent/15 text-accent">
              <Calculator className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-display text-xs font-bold tracking-wide text-ink sm:text-sm">
                  Matrix & Rule Draft
                </span>
                <span className="shrink-0 border border-gold/40 bg-gold/10 px-1.5 py-0.2 font-mono text-[9px] font-bold text-gold uppercase">
                  Zero-Neural
                </span>
              </div>
              <p className="truncate font-mono text-[10px] text-muted sm:text-xs">
                คำนวณจาก Synergy Matrix + Counter Matrix + สถิติโปร 4,208 เกมโดยตรง (ไม่ใช้โมเดล Deep Learning)
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {importNotification && (
              <span className="animate-fade-in font-display text-xs font-semibold text-good">
                {importNotification}
              </span>
            )}
            <button
              type="button"
              disabled={!hasMainPicks}
              onClick={handleImport}
              title={
                hasMainPicks
                  ? "คัดลอกฮีโร่ที่เลือกและแบนจากหน้าดราฟต์หลักมาทดสอบด้วยระบบสถิติ Matrix"
                  : "หน้าดราฟต์หลักยังไม่มีการเลือกฮีโร่"
              }
              className="flex h-7.5 items-center gap-1.5 border border-gold/60 bg-gold/10 px-2.5 font-display text-xs font-bold text-gold transition-colors hover:bg-gold hover:text-bg disabled:pointer-events-none disabled:opacity-40"
            >
              <ArrowDownToLine className="h-3.5 w-3.5 shrink-0" />
              <span>ดึงจากกระดานหลัก</span>
            </button>

            <button
              type="button"
              onClick={reset}
              title="ล้างกระดาน Matrix Draft"
              className="flex h-7.5 items-center gap-1.5 border border-line-strong bg-panel px-2.5 font-display text-xs font-semibold text-muted transition-colors hover:border-red/60 hover:text-red"
            >
              <RotateCcw className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">ล้าง</span>
            </button>
          </div>
        </div>
      </header>

      {/* ScoreBar Controls */}
      <ScoreBar
        blueWinRate={blueWinRate}
        isLoading={isLoading}
        currentStep={currentStep}
        currentStepIndex={currentStepIndex}
        totalSteps={totalSteps}
        useLookahead={false}
        setUseLookahead={() => {}}
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

      {/* Main Draft Workspace */}
      <main className="mx-auto flex min-h-0 w-full max-w-[1920px] flex-1 flex-col gap-1.5 overflow-hidden px-2 py-1.5 sm:px-3 sm:py-2">
        {error && (
          <div className="shrink-0">
            <Alert>{error}</Alert>
          </div>
        )}
        {heroesFallback && (
          <div className="shrink-0">
            <Alert tone="warning">
              โหลดข้อมูลฮีโร่จากเซิร์ฟเวอร์ไม่ได้ — ใช้รายชื่อสำรอง
            </Alert>
          </div>
        )}

        {/* Compact Matchup HUD for Mobile (< lg) */}
        <div
          className={`shrink-0 grid-cols-2 gap-1.5 sm:gap-2 lg:hidden ${
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

        {/* Mobile Full Teams View */}
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

        {/* 3-Column Split-View / Desktop Board */}
        <div
          className={`min-h-0 flex-1 flex-col gap-2 md:grid md:grid-cols-12 md:gap-3 lg:grid-cols-[240px_minmax(0,1fr)_240px] lg:gap-3 xl:grid-cols-[300px_minmax(0,1fr)_300px] xl:gap-3.5 2xl:grid-cols-[340px_minmax(0,1fr)_340px] ${
            mobileView === "teams" ? "hidden md:grid" : "flex"
          }`}
        >
          {/* Desktop Left: Blue Team Board */}
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

          {/* Desktop Right: Red Team Board */}
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

          {/* Center Workspace: Matrix Recommendations + Hero Grid */}
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 md:col-span-12 md:grid md:grid-cols-12 md:gap-2.5 lg:order-2 lg:col-span-1 lg:flex lg:flex-col lg:gap-2">
            {/* Quick Ribbon on mobile draft view */}
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
                  useLookahead={false}
                  blueWinRate={blueWinRate}
                  winHistory={winHistory}
                  onLockHero={lockHero}
                />
              </div>
            )}

            {/* Matrix Recommendations Deck */}
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
                useLookahead={false}
                blueWinRate={blueWinRate}
                winHistory={winHistory}
                onLockHero={lockHero}
              />
            </div>

            {/* Hero Selection Grid */}
            <div
              className={`min-h-0 flex-col md:col-span-7 md:flex lg:min-h-0 lg:flex-1 ${
                mobileView === "draft" ? "flex flex-1" : "hidden"
              }`}
            >
              <HeroGrid
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

      {/* Mobile Bottom Navigation */}
      <footer className="shrink-0 border-t border-line bg-panel/95 px-2 py-1 backdrop-blur-md md:hidden">
        <div className="grid grid-cols-3 gap-1">
          <button
            type="button"
            onClick={() => setMobileView("draft")}
            className={`flex h-8 items-center justify-center gap-1 font-display text-xs font-bold tracking-wider uppercase transition-colors ${
              mobileView === "draft"
                ? "border border-gold/60 bg-gold/15 text-gold"
                : "border border-line text-muted hover:text-ink"
            }`}
          >
            <span>กระดาน</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileView("ai")}
            className={`flex h-8 items-center justify-center gap-1 font-display text-xs font-bold tracking-wider uppercase transition-colors ${
              mobileView === "ai"
                ? "border border-gold/60 bg-gold/15 text-gold"
                : "border border-line text-muted hover:text-ink"
            }`}
          >
            <Sparkles className="h-3 w-3" />
            <span>สถิติแนะนำ</span>
            {recommendations.length > 0 && (
              <span className="ml-1 bg-gold px-1 font-mono text-[9px] font-bold text-bg">
                {recommendations.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setMobileView("teams")}
            className={`flex h-8 items-center justify-center gap-1 font-display text-xs font-bold tracking-wider uppercase transition-colors ${
              mobileView === "teams"
                ? "border border-gold/60 bg-gold/15 text-gold"
                : "border border-line text-muted hover:text-ink"
            }`}
          >
            <span>ทั้ง 2 ทีม</span>
          </button>
        </div>
      </footer>
    </div>
  );
}

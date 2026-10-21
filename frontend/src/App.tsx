import { useEffect, useMemo, useRef, useState } from "react";
import { AiPanel } from "./components/AiPanel";
import { Alert } from "./components/Alert";
import { DraftTimeline } from "./components/DraftTimeline";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { HeroGrid } from "./components/HeroGrid";
import { CombatLab } from "./components/lab/CombatLab";
import { ScoreBar } from "./components/ScoreBar";
import { TeamColumn } from "./components/TeamColumn";
import { useDraft } from "./hooks/useDraft";
import { heroesByStep } from "./utils/draft";

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

  // Keyboard shortcuts: "/" focus search, Enter lock top suggestion, Ctrl/Cmd+Z undo
  useEffect(() => {
    if (tab !== "draft") return;
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
  }, [tab, undo, lockHero, recommendations, currentStep, isLoading, unavailableHeroes]);

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
            onUndo={undo}
            onReset={reset}
            canUndo={canUndo}
          />

          <main className="mx-auto flex w-full max-w-[1680px] flex-1 flex-col gap-4 px-4 py-4">
            {error && <Alert>{error}</Alert>}
            {heroesFallback && (
              <Alert tone="warning">โหลดข้อมูลฮีโร่จากเซิร์ฟเวอร์ไม่ได้ — ใช้รายชื่อสำรอง บทบาทและเลนอาจไม่ถูกต้อง</Alert>
            )}

            <DraftTimeline stepHeroes={stepHeroes} currentStepIndex={currentStepIndex} heroMap={heroMap} />

            <div className="grid grid-cols-2 gap-x-2 gap-y-4 sm:gap-4 xl:grid-cols-[minmax(260px,1fr)_minmax(0,2.3fr)_minmax(260px,1fr)]">
              <div className="xl:order-1">
                <TeamColumn
                  side="blue"
                  picks={bluePicks}
                  bans={blueBans}
                  heroMap={heroMap}
                  currentStep={currentStep}
                  predictedNextPicks={blueNextPicks}
                  predictedNextBans={blueNextBans}
                  onLockHero={lockHero}
                />
              </div>
              <div className="xl:order-3">
                <TeamColumn
                  side="red"
                  picks={redPicks}
                  bans={redBans}
                  heroMap={heroMap}
                  currentStep={currentStep}
                  predictedNextPicks={redNextPicks}
                  predictedNextBans={redNextBans}
                  onLockHero={lockHero}
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

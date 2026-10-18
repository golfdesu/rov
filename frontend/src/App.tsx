import { useEffect, useMemo, useRef } from "react";
import { AiPanel } from "./components/AiPanel";
import { DraftTimeline } from "./components/DraftTimeline";
import { HeroGrid } from "./components/HeroGrid";
import { ScoreBar } from "./components/ScoreBar";
import { TeamColumn } from "./components/TeamColumn";
import { useDraft } from "./hooks/useDraft";
import { heroesByStep } from "./utils/draft";

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
    missingAllyLanes,
    blueWinRate,
    winHistory,
    isLoading,
    isHeroesLoading,
    error,
    lockHero,
    undo,
    reset,
    canUndo,
  } = useDraft();

  const searchRef = useRef<HTMLInputElement>(null);

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
  }, [undo, lockHero, recommendations, currentStep, isLoading, unavailableHeroes]);

  return (
    <div className="flex min-h-screen flex-col">
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
        {error && (
          <div role="alert" className="border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            {error}
          </div>
        )}

        <DraftTimeline stepHeroes={stepHeroes} currentStepIndex={currentStepIndex} heroMap={heroMap} />

        <div className="grid grid-cols-2 gap-x-2 gap-y-4 sm:gap-4 xl:grid-cols-[minmax(260px,1fr)_minmax(0,2.3fr)_minmax(260px,1fr)]">
          <div className="xl:order-1">
            <TeamColumn side="blue" picks={bluePicks} bans={blueBans} heroMap={heroMap} currentStep={currentStep} />
          </div>
          <div className="xl:order-3">
            <TeamColumn side="red" picks={redPicks} bans={redBans} heroMap={heroMap} currentStep={currentStep} />
          </div>

          <div className="flex min-w-0 flex-col gap-4 col-span-2 xl:order-2 xl:col-span-1">
            <AiPanel
              recommendations={recommendations}
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

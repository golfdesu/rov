import { useState } from "react";
import { DraftBoardView } from "./components/DraftBoardView";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CombatLab } from "./components/lab/CombatLab";
import { MetaLab } from "./components/meta_lab/MetaLab";
import { TierListView } from "./components/tierlist/TierListView";
import { useDraft } from "./hooks/useDraft";

export type Tab = "draft" | "tierlist" | "metalab" | "lab";

const TABS: { key: Tab; label: string }[] = [
  { key: "draft", label: "Draft Board" },
  { key: "tierlist", label: "Meta Tier List" },
  { key: "metalab", label: "MetaLab" },
  { key: "lab", label: "Combat Lab" },
];

function initialTab(): Tab {
  if (window.location.hash === "#tierlist") return "tierlist";
  if (window.location.hash === "#metalab") return "metalab";
  if (window.location.hash === "#lab") return "lab";
  return "draft";
}

export function App() {
  const [tab, setTab] = useState<Tab>(initialTab);

  // Unified Draft Machine with dynamic engine selection (SOTA / Heuristic / Matrix)
  const draft = useDraft({
    engine: window.location.hash.includes("heuristic") ? "heuristic" : "sota",
    storageKey: "rov_draft_session_v1",
    persistSession: true,
    enabled: tab === "draft",
  });

  const selectTab = (next: Tab) => {
    setTab(next);
    window.history.replaceState(null, "", next === "draft" ? "#" : `#${next}`);
  };

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-bg">
      {/* Unified Top Navigation */}
      <nav className="shrink-0 border-b border-line bg-panel/90" aria-label="โหมด">
        <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-2 overflow-x-auto px-3 sm:px-4">
          <div className="flex shrink-0 items-center gap-1">
            {TABS.map((t) => (
              <button
                type="button"
                key={t.key}
                onClick={() => selectTab(t.key)}
                aria-current={tab === t.key ? "page" : undefined}
                className={`border-b-2 px-3 py-2 font-display text-xs sm:text-sm font-semibold tracking-wide whitespace-nowrap transition-colors ${
                  tab === t.key ? "border-gold text-ink" : "border-transparent text-dim hover:text-muted"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <ErrorBoundary resetKey={tab}>
        {tab === "tierlist" ? (
          <TierListView heroes={draft.heroes} />
        ) : tab === "metalab" ? (
          <MetaLab
            heroMap={draft.heroMap}
            mainBluePicks={draft.bluePicks}
            mainRedPicks={draft.redPicks}
            mainBlueBans={draft.blueBans}
            mainRedBans={draft.redBans}
            mainGlobalBans={draft.globalBans}
            mainSeriesGames={draft.seriesGames}
          />
        ) : tab === "lab" ? (
          <main className="mx-auto w-full max-w-[1680px] flex-1 overflow-y-auto px-4 py-4">
            <CombatLab heroMap={draft.heroMap} />
          </main>
        ) : (
          <DraftBoardView
            key="draft"
            draft={draft}
            isActiveTab={tab === "draft"}
          />
        )}
      </ErrorBoundary>
    </div>
  );
}

export default App;

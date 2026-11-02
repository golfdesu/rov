import { useState } from "react";
import { DraftBoardView } from "./components/DraftBoardView";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CombatLab } from "./components/lab/CombatLab";
import { MetaLab } from "./components/meta_lab/MetaLab";
import { useDraft } from "./hooks/useDraft";

export type Tab = "draft" | "heuristic" | "metalab" | "lab";

const TABS: { key: Tab; label: string }[] = [
  { key: "draft", label: "ดราฟต์ (SOTA True Order 51.3%)" },
  { key: "heuristic", label: "ดราฟต์ (Liquipedia 0% Order)" },
  { key: "metalab", label: "Matrix Draft (สถิติ & กฎ)" },
  { key: "lab", label: "Stat & Duel Lab" },
];

function initialTab(): Tab {
  if (window.location.hash === "#heuristic" || window.location.hash === "#heuristic-draft") return "heuristic";
  if (window.location.hash === "#metalab") return "metalab";
  if (window.location.hash === "#lab") return "lab";
  return "draft";
}

export function App() {
  const [tab, setTab] = useState<Tab>(initialTab);

  // Production SOTA Draft Engine (True Order 51.3%)
  const sotaDraft = useDraft({
    engine: "sota",
    storageKey: "rov_draft_session_v1",
    persistSession: true,
  });

  // Heuristic Draft Engine (0% True Order from Liquipedia)
  const heuristicDraft = useDraft({
    engine: "heuristic",
    storageKey: "rov_draft_session_heuristic",
    persistSession: false,
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
                  tab === t.key
                    ? t.key === "heuristic"
                      ? "border-amber-400 text-amber-400"
                      : "border-gold text-ink"
                    : "border-transparent text-dim hover:text-muted"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <ErrorBoundary resetKey={tab}>
        {tab === "metalab" ? (
          <MetaLab
            heroMap={sotaDraft.heroMap}
            mainBluePicks={sotaDraft.bluePicks}
            mainRedPicks={sotaDraft.redPicks}
            mainBlueBans={sotaDraft.blueBans}
            mainRedBans={sotaDraft.redBans}
            mainGlobalBans={sotaDraft.globalBans}
            mainSeriesGames={sotaDraft.seriesGames}
          />
        ) : tab === "lab" ? (
          <main className="mx-auto w-full max-w-[1680px] flex-1 overflow-y-auto px-4 py-4">
            <CombatLab heroMap={sotaDraft.heroMap} />
          </main>
        ) : tab === "heuristic" ? (
          <DraftBoardView
            draft={heuristicDraft}
            modelVariant="heuristic"
            modelBadge="⚡ Liquipedia Heuristic (0% True Order)"
            modelTooltip="Heuristic Model trained on 2025-2026 pro games with 0% True Pick Order (reconstructed via lane heuristics only)"
            isActiveTab={tab === "heuristic"}
          />
        ) : (
          <DraftBoardView
            draft={sotaDraft}
            modelVariant="sota"
            modelBadge="👑 SOTA Production (51.3% True Order)"
            modelTooltip="Production SOTA RoVDraftGNNTransformer trained on 2025-2026 pro games with 51.3% verified chronological True Pick Order from broadcast screenshots"
            isActiveTab={tab === "draft"}
          />
        )}
      </ErrorBoundary>
    </div>
  );
}

export default App;

import { LogIn, LogOut, User } from "lucide-react";
import { useEffect, useState } from "react";
import { getJson, postJson } from "./api/client";
import { AuthModal } from "./components/AuthModal";
import { DraftBoardView } from "./components/DraftBoardView";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CombatLab } from "./components/lab/CombatLab";
import { MetaLab } from "./components/meta_lab/MetaLab";
import { TierListView } from "./components/tierlist/TierListView";
import { useDraft } from "./hooks/useDraft";
import type { AuthStatusResponse, AuthUser } from "./types/auth";

export type Tab = "draft" | "tierlist" | "metalab" | "lab";

const DRAFT_ONLY = import.meta.env.VITE_DRAFT_ONLY === "true";

const ALL_TABS: { key: Tab; label: string }[] = [
  { key: "draft", label: "Draft Board" },
  { key: "tierlist", label: "Meta Tier List" },
  { key: "metalab", label: "MetaLab" },
  { key: "lab", label: "Combat Lab" },
];

const TABS = DRAFT_ONLY ? ALL_TABS.filter((t) => t.key === "draft") : ALL_TABS;

function initialTab(): Tab {
  if (DRAFT_ONLY) return "draft";
  if (window.location.hash === "#tierlist") return "tierlist";
  if (window.location.hash === "#metalab") return "metalab";
  if (window.location.hash === "#lab") return "lab";
  return "draft";
}

interface WorkspaceProps {
  tab: Tab;
  selectTab: (next: Tab) => void;
  authUser: AuthUser | null;
  authLoading: boolean;
  onOpenAuthModal: () => void;
  onLogout: () => void;
}

function Workspace({
  tab,
  selectTab,
  authUser,
  authLoading,
  onOpenAuthModal,
  onLogout,
}: WorkspaceProps) {
  const isAuthenticated = authUser !== null;
  const scope = isAuthenticated ? `user:${authUser.username}` : "guest";

  // Unified Draft Machine isolated per user account (or local-only in Guest mode)
  const draft = useDraft({
    engine: window.location.hash.includes("heuristic") ? "heuristic" : "sota",
    storageKey: `rov_draft_session_v1:${scope}`,
    persistSession: isAuthenticated,
    enabled: tab === "draft",
  });

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-bg">
      {/* Unified Top Navigation */}
      <nav className="shrink-0 border-b border-line bg-panel/90" aria-label="โหมด">
        <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-2 px-2.5 sm:px-4">
          <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto sm:gap-1">
            {TABS.map((t) => (
              <button
                type="button"
                key={t.key}
                onClick={() => selectTab(t.key)}
                aria-current={tab === t.key ? "page" : undefined}
                className={`border-b-2 px-2.5 py-2 font-display text-xs font-semibold tracking-wide whitespace-nowrap transition-colors sm:px-3 sm:text-sm ${
                  tab === t.key ? "border-gold text-ink" : "border-transparent text-dim hover:text-muted"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {authLoading ? null : isAuthenticated ? (
              <div className="flex items-center gap-1">
                <span
                  title={`กำลังซิงก์ข้อมูลข้ามอุปกรณ์ด้วยบัญชี @${authUser.username}`}
                  className="inline-flex h-7 items-center gap-1 border border-good/40 bg-good/10 px-2 font-mono text-[10.5px] font-bold text-good"
                >
                  <User className="h-3 w-3 shrink-0" />
                  <span className="max-w-[90px] truncate sm:max-w-[140px]">@{authUser.username}</span>
                </span>
                <button
                  type="button"
                  onClick={onLogout}
                  title="ออกจากระบบ (สลับกลับโหมด Guest เฉพาะเครื่อง)"
                  aria-label="ออกจากระบบ"
                  className="inline-flex h-7 items-center gap-1 border border-line bg-bg px-2 font-display text-[11px] font-semibold text-muted transition-colors hover:border-red/60 hover:text-red"
                >
                  <LogOut className="h-3 w-3 shrink-0" />
                  <span className="hidden sm:inline">ออก</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onOpenAuthModal}
                title="เข้าสู่ระบบหรือสมัครสมาชิก เพื่อแยกฐานข้อมูลส่วนตัวและซิงก์ข้าม PC / iPad / มือถือ"
                className="inline-flex h-7 items-center gap-1 border border-gold/50 bg-gold/10 px-2 font-display text-[11px] font-bold text-gold transition-colors hover:bg-gold hover:text-bg"
              >
                <LogIn className="h-3 w-3 shrink-0" />
                <span className="hidden sm:inline">เข้าสู่ระบบ / ซิงก์</span>
                <span className="sm:hidden">เข้าสู่ระบบ</span>
              </button>
            )}
          </div>
        </div>
      </nav>

      <ErrorBoundary resetKey={`${tab}:${scope}`}>
        {!DRAFT_ONLY && tab === "tierlist" ? (
          <TierListView heroes={draft.heroes} />
        ) : !DRAFT_ONLY && tab === "metalab" ? (
          <MetaLab
            heroMap={draft.heroMap}
            mainBluePicks={draft.bluePicks}
            mainRedPicks={draft.redPicks}
            mainBlueBans={draft.blueBans}
            mainRedBans={draft.redBans}
            mainGlobalBans={draft.globalBans}
            mainSeriesGames={draft.seriesGames}
          />
        ) : !DRAFT_ONLY && tab === "lab" ? (
          <main className="mx-auto w-full max-w-[1680px] flex-1 overflow-y-auto px-4 py-4">
            <CombatLab
              key={scope}
              heroMap={draft.heroMap}
              storageKey={`rov-combat-lab-v1:${scope}`}
              persistRemote={isAuthenticated}
            />
          </main>
        ) : (
          <DraftBoardView
            key={`draft:${scope}`}
            draft={draft}
            isActiveTab={tab === "draft"}
          />
        )}
      </ErrorBoundary>
    </div>
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    getJson<AuthStatusResponse>("/auth/me", ctrl.signal)
      .then((res) => {
        if (res.authenticated && res.user) {
          setAuthUser(res.user);
        } else {
          setAuthUser(null);
        }
      })
      .catch(() => {
        setAuthUser(null);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setAuthLoading(false);
      });
    return () => ctrl.abort();
  }, []);

  const selectTab = (next: Tab) => {
    setTab(next);
    window.history.replaceState(null, "", next === "draft" ? "#" : `#${next}`);
  };

  const handleLogout = async () => {
    try {
      await postJson<AuthStatusResponse>("/auth/logout", {});
    } catch {
      // clear client state regardless
    }
    setAuthUser(null);
  };

  const workspaceKey = authUser ? `user:${authUser.username}` : "guest";

  return (
    <>
      <Workspace
        key={workspaceKey}
        tab={tab}
        selectTab={selectTab}
        authUser={authUser}
        authLoading={authLoading}
        onOpenAuthModal={() => setAuthModalOpen(true)}
        onLogout={handleLogout}
      />
      {authModalOpen && (
        <AuthModal
          onSuccess={(user) => {
            setAuthUser(user);
            setAuthModalOpen(false);
          }}
          onClose={() => setAuthModalOpen(false)}
        />
      )}
    </>
  );
}

export default App;

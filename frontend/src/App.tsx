import { LogIn, LogOut, User } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getJson, postJson, setExpectedAuthUser, setSessionMismatchHandler } from "./api/client";
import { AuthLanding, AuthModal } from "./components/AuthModal";
import { DraftBoardView } from "./components/DraftBoardView";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MiniDraftLogo } from "./components/MiniDraftLogo";
import { CombatLab } from "./components/lab/CombatLab";
import { MetaLab } from "./components/meta_lab/MetaLab";
import { TierListView } from "./components/tierlist/TierListView";
import { useDraft } from "./hooks/useDraft";
import type { AuthStatusResponse, AuthUser } from "./types/auth";

export type Tab = "draft" | "tierlist" | "metalab" | "lab";

const DRAFT_ONLY = import.meta.env.VITE_DRAFT_ONLY === "true";

const TABS: { key: Tab; label: string }[] = DRAFT_ONLY
  ? [{ key: "draft", label: "Draft Board" }]
  : [
      { key: "draft", label: "Draft Board" },
      { key: "tierlist", label: "Meta Tier List" },
      { key: "metalab", label: "MetaLab" },
      { key: "lab", label: "Combat Lab" },
    ];

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
  disableShortcuts: boolean;
  onOpenAuthModal: () => void;
  onLogout: () => void;
}

function Workspace({
  tab,
  selectTab,
  authUser,
  authLoading,
  disableShortcuts,
  onOpenAuthModal,
  onLogout,
}: WorkspaceProps) {
  const isAuthenticated = authUser !== null;
  const scope = isAuthenticated ? `user:${authUser.username}` : "guest";

  // Unified Draft Machine isolated per user account (or local-only in Guest mode)
  const draft = useDraft({
    storageKey: `rov_draft_session_v1:${scope}`,
    persistSession: isAuthenticated,
    enabled: tab === "draft",
  });

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-bg">
      {/* Unified Top Navigation */}
      <nav className="shrink-0 border-b border-line bg-panel/90" aria-label="โหมด">
        <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-2 px-2.5 sm:px-4">
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto sm:gap-3">
            <div className="flex shrink-0 items-center gap-1.5 border-r border-line pr-2.5 sm:pr-3">
              <MiniDraftLogo className="h-6 w-6 shrink-0" />
              <span className="font-display text-xs font-extrabold tracking-widest text-ink sm:text-sm">
                MINI<span className="text-gold">DRAFT</span>
              </span>
            </div>
            <div className="flex min-w-0 items-center gap-0.5 sm:gap-1">
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
                <span>เข้าสู่ระบบ</span>
              </button>
            )}
          </div>
        </div>
      </nav>

      <ErrorBoundary resetKey={`${tab}:${scope}`}>
        {!DRAFT_ONLY && tab === "tierlist" ? (
          <TierListView heroes={draft.heroes} disableShortcuts={disableShortcuts} />
        ) : !DRAFT_ONLY && tab === "metalab" ? (
          <MetaLab
            heroMap={draft.heroMap}
            mainBluePicks={draft.bluePicks}
            mainRedPicks={draft.redPicks}
            mainBlueBans={draft.blueBans}
            mainRedBans={draft.redBans}
            mainGlobalBans={draft.globalBans}
            mainSeriesGames={draft.seriesGames}
            disableShortcuts={disableShortcuts}
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
            disableShortcuts={disableShortcuts}
          />
        )}
      </ErrorBoundary>
    </div>
  );
}

const GUEST_ENTERED_STORAGE_KEY = "minidraft_guest_entered_v1";
const AUTH_SYNC_STORAGE_KEY = "minidraft_auth_user_sync_v1";
const DRAFT_STORAGE_PREFIX = "rov_draft_session_v1";

function loadGuestEntered(): boolean {
  try {
    return window.localStorage.getItem(GUEST_ENTERED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveGuestEntered(enabled: boolean): void {
  try {
    if (enabled) {
      window.localStorage.setItem(GUEST_ENTERED_STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(GUEST_ENTERED_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota/privacy restrictions
  }
}

function broadcastAuthChange(username: string | null): void {
  try {
    window.localStorage.setItem(
      AUTH_SYNC_STORAGE_KEY,
      JSON.stringify({ username, at: Date.now() }),
    );
  } catch {
    // Ignore storage errors
  }
}

function maybeMigrateGuestDraft(username: string): void {
  try {
    const guestKey = `${DRAFT_STORAGE_PREFIX}:guest`;
    const raw = window.localStorage.getItem(guestKey);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      bluePicks?: unknown[];
      redPicks?: unknown[];
      blueBans?: unknown[];
      redBans?: unknown[];
      seriesGames?: unknown[];
      globalBans?: { teamAUsed?: unknown[]; teamBUsed?: unknown[]; universalBans?: unknown[] };
    };
    const hasDraft =
      (parsed.bluePicks?.length ?? 0) +
        (parsed.redPicks?.length ?? 0) +
        (parsed.blueBans?.length ?? 0) +
        (parsed.redBans?.length ?? 0) +
        (parsed.seriesGames?.length ?? 0) +
        (parsed.globalBans?.teamAUsed?.length ?? 0) +
        (parsed.globalBans?.teamBUsed?.length ?? 0) +
        (parsed.globalBans?.universalBans?.length ?? 0) >
      0;
    if (!hasDraft) return;
    const shouldImport = window.confirm(
      `พบข้อมูลดราฟต์หรือประวัติที่ทำค้างไว้ในโหมด Guest — ต้องการย้ายมาใช้งานต่อในบัญชี @${username} หรือไม่?\n\n(กด ตกลง เพื่อนำเข้าสู่บัญชีนี้ / กด ยกเลิก เพื่อโหลดข้อมูลเดิมของบัญชี)`,
    );
    if (shouldImport) {
      const migrated = { ...parsed, updatedAt: Date.now() };
      window.localStorage.setItem(`${DRAFT_STORAGE_PREFIX}:user:${username}`, JSON.stringify(migrated));
      window.localStorage.removeItem(guestKey);
    }
  } catch {
    // Ignore storage or JSON errors
  }
}

function formatOAuthError(code: string | null): string | null {
  if (!code) return null;
  if (code === "google_cancelled") return "ยกเลิกการเข้าสู่ระบบด้วย Google";
  if (code === "discord_cancelled") return "ยกเลิกการเข้าสู่ระบบด้วย Discord";
  if (code === "discord_invalid_state") return "การยืนยันตัวตน Discord หมดอายุ กรุณาลองใหม่อีกครั้ง";
  if (code === "discord_failed" || code === "discord_unavailable") {
    return "ไม่สามารถเข้าสู่ระบบด้วย Discord ได้ กรุณาลองใหม่อีกครั้ง";
  }
  if (code === "invalid_state") return "การยืนยันตัวตนหมดอายุ กรุณาลองใหม่อีกครั้ง";
  if (code === "email_unverified") return "อีเมล Google ของคุณยังไม่ได้ยืนยันตัวตน";
  if (code === "registration_full") return "ขณะนี้เซิร์ฟเวอร์มีผู้สมัครเต็มโควต้าชั่วคราว";
  if (code === "rate_limited") return "ลองเข้าสู่ระบบถี่เกินไป กรุณารอสักครู่แล้วลองใหม่";
  return "ไม่สามารถเข้าสู่ระบบด้วยบัญชีภายนอกได้ กรุณาลองใหม่อีกครั้ง";
}

export function App() {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const authUserRef = useRef<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [googleLoginEnabled, setGoogleLoginEnabled] = useState(false);
  const [discordLoginEnabled, setDiscordLoginEnabled] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(() => {
    const err = new URLSearchParams(window.location.search).get("auth_error");
    return formatOAuthError(err);
  });
  const [guestEntered, setGuestEntered] = useState<boolean>(loadGuestEntered);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(() => Boolean(oauthError && loadGuestEntered()));

  const updateGuestEntered = useCallback((enabled: boolean) => {
    saveGuestEntered(enabled);
    setGuestEntered(enabled);
  }, []);

  const applyAuthenticatedUser = useCallback(
    (user: AuthUser, fromGuestFlow: boolean) => {
      if (fromGuestFlow) {
        maybeMigrateGuestDraft(user.username);
      }
      setExpectedAuthUser(user.username);
      setOauthError(null);
      setAuthUser(user);
      updateGuestEntered(false);
      setAuthModalOpen(false);
      broadcastAuthChange(user.username);
    },
    [updateGuestEntered],
  );

  // Strip ?auth_error=... in an effect so React StrictMode double-init never erases the initial error
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("auth_error")) return;
    params.delete("auth_error");
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }, []);

  useEffect(() => {
    authUserRef.current = authUser;
    setExpectedAuthUser(authUser?.username ?? null);
  }, [authUser]);

  const refreshAuthSession = useCallback(
    async (signal?: AbortSignal, allowGuestMigration = false) => {
      try {
        const res = await getJson<AuthStatusResponse>("/auth/me", signal);
        setGoogleLoginEnabled(Boolean(res.google_login_enabled));
        setDiscordLoginEnabled(Boolean(res.discord_login_enabled));
        if (res.authenticated && res.user) {
          if (allowGuestMigration && loadGuestEntered()) {
            maybeMigrateGuestDraft(res.user.username);
            updateGuestEntered(false);
          }
          setExpectedAuthUser(res.user.username);
          setAuthUser((prev) => (prev?.username === res.user?.username ? prev : res.user));
        } else {
          setExpectedAuthUser(null);
          if (authUserRef.current !== null) {
            setOauthError("เซสชันหมดอายุหรือถูกออกจากระบบจากอุปกรณ์อื่น กรุณาเข้าสู่ระบบใหม่");
          }
          setAuthUser(null);
        }
      } catch {
        // Keep current client state on transient offline checks during focus refresh
      }
    },
    [updateGuestEntered],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    getJson<AuthStatusResponse>("/auth/me", ctrl.signal)
      .then((res) => {
        setGoogleLoginEnabled(Boolean(res.google_login_enabled));
        setDiscordLoginEnabled(Boolean(res.discord_login_enabled));
        if (res.authenticated && res.user) {
          if (loadGuestEntered()) {
            maybeMigrateGuestDraft(res.user.username);
            updateGuestEntered(false);
          }
          setExpectedAuthUser(res.user.username);
          setAuthUser(res.user);
        } else {
          setExpectedAuthUser(null);
          setAuthUser(null);
        }
      })
      .catch(() => {
        setExpectedAuthUser(null);
        setAuthUser(null);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setAuthLoading(false);
      });
    return () => ctrl.abort();
  }, [updateGuestEntered]);

  // Detect expired/evicted sessions or cross-tab account switches immediately
  useEffect(() => {
    setSessionMismatchHandler((status) => {
      setExpectedAuthUser(null);
      setAuthUser(null);
      updateGuestEntered(false);
      setOauthError(
        status === 409
          ? "ตรวจพบการสลับบัญชีในแท็บอื่น ระบบหยุดการเขียนทับข้อมูลและให้เข้าสู่ระบบใหม่แล้ว"
          : "เซสชันหมดอายุหรือถูกออกจากระบบ กรุณาเข้าสู่ระบบใหม่อีกครั้ง",
      );
    });
    return () => setSessionMismatchHandler(null);
  }, [updateGuestEntered]);

  useEffect(() => {
    if (!authUser) return;
    const onFocusOrVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshAuthSession();
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === AUTH_SYNC_STORAGE_KEY) {
        void refreshAuthSession();
      }
    };
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
      window.removeEventListener("storage", onStorage);
    };
  }, [authUser, refreshAuthSession]);

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
    setExpectedAuthUser(null);
    setAuthUser(null);
    updateGuestEntered(false);
    broadcastAuthChange(null);
  };

  if (authLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
        <div className="border border-line bg-panel px-5 py-3 font-mono text-xs text-muted">
          กำลังตรวจสอบเซสชันผู้ใช้...
        </div>
      </div>
    );
  }

  if (!authUser && !guestEntered) {
    return (
      <AuthLanding
        googleLoginEnabled={googleLoginEnabled}
        discordLoginEnabled={discordLoginEnabled}
        initialError={oauthError}
        onSuccess={(user) => applyAuthenticatedUser(user, false)}
        onContinueGuest={() => {
          setOauthError(null);
          updateGuestEntered(true);
        }}
      />
    );
  }

  const workspaceKey = authUser ? `user:${authUser.username}` : "guest";

  return (
    <>
      <Workspace
        key={workspaceKey}
        tab={tab}
        selectTab={selectTab}
        authUser={authUser}
        authLoading={authLoading}
        disableShortcuts={authModalOpen}
        onOpenAuthModal={() => setAuthModalOpen(true)}
        onLogout={handleLogout}
      />
      {authModalOpen && (
        <AuthModal
          googleLoginEnabled={googleLoginEnabled}
          discordLoginEnabled={discordLoginEnabled}
          initialError={oauthError}
          onSuccess={(user) => applyAuthenticatedUser(user, true)}
          onClose={() => {
            setOauthError(null);
            setAuthModalOpen(false);
          }}
        />
      )}
    </>
  );
}

export default App;

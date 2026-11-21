import { StableButtonLabel } from "./components/StableButtonLabel";
import { type Message, translateMessage, useLanguage } from "./i18n/language";
import { LanguageSwitch } from "./i18n/LanguageProvider";
import { BarChart3, Coffee, LogIn, LogOut, Menu, MessageSquare, User } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiError, getJson, postJson, putJson, setExpectedAuthUser, setSessionMismatchHandler } from "./api/client";
import { AdminStatsModal } from "./components/AdminStatsModal";
import { AuthLanding, AuthModal } from "./components/AuthModal";
import { DonateModal } from "./components/DonateModal";
import { DraftBoardView } from "./components/DraftBoardView";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MiniDraftLogo } from "./components/MiniDraftLogo";
import { MobileNavDrawer } from "./components/MobileNavDrawer";
import { Modal } from "./components/Modal";
import { PricingSurveyModal } from "./components/PricingSurveyModal";
import { PracticeDraftView } from "./components/PracticeDraftView";
import { ProfileView } from "./components/ProfileView";
import { CombatLab } from "./components/lab/CombatLab";
import { MetaLab } from "./components/meta_lab/MetaLab";
import { TierListView } from "./components/tierlist/TierListView";
import { mergeGuestIntoAccountSession, normalizeSessionPayload, useDraft } from "./hooks/useDraft";
import type {
  AuthStatusResponse,
  AuthUser,
  PricingSurveyChoice,
  PricingSurveyResponse,
} from "./types/auth";
import type { DraftSessionPayload } from "./types/draft";
import { accountLabel, restorePreviewAccountStorage } from "./utils/auth";

export type Tab = "draft" | "practice" | "tierlist" | "metalab" | "lab" | "profile";

const DRAFT_ONLY = import.meta.env.VITE_DRAFT_ONLY === "true";

const TABS: { key: Tab; label: string }[] = DRAFT_ONLY
  ? [
      { key: "draft", label: "Draft Board" },
      { key: "practice", label: "ฝึกดราฟต์ vs AI" },
    ]
  : [
      { key: "draft", label: "Draft Board" },
      { key: "practice", label: "ฝึกดราฟต์ vs AI" },
      { key: "tierlist", label: "Meta Tier List" },
      { key: "metalab", label: "MetaLab" },
      { key: "lab", label: "Combat Lab" },
    ];

function initialTab(): Tab {
  if (window.location.hash === "#profile") return "profile";
  if (window.location.hash === "#practice") return "practice";
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
  isAdmin: boolean;
  authLoading: boolean;
  surveyAnswered: boolean;
  disableShortcuts: boolean;
  onOpenAuthModal: () => void;
  onOpenDonateModal: () => void;
  onOpenSurveyModal: () => void;
  onOpenAdminStatsModal: () => void;
  onOpenMobileDrawer: () => void;
  onLogout: () => void;
  onSaveDisplayName: (displayName: string) => Promise<void>;
}

function Workspace({
  tab,
  selectTab,
  authUser,
  isAdmin,
  authLoading,
  surveyAnswered,
  disableShortcuts,
  onOpenAuthModal,
  onOpenDonateModal,
  onOpenSurveyModal,
  onOpenAdminStatsModal,
  onOpenMobileDrawer,
  onLogout,
  onSaveDisplayName,
}: WorkspaceProps) {
  const { t } = useLanguage();
  const isAuthenticated = authUser !== null;
  const accountName = isAuthenticated ? accountLabel(authUser) : "";
  const scope = isAuthenticated ? `user:${authUser.username}` : "guest";
  const activeTabLabel = t(tab === "profile" ? "โปรไฟล์" : TABS.find((item) => item.key === tab)?.label ?? "Draft Board");

  // Unified Draft Machine isolated per user account (or local-only in Guest mode)
  const [assistantEnabled, setAssistantEnabled] = useState(true);
  const draft = useDraft({
    storageKey: `${DRAFT_STORAGE_PREFIX}:${scope}`,
    persistSession: isAuthenticated,
    enabled: tab === "draft" && assistantEnabled,
  });

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-bg">
      {/* Unified Top Navigation */}
      <nav className="shrink-0 border-b border-line bg-panel/90" aria-label={t("โหมด")}>
        <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-2 px-2.5 py-1.5 sm:px-4 lg:py-0">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <div className="flex shrink-0 items-center gap-1.5 lg:border-r lg:border-line lg:pr-3">
              <MiniDraftLogo className="h-6 w-6 shrink-0" />
              <span className="font-display text-xs font-extrabold tracking-widest text-ink sm:text-sm">
                MINI<span className="text-gold">DRAFT</span>
              </span>
            </div>
            <span className="truncate border border-line bg-panel-2/70 px-2 py-0.5 font-display text-[11px] font-semibold text-gold lg:hidden">
              {activeTabLabel}
            </span>
            <div className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto lg:flex">
              {TABS.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  onClick={() => selectTab(item.key)}
                  aria-current={tab === item.key ? "page" : undefined}
                  className={`border-b-2 px-3 py-2 font-display text-sm font-semibold tracking-wide whitespace-nowrap transition-colors ${
                    tab === item.key ? "border-gold text-ink" : "border-transparent text-dim hover:text-muted"
                  }`}
                >
                  {t(item.label)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <LanguageSwitch className="hidden lg:inline-flex lg:self-center" />
            <span className="hidden h-7 items-center border border-gold/40 bg-gold/10 px-2.5 font-mono text-[11px] font-bold text-gold xl:inline-flex">
              <StableButtonLabel message="ให้บริการฟรีถึง 30/11/2026" />
            </span>
            {isAdmin && (
              <button
                type="button"
                onClick={onOpenAdminStatsModal}
                title={t("ดูสถิติระบบ & ผลสำรวจ (Owner Only)")}
                aria-label={t("เปิดสถิติระบบ")}
                className="hidden h-7 items-center gap-1 border border-gold/60 bg-gold/10 px-2 font-display text-[11px] font-bold text-gold transition-colors hover:bg-gold hover:text-bg lg:inline-flex"
              >
                <BarChart3 className="h-3 w-3 shrink-0" />
                <span>Stats</span>
              </button>
            )}
            <button
              type="button"
              onClick={onOpenSurveyModal}
              title={t("แบบสอบถาม / Feedback ความคิดเห็นต่อ MiniDraft")}
              aria-label={t("เปิดแบบสอบถาม / Feedback")}
              className="relative hidden h-7 items-center gap-1 border border-line-strong bg-panel-2 px-2 font-display text-[11px] font-semibold text-ink transition-colors hover:border-gold/60 hover:text-gold lg:inline-flex"
            >
              <MessageSquare className="h-3 w-3 shrink-0 text-gold" />
              <span>Feedback</span>
              {!surveyAnswered && (
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-gold"
                />
              )}
            </button>
            <button
              type="button"
              onClick={onOpenDonateModal}
              title={t("สนับสนุนผู้พัฒนา (PromptPay QR)")}
              aria-label={t("Donate สนับสนุนผู้พัฒนา")}
              className="hidden h-7 items-center gap-1 border border-line-strong bg-panel-2 px-2 font-display text-[11px] font-semibold text-ink transition-colors hover:border-gold/60 hover:text-gold lg:inline-flex"
            >
              <Coffee className="h-3 w-3 shrink-0 text-gold" />
              <span>Donate</span>
            </button>
            {authLoading ? null : isAuthenticated ? (
              <div className="flex items-center gap-1">
                <a
                  href="#profile"
                  aria-label={t("เปิดโปรไฟล์ของ {0}", accountName)}
                  aria-current={tab === "profile" ? "page" : undefined}
                  title={t("เปิดโปรไฟล์ของ {0}", accountName)}
                  className="inline-flex h-7 items-center gap-1 border border-good/40 bg-good/10 px-2 font-mono text-[10.5px] font-bold text-good transition-colors hover:border-good hover:bg-good/20 focus-visible:outline-2 focus-visible:outline-good"
                >
                  <User className="h-3 w-3 shrink-0" />
                  <span className="max-w-[68px] truncate sm:max-w-[96px]">{accountName}</span>
                </a>
                <button
                  type="button"
                  onClick={onLogout}
                  title={t("ออกจากระบบ (สลับกลับโหมด Guest เฉพาะเครื่อง)")}
                  aria-label={t("ออกจากระบบ")}
                  className="hidden h-7 items-center gap-1 border border-line bg-bg px-2 font-display text-[11px] font-semibold text-muted transition-colors hover:border-red/60 hover:text-red lg:inline-flex"
                >
                  <LogOut className="h-3 w-3 shrink-0" />
                  <span><StableButtonLabel message="ออก" /></span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onOpenAuthModal}
                title={t("เข้าสู่ระบบหรือสมัครสมาชิก เพื่อแยกฐานข้อมูลส่วนตัวและซิงก์ข้าม PC / iPad / มือถือ")}
                className="inline-flex h-7 items-center gap-1 border border-gold/50 bg-gold/10 px-2 font-display text-[11px] font-bold text-gold transition-colors hover:bg-gold hover:text-bg"
              >
                <LogIn className="h-3 w-3 shrink-0" />
                <span><StableButtonLabel message="เข้าสู่ระบบ" /></span>
              </button>
            )}
            <button
              type="button"
              onClick={onOpenMobileDrawer}
              aria-label={t("เปิดเมนูเพิ่มเติม")}
              title={t("เมนูเพิ่มเติม")}
              className="relative inline-flex h-8 w-8 items-center justify-center border border-line-strong bg-panel-2 text-ink transition-colors hover:border-gold/60 hover:text-gold lg:hidden"
            >
              <Menu className="h-4 w-4" />
              {!surveyAnswered && (
                <span
                  aria-hidden="true"
                  className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-gold"
                />
              )}
            </button>
          </div>
        </div>
        <div className="border-t border-line/70 bg-gold/10 px-3 py-0.5 text-center font-mono text-[11px] font-bold text-gold xl:hidden">
          {t("ให้บริการฟรีถึง 30/11/2026")}
        </div>
      </nav>

      <ErrorBoundary resetKey={`${tab}:${scope}`}>
        {tab === "profile" && authUser ? (
          <ProfileView user={authUser} onSaveDisplayName={onSaveDisplayName} />
        ) : tab === "practice" ? (
          <PracticeDraftView key={scope} scope={scope} />
        ) : !DRAFT_ONLY && tab === "tierlist" ? (
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
              storageKey={`${COMBAT_STORAGE_PREFIX}:${scope}`}
              persistRemote={isAuthenticated}
            />
          </main>
        ) : (
          <DraftBoardView
            key={`draft:${scope}`}
            draft={draft}
            isActiveTab={tab === "draft"}
            disableShortcuts={disableShortcuts}
            assistantEnabled={assistantEnabled}
            onToggleAssistant={() => setAssistantEnabled((prev) => !prev)}
          />
        )}
      </ErrorBoundary>
    </div>
  );
}

const GUEST_ENTERED_STORAGE_KEY = "minidraft_guest_entered_v1";
const AUTH_SYNC_STORAGE_KEY = "minidraft_auth_user_sync_v1";
const PRICING_SURVEY_STORAGE_KEY = "minidraft_pricing_survey_v1";
const PRICING_SURVEY_CLIENT_ID_KEY = "minidraft_pricing_survey_client_id_v1";
const DRAFT_STORAGE_PREFIX = "rov_draft_session_v1";
const COMBAT_STORAGE_PREFIX = "rov-combat-lab-v1";
const ACCOUNT_STORAGE_PREFIXES = [DRAFT_STORAGE_PREFIX, COMBAT_STORAGE_PREFIX, PRICING_SURVEY_STORAGE_KEY];

function prepareAuthenticatedUser(user: AuthUser): void {
  restorePreviewAccountStorage(user, ACCOUNT_STORAGE_PREFIXES);
  setExpectedAuthUser(user.username);
}

interface PricingSurveyStorage {
  clientId: string;
  status: "pending" | "answered";
  choice?: PricingSurveyChoice;
  snoozedDate?: string;
  answeredAt?: number;
}

function getLocalDateKey(now = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function createSurveyClientId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fallback below
  }
  return `cid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function getOrCreateSurveyClientId(): string {
  try {
    const existing = window.localStorage.getItem(PRICING_SURVEY_CLIENT_ID_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) {
      return existing;
    }
    const legacyRaw = window.localStorage.getItem(PRICING_SURVEY_STORAGE_KEY);
    if (legacyRaw) {
      const legacyParsed = JSON.parse(legacyRaw) as { clientId?: unknown };
      if (typeof legacyParsed?.clientId === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(legacyParsed.clientId)) {
        window.localStorage.setItem(PRICING_SURVEY_CLIENT_ID_KEY, legacyParsed.clientId);
        return legacyParsed.clientId;
      }
    }
    const generated = createSurveyClientId();
    window.localStorage.setItem(PRICING_SURVEY_CLIENT_ID_KEY, generated);
    return generated;
  } catch {
    return createSurveyClientId();
  }
}

function loadPricingSurveyState(scope: string): PricingSurveyStorage {
  const clientId = getOrCreateSurveyClientId();
  try {
    const scopedKey = `${PRICING_SURVEY_STORAGE_KEY}:${scope}`;
    const raw =
      window.localStorage.getItem(scopedKey) ??
      (scope === "guest" ? window.localStorage.getItem(PRICING_SURVEY_STORAGE_KEY) : null);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PricingSurveyStorage>;
      if (parsed && typeof parsed === "object") {
        return {
          clientId,
          status: parsed.status === "answered" ? "answered" : "pending",
          choice: parsed.choice === "willing" || parsed.choice === "not_willing" ? parsed.choice : undefined,
          snoozedDate: typeof parsed.snoozedDate === "string" ? parsed.snoozedDate : undefined,
          answeredAt: typeof parsed.answeredAt === "number" ? parsed.answeredAt : undefined,
        };
      }
    }
  } catch {
    // Ignore storage errors
  }
  return { clientId, status: "pending" };
}

function savePricingSurveyState(scope: string, next: PricingSurveyStorage): void {
  try {
    window.localStorage.setItem(`${PRICING_SURVEY_STORAGE_KEY}:${scope}`, JSON.stringify(next));
    if (scope === "guest") {
      window.localStorage.removeItem(PRICING_SURVEY_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota/privacy restrictions
  }
}

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

interface PendingGuestDraft {
  rawKey: string;
  parsed: Partial<DraftSessionPayload>;
  actionsCount: number;
  seriesCount: number;
  globalBanCount: number;
}

function readPendingGuestDraft(): PendingGuestDraft | null {
  try {
    const guestKey = `${DRAFT_STORAGE_PREFIX}:guest`;
    const raw = window.localStorage.getItem(guestKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      bluePicks?: unknown[];
      redPicks?: unknown[];
      blueBans?: unknown[];
      redBans?: unknown[];
      seriesGames?: unknown[];
      globalBans?: { teamAUsed?: unknown[]; teamBUsed?: unknown[]; universalBans?: unknown[] };
    } & Partial<DraftSessionPayload>;
    const actionsCount =
      (parsed.bluePicks?.length ?? 0) +
      (parsed.redPicks?.length ?? 0) +
      (parsed.blueBans?.length ?? 0) +
      (parsed.redBans?.length ?? 0);
    const seriesCount = parsed.seriesGames?.length ?? 0;
    const globalBanCount =
      (parsed.globalBans?.teamAUsed?.length ?? 0) +
      (parsed.globalBans?.teamBUsed?.length ?? 0) +
      (parsed.globalBans?.universalBans?.length ?? 0);
    if (actionsCount + seriesCount + globalBanCount <= 0) return null;
    return { rawKey: guestKey, parsed, actionsCount, seriesCount, globalBanCount };
  } catch {
    return null;
  }
}

function readLocalUserDraft(username: string): DraftSessionPayload | null {
  try {
    const raw = window.localStorage.getItem(`${DRAFT_STORAGE_PREFIX}:user:${username}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftSessionPayload>;
    if (!parsed || typeof parsed !== "object") return null;
    return normalizeSessionPayload(parsed);
  } catch {
    return null;
  }
}

function commitGuestDraftMigration(username: string, merged: DraftSessionPayload, rawKey: string): void {
  try {
    window.localStorage.setItem(`${DRAFT_STORAGE_PREFIX}:user:${username}`, JSON.stringify(merged));
    window.localStorage.removeItem(rawKey);
  } catch {
    // Ignore storage quota or serialization errors
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
  const { t } = useLanguage();
  const [requestedTab, setTab] = useState<Tab>(initialTab);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const tab = requestedTab === "profile" && !authUser ? "draft" : requestedTab;
  const authUserRef = useRef<AuthUser | null>(null);
  const authRefreshInFlightRef = useRef(false);
  const lastAuthCheckAtRef = useRef(0);
  const [authLoading, setAuthLoading] = useState(true);
  const [googleLoginEnabled, setGoogleLoginEnabled] = useState(false);
  const [discordLoginEnabled, setDiscordLoginEnabled] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(() => {
    const err = new URLSearchParams(window.location.search).get("auth_error");
    return formatOAuthError(err);
  });
  const [guestEntered, setGuestEntered] = useState<boolean>(loadGuestEntered);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(() => Boolean(oauthError && loadGuestEntered()));
  const [donateModalOpen, setDonateModalOpen] = useState(false);
  const [adminStatsModalOpen, setAdminStatsModalOpen] = useState(false);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [manualSurveyOpen, setManualSurveyOpen] = useState(false);
  const [surveyStateByScope, setSurveyStateByScope] = useState<Record<string, PricingSurveyStorage>>({});
  const [pricingSurveyAnsweredServer, setPricingSurveyAnsweredServer] = useState(false);
  const [pricingSurveyChoiceServer, setPricingSurveyChoiceServer] = useState<PricingSurveyChoice | null>(null);
  const [surveyBusy, setSurveyBusy] = useState(false);
  const [surveyError, setSurveyError] = useState<Message | null>(null);
  const [pendingMigration, setPendingMigration] = useState<{ user: AuthUser; draft: PendingGuestDraft } | null>(null);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [migrationError, setMigrationError] = useState<Message | null>(null);
  const migrationTitleId = useId();

  const surveyScope = authUser ? `user:${authUser.username.toLowerCase()}` : "guest";
  const pricingSurveyState = surveyStateByScope[surveyScope] ?? loadPricingSurveyState(surveyScope);

  const updateGuestEntered = useCallback((enabled: boolean) => {
    saveGuestEntered(enabled);
    setGuestEntered(enabled);
  }, []);

  const finalizeAuthenticatedUser = useCallback(
    (user: AuthUser) => {
      lastAuthCheckAtRef.current = Date.now();
      prepareAuthenticatedUser(user);
      setOauthError(null);
      setAuthUser(user);
      updateGuestEntered(false);
      setAuthModalOpen(false);
      broadcastAuthChange(user.username);
    },
    [updateGuestEntered],
  );

  const applyAuthenticatedUser = useCallback(
    (
      user: AuthUser,
      fromGuestFlow: boolean,
      surveyAnswered = false,
      surveyChoice: PricingSurveyChoice | null = null,
      isAdmin = false,
    ) => {
      setPricingSurveyAnsweredServer(surveyAnswered || surveyChoice !== null);
      setPricingSurveyChoiceServer(surveyChoice);
      setIsAdminUser(isAdmin);
      if (fromGuestFlow) {
        const pending = readPendingGuestDraft();
        if (pending) {
          setAuthModalOpen(false);
          setPendingMigration({ user, draft: pending });
          return;
        }
      }
      finalizeAuthenticatedUser(user);
    },
    [finalizeAuthenticatedUser],
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

  useEffect(() => {
    const syncTab = () => setTab(initialTab());
    window.addEventListener("hashchange", syncTab);
    return () => window.removeEventListener("hashchange", syncTab);
  }, []);

  const refreshAuthSession = useCallback(
    async (signal?: AbortSignal, allowGuestMigration = false, force = false) => {
      const now = Date.now();
      if (authRefreshInFlightRef.current) return;
      if (!force && now - lastAuthCheckAtRef.current < 30_000) return;
      authRefreshInFlightRef.current = true;
      lastAuthCheckAtRef.current = now;
      try {
        const res = await getJson<AuthStatusResponse>("/auth/me", signal);
        setGoogleLoginEnabled(Boolean(res.google_login_enabled));
        setDiscordLoginEnabled(Boolean(res.discord_login_enabled));
        if (res.authenticated && res.user) {
          setPricingSurveyAnsweredServer(Boolean(res.pricing_survey_answered));
          setPricingSurveyChoiceServer(res.pricing_survey_choice ?? null);
          setIsAdminUser(Boolean(res.is_admin));
          if (allowGuestMigration && loadGuestEntered()) {
            const pending = readPendingGuestDraft();
            if (pending) {
              setAuthModalOpen(false);
              setPendingMigration({ user: res.user, draft: pending });
              return;
            }
            updateGuestEntered(false);
          }
          const user = res.user;
          prepareAuthenticatedUser(user);
          setAuthUser((prev) => (
            prev?.id === user.id &&
            prev.username === user.username &&
            prev.display_name === user.display_name &&
            prev.display_name_is_custom === user.display_name_is_custom &&
            prev.display_label === user.display_label &&
            prev.display_name_changes_remaining === user.display_name_changes_remaining &&
            prev.display_name_next_change_at === user.display_name_next_change_at &&
            prev.auth_provider === user.auth_provider
              ? prev : user
          ));
        } else {
          setExpectedAuthUser(null);
          setPricingSurveyAnsweredServer(false);
          setPricingSurveyChoiceServer(null);
          setIsAdminUser(false);
          setAdminStatsModalOpen(false);
          if (authUserRef.current !== null) {
            setOauthError("เซสชันหมดอายุหรือถูกออกจากระบบจากอุปกรณ์อื่น กรุณาเข้าสู่ระบบใหม่");
          }
          setAuthUser(null);
        }
      } catch {
        // Keep current client state on transient offline checks during focus refresh
      } finally {
        authRefreshInFlightRef.current = false;
      }
    },
    [updateGuestEntered],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    getJson<AuthStatusResponse>("/auth/me", ctrl.signal)
      .then((res) => {
        if (ctrl.signal.aborted) return;
        lastAuthCheckAtRef.current = Date.now();
        setGoogleLoginEnabled(Boolean(res.google_login_enabled));
        setDiscordLoginEnabled(Boolean(res.discord_login_enabled));
        if (res.authenticated && res.user) {
          setPricingSurveyAnsweredServer(Boolean(res.pricing_survey_answered));
          setPricingSurveyChoiceServer(res.pricing_survey_choice ?? null);
          setIsAdminUser(Boolean(res.is_admin));
          if (loadGuestEntered()) {
            const pending = readPendingGuestDraft();
            if (pending) {
              setPendingMigration({ user: res.user, draft: pending });
              return;
            }
            updateGuestEntered(false);
          }
          prepareAuthenticatedUser(res.user);
          setAuthUser(res.user);
        } else {
          setExpectedAuthUser(null);
          setPricingSurveyAnsweredServer(false);
          setPricingSurveyChoiceServer(null);
          setIsAdminUser(false);
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

  // Lightweight first-party daily visit ping (at most once per UTC+7 day per browser/user)
  useEffect(() => {
    if (authLoading) return;
    const todayTh = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    const scopeKey = `${todayTh}:${authUser?.username ?? "guest"}`;
    try {
      if (window.localStorage.getItem("minidraft_last_visit_ping_v1") === scopeKey) return;
      const clientId = getOrCreateSurveyClientId();
      postJson<{ recorded: boolean; visit_date: string }>("/telemetry/visit", { client_id: clientId })
        .then(() => {
          try {
            window.localStorage.setItem("minidraft_last_visit_ping_v1", scopeKey);
          } catch {
            // ignore storage errors
          }
        })
        .catch(() => {
          // non-blocking telemetry
        });
    } catch {
      // ignore localStorage access errors
    }
  }, [authLoading, authUser?.username]);

  // Detect expired/evicted sessions or cross-tab account switches immediately
  useEffect(() => {
    setSessionMismatchHandler((status) => {
      setExpectedAuthUser(null);
      setAuthUser(null);
      setPricingSurveyAnsweredServer(false);
      setPricingSurveyChoiceServer(null);
      setIsAdminUser(false);
      setAdminStatsModalOpen(false);
      setPendingMigration(null);
      setMigrationBusy(false);
      setMigrationError(null);
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
        void refreshAuthSession(undefined, false, true);
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

  const handleSaveDisplayName = async (displayName: string) => {
    if (!authUser) throw new ApiError(401, "Session expired or logged out");
    const { user } = await putJson<AuthStatusResponse>("/auth/profile", {
      user_id: authUser.id,
      display_name: displayName,
    });
    if (!user) throw new ApiError(401, "Session expired or logged out");
    setAuthUser((prev) => (prev?.id === user.id ? user : prev));
    broadcastAuthChange(user.username);
  };

  const handleLogout = async () => {
    try {
      await postJson<AuthStatusResponse>("/auth/logout", {});
    } catch {
      // clear client state regardless
    }
    if (requestedTab === "profile" || window.location.hash === "#profile") {
      setTab("draft");
      window.history.replaceState(null, "", "#");
    }
    setExpectedAuthUser(null);
    setAuthUser(null);
    setMobileDrawerOpen(false);
    setManualSurveyOpen(false);
    setAdminStatsModalOpen(false);
    setIsAdminUser(false);
    setPricingSurveyAnsweredServer(false);
    setPricingSurveyChoiceServer(null);
    updateGuestEntered(false);
    broadcastAuthChange(null);
  };

  if (authLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
        <div className="border border-line bg-panel px-5 py-3 font-mono text-xs text-muted">
          {t("กำลังตรวจสอบเซสชันผู้ใช้...")}
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
        onSuccess={(user, surveyAnswered, surveyChoice, isAdmin) =>
          applyAuthenticatedUser(user, false, surveyAnswered, surveyChoice ?? null, Boolean(isAdmin))
        }
        onContinueGuest={() => {
          setOauthError(null);
          updateGuestEntered(true);
        }}
      />
    );
  }

  const handleConfirmMigration = async () => {
    if (!pendingMigration || migrationBusy) return;
    const { user, draft } = pendingMigration;
    setMigrationBusy(true);
    setMigrationError(null);
    prepareAuthenticatedUser(user);
    try {
      const remoteRaw = await getJson<Partial<DraftSessionPayload>>("/draft/session");
      const remoteNormalized = normalizeSessionPayload(remoteRaw ?? {});
      const localAccount = readLocalUserDraft(user.username);
      const existingAccount =
        localAccount && localAccount.updatedAt > remoteNormalized.updatedAt ? localAccount : remoteNormalized;

      const merged = mergeGuestIntoAccountSession(draft.parsed, existingAccount);
      const saved = await putJson<DraftSessionPayload>("/draft/session", merged);

      commitGuestDraftMigration(user.username, normalizeSessionPayload(saved ?? merged), draft.rawKey);
      setPendingMigration(null);
      finalizeAuthenticatedUser(user);
    } catch (err) {
      if (!authUserRef.current) {
        setExpectedAuthUser(null);
      }
      setMigrationError(
        ["ไม่สามารถรวมข้อมูลกับเซิร์ฟเวอร์ได้ในขณะนี้ ({0}) — ข้อมูลเดิมในบัญชีและโหมด Guest ยังอยู่ครบ", err instanceof Error ? err.message : "Network error"],
      );
    } finally {
      setMigrationBusy(false);
    }
  };

  const handleIgnoreMigration = () => {
    if (!pendingMigration || migrationBusy) return;
    const user = pendingMigration.user;
    setMigrationError(null);
    setPendingMigration(null);
    finalizeAuthenticatedUser(user);
  };

  const handleSelectSurveyChoice = async (choice: PricingSurveyChoice): Promise<boolean> => {
    if (surveyBusy) return false;
    setSurveyBusy(true);
    setSurveyError(null);
    try {
      await postJson<PricingSurveyResponse>("/survey/pricing", {
        choice,
        client_id: pricingSurveyState.clientId,
      });
      const next: PricingSurveyStorage = {
        ...pricingSurveyState,
        status: "answered",
        choice,
        answeredAt: Date.now(),
      };
      savePricingSurveyState(surveyScope, next);
      return true;
    } catch (err) {
      setSurveyError(
        ["ไม่สามารถบันทึกคำตอบได้ในขณะนี้ ({0}) กรุณาลองอีกครั้งหรือกด \"ภายหลัง\"", err instanceof Error ? err.message : "Network error"],
      );
      return false;
    } finally {
      setSurveyBusy(false);
    }
  };

  const handleFinalizeSurveyChoice = (choice: PricingSurveyChoice) => {
    const next: PricingSurveyStorage = {
      ...pricingSurveyState,
      status: "answered",
      choice,
      answeredAt: Date.now(),
    };
    savePricingSurveyState(surveyScope, next);
    setSurveyStateByScope((prev) => ({ ...prev, [surveyScope]: next }));
    if (authUser) {
      setPricingSurveyAnsweredServer(true);
      setPricingSurveyChoiceServer(choice);
    }
    setManualSurveyOpen(false);
  };

  const handleSnoozeSurvey = () => {
    if (surveyBusy) return;
    setSurveyError(null);
    setManualSurveyOpen(false);
    if (!surveyAnswered) {
      const next: PricingSurveyStorage = {
        ...pricingSurveyState,
        snoozedDate: getLocalDateKey(),
      };
      savePricingSurveyState(surveyScope, next);
      setSurveyStateByScope((prev) => ({ ...prev, [surveyScope]: next }));
    }
  };

  const todayDateKey = getLocalDateKey();
  const effectiveSurveyChoice: PricingSurveyChoice | null =
    pricingSurveyChoiceServer ?? pricingSurveyState.choice ?? null;
  const surveyAnswered =
    pricingSurveyAnsweredServer ||
    pricingSurveyChoiceServer !== null ||
    pricingSurveyState.status === "answered";
  const autoSurveyOpen =
    tab === "draft" &&
    !surveyAnswered &&
    pricingSurveyState.snoozedDate !== todayDateKey;
  const pricingSurveyOpen =
    !authModalOpen &&
    pendingMigration === null &&
    !donateModalOpen &&
    !adminStatsModalOpen &&
    !mobileDrawerOpen &&
    (manualSurveyOpen || autoSurveyOpen);

  const workspaceKey = authUser ? `user:${authUser.username}` : "guest";

  return (
    <>
      <Workspace
        key={workspaceKey}
        tab={tab}
        selectTab={selectTab}
        authUser={authUser}
        isAdmin={isAdminUser}
        authLoading={authLoading}
        surveyAnswered={surveyAnswered}
        disableShortcuts={
          authModalOpen ||
          pendingMigration !== null ||
          donateModalOpen ||
          adminStatsModalOpen ||
          mobileDrawerOpen ||
          pricingSurveyOpen
        }
        onOpenAuthModal={() => setAuthModalOpen(true)}
        onOpenDonateModal={() => setDonateModalOpen(true)}
        onOpenSurveyModal={() => {
          setSurveyError(null);
          setManualSurveyOpen(true);
        }}
        onOpenAdminStatsModal={() => setAdminStatsModalOpen(true)}
        onOpenMobileDrawer={() => setMobileDrawerOpen(true)}
        onLogout={handleLogout}
        onSaveDisplayName={handleSaveDisplayName}
      />
      {mobileDrawerOpen && (
        <MobileNavDrawer
          tabs={TABS}
          activeTab={tab}
          authUser={authUser}
          isAdmin={isAdminUser}
          surveyAnswered={surveyAnswered}
          surveyChoice={effectiveSurveyChoice}
          onSelectTab={selectTab}
          onOpenSurvey={() => {
            setSurveyError(null);
            setManualSurveyOpen(true);
          }}
          onOpenDonate={() => setDonateModalOpen(true)}
          onOpenAdminStats={() => setAdminStatsModalOpen(true)}
          onOpenAuth={() => setAuthModalOpen(true)}
          onOpenProfile={() => { window.location.hash = "profile"; }}
          onLogout={() => void handleLogout()}
          onClose={() => setMobileDrawerOpen(false)}
        />
      )}
      {adminStatsModalOpen && isAdminUser && (
        <AdminStatsModal onClose={() => setAdminStatsModalOpen(false)} />
      )}
      {pricingSurveyOpen && (
        <PricingSurveyModal
          busy={surveyBusy}
          error={surveyError && translateMessage(t, surveyError)}
          answered={surveyAnswered}
          currentChoice={effectiveSurveyChoice}
          onSelect={handleSelectSurveyChoice}
          onAfterSelect={handleFinalizeSurveyChoice}
          onSnooze={handleSnoozeSurvey}
        />
      )}
      {donateModalOpen && <DonateModal onClose={() => setDonateModalOpen(false)} />}
      {authModalOpen && (
        <AuthModal
          googleLoginEnabled={googleLoginEnabled}
          discordLoginEnabled={discordLoginEnabled}
          initialError={oauthError}
          onSuccess={(user, surveyAnswered, surveyChoice, isAdmin) =>
            applyAuthenticatedUser(user, true, surveyAnswered, surveyChoice ?? null, Boolean(isAdmin))
          }
          onClose={() => {
            setOauthError(null);
            setAuthModalOpen(false);
          }}
        />
      )}
      {pendingMigration && (
        <Modal
          labelledBy={migrationTitleId}
          className="max-w-md border-gold/40"
          onClose={migrationBusy ? () => {} : handleIgnoreMigration}
        >
          <div className="border-b border-line px-5 py-3.5">
            <h2 id={migrationTitleId} className="font-display text-sm font-bold tracking-wide text-ink sm:text-base">
              {t("พบข้อมูลดราฟต์จากโหมด Guest")}
            </h2>
          </div>
          <div className="space-y-3 px-5 py-4 text-xs leading-relaxed text-muted sm:text-sm">
            <p className="text-ink">
              {t("มีข้อมูลที่ทำค้างไว้ (")}
              {[
                pendingMigration.draft.actionsCount > 0 ? t("เลือก/แบน {0} ตัว", pendingMigration.draft.actionsCount) : null,
                pendingMigration.draft.seriesCount > 0 ? t("บันทึก {0} เกม", pendingMigration.draft.seriesCount) : null,
                pendingMigration.draft.globalBanCount > 0
                  ? t("Global Ban {0} ตัว", pendingMigration.draft.globalBanCount)
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              {t(") ต้องการย้ายมาใช้ต่อในบัญชี")}{" "}
              <span className="font-mono font-bold text-gold">{accountLabel(pendingMigration.user)}</span> {t("หรือไม่?")}
            </p>
            <p className="text-[11px] text-dim sm:text-xs">
              <strong className="text-ink">Confirm</strong> {t("= นำเข้าสู่บัญชีและรวมกับประวัติเดิม (ไม่ลบประวัติเก่า) ·")}{" "}
              <strong className="text-ink">Ignore</strong> {t("= โหลดข้อมูลเดิมของบัญชี")}
            </p>
            {migrationError && (
              <div className="border border-red/40 bg-red/10 px-3 py-2 text-[11px] text-red sm:text-xs">
                {translateMessage(t, migrationError)}
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line bg-panel-2/40 px-5 py-3">
            <button
              type="button"
              disabled={migrationBusy}
              onClick={handleIgnoreMigration}
              className="border border-line-strong bg-panel px-4 py-1.5 font-display text-xs font-semibold text-muted transition-colors hover:border-ink/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              Ignore
            </button>
            <button
              type="button"
              disabled={migrationBusy}
              onClick={() => void handleConfirmMigration()}
              className="border border-gold bg-gold px-4 py-1.5 font-display text-xs font-bold text-bg transition-colors hover:bg-gold/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <StableButtonLabel message={migrationBusy ? "กำลังรวมข้อมูล..." : "Confirm"} alternatives={["กำลังรวมข้อมูล...", "Confirm"]} />
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default App;

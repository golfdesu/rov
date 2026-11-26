import { StableButtonLabel } from "./components/StableButtonLabel";
import { type Message, translateMessage, useLanguage } from "./i18n/language";
import { ChevronDown, Gift, HelpCircle, LogIn, Menu, User, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiError, getJson, postJson, putJson, setExpectedAuthUser, setSessionMismatchHandler } from "./api/client";
import { AuthLanding, AuthModal } from "./components/AuthModal";
import { DonateModal } from "./components/DonateModal";
import { DraftBoardView } from "./components/DraftBoardView";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MiniDraftLogo } from "./components/MiniDraftLogo";
import { MobileNavDrawer } from "./components/MobileNavDrawer";
import { Modal } from "./components/Modal";
import { PricingSurveyModal } from "./components/PricingSurveyModal";
import { UserGuideModal } from "./components/UserGuideModal";

const AdminDashboardView = lazy(() =>
  import("./components/AdminDashboardView").then((m) => ({ default: m.AdminDashboardView })),
);
const AdminStatsModal = lazy(() =>
  import("./components/AdminStatsModal").then((m) => ({ default: m.AdminStatsModal })),
);
const BillingSandbox = lazy(() =>
  import("./components/BillingSandbox").then((m) => ({ default: m.BillingSandbox })),
);
const PracticeDraftView = lazy(() =>
  import("./components/PracticeDraftView").then((m) => ({ default: m.PracticeDraftView })),
);
const ProfileView = lazy(() =>
  import("./components/ProfileView").then((m) => ({ default: m.ProfileView })),
);
const ScrimDashboardView = lazy(() =>
  import("./components/ScrimDashboardView").then((m) => ({ default: m.ScrimDashboardView })),
);
import { mergeGuestIntoAccountSession, normalizeSessionPayload, useDraft } from "./hooks/useDraft";
import type {
  AuthStatusResponse,
  AuthUser,
  FeedbackSubmitResponse,
  PricingSurveyChoice,
} from "./types/auth";
import type { DraftSessionPayload } from "./types/draft";
import { accountLabel, restorePreviewAccountStorage } from "./utils/auth";

export type Tab = "draft" | "practice" | "profile" | "plans" | "analytics" | "admin";
export type DraftToolModal = "pools";

const TABS: { key: Tab; label: string }[] = [
  { key: "draft", label: "Draft Board" },
  { key: "practice", label: "ฝึกดราฟต์ vs AI" },
];

const ANALYTICS_TAB: { key: Tab; label: string } = { key: "analytics", label: "สถิติซ้อมทีม" };

function visibleTabs(sandboxBilling: boolean): { key: Tab; label: string }[] {
  return sandboxBilling ? [...TABS, ANALYTICS_TAB] : TABS;
}

function initialTab(): Tab {
  if (window.location.hash === "#admin") return "admin";
  if (window.location.hash === "#analytics") return "analytics";
  if (window.location.hash === "#profile") return "profile";
  if (window.location.hash === "#plans") return "plans";
  if (window.location.hash === "#practice") return "practice";
  return "draft";
}

interface WorkspaceProps {
  tab: Tab;
  selectTab: (next: Tab) => void;
  authUser: AuthUser | null;
  isAdmin: boolean;
  authLoading: boolean;
  sandboxBilling: boolean;
  freePromoUntil: number | null;
  pricingSurveyChoice: PricingSurveyChoice | null;
  willingNudgeDismissed: boolean;
  onDismissWillingNudge: () => void;
  activeDraftTool: DraftToolModal | null;
  onCloseDraftTool: () => void;
  announcementSeen: boolean;
  disableShortcuts: boolean;
  onOpenAuthModal: () => void;
  onOpenGuide: () => void;
  onOpenMobileDrawer: () => void;
  onSaveDisplayName: (displayName: string) => Promise<void>;
}

function Workspace({
  tab,
  selectTab,
  authUser,
  isAdmin,
  authLoading,
  sandboxBilling,
  freePromoUntil,
  pricingSurveyChoice,
  willingNudgeDismissed,
  onDismissWillingNudge,
  activeDraftTool,
  onCloseDraftTool,
  announcementSeen,
  disableShortcuts,
  onOpenAuthModal,
  onOpenGuide,
  onOpenMobileDrawer,
  onSaveDisplayName,
}: WorkspaceProps) {
  const { language, t } = useLanguage();
  const [nowMs] = useState(Date.now);
  const isAuthenticated = authUser !== null;
  const accountName = isAuthenticated ? accountLabel(authUser) : "";
  const scope = isAuthenticated ? `user:${authUser.username}` : "guest";
  const showFreePromoBadge = Boolean(
    sandboxBilling &&
      !authLoading &&
      !authUser?.is_paid &&
      freePromoUntil &&
      freePromoUntil * 1000 > nowMs,
  );
  const showFreePromoExpiryWarning = Boolean(
    sandboxBilling &&
      !authLoading &&
      !isAdmin &&
      authUser?.pass_source === "promo_free" &&
      authUser.pass_expires_at &&
      authUser.pass_expires_at * 1000 > nowMs &&
      authUser.pass_expires_at * 1000 - nowMs <= 4 * 86_400_000,
  );
  const promoDisplayTimestamp = showFreePromoBadge
    ? freePromoUntil
    : showFreePromoExpiryWarning
      ? (authUser?.pass_expires_at ?? null)
      : null;
  const freePromoShortDate = promoDisplayTimestamp
    ? new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "Asia/Bangkok",
      }).format(promoDisplayTimestamp * 1000)
    : "";
  const showWillingPromoNudge = Boolean(
    isAuthenticated &&
      pricingSurveyChoice === "willing" &&
      showFreePromoBadge &&
      !willingNudgeDismissed &&
      tab !== "profile" &&
      tab !== "plans",
  );
  const handleOpenPromo = () => {
    if (isAuthenticated) {
      selectTab("profile");
    } else {
      onOpenAuthModal();
    }
  };
  const activeTabLabel = t(
    tab === "profile"
      ? "โปรไฟล์"
      : tab === "plans"
        ? "แพ็ก"
        : tab === "analytics"
          ? "สถิติซ้อมทีม"
          : tab === "admin"
            ? "สถิติระบบ"
            : TABS.find((item) => item.key === tab)?.label ?? "Draft Board",
  );

  // Unified Draft Machine isolated per user account (or local-only in Guest mode)
  const [assistantEnabled, setAssistantEnabled] = useState(true);
  const draft = useDraft({
    storageKey: `${DRAFT_STORAGE_PREFIX}:${scope}`,
    persistSession: isAuthenticated,
    enabled: tab === "draft" && assistantEnabled,
    personalHistoryLimit: authUser?.draft_history_limit ?? (sandboxBilling && !authUser ? 3 : undefined),
  });

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-bg">
      {/* Unified Top Navigation */}
      <nav className="shrink-0 border-b border-line bg-panel/90" aria-label={t("โหมด")}>
        <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-2 px-2.5 py-1.5 sm:px-4 lg:py-0">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => selectTab("draft")}
              aria-label="MiniDraft Home"
              className="inline-flex min-h-8 shrink-0 items-center gap-1.5 text-left transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-gold lg:border-r lg:border-line lg:pr-3"
            >
              <MiniDraftLogo className="h-6 w-6 shrink-0" />
              <span className="font-display text-xs font-extrabold tracking-widest text-ink sm:text-sm">
                MINI<span className="text-gold">DRAFT</span>
              </span>
            </button>
            <button
              type="button"
              onClick={onOpenMobileDrawer}
              aria-label={`${activeTabLabel} · ${t("เปิดเมนูเพิ่มเติม")}`}
              className="inline-flex min-h-7 min-w-0 max-w-[155px] shrink items-center gap-1 border border-line-strong bg-panel-2/80 px-2 py-0.5 font-display text-[11px] font-semibold text-ink transition-colors hover:border-gold/50 lg:hidden"
            >
              <span className="truncate">{activeTabLabel}</span>
              <ChevronDown className="h-3 w-3 shrink-0 text-dim" aria-hidden="true" />
            </button>
            <div className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto lg:flex">
              {visibleTabs(sandboxBilling).map((item) => (
                <button
                  type="button"
                  key={item.key}
                  onClick={() => selectTab(item.key)}
                  aria-current={tab === item.key ? "page" : undefined}
                  className={`border-b-2 px-3 py-2.5 font-display text-sm font-semibold tracking-wide whitespace-nowrap transition-colors ${
                    tab === item.key ? "border-gold text-ink" : "border-transparent text-dim hover:text-muted"
                  }`}
                >
                  {t(item.label)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {showFreePromoBadge ? (
              <button
                type="button"
                onClick={handleOpenPromo}
                className="hidden min-h-8 items-center gap-1.5 border border-gold/60 bg-gold/15 px-2.5 font-display text-xs font-bold whitespace-nowrap text-gold transition-colors hover:bg-gold hover:text-bg focus-visible:outline-2 focus-visible:outline-gold sm:inline-flex"
              >
                <Gift className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{t("รับ Pro ฟรีถึง {0}", freePromoShortDate)}</span>
              </button>
            ) : showFreePromoExpiryWarning && (
              <button
                type="button"
                onClick={() => selectTab("plans")}
                className="hidden min-h-8 items-center gap-1.5 border border-gold/70 bg-gold/20 px-2.5 font-display text-xs font-bold whitespace-nowrap text-gold transition-colors hover:bg-gold hover:text-bg focus-visible:outline-2 focus-visible:outline-gold sm:inline-flex"
              >
                <Gift className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{t("Pro ฟรีหมดอายุ {0} · ต่อแพ็ก", freePromoShortDate)}</span>
              </button>
            )}
            {authLoading ? null : isAuthenticated ? (
              <a
                href="#profile"
                aria-label={t("เปิดโปรไฟล์ของ {0}", accountName)}
                aria-current={tab === "profile" ? "page" : undefined}
                title={t("เปิดโปรไฟล์ของ {0}", accountName)}
                className={`inline-flex min-h-8 items-center gap-1.5 border px-2.5 font-mono text-[11px] font-bold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-gold ${
                  tab === "profile"
                    ? "border-gold/70 bg-gold/10 text-gold"
                    : "border-line-strong bg-panel-2 text-ink hover:border-gold/50 hover:text-gold"
                }`}
              >
                <User className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-[76px] truncate sm:max-w-[120px]">{accountName}</span>
              </a>
            ) : (
              <button
                type="button"
                onClick={onOpenAuthModal}
                className="inline-flex min-h-8 items-center gap-1.5 border border-gold/50 bg-gold/10 px-2.5 font-display text-xs font-bold whitespace-nowrap text-gold transition-colors hover:bg-gold hover:text-bg"
              >
                <LogIn className="h-3.5 w-3.5 shrink-0" />
                <span><StableButtonLabel message="เข้าสู่ระบบ" /></span>
              </button>
            )}
            <button
              type="button"
              onClick={onOpenGuide}
              aria-label={t("คู่มือการใช้งาน")}
              title={t("คู่มือการใช้งาน")}
              className="inline-flex h-8 w-8 items-center justify-center border border-line-strong bg-panel-2 text-ink transition-colors hover:border-gold/60 hover:text-gold"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onOpenMobileDrawer}
              aria-label={t("เปิดเมนูเพิ่มเติม")}
              title={t("เมนูเพิ่มเติม")}
              className="relative inline-flex h-8 w-8 items-center justify-center border border-line-strong bg-panel-2 text-ink transition-colors hover:border-gold/60 hover:text-gold"
            >
              <Menu className="h-4 w-4" />
              {!announcementSeen && (
                <span
                  aria-hidden="true"
                  className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-gold"
                />
              )}
            </button>
          </div>
        </div>
        {showFreePromoBadge ? (
          <button
            type="button"
            onClick={handleOpenPromo}
            className="flex min-h-7 w-full items-center justify-center gap-1.5 border-t border-gold/25 bg-gold/10 px-3 py-1 font-display text-[11px] font-bold text-gold transition-colors hover:bg-gold/20 sm:hidden"
          >
            <Gift className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{t("รับ Pro ฟรีถึง {0}", freePromoShortDate)}</span>
            <span aria-hidden="true">·</span>
            <span className="underline underline-offset-2">{t("กดรับเลย")}</span>
          </button>
        ) : showFreePromoExpiryWarning && (
          <button
            type="button"
            onClick={() => selectTab("plans")}
            className="flex min-h-7 w-full items-center justify-center gap-1.5 border-t border-gold/40 bg-gold/15 px-3 py-1 font-display text-[11px] font-bold text-gold transition-colors hover:bg-gold/25 sm:hidden"
          >
            <Gift className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{t("Pro ฟรีหมดอายุ {0} · ต่อแพ็ก", freePromoShortDate)}</span>
          </button>
        )}
        {showWillingPromoNudge && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gold/35 bg-gold/10 px-3 py-1.5 text-xs text-ink sm:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <Gift className="h-3.5 w-3.5 shrink-0 text-gold" aria-hidden="true" />
              <span className="min-w-0">
                {t("คุณเคยแจ้งสนใจแพ็กเกจ — ตอนนี้รับ Pro ฟรีได้ถึง {0} เพื่อปลดล็อก 500 เกม & สถิติซ้อมทีม", freePromoShortDate)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => selectTab("plans")}
                className="inline-flex min-h-7 items-center border border-gold bg-gold px-2.5 font-display text-[11px] font-bold text-bg hover:bg-gold/90"
              >
                {t("รับ Pro ฟรีเลย")}
              </button>
              <button
                type="button"
                onClick={onDismissWillingNudge}
                aria-label={t("ปิด")}
                className="inline-flex h-7 w-7 items-center justify-center border border-line-strong bg-panel-2 text-dim hover:text-ink"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </nav>

      <ErrorBoundary resetKey={`${tab}:${scope}`}>
        <Suspense fallback={null}>
        {tab === "admin" && isAdmin ? (
          <AdminDashboardView onBack={() => selectTab("draft")} />
        ) : tab === "analytics" && sandboxBilling ? (
          <ScrimDashboardView
            personalGames={draft.seriesGames}
            heroMap={draft.heroMap}
            isPaid={Boolean(authUser?.is_paid)}
            isAuthenticated={isAuthenticated}
            teamHistoryEnabled={Boolean(authUser?.stripe_sandbox_enabled)}
            freePromoUntil={authUser?.is_paid ? null : freePromoUntil}
            defaultTeamName={draft.globalBans.teamAName}
            onOpenAuthModal={onOpenAuthModal}
            onBack={() => selectTab("draft")}
          />
        ) : tab === "profile" && authUser ? (
          <ProfileView user={authUser} onSaveDisplayName={onSaveDisplayName} />
        ) : tab === "plans" && authUser?.stripe_sandbox_enabled ? (
          <BillingSandbox key={authUser.id} username={authUser.username} view="plans" livemode={Boolean(authUser.stripe_livemode)} />
        ) : tab === "practice" ? (
          <PracticeDraftView
            key={scope}
            scope={scope}
            persistSession={isAuthenticated}
            historyLimit={authUser?.practice_history_limit ?? undefined}
          />
        ) : (
          <DraftBoardView
            key={`draft:${scope}`}
            draft={draft}
            teamHistoryUsername={authUser?.stripe_sandbox_enabled ? authUser.username : undefined}
            isPaidUser={Boolean(authUser?.is_paid)}
            isAuthenticated={isAuthenticated}
            onOpenAuthModal={onOpenAuthModal}
            activeDraftTool={activeDraftTool}
            onCloseDraftTool={onCloseDraftTool}
            isActiveTab={tab === "draft"}
            disableShortcuts={disableShortcuts}
            assistantEnabled={assistantEnabled}
            onToggleAssistant={() => setAssistantEnabled((prev) => !prev)}
          />
        )}
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

const GUEST_ENTERED_STORAGE_KEY = "minidraft_guest_entered_v1";
const AUTH_SYNC_STORAGE_KEY = "minidraft_auth_user_sync_v1";
const ANNOUNCEMENT_VERSION = "2026-11-25";
const ANNOUNCEMENT_STORAGE_KEY = "minidraft_announcement_v2";
const PRICING_SURVEY_CLIENT_ID_KEY = "minidraft_pricing_survey_client_id_v1";
const DRAFT_STORAGE_PREFIX = "rov_draft_session_v1";
const ACCOUNT_STORAGE_PREFIXES = [DRAFT_STORAGE_PREFIX, ANNOUNCEMENT_STORAGE_KEY];

function prepareAuthenticatedUser(user: AuthUser): void {
  restorePreviewAccountStorage(user, ACCOUNT_STORAGE_PREFIXES);
  setExpectedAuthUser(user.username);
}

interface AnnouncementStorage {
  clientId: string;
  status: "pending" | "seen";
  version?: string;
  feedbackSent?: boolean;
  snoozedDate?: string;
  updatedAt?: number;
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
    const generated = createSurveyClientId();
    window.localStorage.setItem(PRICING_SURVEY_CLIENT_ID_KEY, generated);
    return generated;
  } catch {
    return createSurveyClientId();
  }
}

function loadAnnouncementState(scope: string): AnnouncementStorage {
  const clientId = getOrCreateSurveyClientId();
  try {
    const scopedKey = `${ANNOUNCEMENT_STORAGE_KEY}:${scope}`;
    const raw = window.localStorage.getItem(scopedKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AnnouncementStorage>;
      if (parsed && typeof parsed === "object") {
        const versionMatches = parsed.version === ANNOUNCEMENT_VERSION;
        return {
          clientId,
          status: versionMatches && parsed.status === "seen" ? "seen" : "pending",
          version: versionMatches ? parsed.version : undefined,
          feedbackSent: Boolean(parsed.feedbackSent),
          snoozedDate: typeof parsed.snoozedDate === "string" ? parsed.snoozedDate : undefined,
          updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : undefined,
        };
      }
    }
  } catch {
    // Ignore storage errors
  }
  return { clientId, status: "pending" };
}

function saveAnnouncementState(scope: string, next: AnnouncementStorage): void {
  try {
    window.localStorage.setItem(`${ANNOUNCEMENT_STORAGE_KEY}:${scope}`, JSON.stringify(next));
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
  if (code === "discord_invalid_state") return "เซสชันล็อกอิน Discord หมดอายุ ลองใหม่อีกครั้ง";
  if (code === "discord_failed" || code === "discord_unavailable") {
    return "เข้าสู่ระบบด้วย Discord ไม่สำเร็จ ลองใหม่อีกครั้ง";
  }
  if (code === "invalid_state") return "เซสชันล็อกอินหมดอายุ ลองใหม่อีกครั้ง";
  if (code === "email_unverified") return "อีเมล Google ของคุณยังไม่ได้ยืนยัน";
  if (code === "registration_full") return "ระบบปิดรับสมัครชั่วคราว กรุณาลองใหม่ภายหลัง";
  if (code === "rate_limited") return "ลองเข้าสู่ระบบถี่เกินไป รอสักครู่แล้วลองใหม่";
  return "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่";
}

export function App() {
  const { t } = useLanguage();
  const [requestedTab, setTab] = useState<Tab>(initialTab);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const authUserRef = useRef<AuthUser | null>(null);
  const authRefreshInFlightRef = useRef(false);
  const lastAuthCheckAtRef = useRef(0);
  const [authLoading, setAuthLoading] = useState(true);
  const [sandboxBilling, setSandboxBilling] = useState(false);
  const [freePromoUntil, setFreePromoUntil] = useState<number | null>(null);
  const [pricingSurveyChoice, setPricingSurveyChoice] = useState<PricingSurveyChoice | null>(null);
  const [willingNudgeDismissed, setWillingNudgeDismissed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("minidraft_willing_promo_nudge_v1") === "1";
    } catch {
      return false;
    }
  });
  const [googleLoginEnabled, setGoogleLoginEnabled] = useState(false);
  const [discordLoginEnabled, setDiscordLoginEnabled] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(() => {
    const err = new URLSearchParams(window.location.search).get("auth_error");
    return formatOAuthError(err);
  });
  const [guestEntered, setGuestEntered] = useState<boolean>(loadGuestEntered);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(() => Boolean(oauthError && loadGuestEntered()));
  const [donateModalOpen, setDonateModalOpen] = useState(false);
  const [guideModalOpen, setGuideModalOpen] = useState(false);
  const [adminStatsModalOpen, setAdminStatsModalOpen] = useState(false);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const tab =
    (requestedTab === "profile" && !authUser) ||
    (requestedTab === "plans" && !authUser?.stripe_sandbox_enabled) ||
    (requestedTab === "analytics" && !sandboxBilling) ||
    (requestedTab === "admin" && !isAdminUser) ? "draft" : requestedTab;
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [activeDraftTool, setActiveDraftTool] = useState<DraftToolModal | null>(null);
  const [manualSurveyOpen, setManualSurveyOpen] = useState(false);
  const [announcementByScope, setAnnouncementByScope] = useState<Record<string, AnnouncementStorage>>({});
  const [surveyBusy, setSurveyBusy] = useState(false);
  const [surveyError, setSurveyError] = useState<Message | null>(null);
  const [pendingMigration, setPendingMigration] = useState<{ user: AuthUser; draft: PendingGuestDraft } | null>(null);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [migrationError, setMigrationError] = useState<Message | null>(null);
  const [otherModalOpen, setOtherModalOpen] = useState(false);
  const migrationTitleId = useId();

  useEffect(() => {
    const checkDialogs = () => {
      const hasOtherDialog = Array.from(
        document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
      ).some((el) => !el.classList.contains("pricing-survey-modal"));
      setOtherModalOpen(hasOtherDialog);
    };
    checkDialogs();
    const observer = new MutationObserver(checkDialogs);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const surveyScope = authUser ? `user:${authUser.username.toLowerCase()}` : "guest";
  const announcementState = announcementByScope[surveyScope] ?? loadAnnouncementState(surveyScope);

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
      _surveyAnswered = false,
      surveyChoice: string | null = null,
      isAdmin = false,
    ) => {
      setIsAdminUser(isAdmin);
      setPricingSurveyChoice(
        surveyChoice === "willing" || surveyChoice === "not_willing" ? surveyChoice : null,
      );
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
        setSandboxBilling(Boolean(res.stripe_sandbox_enabled));
        setFreePromoUntil(res.free_promo_until ?? null);
        setGoogleLoginEnabled(Boolean(res.google_login_enabled));
        setDiscordLoginEnabled(Boolean(res.discord_login_enabled));
        if (res.authenticated && res.user) {
          setIsAdminUser(Boolean(res.is_admin));
          setPricingSurveyChoice(res.pricing_survey_choice ?? null);
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
            prev.stripe_sandbox_enabled === user.stripe_sandbox_enabled &&
            prev.stripe_livemode === user.stripe_livemode &&
            prev.draft_history_limit === user.draft_history_limit &&
            prev.practice_history_limit === user.practice_history_limit &&
            prev.is_paid === user.is_paid &&
            prev.pass_tier === user.pass_tier &&
            prev.pass_source === user.pass_source &&
            prev.pass_expires_at === user.pass_expires_at &&
            prev.auth_provider === user.auth_provider
              ? prev : user
          ));
        } else {
          setExpectedAuthUser(null);
          setIsAdminUser(false);
          setPricingSurveyChoice(null);
          setAdminStatsModalOpen(false);
          if (authUserRef.current !== null) {
            setOauthError("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
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
        setSandboxBilling(Boolean(res.stripe_sandbox_enabled));
        setFreePromoUntil(res.free_promo_until ?? null);
        setGoogleLoginEnabled(Boolean(res.google_login_enabled));
        setDiscordLoginEnabled(Boolean(res.discord_login_enabled));
        if (res.authenticated && res.user) {
          setIsAdminUser(Boolean(res.is_admin));
          setPricingSurveyChoice(res.pricing_survey_choice ?? null);
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
          setIsAdminUser(false);
          setPricingSurveyChoice(null);
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

  // Lightweight first-party daily visit ping (at most once per UTC+7 day per browser/user,
  // gated on visible tab + first real user interaction so background/suspended tab reloads do not inflate DAU)
  useEffect(() => {
    if (authLoading) return;
    const todayTh = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    const scopeKey = `${todayTh}:${authUser?.username ?? "guest"}`;
    try {
      if (window.localStorage.getItem("minidraft_last_visit_ping_v1") === scopeKey) return;
    } catch {
      return;
    }

    let sent = false;
    const cleanup = () => {
      window.removeEventListener("pointerdown", sendVisitPing);
      window.removeEventListener("keydown", sendVisitPing);
    };
    const sendVisitPing = () => {
      if (sent || document.visibilityState !== "visible") return;
      sent = true;
      cleanup();
      try {
        if (window.localStorage.getItem("minidraft_last_visit_ping_v1") === scopeKey) return;
        const clientId = getOrCreateSurveyClientId();
        const deviceType = window.innerWidth < 768 ? "mobile" : "desktop";
        postJson<{ recorded: boolean; visit_date: string }>("/telemetry/visit", {
          client_id: clientId,
          device_type: deviceType,
        })
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
    };

    window.addEventListener("pointerdown", sendVisitPing, { passive: true });
    window.addEventListener("keydown", sendVisitPing, { passive: true });
    return cleanup;
  }, [authLoading, authUser?.username]);

  // Detect expired/evicted sessions or cross-tab account switches immediately
  useEffect(() => {
    setSessionMismatchHandler((status) => {
      setExpectedAuthUser(null);
      setAuthUser(null);
      setIsAdminUser(false);
      setAdminStatsModalOpen(false);
      setActiveDraftTool(null);
      setPendingMigration(null);
      setMigrationBusy(false);
      setMigrationError(null);
      updateGuestEntered(false);
      setOauthError(
        status === 409
          ? "มีการเปลี่ยนบัญชีในแท็บอื่น กรุณาเข้าสู่ระบบใหม่"
          : "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
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
    const onBillingChange = () => { void refreshAuthSession(undefined, false, true); };
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);
    window.addEventListener("storage", onStorage);
    window.addEventListener("billingchange", onBillingChange);
    window.addEventListener("activepasschange", onBillingChange);
    return () => {
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("billingchange", onBillingChange);
      window.removeEventListener("activepasschange", onBillingChange);
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
    if (
      requestedTab === "profile" || requestedTab === "plans" || requestedTab === "analytics" || requestedTab === "admin" ||
      ["#profile", "#plans", "#analytics", "#admin"].includes(window.location.hash)
    ) {
      setTab("draft");
      window.history.replaceState(null, "", "#");
    }
    setExpectedAuthUser(null);
    setAuthUser(null);
    setMobileDrawerOpen(false);
    setManualSurveyOpen(false);
    setAdminStatsModalOpen(false);
    setActiveDraftTool(null);
    setIsAdminUser(false);
    setPricingSurveyChoice(null);
    updateGuestEntered(false);
    broadcastAuthChange(null);
  };

  if (authLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
        <div className="flex items-center gap-3 border border-line bg-panel px-5 py-3.5 shadow-xl clip-chamfer-sm">
          <MiniDraftLogo className="h-6 w-6 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="font-display text-xs font-extrabold tracking-widest text-ink">
              MINI<span className="text-gold">DRAFT</span>
            </span>
            <span className="font-mono text-[11px] text-muted">{t("กำลังโหลด…")}</span>
          </div>
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

      const merged = mergeGuestIntoAccountSession(draft.parsed, existingAccount, user.draft_history_limit ?? undefined);
      const saved = await putJson<DraftSessionPayload>("/draft/session", merged);

      commitGuestDraftMigration(user.username, normalizeSessionPayload(saved ?? merged), draft.rawKey);
      setPendingMigration(null);
      finalizeAuthenticatedUser(user);
    } catch (err) {
      if (!authUserRef.current) {
        setExpectedAuthUser(null);
      }
      setMigrationError(
        ["รวมข้อมูลไม่สำเร็จ ({0}) ข้อมูลเดิมยังอยู่ครบ", err instanceof Error ? err.message : "Network error"],
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

  const handleSubmitFeedback = async (message: string): Promise<boolean> => {
    if (surveyBusy) return false;
    setSurveyBusy(true);
    setSurveyError(null);
    try {
      await postJson<FeedbackSubmitResponse>("/feedback", {
        message,
        client_id: announcementState.clientId,
        page_context: tab,
      });
      const next: AnnouncementStorage = {
        ...announcementState,
        status: "seen",
        version: ANNOUNCEMENT_VERSION,
        feedbackSent: true,
        updatedAt: Date.now(),
      };
      saveAnnouncementState(surveyScope, next);
      setAnnouncementByScope((prev) => ({ ...prev, [surveyScope]: next }));
      return true;
    } catch (err) {
      setSurveyError(
        ["ส่ง Feedback ไม่สำเร็จ ({0}) ลองใหม่อีกครั้ง", err instanceof Error ? err.message : "Network error"],
      );
      return false;
    } finally {
      setSurveyBusy(false);
    }
  };

  const handleAfterFeedbackSubmit = () => {
    const next: AnnouncementStorage = {
      ...announcementState,
      status: "seen",
      version: ANNOUNCEMENT_VERSION,
      feedbackSent: true,
      updatedAt: Date.now(),
    };
    saveAnnouncementState(surveyScope, next);
    setAnnouncementByScope((prev) => ({ ...prev, [surveyScope]: next }));
    setManualSurveyOpen(false);
  };

  const handleAcknowledgeAnnouncement = () => {
    if (surveyBusy) return;
    setSurveyError(null);
    const next: AnnouncementStorage = {
      ...announcementState,
      status: "seen",
      version: ANNOUNCEMENT_VERSION,
      updatedAt: Date.now(),
    };
    saveAnnouncementState(surveyScope, next);
    setAnnouncementByScope((prev) => ({ ...prev, [surveyScope]: next }));
    setManualSurveyOpen(false);
  };

  const handleSnoozeSurvey = () => {
    if (surveyBusy) return;
    setSurveyError(null);
    setManualSurveyOpen(false);
    setAnnouncementByScope((prev) => {
      const cur = prev[surveyScope] ?? announcementState;
      if (cur.status === "seen" && cur.version === ANNOUNCEMENT_VERSION) return prev;
      const next: AnnouncementStorage = {
        ...cur,
        snoozedDate: getLocalDateKey(),
      };
      saveAnnouncementState(surveyScope, next);
      return { ...prev, [surveyScope]: next };
    });
  };

  const todayDateKey = getLocalDateKey();
  const announcementSeen =
    announcementState.status === "seen" && announcementState.version === ANNOUNCEMENT_VERSION;
  const feedbackSent = Boolean(announcementState.feedbackSent);
  const autoSurveyOpen =
    tab === "draft" &&
    !announcementSeen &&
    announcementState.snoozedDate !== todayDateKey;
  const pricingSurveyOpen =
    !authModalOpen &&
    pendingMigration === null &&
    !donateModalOpen &&
    !guideModalOpen &&
    !adminStatsModalOpen &&
    !mobileDrawerOpen &&
    activeDraftTool === null &&
    (manualSurveyOpen || (autoSurveyOpen && !otherModalOpen));

  const openDraftTool = (tool: DraftToolModal) => {
    selectTab("draft");
    setActiveDraftTool(tool);
  };

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
        sandboxBilling={sandboxBilling}
        freePromoUntil={authUser?.is_paid ? null : freePromoUntil}
        pricingSurveyChoice={pricingSurveyChoice}
        willingNudgeDismissed={willingNudgeDismissed}
        onDismissWillingNudge={() => {
          setWillingNudgeDismissed(true);
          try {
            window.localStorage.setItem("minidraft_willing_promo_nudge_v1", "1");
          } catch {
            // ignore storage errors
          }
        }}
        activeDraftTool={activeDraftTool}
        onCloseDraftTool={() => setActiveDraftTool(null)}
        announcementSeen={announcementSeen}
        disableShortcuts={
          authModalOpen ||
          pendingMigration !== null ||
          donateModalOpen ||
          guideModalOpen ||
          adminStatsModalOpen ||
          mobileDrawerOpen ||
          pricingSurveyOpen
        }
        onOpenAuthModal={() => setAuthModalOpen(true)}
        onOpenGuide={() => setGuideModalOpen(true)}
        onOpenMobileDrawer={() => setMobileDrawerOpen(true)}
        onSaveDisplayName={handleSaveDisplayName}
      />
      {mobileDrawerOpen && (
        <MobileNavDrawer
          tabs={visibleTabs(sandboxBilling)}
          activeTab={tab}
          authUser={authUser}
          isAdmin={isAdminUser}
          sandboxBilling={sandboxBilling}
          announcementSeen={announcementSeen}
          feedbackSent={feedbackSent}
          onSelectTab={selectTab}
          onOpenGuide={() => setGuideModalOpen(true)}
          onOpenSurvey={() => {
            setSurveyError(null);
            setManualSurveyOpen(true);
          }}
          onOpenDonate={() => setDonateModalOpen(true)}
          onOpenAdminStats={() => setAdminStatsModalOpen(true)}
          onOpenHeroPools={() => openDraftTool("pools")}
          onOpenPlans={() => selectTab("plans")}
          onOpenAuth={() => setAuthModalOpen(true)}
          onOpenProfile={() => { window.location.hash = "profile"; }}
          onLogout={() => void handleLogout()}
          onClose={() => setMobileDrawerOpen(false)}
        />
      )}
      {adminStatsModalOpen && isAdminUser && (
        <Suspense fallback={null}>
          <AdminStatsModal onClose={() => setAdminStatsModalOpen(false)} />
        </Suspense>
      )}
      {pricingSurveyOpen && (
        <PricingSurveyModal
          busy={surveyBusy}
          error={surveyError && translateMessage(t, surveyError)}
          feedbackSent={feedbackSent}
          onSubmitFeedback={handleSubmitFeedback}
          onAfterSubmit={handleAfterFeedbackSubmit}
          onAcknowledge={handleAcknowledgeAnnouncement}
          onSnooze={handleSnoozeSurvey}
          onOpenAnalytics={sandboxBilling ? () => selectTab("analytics") : undefined}
          freePromoUntil={authUser?.is_paid ? null : freePromoUntil}
          isAuthenticated={authUser !== null}
          onOpenPromoProfile={
            sandboxBilling
              ? (authUser ? () => selectTab("profile") : () => setAuthModalOpen(true))
              : undefined
          }
        />
      )}
      {donateModalOpen && <DonateModal onClose={() => setDonateModalOpen(false)} />}
      {guideModalOpen && <UserGuideModal onClose={() => setGuideModalOpen(false)} />}
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
          dismissDisabled={migrationBusy}
          onClose={migrationBusy ? () => {} : handleIgnoreMigration}
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3.5">
            <h2 id={migrationTitleId} className="font-display text-sm font-bold tracking-wide text-ink sm:text-base">
              {t("พบข้อมูลดราฟต์จากโหมด Guest")}
            </h2>
            {!migrationBusy && (
              <button
                type="button"
                onClick={handleIgnoreMigration}
                aria-label={t("ปิด")}
                className="inline-flex h-8 w-8 items-center justify-center text-dim transition-colors hover:bg-panel-2 hover:text-ink"
              >
                <X size={18} />
              </button>
            )}
          </div>
          <div className="space-y-3 px-5 py-4 text-xs leading-relaxed text-muted sm:text-sm">
            <p className="text-ink">
              {t(
                "พบดราฟต์ในโหมด Guest ({0}) ย้ายเข้าบัญชี {1} ไหม?",
                [
                  pendingMigration.draft.actionsCount > 0 ? t("เลือก/แบน {0} ตัว", pendingMigration.draft.actionsCount) : null,
                  pendingMigration.draft.seriesCount > 0 ? t("บันทึก {0} เกม", pendingMigration.draft.seriesCount) : null,
                  pendingMigration.draft.globalBanCount > 0
                    ? t("Global Ban {0} ตัว", pendingMigration.draft.globalBanCount)
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
                accountLabel(pendingMigration.user),
              )}
            </p>
            <p className="text-[11px] text-dim sm:text-xs">
              {t("รวมเข้ากับประวัติเดิมในบัญชีโดยไม่ลบของเก่า")}
            </p>
            {migrationError && (
              <div className="border border-red/40 bg-red/10 px-3 py-2 text-[11px] text-red sm:text-xs">
                {translateMessage(t, migrationError)}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-panel-2/40 px-5 py-3">
            <button
              type="button"
              disabled={migrationBusy}
              onClick={handleIgnoreMigration}
              className="min-h-9 border border-line-strong bg-panel px-4 py-1.5 font-display text-xs font-semibold text-muted transition-colors hover:border-ink/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              <StableButtonLabel message="ข้าม" />
            </button>
            <button
              type="button"
              disabled={migrationBusy}
              onClick={() => void handleConfirmMigration()}
              className="min-h-9 border border-gold bg-gold px-4 py-1.5 font-display text-xs font-bold text-bg transition-colors hover:bg-gold/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <StableButtonLabel message={migrationBusy ? "กำลังรวมข้อมูล..." : "รวมเข้าบัญชี"} alternatives={["กำลังรวมข้อมูล...", "รวมเข้าบัญชี"]} />
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default App;

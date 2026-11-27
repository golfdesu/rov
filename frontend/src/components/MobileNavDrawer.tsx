import { StableButtonLabel } from "./StableButtonLabel";
import { useLanguage } from "../i18n/language";
import { LanguageSwitch } from "../i18n/LanguageProvider";
import { BarChart3, BookOpen, Coffee, Crown, Download, LogIn, LogOut, Megaphone, Share, User, Users, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { AuthUser } from "../types/auth";
import { accountLabel } from "../utils/auth";
import { usePwaInstall } from "../utils/pwa";
import { MiniDraftLogo } from "./MiniDraftLogo";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

export interface MobileDrawerTabItem<T extends string> {
  key: T;
  label: string;
}

interface MobileNavDrawerProps<T extends string> {
  tabs: MobileDrawerTabItem<T>[];
  activeTab: T;
  authUser: AuthUser | null;
  isAdmin?: boolean;
  sandboxBilling?: boolean;
  announcementSeen: boolean;
  feedbackSent?: boolean;
  onSelectTab: (tab: T) => void;
  onOpenGuide: () => void;
  onOpenSurvey: () => void;
  onOpenDonate: () => void;
  onOpenAdminStats?: () => void;
  onOpenHeroPools?: () => void;
  onOpenPlans?: () => void;
  onOpenAuth: () => void;
  onOpenProfile: () => void;
  onLogout: () => void;
  onClose: () => void;
}

/** Accessible right-side slide-out drawer for utility controls and mobile navigation. */
export function MobileNavDrawer<T extends string>({
  tabs,
  activeTab,
  authUser,
  isAdmin = false,
  sandboxBilling = false,
  announcementSeen,
  feedbackSent = false,
  onSelectTab,
  onOpenGuide,
  onOpenSurvey,
  onOpenDonate,
  onOpenAdminStats,
  onOpenHeroPools,
  onOpenPlans,
  onOpenAuth,
  onOpenProfile,
  onLogout,
  onClose,
}: MobileNavDrawerProps<T>) {
  const { t } = useLanguage();
  const { canInstall, canInstallIos, promptInstall } = usePwaInstall();
  const [showIosGuide, setShowIosGuide] = useState(false);
  const accountName = authUser ? accountLabel(authUser) : "";
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const closeTimerRef = useRef<number | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const requestClose = useCallback((afterClose?: () => void) => {
    setIsVisible(false);
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    const reducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      onCloseRef.current();
      afterClose?.();
      return;
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onCloseRef.current();
      afterClose?.();
    }, 180);
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();
    const rafId = window.requestAnimationFrame(() => {
      setIsVisible(true);
    });

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        requestClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(rafId);
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus();
    };
  }, [requestClose]);

  const announcementTooltipMessage = feedbackSent
    ? "ดูประกาศอัปเดตหรือส่ง Feedback เพิ่มเติม"
    : announcementSeen
      ? "อ่านประกาศอัปเดตและส่ง Feedback"
      : "มีอัปเดตใหม่ รออ่านและส่ง Feedback";
  const announcementStatusMessage = feedbackSent ? "ส่งแล้ว" : announcementSeen ? "อ่านแล้ว" : "ใหม่";

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-[2px] transition-opacity duration-200 ease-out motion-reduce:transition-none ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex h-full w-[min(84vw,300px)] flex-col border-l border-line-strong bg-panel shadow-2xl outline-none transition-transform duration-200 ease-out motion-reduce:transition-none ${
          isVisible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <MiniDraftLogo className="h-5 w-5 shrink-0" />
            <h2 id={titleId} className="font-display text-sm font-extrabold tracking-widest text-ink">
              MINI<span className="text-gold">DRAFT</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={() => requestClose()}
            aria-label={t("ปิดเมนู")}
            className="inline-flex h-8 w-8 items-center justify-center text-dim transition-colors hover:bg-panel-2 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          {/* Mode Navigation first for instant mobile/tablet thumb reach */}
          <div className="flex flex-col gap-1.5 lg:hidden">
            <span className="font-mono text-[10px] font-semibold tracking-wider text-dim uppercase">{t("โหมดใช้งาน")}</span>
            {tabs.map((item) => {
              const active = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    onSelectTab(item.key);
                    requestClose();
                  }}
                  className={`flex min-h-10 w-full items-center justify-between border px-3 py-1.5 font-display text-xs font-semibold transition-colors ${
                    active
                      ? "border-gold/60 bg-gold/10 text-gold"
                      : "border-line bg-panel-2/60 text-ink hover:border-line-strong"
                  }`}
                >
                  <span>{t(item.label)}</span>
                </button>
              );
            })}
          </div>

          <LanguageSwitch />
          {/* Account Section */}
          <div className="border border-line bg-bg/60 p-3">
            {authUser ? (
              <div className="flex flex-col gap-2.5">
                <div className="flex min-h-7 min-w-0 items-center gap-2 text-xs text-ink">
                  <User className="h-4 w-4 shrink-0 text-gold" />
                  <span className="min-w-0 flex-1 truncate font-mono font-bold">{accountName}</span>
                </div>
                <button
                  type="button"
                  aria-label={t("เปิดโปรไฟล์ของ {0}", accountName)}
                  onClick={() => requestClose(onOpenProfile)}
                  className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 border border-line-strong bg-panel-2 px-3 py-1.5 font-display text-xs font-semibold text-ink transition-colors hover:border-gold/60 hover:text-gold"
                >
                  <User className="h-3.5 w-3.5 shrink-0 text-gold" />
                  <span><StableButtonLabel message="โปรไฟล์" /></span>
                </button>
                {authUser.stripe_sandbox_enabled && onOpenPlans && (
                  <button
                    type="button"
                    onClick={() => requestClose(onOpenPlans)}
                    className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 border border-line-strong bg-panel-2 px-3 py-1.5 font-display text-xs font-semibold text-ink transition-colors hover:border-gold/60 hover:text-gold"
                  >
                    <Crown className="h-3.5 w-3.5 shrink-0 text-gold" />
                    <span><StableButtonLabel message="แพ็กเกจ & สิทธิ์ใช้งาน" /></span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => requestClose(onLogout)}
                  className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 border border-line-strong bg-panel-2 px-3 py-1.5 font-display text-xs font-semibold text-muted transition-colors hover:border-red/60 hover:text-red"
                >
                  <LogOut className="h-3.5 w-3.5 shrink-0" />
                  <span><StableButtonLabel message="ออกจากระบบ" /></span>
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <span className="font-mono text-[11px] text-muted">{t("โหมด Guest · บันทึกในเครื่องนี้")}</span>
                <button
                  type="button"
                  onClick={() => requestClose(onOpenAuth)}
                  className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 border border-gold/60 bg-gold/10 px-3 py-1.5 font-display text-xs font-bold text-gold transition-colors hover:bg-gold hover:text-bg"
                >
                  <LogIn className="h-3.5 w-3.5 shrink-0" />
                  <span><StableButtonLabel message="เข้าสู่ระบบ / สมัครสมาชิก" /></span>
                </button>
              </div>
            )}
          </div>

          {sandboxBilling && authUser && onOpenHeroPools && (
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10px] font-semibold tracking-wider text-dim uppercase">
                {t("เครื่องมือดราฟต์")}
              </span>
              <button
                type="button"
                onClick={() => requestClose(onOpenHeroPools)}
                className="flex min-h-10 w-full items-center gap-2 border border-line-strong bg-panel-2 px-3 py-1.5 text-left font-display text-xs font-semibold text-ink transition-colors hover:border-gold/60 hover:text-gold"
              >
                <Users className="h-4 w-4 shrink-0 text-gold" />
                <span>{t("Hero Pools")}</span>
              </button>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] font-semibold tracking-wider text-dim uppercase">
              {t("ประกาศ & สนับสนุน")}
            </span>
            <button
              type="button"
              onClick={() => requestClose(onOpenGuide)}
              className="flex min-h-10 w-full items-center gap-2 border border-line-strong bg-panel-2 px-3 py-1.5 text-left font-display text-xs font-semibold text-ink transition-colors hover:border-gold/60 hover:text-gold"
            >
              <BookOpen className="h-4 w-4 shrink-0 text-gold" />
              <StableButtonLabel message="คู่มือการใช้งาน" className="inline-grid text-left" />
            </button>
            <button
              type="button"
              title={t(announcementTooltipMessage)}
              onClick={() => requestClose(onOpenSurvey)}
              className="flex min-h-10 w-full items-center justify-between gap-2 border border-line-strong bg-panel-2 px-3 py-1.5 text-left font-display text-xs font-semibold text-ink transition-colors hover:border-gold/60 hover:text-gold"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Megaphone className="h-4 w-4 shrink-0 text-gold" />
                <StableButtonLabel message="อัปเดตใหม่ & Feedback" className="inline-grid items-center text-left whitespace-nowrap" />
              </span>
              <span
                className={`shrink-0 font-mono text-[10px] whitespace-nowrap ${
                  feedbackSent ? "text-good" : announcementSeen ? "text-muted" : "text-gold"
                }`}
              >
                <StableButtonLabel
                  message={announcementStatusMessage}
                  alternatives={["ใหม่", "อ่านแล้ว", "ส่งแล้ว"]}
                  className="inline-grid items-center whitespace-nowrap text-right"
                />
              </span>
            </button>

            {(canInstall || canInstallIos) && (
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  aria-expanded={canInstallIos ? showIosGuide : undefined}
                  onClick={() => {
                    if (canInstall) {
                      void promptInstall();
                      requestClose();
                    } else {
                      setShowIosGuide((v) => !v);
                    }
                  }}
                  className="flex min-h-11 w-full items-center gap-2 border border-gold/50 bg-gold/10 px-3 py-1.5 text-left font-display text-xs font-semibold text-gold transition-colors hover:bg-gold hover:text-bg"
                >
                  <Download className="h-4 w-4 shrink-0" />
                  <StableButtonLabel message="ติดตั้งแอป" className="inline-grid text-left" />
                </button>
                {canInstallIos && showIosGuide && (
                  <div className="border border-gold/30 bg-bg/80 px-3 py-2 text-[11px] leading-relaxed text-ink">
                    <div className="font-display font-semibold text-gold">
                      {t("วิธีติดตั้งบน iPhone / iPad")}
                    </div>
                    <p className="mt-1">
                      {t("1. แตะปุ่มแชร์บนแถบ Safari")}{" "}
                      <Share className="inline h-3.5 w-3.5 align-text-bottom text-gold" aria-hidden="true" />
                    </p>
                    <p>{t("2. เลือกเพิ่มไปยังหน้าจอโฮม")}</p>
                    <p className="mt-1 text-[10px] text-dim">
                      {t("เปิดผ่าน Safari หากยังไม่เห็นเมนูนี้")}
                    </p>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => requestClose(onOpenDonate)}
              className="flex min-h-10 w-full items-center gap-2 border border-line-strong bg-panel-2 px-3 py-1.5 text-left font-display text-xs font-semibold text-ink transition-colors hover:border-gold/60 hover:text-gold"
            >
              <Coffee className="h-4 w-4 shrink-0 text-gold" />
              <StableButtonLabel message="สนับสนุนผู้พัฒนา" className="inline-grid text-left" />
            </button>

            {isAdmin && onOpenAdminStats && (
              <button
                type="button"
                onClick={() => requestClose(onOpenAdminStats)}
                className="flex min-h-10 w-full items-center gap-2 border border-line-strong bg-panel-2 px-3 py-1.5 text-left font-display text-xs font-semibold text-ink transition-colors hover:border-gold/60 hover:text-gold"
              >
                <BarChart3 className="h-4 w-4 shrink-0 text-gold" />
                <StableButtonLabel message="สถิติระบบ" className="inline-grid text-left" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

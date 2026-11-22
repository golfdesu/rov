import { StableButtonLabel } from "./StableButtonLabel";
import { useLanguage } from "../i18n/language";
import { LanguageSwitch } from "../i18n/LanguageProvider";
import { BarChart3, Coffee, LogIn, LogOut, MessageSquare, User, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { AuthUser, PricingSurveyChoice } from "../types/auth";
import { accountLabel } from "../utils/auth";
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
  surveyAnswered: boolean;
  surveyChoice?: PricingSurveyChoice | null;
  onSelectTab: (tab: T) => void;
  onOpenSurvey: () => void;
  onOpenDonate: () => void;
  onOpenAdminStats?: () => void;
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
  surveyAnswered,
  surveyChoice,
  onSelectTab,
  onOpenSurvey,
  onOpenDonate,
  onOpenAdminStats,
  onOpenAuth,
  onOpenProfile,
  onLogout,
  onClose,
}: MobileNavDrawerProps<T>) {
  const { t } = useLanguage();
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

  const surveyTooltipMessage = surveyAnswered
    ? surveyChoice === "willing"
      ? "ตอบแล้ว: พร้อมจ่าย"
      : surveyChoice === "not_willing"
        ? "ตอบแล้ว: ไม่พร้อม"
        : "ตอบแล้ว"
    : "ยังไม่ได้ตอบ";
  const surveyStatusMessage = surveyAnswered ? "ตอบแล้ว" : "ยังไม่ได้ตอบ";

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
            className="inline-flex h-8 w-8 items-center justify-center rounded text-dim transition-colors hover:bg-panel-2 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          <LanguageSwitch />
          {/* Account Section */}
          <div className="border border-line bg-bg/60 p-3">
            {authUser ? (
              <div className="flex flex-col gap-2.5">
                <button
                  type="button"
                  aria-label={t("เปิดโปรไฟล์ของ {0}", accountName)}
                  onClick={() => requestClose(onOpenProfile)}
                  className="flex min-h-8 min-w-0 items-center gap-2 text-left text-xs text-good transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-good"
                >
                  <User className="h-4 w-4 shrink-0" />
                  <span className="max-w-[200px] truncate font-mono font-bold">{accountName}</span>
                  <span className="ml-auto text-muted">{t("โปรไฟล์")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => requestClose(onLogout)}
                  className="inline-flex h-9 w-full items-center justify-center gap-1.5 border border-line-strong bg-panel-2 px-3 font-display text-xs font-semibold text-muted transition-colors hover:border-red/60 hover:text-red"
                >
                  <LogOut className="h-3.5 w-3.5 shrink-0" />
                  <span><StableButtonLabel message="ออกจากระบบ" /></span>
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <span className="font-mono text-[11px] text-muted">{t("กำลังใช้งานในโหมด Guest (บันทึกในเครื่องนี้)")}</span>
                <button
                  type="button"
                  onClick={() => requestClose(onOpenAuth)}
                  className="inline-flex h-9 w-full items-center justify-center gap-1.5 border border-gold/60 bg-gold/10 px-3 font-display text-xs font-bold text-gold transition-colors hover:bg-gold hover:text-bg"
                >
                  <LogIn className="h-3.5 w-3.5 shrink-0" />
                  <span><StableButtonLabel message="เข้าสู่ระบบ / สมัครสมาชิก" /></span>
                </button>
              </div>
            )}
          </div>

          {/* Mode Navigation (hidden on lg+ because desktop navbar already lists tabs) */}
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
                  className={`flex h-10 w-full items-center justify-between border px-3 font-display text-xs font-semibold transition-colors ${
                    active
                      ? "border-gold/60 bg-gold/10 text-gold"
                      : "border-line bg-panel-2/60 text-ink hover:border-line-strong"
                  }`}
                >
                  <span>{t(item.label)}</span>
                  {active && <span className="font-mono text-[10px]">ACTIVE</span>}
                </button>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] font-semibold tracking-wider text-dim uppercase">
              {t("แบบสอบถาม & สนับสนุน")}
            </span>
            <button
              type="button"
              title={t(surveyTooltipMessage)}
              onClick={() => requestClose(onOpenSurvey)}
              className="flex h-10 w-full items-center justify-between gap-2 border border-line-strong bg-panel-2 px-3 font-display text-xs font-semibold text-ink transition-colors hover:border-gold/60 hover:text-gold"
            >
              <span className="flex min-w-0 items-center gap-2">
                <MessageSquare className="h-4 w-4 shrink-0 text-gold" />
                <StableButtonLabel message="แบบสอบถาม" className="inline-grid items-center whitespace-nowrap" />
              </span>
              <span
                className={`shrink-0 font-mono text-[10px] whitespace-nowrap ${surveyAnswered ? "text-good" : "text-gold"}`}
              >
                <StableButtonLabel
                  message={surveyStatusMessage}
                  alternatives={["ตอบแล้ว", "ยังไม่ได้ตอบ"]}
                  className="inline-grid items-center whitespace-nowrap text-right"
                />
              </span>
            </button>

            <button
              type="button"
              onClick={() => requestClose(onOpenDonate)}
              className="flex h-10 w-full items-center gap-2 border border-line-strong bg-panel-2 px-3 font-display text-xs font-semibold text-ink transition-colors hover:border-gold/60 hover:text-gold"
            >
              <Coffee className="h-4 w-4 shrink-0 text-gold" />
              <span>Donate (PromptPay QR)</span>
            </button>

            {isAdmin && onOpenAdminStats && (
              <button
                type="button"
                onClick={() => requestClose(onOpenAdminStats)}
                className="flex h-10 w-full items-center gap-2 border border-gold/60 bg-gold/10 px-3 font-display text-xs font-bold text-gold transition-colors hover:bg-gold hover:text-bg"
              >
                <BarChart3 className="h-4 w-4 shrink-0" />
                <span><StableButtonLabel message="สถิติระบบ (Owner Stats)" /></span>
              </button>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-line bg-gold/10 px-4 py-2.5 text-center font-mono text-[11px] font-bold text-gold">
          {t("ให้บริการฟรีถึง 30/11/2026")}
        </div>
      </div>
    </div>
  );
}

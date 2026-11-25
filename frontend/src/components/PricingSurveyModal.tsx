import { StableButtonLabel } from "./StableButtonLabel";
import { useLanguage } from "../i18n/language";
import { ArrowRight, BarChart3, Check, Gift, Megaphone, Send, Sparkles, X } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Modal } from "./Modal";

interface PricingSurveyModalProps {
  busy: boolean;
  error: string | null;
  feedbackSent?: boolean;
  onSubmitFeedback: (message: string) => Promise<boolean>;
  onAfterSubmit: () => void;
  onAcknowledge: () => void;
  onSnooze: () => void;
  onOpenAnalytics?: () => void;
  freePromoUntil?: number | null;
  isAuthenticated?: boolean;
  onOpenPromoProfile?: () => void;
}

const UPDATE_HIGHLIGHTS = [
  {
    title: "สถิติซ้อมทีม & Scouting Report PDF",
    detail: "วิเคราะห์ Pick/Ban, Matchups, คอมโบ, ความลึก Hero Pool 4 แท็บ และส่งออกรายงาน A4",
  },
  {
    title: "จัดทัวร์นาเมนต์ & ประวัติฟรี 14 เกม",
    detail: "แยกบันทึกประวัติตามทัวร์นาเมนต์ ตั้งชื่อซีรีส์ และบันทึกประวัติฟรีได้ 14 เกม",
  },
  {
    title: "ระบบทีม & Hero Pool",
    detail: "ตั้ง Pool ฮีโร่รายเลนพร้อมแจ้งเตือนบนบอร์ด และซิงก์ประวัติทีมร่วมกันในแพ็ก Business",
  },
  {
    title: "ปรับปรุงบอร์ดดราฟต์, AI & PromptPay",
    detail: "วางช่อง Ban เหนือ Pick, รีเซ็ตเลนอัตโนมัติ, AI เร็วขึ้น และเพิ่มแพ็กเติมวันผ่าน PromptPay",
  },
] as const;

/** Update announcement and direct text feedback modal shown on first visit to this release or via Drawer. */
export function PricingSurveyModal({
  busy,
  error,
  feedbackSent = false,
  onSubmitFeedback,
  onAfterSubmit,
  onAcknowledge,
  onSnooze,
  onOpenAnalytics,
  freePromoUntil,
  isAuthenticated = false,
  onOpenPromoProfile,
}: PricingSurveyModalProps) {
  const { language, t } = useLanguage();
  const titleId = useId();
  const [message, setMessage] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [openedAt] = useState(Date.now);

  const trimmedLength = message.trim().length;
  const locked = busy || closing;
  const hasFreeProPromo = Boolean(freePromoUntil && freePromoUntil * 1000 > openedAt);
  const promoExpiryText = freePromoUntil
    ? new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(freePromoUntil * 1000)
    : "";

  const handleSubmit = async (e: FormEvent, requestClose: (afterClose?: () => void) => void) => {
    e.preventDefault();
    if (locked) return;
    const trimmed = message.trim();
    if (trimmed.length < 2) {
      setLocalError(t("กรุณาพิมพ์ข้อความอย่างน้อย 2 ตัวอักษร"));
      return;
    }
    setLocalError(null);
    const ok = await onSubmitFeedback(trimmed);
    if (ok) {
      setMessage("");
      setClosing(true);
      requestClose(onAfterSubmit);
    }
  };

  const displayError = localError ?? error;

  return (
    <Modal
      labelledBy={titleId}
      className="max-w-lg border-gold/40 pricing-survey-modal"
      dismissDisabled={locked}
      onClose={onSnooze}
    >
      {(requestClose) => (
        <>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-2">
              <Megaphone className="h-4 w-4 shrink-0 text-gold" />
              <h2 id={titleId} className="font-display text-sm font-bold tracking-wider text-ink sm:text-base">
                {t("อัปเดตใหม่ & Feedback MINIDRAFT")}
              </h2>
            </div>
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                if (locked) return;
                setClosing(true);
                requestClose();
              }}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-dim transition-colors hover:bg-panel-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={t("ปิดหน้าต่าง")}
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex flex-col gap-3.5 overflow-y-auto p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 border border-gold/40 bg-gold/10 px-2.5 py-1 font-mono text-[11px] font-bold text-gold">
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                <span>{t("อัปเดตล่าสุดจากเวอร์ชันก่อน")}</span>
              </span>
              {feedbackSent && (
                <span className="inline-flex items-center gap-1 border border-good/40 bg-good/10 px-2 py-1 font-mono text-[11px] font-bold text-good">
                  <Check className="h-3 w-3 shrink-0" />
                  <span>{t("เคยส่ง Feedback แล้ว")}</span>
                </span>
              )}
            </div>

            {hasFreeProPromo && (
              <div className="flex flex-col gap-2 border border-gold/50 bg-gold/10 p-3">
                <div className="flex items-start gap-2">
                  <Gift className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-xs font-bold text-gold sm:text-sm">
                      {t("แจกสิทธิ์ Pro ฟรี")}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink">
                      {t("กดรับสิทธิ์ได้ที่หน้าโปรไฟล์ เพื่อลองใช้ประวัติ 500 เกม, Hero Pools 50 ชุด และสถิติซ้อมทีมฟรี (หมดอายุ {0})", promoExpiryText)}
                    </p>
                  </div>
                </div>
                {onOpenPromoProfile && (
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => {
                      if (locked) return;
                      setClosing(true);
                      requestClose(() => {
                        onAcknowledge();
                        onOpenPromoProfile();
                      });
                    }}
                    className="inline-flex min-h-9 w-full items-center justify-between gap-2 border border-gold bg-gold px-3 py-1.5 font-display text-xs font-bold text-bg transition-colors hover:bg-gold/90 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
                  >
                    <StableButtonLabel
                      message={isAuthenticated ? "ไปรับ Pro ฟรีที่หน้าโปรไฟล์" : "เข้าสู่ระบบเพื่อรับ Pro ฟรี"}
                      alternatives={["ไปรับ Pro ฟรีที่หน้าโปรไฟล์", "เข้าสู่ระบบเพื่อรับ Pro ฟรี"]}
                    />
                    <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}

            <ul className="flex flex-col gap-2 border border-line bg-panel-2/60 p-3 text-xs leading-relaxed sm:text-[13px]">
              {UPDATE_HIGHLIGHTS.map((item) => (
                <li key={item.title} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                  <div className="min-w-0">
                    <strong className="font-display text-ink">{t(item.title)}</strong>
                    <span className="text-muted"> — {t(item.detail)}</span>
                  </div>
                </li>
              ))}
            </ul>

            {onOpenAnalytics && (
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  if (locked) return;
                  setClosing(true);
                  requestClose(() => {
                    onAcknowledge();
                    onOpenAnalytics();
                  });
                }}
                className="inline-flex min-h-10 w-full items-center justify-between gap-2 border border-gold/50 bg-gold/10 px-3 py-2 font-display text-xs font-bold text-gold transition-colors hover:bg-gold hover:text-bg disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <BarChart3 className="h-4 w-4 shrink-0" />
                  <span><StableButtonLabel message="ลองดูสถิติซ้อมทีม" /></span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0" />
              </button>
            )}

            <form onSubmit={(e) => void handleSubmit(e, requestClose)} className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={`${titleId}-feedback`} className="font-display text-xs font-bold text-ink sm:text-sm">
                  {t("เขียน Feedback หรือข้อเสนอแนะถึงผู้พัฒนา")}
                </label>
                <span className="font-mono text-[11px] text-dim">{trimmedLength} / 1500</span>
              </div>

              <textarea
                id={`${titleId}-feedback`}
                value={message}
                disabled={locked}
                onChange={(e) => {
                  setMessage(e.target.value);
                  if (localError) setLocalError(null);
                }}
                maxLength={1500}
                rows={3}
                placeholder={t("แจ้งบั๊ก แนะนำฟีเจอร์ หรือบอกความรู้สึกหลังลองฟีเจอร์ใหม่ได้เลย...")}
                className="w-full resize-y border border-line-strong bg-bg px-3 py-2 text-xs leading-relaxed text-ink placeholder:text-dim focus:border-gold focus:outline-none disabled:opacity-60 sm:text-sm"
              />

              {displayError && (
                <div className="border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
                  {displayError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 pt-0.5 sm:grid-cols-2">
                <button
                  type="submit"
                  disabled={locked || trimmedLength < 2}
                  className="inline-flex min-h-10 items-center justify-center gap-1.5 border border-gold bg-gold px-3 py-2 font-display text-sm font-bold text-bg transition-colors hover:bg-gold/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send className="h-4 w-4 shrink-0" />
                  <span><StableButtonLabel message="ส่ง Feedback" /></span>
                </button>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    if (locked) return;
                    setClosing(true);
                    requestClose(onAcknowledge);
                  }}
                  className="inline-flex min-h-10 items-center justify-center border border-line-strong bg-panel-2 px-3 py-2 font-display text-xs font-semibold text-ink transition-colors hover:border-ink/40 hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
                >
                  <StableButtonLabel message="รับทราบ / ปิด" />
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </Modal>
  );
}

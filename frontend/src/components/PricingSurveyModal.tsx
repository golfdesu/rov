import { Check, Coins, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { PricingSurveyChoice } from "../types/auth";
import { Modal } from "./Modal";

interface PricingSurveyModalProps {
  busy: boolean;
  error: string | null;
  answered?: boolean;
  currentChoice?: PricingSurveyChoice | null;
  onSelect: (choice: PricingSurveyChoice) => Promise<boolean>;
  onAfterSelect: (choice: PricingSurveyChoice) => void;
  onSnooze: () => void;
}

/** Daily willingness-to-pay survey popup shown once per day on entering the Draft screen (or manually via Feedback). */
export function PricingSurveyModal({
  busy,
  error,
  answered = false,
  currentChoice,
  onSelect,
  onAfterSelect,
  onSnooze,
}: PricingSurveyModalProps) {
  const titleId = useId();
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const alreadyAnswered = answered || currentChoice === "willing" || currentChoice === "not_willing";

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  const runExitTransition = useCallback((done: () => void) => {
    setIsClosing(true);
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    const reducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      done();
      return;
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      done();
    }, 180);
  }, []);

  const handleRequestSnooze = useCallback(() => {
    if (busy || isClosing) return;
    runExitTransition(onSnooze);
  }, [busy, isClosing, onSnooze, runExitTransition]);

  const handleChoiceClick = async (choice: PricingSurveyChoice) => {
    if (busy || isClosing) return;
    const ok = await onSelect(choice);
    if (ok) {
      runExitTransition(() => onAfterSelect(choice));
    }
  };

  return (
    <Modal
      labelledBy={titleId}
      className="max-w-sm border-gold/40"
      isClosing={isClosing}
      onClose={busy || isClosing ? () => {} : handleRequestSnooze}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 shrink-0 text-gold" />
          <h2 id={titleId} className="font-display text-sm font-bold tracking-wider text-ink sm:text-base">
            สำรวจความคิดเห็น MINIDRAFT
          </h2>
        </div>
        <button
          type="button"
          disabled={busy || isClosing}
          onClick={handleRequestSnooze}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-dim transition-colors hover:bg-panel-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={alreadyAnswered ? "ปิดหน้าต่าง" : "ไว้ถามใหม่วันพรุ่งนี้"}
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex shrink-0 flex-col gap-3.5 p-4 sm:p-5">
        <div className="inline-flex w-fit items-center border border-gold/40 bg-gold/10 px-2.5 py-1 font-mono text-[11px] font-bold text-gold">
          เปิดให้ใช้งานฟรีถึง 30/11/2026
        </div>

        <p className="text-sm font-medium leading-relaxed text-ink sm:text-base">
          หากในอนาคตเว็บมีการเก็บค่าบริการรายเดือนเพื่อช่วยดูแลค่าเซิร์ฟเวอร์และพัฒนาต่อ คุณพร้อมจะจ่ายหรือไม่?
        </p>

        {alreadyAnswered ? (
          <div className="border border-good/40 bg-good/10 px-3 py-2 text-xs text-good">
            คุณตอบแล้ว:{" "}
            <strong>
              {currentChoice === "willing"
                ? "พร้อมจ่าย"
                : currentChoice === "not_willing"
                  ? "ไม่พร้อม"
                  : "บันทึกคำตอบแล้ว"}
            </strong>{" "}
            (สามารถกดเปลี่ยนคำตอบได้)
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-muted sm:text-[13px]">
            คำตอบของคุณจะช่วยให้ผู้พัฒนาวางแผนการเปิดให้บริการต่อได้อย่างเหมาะสม (ตอบครั้งเดียว จะไม่แสดงซ้ำอีก)
          </p>
        )}

        {error && (
          <div className="border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5 pt-0.5">
          <button
            type="button"
            disabled={busy || isClosing}
            onClick={() => void handleChoiceClick("willing")}
            className={`inline-flex h-10 items-center justify-center gap-1.5 border px-3 font-display text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              currentChoice === "willing"
                ? "border-gold bg-gold text-bg ring-2 ring-gold/40"
                : "border-gold bg-gold text-bg hover:bg-gold/90"
            }`}
          >
            <Check className="h-4 w-4 shrink-0" />
            <span>พร้อมจ่าย</span>
          </button>
          <button
            type="button"
            disabled={busy || isClosing}
            onClick={() => void handleChoiceClick("not_willing")}
            className={`inline-flex h-10 items-center justify-center border px-3 font-display text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              currentChoice === "not_willing"
                ? "border-gold/70 bg-panel-2 text-gold"
                : "border-line-strong bg-panel-2 text-ink hover:border-ink/40 hover:bg-panel"
            }`}
          >
            ไม่พร้อม
          </button>
        </div>

        <button
          type="button"
          disabled={busy || isClosing}
          onClick={handleRequestSnooze}
          className="inline-flex h-9 w-full items-center justify-center border border-line bg-transparent px-3 font-display text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {alreadyAnswered ? "ปิด" : "ภายหลัง (ไว้ถามใหม่พรุ่งนี้)"}
        </button>
      </div>
    </Modal>
  );
}

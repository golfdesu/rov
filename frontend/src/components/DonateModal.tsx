import { useLanguage } from "../i18n/language";
import { StableButtonLabel } from "./StableButtonLabel";
import { Coffee, Download, X } from "lucide-react";
import { useId } from "react";
import { Modal } from "./Modal";

interface DonateModalProps {
  onClose: () => void;
}

/** Lightweight PromptPay QR donation modal (static image, zero external API calls). */
export function DonateModal({ onClose }: DonateModalProps) {
  const { t } = useLanguage();
  const titleId = useId();

  return (
    <Modal labelledBy={titleId} className="max-w-sm" onClose={onClose}>
      {(requestClose) => (
        <>
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <Coffee className="h-4 w-4 shrink-0 text-gold" />
          <h2 id={titleId} className="font-display text-sm font-bold tracking-wider text-ink sm:text-base">
            {t("สนับสนุนผู้พัฒนา MINIDRAFT")}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => requestClose()}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-dim transition-colors hover:bg-panel-2 hover:text-ink"
          aria-label={t("ปิด")}
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex shrink-0 flex-col items-center gap-3.5 p-4 text-center sm:p-5">
        <p className="text-sm font-medium leading-relaxed text-ink sm:text-base">
          {t("เลี้ยงข้าวผมหน่อยค้าบ")}
        </p>

        <div className="shrink-0 overflow-hidden rounded border border-line-strong bg-white p-1.5 shadow-inner">
          <img
            src="/donate-qr.jpg"
            alt={t("PromptPay QR Code สำหรับสนับสนุนผู้พัฒนา MiniDraft")}
            width={590}
            height={685}
            className="h-auto max-h-[44dvh] w-auto object-contain"
          />
        </div>

        <a
          href="/donate-qr.jpg"
          download="minidraft-donate-qr.jpg"
          className="inline-flex h-10 w-full items-center justify-center gap-2 border border-gold/50 bg-gold/10 px-4 font-display text-sm font-bold text-gold transition-colors hover:bg-gold hover:text-bg"
        >
          <Download className="h-4 w-4 shrink-0" />
          <StableButtonLabel message="บันทึก QR" />
        </a>

        <p className="w-full border border-red/35 bg-red/10 px-3 py-2 text-xs leading-relaxed text-red sm:text-[13px]">
          {t("การสนับสนุนโดยสมัครใจ ขอคืนเงินไม่ได้ และไม่ผูกพันระยะเวลาเปิดให้บริการ")}
        </p>
      </div>
        </>
      )}
    </Modal>
  );
}

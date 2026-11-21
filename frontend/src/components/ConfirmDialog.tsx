import { type Message, useLanguage } from "../i18n/language";
import { AlertTriangle, X } from "lucide-react";
import { useId } from "react";
import { createPortal } from "react-dom";
import { Modal } from "./Modal";
import { StableButtonLabel } from "./StableButtonLabel";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: Message;
  cancelLabel?: Message;
  tone?: "gold" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}

/** In-theme dark broadcast confirmation dialog replacing native browser confirm(). */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "gold",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useLanguage();
  const titleId = useId();
  const isDanger = tone === "danger";

  return createPortal(
    <Modal
      labelledBy={titleId}
      onClose={onCancel}
      className="max-w-md overflow-hidden [clip-path:none]"
    >
      {(requestClose) => (
        <>
      <div className={`h-0.5 w-full ${isDanger ? "bg-red" : "bg-gold"}`} />
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border ${
              isDanger ? "border-red/50 bg-red/15 text-red" : "border-gold/50 bg-gold/15 text-gold"
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
          </div>
          <h2 id={titleId} className="font-display text-sm font-bold text-ink">
            {title}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => requestClose()}
          aria-label={t("ปิด")}
          className="min-h-7 min-w-7 rounded p-1 text-dim transition-colors hover:bg-panel-2 hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-5 py-4">
        <p className="whitespace-pre-line text-xs leading-relaxed text-muted sm:text-[13px]">{message}</p>
      </div>

      <div className="flex items-center justify-end gap-2.5 border-t border-line bg-bg/70 px-5 py-3">
        <button
          type="button"
          onClick={() => requestClose()}
          className="h-9 border border-line-strong bg-panel px-4 font-display text-xs font-semibold text-muted transition-colors hover:border-ink/40 hover:text-ink"
        >
          <StableButtonLabel message={cancelLabel} />
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`h-9 px-4 font-display text-xs font-bold transition-colors ${
            isDanger
              ? "border border-red bg-red text-ink hover:bg-red/90"
              : "border border-gold bg-gold text-bg hover:bg-gold/90"
          }`}
        >
          <StableButtonLabel message={confirmLabel} />
        </button>
      </div>
        </>
      )}
    </Modal>,
    document.body,
  );
}

import { type ReactNode, type RefObject, useEffect, useRef } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  /** id of the element that names the dialog */
  labelledBy: string;
  /** Classes for the dialog panel (size); shared chrome is applied here */
  className?: string;
  /** Element to focus on open; defaults to the first focusable element */
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}

/** Accessible dialog: Escape/backdrop close, focus trap, body scroll lock, focus restore on close. */
export function Modal({ labelledBy, className = "", initialFocusRef, onClose, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (initialFocusRef?.current ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
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
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus();
    };
  }, [initialFocusRef]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`flex w-full flex-col rounded-lg border border-line bg-panel shadow-2xl outline-none clip-chamfer ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  /** id of the element that names the dialog */
  labelledBy: string;
  /** Classes for the dialog panel (size); shared chrome is applied here */
  className?: string;
  /** Element to focus on open; defaults to the first focusable element */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** When true, plays the smooth exit (fade + scale-down) transition before unmounting */
  isClosing?: boolean;
  onClose: () => void;
  children: ReactNode | ((requestClose: (afterClose?: () => void) => void) => ReactNode);
}

/** Accessible dialog: Escape/backdrop close, focus trap, body scroll lock, focus restore on close. */
export function Modal({
  labelledBy,
  className = "",
  initialFocusRef,
  isClosing = false,
  onClose,
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const mouseDownTargetRef = useRef<EventTarget | null>(null);
  const [isEntered, setIsEntered] = useState(false);
  const [internalClosing, setInternalClosing] = useState(false);
  const [afterCloseCb, setAfterCloseCb] = useState<(() => void) | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const requestClose = useCallback((afterClose?: () => void) => {
    setInternalClosing(true);
    if (afterClose) {
      setAfterCloseCb(() => afterClose);
    }
  }, []);

  useEffect(() => {
    if (!internalClosing) return;
    const reducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      onCloseRef.current();
      afterCloseCb?.();
      return;
    }
    const timerId = window.setTimeout(() => {
      onCloseRef.current();
      afterCloseCb?.();
    }, 180);
    return () => window.clearTimeout(timerId);
  }, [internalClosing, afterCloseCb]);

  useEffect(() => {
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (initialFocusRef?.current ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();
    const rafId = window.requestAnimationFrame(() => {
      setIsEntered(true);
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
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus();
    };
  }, [initialFocusRef, requestClose]);

  const show = isEntered && !isClosing && !internalClosing;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm transition-opacity duration-200 ease-out motion-reduce:transition-none ${
        show ? "opacity-100" : "opacity-0"
      }`}
      onMouseDown={(e) => {
        mouseDownTargetRef.current = e.target;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && mouseDownTargetRef.current === e.currentTarget) {
          requestClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`flex max-h-[92dvh] w-full flex-col overflow-y-auto rounded-lg border border-line bg-panel shadow-2xl outline-none transition-all duration-200 ease-out motion-reduce:transition-none clip-chamfer ${
          show ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-95 opacity-0"
        } ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {typeof children === "function" ? children(requestClose) : children}
      </div>
    </div>
  );
}

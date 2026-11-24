import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";

const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]";
const MODAL = '[role="dialog"][aria-modal="true"]';

function isVisible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0 && window.getComputedStyle(element).visibility === "visible";
}

function getTabStops(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest("[inert]") && isVisible(element),
  );
}

interface ModalProps {
  /** id of the element that names the dialog */
  labelledBy: string;
  /** Classes for the dialog panel (size); shared chrome is applied here */
  className?: string;
  mobileSheet?: boolean;
  /** Element to focus on open; defaults to the first focusable element */
  initialFocusRef?: RefObject<HTMLElement | null>;
  dismissDisabled?: boolean;
  /** When true, plays the smooth exit (fade + scale-down) transition before unmounting */
  isClosing?: boolean;
  onClose: () => void;
  children: ReactNode | ((requestClose: (afterClose?: () => void) => void) => ReactNode);
}

/** Accessible dialog: Escape/backdrop close, focus trap, body scroll lock, focus restore on close. */
export function Modal({
  labelledBy,
  className = "",
  mobileSheet = false,
  initialFocusRef,
  dismissDisabled = false,
  isClosing = false,
  onClose,
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const dismissDisabledRef = useRef(dismissDisabled);
  const mouseDownTargetRef = useRef<EventTarget | null>(null);
  const [isEntered, setIsEntered] = useState(false);
  const [internalClosing, setInternalClosing] = useState(false);
  const [afterCloseCb, setAfterCloseCb] = useState<(() => void) | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
    dismissDisabledRef.current = dismissDisabled;
  }, [onClose, dismissDisabled]);

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
    if (!panel) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const preferred = initialFocusRef?.current;
    const initialTarget = preferred && panel.contains(preferred) && isVisible(preferred) && !preferred.matches(":disabled")
      ? preferred
      : getTabStops(panel)[0] ?? panel;
    initialTarget.focus({ preventScroll: true });
    const rafId = window.requestAnimationFrame(() => {
      setIsEntered(true);
    });

    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || (e.key !== "Escape" && e.key !== "Tab")) return;
      const topDialog = Array.from(document.querySelectorAll<HTMLElement>(MODAL)).findLast(isVisible);
      if (topDialog !== panel) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (!dismissDisabledRef.current) requestClose();
        return;
      }

      const items = getTabStops(panel);
      const active = document.activeElement;
      const first = items[0];
      const last = items[items.length - 1];
      if (!active || !items.some((item) => item === active)) {
        e.preventDefault();
        ((e.shiftKey ? last : first) ?? panel).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
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
      className={`fixed inset-0 z-50 flex justify-center bg-black/80 backdrop-blur-sm transition-opacity duration-200 ease-out motion-reduce:transition-none ${
        mobileSheet ? "items-end sm:items-center sm:p-3" : "items-center p-3"
      } ${
        show ? "opacity-100" : "opacity-0"
      }`}
      onMouseDown={(e) => {
        mouseDownTargetRef.current = e.target;
      }}
      onClick={(e) => {
        if (!dismissDisabled && e.target === e.currentTarget && mouseDownTargetRef.current === e.currentTarget) {
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
          show ? "translate-y-0 scale-100 opacity-100" : `translate-y-2 opacity-0 ${mobileSheet ? "sm:scale-95" : "scale-95"}`
        } ${mobileSheet ? "max-sm:rounded-b-none max-sm:rounded-t-xl max-sm:pb-[env(safe-area-inset-bottom)] max-sm:[clip-path:none]" : ""} ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {typeof children === "function" ? children(requestClose) : children}
      </div>
    </div>
  );
}

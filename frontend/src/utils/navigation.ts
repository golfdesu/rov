import type { MouseEvent } from "react";

export const APP_NAVIGATE_EVENT = "minidraft:navigate";

export function navigateTo(path: string, replace = false): void {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (window.location.pathname === normalized && !window.location.hash) return;
  if (replace) {
    window.history.replaceState(null, "", normalized);
  } else {
    window.history.pushState(null, "", normalized);
  }
  window.dispatchEvent(new Event(APP_NAVIGATE_EVENT));
}

export function handleSpaLinkClick(event: MouseEvent<HTMLAnchorElement>, path: string): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  navigateTo(path);
}

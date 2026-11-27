import { useCallback, useEffect, useState } from "react";

const INSTALL_DISMISSED_KEY = "minidraft_pwa_install_dismissed_v1";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let listenerInitialized = false;
const subscribers = new Set<() => void>();

function notifySubscribers(): void {
  for (const listener of subscribers) listener();
}

function isDismissed(): boolean {
  try {
    return window.localStorage.getItem(INSTALL_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function isIosDevice(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator;
  const ua = nav.userAgent || "";
  const isLegacyIos = /iPad|iPhone|iPod/i.test(ua);
  const isIpadOsDesktopUa = nav.platform === "MacIntel" && nav.maxTouchPoints > 1;
  return isLegacyIos || isIpadOsDesktopUa;
}

export function initPwaInstallListener(): void {
  if (typeof window === "undefined" || listenerInitialized) return;
  listenerInitialized = true;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    notifySubscribers();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    notifySubscribers();
  });
}

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !import.meta.env.PROD || !("serviceWorker" in navigator)) {
    return;
  }
  const register = () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Service worker registration never blocks app startup
    });
  };
  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}

export function usePwaInstall() {
  const [, setVersion] = useState(0);

  useEffect(() => {
    initPwaInstallListener();
    const update = () => setVersion((v) => v + 1);
    subscribers.add(update);
    return () => {
      subscribers.delete(update);
    };
  }, []);

  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true);

  const canInstall = Boolean(deferredInstallPrompt) && !isStandalone && !isDismissed();
  const canInstallIos = !canInstall && isIosDevice() && !isStandalone && !isDismissed();

  const promptInstall = useCallback(async () => {
    const promptEvent = deferredInstallPrompt;
    if (!promptEvent) return false;
    deferredInstallPrompt = null;
    notifySubscribers();
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      return choice.outcome === "accepted";
    } catch {
      return false;
    }
  }, []);

  const dismissInstall = useCallback(() => {
    try {
      window.localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
    } catch {
      // Ignore storage errors
    }
    notifySubscribers();
  }, []);

  return { canInstall, canInstallIos, promptInstall, dismissInstall };
}

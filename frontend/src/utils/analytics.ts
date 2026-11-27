import type { PostHog } from "posthog-js";

const POSTHOG_KEY = (import.meta.env.VITE_POSTHOG_KEY ?? "").trim();
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST ?? "").trim() || "https://us.i.posthog.com";

let posthogInstance: PostHog | null = null;
let loadScheduled = false;
let initialized = false;
let lastIdentifiedId: string | null = null;
let pendingReset = false;
let pendingIdentify: {
  distinctId: string;
  properties?: Record<string, string | number | boolean | null | undefined>;
} | null = null;
const pendingEvents: Array<{
  eventName: string;
  properties?: Record<string, string | number | boolean | null | undefined>;
}> = [];

export function isAnalyticsEnabled(): boolean {
  return typeof window !== "undefined" && POSTHOG_KEY.length > 0;
}

function flushQueuedAnalytics(ph: PostHog): void {
  if (pendingReset) {
    pendingReset = false;
    ph.reset();
  }
  if (pendingIdentify) {
    const next = pendingIdentify;
    pendingIdentify = null;
    ph.identify(next.distinctId, next.properties);
  }
  while (pendingEvents.length > 0) {
    const item = pendingEvents.shift();
    if (item) ph.capture(item.eventName, item.properties);
  }
}

export function initAnalytics(): void {
  if (!isAnalyticsEnabled() || loadScheduled) return;
  loadScheduled = true;

  const start = () => {
    void import("posthog-js")
      .then((mod) => {
        const ph = mod.default;
        ph.init(POSTHOG_KEY, {
          api_host: POSTHOG_HOST,
          person_profiles: "identified_only",
          capture_pageview: true,
          capture_pageleave: true,
          autocapture: false,
          disable_external_dependency_loading: true,
          disable_surveys: true,
          disable_session_recording: true,
          capture_performance: false,
          capture_dead_clicks: false,
        });
        posthogInstance = ph;
        initialized = true;
        flushQueuedAnalytics(ph);
      })
      .catch(() => {
        loadScheduled = false;
      });
  };

  const ric = (window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (typeof ric === "function") {
    ric(start, { timeout: 1500 });
  } else {
    window.setTimeout(start, 1000);
  }
}

export function identifyAnalyticsUser(
  distinctId: string,
  properties?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (!isAnalyticsEnabled() || !distinctId) return;
  if (lastIdentifiedId === distinctId && !properties) return;
  lastIdentifiedId = distinctId;
  pendingReset = false;
  if (initialized && posthogInstance) {
    posthogInstance.identify(distinctId, properties);
    return;
  }
  pendingIdentify = { distinctId, properties };
}

export function resetAnalyticsUser(): void {
  if (!isAnalyticsEnabled() || lastIdentifiedId === null) return;
  lastIdentifiedId = null;
  pendingIdentify = null;
  if (initialized && posthogInstance) {
    posthogInstance.reset();
    return;
  }
  pendingReset = true;
}

export function captureAnalyticsEvent(
  eventName: string,
  properties?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (!isAnalyticsEnabled() || !eventName) return;
  if (initialized && posthogInstance) {
    posthogInstance.capture(eventName, properties);
    return;
  }
  if (pendingEvents.length < 50) {
    pendingEvents.push({ eventName, properties });
  }
}

export function isFeatureFlagEnabled(flagKey: string, defaultValue = false): boolean {
  if (!isAnalyticsEnabled() || !initialized || !posthogInstance || !flagKey) return defaultValue;
  return posthogInstance.isFeatureEnabled(flagKey) ?? defaultValue;
}

import posthog from "posthog-js";

const POSTHOG_KEY = (import.meta.env.VITE_POSTHOG_KEY ?? "").trim();
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST ?? "").trim() || "https://us.i.posthog.com";

let initialized = false;
let lastIdentifiedId: string | null = null;

export function isAnalyticsEnabled(): boolean {
  return typeof window !== "undefined" && POSTHOG_KEY.length > 0;
}

export function initAnalytics(): void {
  if (!isAnalyticsEnabled() || initialized) return;
  initialized = true;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: "identified_only",
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: false,
  });
}

export function identifyAnalyticsUser(
  distinctId: string,
  properties?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (!isAnalyticsEnabled() || !initialized || !distinctId) return;
  if (lastIdentifiedId === distinctId && !properties) return;
  lastIdentifiedId = distinctId;
  posthog.identify(distinctId, properties);
}

export function resetAnalyticsUser(): void {
  if (!isAnalyticsEnabled() || !initialized || lastIdentifiedId === null) return;
  lastIdentifiedId = null;
  posthog.reset();
}

export function captureAnalyticsEvent(
  eventName: string,
  properties?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (!isAnalyticsEnabled() || !initialized || !eventName) return;
  posthog.capture(eventName, properties);
}

export function isFeatureFlagEnabled(flagKey: string, defaultValue = false): boolean {
  if (!isAnalyticsEnabled() || !initialized || !flagKey) return defaultValue;
  return posthog.isFeatureEnabled(flagKey) ?? defaultValue;
}

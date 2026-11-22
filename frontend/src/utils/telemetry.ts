const TELEMETRY_CLIENT_ID_KEY = "minidraft_pricing_survey_client_id_v1";

export type TelemetryMetricKey =
  | "draft_completed_18"
  | "practice_completed_18"
  | "ai_adopt_top1"
  | "ai_adopt_top2_5"
  | "ai_adopt_top6_10"
  | "ai_adopt_offmeta"
  | "league_GLOBAL"
  | "league_RPL"
  | "league_GCS"
  | "league_AOG"
  | "league_INTL"
  | "mode_bo1"
  | "mode_bo3"
  | "mode_bo5"
  | "mode_bo7"
  | "feat_timer_start"
  | "feat_pick_lane"
  | "feat_replace_hero"
  | "feat_practice_hints_off";

export function getStoredClientId(): string | null {
  try {
    const cid = window.localStorage.getItem(TELEMETRY_CLIENT_ID_KEY);
    if (cid && /^[a-zA-Z0-9_-]{8,64}$/.test(cid)) return cid;
  } catch {
    // Ignore storage errors
  }
  return null;
}

const queuedCounts: Partial<Record<TelemetryMetricKey, number>> = {};
let flushTimer: number | null = null;

function flushTelemetryQueue(): void {
  flushTimer = null;
  const entries = Object.entries(queuedCounts).filter(([, count]) => typeof count === "number" && count > 0);
  if (entries.length === 0) return;
  const payloadEvents: Record<string, number> = {};
  for (const [key, count] of entries) {
    payloadEvents[key] = Math.min(50, count);
    delete queuedCounts[key as TelemetryMetricKey];
  }
  const clientId = getStoredClientId();
  void fetch("/telemetry/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      events: payloadEvents,
      ...(clientId ? { client_id: clientId } : {}),
    }),
  }).catch(() => {
    // Fire-and-forget telemetry never blocks UI
  });
}

export function trackTelemetryEvent(metric: TelemetryMetricKey, delta = 1): void {
  if (typeof window === "undefined" || delta <= 0) return;
  queuedCounts[metric] = Math.min(50, (queuedCounts[metric] ?? 0) + delta);
  if (flushTimer === null) {
    flushTimer = window.setTimeout(flushTelemetryQueue, 2000);
  }
}

export function aiAdoptionMetricForRank(rank: number | undefined): TelemetryMetricKey {
  if (rank === 1) return "ai_adopt_top1";
  if (rank !== undefined && rank >= 2 && rank <= 5) return "ai_adopt_top2_5";
  if (rank !== undefined && rank >= 6 && rank <= 10) return "ai_adopt_top6_10";
  return "ai_adopt_offmeta";
}

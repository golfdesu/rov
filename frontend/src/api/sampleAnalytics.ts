import type { TournamentRef } from "../types/draft";
import type { PeriodDiffMode, PeriodDiffSummary, ScrimAdvancedStats } from "../utils/scrimAdvancedStats";
import type {
  AllTeamsAnalyticsSummary,
  AllTeamsGameNumStat,
  GameNumStat,
  ScrimAnalyticsSummary,
} from "../utils/scrimStats";
import { getJson } from "./client";

export type SampleDatePreset = "all" | "last7" | "last30";

export interface SampleAnalyticsResponse {
  totalGames: number;
  scopedGameCount: number;
  tournament: TournamentRef;
  teamNames: string[];
  opponents: string[];
  focusTeam: string;
  opponent: string;
  datePreset: SampleDatePreset;
  periodMode: PeriodDiffMode;
  stats: ScrimAnalyticsSummary | null;
  allStats: AllTeamsAnalyticsSummary | null;
  advanced: ScrimAdvancedStats;
  periodDiff: PeriodDiffSummary;
}

interface RawScrimAnalyticsSummary extends Omit<ScrimAnalyticsSummary, "byGameNum"> {
  byGameNum: Record<string, GameNumStat>;
}

interface RawAllTeamsAnalyticsSummary extends Omit<AllTeamsAnalyticsSummary, "byGameNum"> {
  byGameNum: Record<string, AllTeamsGameNumStat>;
}

interface RawSampleAnalyticsResponse extends Omit<SampleAnalyticsResponse, "stats" | "allStats"> {
  stats: RawScrimAnalyticsSummary | null;
  allStats: RawAllTeamsAnalyticsSummary | null;
}

function hydrateGameNumMap<T>(raw: Record<string, T>): Map<number, T> {
  const map = new Map<number, T>();
  for (const [key, value] of Object.entries(raw)) {
    const gNum = Number(key);
    if (Number.isFinite(gNum)) map.set(gNum, value);
  }
  return map;
}

export async function fetchSampleAnalytics({
  team,
  opponent,
  datePreset,
  periodMode,
  signal,
}: {
  team: string;
  opponent: string;
  datePreset: SampleDatePreset;
  periodMode: "split_half" | "last7_vs_prev";
  signal?: AbortSignal;
}): Promise<SampleAnalyticsResponse> {
  const params = new URLSearchParams({
    team,
    opponent,
    date_preset: datePreset,
    period_mode: periodMode,
  });
  const raw = await getJson<RawSampleAnalyticsResponse>(`/analytics/sample?${params.toString()}`, signal);
  return {
    ...raw,
    stats: raw.stats ? { ...raw.stats, byGameNum: hydrateGameNumMap(raw.stats.byGameNum) } : null,
    allStats: raw.allStats ? { ...raw.allStats, byGameNum: hydrateGameNumMap(raw.allStats.byGameNum) } : null,
  };
}

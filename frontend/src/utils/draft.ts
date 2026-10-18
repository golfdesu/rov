import { CANONICAL_DRAFT_STEPS, type HeroRecommendation, type RoleType } from "../types/draft";

export interface DraftState {
  bluePicks: string[];
  redPicks: string[];
  blueBans: string[];
  redBans: string[];
}

/** Maps each of the 18 draft steps to the hero locked at that step (or null if not reached yet). */
export function heroesByStep(state: DraftState): (string | null)[] {
  const counters = { "blue-pick": 0, "red-pick": 0, "blue-ban": 0, "red-ban": 0 };
  const lists = {
    "blue-pick": state.bluePicks,
    "red-pick": state.redPicks,
    "blue-ban": state.blueBans,
    "red-ban": state.redBans,
  };
  return CANONICAL_DRAFT_STEPS.map((s) => {
    const key = `${s.side}-${s.action}` as keyof typeof counters;
    return lists[key][counters[key]++] ?? null;
  });
}

/** Strips the Thai suffix from backend lane labels, e.g. "DS_Lane (ออฟเลน)" -> "DS_Lane". */
export function laneKey(lane: string): string {
  return lane.split(" ")[0];
}

export const LANE_SHORT: Record<string, { en: string; th: string }> = {
  DS_Lane: { en: "DSL", th: "ออฟเลน" },
  Jungle: { en: "JGL", th: "ป่า" },
  Mid: { en: "MID", th: "เลนกลาง" },
  Dragon_Lane: { en: "ADL", th: "แครี่" },
  Roam: { en: "SUP", th: "โรมมิ่ง" },
};

export const ROLES: RoleType[] = ["Warrior", "Assassin", "Mage", "Marksman", "Tank", "Support"];

export const TIER_STYLE: Record<string, string> = {
  "S+": "text-gold border-gold/60 bg-gold/10",
  S: "text-[#ff9f5a] border-[#ff9f5a]/50 bg-[#ff9f5a]/10",
  A: "text-blue border-blue/40 bg-blue/10",
  B: "text-muted border-line-strong bg-panel-2",
  C: "text-dim border-line bg-panel",
};

/** Lane keys the acting team still needs, e.g. ["Dragon_Lane", "Roam"]. */
export function missingLaneKeys(missingAllyLanes: string[]): Set<string> {
  return new Set(missingAllyLanes.map(laneKey));
}

/**
 * Moves heroes whose main pro lane fills a missing ally lane ahead of the rest, keeping the
 * model's order inside each group. No-op when every lane is still open (start of draft).
 */
export function prioritizeMissingLanes(recs: HeroRecommendation[], missingAllyLanes: string[]): HeroRecommendation[] {
  const missing = missingLaneKeys(missingAllyLanes);
  if (missing.size === 0 || missing.size >= 5) return recs;
  const fits = recs.filter((r) => missing.has(laneKey(r.primary_lane)));
  const rest = recs.filter((r) => !missing.has(laneKey(r.primary_lane)));
  return [...fits, ...rest].map((r, i) => ({ ...r, rank: i + 1 }));
}

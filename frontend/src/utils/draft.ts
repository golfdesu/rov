import { CANONICAL_DRAFT_STEPS, type DraftHistoryItem, type HeroRecommendation, type RoleType } from "../types/draft";

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

// ---------------------------------------------------------------------------
// Draft state machine (pure, used by useDraft)
// ---------------------------------------------------------------------------

export interface PredictionState {
  recommendations: HeroRecommendation[];
  blueNextPicks: HeroRecommendation[];
  redNextPicks: HeroRecommendation[];
  blueNextBans: HeroRecommendation[];
  redNextBans: HeroRecommendation[];
  banUnlockedHeroes: HeroRecommendation[];
  missingAllyLanes: string[];
}

export interface DraftMachineState extends DraftState {
  stepIndex: number;
  history: DraftHistoryItem[];
  prediction: PredictionState;
  blueWinRate: number;
  /** Blue win-rate estimate recorded at each draft step (index = step), used for trend + deltas */
  winHistory: number[];
}

export type DraftAction =
  | { type: "lock"; hero: string }
  | { type: "undo" }
  | { type: "reset" }
  | { type: "predicted"; stepIndex: number; prediction: PredictionState; blueWinRate: number | null };

export const DEFAULT_WIN_RATE = 50.0;

export const EMPTY_PREDICTION: PredictionState = {
  recommendations: [],
  blueNextPicks: [],
  redNextPicks: [],
  blueNextBans: [],
  redNextBans: [],
  banUnlockedHeroes: [],
  missingAllyLanes: [],
};

export const INITIAL_DRAFT_STATE: DraftMachineState = {
  stepIndex: 0,
  bluePicks: [],
  redPicks: [],
  blueBans: [],
  redBans: [],
  history: [],
  prediction: EMPTY_PREDICTION,
  blueWinRate: DEFAULT_WIN_RATE,
  winHistory: [],
};

export function unavailableSet(state: DraftState, globalBans: readonly string[] = []): Set<string> {
  return new Set([...state.bluePicks, ...state.redPicks, ...state.blueBans, ...state.redBans, ...globalBans]);
}

export function draftReducer(state: DraftMachineState, action: DraftAction): DraftMachineState {
  switch (action.type) {
    case "lock": {
      const step = CANONICAL_DRAFT_STEPS[state.stepIndex];
      if (!step || unavailableSet(state).has(action.hero)) return state;
      const key = `${step.side}${step.action === "pick" ? "Picks" : "Bans"}` as keyof DraftState;
      const snapshot: DraftHistoryItem = {
        stepIndex: state.stepIndex,
        bluePicks: state.bluePicks,
        redPicks: state.redPicks,
        blueBans: state.blueBans,
        redBans: state.redBans,
      };
      return {
        ...state,
        [key]: [...state[key], action.hero],
        stepIndex: state.stepIndex + 1,
        history: [...state.history, snapshot],
      };
    }
    case "undo": {
      const last = state.history.at(-1);
      if (!last) return state;
      return {
        ...state,
        ...last,
        history: state.history.slice(0, -1),
        // Drop stale derived state; useDraft refetches for the restored step
        prediction: EMPTY_PREDICTION,
        winHistory: state.winHistory.slice(0, last.stepIndex),
        blueWinRate: state.winHistory[last.stepIndex - 1] ?? DEFAULT_WIN_RATE,
      };
    }
    case "reset":
      return INITIAL_DRAFT_STATE;
    case "predicted": {
      // Ignore responses for a step the draft has already moved past
      if (action.stepIndex !== state.stepIndex) return state;
      if (action.blueWinRate === null) return { ...state, prediction: action.prediction };
      const winHistory = state.winHistory.slice(0, action.stepIndex);
      winHistory[action.stepIndex] = action.blueWinRate;
      return { ...state, prediction: action.prediction, blueWinRate: action.blueWinRate, winHistory };
    }
  }
}

/** Builds the /predict request for a draft step; past the last step it asks for the final blue win rate. */
export function buildPredictPayload(
  stepIndex: number,
  state: DraftState,
  globalBans: readonly string[],
  lookahead: boolean,
  candidatePool: number,
) {
  const step = CANONICAL_DRAFT_STEPS[stepIndex];
  if (!step) {
    return {
      mode: "pick",
      side: "blue",
      phase: 2,
      ally_picks: state.bluePicks,
      enemy_picks: state.redPicks,
      ally_bans: state.blueBans,
      enemy_bans: state.redBans,
      global_bans: globalBans,
      top_k: 1,
      use_lookahead: false,
    };
  }
  const isBlue = step.side === "blue";
  return {
    mode: step.action,
    side: step.side,
    phase: step.phase,
    ally_picks: isBlue ? state.bluePicks : state.redPicks,
    enemy_picks: isBlue ? state.redPicks : state.bluePicks,
    ally_bans: isBlue ? state.blueBans : state.redBans,
    enemy_bans: isBlue ? state.redBans : state.blueBans,
    global_bans: globalBans,
    top_k: candidatePool,
    use_lookahead: lookahead,
    lookahead_depth: 2,
  };
}

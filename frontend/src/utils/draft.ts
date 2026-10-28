import {
  CANONICAL_DRAFT_STEPS,
  type DraftHistoryItem,
  type GlobalBanState,
  type HeroRecommendation,
  type RecordedDraftGame,
  type RoleType,
} from "../types/draft";

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
  | {
      type: "hydrate";
      payload: {
        stepIndex: number;
        bluePicks: string[];
        redPicks: string[];
        blueBans: string[];
        redBans: string[];
        history: DraftHistoryItem[];
        blueWinRate: number;
        winHistory: number[];
      };
    }
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

export const EMPTY_GLOBAL_BANS: GlobalBanState = {
  teamAName: "TEAM A",
  teamBName: "TEAM B",
  teamAUsed: [],
  teamBUsed: [],
  universalBans: [],
  blueSideTeam: "A",
  gameNumber: 1,
};

export function blueUsedHeroes(gb: GlobalBanState): string[] {
  if (gb.gameNumber === 7) return [];
  return gb.blueSideTeam === "A" ? gb.teamAUsed : gb.teamBUsed;
}

export function redUsedHeroes(gb: GlobalBanState): string[] {
  if (gb.gameNumber === 7) return [];
  return gb.blueSideTeam === "A" ? gb.teamBUsed : gb.teamAUsed;
}

export function blueTeamName(gb: GlobalBanState): string {
  return gb.blueSideTeam === "A" ? gb.teamAName : gb.teamBName;
}

export function redTeamName(gb: GlobalBanState): string {
  return gb.blueSideTeam === "A" ? gb.teamBName : gb.teamAName;
}

export function resolveSeriesName(gb: GlobalBanState): string {
  if (gb.seriesName && gb.seriesName.trim()) {
    return gb.seriesName.trim();
  }
  const a = gb.teamAName?.trim() || "TEAM A";
  const b = gb.teamBName?.trim() || "TEAM B";
  return `${a} vs ${b}`;
}

export function getGameSeriesGroup(game: RecordedDraftGame): string {
  if (game.seriesName && game.seriesName.trim()) {
    return game.seriesName.trim();
  }
  const b = game.blueTeamName?.trim() || "BLUE";
  const r = game.redTeamName?.trim() || "RED";
  if (game.blueSideTeam === "A") {
    return `${b} vs ${r}`;
  }
  if (game.blueSideTeam === "B") {
    return `${r} vs ${b}`;
  }
  const sorted = [b, r].sort((x, y) => x.localeCompare(y));
  return `${sorted[0]} vs ${sorted[1]}`;
}

export function activeGlobalBansForStep(globalBans: GlobalBanState, stepIndex?: number): string[] {
  const bUsed = blueUsedHeroes(globalBans);
  const rUsed = redUsedHeroes(globalBans);
  if (stepIndex === undefined) {
    return [...bUsed, ...rUsed, ...globalBans.universalBans];
  }
  const step = CANONICAL_DRAFT_STEPS[stepIndex];
  if (!step) {
    return [...bUsed, ...rUsed, ...globalBans.universalBans];
  }
  const restrictedHeroes =
    step.action === "ban"
      ? (step.side === "blue" ? rUsed : bUsed)
      : (step.side === "blue" ? bUsed : rUsed);
  return [...restrictedHeroes, ...globalBans.universalBans];
}

export function unavailableSet(
  state: DraftState,
  globalBans: readonly string[] | GlobalBanState = [],
  stepIndex?: number,
): Set<string> {
  const gbList = Array.isArray(globalBans)
    ? globalBans
    : activeGlobalBansForStep(globalBans as GlobalBanState, stepIndex);
  return new Set([...state.bluePicks, ...state.redPicks, ...state.blueBans, ...state.redBans, ...gbList]);
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
    case "hydrate":
      return {
        ...state,
        ...action.payload,
        prediction: EMPTY_PREDICTION,
      };
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

/** Reconstructs step-by-step undo history and stepIndex from a saved DraftState. */
export function reconstructDraftHistory(draft: DraftState): {
  stepIndex: number;
  history: DraftHistoryItem[];
} {
  const history: DraftHistoryItem[] = [];
  const cur: DraftState = { bluePicks: [], redPicks: [], blueBans: [], redBans: [] };
  const idx = { bluePicks: 0, redPicks: 0, blueBans: 0, redBans: 0 };

  let stepIndex = 0;
  for (let i = 0; i < CANONICAL_DRAFT_STEPS.length; i++) {
    const s = CANONICAL_DRAFT_STEPS[i];
    const key = `${s.side}${s.action === "pick" ? "Picks" : "Bans"}` as keyof DraftState;
    const hero = draft[key][idx[key]];
    if (!hero) break;
    history.push({
      stepIndex: i,
      bluePicks: [...cur.bluePicks],
      redPicks: [...cur.redPicks],
      blueBans: [...cur.blueBans],
      redBans: [...cur.redBans],
    });
    cur[key] = [...cur[key], hero];
    idx[key]++;
    stepIndex = i + 1;
  }
  return { stepIndex, history };
}

/** Builds the /predict request for a draft step; past the last step it asks for the final blue win rate. */
export function buildPredictPayload(
  stepIndex: number,
  state: DraftState,
  globalBans: readonly string[] | GlobalBanState,
  lookahead: boolean,
  candidatePool: number,
) {
  const gbState: GlobalBanState = Array.isArray(globalBans)
    ? { ...EMPTY_GLOBAL_BANS, universalBans: [...globalBans] }
    : (globalBans as GlobalBanState);

  const bUsed = blueUsedHeroes(gbState);
  const rUsed = redUsedHeroes(gbState);

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
      global_bans: gbState.universalBans,
      blue_global_bans: bUsed,
      red_global_bans: rUsed,
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
    global_bans: gbState.universalBans,
    blue_global_bans: bUsed,
    red_global_bans: rUsed,
    top_k: candidatePool,
    use_lookahead: lookahead,
    lookahead_depth: 2,
  };
}

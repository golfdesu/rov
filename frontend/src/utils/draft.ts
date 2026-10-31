import {
  CANONICAL_DRAFT_STEPS,
  type DraftHistoryItem,
  type GlobalBanState,
  type HeroRecommendation,
  type LeagueCode,
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

/**
 * Computes the series win count for Team A and Team B in the specified series group.
 */
export function getSeriesScore(
  seriesGames: RecordedDraftGame[],
  groupName: string,
): { aWins: number; bWins: number } {
  let aWins = 0;
  let bWins = 0;
  for (const g of seriesGames) {
    if (getGameSeriesGroup(g) !== groupName) continue;
    if (g.winner === "A") aWins++;
    else if (g.winner === "B") bWins++;
  }
  return { aWins, bWins };
}

/**
 * Extracts all heroes picked by the winning team in earlier games (gameNumber < currentGameNumber)
 * of the active series group for in-series winner adaptation (steal-pick / target-ban boost).
 */
export function getSeriesWinningHeroes(
  seriesGames: RecordedDraftGame[],
  groupName: string,
  currentGameNumber: number,
): string[] {
  const winners = new Set<string>();
  for (const g of seriesGames) {
    if (getGameSeriesGroup(g) !== groupName || g.gameNumber >= currentGameNumber || !g.winner) continue;
    const winningPicks =
      g.winner === g.blueSideTeam ? g.bluePicks : g.redPicks;
    for (const h of winningPicks) {
      winners.add(h);
    }
  }
  return Array.from(winners);
}

/**
 * Returns a map from hero name to the game number (G1..G6) in which each team picked it
 * within the specified series group.
 */
export function heroOriginGameMap(
  seriesGames: RecordedDraftGame[],
  groupName: string,
): { teamAGameByHero: Record<string, number>; teamBGameByHero: Record<string, number> } {
  const teamAGameByHero: Record<string, number> = {};
  const teamBGameByHero: Record<string, number> = {};
  const groupGames = seriesGames
    .filter((g) => getGameSeriesGroup(g) === groupName)
    .sort((a, b) => a.gameNumber - b.gameNumber);

  for (const g of groupGames) {
    const aPicks = g.blueSideTeam === "A" ? g.bluePicks : g.redPicks;
    const bPicks = g.blueSideTeam === "A" ? g.redPicks : g.bluePicks;
    for (const h of aPicks) {
      if (teamAGameByHero[h] === undefined) teamAGameByHero[h] = g.gameNumber;
    }
    for (const h of bPicks) {
      if (teamBGameByHero[h] === undefined) teamBGameByHero[h] = g.gameNumber;
    }
  }
  return { teamAGameByHero, teamBGameByHero };
}

/**
 * Result of checking whether a game in a series is unlocked for draft navigation.
 */
export interface GameUnlockStatus {
  isUnlocked: boolean;
  requiredCount: number;
  aCount: number;
  bCount: number;
  missingGames: number[];
}

/**
 * Checks whether a given game number (1..7) is unlocked.
 * Game 1 is always unlocked.
 * A game is unlocked if:
 * 1) All preceding games 1..(targetGame - 1) exist in seriesGames history as completed drafts (5v5), OR
 * 2) Both Team A and Team B have at least 5 * (targetGame - 1) effective heroes in global ban
 *    (e.g. 5 per side for G2, 10 per side for G3, 15 per side for G4), OR
 * 3) The targetGame itself is already recorded as a completed game in series history.
 */
export function getGameUnlockStatus(
  targetGame: number,
  globalBans: GlobalBanState,
  seriesGames: RecordedDraftGame[],
  groupOverride?: string,
): GameUnlockStatus {
  const currentGroup = groupOverride ?? resolveSeriesName(globalBans);
  const completedNumbers = new Set(
    seriesGames
      .filter((g) => getGameSeriesGroup(g) === currentGroup && g.bluePicks.length >= 5 && g.redPicks.length >= 5)
      .map((g) => g.gameNumber),
  );

  const syncedForTarget = syncSeriesGlobalBans(globalBans, seriesGames, targetGame, [], currentGroup);
  const aCount = syncedForTarget.teamAUsed.length;
  const bCount = syncedForTarget.teamBUsed.length;
  const requiredCount = Math.max(0, 5 * (targetGame - 1));

  // Game 1 or already completed games in this series are always accessible
  if (targetGame <= 1 || completedNumbers.has(targetGame)) {
    return {
      isUnlocked: true,
      requiredCount,
      aCount,
      bCount,
      missingGames: [],
    };
  }

  // Check if all preceding games 1..(targetGame - 1) have been completed (5v5)
  const missingGames: number[] = [];
  for (let g = 1; g < targetGame; g++) {
    if (!completedNumbers.has(g)) {
      missingGames.push(g);
    }
  }

  if (missingGames.length === 0) {
    return {
      isUnlocked: true,
      requiredCount,
      aCount,
      bCount,
      missingGames: [],
    };
  }

  // Fast-forward condition: requires 5 * (targetGame - 1) heroes per team in Global Ban
  const isUnlocked = aCount >= requiredCount && bCount >= requiredCount;

  return { isUnlocked, requiredCount, aCount, bCount, missingGames };
}

/**
 * Returns the highest game number (1..7) that currently satisfies unlock conditions.
 */
export function getMaxUnlockedGame(
  globalBans: GlobalBanState,
  seriesGames: RecordedDraftGame[],
  groupOverride?: string,
): number {
  for (let g = 7; g >= 1; g--) {
    if (getGameUnlockStatus(g, globalBans, seriesGames, groupOverride).isUnlocked) {
      return g;
    }
  }
  return 1;
}

/**
 * Reconciles `teamAUsed` and `teamBUsed` against recorded games of the active series up to
 * `targetGameNumber` (exclusive), removing heroes from deleted/overwritten/future games while
 * preserving manually toggled heroes.
 */
export function syncSeriesGlobalBans(
  prev: GlobalBanState,
  nextSeriesGames: RecordedDraftGame[],
  targetGameNumber: number,
  removedGames: RecordedDraftGame[] = [],
  groupOverride?: string,
): { teamAUsed: string[]; teamBUsed: string[] } {
  const currentGroup = groupOverride ?? resolveSeriesName(prev);
  const groupGames = nextSeriesGames
    .filter((g) => getGameSeriesGroup(g) === currentGroup)
    .sort((a, b) => a.gameNumber - b.gameNumber);

  const removedA = new Set<string>();
  const removedB = new Set<string>();
  for (const g of [...removedGames, ...groupGames.filter((x) => x.gameNumber >= targetGameNumber)]) {
    const aPicks = g.blueSideTeam === "A" ? g.bluePicks : g.redPicks;
    const bPicks = g.blueSideTeam === "A" ? g.redPicks : g.bluePicks;
    aPicks.forEach((h) => removedA.add(h));
    bPicks.forEach((h) => removedB.add(h));
  }

  const recordedA = new Set<string>();
  const recordedB = new Set<string>();
  for (const g of groupGames) {
    if (g.gameNumber < targetGameNumber) {
      const aPicks = g.blueSideTeam === "A" ? g.bluePicks : g.redPicks;
      const bPicks = g.blueSideTeam === "A" ? g.redPicks : g.bluePicks;
      aPicks.forEach((h) => recordedA.add(h));
      bPicks.forEach((h) => recordedB.add(h));
    }
  }

  const manualA = prev.teamAUsed.filter((h) => !removedA.has(h));
  const manualB = prev.teamBUsed.filter((h) => !removedB.has(h));

  return {
    teamAUsed: Array.from(new Set([...manualA, ...recordedA])),
    teamBUsed: Array.from(new Set([...manualB, ...recordedB])),
  };
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
  league: LeagueCode = "GLOBAL",
  seriesWinningHeroes: readonly string[] = [],
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
      league,
      series_winning_heroes: [...seriesWinningHeroes],
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
    league,
    series_winning_heroes: [...seriesWinningHeroes],
  };
}

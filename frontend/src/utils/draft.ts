import {
  CANONICAL_DRAFT_STEPS,
  type DraftHistoryItem,
  type DraftStep,
  type GlobalBanState,
  type HeroRecommendation,
  type LaneKey,
  type LeagueCode,
  type RecordedDraftGame,
  type RoleType,
  type SeriesTeamNames,
  type TournamentRef,
} from "../types/draft";

export function localCalendarDate(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${month}-${day}`;
}

export function formatRecordedTimestamp(date: Date = new Date(), withSeconds = true): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  if (!withSeconds) return `${localCalendarDate(date)} ${hh}:${mm}`;
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${localCalendarDate(date)} ${hh}:${mm}:${ss}`;
}

export interface DraftState {
  bluePicks: string[];
  redPicks: string[];
  blueBans: string[];
  redBans: string[];
}

export function isSameRecordedDraft(
  saved: RecordedDraftGame | null | undefined,
  current: DraftState & Pick<RecordedDraftGame, "blueSideTeam" | "pickLanes">,
): boolean {
  if (!saved || saved.blueSideTeam !== current.blueSideTeam) return false;
  const sameHeroes = (a: string[], b: string[]) => a.length === b.length && a.every((hero, index) => hero === b[index]);
  const savedLanes = saved.pickLanes ?? {};
  const currentLanes = Object.entries(current.pickLanes ?? {});
  return (
    sameHeroes(saved.blueBans, current.blueBans) &&
    sameHeroes(saved.redBans, current.redBans) &&
    sameHeroes(saved.bluePicks, current.bluePicks) &&
    sameHeroes(saved.redPicks, current.redPicks) &&
    Object.keys(savedLanes).length === currentLanes.length &&
    currentLanes.every(([hero, lane]) => savedLanes[hero] === lane)
  );
}

export type DraftSlot = Pick<DraftStep, "side" | "action"> & { index: number };

export function draftSlotKey(slot: Pick<DraftSlot, "side" | "action">): keyof DraftState {
  return `${slot.side}${slot.action === "pick" ? "Picks" : "Bans"}`;
}

export function getDraftSlotStep(slot: DraftSlot): DraftStep | undefined {
  return CANONICAL_DRAFT_STEPS.filter((step) => step.side === slot.side && step.action === slot.action)[slot.index];
}

export function getCurrentDraftStep(stepIndex: number): DraftStep | null {
  return CANONICAL_DRAFT_STEPS[stepIndex] ?? null;
}

/** Maps each draft step to the hero locked at that step (or null if not reached yet). */
export function heroesByStep(state: DraftState): (string | null)[] {
  const steps = CANONICAL_DRAFT_STEPS;
  const counters = { "blue-pick": 0, "red-pick": 0, "blue-ban": 0, "red-ban": 0 };
  const lists = {
    "blue-pick": state.bluePicks,
    "red-pick": state.redPicks,
    "blue-ban": state.blueBans,
    "red-ban": state.redBans,
  };
  return steps.map((s) => {
    const key = `${s.side}-${s.action}` as keyof typeof counters;
    return lists[key][counters[key]++] ?? null;
  });
}

/** Strips commas and Thai suffixes from backend lane labels, e.g. "DS_Lane, Roam" -> "DS_Lane". */
export function laneKey(lane?: string): string {
  if (!lane) return "";
  const first = lane.replace(/,/g, " ").trim().split(/\s+/)[0] || "";
  return first === "Unpicked" ? "" : first;
}

/** Extracts all playable lanes for a hero, handling flex lanes, e.g. "DS_Lane, Roam" -> ["DS_Lane", "Roam"]. */
export function heroLanes(lane?: string): string[] {
  if (!lane) return [];
  return lane
    .split(/,\s*/)
    .map(laneKey)
    .filter((l): l is string => Boolean(l && l !== "Unpicked"));
}

export const LANE_SHORT: Record<string, { en: string; th: string }> = {
  DS_Lane: { en: "DSL", th: "ออฟเลน" },
  Jungle: { en: "JGL", th: "ป่า" },
  Mid: { en: "MID", th: "เลนกลาง" },
  Dragon_Lane: { en: "ADL", th: "เลนแครี่" },
  Roam: { en: "SUP", th: "โรมมิ่ง" },
};

export const LANE_CYCLE: readonly LaneKey[] = ["DS_Lane", "Jungle", "Mid", "Dragon_Lane", "Roam"];

function pickLaneOverridesFor(heroes: readonly string[], pickLanes: Record<string, LaneKey>): Record<string, LaneKey> {
  const out: Record<string, LaneKey> = {};
  for (const h of heroes) {
    const lane = pickLanes[h];
    if (lane) out[h] = lane;
  }
  return out;
}

export const ROLES: RoleType[] = ["Fighter", "Assassin", "Mage", "Carry", "Tank", "Support"];

/** Normalizes legacy global roles (Warrior -> Fighter, Marksman -> Carry) */
export function normalizeRole(role?: string | null): RoleType {
  if (!role) return "Fighter";
  if (role === "Warrior") return "Fighter";
  if (role === "Marksman") return "Carry";
  return role as RoleType;
}

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

export function buildPoolHeroLaneMap(
  lanes?: Partial<Record<LaneKey, readonly string[]>>,
): Map<string, Set<LaneKey>> {
  const map = new Map<string, Set<LaneKey>>();
  if (!lanes) return map;
  for (const lane of LANE_CYCLE) {
    for (const hero of lanes[lane] ?? []) {
      let set = map.get(hero);
      if (!set) {
        set = new Set<LaneKey>();
        map.set(hero, set);
      }
      set.add(lane);
    }
  }
  return map;
}

export function heroFitsLaneSet(
  heroName: string,
  primaryLane: string | undefined,
  targetLanes: Set<string>,
  allyPoolHeroLanes?: Map<string, Set<LaneKey>>,
): boolean {
  if (targetLanes.size === 0 || targetLanes.size >= 5) return true;
  const poolLanes = allyPoolHeroLanes?.get(heroName);
  if (poolLanes && poolLanes.size > 0) {
    for (const lane of poolLanes) {
      if (targetLanes.has(lane)) return true;
    }
    return false;
  }
  return heroLanes(primaryLane).some((l) => targetLanes.has(l)) || targetLanes.has(laneKey(primaryLane));
}

/**
 * Moves heroes whose main pro lane (or Hero Pool lane) fills a missing ally lane ahead of the rest,
 * keeping the model's order inside each group. No-op when every lane is still open (start of draft).
 */
export function prioritizeMissingLanes(
  recs: HeroRecommendation[],
  missingAllyLanes: string[],
  allyPoolHeroLanes?: Map<string, Set<LaneKey>>,
): HeroRecommendation[] {
  const missing = missingLaneKeys(missingAllyLanes);
  if (missing.size === 0 || missing.size >= 5) return recs;
  const fits = recs.filter((r) => heroFitsLaneSet(r.hero_name, r.primary_lane, missing, allyPoolHeroLanes));
  const rest = recs.filter((r) => !heroFitsLaneSet(r.hero_name, r.primary_lane, missing, allyPoolHeroLanes));
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
  future?: DraftHistoryItem[];
  prediction: PredictionState;
  blueWinRate: number;
  /** Blue win-rate estimate recorded at each draft step (index = step), used for trend + deltas */
  winHistory: number[];
}

export type DraftAction =
  | { type: "lock"; hero: string; expectedStepIndex?: number }
  | { type: "replace"; slot: DraftSlot; hero: string; globalBans: GlobalBanState }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset" }
  | { type: "swap_board_sides" }
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
  future: [],
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

export function resolveSeriesBaseName(gb: GlobalBanState): string {
  if (gb.seriesName && gb.seriesName.trim()) {
    return gb.seriesName.trim();
  }
  const a = gb.teamAName?.trim() || "TEAM A";
  const b = gb.teamBName?.trim() || "TEAM B";
  return `${a} vs ${b}`;
}

export function getGameSeriesBaseName(game: RecordedDraftGame): string {
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

export function getRecordedTeamNames(game: RecordedDraftGame): SeriesTeamNames {
  return game.blueSideTeam === "B"
    ? { teamAName: game.redTeamName, teamBName: game.blueTeamName }
    : { teamAName: game.blueTeamName, teamBName: game.redTeamName };
}

export function setRecordedTeamNames(game: RecordedDraftGame, teams: SeriesTeamNames): RecordedDraftGame {
  const { teamAName, teamBName } = teams;
  return {
    ...game,
    seriesName: game.seriesId ? game.seriesName : getGameSeriesBaseName(game),
    blueTeamName: game.blueSideTeam === "B" ? teamBName : teamAName,
    redTeamName: game.blueSideTeam === "B" ? teamAName : teamBName,
    teamNamesShared: true,
  };
}

export const MAX_SERIES_ANCHOR_LENGTH = 132;
export const DRAFT_GROUP_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export function normalizeHistoryName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length && name.length <= 64 ? name : null;
}

export function resolveSeriesName(gb: GlobalBanState): string {
  return gb.seriesTitle?.trim() || resolveSeriesBaseName(gb);
}

export function getGameSeriesGroup(game: RecordedDraftGame): string {
  return game.seriesTitle?.trim() || getGameSeriesBaseName(game);
}

export function createDraftGroupId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function normalizeTournament(value: unknown): TournamentRef | null {
  if (!value || typeof value !== "object" || !("id" in value) || !("name" in value)) return null;
  const { id, name } = value;
  if (typeof id !== "string" || !DRAFT_GROUP_ID.test(id) || typeof name !== "string" || name.length > 64) return null;
  return name.trim() ? { id, name: name.trim() } : null;
}

export function getGameSeriesKey(game: RecordedDraftGame): string {
  return game.seriesId ? `id:${game.seriesId}` : `name:${getGameSeriesBaseName(game)}`;
}

export function resolveSeriesKey(globalBans: GlobalBanState): string {
  return globalBans.seriesId ? `id:${globalBans.seriesId}` : `name:${resolveSeriesBaseName(globalBans)}`;
}

export function listTournaments(games: readonly RecordedDraftGame[]): TournamentRef[] {
  const tournaments = new Map<string, TournamentRef>();
  for (const { tournament } of games) {
    if (tournament && !tournaments.has(tournament.id)) tournaments.set(tournament.id, tournament);
  }
  return [...tournaments.values()].sort((a, b) => a.name.localeCompare(b.name));
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
    if (getGameSeriesKey(g) !== groupName) continue;
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
    if (getGameSeriesKey(g) !== groupName || g.gameNumber >= currentGameNumber || !g.winner) continue;
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
    .filter((g) => getGameSeriesKey(g) === groupName)
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
  const currentGroup = groupOverride ?? resolveSeriesKey(globalBans);
  const completedNumbers = new Set(
    seriesGames
      .filter((g) => getGameSeriesKey(g) === currentGroup && g.bluePicks.length >= 5 && g.redPicks.length >= 5)
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
  const currentGroup = groupOverride ?? resolveSeriesKey(prev);
  const groupGames = nextSeriesGames
    .filter((g) => getGameSeriesKey(g) === currentGroup)
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

function makeSnapshot(state: DraftMachineState): DraftHistoryItem {
  return {
    stepIndex: state.stepIndex,
    bluePicks: state.bluePicks,
    redPicks: state.redPicks,
    blueBans: state.blueBans,
    redBans: state.redBans,
  };
}

export function draftReducer(state: DraftMachineState, action: DraftAction): DraftMachineState {
  switch (action.type) {
    case "lock": {
      if (action.expectedStepIndex !== undefined && action.expectedStepIndex !== state.stepIndex) return state;
      if (unavailableSet(state).has(action.hero)) return state;
      const step = CANONICAL_DRAFT_STEPS[state.stepIndex];
      if (!step) return state;
      const key = draftSlotKey(step);
      return {
        ...state,
        [key]: [...state[key], action.hero],
        stepIndex: state.stepIndex + 1,
        history: [...state.history, makeSnapshot(state)],
        future: [],
        prediction: EMPTY_PREDICTION,
        winHistory: state.winHistory.slice(0, state.stepIndex + 1),
      };
    }
    case "replace": {
      const { slot, hero, globalBans } = action;
      const step = getDraftSlotStep(slot);
      const key = draftSlotKey(slot);
      if (!step || !state[key][slot.index] || unavailableSet(state, globalBans, step.step).has(hero)) return state;

      const heroes = state[key].slice();
      heroes[slot.index] = hero;
      const draft = { ...state, [key]: heroes };
      // Keep the actual turn and the later actions, and rebuild Undo snapshots for the edited board.
      const { history } = reconstructDraftHistory(draft);
      return {
        ...draft,
        history,
        future: [],
        prediction: EMPTY_PREDICTION,
        winHistory: state.winHistory.slice(0, step.step + 1),
        blueWinRate: state.winHistory[step.step] ?? DEFAULT_WIN_RATE,
      };
    }
    case "undo": {
      const last = state.history.at(-1);
      if (!last) return state;
      return {
        ...state,
        ...last,
        history: state.history.slice(0, -1),
        future: [...(state.future ?? []), makeSnapshot(state)],
        // Drop stale derived state; useDraft refetches for the restored step
        prediction: EMPTY_PREDICTION,
        blueWinRate: state.winHistory[last.stepIndex] ?? DEFAULT_WIN_RATE,
      };
    }
    case "redo": {
      const next = state.future?.at(-1);
      if (!next) return state;
      return {
        ...state,
        ...next,
        history: [...state.history, makeSnapshot(state)],
        future: (state.future ?? []).slice(0, -1),
        // Drop stale derived state; useDraft refetches for the advanced step
        prediction: EMPTY_PREDICTION,
        blueWinRate: state.winHistory[next.stepIndex] ?? DEFAULT_WIN_RATE,
      };
    }
    case "reset":
      return INITIAL_DRAFT_STATE;
    case "swap_board_sides": {
      if (
        state.stepIndex < CANONICAL_DRAFT_STEPS.length ||
        state.bluePicks.length !== 5 ||
        state.redPicks.length !== 5 ||
        state.blueBans.length !== 4 ||
        state.redBans.length !== 4
      ) {
        return state;
      }
      const swappedDraft = {
        ...state,
        bluePicks: [...state.redPicks],
        redPicks: [...state.bluePicks],
        blueBans: [...state.redBans],
        redBans: [...state.blueBans],
      };
      const { history } = reconstructDraftHistory(swappedDraft);
      return {
        ...swappedDraft,
        history,
        future: [],
        prediction: EMPTY_PREDICTION,
        winHistory: [],
        blueWinRate: Math.round((100 - state.blueWinRate) * 10) / 10,
      };
    }
    case "hydrate":
      return {
        ...state,
        ...action.payload,
        future: [],
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
    const key = draftSlotKey(s);
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

export type PoolMode = "high" | "low" | "off";

export interface PredictPoolContext {
  allyPool: readonly string[];
  enemyPool: readonly string[];
  poolMode: PoolMode;
  allyPoolLanes?: Partial<Record<LaneKey, readonly string[]>>;
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
  pickLanes: Record<string, LaneKey> = {},
  poolContext?: PredictPoolContext,
) {
  const gbState: GlobalBanState = Array.isArray(globalBans)
    ? { ...EMPTY_GLOBAL_BANS, universalBans: [...globalBans] }
    : (globalBans as GlobalBanState);

  const bUsed = [...blueUsedHeroes(gbState)].sort();
  const rUsed = [...redUsedHeroes(gbState)].sort();

  const step = getCurrentDraftStep(stepIndex);
  const actingUsedCount = !step
    ? Math.max(bUsed.length, rUsed.length)
    : step.action === "ban"
      ? step.side === "blue"
        ? rUsed.length
        : bUsed.length
      : step.side === "blue"
        ? bUsed.length
        : rUsed.length;
  const maxUniversal = Math.max(0, 40 - actingUsedCount);
  const rawCappedUniversal =
    gbState.universalBans.length > maxUniversal
      ? gbState.universalBans.slice(0, maxUniversal)
      : gbState.universalBans;
  const cappedUniversalBans = [...rawCappedUniversal].sort();
  const sortedWinningHeroes = [...seriesWinningHeroes].sort();

  if (!step) {
    return {
      mode: "pick",
      side: "blue",
      phase: 2,
      ally_picks: state.bluePicks,
      enemy_picks: state.redPicks,
      ally_bans: state.blueBans,
      enemy_bans: state.redBans,
      global_bans: cappedUniversalBans,
      blue_global_bans: bUsed,
      red_global_bans: rUsed,
      top_k: 1,
      use_lookahead: false,
      league,
      series_winning_heroes: sortedWinningHeroes,
      ally_pick_lanes: pickLaneOverridesFor(state.bluePicks, pickLanes),
      enemy_pick_lanes: pickLaneOverridesFor(state.redPicks, pickLanes),
    };
  }
  const isBlue = step.side === "blue";
  const allyPicks = isBlue ? state.bluePicks : state.redPicks;
  const enemyPicks = isBlue ? state.redPicks : state.bluePicks;
  const poolActive = Boolean(poolContext && poolContext.poolMode !== "off");
  const sortedAllyPool = poolActive && poolContext ? [...poolContext.allyPool].sort() : [];
  const sortedEnemyPool = poolActive && poolContext ? [...poolContext.enemyPool].sort() : [];
  const normalizedPoolLanes: Partial<Record<LaneKey, string[]>> = {};
  if (poolActive && poolContext?.allyPoolLanes) {
    for (const lane of LANE_CYCLE) {
      const list = poolContext.allyPoolLanes[lane];
      if (list && list.length > 0) {
        normalizedPoolLanes[lane] = [...new Set(list)].sort();
      }
    }
  }
  const hasPoolHint = sortedAllyPool.length > 0 || sortedEnemyPool.length > 0 || Object.keys(normalizedPoolLanes).length > 0;
  return {
    mode: step.action,
    side: step.side,
    phase: step.phase,
    ally_picks: allyPicks,
    enemy_picks: enemyPicks,
    ally_bans: isBlue ? state.blueBans : state.redBans,
    enemy_bans: isBlue ? state.redBans : state.blueBans,
    global_bans: cappedUniversalBans,
    blue_global_bans: bUsed,
    red_global_bans: rUsed,
    top_k: candidatePool,
    use_lookahead: lookahead,
    lookahead_depth: 2,
    league,
    series_winning_heroes: sortedWinningHeroes,
    ally_pick_lanes: pickLaneOverridesFor(allyPicks, pickLanes),
    enemy_pick_lanes: pickLaneOverridesFor(enemyPicks, pickLanes),
    ...(poolActive && hasPoolHint && poolContext
      ? {
          ally_pool: sortedAllyPool,
          enemy_pool: sortedEnemyPool,
          pool_only: poolContext.poolMode === "high",
          pool_mode: poolContext.poolMode,
          ally_pool_lanes: normalizedPoolLanes,
        }
      : {}),
  };
}

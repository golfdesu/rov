import type { LaneKey, RecordedDraftGame } from "../types/draft";
import { getGameSeriesKey, localCalendarDate } from "./draft";

export { localCalendarDate };

interface PickCounts {
  games: number;
  wins: number;
  losses: number;
  phase1Count: number;
  phase2Count: number;
  b1Count: number;
  r5Count: number;
}

interface PickPerformance extends PickCounts {
  decided: number;
  bayesianWr: number;
  deltaVsTeamPct: number;
  bayesianDeltaPct: number;
}

export interface HeroPerf extends PickPerformance {
  hero: string;
  lanes: Partial<Record<LaneKey, PickPerformance>>;
  flexLaneCount: number;
}

export interface BanStat {
  hero: string;
  total: number;
  p1: number;
  p2: number;
}

export interface DuoStat {
  a: string;
  b: string;
  games: number;
  wins: number;
  losses: number;
  decided: number;
  expectedBtWr: number;
  posteriorEbWr: number;
  synergyLiftPct: number;
  zScore: number;
  probSynergyPct: number;
  coPickLift: number;
}

export interface EnemyThreatStat {
  hero: string;
  games: number;
  ourWins: number;
  ourLosses: number;
  decided: number;
  posteriorOurWr: number;
  threatDeltaPct: number;
  zScore: number;
  probThreatPct: number;
}

export interface LaneMatchupStat {
  lane: LaneKey;
  allyHero: string;
  enemyHero: string;
  games: number;
  wins: number;
  losses: number;
  decided: number;
  expectedBtWr: number;
  posteriorWr: number;
  counterLiftPct: number;
  zScore: number;
  probAdvantagePct: number;
}

export interface ProtectiveBanStat {
  pickedHero: string;
  bannedHero: string;
  coCount: number;
  banLift: number;
}

export interface OpponentRow {
  opponent: string;
  games: number;
  seriesCount: number;
  wins: number;
  losses: number;
  ci: [number, number] | null;
  vsTeamTest: TwoPropZTestResult;
  topEnemies: [string, number][];
}

export interface EwmaPoint {
  idx: number;
  label: string;
  ewmaPct: number;
  win: boolean;
}

export interface TwoPropZTestResult {
  diffPct: number;
  zScore: number;
  pValue: number;
  significant95: boolean;
  probGroup1BetterPct: number;
  probDominantPct: number;
}

export interface SeriesWinProbSummary {
  bo5Pct: number;
  bo7Pct: number;
  bo5StartBluePct: number;
  bo5StartRedPct: number;
}

export interface DraftEdgeSummary {
  evaluatedGames: number;
  actualWins: number;
  expectedWins: number;
  winsAboveExpected: number;
  avgDraftEdgePct: number;
}

export interface GameNumStat {
  total: number;
  wins: number;
  decided: number;
  ci: [number, number] | null;
}

export interface ScrimAnalyticsSummary {
  total: number;
  seriesCount: number;
  wins: number;
  losses: number;
  decided: number;
  teamPrior: number;
  overallCi: [number, number] | null;
  blueWins: number;
  blueDecided: number;
  blueCi: [number, number] | null;
  redWins: number;
  redDecided: number;
  redCi: [number, number] | null;
  sideTest: TwoPropZTestResult;
  uniqueHeroCount: number;
  effectiveHeroPool: number;
  poolEvennessPct: number;
  byGameNum: Map<number, GameNumStat>;
  earlyVsLateTest: TwoPropZTestResult;
  fatigueSlopePctPerGame: number | null;
  ewmaSeries: EwmaPoint[];
  ewmaCurrentPct: number | null;
  ewmaDeltaPct: number | null;
  seriesWinProb: SeriesWinProbSummary | null;
  draftEdge: DraftEdgeSummary | null;
  allyList: HeroPerf[];
  phase1Top: HeroPerf[];
  phase2Top: HeroPerf[];
  bansAgainstUs: BanStat[];
  bansByUs: BanStat[];
  protectiveBans: ProtectiveBanStat[];
  topDuos: DuoStat[];
  toughestEnemies: EnemyThreatStat[];
  favorableEnemies: EnemyThreatStat[];
  laneStrengths: LaneMatchupStat[];
  laneWeaknesses: LaneMatchupStat[];
  opponentRows: OpponentRow[];
}

export interface AllTeamsHeroPerf extends HeroPerf {
  bans: number;
  banP1: number;
  banP2: number;
  contestCount: number;
  contestPct: number;
}

export interface AllTeamsTeamRow {
  team: string;
  games: number;
  seriesCount: number;
  wins: number;
  losses: number;
  decided: number;
  blueWins: number;
  blueDecided: number;
  redWins: number;
  redDecided: number;
  ci: [number, number] | null;
}

export interface AllTeamsGameNumStat {
  total: number;
  decided: number;
  blueWins: number;
  redWins: number;
}

export interface AllTeamsAnalyticsSummary {
  total: number;
  seriesCount: number;
  decided: number;
  blueWins: number;
  redWins: number;
  blueCi: [number, number] | null;
  redCi: [number, number] | null;
  sideTest: TwoPropZTestResult;
  uniqueHeroCount: number;
  effectiveHeroPool: number;
  poolEvennessPct: number;
  byGameNum: Map<number, AllTeamsGameNumStat>;
  teamRows: AllTeamsTeamRow[];
  heroList: AllTeamsHeroPerf[];
  phase1Top: AllTeamsHeroPerf[];
  phase2Top: AllTeamsHeroPerf[];
  topBans: BanStat[];
  topContested: AllTeamsHeroPerf[];
  topDuos: DuoStat[];
  laneStrengths: LaneMatchupStat[];
}

export function computeTournamentOverview(games: readonly RecordedDraftGame[]) {
  const series = new Set<string>();
  const picks = new Map<string, number>();
  const bans = new Map<string, number>();
  let blueWins = 0;
  let redWins = 0;

  for (const game of games) {
    series.add(getGameSeriesKey(game));
    if (game.winner === "A" || game.winner === "B") {
      if (game.winner === game.blueSideTeam) blueWins += 1;
      else redWins += 1;
    }
    for (const name of new Set([...game.bluePicks, ...game.redPicks])) {
      picks.set(name, (picks.get(name) ?? 0) + 1);
    }
    for (const name of new Set([...game.blueBans, ...game.redBans])) {
      bans.set(name, (bans.get(name) ?? 0) + 1);
    }
  }

  const topHeroes = (counts: ReadonlyMap<string, number>) =>
    [...counts].sort(([a, aCount], [b, bCount]) => bCount - aCount || a.localeCompare(b)).slice(0, 6);

  return {
    total: games.length,
    seriesCount: series.size,
    decided: blueWins + redWins,
    blueWins,
    redWins,
    uniqueHeroCount: picks.size,
    topPicks: topHeroes(picks),
    topBans: topHeroes(bans),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Wilson (1927) 95% confidence interval in percentage points [0, 100]. */
export function wilsonCi95(wins: number, n: number): [number, number] | null {
  if (n <= 0) return null;
  const z = 1.96;
  const p = clamp(wins / n, 0, 1);
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, (center - margin) * 100), Math.min(100, (center + margin) * 100)];
}

/** Complementary error function approximation (Abramowitz & Stegun 7.1.26). */
export function erfcApprox(x: number): number {
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) *
      Math.exp(-ax * ax);
  return x >= 0 ? 1 - y : 1 + y;
}

/** Standard Normal CDF via erfcApprox. */
export function normalCdf(z: number): number {
  return 0.5 * erfcApprox(-z / Math.SQRT2);
}

/** Exact DP series win probability under alternating Blue/Red sides (RoV Bo5/Bo7). */
export function computeSeriesWinProb(pBlue: number, pRed: number, bestOf: 5 | 7, startBlue: boolean): number {
  const target = bestOf === 5 ? 3 : 4;
  const b = clamp(pBlue, 0.05, 0.95);
  const r = clamp(pRed, 0.05, 0.95);
  const memo = new Map<string, number>();

  function solve(w: number, l: number): number {
    if (w >= target) return 1;
    if (l >= target) return 0;
    const key = `${w},${l}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const gameIdx = w + l;
    const isBlue = startBlue ? gameIdx % 2 === 0 : gameIdx % 2 === 1;
    const p = isBlue ? b : r;
    const res = p * solve(w + 1, l) + (1 - p) * solve(w, l + 1);
    memo.set(key, res);
    return res;
  }

  return solve(0, 0);
}

/** Two-proportion Z-test comparing group 1 (w1/n1) vs group 2 (w2/n2). */
export function twoPropZTest(w1: number, n1: number, w2: number, n2: number): TwoPropZTestResult {
  if (n1 <= 0 || n2 <= 0) {
    return {
      diffPct: 0,
      zScore: 0,
      pValue: 1,
      significant95: false,
      probGroup1BetterPct: 50,
      probDominantPct: 50,
    };
  }
  const p1 = w1 / n1;
  const p2 = w2 / n2;
  const diffPct = (p1 - p2) * 100;
  const pooled = (w1 + w2) / (n1 + n2);
  const se = Math.sqrt(Math.max(1e-12, pooled * (1 - pooled) * (1 / n1 + 1 / n2)));
  const zScore = pooled <= 0 || pooled >= 1 ? 0 : (p1 - p2) / se;
  const pValue = Math.min(1, Math.max(0, erfcApprox(Math.abs(zScore) / Math.SQRT2)));
  const probGroup1BetterPct = clamp(normalCdf(zScore) * 100, 0, 100);
  return {
    diffPct,
    zScore,
    pValue,
    significant95: n1 >= 5 && n2 >= 5 && pValue < 0.05,
    probGroup1BetterPct,
    probDominantPct: Math.max(probGroup1BetterPct, 100 - probGroup1BetterPct),
  };
}

/** Bradley-Terry expected synergy win probability from individual win rates pA, pB. */
export function bradleyTerrySynergy(pA: number, pB: number): number {
  const a = clamp(pA, 0.05, 0.95);
  const b = clamp(pB, 0.05, 0.95);
  const num = a * b;
  const den = num + (1 - a) * (1 - b);
  return den > 0 ? num / den : 0.5;
}

/** Bradley-Terry expected matchup win probability when hero A faces enemy B. */
export function bradleyTerryCounter(pA: number, pB: number): number {
  const a = clamp(pA, 0.05, 0.95);
  const b = clamp(pB, 0.05, 0.95);
  const num = a * (1 - b);
  const den = num + (1 - a) * b;
  return den > 0 ? num / den : 0.5;
}

interface RawHeroAcc extends PickCounts {
  hero: string;
  lanes: Partial<Record<LaneKey, PickCounts>>;
}

function emptyPickCounts(): PickCounts {
  return { games: 0, wins: 0, losses: 0, phase1Count: 0, phase2Count: 0, b1Count: 0, r5Count: 0 };
}

function recordPick(counts: PickCounts, index: number, isBlue: boolean, decided: boolean, didWin: boolean) {
  counts.games += 1;
  if (index < 3) counts.phase1Count += 1;
  else counts.phase2Count += 1;
  if (isBlue && index === 0) counts.b1Count += 1;
  if (!isBlue && index === 4) counts.r5Count += 1;
  if (decided) {
    if (didWin) counts.wins += 1;
    else counts.losses += 1;
  }
}

function summarizePicks(counts: PickCounts, teamPrior: number, priorK: number): PickPerformance {
  const decided = counts.wins + counts.losses;
  const bayesianWr = (counts.wins + priorK * teamPrior) / (decided + priorK);
  return {
    ...counts,
    decided,
    bayesianWr,
    deltaVsTeamPct: decided > 0 ? (counts.wins / decided - teamPrior) * 100 : 0,
    bayesianDeltaPct: (bayesianWr - teamPrior) * 100,
  };
}

interface RawDuoAcc {
  a: string;
  b: string;
  games: number;
  wins: number;
  losses: number;
}

interface RawLaneAcc {
  lane: LaneKey;
  allyHero: string;
  enemyHero: string;
  games: number;
  wins: number;
  losses: number;
}

interface ChronologicalDecidedGame {
  sortTime: number | null;
  origIndex: number;
  didWin: boolean;
  label: string;
}

function computePoolDiversity(pickCounts: ReadonlyMap<string, number>, totalPickSlots: number) {
  let shannonH = 0;
  if (totalPickSlots > 0) {
    for (const count of pickCounts.values()) {
      const p = count / totalPickSlots;
      if (p > 0) shannonH -= p * Math.log(p);
    }
  }
  const uniqueHeroCount = pickCounts.size;
  const effectiveHeroPool = uniqueHeroCount > 0 ? Math.exp(shannonH) : 0;
  const poolEvennessPct = uniqueHeroCount > 0 ? clamp((effectiveHeroPool / uniqueHeroCount) * 100, 0, 100) : 0;
  return { uniqueHeroCount, effectiveHeroPool, poolEvennessPct };
}

function summarizeHeroMap(rawHeroes: ReadonlyMap<string, RawHeroAcc>, prior: number, priorK: number): HeroPerf[] {
  return Array.from(rawHeroes.values()).map((h) => {
    const lanes = Object.fromEntries(
      Object.entries(h.lanes).map(([lane, counts]) => [lane, summarizePicks(counts, prior, priorK)]),
    );
    const flexLaneCount = Object.values(h.lanes).filter(({ games }) => games >= 2 || games / h.games >= 0.2).length;
    return {
      ...summarizePicks(h, prior, priorK),
      hero: h.hero,
      lanes,
      flexLaneCount,
    };
  });
}

function computeDuosFromRaw(
  rawDuos: ReadonlyMap<string, RawDuoAcc>,
  wrLookup: ReadonlyMap<string, number>,
  pickGamesLookup: ReadonlyMap<string, number>,
  totalCompositions: number,
  fallbackPrior: number,
  minGames: number,
): DuoStat[] {
  return Array.from(rawDuos.values())
    .filter((d) => d.games >= minGames && d.wins + d.losses > 0)
    .map((d) => {
      const dDecided = d.wins + d.losses;
      const pA = wrLookup.get(d.a) ?? fallbackPrior;
      const pB = wrLookup.get(d.b) ?? fallbackPrior;
      const expectedBtWr = bradleyTerrySynergy(pA, pB);
      const posteriorEbWr = (d.wins + 10 * expectedBtWr) / (dDecided + 10);
      const synergyLiftPct = (posteriorEbWr - expectedBtWr) * 100;
      const zScore = (d.wins - dDecided * expectedBtWr) / Math.sqrt(dDecided * expectedBtWr * (1 - expectedBtWr) + 1);
      const gamesA = pickGamesLookup.get(d.a) ?? d.games;
      const gamesB = pickGamesLookup.get(d.b) ?? d.games;
      const coPickLift = totalCompositions > 0 ? (d.games * totalCompositions) / Math.max(1, gamesA * gamesB) : 1;
      return {
        ...d,
        decided: dDecided,
        expectedBtWr,
        posteriorEbWr,
        synergyLiftPct,
        zScore,
        probSynergyPct: clamp(normalCdf(zScore) * 100, 0, 100),
        coPickLift,
      };
    })
    .sort((a, b) => b.synergyLiftPct - a.synergyLiftPct || b.zScore - a.zScore || b.games - a.games);
}

function computeLaneMatchupsFromRaw(
  rawLaneMatchups: ReadonlyMap<string, RawLaneAcc>,
  allyWrLookup: ReadonlyMap<string, number>,
  enemyWrLookup: ReadonlyMap<string, number>,
  fallbackAllyPrior: number,
  fallbackEnemyPrior: number,
  priorK: number,
): LaneMatchupStat[] {
  return Array.from(rawLaneMatchups.values())
    .filter((m) => m.wins + m.losses >= 2)
    .map((m) => {
      const mDecided = m.wins + m.losses;
      const pA = allyWrLookup.get(m.allyHero) ?? fallbackAllyPrior;
      const pE = enemyWrLookup.get(m.enemyHero) ?? fallbackEnemyPrior;
      const expectedBtWr = bradleyTerryCounter(pA, pE);
      const posteriorWr = (m.wins + priorK * expectedBtWr) / (mDecided + priorK);
      const counterLiftPct = (posteriorWr - expectedBtWr) * 100;
      const zScore = (m.wins - mDecided * expectedBtWr) / Math.sqrt(mDecided * expectedBtWr * (1 - expectedBtWr) + 1);
      return {
        ...m,
        decided: mDecided,
        expectedBtWr,
        posteriorWr,
        counterLiftPct,
        zScore,
        probAdvantagePct: clamp(normalCdf(zScore) * 100, 0, 100),
      };
    });
}

export function recordedGameTime(game: RecordedDraftGame): number | null {
  const timestamp = game.timestamp?.trim().replace(/\s+-\s+/, " ");
  const day = /^(\d{4}-\d{2}-\d{2})(?=$|[T\s])/.exec(timestamp ?? "")?.[1];
  if (timestamp && day) {
    const calendarDate = new Date(`${day}T00:00:00`);
    const parsed = timestamp === day ? calendarDate.getTime() : Date.parse(timestamp.replace(/\s+/, "T"));
    if (localCalendarDate(calendarDate) === day && Number.isFinite(parsed)) return parsed;
  }
  // Older saves store just the time of day. MiniDraft's generated/imported IDs contain the full epoch time.
  const match = /^(?:(\d{13})-g[1-7]|import-(\d{13})(?:-\d+-g[1-7])?)$/.exec(game.id);
  return match ? Number(match[1] ?? match[2]) : null;
}

export function computeScrimAnalytics(
  games: RecordedDraftGame[],
  focusTeam: string,
  opponentFilter: string,
): ScrimAnalyticsSummary {
  const focusLower = focusTeam.trim().toLowerCase();
  const oppLower = opponentFilter === "ALL" ? null : opponentFilter.trim().toLowerCase();

  let total = 0;
  let wins = 0;
  let losses = 0;
  let blueWins = 0;
  let blueDecided = 0;
  let redWins = 0;
  let redDecided = 0;
  let totalAllyPickSlots = 0;
  let aiEvaluatedGames = 0;
  let aiActualWins = 0;
  let aiExpectedWins = 0;

  const seriesSet = new Set<string>();
  const allyPickCounts = new Map<string, number>();
  const rawByGameNum = new Map<number, { total: number; wins: number; decided: number }>();
  const rawAlly = new Map<string, RawHeroAcc>();
  const rawEnemy = new Map<string, { hero: string; games: number; wins: number; losses: number }>();
  const bansAgainstUs = new Map<string, BanStat>();
  const bansByUs = new Map<string, BanStat>();
  const rawDuos = new Map<string, RawDuoAcc>();
  const rawLaneMatchups = new Map<string, RawLaneAcc>();
  const p1PickTotals = new Map<string, number>();
  const enemyP2BanTotals = new Map<string, number>();
  const reactiveBanPairs = new Map<string, { pickedHero: string; bannedHero: string; count: number }>();
  const h2h = new Map<
    string,
    { opponent: string; series: Set<string>; games: number; wins: number; losses: number; enemyCounts: Map<string, number> }
  >();
  const decidedTimeline: ChronologicalDecidedGame[] = [];

  games.forEach((g, origIndex) => {
    const bName = g.blueTeamName?.trim() ?? "";
    const rName = g.redTeamName?.trim() ?? "";
    const isBlue = Boolean(focusLower) && bName.toLowerCase() === focusLower;
    const isRed = Boolean(focusLower) && rName.toLowerCase() === focusLower;
    if ((!isBlue && !isRed) || (isBlue && isRed)) return;

    const oppName = (isBlue ? rName : bName) || "Opponent";
    const oppKey = oppName.toLowerCase();
    const seriesKey = getGameSeriesKey(g);
    const teamId = isBlue ? g.blueSideTeam : g.blueSideTeam === "A" ? "B" : "A";
    const decided = g.winner === "A" || g.winner === "B";
    const didWin = decided && g.winner === teamId;

    // Head-to-head always aggregates all opponents for the selected team (case-insensitive)
    const h2hEntry = h2h.get(oppKey) ?? {
      opponent: oppName,
      series: new Set<string>(),
      games: 0,
      wins: 0,
      losses: 0,
      enemyCounts: new Map<string, number>(),
    };
    h2hEntry.games += 1;
    h2hEntry.series.add(seriesKey);
    if (decided) {
      if (didWin) h2hEntry.wins += 1;
      else h2hEntry.losses += 1;
    }
    for (const eh of isBlue ? g.redPicks : g.bluePicks) {
      h2hEntry.enemyCounts.set(eh, (h2hEntry.enemyCounts.get(eh) ?? 0) + 1);
    }
    h2h.set(oppKey, h2hEntry);

    if (oppLower && oppKey !== oppLower) return;

    total += 1;
    seriesSet.add(seriesKey);
    if (decided) {
      if (didWin) wins += 1;
      else losses += 1;
      if (isBlue) {
        blueDecided += 1;
        if (didWin) blueWins += 1;
      } else {
        redDecided += 1;
        if (didWin) redWins += 1;
      }
      decidedTimeline.push({
        sortTime: recordedGameTime(g),
        origIndex,
        didWin,
        label: `G${g.gameNumber} vs ${oppName}`,
      });

      if (typeof g.blueWinRate === "number" && Number.isFinite(g.blueWinRate) && g.blueWinRate > 0) {
        const blueProb = clamp(g.blueWinRate / 100, 0.01, 0.99);
        if (Math.abs(blueProb - 0.5) > 0.002) {
          const ourProb = isBlue ? blueProb : 1 - blueProb;
          aiEvaluatedGames += 1;
          if (didWin) aiActualWins += 1;
          aiExpectedWins += ourProb;
        }
      }
    }

    const gn = rawByGameNum.get(g.gameNumber) ?? { total: 0, wins: 0, decided: 0 };
    gn.total += 1;
    if (decided) {
      gn.decided += 1;
      if (didWin) gn.wins += 1;
    }
    rawByGameNum.set(g.gameNumber, gn);

    const ourPicks = isBlue ? g.bluePicks : g.redPicks;
    const theirPicks = isBlue ? g.redPicks : g.bluePicks;
    const ourBans = isBlue ? g.blueBans : g.redBans;
    const theirBans = isBlue ? g.redBans : g.blueBans;

    const p1PickedThisGame: string[] = [];
    ourPicks.forEach((hero, idx) => {
      totalAllyPickSlots += 1;
      allyPickCounts.set(hero, (allyPickCounts.get(hero) ?? 0) + 1);

      const cur: RawHeroAcc = rawAlly.get(hero) ?? { hero, ...emptyPickCounts(), lanes: {} };
      recordPick(cur, idx, isBlue, decided, didWin);
      if (idx < 3) p1PickedThisGame.push(hero);
      const lane = g.pickLanes?.[hero];
      if (lane) recordPick(cur.lanes[lane] ??= emptyPickCounts(), idx, isBlue, decided, didWin);
      rawAlly.set(hero, cur);
    });

    for (const h of p1PickedThisGame) {
      p1PickTotals.set(h, (p1PickTotals.get(h) ?? 0) + 1);
    }

    for (let i = 0; i < ourPicks.length; i++) {
      for (let j = i + 1; j < ourPicks.length; j++) {
        const [a, b] = ourPicks[i] < ourPicks[j] ? [ourPicks[i], ourPicks[j]] : [ourPicks[j], ourPicks[i]];
        const key = `${a}::${b}`;
        const d = rawDuos.get(key) ?? { a, b, games: 0, wins: 0, losses: 0 };
        d.games += 1;
        if (decided) {
          if (didWin) d.wins += 1;
          else d.losses += 1;
        }
        rawDuos.set(key, d);
      }
    }

    theirPicks.forEach((hero) => {
      const cur = rawEnemy.get(hero) ?? { hero, games: 0, wins: 0, losses: 0 };
      cur.games += 1;
      if (decided) {
        if (didWin) cur.wins += 1;
        else cur.losses += 1;
      }
      rawEnemy.set(hero, cur);
    });

    // Direct same-lane hero matchups when pickLanes is available
    if (g.pickLanes) {
      const enemyByLane = new Map<LaneKey, string[]>();
      for (const eh of theirPicks) {
        const lane = g.pickLanes[eh];
        if (!lane) continue;
        const arr = enemyByLane.get(lane) ?? [];
        arr.push(eh);
        enemyByLane.set(lane, arr);
      }
      for (const ah of ourPicks) {
        const lane = g.pickLanes[ah];
        if (!lane) continue;
        const laneEnemies = enemyByLane.get(lane);
        if (!laneEnemies) continue;
        for (const eh of laneEnemies) {
          const key = `${lane}::${ah}::${eh}`;
          const m = rawLaneMatchups.get(key) ?? {
            lane,
            allyHero: ah,
            enemyHero: eh,
            games: 0,
            wins: 0,
            losses: 0,
          };
          m.games += 1;
          if (decided) {
            if (didWin) m.wins += 1;
            else m.losses += 1;
          }
          rawLaneMatchups.set(key, m);
        }
      }
    }

    const enemyP2BansThisGame: string[] = [];
    theirBans.forEach((hero, idx) => {
      const cur = bansAgainstUs.get(hero) ?? { hero, total: 0, p1: 0, p2: 0 };
      cur.total += 1;
      if (idx < 2) cur.p1 += 1;
      else {
        cur.p2 += 1;
        enemyP2BansThisGame.push(hero);
      }
      bansAgainstUs.set(hero, cur);
    });

    for (const bannedHero of enemyP2BansThisGame) {
      enemyP2BanTotals.set(bannedHero, (enemyP2BanTotals.get(bannedHero) ?? 0) + 1);
      for (const pickedHero of p1PickedThisGame) {
        if (pickedHero === bannedHero) continue;
        const key = `${pickedHero}::${bannedHero}`;
        const entry = reactiveBanPairs.get(key) ?? { pickedHero, bannedHero, count: 0 };
        entry.count += 1;
        reactiveBanPairs.set(key, entry);
      }
    }

    ourBans.forEach((hero, idx) => {
      const cur = bansByUs.get(hero) ?? { hero, total: 0, p1: 0, p2: 0 };
      cur.total += 1;
      if (idx < 2) cur.p1 += 1;
      else cur.p2 += 1;
      bansByUs.set(hero, cur);
    });
  });

  const decided = wins + losses;
  const teamPrior = decided > 0 ? clamp(wins / decided, 0.15, 0.85) : 0.5;
  const priorK = 8;

  // Ally hero stats with Empirical Bayes shrinkage toward team prior
  const allyList: HeroPerf[] = summarizeHeroMap(rawAlly, teamPrior, priorK);

  const allyWrLookup = new Map<string, number>();
  const allyGamesLookup = new Map<string, number>();
  for (const h of allyList) {
    allyWrLookup.set(h.hero, h.bayesianWr);
    allyGamesLookup.set(h.hero, h.games);
  }

  const { uniqueHeroCount, effectiveHeroPool, poolEvennessPct } = computePoolDiversity(allyPickCounts, totalAllyPickSlots);

  // Game 1-7 Wilson CI + Early (G1-3) vs Late (G4-7) Z-Test + Weighted Fatigue Slope
  const byGameNum = new Map<number, GameNumStat>();
  let g13Wins = 0;
  let g13Decided = 0;
  let g47Wins = 0;
  let g47Decided = 0;
  let sumW = 0;
  let sumWx = 0;
  let sumWy = 0;
  let sumWxx = 0;
  let sumWxy = 0;

  for (let gNum = 1; gNum <= 7; gNum++) {
    const r = rawByGameNum.get(gNum);
    if (!r) continue;
    byGameNum.set(gNum, {
      ...r,
      ci: wilsonCi95(r.wins, r.decided),
    });
    if (gNum <= 3) {
      g13Wins += r.wins;
      g13Decided += r.decided;
    } else {
      g47Wins += r.wins;
      g47Decided += r.decided;
    }
    if (r.decided > 0) {
      const w = r.decided;
      const y = (r.wins / r.decided) * 100;
      sumW += w;
      sumWx += w * gNum;
      sumWy += w * y;
      sumWxx += w * gNum * gNum;
      sumWxy += w * gNum * y;
    }
  }
  const earlyVsLateTest = twoPropZTest(g13Wins, g13Decided, g47Wins, g47Decided);
  const slopeDenom = sumW * sumWxx - sumWx * sumWx;
  const fatigueSlopePctPerGame =
    byGameNum.size >= 3 && sumW >= 6 && Math.abs(slopeDenom) > 1e-9
      ? (sumW * sumWxy - sumWx * sumWy) / slopeDenom
      : null;

  // EWMA Momentum (oldest -> newest)
  const hasAllTimes = decidedTimeline.length > 0 && decidedTimeline.every((d) => d.sortTime !== null);
  const chronological = [...decidedTimeline].sort((a, b) => {
    if (hasAllTimes && a.sortTime !== null && b.sortTime !== null && a.sortTime !== b.sortTime) {
      return a.sortTime - b.sortTime;
    }
    // seriesGames is stored newest-first by default when timestamps aren't full dates
    return b.origIndex - a.origIndex;
  });

  const alpha = 0.15;
  let ewma = teamPrior;
  const fullEwma: EwmaPoint[] = chronological.map((item, idx) => {
    ewma = alpha * (item.didWin ? 1 : 0) + (1 - alpha) * ewma;
    return {
      idx: idx + 1,
      label: item.label,
      ewmaPct: ewma * 100,
      win: item.didWin,
    };
  });
  const ewmaSeries = fullEwma.slice(-30);
  const ewmaCurrentPct = ewmaSeries.length > 0 ? ewmaSeries[ewmaSeries.length - 1].ewmaPct : null;
  const ewmaDeltaPct =
    ewmaCurrentPct !== null && decided > 0 ? ewmaCurrentPct - (wins / decided) * 100 : null;

  // Bradley-Terry + Empirical Bayes Duos
  const minDuoGames = total >= 20 ? 3 : 2;
  const topDuos = computeDuosFromRaw(rawDuos, allyWrLookup, allyGamesLookup, total, teamPrior, minDuoGames);

  // Enemy Threats (Bayesian Delta vs Team Prior)
  const minEnemyGames = total >= 20 ? 3 : 2;
  const enemyWrLookup = new Map<string, number>();
  for (const e of rawEnemy.values()) {
    const eDecided = e.wins + e.losses;
    // e.wins = our wins when enemy picked this hero; enemyWinWr = 1 - ourWr
    const enemyWins = e.losses;
    const enemyBayWr = (enemyWins + priorK * (1 - teamPrior)) / (eDecided + priorK);
    enemyWrLookup.set(e.hero, enemyBayWr);
  }

  const enemyMatchups: EnemyThreatStat[] = Array.from(rawEnemy.values())
    .filter((e) => e.wins + e.losses >= minEnemyGames)
    .map((e) => {
      const eDecided = e.wins + e.losses;
      const posteriorOurWr = (e.wins + priorK * teamPrior) / (eDecided + priorK);
      const threatDeltaPct = (posteriorOurWr - teamPrior) * 100;
      const zScore = (e.wins - eDecided * teamPrior) / Math.sqrt(eDecided * teamPrior * (1 - teamPrior) + 1);
      return {
        hero: e.hero,
        games: e.games,
        ourWins: e.wins,
        ourLosses: e.losses,
        decided: eDecided,
        posteriorOurWr,
        threatDeltaPct,
        zScore,
        probThreatPct: clamp(normalCdf(-zScore) * 100, 0, 100),
      };
    });

  const toughestEnemies = enemyMatchups
    .filter((e) => e.threatDeltaPct < 0)
    .sort((a, b) => a.threatDeltaPct - b.threatDeltaPct || a.zScore - b.zScore || b.games - a.games);

  const favorableEnemies = enemyMatchups
    .filter((e) => e.threatDeltaPct > 0)
    .sort((a, b) => b.threatDeltaPct - a.threatDeltaPct || b.zScore - a.zScore || b.games - a.games);

  // Direct Same-Lane Counter Matchups (Bradley-Terry)
  const laneMatchups = computeLaneMatchupsFromRaw(
    rawLaneMatchups,
    allyWrLookup,
    enemyWrLookup,
    teamPrior,
    1 - teamPrior,
    priorK,
  );

  const laneStrengths = laneMatchups
    .filter((m) => m.counterLiftPct > 0.5)
    .sort((a, b) => b.counterLiftPct - a.counterLiftPct || b.zScore - a.zScore);

  const laneWeaknesses = laneMatchups
    .filter((m) => m.counterLiftPct < -0.5)
    .sort((a, b) => a.counterLiftPct - b.counterLiftPct || a.zScore - b.zScore);

  // Protective / Reactive Phase 2 Bans (Opponent bans B in Phase 2 after we pick A in Phase 1)
  const protectiveBans: ProtectiveBanStat[] = Array.from(reactiveBanPairs.values())
    .filter((p) => p.count >= 2)
    .map((p) => {
      const p1A = p1PickTotals.get(p.pickedHero) ?? p.count;
      const p2B = enemyP2BanTotals.get(p.bannedHero) ?? p.count;
      const banLift = total > 0 ? (p.count * total) / Math.max(1, p1A * p2B) : 1;
      return {
        pickedHero: p.pickedHero,
        bannedHero: p.bannedHero,
        coCount: p.count,
        banLift,
      };
    })
    .filter((p) => p.banLift >= 1.05)
    .sort((a, b) => b.coCount - a.coCount || b.banLift - a.banLift);

  // Opponent Head-to-Head with Wilson CI + Two-Prop Test vs Rest of Schedule
  let allH2hWins = 0;
  let allH2hDecided = 0;
  for (const val of h2h.values()) {
    allH2hWins += val.wins;
    allH2hDecided += val.wins + val.losses;
  }

  const opponentRows: OpponentRow[] = Array.from(h2h.values())
    .map((val) => {
      const oppDecided = val.wins + val.losses;
      return {
        opponent: val.opponent,
        games: val.games,
        seriesCount: val.series.size,
        wins: val.wins,
        losses: val.losses,
        ci: wilsonCi95(val.wins, oppDecided),
        vsTeamTest: twoPropZTest(val.wins, oppDecided, allH2hWins - val.wins, allH2hDecided - oppDecided),
        topEnemies: Array.from(val.enemyCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2),
      };
    })
    .sort((a, b) => b.games - a.games);

  // Exact Bo5 / Bo7 Series Win Probability under alternating Blue/Red sides
  const sideK = 6;
  const bayesianBlueWr = (blueWins + sideK * teamPrior) / (blueDecided + sideK);
  const bayesianRedWr = (redWins + sideK * teamPrior) / (redDecided + sideK);
  const seriesWinProb: SeriesWinProbSummary | null =
    decided >= 3
      ? (() => {
          const bo5StartBluePct = computeSeriesWinProb(bayesianBlueWr, bayesianRedWr, 5, true) * 100;
          const bo5StartRedPct = computeSeriesWinProb(bayesianBlueWr, bayesianRedWr, 5, false) * 100;
          const bo7StartBluePct = computeSeriesWinProb(bayesianBlueWr, bayesianRedWr, 7, true) * 100;
          const bo7StartRedPct = computeSeriesWinProb(bayesianBlueWr, bayesianRedWr, 7, false) * 100;
          return {
            bo5Pct: (bo5StartBluePct + bo5StartRedPct) / 2,
            bo7Pct: (bo7StartBluePct + bo7StartRedPct) / 2,
            bo5StartBluePct,
            bo5StartRedPct,
          };
        })()
      : null;

  // Draft Edge vs Execution (AI blueWinRate vs actual results)
  const draftEdge: DraftEdgeSummary | null =
    aiEvaluatedGames > 0
      ? {
          evaluatedGames: aiEvaluatedGames,
          actualWins: aiActualWins,
          expectedWins: aiExpectedWins,
          winsAboveExpected: aiActualWins - aiExpectedWins,
          avgDraftEdgePct: (aiExpectedWins / aiEvaluatedGames - 0.5) * 100,
        }
      : null;

  return {
    total,
    seriesCount: seriesSet.size,
    wins,
    losses,
    decided,
    teamPrior,
    overallCi: wilsonCi95(wins, decided),
    blueWins,
    blueDecided,
    blueCi: wilsonCi95(blueWins, blueDecided),
    redWins,
    redDecided,
    redCi: wilsonCi95(redWins, redDecided),
    sideTest: twoPropZTest(blueWins, blueDecided, redWins, redDecided),
    uniqueHeroCount,
    effectiveHeroPool,
    poolEvennessPct,
    byGameNum,
    earlyVsLateTest,
    fatigueSlopePctPerGame,
    ewmaSeries,
    ewmaCurrentPct,
    ewmaDeltaPct,
    seriesWinProb,
    draftEdge,
    allyList,
    phase1Top: [...allyList]
      .filter((h) => h.phase1Count > 0)
      .sort((a, b) => b.phase1Count - a.phase1Count || b.bayesianWr - a.bayesianWr),
    phase2Top: [...allyList]
      .filter((h) => h.phase2Count > 0)
      .sort((a, b) => b.phase2Count - a.phase2Count || b.bayesianWr - a.bayesianWr),
    bansAgainstUs: Array.from(bansAgainstUs.values()).sort((a, b) => b.total - a.total),
    bansByUs: Array.from(bansByUs.values()).sort((a, b) => b.total - a.total),
    protectiveBans,
    topDuos,
    toughestEnemies,
    favorableEnemies,
    laneStrengths,
    laneWeaknesses,
    opponentRows,
  };
}

export function computeAllTeamsAnalytics(games: readonly RecordedDraftGame[]): AllTeamsAnalyticsSummary {
  let blueWins = 0;
  let redWins = 0;
  let totalPickSlots = 0;

  const seriesSet = new Set<string>();
  const pickCounts = new Map<string, number>();
  const contestCounts = new Map<string, number>();
  const byGameNum = new Map<number, AllTeamsGameNumStat>();
  const rawHeroes = new Map<string, RawHeroAcc>();
  const rawBans = new Map<string, BanStat>();
  const rawDuos = new Map<string, RawDuoAcc>();
  const rawLaneMatchups = new Map<string, RawLaneAcc>();
  const rawTeams = new Map<
    string,
    {
      team: string;
      series: Set<string>;
      games: number;
      wins: number;
      losses: number;
      blueWins: number;
      blueDecided: number;
      redWins: number;
      redDecided: number;
    }
  >();

  for (const g of games) {
    const seriesKey = getGameSeriesKey(g);
    seriesSet.add(seriesKey);
    const decided = g.winner === "A" || g.winner === "B";
    const blueWon = decided && g.winner === g.blueSideTeam;
    if (decided) {
      if (blueWon) blueWins += 1;
      else redWins += 1;
    }

    const gn = byGameNum.get(g.gameNumber) ?? { total: 0, decided: 0, blueWins: 0, redWins: 0 };
    gn.total += 1;
    if (decided) {
      gn.decided += 1;
      if (blueWon) gn.blueWins += 1;
      else gn.redWins += 1;
    }
    byGameNum.set(g.gameNumber, gn);

    const recordSideTeam = (rawName: string | undefined, isBlueSide: boolean) => {
      const name = rawName?.trim();
      if (!name) return;
      const key = name.toLowerCase();
      const entry = rawTeams.get(key) ?? {
        team: name,
        series: new Set<string>(),
        games: 0,
        wins: 0,
        losses: 0,
        blueWins: 0,
        blueDecided: 0,
        redWins: 0,
        redDecided: 0,
      };
      entry.games += 1;
      entry.series.add(seriesKey);
      if (decided) {
        const won = isBlueSide ? blueWon : !blueWon;
        if (won) entry.wins += 1;
        else entry.losses += 1;
        if (isBlueSide) {
          entry.blueDecided += 1;
          if (won) entry.blueWins += 1;
        } else {
          entry.redDecided += 1;
          if (won) entry.redWins += 1;
        }
      }
      rawTeams.set(key, entry);
    };

    recordSideTeam(g.blueTeamName, true);
    recordSideTeam(g.redTeamName, false);

    const recordSideDraft = (picks: readonly string[], bans: readonly string[], isBlueSide: boolean) => {
      const sideWon = isBlueSide ? blueWon : !blueWon;
      picks.forEach((hero, idx) => {
        totalPickSlots += 1;
        pickCounts.set(hero, (pickCounts.get(hero) ?? 0) + 1);
        const cur: RawHeroAcc = rawHeroes.get(hero) ?? { hero, ...emptyPickCounts(), lanes: {} };
        recordPick(cur, idx, isBlueSide, decided, sideWon);
        const lane = g.pickLanes?.[hero];
        if (lane) recordPick(cur.lanes[lane] ??= emptyPickCounts(), idx, isBlueSide, decided, sideWon);
        rawHeroes.set(hero, cur);
      });

      for (let i = 0; i < picks.length; i++) {
        for (let j = i + 1; j < picks.length; j++) {
          const [a, b] = picks[i] < picks[j] ? [picks[i], picks[j]] : [picks[j], picks[i]];
          const key = `${a}::${b}`;
          const d = rawDuos.get(key) ?? { a, b, games: 0, wins: 0, losses: 0 };
          d.games += 1;
          if (decided) {
            if (sideWon) d.wins += 1;
            else d.losses += 1;
          }
          rawDuos.set(key, d);
        }
      }

      bans.forEach((hero, idx) => {
        const cur = rawBans.get(hero) ?? { hero, total: 0, p1: 0, p2: 0 };
        cur.total += 1;
        if (idx < 2) cur.p1 += 1;
        else cur.p2 += 1;
        rawBans.set(hero, cur);
      });
    };

    recordSideDraft(g.bluePicks, g.blueBans, true);
    recordSideDraft(g.redPicks, g.redBans, false);

    for (const hero of new Set([...g.bluePicks, ...g.redPicks, ...g.blueBans, ...g.redBans])) {
      contestCounts.set(hero, (contestCounts.get(hero) ?? 0) + 1);
    }

    if (g.pickLanes) {
      const recordMatchups = (ourPicks: readonly string[], theirPicks: readonly string[], ourWin: boolean) => {
        const enemyByLane = new Map<LaneKey, string[]>();
        for (const eh of theirPicks) {
          const lane = g.pickLanes?.[eh];
          if (!lane) continue;
          const arr = enemyByLane.get(lane) ?? [];
          arr.push(eh);
          enemyByLane.set(lane, arr);
        }
        for (const ah of ourPicks) {
          const lane = g.pickLanes?.[ah];
          if (!lane) continue;
          for (const eh of enemyByLane.get(lane) ?? []) {
            const key = `${lane}::${ah}::${eh}`;
            const m = rawLaneMatchups.get(key) ?? {
              lane,
              allyHero: ah,
              enemyHero: eh,
              games: 0,
              wins: 0,
              losses: 0,
            };
            m.games += 1;
            if (decided) {
              if (ourWin) m.wins += 1;
              else m.losses += 1;
            }
            rawLaneMatchups.set(key, m);
          }
        }
      };
      recordMatchups(g.bluePicks, g.redPicks, blueWon);
      recordMatchups(g.redPicks, g.bluePicks, !blueWon);
    }
  }

  const total = games.length;
  const decided = blueWins + redWins;
  const prior = 0.5;
  const priorK = 8;

  const baseHeroList = summarizeHeroMap(rawHeroes, prior, priorK);
  const heroListMap = new Map<string, HeroPerf>(baseHeroList.map((h) => [h.hero, h]));
  const allHeroNames = new Set([...heroListMap.keys(), ...rawBans.keys()]);
  const heroList: AllTeamsHeroPerf[] = Array.from(allHeroNames).map((hero) => {
    const perf = heroListMap.get(hero) ?? {
      ...summarizePicks(emptyPickCounts(), prior, priorK),
      hero,
      lanes: {},
      flexLaneCount: 0,
    };
    const ban = rawBans.get(hero);
    const contestCount = contestCounts.get(hero) ?? 0;
    return {
      ...perf,
      bans: ban?.total ?? 0,
      banP1: ban?.p1 ?? 0,
      banP2: ban?.p2 ?? 0,
      contestCount,
      contestPct: total > 0 ? (contestCount / total) * 100 : 0,
    };
  });

  const heroWrLookup = new Map<string, number>();
  const heroGamesLookup = new Map<string, number>();
  for (const h of heroList) {
    heroWrLookup.set(h.hero, h.bayesianWr);
    heroGamesLookup.set(h.hero, h.games);
  }

  const { uniqueHeroCount, effectiveHeroPool, poolEvennessPct } = computePoolDiversity(pickCounts, totalPickSlots);

  const teamRows: AllTeamsTeamRow[] = Array.from(rawTeams.values())
    .map((t) => {
      const tDecided = t.wins + t.losses;
      return {
        team: t.team,
        games: t.games,
        seriesCount: t.series.size,
        wins: t.wins,
        losses: t.losses,
        decided: tDecided,
        blueWins: t.blueWins,
        blueDecided: t.blueDecided,
        redWins: t.redWins,
        redDecided: t.redDecided,
        ci: wilsonCi95(t.wins, tDecided),
      };
    })
    .sort((a, b) => {
      const aw = a.decided > 0 ? a.wins / a.decided : -1;
      const bw = b.decided > 0 ? b.wins / b.decided : -1;
      return bw - aw || b.wins - a.wins || b.games - a.games || a.team.localeCompare(b.team);
    });

  const minDuoGames = total >= 20 ? 3 : 2;
  const topDuos = computeDuosFromRaw(rawDuos, heroWrLookup, heroGamesLookup, total * 2, prior, minDuoGames);
  const laneStrengths = computeLaneMatchupsFromRaw(rawLaneMatchups, heroWrLookup, heroWrLookup, prior, prior, priorK)
    .filter((m) => m.counterLiftPct > 0.5 && m.wins > m.losses)
    .sort((a, b) => b.counterLiftPct - a.counterLiftPct || b.zScore - a.zScore);

  const zScore = decided > 0 ? (blueWins - 0.5 * decided) / Math.sqrt(0.25 * decided) : 0;
  const pValue = decided > 0 ? Math.min(1, Math.max(0, erfcApprox(Math.abs(zScore) / Math.SQRT2))) : 1;
  const probBlueBetterPct = clamp(normalCdf(zScore) * 100, 0, 100);
  const sideTest: TwoPropZTestResult = {
    diffPct: decided > 0 ? ((blueWins - redWins) / decided) * 100 : 0,
    zScore,
    pValue,
    significant95: decided >= 10 && pValue < 0.05,
    probGroup1BetterPct: probBlueBetterPct,
    probDominantPct: Math.max(probBlueBetterPct, 100 - probBlueBetterPct),
  };

  return {
    total,
    seriesCount: seriesSet.size,
    decided,
    blueWins,
    redWins,
    blueCi: wilsonCi95(blueWins, decided),
    redCi: wilsonCi95(redWins, decided),
    sideTest,
    uniqueHeroCount,
    effectiveHeroPool,
    poolEvennessPct,
    byGameNum,
    teamRows,
    heroList,
    phase1Top: [...heroList]
      .filter((h) => h.phase1Count > 0)
      .sort((a, b) => b.phase1Count - a.phase1Count || b.bayesianWr - a.bayesianWr),
    phase2Top: [...heroList]
      .filter((h) => h.phase2Count > 0)
      .sort((a, b) => b.phase2Count - a.phase2Count || b.bayesianWr - a.bayesianWr),
    topBans: Array.from(rawBans.values()).sort((a, b) => b.total - a.total),
    topContested: [...heroList]
      .filter((h) => h.contestCount > 0)
      .sort((a, b) => b.contestCount - a.contestCount || b.games - a.games),
    topDuos,
    laneStrengths,
  };
}

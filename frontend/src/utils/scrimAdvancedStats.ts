import type { Hero, LaneKey, RecordedDraftGame, TournamentRef } from "../types/draft";
import { displayName } from "./heroNames";
import { getGameSeriesKey, LANE_SHORT, laneKey } from "./draft";
import { recordedGameTime, type AllTeamsAnalyticsSummary, type ScrimAnalyticsSummary } from "./scrimStats";

const CANONICAL_LANES: readonly LaneKey[] = ["DS_Lane", "Jungle", "Mid", "Dragon_Lane", "Roam"];
const VALID_LANE_SET: ReadonlySet<string> = new Set(CANONICAL_LANES);

export type SqueezeRiskLevel = "high" | "medium" | "low" | "insufficient";

export interface LaneTopHero {
  hero: string;
  games: number;
  wins: number;
  losses: number;
  decided: number;
}

export interface PositionalPoolStat {
  lane: LaneKey;
  totalPicks: number;
  uniqueHeroes: number;
  effectivePool: number;
  evennessPct: number;
  topHeroSharePct: number;
  squeezeRisk: SqueezeRiskLevel;
  topHeroes: LaneTopHero[];
}

export type BlindCounterClass = "blind_safe" | "counter_specialist" | "blind_risk" | "balanced";

export interface HeroBlindCounterStat {
  hero: string;
  games: number;
  wins: number;
  losses: number;
  decided: number;
  p1Games: number;
  p1Wins: number;
  p1Decided: number;
  p1WrPct: number | null;
  p2Games: number;
  p2Wins: number;
  p2Decided: number;
  p2WrPct: number | null;
  wrDiffP2MinusP1Pct: number | null;
  classification: BlindCounterClass;
}

export type DraftPickSlotKey = "B1" | "R1-2" | "B2-3" | "R3" | "R4" | "B4-5" | "R5";

export interface DraftSlotStat {
  slot: DraftPickSlotKey;
  side: "blue" | "red";
  phase: 1 | 2;
  games: number;
  wins: number;
  losses: number;
  decided: number;
  wrPct: number | null;
  topHeroes: { hero: string; count: number; wins: number; decided: number }[];
}

export interface FlexLaneBreakdown {
  lane: LaneKey;
  games: number;
  wins: number;
  losses: number;
  decided: number;
  wrPct: number | null;
}

export interface FlexHeroStat {
  hero: string;
  games: number;
  wins: number;
  losses: number;
  decided: number;
  wrPct: number | null;
  laneBreakdown: FlexLaneBreakdown[];
}

export interface FlexSummary {
  flexHeroes: FlexHeroStat[];
  withFlexGames: number;
  withFlexWins: number;
  withFlexDecided: number;
  withoutFlexGames: number;
  withoutFlexWins: number;
  withoutFlexDecided: number;
}

export interface TrioStat {
  heroes: [string, string, string];
  games: number;
  wins: number;
  losses: number;
  decided: number;
  bayesianWr: number;
  deltaVsTeamPct: number;
}

export interface TrioSynergySummary {
  coreAxisTrios: TrioStat[];
  allTrios: TrioStat[];
}

export type CompArchetypeKey =
  | "frontline_teamfight"
  | "dive_pick"
  | "double_carry_poke"
  | "protect_utility"
  | "balanced";

export interface CompArchetypeStat {
  key: CompArchetypeKey;
  games: number;
  wins: number;
  losses: number;
  decided: number;
  sharePct: number;
  wrPct: number | null;
}

export interface CompArchetypeMatchup {
  ourArchetype: CompArchetypeKey;
  enemyArchetype: CompArchetypeKey;
  games: number;
  wins: number;
  losses: number;
  decided: number;
  wrPct: number | null;
}

export interface OpeningPairStat {
  a: string;
  b: string;
  games: number;
  wins: number;
  losses: number;
  decided: number;
  wrPct: number | null;
}

export interface CompArchetypeSummary {
  archetypeStats: CompArchetypeStat[];
  archetypeMatchups: CompArchetypeMatchup[];
  openingDiversityPct: number;
  openingEntropyLabel: "unpredictable" | "moderate" | "predictable" | "insufficient";
  uniqueOpeningCount: number;
  topOpenings: OpeningPairStat[];
}

export interface ScrimAdvancedStats {
  totalPerspectives: number;
  positionalPools: PositionalPoolStat[];
  blindCounterHeroes: HeroBlindCounterStat[];
  draftSlots: DraftSlotStat[];
  flexSummary: FlexSummary;
  trioSummary: TrioSynergySummary;
  compSummary: CompArchetypeSummary;
}

export type PeriodDiffMode = "split_half" | "last7_vs_prev" | "tournaments";

export interface PeriodSummaryMetrics {
  label: string;
  games: number;
  decided: number;
  wins: number;
  wrPct: number | null;
  blueWins: number;
  blueDecided: number;
  blueWrPct: number | null;
  redWins: number;
  redDecided: number;
  redWrPct: number | null;
}

export interface PeriodHeroDelta {
  hero: string;
  gamesA: number;
  gamesB: number;
  bansA: number;
  bansB: number;
  pickRateAPct: number;
  pickRateBPct: number;
  contestRateAPct: number;
  contestRateBPct: number;
  deltaPct: number;
  wrAPct: number | null;
  wrBPct: number | null;
  wrDeltaPct: number | null;
}

export interface PeriodDiffSummary {
  periodA: PeriodSummaryMetrics;
  periodB: PeriodSummaryMetrics;
  wrShiftPct: number | null;
  risingHeroes: PeriodHeroDelta[];
  fallingHeroes: PeriodHeroDelta[];
}

interface PerspectiveRecord {
  game: RecordedDraftGame;
  isBlue: boolean;
  decided: boolean;
  didWin: boolean;
  ourPicks: readonly string[];
  theirPicks: readonly string[];
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function resolveHeroLane(
  hero: string,
  pickLanes: Record<string, LaneKey> | undefined,
  heroMap: Map<string, Hero>,
): LaneKey | null {
  const explicit = pickLanes?.[hero];
  if (explicit && VALID_LANE_SET.has(explicit)) return explicit;
  const meta = heroMap.get(hero);
  const raw = laneKey(meta?.main_pro_lane ?? meta?.lane);
  return VALID_LANE_SET.has(raw) ? (raw as LaneKey) : null;
}

function extractPerspectives(
  games: readonly RecordedDraftGame[],
  focusTeam: string,
  opponentFilter: string,
): PerspectiveRecord[] {
  const focusLower = focusTeam.trim().toLowerCase();
  const oppLower = opponentFilter === "ALL" ? null : opponentFilter.trim().toLowerCase();
  const out: PerspectiveRecord[] = [];

  for (const game of games) {
    const decided = game.winner === "A" || game.winner === "B";
    const blueWon = decided && game.winner === game.blueSideTeam;

    if (!focusLower) {
      out.push({
        game,
        isBlue: true,
        decided,
        didWin: blueWon,
        ourPicks: game.bluePicks,
        theirPicks: game.redPicks,
      });
      out.push({
        game,
        isBlue: false,
        decided,
        didWin: decided && !blueWon,
        ourPicks: game.redPicks,
        theirPicks: game.bluePicks,
      });
      continue;
    }

    const bName = game.blueTeamName?.trim() ?? "";
    const rName = game.redTeamName?.trim() ?? "";
    const isBlue = bName.toLowerCase() === focusLower;
    const isRed = rName.toLowerCase() === focusLower;
    if (isBlue === isRed) continue;

    const oppKey = (isBlue ? rName : bName).toLowerCase();
    if (oppLower && oppKey !== oppLower) continue;

    const teamId = isBlue ? game.blueSideTeam : game.blueSideTeam === "A" ? "B" : "A";
    const didWin = decided && game.winner === teamId;
    out.push({
      game,
      isBlue,
      decided,
      didWin,
      ourPicks: isBlue ? game.bluePicks : game.redPicks,
      theirPicks: isBlue ? game.redPicks : game.bluePicks,
    });
  }

  return out;
}

export function classifyCompArchetype(picks: readonly string[], heroMap: Map<string, Hero>): CompArchetypeKey {
  const counts = { Tank: 0, Fighter: 0, Assassin: 0, Mage: 0, Carry: 0, Support: 0 };
  for (const name of picks) {
    const role = heroMap.get(name)?.role;
    if (role && role in counts) {
      counts[role] += 1;
    }
  }
  if (counts.Assassin >= 2 || (counts.Assassin >= 1 && counts.Fighter >= 2 && counts.Tank === 0)) {
    return "dive_pick";
  }
  if (counts.Support >= 2 || (counts.Support >= 1 && counts.Tank >= 2)) {
    return "protect_utility";
  }
  if (counts.Carry >= 2 || (counts.Mage >= 2 && counts.Tank === 0)) {
    return "double_carry_poke";
  }
  if (counts.Tank + counts.Fighter >= 2 && counts.Carry >= 1 && counts.Mage >= 1) {
    return "frontline_teamfight";
  }
  return "balanced";
}

function slotForPick(isBlue: boolean, idx: number): DraftPickSlotKey {
  if (isBlue) {
    if (idx === 0) return "B1";
    if (idx <= 2) return "B2-3";
    return "B4-5";
  }
  if (idx <= 1) return "R1-2";
  if (idx === 2) return "R3";
  if (idx === 3) return "R4";
  return "R5";
}

export function computeScrimAdvancedStats(
  games: readonly RecordedDraftGame[],
  heroMap: Map<string, Hero>,
  focusTeam: string,
  opponentFilter: string,
): ScrimAdvancedStats {
  const perspectives = extractPerspectives(games, focusTeam, opponentFilter);
  const totalPerspectives = perspectives.length;

  let totalWins = 0;
  let totalDecided = 0;
  for (const p of perspectives) {
    if (p.decided) {
      totalDecided += 1;
      if (p.didWin) totalWins += 1;
    }
  }
  const teamPrior = totalDecided > 0 ? clamp(totalWins / totalDecided, 0.15, 0.85) : 0.5;

  // 1. Positional Pool Depth + Lane counts per hero (for Flex)
  const laneHeroMap = new Map<LaneKey, Map<string, LaneTopHero>>();
  for (const lane of CANONICAL_LANES) {
    laneHeroMap.set(lane, new Map());
  }
  const heroLaneBreakdown = new Map<
    string,
    {
      games: number;
      wins: number;
      losses: number;
      lanes: Partial<Record<LaneKey, { games: number; wins: number; losses: number }>>;
    }
  >();

  // 2. Blind vs Counter & Draft Slots
  const heroBlindMap = new Map<
    string,
    {
      hero: string;
      games: number;
      wins: number;
      losses: number;
      p1Games: number;
      p1Wins: number;
      p1Decided: number;
      p2Games: number;
      p2Wins: number;
      p2Decided: number;
    }
  >();

  const slotDefs: readonly { slot: DraftPickSlotKey; side: "blue" | "red"; phase: 1 | 2 }[] = [
    { slot: "B1", side: "blue", phase: 1 },
    { slot: "R1-2", side: "red", phase: 1 },
    { slot: "B2-3", side: "blue", phase: 1 },
    { slot: "R3", side: "red", phase: 1 },
    { slot: "R4", side: "red", phase: 2 },
    { slot: "B4-5", side: "blue", phase: 2 },
    { slot: "R5", side: "red", phase: 2 },
  ];
  const slotAccMap = new Map<
    DraftPickSlotKey,
    {
      games: number;
      wins: number;
      losses: number;
      heroes: Map<string, { hero: string; count: number; wins: number; decided: number }>;
    }
  >();
  for (const def of slotDefs) {
    slotAccMap.set(def.slot, { games: 0, wins: 0, losses: 0, heroes: new Map() });
  }

  // 4. Trio Synergy (Core Axis JGL+MID+SUP & All Trios)
  const rawCoreTrios = new Map<string, { heroes: [string, string, string]; games: number; wins: number; losses: number }>();
  const rawAllTrios = new Map<string, { heroes: [string, string, string]; games: number; wins: number; losses: number }>();

  // 5. Comp Archetype & Opening Predictability
  const compCountMap = new Map<CompArchetypeKey, { games: number; wins: number; losses: number }>();
  const compMatchupMap = new Map<
    string,
    { ourArchetype: CompArchetypeKey; enemyArchetype: CompArchetypeKey; games: number; wins: number; losses: number }
  >();
  const openingPairMap = new Map<string, { a: string; b: string; games: number; wins: number; losses: number }>();
  const p1OpeningHeroCounts = new Map<string, number>();
  let totalP1HeroSlots = 0;

  for (const p of perspectives) {
    const resolvedByLane = new Map<LaneKey, string>();

    const seenSlotsInGame = new Set<DraftPickSlotKey>();
    p.ourPicks.forEach((hero, idx) => {
      // Blind vs Counter tracking
      const bc = heroBlindMap.get(hero) ?? {
        hero,
        games: 0,
        wins: 0,
        losses: 0,
        p1Games: 0,
        p1Wins: 0,
        p1Decided: 0,
        p2Games: 0,
        p2Wins: 0,
        p2Decided: 0,
      };
      bc.games += 1;
      if (p.decided) {
        if (p.didWin) bc.wins += 1;
        else bc.losses += 1;
      }
      if (idx < 3) {
        bc.p1Games += 1;
        if (p.decided) {
          bc.p1Decided += 1;
          if (p.didWin) bc.p1Wins += 1;
        }
        p1OpeningHeroCounts.set(hero, (p1OpeningHeroCounts.get(hero) ?? 0) + 1);
        totalP1HeroSlots += 1;
      } else {
        bc.p2Games += 1;
        if (p.decided) {
          bc.p2Decided += 1;
          if (p.didWin) bc.p2Wins += 1;
        }
      }
      heroBlindMap.set(hero, bc);

      // Draft Slot tracking
      const slot = slotForPick(p.isBlue, idx);
      const slotAcc = slotAccMap.get(slot);
      if (slotAcc) {
        if (!seenSlotsInGame.has(slot)) {
          seenSlotsInGame.add(slot);
          slotAcc.games += 1;
          if (p.decided) {
            if (p.didWin) slotAcc.wins += 1;
            else slotAcc.losses += 1;
          }
        }
        const sh = slotAcc.heroes.get(hero) ?? { hero, count: 0, wins: 0, decided: 0 };
        sh.count += 1;
        if (p.decided) {
          sh.decided += 1;
          if (p.didWin) sh.wins += 1;
        }
        slotAcc.heroes.set(hero, sh);
      }

      // Positional lane tracking
      const lane = resolveHeroLane(hero, p.game.pickLanes, heroMap);
      if (lane) {
        if (!resolvedByLane.has(lane)) resolvedByLane.set(lane, hero);
        const lMap = laneHeroMap.get(lane)!;
        const lEntry = lMap.get(hero) ?? { hero, games: 0, wins: 0, losses: 0, decided: 0 };
        lEntry.games += 1;
        if (p.decided) {
          lEntry.decided += 1;
          if (p.didWin) lEntry.wins += 1;
          else lEntry.losses += 1;
        }
        lMap.set(hero, lEntry);

        const hb = heroLaneBreakdown.get(hero) ?? { games: 0, wins: 0, losses: 0, lanes: {} };
        hb.games += 1;
        if (p.decided) {
          if (p.didWin) hb.wins += 1;
          else hb.losses += 1;
        }
        const hl = hb.lanes[lane] ?? { games: 0, wins: 0, losses: 0 };
        hl.games += 1;
        if (p.decided) {
          if (p.didWin) hl.wins += 1;
          else hl.losses += 1;
        }
        hb.lanes[lane] = hl;
        heroLaneBreakdown.set(hero, hb);
      }
    });

    // Core Axis Trio: Jungle + Mid + Roam
    const jglHero = resolvedByLane.get("Jungle");
    const midHero = resolvedByLane.get("Mid");
    const supHero = resolvedByLane.get("Roam");
    if (jglHero && midHero && supHero) {
      const sorted = [jglHero, midHero, supHero].sort() as [string, string, string];
      const key = sorted.join("::");
      const entry = rawCoreTrios.get(key) ?? { heroes: sorted, games: 0, wins: 0, losses: 0 };
      entry.games += 1;
      if (p.decided) {
        if (p.didWin) entry.wins += 1;
        else entry.losses += 1;
      }
      rawCoreTrios.set(key, entry);
    }

    // All 3-Hero Combos C(5,3)
    const uniquePicks = Array.from(new Set(p.ourPicks));
    if (uniquePicks.length >= 3) {
      for (let i = 0; i < uniquePicks.length; i++) {
        for (let j = i + 1; j < uniquePicks.length; j++) {
          for (let k = j + 1; k < uniquePicks.length; k++) {
            const sorted = [uniquePicks[i], uniquePicks[j], uniquePicks[k]].sort() as [string, string, string];
            const key = sorted.join("::");
            const entry = rawAllTrios.get(key) ?? { heroes: sorted, games: 0, wins: 0, losses: 0 };
            entry.games += 1;
            if (p.decided) {
              if (p.didWin) entry.wins += 1;
              else entry.losses += 1;
            }
            rawAllTrios.set(key, entry);
          }
        }
      }
    }

    // Comp Archetypes
    if (p.ourPicks.length >= 5) {
      const ourArch = classifyCompArchetype(p.ourPicks, heroMap);
      const cEntry = compCountMap.get(ourArch) ?? { games: 0, wins: 0, losses: 0 };
      cEntry.games += 1;
      if (p.decided) {
        if (p.didWin) cEntry.wins += 1;
        else cEntry.losses += 1;
      }
      compCountMap.set(ourArch, cEntry);

      if (p.theirPicks.length >= 5) {
        const enemyArch = classifyCompArchetype(p.theirPicks, heroMap);
        const mKey = `${ourArch}::${enemyArch}`;
        const mEntry = compMatchupMap.get(mKey) ?? {
          ourArchetype: ourArch,
          enemyArchetype: enemyArch,
          games: 0,
          wins: 0,
          losses: 0,
        };
        mEntry.games += 1;
        if (p.decided) {
          if (p.didWin) mEntry.wins += 1;
          else mEntry.losses += 1;
        }
        compMatchupMap.set(mKey, mEntry);
      }
    }

    // Opening Pair (First 2 picks of side: B1+B2 or R1+R2)
    if (p.ourPicks.length >= 2) {
      const [a, b] = p.ourPicks[0] < p.ourPicks[1] ? [p.ourPicks[0], p.ourPicks[1]] : [p.ourPicks[1], p.ourPicks[0]];
      const key = `${a}::${b}`;
      const op = openingPairMap.get(key) ?? { a, b, games: 0, wins: 0, losses: 0 };
      op.games += 1;
      if (p.decided) {
        if (p.didWin) op.wins += 1;
        else op.losses += 1;
      }
      openingPairMap.set(key, op);
    }
  }

  // Finalize 1. Positional Pools
  const positionalPools: PositionalPoolStat[] = CANONICAL_LANES.map((lane) => {
    const heroEntries = Array.from(laneHeroMap.get(lane)!.values()).sort(
      (a, b) => b.games - a.games || b.wins - a.wins || a.hero.localeCompare(b.hero),
    );
    const totalPicks = heroEntries.reduce((sum, h) => sum + h.games, 0);
    const uniqueHeroes = heroEntries.length;
    let hEntropy = 0;
    if (totalPicks > 0) {
      for (const h of heroEntries) {
        const prob = h.games / totalPicks;
        if (prob > 0) hEntropy -= prob * Math.log(prob);
      }
    }
    const effectivePool = uniqueHeroes > 0 ? Math.exp(hEntropy) : 0;
    const evennessPct = uniqueHeroes > 0 ? clamp((effectivePool / uniqueHeroes) * 100, 0, 100) : 0;
    const topHeroSharePct = totalPicks > 0 && heroEntries[0] ? (heroEntries[0].games / totalPicks) * 100 : 0;

    let squeezeRisk: SqueezeRiskLevel = "insufficient";
    if (totalPicks >= 4) {
      if (effectivePool < 3.2 || (totalPicks >= 6 && topHeroSharePct >= 45)) {
        squeezeRisk = "high";
      } else if (effectivePool < 5.0 || topHeroSharePct >= 32) {
        squeezeRisk = "medium";
      } else {
        squeezeRisk = "low";
      }
    }

    return {
      lane,
      totalPicks,
      uniqueHeroes,
      effectivePool,
      evennessPct,
      topHeroSharePct,
      squeezeRisk,
      topHeroes: heroEntries.slice(0, 4),
    };
  });

  // Finalize 2. Blind vs Counter & Slots
  const blindCounterHeroes: HeroBlindCounterStat[] = Array.from(heroBlindMap.values())
    .filter((h) => h.games >= 2)
    .map((h) => {
      const decided = h.wins + h.losses;
      const p1WrPct = h.p1Decided > 0 ? (h.p1Wins / h.p1Decided) * 100 : null;
      const p2WrPct = h.p2Decided > 0 ? (h.p2Wins / h.p2Decided) * 100 : null;
      const wrDiffP2MinusP1Pct = p1WrPct !== null && p2WrPct !== null ? p2WrPct - p1WrPct : null;

      let classification: BlindCounterClass = "balanced";
      if (
        p2WrPct !== null &&
        h.p2Decided >= 2 &&
        p2WrPct >= 55 &&
        (p1WrPct === null || p2WrPct - p1WrPct >= 12)
      ) {
        classification = "counter_specialist";
      } else if (
        p1WrPct !== null &&
        h.p1Decided >= 2 &&
        p1WrPct >= 55 &&
        (p2WrPct === null || p1WrPct - p2WrPct >= -8)
      ) {
        classification = "blind_safe";
      } else if (p1WrPct !== null && h.p1Decided >= 2 && p1WrPct < 45) {
        classification = "blind_risk";
      }

      return {
        hero: h.hero,
        games: h.games,
        wins: h.wins,
        losses: h.losses,
        decided,
        p1Games: h.p1Games,
        p1Wins: h.p1Wins,
        p1Decided: h.p1Decided,
        p1WrPct,
        p2Games: h.p2Games,
        p2Wins: h.p2Wins,
        p2Decided: h.p2Decided,
        p2WrPct,
        wrDiffP2MinusP1Pct,
        classification,
      };
    })
    .sort((a, b) => b.games - a.games || b.wins - a.wins);

  const draftSlots: DraftSlotStat[] = slotDefs.map((def) => {
    const acc = slotAccMap.get(def.slot)!;
    const decided = acc.wins + acc.losses;
    const topHeroes = Array.from(acc.heroes.values())
      .sort((a, b) => b.count - a.count || b.wins - a.wins || a.hero.localeCompare(b.hero))
      .slice(0, 3);
    return {
      slot: def.slot,
      side: def.side,
      phase: def.phase,
      games: acc.games,
      wins: acc.wins,
      losses: acc.losses,
      decided,
      wrPct: decided > 0 ? (acc.wins / decided) * 100 : null,
      topHeroes,
    };
  });

  // Finalize 3. Flex Effectiveness
  const flexHeroes: FlexHeroStat[] = [];
  const flexHeroSet = new Set<string>();
  for (const [hero, hb] of heroLaneBreakdown.entries()) {
    const laneList: FlexLaneBreakdown[] = Object.entries(hb.lanes)
      .map(([lane, c]) => {
        const lDecided = c.wins + c.losses;
        return {
          lane: lane as LaneKey,
          games: c.games,
          wins: c.wins,
          losses: c.losses,
          decided: lDecided,
          wrPct: lDecided > 0 ? (c.wins / lDecided) * 100 : null,
        };
      })
      .sort((a, b) => b.games - a.games || b.wins - a.wins);

    const significantLanes = laneList.filter((l) => l.games >= 2 || (hb.games >= 3 && l.games / hb.games >= 0.15));
    if (significantLanes.length >= 2) {
      flexHeroSet.add(hero);
      const decided = hb.wins + hb.losses;
      flexHeroes.push({
        hero,
        games: hb.games,
        wins: hb.wins,
        losses: hb.losses,
        decided,
        wrPct: decided > 0 ? (hb.wins / decided) * 100 : null,
        laneBreakdown: laneList,
      });
    }
  }
  flexHeroes.sort((a, b) => b.games - a.games || (b.wrPct ?? -1) - (a.wrPct ?? -1));

  let withFlexGames = 0;
  let withFlexWins = 0;
  let withFlexDecided = 0;
  let withoutFlexGames = 0;
  let withoutFlexWins = 0;
  let withoutFlexDecided = 0;
  for (const p of perspectives) {
    const hasFlex = p.ourPicks.some((h) => flexHeroSet.has(h));
    if (hasFlex) {
      withFlexGames += 1;
      if (p.decided) {
        withFlexDecided += 1;
        if (p.didWin) withFlexWins += 1;
      }
    } else {
      withoutFlexGames += 1;
      if (p.decided) {
        withoutFlexDecided += 1;
        if (p.didWin) withoutFlexWins += 1;
      }
    }
  }

  // Finalize 4. Trio Synergy
  const summarizeTrios = (
    raw: ReadonlyMap<string, { heroes: [string, string, string]; games: number; wins: number; losses: number }>,
    minGames: number,
  ): TrioStat[] =>
    Array.from(raw.values())
      .filter((t) => t.games >= minGames && t.wins + t.losses > 0)
      .map((t) => {
        const decided = t.wins + t.losses;
        const bayesianWr = (t.wins + 6 * teamPrior) / (decided + 6);
        return {
          ...t,
          decided,
          bayesianWr,
          deltaVsTeamPct: (bayesianWr - teamPrior) * 100,
        };
      })
      .sort((a, b) => b.bayesianWr - a.bayesianWr || b.games - a.games);

  const coreAxisTrios = summarizeTrios(rawCoreTrios, 2).slice(0, 24);
  const minAllTrioGames = totalPerspectives >= 45 ? 3 : 2;
  let allTrios = summarizeTrios(rawAllTrios, minAllTrioGames);
  if (allTrios.length < 4 && minAllTrioGames > 2) {
    allTrios = summarizeTrios(rawAllTrios, 2);
  }
  allTrios = allTrios.slice(0, 24);

  // Finalize 5. Comp Archetype & Predictability
  const totalCompGames = Array.from(compCountMap.values()).reduce((s, v) => s + v.games, 0);
  const archetypeStats: CompArchetypeStat[] = Array.from(compCountMap.entries())
    .map(([key, c]) => {
      const decided = c.wins + c.losses;
      return {
        key,
        games: c.games,
        wins: c.wins,
        losses: c.losses,
        decided,
        sharePct: totalCompGames > 0 ? (c.games / totalCompGames) * 100 : 0,
        wrPct: decided > 0 ? (c.wins / decided) * 100 : null,
      };
    })
    .sort((a, b) => b.games - a.games || (b.wrPct ?? -1) - (a.wrPct ?? -1));

  const archetypeMatchups: CompArchetypeMatchup[] = Array.from(compMatchupMap.values())
    .filter((m) => m.wins + m.losses >= 2)
    .map((m) => {
      const decided = m.wins + m.losses;
      return {
        ...m,
        decided,
        wrPct: decided > 0 ? (m.wins / decided) * 100 : null,
      };
    })
    .sort((a, b) => b.games - a.games || (b.wrPct ?? 0) - (a.wrPct ?? 0))
    .slice(0, 12);

  let p1Entropy = 0;
  if (totalP1HeroSlots > 0) {
    for (const c of p1OpeningHeroCounts.values()) {
      const prob = c / totalP1HeroSlots;
      if (prob > 0) p1Entropy -= prob * Math.log(prob);
    }
  }
  const uniqueOpeningCount = p1OpeningHeroCounts.size;
  const effP1 = uniqueOpeningCount > 0 ? Math.exp(p1Entropy) : 0;
  const openingDiversityPct = uniqueOpeningCount > 1 ? clamp((effP1 / uniqueOpeningCount) * 100, 0, 100) : 0;
  const openingEntropyLabel =
    totalPerspectives < 4
      ? "insufficient"
      : openingDiversityPct >= 72
        ? "unpredictable"
        : openingDiversityPct >= 52
          ? "moderate"
          : "predictable";

  const topOpenings: OpeningPairStat[] = Array.from(openingPairMap.values())
    .filter((op) => op.games >= 2)
    .map((op) => {
      const decided = op.wins + op.losses;
      return {
        ...op,
        decided,
        wrPct: decided > 0 ? (op.wins / decided) * 100 : null,
      };
    })
    .sort((a, b) => b.games - a.games || (b.wrPct ?? 0) - (a.wrPct ?? 0))
    .slice(0, 16);

  return {
    totalPerspectives,
    positionalPools,
    blindCounterHeroes,
    draftSlots,
    flexSummary: {
      flexHeroes,
      withFlexGames,
      withFlexWins,
      withFlexDecided,
      withoutFlexGames,
      withoutFlexWins,
      withoutFlexDecided,
    },
    trioSummary: {
      coreAxisTrios,
      allTrios,
    },
    compSummary: {
      archetypeStats,
      archetypeMatchups,
      openingDiversityPct,
      openingEntropyLabel,
      uniqueOpeningCount,
      topOpenings,
    },
  };
}

export function splitGamesForPeriodDiff(
  scopedGames: readonly RecordedDraftGame[],
  allTournamentGames: readonly RecordedDraftGame[],
  mode: PeriodDiffMode,
  tournamentAId: string,
  tournamentBId: string,
  tournaments: readonly TournamentRef[],
): {
  periodAGames: RecordedDraftGame[];
  periodBGames: RecordedDraftGame[];
  labelA: string;
  labelB: string;
} {
  if (mode === "tournaments" && tournaments.length >= 2) {
    const idA = tournamentAId || tournaments[tournaments.length - 1]?.id || "";
    const idB = tournamentBId || tournaments[0]?.id || "";
    const nameA = tournaments.find((t) => t.id === idA)?.name ?? "Tournament A";
    const nameB = tournaments.find((t) => t.id === idB)?.name ?? "Tournament B";
    return {
      periodAGames: allTournamentGames.filter((g) => (g.tournament?.id ?? "") === idA),
      periodBGames: allTournamentGames.filter((g) => (g.tournament?.id ?? "") === idB),
      labelA: nameA,
      labelB: nameB,
    };
  }

  const ordered = scopedGames
    .map((game, idx) => ({ game, idx, t: recordedGameTime(game) }))
    .sort((a, b) => {
      if (a.t !== null && b.t !== null && a.t !== b.t) return a.t - b.t;
      return b.idx - a.idx;
    })
    .map((x) => x.game);

  if (mode === "last7_vs_prev") {
    const dated = ordered.map((g) => ({ game: g, t: recordedGameTime(g) }));
    const maxTime = dated.reduce((mx, d) => (d.t !== null && d.t > mx ? d.t : mx), -Infinity);
    if (Number.isFinite(maxTime)) {
      const cutoff = maxTime - 7 * 24 * 60 * 60 * 1000;
      const periodAGames = dated.filter((d) => d.t !== null && d.t < cutoff).map((d) => d.game);
      const periodBGames = dated.filter((d) => d.t !== null && d.t >= cutoff).map((d) => d.game);
      if (periodAGames.length > 0 && periodBGames.length > 0) {
        return {
          periodAGames,
          periodBGames,
          labelA: "ก่อน 7 วันล่าสุด",
          labelB: "7 วันล่าสุด",
        };
      }
    }
  }

  const mid = Math.floor(ordered.length / 2);
  return {
    periodAGames: ordered.slice(0, mid),
    periodBGames: ordered.slice(mid),
    labelA: "ช่วงแรก",
    labelB: "ช่วงหลัง",
  };
}

function summarizePeriod(
  games: readonly RecordedDraftGame[],
  focusTeam: string,
  opponentFilter: string,
  label: string,
) {
  const perspectives = extractPerspectives(games, focusTeam, opponentFilter);
  const focusLower = focusTeam.trim().toLowerCase();
  const oppLower = opponentFilter === "ALL" ? null : opponentFilter.trim().toLowerCase();

  let wins = 0;
  let decided = 0;
  let blueWins = 0;
  let blueDecided = 0;
  let redWins = 0;
  let redDecided = 0;
  let gameCount = 0;

  const heroCounts = new Map<string, { picks: number; bans: number; wins: number; decided: number }>();

  for (const game of games) {
    const bName = game.blueTeamName?.trim().toLowerCase() ?? "";
    const rName = game.redTeamName?.trim().toLowerCase() ?? "";
    if (focusLower) {
      const isB = bName === focusLower;
      const isR = rName === focusLower;
      if (isB === isR) continue;
      if (oppLower && (isB ? rName : bName) !== oppLower) continue;
    }
    gameCount += 1;

    if (!focusLower) {
      for (const bh of new Set([...game.blueBans, ...game.redBans])) {
        const cur = heroCounts.get(bh) ?? { picks: 0, bans: 0, wins: 0, decided: 0 };
        cur.bans += 1;
        heroCounts.set(bh, cur);
      }
    } else {
      const isB = bName === focusLower;
      const theirBans = isB ? game.redBans : game.blueBans;
      const ourBans = isB ? game.blueBans : game.redBans;
      for (const bh of new Set([...theirBans, ...ourBans])) {
        const cur = heroCounts.get(bh) ?? { picks: 0, bans: 0, wins: 0, decided: 0 };
        cur.bans += 1;
        heroCounts.set(bh, cur);
      }
    }
  }

  for (const p of perspectives) {
    if (p.decided) {
      decided += 1;
      if (p.didWin) wins += 1;
      if (p.isBlue) {
        blueDecided += 1;
        if (p.didWin) blueWins += 1;
      } else {
        redDecided += 1;
        if (p.didWin) redWins += 1;
      }
    }
    for (const hero of p.ourPicks) {
      const cur = heroCounts.get(hero) ?? { picks: 0, bans: 0, wins: 0, decided: 0 };
      cur.picks += 1;
      if (p.decided) {
        cur.decided += 1;
        if (p.didWin) cur.wins += 1;
      }
      heroCounts.set(hero, cur);
    }
  }

  const metrics: PeriodSummaryMetrics = {
    label,
    games: gameCount,
    decided,
    wins,
    wrPct: decided > 0 ? (wins / decided) * 100 : null,
    blueWins,
    blueDecided,
    blueWrPct: blueDecided > 0 ? (blueWins / blueDecided) * 100 : null,
    redWins,
    redDecided,
    redWrPct: redDecided > 0 ? (redWins / redDecided) * 100 : null,
  };

  return { metrics, heroCounts, denom: Math.max(1, gameCount) };
}

export function computePeriodDiff(
  periodAGames: readonly RecordedDraftGame[],
  periodBGames: readonly RecordedDraftGame[],
  focusTeam: string,
  opponentFilter: string,
  labelA: string,
  labelB: string,
): PeriodDiffSummary {
  const sumA = summarizePeriod(periodAGames, focusTeam, opponentFilter, labelA);
  const sumB = summarizePeriod(periodBGames, focusTeam, opponentFilter, labelB);
  const allHeroes = new Set([...sumA.heroCounts.keys(), ...sumB.heroCounts.keys()]);
  const teamView = Boolean(focusTeam.trim());

  const deltas: PeriodHeroDelta[] = [];
  for (const hero of allHeroes) {
    const a = sumA.heroCounts.get(hero) ?? { picks: 0, bans: 0, wins: 0, decided: 0 };
    const b = sumB.heroCounts.get(hero) ?? { picks: 0, bans: 0, wins: 0, decided: 0 };
    if (a.picks + a.bans + b.picks + b.bans < 2) continue;

    const pickRateAPct = (a.picks / sumA.denom) * 100;
    const pickRateBPct = (b.picks / sumB.denom) * 100;
    const contestRateAPct = Math.min(100, ((a.picks + a.bans) / sumA.denom) * 100);
    const contestRateBPct = Math.min(100, ((b.picks + b.bans) / sumB.denom) * 100);
    const deltaPct = teamView ? pickRateBPct - pickRateAPct : contestRateBPct - contestRateAPct;
    const wrAPct = a.decided > 0 ? (a.wins / a.decided) * 100 : null;
    const wrBPct = b.decided > 0 ? (b.wins / b.decided) * 100 : null;

    deltas.push({
      hero,
      gamesA: a.picks,
      gamesB: b.picks,
      bansA: a.bans,
      bansB: b.bans,
      pickRateAPct,
      pickRateBPct,
      contestRateAPct,
      contestRateBPct,
      deltaPct,
      wrAPct,
      wrBPct,
      wrDeltaPct: wrAPct !== null && wrBPct !== null ? wrBPct - wrAPct : null,
    });
  }

  const risingHeroes = deltas
    .filter((d) => d.deltaPct >= 4)
    .sort((a, b) => b.deltaPct - a.deltaPct || b.gamesB - a.gamesB)
    .slice(0, 12);

  const fallingHeroes = deltas
    .filter((d) => d.deltaPct <= -4)
    .sort((a, b) => a.deltaPct - b.deltaPct || b.gamesA - a.gamesA)
    .slice(0, 12);

  return {
    periodA: sumA.metrics,
    periodB: sumB.metrics,
    wrShiftPct:
      sumA.metrics.wrPct !== null && sumB.metrics.wrPct !== null ? sumB.metrics.wrPct - sumA.metrics.wrPct : null,
    risingHeroes,
    fallingHeroes,
  };
}

export const COMP_ARCHETYPE_LABELS: Record<CompArchetypeKey, string> = {
  frontline_teamfight: "ไฟต์ชนหน้า-หลัง",
  dive_pick: "คอมพ์ล้วง",
  double_carry_poke: "แครี่คู่ / ตอดไกล",
  protect_utility: "เลี้ยงแครี่ / ซัพคู่",
  balanced: "สมดุล",
};

export function buildScoutingReportMarkdown({
  focusTeam,
  opponentFilter,
  stats,
  allStats,
  advanced,
  t,
}: {
  focusTeam: string;
  opponentFilter: string;
  stats: ScrimAnalyticsSummary;
  allStats: AllTeamsAnalyticsSummary | null;
  advanced: ScrimAdvancedStats;
  t: (msg: string, ...args: (string | number)[]) => string;
}): string {
  const isAll = !focusTeam.trim() && allStats !== null;
  const title = isAll
    ? t("สรุปรายงาน Scouting: ภาพรวมเมต้าทุกทีม ({0} เกม / {1} ซีรีส์)", allStats.total, allStats.seriesCount)
    : t(
        "สรุปรายงาน Scouting: {0}{1} ({2} เกม / {3} ซีรีส์)",
        focusTeam,
        opponentFilter !== "ALL" ? ` vs ${opponentFilter}` : "",
        stats.total,
        stats.seriesCount,
      );

  const lines: string[] = [`# ${title}`, ""];

  if (isAll && allStats) {
    const blueWr = allStats.decided > 0 ? ((allStats.blueWins / allStats.decided) * 100).toFixed(1) : "—";
    const redWr = allStats.decided > 0 ? ((allStats.redWins / allStats.decided) * 100).toFixed(1) : "—";
    lines.push(
      `- ${t("ฝั่ง Blue vs Red")}: Blue ${blueWr}% (${allStats.blueWins}/${allStats.decided}) · Red ${redWr}% (${allStats.redWins}/${allStats.decided})`,
    );
    lines.push(
      `- ${t("คลังฮีโร่")}: ${allStats.uniqueHeroCount} ${t("ตัวที่ใช้จริง")} (${t("ตัวหลัก:")} ${allStats.effectiveHeroPool.toFixed(1)})`,
    );
  } else {
    const overallWr = stats.decided > 0 ? ((stats.wins / stats.decided) * 100).toFixed(1) : "—";
    const blueWr = stats.blueDecided > 0 ? ((stats.blueWins / stats.blueDecided) * 100).toFixed(1) : "—";
    const redWr = stats.redDecided > 0 ? ((stats.redWins / stats.redDecided) * 100).toFixed(1) : "—";
    lines.push(`- ${t("Win Rate รวม")}: ${overallWr}% (${stats.wins}W-${stats.losses}L)`);
    lines.push(`- Blue: ${blueWr}% (${stats.blueWins}/${stats.blueDecided}) · Red: ${redWr}% (${stats.redWins}/${stats.redDecided})`);
    if (stats.seriesWinProb) {
      lines.push(`- ${t("โอกาสปิดซีรีส์:")} Bo5 ${stats.seriesWinProb.bo5Pct.toFixed(0)}% · Bo7 ${stats.seriesWinProb.bo7Pct.toFixed(0)}%`);
    }
    if (stats.fatigueSlopePctPerGame !== null) {
      lines.push(`- G1–G7 Slope: ${stats.fatigueSlopePctPerGame >= 0 ? "+" : ""}${stats.fatigueSlopePctPerGame.toFixed(1)}%/game`);
    }
  }

  lines.push("", `## ${t("1. คลังฮีโร่รายเลน & จุดเสี่ยงโดนบีบแบน")}`);
  for (const pool of advanced.positionalPools) {
    const laneLabel = LANE_SHORT[pool.lane]?.en ?? pool.lane;
    const riskTxt =
      pool.squeezeRisk === "high"
        ? t("เสี่ยงโดนบีบสูง")
        : pool.squeezeRisk === "medium"
          ? t("เสี่ยงปานกลาง")
          : pool.squeezeRisk === "low"
            ? t("คลังลึก")
            : t("ข้อมูลน้อย");
    const tops = pool.topHeroes
      .slice(0, 3)
      .map((h) => `${displayName(h.hero)}(${h.games})`)
      .join(", ");
    lines.push(`- ${laneLabel}: ${pool.uniqueHeroes} ${t("ตัว")} (Eff ${pool.effectivePool.toFixed(1)}) [${riskTxt}] — ${tops || "—"}`);
  }

  const blindSafe = advanced.blindCounterHeroes.filter((h) => h.classification === "blind_safe").slice(0, 4);
  const counterSpec = advanced.blindCounterHeroes.filter((h) => h.classification === "counter_specialist").slice(0, 4);
  if (blindSafe.length > 0 || counterSpec.length > 0) {
    lines.push("", `## ${t("2. เปิดก่อนคุ้ม & ตัวแก้ทาง")}`);
    if (blindSafe.length > 0) {
      lines.push(
        `- Blind Safe (P1–P3): ${blindSafe.map((h) => `${displayName(h.hero)} ${h.p1WrPct?.toFixed(0)}%`).join(", ")}`,
      );
    }
    if (counterSpec.length > 0) {
      lines.push(
        `- Counter Pick (P4–P5): ${counterSpec.map((h) => `${displayName(h.hero)} ${h.p2WrPct?.toFixed(0)}%`).join(", ")}`,
      );
    }
  }

  if (advanced.flexSummary.flexHeroes.length > 0) {
    lines.push("", `## ${t("3. ตัว Flex ที่ต้องระวัง")}`);
    for (const f of advanced.flexSummary.flexHeroes.slice(0, 5)) {
      const lanesStr = f.laneBreakdown
        .map((l) => `${LANE_SHORT[l.lane]?.en ?? l.lane}:${l.games}`)
        .join("/");
      lines.push(`- ${displayName(f.hero)} (${f.games}g, ${f.wrPct !== null ? `${f.wrPct.toFixed(0)}%` : "—"}) [${lanesStr}]`);
    }
  }

  if (advanced.compSummary.topOpenings.length > 0) {
    lines.push("", `## ${t("4. คู่เปิด Phase 1 ยอดฮิต")}`);
    for (const op of advanced.compSummary.topOpenings.slice(0, 5)) {
      lines.push(
        `- ${displayName(op.a)} + ${displayName(op.b)}: ${op.games}g (${op.wins}W-${op.losses}L · ${op.wrPct !== null ? `${op.wrPct.toFixed(0)}%` : "—"})`,
      );
    }
  }

  if (!isAll && stats.toughestEnemies.length > 0) {
    lines.push("", `## ${t("5. ฮีโร่ที่ทีมนี้แพ้ทาง")}`);
    for (const e of stats.toughestEnemies.slice(0, 5)) {
      lines.push(`- ${displayName(e.hero)}: ${e.threatDeltaPct.toFixed(1)}% (${e.ourWins}W-${e.ourLosses}L)`);
    }
  }

  if (advanced.trioSummary.coreAxisTrios.length > 0) {
    lines.push("", `## ${t("6. สามประสานคุมเกม (ป่า+เมจ+โรม)")}`);
    for (const trio of advanced.trioSummary.coreAxisTrios.slice(0, 4)) {
      lines.push(
        `- ${trio.heroes.map((h) => displayName(h)).join(" + ")}: ${trio.games}g (${trio.wins}W-${trio.losses}L)`,
      );
    }
  }

  // Silence unused import lint if getGameSeriesKey isn't needed directly here
  void getGameSeriesKey;
  return lines.join("\n");
}

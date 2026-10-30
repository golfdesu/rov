import { ArrowDownAZ, Search, Sparkles, X } from "lucide-react";
import { forwardRef, useMemo, useState } from "react";
import type { DraftStep, Hero, RoleType } from "../types/draft";
import { LANE_SHORT, ROLES, TIER_STYLE, laneKey, missingLaneKeys } from "../utils/draft";
import { displayName, matchesHeroQuery } from "../utils/heroNames";
import { HeroPortrait } from "./HeroPortrait";

interface HeroGridProps {
  heroes: Hero[];
  unavailableHeroes: Set<string>;
  blueUsedHeroes?: string[];
  redUsedHeroes?: string[];
  universalBans?: string[];
  blueTeamName?: string;
  redTeamName?: string;
  recommendedRanks: Map<string, number>;
  missingAllyLanes: string[];
  currentStep: DraftStep | null;
  isHeroesLoading: boolean;
  onLockHero: (name: string) => void;
}

const LANE_KEYS = Object.keys(LANE_SHORT);

export const HeroGrid = forwardRef<HTMLInputElement, HeroGridProps>(function HeroGrid(
  {
    heroes,
    unavailableHeroes,
    blueUsedHeroes = [],
    redUsedHeroes = [],
    universalBans = [],
    blueTeamName = "BLUE",
    redTeamName = "RED",
    recommendedRanks,
    missingAllyLanes,
    currentStep,
    isHeroesLoading,
    onLockHero,
  },
  searchRef,
) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<RoleType | null>(null);
  const [lane, setLane] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"ai" | "az">("ai");

  const isBan = currentStep?.action === "ban";
  const isBlueTurn = currentStep?.side !== "red";
  const blueUsedSet = useMemo(() => new Set(blueUsedHeroes), [blueUsedHeroes]);
  const redUsedSet = useMemo(() => new Set(redUsedHeroes), [redUsedHeroes]);
  const univBanSet = useMemo(() => new Set(universalBans), [universalBans]);

  const missing = useMemo(() => {
    const keys = isBan ? new Set<string>() : missingLaneKeys(missingAllyLanes);
    return keys.size >= 5 ? new Set<string>() : keys;
  }, [isBan, missingAllyLanes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // AI sort: available first, then AI rank, then heroes filling a missing lane, then name
    const score = (h: Hero) => {
      if (unavailableHeroes.has(h.name)) return 3000;
      const rank = recommendedRanks.get(h.name);
      if (rank) return rank;
      return missing.has(laneKey(h.lane)) ? 1000 : 2000;
    };
    return heroes
      .filter((h) => (!q || matchesHeroQuery(h.name, q)) && (!role || h.role === role))
      .filter((h) => !lane || laneKey(h.lane) === lane)
      .sort(
        (a, b) =>
          (sortMode === "ai" ? score(a) - score(b) : 0) || displayName(a.name).localeCompare(displayName(b.name)),
      );
  }, [heroes, query, role, lane, sortMode, unavailableHeroes, recommendedRanks, missing]);
  const chip = (active: boolean) =>
    `h-6 shrink-0 border px-2 font-display text-[10px] font-semibold tracking-wide transition-colors sm:h-6.5 sm:px-2.5 sm:text-[11px] ${
      active ? "border-gold/60 bg-gold/10 text-gold" : "border-line text-muted hover:border-line-strong hover:text-ink"
    }`;

  return (
    <section className="flex min-h-0 flex-1 flex-col border border-line bg-panel clip-chamfer">
      {/* Filters */}
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-line p-2 sm:p-2.5">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-dim" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  e.currentTarget.blur();
                }
                if (e.key === "Enter") {
                  e.stopPropagation();
                  const first = filtered.find((h) => !unavailableHeroes.has(h.name));
                  if (first && currentStep) {
                    onLockHero(first.name);
                    setQuery("");
                  }
                }
              }}
              placeholder="ค้นหาฮีโร่…"
              aria-label="Search heroes"
              className="h-8 w-full border border-line bg-bg pr-12 pl-8 text-xs text-ink placeholder:text-dim focus:border-gold/60 focus:outline-none sm:text-sm"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 text-dim hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd className="absolute top-1/2 right-2 -translate-y-1/2 border border-line px-1 font-mono text-[9px] text-dim">
                /
              </kbd>
            )}
          </label>
          <button
            type="button"
            onClick={() => setSortMode(sortMode === "ai" ? "az" : "ai")}
            title={sortMode === "ai" ? "เรียงตามคำแนะนำ AI และเลนที่ขาด" : "เรียงตามชื่อ"}
            className="flex h-8 shrink-0 items-center gap-1 border border-line-strong px-2 font-display text-[10px] font-semibold tracking-wide text-ink transition-colors hover:border-gold/60 hover:text-gold sm:px-2.5 sm:text-[11px]"
          >
            {sortMode === "ai" ? <Sparkles className="h-3 w-3 text-gold" /> : <ArrowDownAZ className="h-3 w-3" />}
            {sortMode === "ai" ? "AI" : "A–Z"}
          </button>
          <span className="hidden font-mono text-[11px] text-dim sm:inline">
            {filtered.length}/{heroes.length}
          </span>
        </div>

        <div className="flex gap-1 overflow-x-auto pb-0.5">
          <button type="button" className={chip(role === null)} onClick={() => setRole(null)}>
            ALL
          </button>
          {ROLES.map((r) => (
            <button key={r} type="button" className={chip(role === r)} onClick={() => setRole(role === r ? null : r)}>
              {r.toUpperCase()}
            </button>
          ))}
          <div className="mx-0.5 w-px shrink-0 bg-line" />
          {LANE_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              title={LANE_SHORT[k].th}
              className={chip(lane === k)}
              onClick={() => setLane(lane === k ? null : k)}
            >
              {LANE_SHORT[k].en}
            </button>
          ))}
        </div>
      </div>

      {/* Grid — fills remaining vertical height and scrolls internally */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="grid grid-cols-5 gap-1 p-2 sm:grid-cols-6 sm:gap-1.5 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-9">
          {isHeroesLoading &&
            Array.from({ length: 18 }).map((_, i) => <div key={i} className="aspect-square animate-pulse bg-panel-2" />)}
          {!isHeroesLoading && filtered.length === 0 && (
            <div className="col-span-full py-10 text-center text-sm text-muted">ไม่พบฮีโร่ที่ตรงกับตัวกรอง</div>
          )}
          {filtered.map((hero) => {
            const taken = unavailableHeroes.has(hero.name);
            const inBlueUsed = blueUsedSet.has(hero.name);
            const inRedUsed = redUsedSet.has(hero.name);
            const inUnivBan = univBanSet.has(hero.name);

            const actingTeamUsed = isBlueTurn ? inBlueUsed : inRedUsed;
            const opponentTeamUsed = isBlueTurn ? inRedUsed : inBlueUsed;
            const actingTeamName = isBlueTurn ? blueTeamName : redTeamName;
            const opponentTeamName = isBlueTurn ? redTeamName : blueTeamName;

            const lockedByGlobalBan = inUnivBan || (isBan ? opponentTeamUsed : actingTeamUsed);
            const canBanToDeny = isBan && !taken && actingTeamUsed && !opponentTeamUsed;
            const usedByOpponentOnly = !isBan && !taken && opponentTeamUsed && !actingTeamUsed;

            const rank = recommendedRanks.get(hero.name);
            const fillsLane = !taken && missing.has(laneKey(hero.lane));
            const disabled = taken || !currentStep;
            return (
              <button
                key={hero.name}
                type="button"
                disabled={disabled}
                onClick={() => onLockHero(hero.name)}
                title={`${displayName(hero.name)} · ${hero.role} · ${laneKey(hero.lane)} · Tier ${hero.tier}${
                  lockedByGlobalBan
                    ? ` · GLOBAL BAN (${inUnivBan ? "แบนร่วม" : isBan ? `${opponentTeamName} เคยใช้แล้ว · ไม่ต้องแบน` : `${actingTeamName} ใช้แล้ว`})`
                    : canBanToDeny
                      ? ` · ${actingTeamName} เคยเล่นแล้ว · สามารถแบนตัด ${opponentTeamName} ได้`
                      : usedByOpponentOnly
                        ? ` · ${opponentTeamName} ใช้ไปแล้วในเกมก่อน`
                        : ""
                }`}
                className={`group relative aspect-square overflow-hidden border text-left transition-all ${
                  lockedByGlobalBan
                    ? "border-red/40 opacity-45 grayscale"
                    : taken
                      ? "border-line opacity-25 grayscale"
                      : rank
                        ? "border-gold/70 ring-1 ring-gold/40 hover:border-gold"
                        : fillsLane
                          ? "border-good/40 hover:border-good"
                          : canBanToDeny
                            ? "border-blue/50 hover:border-blue"
                            : "border-line hover:border-muted"
                } ${disabled ? "cursor-not-allowed" : "hover:-translate-y-0.5"}`}
              >
                <HeroPortrait
                  name={hero.name}
                  hero={hero}
                  className="transition-transform duration-300 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/30 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 px-1.5 pb-1">
                  <span className="truncate font-display text-[11px] font-bold leading-tight tracking-wide">
                    {displayName(hero.name)}
                  </span>
                  <span
                    className={`hidden shrink-0 font-mono text-[9px] font-bold xl:inline ${fillsLane ? "text-good" : "text-muted"}`}
                  >
                    {LANE_SHORT[laneKey(hero.lane)]?.en}
                  </span>
                </div>
                <span
                  className={`absolute top-1 left-1 border px-1 font-mono text-[9px] font-bold ${TIER_STYLE[hero.tier] ?? TIER_STYLE.B}`}
                >
                  {hero.tier}
                </span>
                {rank && !taken && (
                  <span className="absolute top-1 right-1 bg-gold px-1 font-mono text-[10px] font-bold text-bg">
                    #{rank}
                  </span>
                )}
                {usedByOpponentOnly && !rank && (
                  <span
                    className={`absolute top-1 right-1 max-w-[calc(100%-26px)] truncate px-1 font-mono text-[8px] font-bold ${
                      isBlueTurn ? "bg-red/85 text-ink" : "bg-blue/85 text-ink"
                    }`}
                  >
                    {opponentTeamName.slice(0, 4)} ใช้แล้ว
                  </span>
                )}
                {canBanToDeny && !rank && (
                  <span
                    className={`absolute top-1 right-1 max-w-[calc(100%-26px)] truncate px-1 font-mono text-[8px] font-bold ${
                      isBlueTurn ? "bg-blue/85 text-ink" : "bg-red/85 text-ink"
                    }`}
                  >
                    {actingTeamName.slice(0, 4)} เคยเล่น
                  </span>
                )}
                {lockedByGlobalBan && (
                  <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 bg-bg/90 py-0.5 text-center border-y border-red/60">
                    <div className="font-mono text-[8px] font-bold tracking-wider text-red">GLOBAL BAN</div>
                    <div className="truncate px-1 font-display text-[8px] text-muted">
                      {inUnivBan
                        ? "แบนทั้งซีรีส์"
                        : isBan
                          ? `${opponentTeamName} เคยใช้แล้ว`
                          : `${actingTeamName} ใช้แล้ว`}
                    </div>
                  </div>
                )}
                {!disabled && (
                  <span
                    className={`absolute inset-0 grid place-items-center font-display text-sm font-bold tracking-[0.2em] opacity-0 transition-opacity group-hover:opacity-100 ${
                      isBan ? "bg-red/30 text-ink" : "bg-blue/20 text-ink"
                    }`}
                  >
                    {isBan ? "BAN" : "LOCK"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
});

import { ArrowDownAZ, Search, Sparkles, X } from "lucide-react";
import { forwardRef, useMemo, useState } from "react";
import type { DraftStep, Hero, RoleType } from "../types/draft";
import { LANE_SHORT, ROLES, TIER_STYLE, laneKey, missingLaneKeys } from "../utils/draft";
import { displayName, matchesHeroQuery } from "../utils/heroNames";
import { HeroPortrait } from "./HeroPortrait";

interface HeroGridProps {
  heroes: Hero[];
  unavailableHeroes: Set<string>;
  recommendedRanks: Map<string, number>;
  missingAllyLanes: string[];
  currentStep: DraftStep | null;
  isHeroesLoading: boolean;
  onLockHero: (name: string) => void;
}

const LANE_KEYS = Object.keys(LANE_SHORT);

export const HeroGrid = forwardRef<HTMLInputElement, HeroGridProps>(function HeroGrid(
  { heroes, unavailableHeroes, recommendedRanks, missingAllyLanes, currentStep, isHeroesLoading, onLockHero },
  searchRef,
) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<RoleType | null>(null);
  const [lane, setLane] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"ai" | "az">("ai");

  const isBan = currentStep?.action === "ban";
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
    `h-7 shrink-0 border px-2.5 font-display text-[11px] font-semibold tracking-wide transition-colors ${
      active ? "border-gold/60 bg-gold/10 text-gold" : "border-line text-muted hover:border-line-strong hover:text-ink"
    }`;

  return (
    <section className="flex flex-col border border-line bg-panel clip-chamfer">
      {/* Filters */}
      <div className="flex flex-col gap-2 border-b border-line p-3">
        <div className="flex items-center gap-2">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-dim" />
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
              className="h-9 w-full border border-line bg-bg pr-14 pl-8 text-sm text-ink placeholder:text-dim focus:border-gold/60 focus:outline-none"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 text-dim hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <kbd className="absolute top-1/2 right-2 -translate-y-1/2 border border-line px-1.5 font-mono text-[10px] text-dim">
                /
              </kbd>
            )}
          </label>
          <button
            type="button"
            onClick={() => setSortMode(sortMode === "ai" ? "az" : "ai")}
            title={sortMode === "ai" ? "เรียงตามคำแนะนำ AI และเลนที่ขาด" : "เรียงตามชื่อ"}
            className="flex h-9 shrink-0 items-center gap-1.5 border border-line-strong px-2.5 font-display text-[11px] font-semibold tracking-wide text-ink transition-colors hover:border-gold/60 hover:text-gold"
          >
            {sortMode === "ai" ? <Sparkles className="h-3.5 w-3.5 text-gold" /> : <ArrowDownAZ className="h-3.5 w-3.5" />}
            {sortMode === "ai" ? "AI" : "A–Z"}
          </button>
          <span className="hidden font-mono text-xs text-dim sm:inline">
            {filtered.length}/{heroes.length}
          </span>
        </div>

        <div className="flex gap-1.5 overflow-x-auto">
          <button type="button" className={chip(role === null)} onClick={() => setRole(null)}>
            ALL
          </button>
          {ROLES.map((r) => (
            <button key={r} type="button" className={chip(role === r)} onClick={() => setRole(role === r ? null : r)}>
              {r.toUpperCase()}
            </button>
          ))}
          <div className="mx-1 w-px shrink-0 bg-line" />
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

      {/* Grid */}
      <div className="max-h-[600px] overflow-y-auto">
        <div className="grid grid-cols-4 gap-1.5 p-3 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-8">
        {isHeroesLoading &&
          Array.from({ length: 18 }).map((_, i) => <div key={i} className="aspect-square animate-pulse bg-panel-2" />)}
        {!isHeroesLoading && filtered.length === 0 && (
          <div className="col-span-full py-10 text-center text-sm text-muted">ไม่พบฮีโร่ที่ตรงกับตัวกรอง</div>
        )}
        {filtered.map((hero) => {
          const taken = unavailableHeroes.has(hero.name);
          const rank = recommendedRanks.get(hero.name);
          const fillsLane = !taken && missing.has(laneKey(hero.lane));
          const disabled = taken || !currentStep;
          return (
            <button
              key={hero.name}
              type="button"
              disabled={disabled}
              onClick={() => onLockHero(hero.name)}
              title={`${displayName(hero.name)} · ${hero.role} · ${laneKey(hero.lane)} · Tier ${hero.tier}`}
              className={`group relative aspect-square overflow-hidden border text-left transition-all ${
                taken
                  ? "border-line opacity-25 grayscale"
                  : rank
                    ? "border-gold/70 ring-1 ring-gold/40 hover:border-gold"
                    : fillsLane
                      ? "border-good/40 hover:border-good"
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

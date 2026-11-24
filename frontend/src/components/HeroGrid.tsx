import { useLanguage } from "../i18n/language";
import { Search, X } from "lucide-react";
import { forwardRef, memo, type ReactNode, useMemo, useState } from "react";
import type { DraftStep, Hero, LaneKey } from "../types/draft";
import { LANE_SHORT, TIER_STYLE, heroLanes, laneKey, missingLaneKeys } from "../utils/draft";
import { displayName, matchesHeroQuery } from "../utils/heroNames";
import { HeroPortrait } from "./HeroPortrait";
import { LaneIcon } from "./LaneIcon";

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
  allyPoolHeroLanes?: Map<string, Set<LaneKey>>;
  currentStep: DraftStep | null;
  allowLock?: boolean;
  isLoading?: boolean;
  isHeroesLoading: boolean;
  compactFiltersOnShortScreens?: boolean;
  replacingHero?: string | null;
  replaceHeader?: ReactNode;
  laneResetKey?: number;
  onLockHero: (name: string) => void | boolean;
}

const LANE_KEYS = Object.keys(LANE_SHORT);
const HERO_COLLATOR = new Intl.Collator(undefined, { sensitivity: "base" });

export const HeroGrid = memo(
  forwardRef<HTMLInputElement, HeroGridProps>(function HeroGrid(
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
    allyPoolHeroLanes,
    currentStep,
    allowLock = true,
    isLoading = false,
    isHeroesLoading,
    compactFiltersOnShortScreens = false,
    replacingHero = null,
    replaceHeader = null,
    laneResetKey = 0,
    onLockHero,
  },
  searchRef,
) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [laneState, setLaneState] = useState<{ key: number; value: string | null }>({
    key: laneResetKey,
    value: null,
  });
  const lane = laneState.key === laneResetKey ? laneState.value : null;
  const setLane = (value: string | null) => setLaneState({ key: laneResetKey, value });

  const lockHeroAndResetLane = (heroName: string, clearQuery = false) => {
    if (onLockHero(heroName) === false) return false;
    if (clearQuery) setQuery("");
    setLane(null);
    return true;
  };

  const isBan = currentStep?.action === "ban";
  const isBlueTurn = currentStep?.side !== "red";
  const blueUsedSet = useMemo(() => new Set(blueUsedHeroes), [blueUsedHeroes]);
  const redUsedSet = useMemo(() => new Set(redUsedHeroes), [redUsedHeroes]);
  const univBanSet = useMemo(() => new Set(universalBans), [universalBans]);

  const missing = useMemo(() => {
    const keys = isBan ? new Set<string>() : missingLaneKeys(missingAllyLanes);
    return keys.size >= 5 ? new Set<string>() : keys;
  }, [isBan, missingAllyLanes]);

  const heroPrimaryLane = (h: Hero) =>
    laneKey(h.main_pro_lane && h.main_pro_lane !== "Unpicked" ? h.main_pro_lane : h.lane);

  const parsedHeroMeta = useMemo(
    () =>
      new Map(
        heroes.map((h) => [
          h.name,
          {
            primaryLane: laneKey(h.main_pro_lane && h.main_pro_lane !== "Unpicked" ? h.main_pro_lane : h.lane),
            lanes: heroLanes(h.lane),
            label: displayName(h.name),
          },
        ]),
      ),
    [heroes],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Precompute sort keys once per hero instead of splitting lane strings inside .sort()
    const scores = new Map<string, number>();
    const list: Hero[] = [];
    for (const h of heroes) {
      if (q && !matchesHeroQuery(h.name, q)) continue;
      const meta = parsedHeroMeta.get(h.name);
      const poolSet = allyPoolHeroLanes?.get(h.name);
      if (
        lane &&
        !poolSet?.has(lane as LaneKey) &&
        !(meta ? meta.lanes.includes(lane) : heroLanes(h.lane).includes(lane)) &&
        (meta ? meta.primaryLane : heroPrimaryLane(h)) !== lane
      ) {
        continue;
      }
      let score: number;
      if (unavailableHeroes.has(h.name)) {
        score = 3000;
      } else {
        const rank = recommendedRanks.get(h.name);
        if (rank) {
          score = rank;
        } else {
          const fills =
            poolSet && poolSet.size > 0
              ? Array.from(poolSet).some((l) => missing.has(l))
              : (meta ? meta.lanes : heroLanes(h.lane)).some((l) => missing.has(l)) ||
                missing.has(meta ? meta.primaryLane : heroPrimaryLane(h));
          score = fills ? 1000 : 2000;
        }
      }
      scores.set(h.name, score);
      list.push(h);
    }
    return list.sort(
      (a, b) =>
        (scores.get(a.name) ?? 2000) - (scores.get(b.name) ?? 2000) ||
        HERO_COLLATOR.compare(parsedHeroMeta.get(a.name)?.label ?? a.name, parsedHeroMeta.get(b.name)?.label ?? b.name),
    );
  }, [heroes, parsedHeroMeta, query, lane, unavailableHeroes, recommendedRanks, missing, allyPoolHeroLanes]);
  const chip = (active: boolean) =>
    `h-6 shrink-0 border px-2 font-display text-[10px] font-semibold tracking-wide transition-colors sm:h-6.5 sm:px-2.5 sm:text-[11px] ${
      active ? "border-gold/60 bg-gold/10 text-gold" : "border-line text-muted hover:border-line-strong hover:text-ink"
    }`;

  return (
    <section
      className={`flex min-h-0 flex-1 flex-col border bg-panel clip-chamfer transition-shadow ${
        replacingHero
          ? "border-gold ring-2 ring-gold/35 shadow-[0_0_24px_rgba(200,155,60,0.2)]"
          : "border-line"
      }`}
    >
      {replaceHeader}
      {/* Filters */}
      <div className={`flex shrink-0 flex-col gap-1.5 border-b border-line p-2 sm:p-2.5 ${compactFiltersOnShortScreens ? "draft-hero-filters" : ""}`}>
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-dim" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (query) {
                    e.stopPropagation();
                    setQuery("");
                    return;
                  }
                  e.currentTarget.blur();
                }
                if (e.key === "Enter") {
                  e.stopPropagation();
                  if ((!replacingHero && isLoading) || !allowLock) return;
                  const first = filtered.find((h) => !unavailableHeroes.has(h.name));
                  if (first && currentStep) {
                    lockHeroAndResetLane(first.name, true);
                  }
                }
              }}
              placeholder={
                replacingHero
                  ? t("ค้นหาฮีโร่ใหม่แทน {0}…", displayName(replacingHero))
                  : t("ค้นหาฮีโร่…")
              }
              aria-label={t("ค้นหาฮีโร่")}
              className="h-8 w-full border border-line bg-bg pr-7 pl-8 text-xs text-ink placeholder:text-dim focus:border-gold/60 focus:outline-none sm:pr-12 sm:text-sm"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  if (typeof searchRef !== "function") searchRef?.current?.focus();
                }}
                aria-label={t("ล้างคำค้นหา")}
                className="absolute top-1/2 right-0.5 grid size-6 -translate-y-1/2 place-items-center text-dim hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd className="hidden sm:inline-block absolute top-1/2 right-2 -translate-y-1/2 border border-line px-1 font-mono text-[9px] text-dim">
                /
              </kbd>
            )}
          </label>
          <span className="hidden font-mono text-[11px] text-dim sm:inline">
            {filtered.length}/{heroes.length}
          </span>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          <button type="button" className={chip(lane === null)} onClick={() => setLane(null)}>
            ALL
          </button>
          {LANE_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              title={t(LANE_SHORT[k].th)}
              aria-label={t(LANE_SHORT[k].th)}
              className={`${chip(lane === k)} inline-flex items-center gap-1`}
              onClick={() => setLane(lane === k ? null : k)}
            >
              <LaneIcon lane={k} className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
              <span className="hidden sm:inline">{LANE_SHORT[k].en}</span>
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
            <div className="col-span-full py-10 text-center text-sm text-muted">{t("ไม่พบฮีโร่ที่ตรงกับตัวกรอง")}</div>
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
            const meta = parsedHeroMeta.get(hero.name);
            const primaryLane = meta ? meta.primaryLane : heroPrimaryLane(hero);
            const lanesList = meta ? meta.lanes : heroLanes(hero.lane);
            const heroPoolSet = allyPoolHeroLanes?.get(hero.name);
            const fillsLane =
              !taken &&
              (heroPoolSet && heroPoolSet.size > 0
                ? Array.from(heroPoolSet).some((l) => missing.has(l))
                : lanesList.some((l) => missing.has(l)) || missing.has(primaryLane));
            const disabled = taken || !currentStep || !allowLock;
            const isReplacingCurrent = Boolean(replacingHero && hero.name === replacingHero);
            return (
              <button
                key={hero.name}
                type="button"
                disabled={disabled}
                onClick={() => lockHeroAndResetLane(hero.name, true)}
                title={`${displayName(hero.name)} · ${hero.role} · ${primaryLane} · Tier ${hero.tier}${
                  lockedByGlobalBan
                    ? ` · GLOBAL BAN (${inUnivBan ? t("แบนร่วม") : isBan ? t("{0} เคยใช้แล้ว · ไม่ต้องแบน", opponentTeamName) : t("{0} ใช้แล้ว", actingTeamName)})`
                    : canBanToDeny
                      ? t(" · {0} เคยเล่นแล้ว · สามารถแบนตัด {1} ได้", actingTeamName, opponentTeamName)
                      : usedByOpponentOnly
                        ? t(" · {0} ใช้ไปแล้วในเกมก่อน", opponentTeamName)
                        : ""
                }`}
                className={`group relative aspect-square overflow-hidden border text-left transition-all ${
                  isReplacingCurrent
                    ? "border-gold bg-gold/10 ring-1 ring-gold/60 opacity-85"
                    : lockedByGlobalBan
                      ? "border-red/40 opacity-45 grayscale"
                      : taken
                        ? "border-line opacity-25 grayscale"
                        : rank
                          ? "border-gold/70 ring-1 ring-gold/40 hover:border-gold"
                          : fillsLane
                            ? "border-good/40 hover:border-good"
                            : canBanToDeny
                              ? "border-blue/50 hover:border-blue"
                              : replacingHero
                                ? "border-gold/30 hover:border-gold hover:ring-1 hover:ring-gold/50"
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
                    {LANE_SHORT[primaryLane]?.en}
                  </span>
                </div>
                <span
                  className={`absolute top-1 left-1 border px-1 font-mono text-[9px] font-bold ${
                    rank && !taken ? "hidden xl:inline-block" : ""
                  } ${TIER_STYLE[hero.tier] ?? TIER_STYLE.B}`}
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
                    {opponentTeamName.slice(0, 4)} {t("ใช้แล้ว")}
                  </span>
                )}
                {canBanToDeny && !rank && (
                  <span
                    className={`absolute top-1 right-1 max-w-[calc(100%-26px)] truncate px-1 font-mono text-[8px] font-bold ${
                      isBlueTurn ? "bg-blue/85 text-ink" : "bg-red/85 text-ink"
                    }`}
                  >
                    {actingTeamName.slice(0, 4)} {t("เคยเล่น")}
                  </span>
                )}
                {lockedByGlobalBan && (
                  <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 bg-bg/90 py-0.5 text-center border-y border-red/60">
                    <div className="font-mono text-[8px] font-bold tracking-wider text-red">GLOBAL BAN</div>
                    <div className="truncate px-1 font-display text-[8px] text-muted">
                      {inUnivBan
                        ? t("แบนทั้งซีรีส์")
                        : isBan
                          ? t("{0} เคยใช้แล้ว", opponentTeamName)
                          : t("{0} ใช้แล้ว", actingTeamName)}
                    </div>
                  </div>
                )}
                {isReplacingCurrent && (
                  <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 border-y border-gold bg-bg/90 py-0.5 text-center">
                    <div className="font-mono text-[9px] font-bold tracking-wider text-gold">{t("ตัวเดิม")}</div>
                  </div>
                )}
                {!disabled && (
                  <span
                    className={`absolute inset-0 grid place-items-center font-display text-sm font-bold tracking-[0.2em] opacity-0 transition-opacity group-hover:opacity-100 ${
                      replacingHero ? "bg-gold/35 text-ink" : isBan ? "bg-red/30 text-ink" : "bg-blue/20 text-ink"
                    }`}
                  >
                    {replacingHero ? t("เปลี่ยน") : isBan ? "BAN" : "LOCK"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
  }),
);

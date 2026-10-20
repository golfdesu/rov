import { Ban } from "lucide-react";
import type { DraftStep, Hero, HeroRecommendation } from "../types/draft";
import { LANE_SHORT, laneKey } from "../utils/draft";
import { displayName } from "../utils/heroNames";
import { HeroPortrait } from "./HeroPortrait";

interface TeamColumnProps {
  side: "blue" | "red";
  picks: string[];
  bans: string[];
  heroMap: Map<string, Hero>;
  currentStep: DraftStep | null;
  predictedNextPicks?: HeroRecommendation[];
  predictedNextBans?: HeroRecommendation[];
  onLockHero?: (heroName: string) => void;
}

export function TeamColumn({
  side,
  picks,
  bans,
  heroMap,
  currentStep,
  predictedNextPicks = [],
  predictedNextBans = [],
  onLockHero,
}: TeamColumnProps) {
  const isBlue = side === "blue";
  const isMyTurn = currentStep?.side === side;
  const activePickSlot = isMyTurn && currentStep?.action === "pick" ? picks.length : -1;
  const activeBanSlot = isMyTurn && currentStep?.action === "ban" ? bans.length : -1;
  const accent = isBlue ? "text-blue" : "text-red";

  return (
    <section aria-label={`${side} team`} className="flex flex-col gap-2">
      {/* Team header */}
      <div className={`flex items-center justify-between ${isBlue ? "" : "flex-row-reverse"}`}>
        <div className={`flex items-center gap-2 ${isBlue ? "" : "flex-row-reverse"}`}>
          <div className={`h-5 w-1 ${isBlue ? "bg-blue" : "bg-red"}`} />
          <h2 className={`font-display text-sm font-bold tracking-[0.15em] sm:text-lg ${accent}`}>
            {isBlue ? "BLUE SIDE" : "RED SIDE"}
          </h2>
        </div>
        {isMyTurn && (
          <span className="border border-gold/50 bg-gold/10 px-1.5 py-0.5 font-display text-[10px] font-bold tracking-wider text-gold">
            <span className="sm:hidden">NOW</span>
            <span className="hidden sm:inline">ON THE CLOCK</span>
          </span>
        )}
      </div>

      {/* Pick slots */}
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => {
          const name = picks[i];
          const hero = name ? heroMap.get(name) : undefined;
          const isActive = i === activePickSlot;
          const ghostOffset = i - picks.length;
          const ghost = !name && ghostOffset >= 0 && ghostOffset < 2 ? predictedNextPicks[ghostOffset] : undefined;
          const ghostHero = ghost ? heroMap.get(ghost.hero_name) : undefined;
          const canClickGhost = Boolean(ghost && isActive && onLockHero);
          const triggerList = ghost?.triggered_by?.map(displayName) ?? [];
          const triggerFromBans = ghost?.triggered_by?.some((t) => bans.includes(t));

          return (
            <div
              key={i}
              onClick={canClickGhost && ghost ? () => onLockHero?.(ghost.hero_name) : undefined}
              title={
                ghost
                  ? `AI คาดเดาตัวถัดไป #${ghostOffset + 1}: ${displayName(ghost.hero_name)} (${ghost.probability_pct.toFixed(1)}%)${
                      triggerList.length > 0
                        ? ` · อ้างอิงจาก${triggerFromBans ? "การแบน" : "คอมพ์"} ${triggerList.join(", ")}`
                        : ""
                    }`
                  : undefined
              }
              className={`relative h-[46px] overflow-hidden sm:h-[68px] border bg-panel clip-chamfer xl:h-[84px] ${
                isActive
                  ? "border-gold animate-slot-pulse"
                  : ghost
                    ? "border-dashed border-line-strong/80"
                    : "border-line"
              } ${canClickGhost ? "cursor-pointer" : ""}`}
            >
              {name ? (
                <div
                  key={name}
                  className={`absolute inset-0 flex animate-lock-in items-center ${isBlue ? "" : "flex-row-reverse"} ${
                    isBlue
                      ? "bg-gradient-to-r from-blue-deep/50 to-transparent"
                      : "bg-gradient-to-l from-red-deep/50 to-transparent"
                  }`}
                >
                  <div className="aspect-square h-full shrink-0">
                    <HeroPortrait name={name} hero={hero} />
                  </div>
                  <div
                    className={`flex min-w-0 flex-col justify-center px-2 sm:px-3 ${isBlue ? "" : "items-end text-right"}`}
                  >
                    <div className="truncate font-display text-sm font-bold leading-tight tracking-wide sm:text-base xl:text-lg">
                      {displayName(name)}
                    </div>
                    {hero && (
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted sm:text-[11px]">
                        <span className={`font-mono font-bold ${accent}`}>
                          {LANE_SHORT[laneKey(hero.lane)]?.en ?? laneKey(hero.lane)}
                        </span>
                        <span className="hidden text-dim sm:inline">·</span>
                        <span className="hidden sm:inline">{hero.role}</span>
                      </div>
                    )}
                  </div>
                  <div className={`absolute inset-y-0 w-0.5 ${isBlue ? "left-0 bg-blue" : "right-0 bg-red"}`} />
                </div>
              ) : ghost ? (
                <div
                  key={`ghost-${ghost.hero_name}-${ghostOffset}`}
                  className={`absolute inset-0 flex items-center transition-opacity ${
                    isBlue ? "" : "flex-row-reverse"
                  } ${
                    ghostOffset === 0 ? "opacity-50 hover:opacity-85" : "opacity-35 hover:opacity-75"
                  } ${
                    isBlue
                      ? "bg-gradient-to-r from-blue-deep/25 to-transparent"
                      : "bg-gradient-to-l from-red-deep/25 to-transparent"
                  }`}
                >
                  <div className="aspect-square h-full shrink-0">
                    <HeroPortrait name={ghost.hero_name} hero={ghostHero} className="saturate-75" />
                  </div>
                  <div
                    className={`flex min-w-0 flex-1 flex-col justify-center px-2 sm:px-3 ${
                      isBlue ? "" : "items-end text-right"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-1">
                      <span
                        className={`font-mono text-[9px] font-semibold tracking-wider uppercase sm:text-[10px] ${
                          isActive ? "text-gold" : accent
                        }`}
                      >
                        {isActive ? "SELECTING · คาดเดา" : `คาดเดา #${ghostOffset + 1}`} ·{" "}
                        {ghost.probability_pct.toFixed(0)}%
                      </span>
                      {triggerList.length > 0 && (
                        <span className="hidden truncate bg-panel-2 px-1 text-[9px] text-gold xl:inline">
                          {triggerFromBans ? `แบน ${triggerList.join(", ")}` : `คู่ ${triggerList.join(", ")}`}
                        </span>
                      )}
                    </div>
                    <div className="truncate font-display text-sm font-bold leading-tight tracking-wide text-ink/90 sm:text-base xl:text-lg">
                      {displayName(ghost.hero_name)}
                    </div>
                    <div className="mt-0.5 hidden items-center gap-1.5 text-[10px] text-muted sm:flex sm:text-[11px]">
                      <span className={`font-mono font-bold ${accent}`}>
                        {LANE_SHORT[laneKey(ghost.primary_lane)]?.en ?? laneKey(ghost.primary_lane)}
                      </span>
                      <span className="text-dim">·</span>
                      <span>{ghost.primary_role}</span>
                    </div>
                  </div>
                  <div
                    className={`absolute inset-y-0 w-0.5 opacity-50 ${isBlue ? "left-0 bg-blue" : "right-0 bg-red"}`}
                  />
                </div>
              ) : (
                <div
                  className={`flex h-full items-center gap-3 px-3 sm:px-4 ${isBlue ? "" : "flex-row-reverse"} ${
                    isActive ? "bg-gold/5" : ""
                  }`}
                >
                  <span className={`font-mono text-lg font-bold sm:text-2xl ${isActive ? "text-gold" : "text-line-strong"}`}>
                    {i + 1}
                  </span>
                  <span
                    className={`hidden font-display text-xs font-semibold tracking-[0.2em] sm:inline ${isActive ? "text-gold" : "text-dim"}`}
                  >
                    {isActive ? "SELECTING…" : "PICK"}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Ban slots */}
      <div className={`mt-1 flex items-center gap-1 sm:gap-1.5 ${isBlue ? "" : "flex-row-reverse"}`}>
        <Ban className="hidden h-3.5 w-3.5 shrink-0 text-dim sm:block" aria-label="Bans" />
        {Array.from({ length: 4 }).map((_, i) => {
          const name = bans[i];
          const isActive = i === activeBanSlot;
          const ghostBanOffset = i - bans.length;
          const ghostBan =
            !name && ghostBanOffset >= 0 && ghostBanOffset < 2 ? predictedNextBans[ghostBanOffset] : undefined;
          const canClickGhostBan = Boolean(ghostBan && isActive && onLockHero);
          const banTriggers = ghostBan?.triggered_by?.map(displayName) ?? [];

          return (
            <div
              key={i}
              onClick={canClickGhostBan && ghostBan ? () => onLockHero?.(ghostBan.hero_name) : undefined}
              title={
                name
                  ? displayName(name)
                  : ghostBan
                    ? `AI คาดเดาแบน #${ghostBanOffset + 1}: ${displayName(ghostBan.hero_name)} (${ghostBan.probability_pct.toFixed(1)}%)${
                        banTriggers.length > 0 ? ` · ป้องกัน ${banTriggers.join(", ")}` : ""
                      }`
                    : `Ban ${i + 1}`
              }
              className={`relative aspect-square flex-1 overflow-hidden border bg-panel ${
                isActive
                  ? "border-gold animate-slot-pulse"
                  : ghostBan
                    ? "border-dashed border-red/50"
                    : "border-line"
              } ${i === 2 ? (isBlue ? "ml-1" : "mr-1") : ""} ${canClickGhostBan ? "cursor-pointer" : ""}`}
            >
              {name ? (
                <>
                  <HeroPortrait name={name} hero={heroMap.get(name)} className="grayscale opacity-60" />
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,transparent_46%,var(--color-red)_47%,var(--color-red)_53%,transparent_54%)] opacity-80" />
                </>
              ) : ghostBan ? (
                <div
                  className={`relative h-full w-full transition-opacity ${
                    ghostBanOffset === 0 ? "opacity-45 hover:opacity-85" : "opacity-30 hover:opacity-75"
                  }`}
                >
                  <HeroPortrait
                    name={ghostBan.hero_name}
                    hero={heroMap.get(ghostBan.hero_name)}
                    className="saturate-50"
                  />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-bg/85 px-0.5 py-0.5 text-center font-mono text-[8px] font-bold text-red">
                    ? {displayName(ghostBan.hero_name).slice(0, 6)}
                  </div>
                </div>
              ) : (
                <div
                  className={`grid h-full place-items-center font-mono text-[10px] ${isActive ? "text-gold" : "text-dim"}`}
                >
                  B{i + 1}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

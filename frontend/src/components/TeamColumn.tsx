import { Ban, Layers, Plus, X } from "lucide-react";
import type { DraftStep, Hero, HeroRecommendation } from "../types/draft";
import { LANE_SHORT, laneKey } from "../utils/draft";
import { displayName } from "../utils/heroNames";
import { HeroPortrait } from "./HeroPortrait";

interface TeamColumnProps {
  side: "blue" | "red";
  teamName: string;
  picks: string[];
  bans: string[];
  usedHeroes: string[];
  usedHeroOriginGames?: Record<string, number>;
  rawUsedCount: number;
  gameNumber: number;
  heroMap: Map<string, Hero>;
  currentStep: DraftStep | null;
  predictedNextPicks?: HeroRecommendation[];
  predictedNextBans?: HeroRecommendation[];
  onLockHero?: (heroName: string) => void;
  onOpenGlobalBanForTeam: () => void;
  onRemoveUsedHero: (heroName: string) => void;
  variant?: "full" | "compact";
}

export function TeamColumn({
  side,
  teamName,
  picks,
  bans,
  usedHeroes,
  usedHeroOriginGames = {},
  rawUsedCount,
  gameNumber,
  heroMap,
  currentStep,
  predictedNextPicks = [],
  predictedNextBans = [],
  onLockHero,
  onOpenGlobalBanForTeam,
  onRemoveUsedHero,
  variant = "full",
}: TeamColumnProps) {
  const isBlue = side === "blue";
  const isMyTurn = currentStep?.side === side;
  const activePickSlot = isMyTurn && currentStep?.action === "pick" ? picks.length : -1;
  const activeBanSlot = isMyTurn && currentStep?.action === "ban" ? bans.length : -1;
  const accent = isBlue ? "text-blue" : "text-red";

  if (variant === "compact") {
    const renderCompactBanSlots = (extraClass = "") => (
      <div className={`flex items-center gap-1 ${isBlue ? "" : "flex-row-reverse"} ${extraClass}`}>
        {Array.from({ length: 4 }).map((_, i) => {
          const bName = bans[i];
          const isBanActive = i === activeBanSlot;
          const ghostBanOffset = i - bans.length;
          const ghostBan =
            !bName && ghostBanOffset >= 0 && ghostBanOffset < 2 ? predictedNextBans[ghostBanOffset] : undefined;
          const canClickGhostBan = Boolean(ghostBan && isBanActive && onLockHero);
          return (
            <div
              key={i}
              onClick={canClickGhostBan && ghostBan ? () => onLockHero?.(ghostBan.hero_name) : undefined}
              title={
                bName
                  ? `Ban: ${displayName(bName)}`
                  : ghostBan
                    ? `AI คาดเดาแบน: ${displayName(ghostBan.hero_name)}`
                    : `Ban ${i + 1}`
              }
              className={`relative aspect-square h-7.5 w-7.5 shrink-0 overflow-hidden border bg-bg min-[380px]:h-8 min-[380px]:w-8 sm:h-9 sm:w-9 ${
                isBanActive
                  ? "border-gold animate-slot-pulse"
                  : ghostBan
                    ? "border-dashed border-red/50"
                    : "border-line"
              } ${i === 2 ? (isBlue ? "ml-1" : "mr-1") : ""} ${canClickGhostBan ? "cursor-pointer" : ""}`}
            >
              {bName ? (
                <>
                  <HeroPortrait name={bName} hero={heroMap.get(bName)} className="grayscale opacity-65" />
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,transparent_45%,var(--color-red)_46%,var(--color-red)_54%,transparent_55%)] opacity-85" />
                </>
              ) : ghostBan ? (
                <HeroPortrait
                  name={ghostBan.hero_name}
                  hero={heroMap.get(ghostBan.hero_name)}
                  className="opacity-40 saturate-50"
                />
              ) : (
                <span className="grid h-full place-items-center font-mono text-[10px] font-bold text-dim sm:text-xs">
                  B{i + 1}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );

    return (
      <section
        aria-label={`${side} team compact`}
        className={`flex min-w-0 flex-col gap-1.5 overflow-hidden border bg-panel/95 p-1.5 sm:p-2 ${
          isMyTurn ? "border-gold/70" : isBlue ? "border-blue/35" : "border-red/35"
        }`}
      >
        {/* Row 1: Team Name + Active Turn Badge + (iPad Ban Slots) + Global Ban Button */}
        <div className={`flex min-w-0 items-center justify-between gap-1.5 ${isBlue ? "" : "flex-row-reverse"}`}>
          <div className={`flex min-w-0 flex-1 items-center gap-1.5 ${isBlue ? "" : "flex-row-reverse"}`}>
            <div className={`h-4 w-1 shrink-0 ${isBlue ? "bg-blue" : "bg-red"}`} />
            <span className={`truncate font-display text-xs font-bold tracking-wider sm:text-sm ${accent}`}>
              {teamName}
            </span>
            {isMyTurn && (
              <span className="shrink-0 bg-gold px-1.5 py-0.2 font-display text-[10px] font-bold text-bg">
                {currentStep?.action === "ban" ? "BAN" : "PICK"}
              </span>
            )}
          </div>

          <div className={`flex shrink-0 items-center gap-1.5 ${isBlue ? "" : "flex-row-reverse"}`}>
            {/* Tablet/iPad (>=sm): inline 4 square ban slots */}
            {renderCompactBanSlots("hidden sm:flex")}

            <button
              type="button"
              onClick={onOpenGlobalBanForTeam}
              title={`Global Ban ของ ${teamName} (${usedHeroes.length} ตัว)`}
              className={`flex h-7 shrink-0 items-center gap-1 border px-1.5 font-mono text-[10px] font-bold sm:h-9 sm:px-2.5 sm:text-xs ${
                isBlue
                  ? "border-blue/40 bg-blue/10 text-blue hover:bg-blue/20"
                  : "border-red/40 bg-red/10 text-red hover:bg-red/20"
              }`}
            >
              <Layers className="h-3 w-3 shrink-0 sm:h-4 sm:w-4" />
              <span>{gameNumber === 7 ? "ULT" : usedHeroes.length}</span>
            </button>
          </div>
        </div>

        {/* Row 2 (Mobile <sm only): Dedicated 4 Square Ban Slots Row so it never crushes team name */}
        <div className={`flex items-center justify-between gap-1 sm:hidden ${isBlue ? "" : "flex-row-reverse"}`}>
          <span className="font-mono text-[9px] font-bold tracking-wider text-dim">BANS</span>
          {renderCompactBanSlots()}
        </div>

        {/* 5 Horizontal Pick Slots */}
        <div className={`grid grid-cols-5 gap-1 sm:gap-1.5 ${isBlue ? "" : "direction-rtl"}`}>
          {Array.from({ length: 5 }).map((_, idx) => {
            const i = isBlue ? idx : 4 - idx;
            const name = picks[i];
            const hero = name ? heroMap.get(name) : undefined;
            const isActive = i === activePickSlot;
            const ghostOffset = i - picks.length;
            const ghost = !name && ghostOffset >= 0 && ghostOffset < 2 ? predictedNextPicks[ghostOffset] : undefined;
            const ghostHero = ghost ? heroMap.get(ghost.hero_name) : undefined;
            const canClickGhost = Boolean(ghost && isActive && onLockHero);

            return (
              <div
                key={i}
                onClick={canClickGhost && ghost ? () => onLockHero?.(ghost.hero_name) : undefined}
                title={
                  name
                    ? `${displayName(name)} (${hero ? (LANE_SHORT[laneKey(hero.lane)]?.en ?? "") : ""})`
                    : ghost
                      ? `คาดเดา: ${displayName(ghost.hero_name)} (${ghost.probability_pct.toFixed(0)}%)`
                      : `Pick ${i + 1}`
                }
                className={`relative h-12 min-w-0 overflow-hidden border bg-bg sm:h-16 ${
                  isActive
                    ? "border-gold animate-slot-pulse"
                    : ghost
                      ? "border-dashed border-line-strong"
                      : "border-line"
                } ${canClickGhost ? "cursor-pointer" : ""}`}
              >
                {name ? (
                  <>
                    <HeroPortrait name={name} hero={hero} />
                    <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-transparent" />
                    {hero && (
                      <span
                        className={`absolute top-0.5 left-0.5 max-w-[calc(100%-4px)] truncate bg-bg/85 px-0.5 font-mono text-[8px] font-bold sm:px-1 sm:text-[9px] ${accent}`}
                      >
                        {LANE_SHORT[laneKey(hero.lane)]?.en}
                      </span>
                    )}
                    <div className="absolute inset-x-0 bottom-0 truncate px-0.5 pb-0.5 text-center font-display text-[9px] font-bold leading-tight text-ink sm:px-1 sm:text-xs">
                      {displayName(name)}
                    </div>
                  </>
                ) : ghost ? (
                  <div className="relative h-full w-full opacity-50 hover:opacity-85">
                    <HeroPortrait name={ghost.hero_name} hero={ghostHero} className="saturate-50" />
                    <span className="absolute top-0.5 right-0.5 max-w-[calc(100%-4px)] truncate bg-bg/90 px-0.5 font-mono text-[8px] font-bold text-gold sm:text-[9px]">
                      {ghost.probability_pct.toFixed(0)}%
                    </span>
                    <div className="absolute inset-x-0 bottom-0 truncate bg-bg/85 px-0.5 text-center font-display text-[8px] font-bold text-ink sm:text-[9px]">
                      ?{displayName(ghost.hero_name)}
                    </div>
                  </div>
                ) : (
                  <div
                    className={`grid h-full place-items-center font-mono text-[11px] font-bold sm:text-sm ${
                      isActive ? "bg-gold/10 text-gold" : "text-line-strong"
                    }`}
                  >
                    P{i + 1}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <section aria-label={`${side} team`} className="flex h-full min-h-0 min-w-0 flex-col gap-2 overflow-hidden">
      {/* Team header */}
      <div className={`flex shrink-0 items-center justify-between gap-2 ${isBlue ? "" : "flex-row-reverse"}`}>
        <div className={`flex min-w-0 items-center gap-2 ${isBlue ? "" : "flex-row-reverse"}`}>
          <div className={`h-4.5 w-1.5 shrink-0 ${isBlue ? "bg-blue" : "bg-red"}`} />
          <h2 className={`truncate font-display text-xs font-bold tracking-[0.12em] sm:text-base ${accent}`}>
            {isBlue ? "BLUE" : "RED"} · <span className="text-ink">{teamName}</span>
          </h2>
        </div>
        {isMyTurn && (
          <span className="shrink-0 border border-gold/50 bg-gold/10 px-1.5 py-0.5 font-display text-[10px] font-bold tracking-wider text-gold sm:px-2 sm:text-[11px]">
            <span className="sm:hidden">NOW</span>
            <span className="hidden sm:inline">ON THE CLOCK</span>
          </span>
        )}
      </div>

      {/* Pick slots — flex-1 min-h-0 scales smoothly to fit any laptop/desktop screen height */}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
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
          const triggerLabel =
            ghost?.trigger_reason === "counter"
              ? `แก้ทาง ${triggerList.join(", ")}`
              : ghost?.trigger_reason === "combo"
                ? `คู่ ${triggerList.join(", ")}`
                : ghost?.trigger_reason === "protect"
                  ? `ป้องกัน ${triggerList.join(", ")}`
                  : triggerFromBans
                    ? `แบน ${triggerList.join(", ")}`
                    : `คู่ ${triggerList.join(", ")}`;

          return (
            <div
              key={i}
              onClick={canClickGhost && ghost ? () => onLockHero?.(ghost.hero_name) : undefined}
              title={
                ghost
                  ? `AI คาดเดาตัวถัดไป #${ghostOffset + 1}: ${displayName(ghost.hero_name)} (${ghost.probability_pct.toFixed(1)}%)${
                      triggerList.length > 0 ? ` · ${triggerLabel}` : ""
                    }`
                  : undefined
              }
              className={`relative min-h-[52px] flex-1 max-h-[96px] overflow-hidden border bg-panel clip-chamfer ${
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
                    className={`flex min-w-0 flex-1 flex-col justify-center px-2 sm:px-3 ${
                      isBlue ? "" : "items-end text-right"
                    }`}
                  >
                    <div className="max-w-full truncate font-display text-xs font-bold leading-tight tracking-wide sm:text-base xl:text-lg">
                      {displayName(name)}
                    </div>
                    {hero && (
                      <div className="mt-0.5 flex max-w-full items-center gap-1.5 truncate text-[10px] text-muted sm:text-[11px]">
                        <span className={`font-mono font-bold ${accent}`}>
                          {LANE_SHORT[laneKey(hero.lane)]?.en ?? laneKey(hero.lane)}
                        </span>
                        <span className="hidden text-dim sm:inline">·</span>
                        <span className="hidden truncate sm:inline">{hero.role}</span>
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
                    <div className="flex max-w-full items-center gap-1">
                      <span
                        className={`truncate font-mono text-[9px] font-semibold tracking-wider uppercase sm:text-[10px] ${
                          isActive ? "text-gold" : accent
                        }`}
                      >
                        {isActive ? "คาดเดา" : `#${ghostOffset + 1}`} · {ghost.probability_pct.toFixed(0)}%
                      </span>
                      {triggerList.length > 0 && (
                        <span
                          className={`hidden max-w-full truncate px-1 text-[9px] xl:inline ${
                            ghost.trigger_reason === "counter"
                              ? "border border-red/40 bg-red/10 text-red"
                              : ghost.trigger_reason === "combo"
                                ? "border border-blue/40 bg-blue/10 text-blue"
                                : "bg-panel-2 text-gold"
                          }`}
                        >
                          {triggerLabel}
                        </span>
                      )}
                    </div>
                    <div className="max-w-full truncate font-display text-xs font-bold leading-tight tracking-wide text-ink/90 sm:text-base xl:text-lg">
                      {displayName(ghost.hero_name)}
                    </div>
                    <div className="hidden max-w-full items-center gap-1.5 truncate text-[11px] text-muted sm:flex">
                      <span className={`font-mono font-bold ${accent}`}>
                        {LANE_SHORT[laneKey(ghost.primary_lane)]?.en ?? laneKey(ghost.primary_lane)}
                      </span>
                      <span className="text-dim">·</span>
                      <span className="truncate">{ghost.primary_role}</span>
                    </div>
                  </div>
                  <div
                    className={`absolute inset-y-0 w-0.5 opacity-50 ${isBlue ? "left-0 bg-blue" : "right-0 bg-red"}`}
                  />
                </div>
              ) : (
                <div
                  className={`flex h-full items-center gap-2.5 px-2.5 sm:gap-3 sm:px-3.5 ${
                    isBlue ? "" : "flex-row-reverse"
                  } ${isActive ? "bg-gold/5" : ""}`}
                >
                  <span
                    className={`font-mono text-base font-bold sm:text-2xl ${isActive ? "text-gold" : "text-line-strong"}`}
                  >
                    {i + 1}
                  </span>
                  <span
                    className={`truncate font-display text-[11px] font-semibold tracking-[0.18em] sm:text-xs ${
                      isActive ? "text-gold" : "text-dim"
                    }`}
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
      <div className={`flex shrink-0 items-center gap-1 sm:gap-1.5 ${isBlue ? "" : "flex-row-reverse"}`}>
        <Ban className="hidden h-4 w-4 shrink-0 text-dim sm:block" aria-label="Bans" />
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
              className={`relative aspect-square h-8.5 shrink-0 overflow-hidden border bg-panel sm:h-11 lg:h-11 xl:h-12 2xl:h-13 ${
                isActive
                  ? "border-gold animate-slot-pulse"
                  : ghostBan
                    ? "border-dashed border-red/50"
                    : "border-line"
              } ${i === 2 ? (isBlue ? "ml-1 sm:ml-2" : "mr-1 sm:mr-2") : ""} ${canClickGhostBan ? "cursor-pointer" : ""}`}
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
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-bg/85 px-0.5 py-0.5 text-center font-mono text-[8px] font-bold text-red sm:text-[9px]">
                    ?{displayName(ghostBan.hero_name)}
                  </div>
                </div>
              ) : (
                <div
                  className={`grid h-full place-items-center font-mono text-[10px] font-bold sm:text-xs ${
                    isActive ? "text-gold" : "text-dim"
                  }`}
                >
                  B{i + 1}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* On-Board Global Ban (Used Heroes by this Team) */}
      <div
        className={`flex shrink-0 flex-col overflow-hidden border bg-panel/90 p-1.5 sm:p-2 ${
          isBlue ? "border-blue/35" : "border-red/35"
        }`}
      >
        <div className="mb-1.5 flex min-w-0 items-center justify-between gap-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1 sm:gap-1.5">
            <Layers className={`h-3.5 w-3.5 shrink-0 ${accent}`} />
            <span className="truncate font-display text-[10px] font-bold tracking-wide text-ink sm:text-[11px]">
              GLOBAL BAN · {teamName}
            </span>
            <span
              className={`shrink-0 px-1 py-0.2 font-mono text-[9px] font-bold sm:px-1.5 sm:text-[10px] ${
                usedHeroes.length > 0
                  ? isBlue
                    ? "bg-blue/20 text-blue"
                    : "bg-red/20 text-red"
                  : "bg-panel-2 text-dim"
              }`}
            >
              {usedHeroes.length}
            </span>
          </div>

          <button
            type="button"
            onClick={onOpenGlobalBanForTeam}
            className={`flex shrink-0 items-center gap-1 border px-1.5 py-0.5 font-display text-[10px] font-bold tracking-wide transition-colors sm:px-2 ${
              isBlue
                ? "border-blue/50 bg-blue/10 text-blue hover:bg-blue hover:text-ink"
                : "border-red/50 bg-red/10 text-red hover:bg-red hover:text-ink"
            }`}
          >
            <Plus className="h-3 w-3 shrink-0" />
            <span className="hidden sm:inline">เลือกตัวที่เคยใช้</span>
            <span className="sm:hidden">เลือก</span>
          </button>
        </div>

        {gameNumber === 7 ? (
          <div className="truncate border border-gold/40 bg-gold/10 px-2 py-1 text-center font-display text-[10px] font-semibold text-gold sm:text-[11px]">
            GAME 7 ULTIMATE BATTLE · ปลดล็อก ({rawUsedCount})
          </div>
        ) : usedHeroes.length === 0 ? (
          <button
            type="button"
            onClick={onOpenGlobalBanForTeam}
            className="flex w-full min-w-0 items-center justify-center gap-1 border border-dashed border-line px-1.5 py-1.5 text-[10px] text-dim transition-colors hover:border-line-strong hover:bg-panel-2/50 hover:text-ink sm:text-[11px]"
          >
            <Plus className="h-3 w-3 shrink-0" />
            <span className="truncate">เลือกฮีโร่ที่ {teamName} ใช้แล้ว</span>
          </button>
        ) : (
          <div className="flex max-h-[76px] flex-wrap gap-1 overflow-y-auto pr-0.5">
            {usedHeroes.map((name) => {
              const hero = heroMap.get(name);
              const originGame = usedHeroOriginGames[name];
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => onRemoveUsedHero(name)}
                  title={`${displayName(name)} (${teamName} ใช้แล้ว${originGame ? `ใน Game ${originGame}` : ""} — คลิกเพื่อนำออก)`}
                  className="group flex max-w-full items-center gap-1 border border-line-strong bg-bg py-0.5 pr-1.5 pl-0.5 text-[10px] text-muted transition-colors hover:border-red/60 hover:bg-red/10 hover:text-ink sm:text-[11px]"
                >
                  <div className="h-4.5 w-4.5 shrink-0 overflow-hidden sm:h-5 sm:w-5">
                    <HeroPortrait name={name} hero={hero} className="grayscale group-hover:grayscale-0" />
                  </div>
                  <span className="max-w-[56px] truncate font-medium sm:max-w-[68px]">{displayName(name)}</span>
                  {originGame !== undefined && (
                    <span className="shrink-0 font-mono text-[9px] font-bold text-gold/80">G{originGame}</span>
                  )}
                  <X className="h-2.5 w-2.5 shrink-0 text-dim group-hover:text-red" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

import { Ban } from "lucide-react";
import type { DraftStep, Hero } from "../types/draft";
import { LANE_SHORT, laneKey } from "../utils/draft";
import { displayName } from "../utils/heroNames";
import { HeroPortrait } from "./HeroPortrait";

interface TeamColumnProps {
  side: "blue" | "red";
  picks: string[];
  bans: string[];
  heroMap: Map<string, Hero>;
  currentStep: DraftStep | null;
}

export function TeamColumn({ side, picks, bans, heroMap, currentStep }: TeamColumnProps) {
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
          return (
            <div
              key={i}
              className={`relative h-[46px] overflow-hidden sm:h-[68px] border bg-panel clip-chamfer xl:h-[84px] ${
                isActive ? "border-gold animate-slot-pulse" : "border-line"
              }`}
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
          return (
            <div
              key={i}
              title={name ? displayName(name) : `Ban ${i + 1}`}
              className={`relative aspect-square flex-1 overflow-hidden border bg-panel ${
                isActive ? "border-gold animate-slot-pulse" : "border-line"
              } ${i === 2 ? (isBlue ? "ml-1" : "mr-1") : ""}`}
            >
              {name ? (
                <>
                  <HeroPortrait name={name} hero={heroMap.get(name)} className="grayscale opacity-60" />
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,transparent_46%,var(--color-red)_47%,var(--color-red)_53%,transparent_54%)] opacity-80" />
                </>
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

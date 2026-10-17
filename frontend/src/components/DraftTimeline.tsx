import { CANONICAL_DRAFT_STEPS, type Hero } from "../types/draft";
import { displayName } from "../utils/heroNames";
import { HeroPortrait } from "./HeroPortrait";

interface DraftTimelineProps {
  stepHeroes: (string | null)[];
  currentStepIndex: number;
  heroMap: Map<string, Hero>;
}

export function DraftTimeline({ stepHeroes, currentStepIndex, heroMap }: DraftTimelineProps) {
  return (
    <div className="flex items-stretch gap-1 overflow-x-auto pb-1 xl:justify-center">
      {CANONICAL_DRAFT_STEPS.map((step, i) => {
        const hero = stepHeroes[i];
        const isCurrent = i === currentStepIndex;
        const isBan = step.action === "ban";
        const sideColor = step.side === "blue" ? "bg-blue" : "bg-red";
        const phaseBreak = i === 10;

        return (
          <div key={step.step} className={`flex items-stretch ${phaseBreak ? "ml-2 border-l border-line pl-3" : ""}`}>
            <div
              title={hero ? `${step.label}: ${displayName(hero)}` : step.label}
              className={`relative flex w-11 shrink-0 flex-col overflow-hidden border bg-panel transition-colors sm:w-12 ${
                isCurrent ? "border-gold animate-slot-pulse" : "border-line"
              }`}
            >
              <div className={`h-0.5 ${sideColor} ${hero || isCurrent ? "" : "opacity-30"}`} />
              <div className="relative aspect-square">
                {hero ? (
                  <HeroPortrait
                    name={hero}
                    hero={heroMap.get(hero)}
                    className={isBan ? "grayscale opacity-50" : ""}
                  />
                ) : (
                  <div className="grid h-full place-items-center font-mono text-[10px] text-dim">{i + 1}</div>
                )}
                {hero && isBan && (
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,transparent_46%,var(--color-red)_47%,var(--color-red)_53%,transparent_54%)] opacity-80" />
                )}
              </div>
              <div
                className={`py-0.5 text-center font-display text-[9px] font-bold tracking-wider ${
                  isCurrent ? "text-gold" : isBan ? "text-dim" : "text-muted"
                }`}
              >
                {isBan ? "BAN" : "PICK"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

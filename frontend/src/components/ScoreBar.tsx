import { BrainCircuit, Globe, RotateCcw, Undo2 } from "lucide-react";
import type { DraftStep, LeagueCode } from "../types/draft";

const LEAGUE_OPTIONS: { code: LeagueCode; label: string; title: string }[] = [
  {
    code: "GLOBAL",
    label: "GLOBAL",
    title: "Global Meta Blend (RPL 37.9% + GCS 37.0% + AOG 19.6% + INTL 5.5%)",
  },
  {
    code: "RPL",
    label: "RPL",
    title: "RPL — RoV Pro League (Thailand Meta)",
  },
  {
    code: "GCS",
    label: "GCS",
    title: "GCS — Garena Challenger Series (Taiwan Meta)",
  },
  {
    code: "AOG",
    label: "AOG",
    title: "AOG — Arena of Glory (Vietnam Meta)",
  },
  {
    code: "INTL",
    label: "INTL",
    title: "INTL — APL / AIC International Tournament Meta",
  },
];

interface ScoreBarProps {
  blueWinRate: number;
  isLoading: boolean;
  currentStep: DraftStep | null;
  currentStepIndex: number;
  totalSteps: number;
  useLookahead: boolean;
  setUseLookahead: (v: boolean) => void;
  league?: LeagueCode;
  setLeague?: (v: LeagueCode) => void;
  onUndo: () => void;
  onReset: () => void;
  canUndo: boolean;
}

export function ScoreBar({
  blueWinRate,
  isLoading,
  currentStep,
  currentStepIndex,
  totalSteps,
  useLookahead,
  setUseLookahead,
  league,
  setLeague,
  onUndo,
  onReset,
  canUndo,
}: ScoreBarProps) {
  const blue = Math.min(Math.max(blueWinRate, 0), 100);
  const red = 100 - blue;
  const blueAhead = blue >= 50;

  return (
    <header className="shrink-0 border-b border-line bg-bg/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-2 px-2.5 py-1.5 sm:gap-4 sm:px-4 sm:py-2">
        {/* Turn indicator */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
          <div className="hidden h-8 w-8 place-items-center bg-panel-2 clip-chamfer-sm sm:grid">
            <span className="font-display text-sm font-bold text-gold">R</span>
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-[9.5px] font-semibold text-dim sm:text-xs">
              STEP {Math.min(currentStepIndex + 1, totalSteps)}/{totalSteps}
            </span>
            {currentStep ? (
              <span
                className={`font-display text-xs font-bold tracking-wide sm:text-base ${
                  currentStep.side === "blue" ? "text-blue" : "text-red"
                }`}
              >
                {currentStep.side.toUpperCase()} {currentStep.action === "ban" ? "BAN" : "PICK"}
              </span>
            ) : (
              <span className="font-display text-xs font-bold tracking-wide text-gold sm:text-base">COMPLETE</span>
            )}
          </div>
        </div>

        {/* Win probability bar */}
        <div className="flex min-w-0 max-w-2xl flex-1 items-center gap-1.5 sm:gap-2.5">
          <div className="shrink-0 text-right leading-none">
            <span className="mr-1.5 hidden font-display text-[10px] font-semibold tracking-widest text-blue sm:inline">
              BLUE
            </span>
            <span
              className={`font-mono text-sm font-bold tabular-nums sm:text-xl md:text-2xl ${
                blueAhead ? "text-blue" : "text-muted"
              }`}
            >
              {blue.toFixed(1)}
              <span className="text-[10px] text-dim sm:text-xs">%</span>
            </span>
          </div>

          <div className="relative h-2.5 min-w-[48px] flex-1 overflow-hidden bg-panel-2 sm:h-3">
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-deep to-blue transition-[width] duration-700 ease-out"
              style={{ width: `${blue}%` }}
            />
            <div
              className="absolute inset-y-0 right-0 bg-gradient-to-l from-red-deep to-red transition-[width] duration-700 ease-out"
              style={{ width: `${red}%` }}
            />
            <div className="absolute inset-y-[-2px] left-1/2 w-px bg-ink/40" />
            {isLoading && <div className="absolute inset-0 animate-pulse bg-ink/10" />}
          </div>

          <div className="shrink-0 leading-none">
            <span
              className={`font-mono text-sm font-bold tabular-nums sm:text-xl md:text-2xl ${
                !blueAhead ? "text-red" : "text-muted"
              }`}
            >
              {red.toFixed(1)}
              <span className="text-[10px] text-dim sm:text-xs">%</span>
            </span>
            <span className="ml-1.5 hidden font-display text-[10px] font-semibold tracking-widest text-red sm:inline">
              RED
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {league && setLeague && (
            <>
              {/* Desktop segmented league selector */}
              <div
                role="group"
                aria-label="Regional League Meta"
                className="hidden h-8.5 items-center border border-line-strong bg-panel p-0.5 lg:inline-flex"
              >
                <span className="flex items-center gap-1 px-2 font-mono text-[10px] font-semibold tracking-wider text-dim">
                  <Globe className="h-3 w-3 text-gold" />
                  META
                </span>
                {LEAGUE_OPTIONS.map((opt) => {
                  const active = league === opt.code;
                  return (
                    <button
                      key={opt.code}
                      type="button"
                      onClick={() => setLeague(opt.code)}
                      title={opt.title}
                      aria-pressed={active}
                      className={`h-7 px-2 font-mono text-[11px] font-bold tracking-wide transition-colors ${
                        active
                          ? "bg-gold text-bg"
                          : "text-muted hover:bg-panel-2 hover:text-ink"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              {/* Mobile / Tablet compact league dropdown */}
              <label
                title="Select regional pro league meta conditioning"
                className="inline-flex h-7.5 items-center gap-1 border border-gold/50 bg-panel px-1.5 font-mono text-[11px] font-bold text-gold sm:h-8.5 sm:px-2 lg:hidden"
              >
                <Globe className="h-3.5 w-3.5 shrink-0 text-gold" />
                <select
                  aria-label="Regional League Meta"
                  value={league}
                  onChange={(e) => setLeague(e.target.value as LeagueCode)}
                  className="bg-transparent font-mono text-[11px] font-bold text-gold focus:outline-none"
                >
                  {LEAGUE_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code} className="bg-panel text-ink">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <button
            type="button"
            onClick={() => setUseLookahead(!useLookahead)}
            aria-pressed={useLookahead}
            title="Minimax lookahead search (depth 2)"
            className={`flex h-7.5 w-7.5 items-center justify-center gap-1.5 border font-display text-xs font-bold tracking-wide transition-colors sm:h-8.5 sm:w-auto sm:px-3 ${
              useLookahead
                ? "border-gold bg-gold text-bg hover:bg-gold/90"
                : "border-gold/50 bg-gold/10 text-gold hover:bg-gold/20"
            }`}
          >
            <BrainCircuit className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            <span className="hidden md:inline">LOOKAHEAD {useLookahead ? "ON" : "OFF"}</span>
          </button>
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            className="flex h-7.5 w-7.5 items-center justify-center gap-1.5 border border-ink/30 bg-panel-2 font-display text-xs font-bold tracking-wide text-ink transition-colors hover:border-ink hover:bg-line-strong disabled:pointer-events-none disabled:opacity-30 sm:h-8.5 sm:w-auto sm:px-3"
          >
            <Undo2 className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            <span className="hidden xl:inline">UNDO</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("เริ่มดราฟต์ใหม่ทั้งหมด?")) onReset();
            }}
            disabled={!canUndo}
            title="Reset draft"
            aria-label="Reset draft"
            className="flex h-7.5 w-7.5 items-center justify-center gap-1.5 border border-red/50 bg-red/10 font-display text-xs font-bold tracking-wide text-red transition-colors hover:bg-red hover:text-ink disabled:pointer-events-none disabled:opacity-30 sm:h-8.5 sm:w-auto sm:px-3"
          >
            <RotateCcw className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            <span className="hidden xl:inline">RESET</span>
          </button>
        </div>
      </div>
    </header>
  );
}

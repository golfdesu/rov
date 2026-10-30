import { BrainCircuit, RotateCcw, Undo2 } from "lucide-react";
import type { DraftStep } from "../types/draft";

interface ScoreBarProps {
  blueWinRate: number;
  isLoading: boolean;
  currentStep: DraftStep | null;
  currentStepIndex: number;
  totalSteps: number;
  useLookahead: boolean;
  setUseLookahead: (v: boolean) => void;
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

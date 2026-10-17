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
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1680px] items-center gap-3 px-4 py-2.5 sm:gap-6">
        {/* Brand */}
        <div className="hidden shrink-0 items-center gap-2 md:flex">
          <div className="grid h-8 w-8 place-items-center bg-panel-2 clip-chamfer-sm">
            <span className="font-display text-sm font-bold text-gold">R</span>
          </div>
          <div className="leading-tight">
            <div className="font-display text-sm font-bold tracking-wide">RoV DRAFT</div>
            <div className="font-mono text-[10px] text-dim">GNN · TRANSFORMER</div>
          </div>
        </div>

        {/* Win probability */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="text-right">
            <div className="font-display text-[10px] font-semibold tracking-[0.2em] text-blue">BLUE</div>
            <div
              className={`font-mono text-xl font-bold tabular-nums sm:text-2xl ${blueAhead ? "text-ink" : "text-muted"}`}
            >
              {blue.toFixed(1)}
              <span className="text-xs text-dim">%</span>
            </div>
          </div>

          <div className="relative h-2.5 flex-1 overflow-hidden bg-panel-2">
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

          <div>
            <div className="font-display text-[10px] font-semibold tracking-[0.2em] text-red">RED</div>
            <div
              className={`font-mono text-xl font-bold tabular-nums sm:text-2xl ${!blueAhead ? "text-ink" : "text-muted"}`}
            >
              {red.toFixed(1)}
              <span className="text-xs text-dim">%</span>
            </div>
          </div>
        </div>

        {/* Turn indicator */}
        <div className="hidden shrink-0 text-center lg:block">
          <div className="font-mono text-[10px] text-dim">
            STEP {Math.min(currentStepIndex + 1, totalSteps)}/{totalSteps}
          </div>
          {currentStep ? (
            <div
              className={`font-display text-sm font-bold tracking-wide ${currentStep.side === "blue" ? "text-blue" : "text-red"}`}
            >
              {currentStep.side.toUpperCase()} {currentStep.action === "ban" ? "BAN" : "PICK"}
            </div>
          ) : (
            <div className="font-display text-sm font-bold tracking-wide text-gold">DRAFT COMPLETE</div>
          )}
        </div>

        {/* Controls */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setUseLookahead(!useLookahead)}
            aria-pressed={useLookahead}
            title="Minimax lookahead search (depth 2)"
            className={`flex h-8 items-center gap-1.5 border px-2.5 font-display text-xs font-semibold transition-colors ${
              useLookahead
                ? "border-gold/60 bg-gold/10 text-gold"
                : "border-line-strong text-muted hover:border-muted hover:text-ink"
            }`}
          >
            <BrainCircuit className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">LOOKAHEAD</span>
          </button>
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            className="grid h-8 w-8 place-items-center border border-line-strong text-muted transition-colors hover:border-muted hover:text-ink disabled:pointer-events-none disabled:opacity-30"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={!canUndo}
            title="Reset draft"
            aria-label="Reset draft"
            className="grid h-8 w-8 place-items-center border border-line-strong text-muted transition-colors hover:border-red/60 hover:text-red disabled:pointer-events-none disabled:opacity-30"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

import { Cpu, Globe, Redo2, RotateCcw, Undo2 } from "lucide-react";
import { type DraftStep, ENGINE_OPTIONS, type LeagueCode } from "../types/draft";

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
  league?: LeagueCode;
  setLeague?: (v: LeagueCode) => void;
  onUndo: () => void;
  onRedo?: () => void;
  onReset: () => void;
  canUndo: boolean;
  canRedo?: boolean;
  engine?: "sota" | "heuristic" | "matrix";
  setEngine?: (engine: "sota" | "heuristic" | "matrix") => void;
  modelBadge?: string;
  modelVariant?: "sota" | "heuristic" | "matrix";
  modelTooltip?: string;
}

export function ScoreBar({
  blueWinRate,
  isLoading,
  currentStep,
  currentStepIndex,
  totalSteps,
  league,
  setLeague,
  onUndo,
  onRedo,
  onReset,
  canUndo,
  canRedo = false,
  engine,
  setEngine,
  modelBadge,
  modelVariant = "sota",
  modelTooltip,
}: ScoreBarProps) {
  const safeBlue = Number.isFinite(blueWinRate) ? blueWinRate : 50.0;
  const blue = Math.min(Math.max(safeBlue, 0), 100);
  const red = 100 - blue;
  const blueAhead = blue >= 50;

  const winBarComponent = (
    <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2.5">
      <div className="shrink-0 text-right leading-none">
        <span className="mr-1.5 hidden font-display text-[10px] font-semibold tracking-widest text-blue sm:inline">
          BLUE
        </span>
        <span
          className={`font-mono text-sm font-bold tabular-nums sm:text-lg lg:text-xl xl:text-2xl ${
            blueAhead ? "text-blue" : "text-muted"
          }`}
        >
          {blue.toFixed(1)}
          <span className="text-[10px] text-dim sm:text-xs">%</span>
        </span>
      </div>

      <div className="relative h-2.5 min-w-[56px] flex-1 overflow-hidden bg-panel-2 sm:h-3">
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
          className={`font-mono text-sm font-bold tabular-nums sm:text-lg lg:text-xl xl:text-2xl ${
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
  );

  return (
    <header className="shrink-0 border-b border-line bg-bg/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-2 px-2.5 py-1.5 sm:gap-4 sm:px-4 sm:py-2">
        {/* Turn indicator */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
          <div className="hidden h-8 w-8 place-items-center bg-panel-2 clip-chamfer-sm sm:grid">
            <span className="font-display text-sm font-bold text-gold">R</span>
          </div>
          <div className="flex flex-col leading-tight">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[9.5px] font-semibold text-dim sm:text-xs">
                STEP {Math.min(currentStepIndex + 1, totalSteps)}/{totalSteps}
              </span>
              {engine ? (
                <span
                  title={ENGINE_OPTIONS.find((o) => o.id === engine)?.description}
                  className={`px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider uppercase ${
                    engine === "sota"
                      ? "border border-gold/60 bg-gold/15 text-gold"
                      : engine === "heuristic"
                        ? "border border-amber-500/60 bg-amber-500/15 text-amber-400"
                        : "border border-cyan-500/60 bg-cyan-500/15 text-cyan-400"
                  }`}
                >
                  {ENGINE_OPTIONS.find((o) => o.id === engine)?.badge}
                </span>
              ) : modelBadge ? (
                <span
                  title={modelTooltip}
                  className={`px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider uppercase ${
                    modelVariant === "heuristic"
                      ? "border border-amber-500/60 bg-amber-500/15 text-amber-400"
                      : "border border-gold/60 bg-gold/15 text-gold"
                  }`}
                >
                  {modelBadge}
                </span>
              ) : null}
            </div>
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

        {/* Win probability bar — Desktop Center (lg+) */}
        <div className="hidden lg:flex min-w-0 max-w-3xl xl:max-w-4xl flex-1 items-center px-4">
          {winBarComponent}
        </div>

        {/* Action Controls */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {/* Interactive AI Model Selector Dropdown */}
          {engine && setEngine && (
            <label
              title={ENGINE_OPTIONS.find((o) => o.id === engine)?.description}
              className={`inline-flex h-7.5 items-center gap-1 sm:gap-1.5 border px-1.5 font-mono text-[10.5px] font-bold sm:h-8.5 sm:px-2.5 sm:text-[11px] transition-colors ${
                engine === "sota"
                  ? "border-gold/60 bg-gold/10 text-gold"
                  : engine === "heuristic"
                    ? "border-amber-500/60 bg-amber-500/10 text-amber-400"
                    : "border-cyan-500/60 bg-cyan-500/10 text-cyan-400"
              }`}
            >
              <Cpu className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />
              <span className="hidden font-mono text-[10px] uppercase tracking-wider text-dim 2xl:inline">
                MODEL:
              </span>
              <select
                aria-label="Select Draft AI Model Engine"
                value={engine}
                onChange={(e) => setEngine(e.target.value as "sota" | "heuristic" | "matrix")}
                className="max-w-[76px] sm:max-w-[110px] md:max-w-none bg-transparent font-mono text-[10.5px] sm:text-[11px] font-bold cursor-pointer focus:outline-none"
              >
                {ENGINE_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id} className="bg-panel text-ink py-1">
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {league && setLeague && (
            <label
              title="Select regional pro league meta conditioning"
              className="inline-flex h-7.5 items-center gap-1 border border-line-strong bg-panel px-1.5 font-mono text-[10.5px] font-bold text-gold sm:h-8.5 sm:px-2 sm:text-[11px] transition-colors hover:border-gold/60"
            >
              <Globe className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0 text-gold" />
              <span className="hidden font-mono text-[10px] uppercase tracking-wider text-dim 2xl:inline">
                LEAGUE:
              </span>
              <select
                aria-label="Regional League Meta"
                value={league}
                onChange={(e) => setLeague(e.target.value as LeagueCode)}
                className="bg-transparent font-mono text-[10.5px] sm:text-[11px] font-bold text-gold cursor-pointer focus:outline-none"
              >
                {LEAGUE_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code} className="bg-panel text-ink py-1">
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo ย้อนกลับ (Ctrl+Z)"
            aria-label="Undo"
            className="flex h-7.5 w-7.5 items-center justify-center border border-ink/30 bg-panel-2 font-display text-xs font-bold text-ink transition-colors hover:border-ink hover:bg-line-strong disabled:pointer-events-none disabled:opacity-25 sm:h-8.5 sm:w-8.5"
          >
            <Undo2 className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title="Forward เดินหน้า (Ctrl+Y / Ctrl+Shift+Z)"
            aria-label="Forward"
            className="flex h-7.5 w-7.5 items-center justify-center border border-ink/30 bg-panel-2 font-display text-xs font-bold text-ink transition-colors hover:border-ink hover:bg-line-strong disabled:pointer-events-none disabled:opacity-25 sm:h-8.5 sm:w-8.5"
          >
            <Redo2 className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("เริ่มดราฟต์ใหม่ทั้งหมด?")) onReset();
            }}
            disabled={!canUndo && !canRedo}
            title="Reset draft"
            aria-label="Reset draft"
            className="flex h-7.5 w-7.5 items-center justify-center gap-1.5 border border-red/50 bg-red/10 font-display text-xs font-bold tracking-wide text-red transition-colors hover:bg-red hover:text-ink disabled:pointer-events-none disabled:opacity-25 sm:h-8.5 sm:w-auto sm:px-3"
          >
            <RotateCcw className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            <span className="hidden xl:inline">RESET</span>
          </button>
        </div>
      </div>

      {/* Win probability bar — Dedicated Full-Width Row on Mobile/Tablet (< lg) */}
      <div className="border-t border-line/60 bg-panel/60 px-3 py-1.5 sm:px-4 lg:hidden">
        <div className="mx-auto flex max-w-[1920px] items-center">
          {winBarComponent}
        </div>
      </div>
    </header>
  );
}

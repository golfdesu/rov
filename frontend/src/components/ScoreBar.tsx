import { StableButtonLabel } from "./StableButtonLabel";
import { useLanguage } from "../i18n/language";
import { Globe, Pause, Play, Redo2, RotateCcw, Sparkles, Timer, TimerReset, Undo2, Volume2, VolumeX, X, Zap } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isLocalTestHost, TIMER_PRESETS, type TimerPresetId } from "../hooks/useDraftTimer";
import { type DraftStep, type LeagueCode } from "../types/draft";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";

const LEAGUE_OPTIONS: { code: LeagueCode; label: string; title: string }[] = [
  {
    code: "GLOBAL",
    label: "GLOBAL",
    title: "Global Meta Blend (RPL 32.0% + GCS 30.0% + AOG 20.0% + INTL 18.0%)",
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

export interface DraftTimerControlProps {
  enabled: boolean;
  preset: TimerPresetId;
  soundEnabled: boolean;
  autoLock: boolean;
  paused: boolean;
  secondsLeft: number;
  totalSeconds: number;
  isWarning: boolean;
  isCritical: boolean;
  isExpired: boolean;
  onToggleEnabled: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onTogglePaused: () => void;
  onResetTurn: () => void;
  onSetPreset: (preset: TimerPresetId) => void;
  onToggleSound: () => void;
  onToggleAutoLock: () => void;
}

interface ScoreBarProps {
  blueWinRate: number;
  isLoading: boolean;
  currentStep: DraftStep | null;
  currentStepIndex: number;
  totalSteps: number;
  league?: LeagueCode;
  setLeague?: (v: LeagueCode) => void;
  assistantEnabled?: boolean;
  onToggleAssistant?: () => void;
  timer?: DraftTimerControlProps;
  onUndo: () => void;
  onRedo?: () => void;
  onReset: () => void;
  canUndo: boolean;
  canRedo?: boolean;
}

function formatClock(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ScoreBar({
  blueWinRate,
  isLoading,
  currentStep,
  currentStepIndex,
  totalSteps,
  league,
  setLeague,
  assistantEnabled = true,
  onToggleAssistant,
  timer,
  onUndo,
  onRedo,
  onReset,
  canUndo,
  canRedo = false,
}: ScoreBarProps) {
  const { t } = useLanguage();
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [timerSettingsOpen, setTimerSettingsOpen] = useState(false);
  const timerSettingsTitleId = useId();
  const headerRef = useRef<HTMLElement>(null);
  const restoreTimerFocusRef = useRef(false);

  function closeTimerSettings() {
    restoreTimerFocusRef.current = true;
    setTimerSettingsOpen(false);
  }

  useEffect(() => {
    if (timerSettingsOpen || !restoreTimerFocusRef.current) return;
    restoreTimerFocusRef.current = false;
    if (document.activeElement !== document.body) return;
    // Turning the timer off removes the clock that opened settings.
    const controls = headerRef.current?.querySelectorAll<HTMLButtonElement>("[data-timer-entry]");
    if (!controls) return;
    Array.from(controls).find((control) => control.getClientRects().length > 0)?.focus({ preventScroll: true });
  }, [timerSettingsOpen]);

  const safeBlue = Number.isFinite(blueWinRate) ? blueWinRate : 50.0;
  const blue = Math.min(Math.max(safeBlue, 0), 100);
  const red = 100 - blue;
  const blueAhead = blue >= 50;

  const showCenterTimer = Boolean(timer?.enabled);
  const timerPct =
    timer && timer.totalSeconds > 0
      ? Math.max(0, Math.min(100, (timer.secondsLeft / timer.totalSeconds) * 100))
      : 0;

  const clockTextTone = !currentStep
    ? "text-dim"
    : timer?.isExpired
      ? "text-red animate-pulse drop-shadow-[0_0_8px_rgba(255,77,94,0.65)]"
      : timer?.isCritical
        ? "text-red drop-shadow-[0_0_8px_rgba(255,77,94,0.55)]"
        : timer?.isWarning
          ? "text-gold drop-shadow-[0_0_8px_rgba(245,196,81,0.45)]"
          : "text-ink group-hover:text-gold";

  const progressTone = !currentStep
    ? "bg-dim/30"
    : timer?.isExpired || timer?.isCritical
      ? "bg-red shadow-[0_0_6px_rgba(255,77,94,0.7)]"
      : timer?.isWarning
        ? "bg-gold shadow-[0_0_6px_rgba(245,196,81,0.6)]"
        : currentStep.side === "blue"
          ? "bg-blue shadow-[0_0_6px_rgba(59,158,255,0.6)]"
          : "bg-red shadow-[0_0_6px_rgba(255,77,94,0.6)]";

  const renderTimerControls = (mobileCompact: boolean) => {
    if (!timer) return null;
    const btnH = mobileCompact ? "h-7" : "h-8 sm:h-8.5";
    const iconBtn = mobileCompact ? "h-7 w-7" : "h-8 w-8 sm:h-8.5 sm:w-8.5";

    if (!timer.enabled) {
      return (
        <button
          type="button"
          data-timer-entry
          onClick={() => timer.onSetEnabled(true)}
          title={t("เปิดระบบจับเวลาต่อเทิร์น (Turn Timer)")}
          aria-label={t("เปิดจับเวลาดราฟต์")}
          className={`inline-flex ${btnH} min-w-7 shrink-0 items-center justify-center gap-1 border border-line-strong bg-panel px-2 font-mono text-[10.5px] font-bold text-muted transition-colors hover:border-gold/60 hover:text-gold sm:text-[11px]`}
        >
          <Timer className="h-3.5 w-3.5 shrink-0 text-gold" />
          <span><StableButtonLabel message={mobileCompact ? "เวลา" : "จับเวลา"} alternatives={["เวลา", "จับเวลา"]} /></span>
        </button>
      );
    }

    return (
      <div className="flex shrink-0 items-center gap-1">
        {currentStep && !timer.isExpired && (
          <button
            type="button"
            onClick={timer.onTogglePaused}
            title={timer.paused ? t("นับเวลาต่อ") : t("หยุดเวลาชั่วคราว")}
            aria-label={timer.paused ? t("นับเวลาต่อ") : t("หยุดเวลาชั่วคราว")}
            className={`inline-flex ${iconBtn} shrink-0 items-center justify-center border border-line-strong bg-panel text-ink transition-colors hover:border-gold/60 hover:text-gold`}
          >
            {timer.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </button>
        )}

        {!mobileCompact && currentStep && (
          <button
            type="button"
            onClick={timer.onResetTurn}
            title={t("รีเซ็ตเวลาของเทิร์นนี้ใหม่")}
            aria-label={t("รีเซ็ตเวลาเทิร์น")}
            className={`inline-flex ${iconBtn} shrink-0 items-center justify-center border border-line-strong bg-panel text-muted transition-colors hover:border-gold/60 hover:text-ink`}
          >
            <TimerReset className="h-3.5 w-3.5" />
          </button>
        )}

        <button
          type="button"
          onClick={() => timer.onSetEnabled(false)}
          title={t("ปิดตัวจับเวลา")}
          aria-label={t("ปิดตัวจับเวลา")}
          className={`inline-flex ${iconBtn} shrink-0 items-center justify-center border border-line-strong bg-panel text-dim transition-colors hover:border-red/60 hover:text-red`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  };

  const progressPct = totalSteps > 0 ? Math.min(100, Math.round((currentStepIndex / totalSteps) * 100)) : 0;

  const continuousBar = (compactHeight: boolean) =>
    assistantEnabled ? (
      <div
        className={`relative w-full overflow-hidden bg-panel-2 ${
          compactHeight ? "h-1.5 sm:h-2" : "h-2.5 min-w-[40px] flex-1 sm:h-3 sm:min-w-[56px]"
        }`}
      >
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-deep to-blue transition-[width] duration-700 ease-out"
          style={{ width: `${blue}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-gradient-to-l from-red-deep to-red transition-[width] duration-700 ease-out"
          style={{ width: `${red}%` }}
        />
        {isLoading && <div className="absolute inset-0 animate-pulse bg-ink/10" />}
      </div>
    ) : (
      <div
        role="progressbar"
        aria-label={t("ความคืบหน้าดราฟต์")}
        aria-valuenow={currentStepIndex}
        aria-valuemin={0}
        aria-valuemax={totalSteps}
        title={t("เปิดตัวช่วยเพื่อดูโอกาสชนะระหว่างดราฟต์")}
        className={`relative w-full overflow-hidden bg-panel-2 ${
          compactHeight ? "h-1.5 sm:h-2" : "h-2.5 min-w-[40px] flex-1 sm:h-3 sm:min-w-[56px]"
        }`}
      >
        <div
          className={`h-full transition-[width] duration-300 ease-out ${
            !currentStep ? "bg-gold" : currentStep.side === "blue" ? "bg-blue/80" : "bg-red/80"
          }`}
          style={{ width: `${progressPct}%` }}
        />
      </div>
    );

  const winBarComponent =
    showCenterTimer && timer ? (
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          {/* Left: BLUE % */}
          <div className="justify-self-start leading-none">
            {assistantEnabled ? (
              <>
                <span className="mr-1.5 hidden font-display text-[10px] font-semibold tracking-widest text-blue sm:inline">
                  BLUE
                </span>
                <span
                  className={`font-mono text-sm font-bold tabular-nums sm:text-lg lg:text-xl ${
                    blueAhead ? "text-blue" : "text-muted"
                  }`}
                >
                  {blue.toFixed(1)}
                  <span className="text-[10px] text-dim sm:text-xs">%</span>
                </span>
              </>
            ) : (
              <span className="font-mono text-xs font-bold text-blue">BLUE</span>
            )}
          </div>

          {/* Center: Borderless Turn Countdown + Symmetrical RoV Hairline */}
          <button
            type="button"
            data-timer-entry
            onClick={() => setTimerSettingsOpen(true)}
            title={t("ตั้งค่าเวลาจับดราฟต์ / เสียง / Auto-Lock")}
            aria-label={t("ตั้งค่าตัวจับเวลา")}
            className="group flex min-h-7 min-w-[68px] shrink-0 cursor-pointer flex-col items-center justify-center justify-self-center px-1.5 transition-opacity sm:min-h-8 sm:min-w-[88px] sm:px-2.5"
          >
            <span
              className={`font-mono text-xl font-black leading-none tracking-[0.12em] tabular-nums transition-colors sm:text-[26px] lg:text-[28px] ${clockTextTone}`}
            >
              {currentStep ? formatClock(timer.secondsLeft) : "--:--"}
            </span>
            {currentStep && timer.paused ? (
              <span className="mt-0.5 font-display text-[9px] font-bold leading-none tracking-wider text-gold sm:text-[10px]">
                PAUSE
              </span>
            ) : currentStep && timer.isExpired ? (
              <span className="mt-0.5 font-display text-[9px] font-extrabold leading-none tracking-wide text-red sm:text-[10px]">
                {t("หมดเวลา")}
              </span>
            ) : (
              <span aria-hidden="true" className="mt-1 block h-[2.5px] w-14 overflow-hidden bg-line/45 sm:w-20">
                <span
                  className={`mx-auto block h-full transition-[width] duration-200 ease-linear ${progressTone}`}
                  style={{ width: `${currentStep ? timerPct : 0}%` }}
                />
              </span>
            )}
          </button>

          {/* Right: RED % */}
          <div className="justify-self-end text-right leading-none">
            {assistantEnabled ? (
              <>
                <span
                  className={`font-mono text-sm font-bold tabular-nums sm:text-lg lg:text-xl ${
                    !blueAhead ? "text-red" : "text-muted"
                  }`}
                >
                  {red.toFixed(1)}
                  <span className="text-[10px] text-dim sm:text-xs">%</span>
                </span>
                <span className="ml-1.5 hidden font-display text-[10px] font-semibold tracking-widest text-red sm:inline">
                  RED
                </span>
              </>
            ) : (
              <span className="font-mono text-xs font-bold text-red">RED</span>
            )}
          </div>
        </div>

        {continuousBar(true)}
      </div>
    ) : (
      <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2.5">
        <div className="shrink-0 text-right leading-none">
          {assistantEnabled ? (
            <>
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
            </>
          ) : (
            <span className="font-mono text-xs font-bold text-blue">BLUE</span>
          )}
        </div>

        {continuousBar(false)}

        <div className="shrink-0 leading-none">
          {assistantEnabled ? (
            <>
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
            </>
          ) : (
            <span className="font-mono text-xs font-bold text-red">RED</span>
          )}
        </div>
      </div>
    );

  return (
    <header ref={headerRef} className="shrink-0 border-b border-line bg-bg/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-2 px-2.5 py-1.5 sm:gap-4 sm:px-4 sm:py-2">
        {/* Turn indicator + Desktop/Tablet Timer */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <div className="hidden h-8 w-8 place-items-center bg-panel-2 clip-chamfer-sm sm:grid">
            <span className="font-display text-sm font-bold text-gold">R</span>
          </div>
          <div className="flex flex-col leading-tight">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[9.5px] font-semibold text-dim sm:text-xs">
                STEP {Math.min(currentStepIndex + 1, totalSteps)}/{totalSteps}
              </span>
            </div>
            {currentStep ? (
              <span
                className={`font-display text-xs font-bold tracking-wide sm:text-base ${
                  currentStep.side === "blue" ? "text-blue" : "text-red"
                }`}
              >
                {currentStep.step === -1
                  ? "10-BAN PHASE"
                  : `${currentStep.side.toUpperCase()} ${currentStep.action === "ban" ? "BAN" : "PICK"}`}
              </span>
            ) : (
              <span className="font-display text-xs font-bold tracking-wide text-gold sm:text-base">COMPLETE</span>
            )}
          </div>
          <div className="hidden sm:flex">{renderTimerControls(false)}</div>
        </div>

        {/* Win probability bar — Desktop Center (lg+) */}
        <div className="hidden lg:flex min-w-0 max-w-3xl xl:max-w-4xl flex-1 items-center px-4">
          {winBarComponent}
        </div>

        {/* Action Controls */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {league && setLeague && (
            <label
              title="Select regional pro league meta conditioning"
              className="inline-flex h-8 items-center gap-1 border border-line-strong bg-panel px-1.5 font-mono text-[11px] font-bold text-gold sm:h-8.5 sm:px-2 transition-colors hover:border-gold/60"
            >
              <Globe className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0 text-gold" />
              <span className="hidden font-mono text-[10px] uppercase tracking-wider text-dim 2xl:inline">
                LEAGUE:
              </span>
              <select
                aria-label="Regional League Meta"
                value={league}
                onChange={(e) => setLeague(e.target.value as LeagueCode)}
                className="h-full min-h-6 bg-transparent font-mono text-[11px] font-bold text-gold cursor-pointer focus:outline-none"
              >
                {LEAGUE_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code} className="bg-panel text-ink py-1">
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {onToggleAssistant && (
            <button
              type="button"
              onClick={onToggleAssistant}
              aria-label={t("ตัวช่วย")}
              aria-pressed={assistantEnabled}
              title={t("เปิดตัวช่วยเพื่อดูโอกาสชนะระหว่างดราฟต์")}
              className={`inline-flex h-8 min-w-8 items-center justify-center gap-1 border px-1.5 font-display text-xs font-semibold whitespace-nowrap transition-colors sm:h-8.5 sm:px-2.5 ${
                assistantEnabled
                  ? "border-gold bg-gold/15 text-gold shadow-sm"
                  : "border-line-strong bg-panel text-muted hover:border-gold/50 hover:text-ink"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <StableButtonLabel message="ตัวช่วย" className="hidden sm:inline-grid" />
            </button>
          )}
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title={t("Undo ย้อนกลับ (Ctrl+Z)")}
            aria-label={t("ย้อนกลับ")}
            className="flex h-8 w-8 items-center justify-center border border-ink/30 bg-panel-2 font-display text-xs font-bold text-ink transition-colors hover:border-ink hover:bg-line-strong disabled:pointer-events-none disabled:opacity-35 sm:h-8.5 sm:w-8.5"
          >
            <Undo2 className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title={t("Forward เดินหน้า (Ctrl+Y / Ctrl+Shift+Z)")}
            aria-label={t("ทำซ้ำ")}
            className="flex h-8 w-8 items-center justify-center border border-ink/30 bg-panel-2 font-display text-xs font-bold text-ink transition-colors hover:border-ink hover:bg-line-strong disabled:pointer-events-none disabled:opacity-35 sm:h-8.5 sm:w-8.5"
          >
            <Redo2 className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
          </button>
          <button
            type="button"
            onClick={() => setConfirmResetOpen(true)}
            disabled={!canUndo && !canRedo}
            title="Reset draft"
            aria-label="Reset draft"
            className="flex h-8 w-8 items-center justify-center gap-1.5 border border-red/50 bg-red/10 font-display text-xs font-bold tracking-wide text-red transition-colors hover:bg-red hover:text-ink disabled:pointer-events-none disabled:opacity-35 sm:h-8.5 sm:w-auto sm:px-3"
          >
            <RotateCcw className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            <span className="hidden xl:inline">RESET</span>
          </button>
        </div>
      </div>

      {/* Win probability bar + Mobile Timer Strip — Dedicated Full-Width Row on Mobile/Tablet (< lg) */}
      <div
        className={`border-t border-line/60 bg-panel/60 px-2.5 sm:px-4 lg:hidden ${
          showCenterTimer ? "py-2" : "py-1.5"
        }`}
      >
        <div className="mx-auto flex max-w-[1920px] items-center gap-2">
          {winBarComponent}
          <div className="flex shrink-0 items-center sm:hidden">{renderTimerControls(true)}</div>
        </div>
      </div>

      {timerSettingsOpen &&
        timer &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="relative z-[100]">
            <Modal labelledBy={timerSettingsTitleId} className="max-w-sm border-gold/40" onClose={closeTimerSettings}>
              {(requestClose) => (
                <>
                  <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Timer className="h-4 w-4 text-gold" />
                      <h2 id={timerSettingsTitleId} className="font-display text-sm font-bold tracking-wide text-ink">
                        {t("ตั้งค่าตัวจับเวลาดราฟต์")}
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => requestClose()}
                      aria-label={t("ปิดตั้งค่าเวลา")}
                      className="inline-flex h-7 w-7 items-center justify-center text-dim transition-colors hover:bg-panel-2 hover:text-ink"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="space-y-4 p-4 text-xs">
                    {/* Enable toggle */}
                    <div className="flex items-center justify-between gap-2 border border-line bg-panel-2/60 px-3 py-2.5">
                      <div>
                        <div className="font-display font-bold text-ink">{t("สถานะตัวจับเวลา")}</div>
                        <div className="text-[11px] text-dim">{t("รีเซ็ตเวลานับใหม่ทุกครั้งที่เปลี่ยนเทิร์น")}</div>
                      </div>
                      <button
                        type="button"
                        onClick={timer.onToggleEnabled}
                        className={`min-h-7 border px-3 py-1 font-mono text-[11px] font-bold transition-colors ${
                          timer.enabled
                            ? "border-good/60 bg-good/15 text-good"
                            : "border-line-strong bg-panel text-muted hover:text-ink"
                        }`}
                      >
                        <StableButtonLabel message={timer.enabled ? "เปิดอยู่" : "ปิดอยู่"} alternatives={["เปิดอยู่", "ปิดอยู่"]} />
                      </button>
                    </div>

                    {/* Preset selection */}
                    <div className="space-y-1.5">
                      <div className="font-display text-[11px] font-bold uppercase tracking-wider text-muted">
                        {t("เวลาต่อเทิร์น")}
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {TIMER_PRESETS.filter((p) => !p.devOnly || isLocalTestHost()).map((p) => {
                          const active = timer.preset === p.id;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => timer.onSetPreset(p.id)}
                              className={`flex min-h-9 flex-col items-start justify-center border px-2.5 py-1.5 text-left transition-colors ${
                                p.devOnly ? "col-span-2 border-dashed" : ""
                              } ${
                                active
                                  ? "border-gold bg-gold/15 text-gold"
                                  : "border-line bg-bg/60 text-muted hover:border-line-strong hover:text-ink"
                              }`}
                            >
                              <span className="font-mono text-[11px] font-bold"><StableButtonLabel message={p.label} /></span>
                              <span className="text-[10px] text-dim"><StableButtonLabel message={p.description} /></span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Sound + Auto-lock toggles */}
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={timer.onToggleSound}
                        className="flex min-h-9 w-full items-center justify-between gap-2 border border-line bg-bg/60 px-3 py-2 text-left transition-colors hover:border-line-strong"
                      >
                        <span className="flex items-center gap-2 font-display font-semibold text-ink">
                          {timer.soundEnabled ? (
                            <Volume2 className="h-4 w-4 text-gold" />
                          ) : (
                            <VolumeX className="h-4 w-4 text-dim" />
                          )}
                          <StableButtonLabel message="เสียงเตือน 5 วินาทีสุดท้าย & หมดเวลา" />
                        </span>
                        <span
                          className={`border px-2 py-0.5 font-mono text-[10px] font-bold ${
                            timer.soundEnabled
                              ? "border-gold/50 bg-gold/15 text-gold"
                              : "border-line bg-panel text-dim"
                          }`}
                        >
                          {timer.soundEnabled ? "ON" : "OFF"}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={timer.onToggleAutoLock}
                        className="flex min-h-9 w-full items-center justify-between gap-2 border border-line bg-bg/60 px-3 py-2 text-left transition-colors hover:border-line-strong"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-display font-semibold text-ink">
                            <Zap className="h-4 w-4 shrink-0 text-gold" />
                            <span><StableButtonLabel message="Auto-Lock AI #1 เมื่อหมดเวลา" /></span>
                          </div>
                          <div className="text-[10px] text-dim">
                            <StableButtonLabel message="หากเปิด เมื่อนับถึง 0:00 จะเลือกฮีโร่แนะนำอันดับ 1 ให้อัตโนมัติ" />
                          </div>
                        </div>
                        <span
                          className={`shrink-0 border px-2 py-0.5 font-mono text-[10px] font-bold ${
                            timer.autoLock
                              ? "border-red/60 bg-red/15 text-red"
                              : "border-line bg-panel text-dim"
                          }`}
                        >
                          {timer.autoLock ? "ON" : "OFF"}
                        </span>
                      </button>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line bg-panel-2/40 px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        timer.onResetTurn();
                        requestClose();
                      }}
                      className="inline-flex min-h-7 items-center gap-1 border border-line-strong bg-panel px-3 py-1 font-display text-xs font-semibold text-muted transition-colors hover:text-ink"
                    >
                      <TimerReset className="h-3.5 w-3.5" />
                      <span><StableButtonLabel message="รีเซ็ตเวลาเทิร์น" /></span>
                    </button>
                    <button
                      type="button"
                      onClick={() => requestClose()}
                      className="min-h-7 border border-gold bg-gold px-4 py-1 font-display text-xs font-bold text-bg transition-colors hover:bg-gold/90"
                    >
                      <StableButtonLabel message="เสร็จสิ้น" />
                    </button>
                  </div>
                </>
              )}
            </Modal>
          </div>,
          document.body,
        )}

      {confirmResetOpen && (
        <ConfirmDialog
          title={t("เริ่มดราฟต์ใหม่ทั้งหมด?")}
          message={t("การรีเซ็ตจะล้างรายชื่อฮีโร่ที่แบนและเลือกไว้ในกระดานปัจจุบันทั้งหมด (ประวัติซีรีส์และ Global Ban ยังอยู่)")}
          confirmLabel="รีเซ็ตกระดาน"
          cancelLabel="ยกเลิก"
          tone="danger"
          onConfirm={() => {
            setConfirmResetOpen(false);
            onReset();
          }}
          onCancel={() => setConfirmResetOpen(false)}
        />
      )}
    </header>
  );
}

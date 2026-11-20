import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CANONICAL_DRAFT_STEPS, type DraftStep } from "../types/draft";

/** Groups consecutive steps of the same side/action/phase (e.g., Red Pick 1-2, Blue Pick 2-3, Blue Pick 4-5) so double-pick turns share one clock. */
export function getTurnGroupStartStep(stepIndex: number): number {
  const step = CANONICAL_DRAFT_STEPS[stepIndex];
  if (!step) return stepIndex;
  let start = stepIndex;
  while (start > 0) {
    const prev = CANONICAL_DRAFT_STEPS[start - 1];
    if (!prev || prev.side !== step.side || prev.action !== step.action || prev.phase !== step.phase) {
      break;
    }
    start -= 1;
  }
  return start;
}

export function isLocalTestHost(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1";
}

export type TimerPresetId = "pro" | "30s" | "45s" | "60s" | "3s";

export interface TimerPresetOption {
  id: TimerPresetId;
  label: string;
  shortLabel: string;
  description: string;
  devOnly?: boolean;
}

export const TIMER_PRESETS: readonly TimerPresetOption[] = [
  {
    id: "pro",
    label: "RoV (Ban 40s / Pick 60s)",
    shortLabel: "40/60s",
    description: "Ban 40 วินาที · Pick 60 วินาที",
  },
  {
    id: "30s",
    label: "Fast 30s",
    shortLabel: "30s",
    description: "ทุกเทิร์น 30 วินาที",
  },
  {
    id: "45s",
    label: "Standard 45s",
    shortLabel: "45s",
    description: "ทุกเทิร์น 45 วินาที",
  },
  {
    id: "60s",
    label: "Relaxed 60s",
    shortLabel: "60s",
    description: "ทุกเทิร์น 60 วินาที",
  },
  {
    id: "3s",
    label: "Test 3s (สำหรับทดสอบ)",
    shortLabel: "3s",
    description: "โหมดทดสอบด่วน 3 วินาที/เทิร์น (เสียง / Auto-Lock / หมดเวลา)",
    devOnly: true,
  },
];

const TIMER_PREFS_STORAGE_KEY = "minidraft_timer_prefs_v1";

interface TimerPrefs {
  enabled: boolean;
  preset: TimerPresetId;
  soundEnabled: boolean;
  autoLock: boolean;
}

const DEFAULT_PREFS: TimerPrefs = {
  enabled: false,
  preset: "pro",
  soundEnabled: true,
  autoLock: false,
};

function loadTimerPrefs(): TimerPrefs {
  try {
    const raw = window.localStorage.getItem(TIMER_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<TimerPrefs>;
    const allowTestPreset = isLocalTestHost();
    const validPreset: TimerPresetId =
      parsed.preset === "pro" ||
      parsed.preset === "30s" ||
      parsed.preset === "45s" ||
      parsed.preset === "60s" ||
      (allowTestPreset && parsed.preset === "3s")
        ? parsed.preset
        : DEFAULT_PREFS.preset;
    return {
      enabled: Boolean(parsed.enabled),
      preset: validPreset,
      soundEnabled: parsed.soundEnabled !== undefined ? Boolean(parsed.soundEnabled) : DEFAULT_PREFS.soundEnabled,
      autoLock: Boolean(parsed.autoLock),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function saveTimerPrefs(prefs: TimerPrefs): void {
  try {
    window.localStorage.setItem(TIMER_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage restrictions
  }
}

export function getDurationForStep(preset: TimerPresetId, step: DraftStep | null): number {
  if (!step) return 0;
  if (preset === "3s") return 3;
  if (preset === "30s") return 30;
  if (preset === "45s") return 45;
  if (preset === "60s") return 60;
  return step.action === "ban" ? 40 : 60;
}

let sharedAudioCtx: AudioContext | null = null;

function playTone(freqHz: number, durationMs: number, volume = 0.06): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!sharedAudioCtx) {
      sharedAudioCtx = new Ctx();
    }
    if (sharedAudioCtx.state === "suspended") {
      void sharedAudioCtx.resume();
    }
    const now = sharedAudioCtx.currentTime;
    const osc = sharedAudioCtx.createOscillator();
    const gain = sharedAudioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freqHz, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    osc.connect(gain);
    gain.connect(sharedAudioCtx.destination);
    osc.start(now);
    osc.stop(now + durationMs / 1000);
  } catch {
    // Ignore Web Audio blocks or unsupported environments
  }
}

export interface UseDraftTimerOptions {
  currentStep: DraftStep | null;
  currentStepIndex: number;
  resetSignal: string;
  isBusy: boolean;
  fallbackHero: string | null;
  onExpireAutoLock: (heroName: string) => void;
}

export function useDraftTimer({
  currentStep,
  currentStepIndex,
  resetSignal,
  isBusy,
  fallbackHero,
  onExpireAutoLock,
}: UseDraftTimerOptions) {
  const [prefs, setPrefs] = useState<TimerPrefs>(loadTimerPrefs);
  const [manualNonce, setManualNonce] = useState(0);

  const totalSeconds = useMemo(
    () => getDurationForStep(prefs.preset, currentStep),
    [prefs.preset, currentStep],
  );
  const turnGroupStart = useMemo(
    () => getTurnGroupStartStep(currentStepIndex),
    [currentStepIndex],
  );
  const stepSignature = `${turnGroupStart}:${resetSignal}:${prefs.preset}:${manualNonce}`;
  const autoLockKey = `${currentStepIndex}:${resetSignal}:${manualNonce}`;

  const [clock, setClock] = useState<{ sig: string; paused: boolean; secondsLeft: number }>(() => ({
    sig: stepSignature,
    paused: false,
    secondsLeft: totalSeconds,
  }));

  // Reset display & clear stale Pause state immediately on turn-group/preset/manual reset changes
  if (clock.sig !== stepSignature) {
    setClock({
      sig: stepSignature,
      paused: false,
      secondsLeft: totalSeconds,
    });
  }

  const remainingRef = useRef<number>(totalSeconds);
  const lastSoundSecRef = useRef<number | null>(null);
  const expiredLockedStepRef = useRef<string | null>(null);

  useEffect(() => {
    saveTimerPrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    remainingRef.current = totalSeconds;
    lastSoundSecRef.current = null;
    expiredLockedStepRef.current = null;
  }, [stepSignature, totalSeconds, prefs.enabled]);

  // Tick loop anchored to wall-clock deadline (resists background-tab timer throttling)
  useEffect(() => {
    if (!prefs.enabled || clock.paused || !currentStep || totalSeconds <= 0) return;
    const startRemaining = Math.max(0, remainingRef.current);
    if (startRemaining === 0) return;

    const deadline = Date.now() + startRemaining * 1000;
    const id = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      remainingRef.current = next;
      setClock((prev) => (prev.secondsLeft === next ? prev : { ...prev, secondsLeft: next }));
    }, 200);
    return () => window.clearInterval(id);
  }, [prefs.enabled, clock.paused, stepSignature, currentStep, totalSeconds]);

  // Countdown audio cues (5..1 gentle tick, 0 double chime)
  useEffect(() => {
    if (!prefs.enabled || clock.paused || !prefs.soundEnabled || !currentStep) return;
    const sec = clock.secondsLeft;
    if (lastSoundSecRef.current === sec) return;
    if (sec >= 1 && sec <= 5) {
      lastSoundSecRef.current = sec;
      playTone(660, 50, 0.045);
    } else if (sec === 0 && totalSeconds > 0) {
      lastSoundSecRef.current = 0;
      playTone(520, 120, 0.07);
      window.setTimeout(() => playTone(780, 140, 0.07), 130);
    }
  }, [clock.secondsLeft, clock.paused, prefs.enabled, prefs.soundEnabled, currentStep, totalSeconds]);

  // Optional Auto-Lock AI #1 when clock hits 00s (tracks individual stepIndex so double-picks lock both slots)
  useEffect(() => {
    if (!prefs.enabled || clock.paused || !prefs.autoLock || !currentStep) return;
    if (clock.secondsLeft > 0 || isBusy || !fallbackHero) return;
    if (expiredLockedStepRef.current === autoLockKey) return;
    expiredLockedStepRef.current = autoLockKey;
    onExpireAutoLock(fallbackHero);
  }, [
    clock.secondsLeft,
    clock.paused,
    prefs.enabled,
    prefs.autoLock,
    currentStep,
    isBusy,
    fallbackHero,
    autoLockKey,
    onExpireAutoLock,
  ]);

  const setEnabled = useCallback((next: boolean) => {
    setClock((prev) => ({ ...prev, paused: false }));
    setManualNonce((n) => n + 1);
    setPrefs((prev) => ({ ...prev, enabled: next }));
  }, []);

  const toggleEnabled = useCallback(() => {
    setClock((prev) => ({ ...prev, paused: false }));
    setManualNonce((n) => n + 1);
    setPrefs((prev) => ({ ...prev, enabled: !prev.enabled }));
  }, []);

  const togglePaused = useCallback(() => {
    setClock((prev) => ({ ...prev, paused: !prev.paused }));
  }, []);

  const resetTurnTimer = useCallback(() => {
    setClock((prev) => ({ ...prev, paused: false }));
    setManualNonce((n) => n + 1);
  }, []);

  const setPreset = useCallback((preset: TimerPresetId) => {
    setClock((prev) => ({ ...prev, paused: false }));
    setPrefs((prev) => ({ ...prev, preset }));
  }, []);

  const toggleSound = useCallback(() => {
    setPrefs((prev) => ({ ...prev, soundEnabled: !prev.soundEnabled }));
  }, []);

  const toggleAutoLock = useCallback(() => {
    setPrefs((prev) => ({ ...prev, autoLock: !prev.autoLock }));
  }, []);

  return {
    enabled: prefs.enabled,
    preset: prefs.preset,
    soundEnabled: prefs.soundEnabled,
    autoLock: prefs.autoLock,
    paused: clock.paused,
    secondsLeft: clock.secondsLeft,
    totalSeconds,
    isWarning: prefs.enabled && currentStep !== null && clock.secondsLeft > 0 && clock.secondsLeft <= 10,
    isCritical: prefs.enabled && currentStep !== null && clock.secondsLeft <= 5,
    isExpired: prefs.enabled && currentStep !== null && clock.secondsLeft === 0,
    setEnabled,
    toggleEnabled,
    togglePaused,
    resetTurnTimer,
    setPreset,
    toggleSound,
    toggleAutoLock,
  };
}

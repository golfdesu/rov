import type { DraftStep, GlobalBanState, RecordedDraftGame } from "../types/draft";
import { displayName } from "./heroNames";

export type PracticeSide = DraftStep["side"];
export type PracticeGameCount = 1 | 3 | 5 | 7;

export const DEFAULT_PRACTICE_GLOBAL_BANS: GlobalBanState = {
  seriesName: "",
  teamAName: "TEAM A",
  teamBName: "TEAM B",
  teamAUsed: [],
  teamBUsed: [],
  universalBans: [],
  blueSideTeam: "A",
  gameNumber: 1,
};

export const PRACTICE_GAME_COUNTS: readonly PracticeGameCount[] = [1, 3, 5, 7];
export const MAX_PRACTICE_HISTORY = 100;

export interface PracticeRoundMeta {
  sessionId: string;
  startingSide: PracticeSide;
  gameCount: PracticeGameCount;
  showHints: boolean;
  previousEstimates: Record<number, number | null>;
}

export interface PracticeHistoryEntry {
  id: string;
  signature: string;
  recordedAt: string;
  gameNumber: number;
  gameCount: PracticeGameCount;
  startingSide: PracticeSide;
  playerSide: PracticeSide;
  bluePicks: string[];
  redPicks: string[];
  blueBans: string[];
  redBans: string[];
  playerEstimate: number;
  previousEstimates?: Record<number, number | null>;
  globalBans?: GlobalBanState;
  seriesGames?: RecordedDraftGame[];
}

export function practiceDraftStorageKey(scope: string): string {
  return `rov_practice_draft:v1:${scope}`;
}

function practiceMetaStorageKey(scope: string): string {
  return `rov_practice_meta:v1:${scope}`;
}

function practiceHistoryStorageKey(scope: string): string {
  return `rov_practice_history:v1:${scope}`;
}

export function createPracticeSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeSide(value: unknown): PracticeSide {
  return value === "red" ? "red" : "blue";
}

function sanitizeGameCount(value: unknown): PracticeGameCount {
  return value === 3 || value === 5 || value === 7 ? value : 1;
}

function sanitizeHeroList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const normalized = displayName(item);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

function sanitizePreviousEstimates(raw: unknown): Record<number, number | null> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<number, number | null> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const gameNum = Number(k);
    if (!Number.isInteger(gameNum) || gameNum < 1 || gameNum > 7) continue;
    if (typeof v === "number" && Number.isFinite(v)) {
      out[gameNum] = v;
    } else if (v === null) {
      out[gameNum] = null;
    }
  }
  return out;
}

function sanitizeGlobalBans(raw: unknown): GlobalBanState | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Partial<GlobalBanState>;
  return {
    ...DEFAULT_PRACTICE_GLOBAL_BANS,
    ...obj,
    blueSideTeam: obj.blueSideTeam === "B" ? "B" : "A",
    gameNumber: typeof obj.gameNumber === "number" && obj.gameNumber >= 1 && obj.gameNumber <= 7 ? obj.gameNumber : 1,
    teamAUsed: sanitizeHeroList(obj.teamAUsed),
    teamBUsed: sanitizeHeroList(obj.teamBUsed),
    universalBans: sanitizeHeroList(obj.universalBans),
  };
}

export function defaultPracticeMeta(): PracticeRoundMeta {
  return {
    sessionId: createPracticeSessionId(),
    startingSide: "blue",
    gameCount: 1,
    showHints: true,
    previousEstimates: {},
  };
}

export function loadPracticeMeta(scope: string): PracticeRoundMeta {
  if (typeof window === "undefined") return defaultPracticeMeta();
  try {
    const raw = window.localStorage.getItem(practiceMetaStorageKey(scope));
    if (!raw) {
      const fresh = defaultPracticeMeta();
      savePracticeMeta(scope, fresh);
      return fresh;
    }
    const parsed = JSON.parse(raw) as Partial<PracticeRoundMeta>;
    const hasSessionId = typeof parsed.sessionId === "string" && parsed.sessionId.length > 0;
    const resolved: PracticeRoundMeta = {
      sessionId: hasSessionId ? parsed.sessionId! : createPracticeSessionId(),
      startingSide: sanitizeSide(parsed.startingSide),
      gameCount: sanitizeGameCount(parsed.gameCount),
      showHints: parsed.showHints === undefined ? true : Boolean(parsed.showHints),
      previousEstimates: sanitizePreviousEstimates(parsed.previousEstimates),
    };
    if (!hasSessionId) savePracticeMeta(scope, resolved);
    return resolved;
  } catch {
    const fresh = defaultPracticeMeta();
    savePracticeMeta(scope, fresh);
    return fresh;
  }
}

export function savePracticeMeta(scope: string, meta: PracticeRoundMeta): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(practiceMetaStorageKey(scope), JSON.stringify(meta));
  } catch {
    // Ignore storage quota or private browsing write errors.
  }
}

export function clearPracticeActiveRound(
  scope: string,
  startingSide: PracticeSide,
  gameCount: PracticeGameCount,
  showHints: boolean,
): PracticeRoundMeta {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(practiceDraftStorageKey(scope));
    } catch {
      // Ignore storage access errors.
    }
  }
  const fresh: PracticeRoundMeta = {
    sessionId: createPracticeSessionId(),
    startingSide,
    gameCount,
    showHints,
    previousEstimates: {},
  };
  savePracticeMeta(scope, fresh);
  return fresh;
}

export function loadPracticeHistory(scope: string): PracticeHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(practiceHistoryStorageKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries: PracticeHistoryEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Partial<PracticeHistoryEntry>;
      const bluePicks = sanitizeHeroList(obj.bluePicks);
      const redPicks = sanitizeHeroList(obj.redPicks);
      if (bluePicks.length !== 5 || redPicks.length !== 5) continue;
      const playerEstimate = typeof obj.playerEstimate === "number" && Number.isFinite(obj.playerEstimate) ? obj.playerEstimate : 50;
      const startingSide = sanitizeSide(obj.startingSide);
      const playerSide = sanitizeSide(obj.playerSide);
      const gameCount = sanitizeGameCount(obj.gameCount);
      const gameNumber = typeof obj.gameNumber === "number" && obj.gameNumber >= 1 && obj.gameNumber <= 7 ? obj.gameNumber : 1;
      const blueBans = sanitizeHeroList(obj.blueBans);
      const redBans = sanitizeHeroList(obj.redBans);
      const signature =
        typeof obj.signature === "string" && obj.signature
          ? obj.signature
          : buildPracticeSignature(createPracticeSessionId(), gameNumber, playerSide, {
              bluePicks,
              redPicks,
              blueBans,
              redBans,
            });
      entries.push({
        id: typeof obj.id === "string" && obj.id ? obj.id : createPracticeSessionId(),
        signature,
        recordedAt: typeof obj.recordedAt === "string" && obj.recordedAt ? obj.recordedAt : new Date().toISOString(),
        gameNumber,
        gameCount,
        startingSide,
        playerSide,
        bluePicks,
        redPicks,
        blueBans,
        redBans,
        playerEstimate,
        previousEstimates: obj.previousEstimates ? sanitizePreviousEstimates(obj.previousEstimates) : undefined,
        globalBans: sanitizeGlobalBans(obj.globalBans),
        seriesGames: Array.isArray(obj.seriesGames) ? obj.seriesGames : undefined,
      });
    }
    return entries.slice(0, MAX_PRACTICE_HISTORY);
  } catch {
    return [];
  }
}

export function savePracticeHistory(scope: string, entries: PracticeHistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(practiceHistoryStorageKey(scope), JSON.stringify(entries.slice(0, MAX_PRACTICE_HISTORY)));
  } catch {
    // Ignore storage quota or private browsing write errors.
  }
}

export function buildPracticeSignature(
  sessionId: string,
  gameNumber: number,
  playerSide: PracticeSide,
  draft: { bluePicks: string[]; redPicks: string[]; blueBans: string[]; redBans: string[] },
): string {
  return [
    sessionId,
    `G${gameNumber}`,
    playerSide,
    draft.bluePicks.join(","),
    draft.redPicks.join(","),
    draft.blueBans.join(","),
    draft.redBans.join(","),
  ].join("|");
}

export function recordPracticeHistoryEntry(
  scope: string,
  current: PracticeHistoryEntry[],
  entryInput: Omit<PracticeHistoryEntry, "id" | "recordedAt">,
): PracticeHistoryEntry[] {
  const existing = current.find((item) => item.signature === entryInput.signature);
  if (existing) {
    return current;
  }
  const entry: PracticeHistoryEntry = {
    ...entryInput,
    id: createPracticeSessionId(),
    recordedAt: new Date().toISOString(),
  };
  const next = [entry, ...current].slice(0, MAX_PRACTICE_HISTORY);
  savePracticeHistory(scope, next);
  return next;
}

export function deletePracticeHistoryEntry(
  scope: string,
  current: PracticeHistoryEntry[],
  id: string,
): PracticeHistoryEntry[] {
  const next = current.filter((item) => item.id !== id);
  savePracticeHistory(scope, next);
  return next;
}

export function clearPracticeHistory(scope: string): PracticeHistoryEntry[] {
  savePracticeHistory(scope, []);
  return [];
}

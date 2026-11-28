const CHUNK_RELOAD_KEY = "minidraft_chunk_reload_at";
const CHUNK_RELOAD_COOLDOWN_MS = 60_000;

const STALE_CHUNK_PATTERNS = [
  "failed to fetch dynamically imported module",
  "importing a module script failed",
  "error loading dynamically imported module",
  "loading chunk",
  "loading css chunk",
];

export function isStaleChunkError(error: unknown): boolean {
  if (!error) return false;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof (error as { message?: unknown }).message === "string"
          ? String((error as { message: string }).message)
          : "";
  const lower = message.toLowerCase();
  return STALE_CHUNK_PATTERNS.some((pattern) => lower.includes(pattern));
}

export function tryRecoverFromStaleChunk(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  try {
    const lastRaw = window.sessionStorage.getItem(CHUNK_RELOAD_KEY);
    const lastTs = lastRaw ? Number(lastRaw) : 0;
    const now = Date.now();
    if (Number.isFinite(lastTs) && lastTs > 0 && now - lastTs < CHUNK_RELOAD_COOLDOWN_MS) {
      return false;
    }
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    // If sessionStorage is unavailable, avoid risking an infinite reload loop.
    return false;
  }
  window.location.reload();
  return true;
}

export function initChunkErrorRecovery(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    if (tryRecoverFromStaleChunk()) {
      event.preventDefault();
    }
  });
}

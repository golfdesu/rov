import { useCallback, useEffect, useRef, useState } from "react";
import { deleteJson, getJson, isAbortError, postJson, putJson } from "../api/client";
import { type CombatBuild, type CombatCatalog, type DuelResult, type Side, emptyBuild } from "../types/combat";
import { displayName } from "../utils/heroNames";

const DEFAULT_STORAGE_KEY = "rov-combat-lab-v1";

interface CombatBuildsSyncPayload {
  a?: Partial<CombatBuild> | null;
  b?: Partial<CombatBuild> | null;
  enable_kiting?: boolean;
  enable_actives?: boolean;
  updatedAt?: number;
}

export interface UseCombatLabOptions {
  storageKey?: string;
  persistRemote?: boolean;
}

function sanitizeBuild(raw: unknown, fallbackHero: string): CombatBuild {
  const base = emptyBuild(fallbackHero);
  if (!raw || typeof raw !== "object") return base;
  const merged = { ...base, ...(raw as Partial<CombatBuild>) };
  if (typeof merged.hero !== "string" || !merged.hero) {
    merged.hero = fallbackHero;
  } else {
    merged.hero = displayName(merged.hero);
  }
  return merged;
}

function loadSaved(storageKey: string): {
  a: CombatBuild;
  b: CombatBuild;
  enableKiting: boolean;
  enableActives: boolean;
  updatedAt: number;
} {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as CombatBuildsSyncPayload;
      return {
        a: sanitizeBuild(parsed?.a, "Valhein"),
        b: sanitizeBuild(parsed?.b, "Toro"),
        enableKiting: typeof parsed?.enable_kiting === "boolean" ? parsed.enable_kiting : true,
        enableActives: typeof parsed?.enable_actives === "boolean" ? parsed.enable_actives : true,
        updatedAt: typeof parsed?.updatedAt === "number" ? parsed.updatedAt : 0,
      };
    }
  } catch {
    // ignore unavailable or corrupt storage
  }
  return {
    a: emptyBuild("Valhein"),
    b: emptyBuild("Toro"),
    enableKiting: true,
    enableActives: true,
    updatedAt: 0,
  };
}

export function useCombatLab(options: UseCombatLabOptions = {}) {
  const { storageKey = DEFAULT_STORAGE_KEY, persistRemote = false } = options;
  const [initialState] = useState(() => loadSaved(storageKey));
  const [catalog, setCatalog] = useState<CombatCatalog | null>(null);
  const [builds, setBuilds] = useState<{ a: CombatBuild; b: CombatBuild }>({
    a: initialState.a,
    b: initialState.b,
  });
  const [enableKiting, setEnableKiting] = useState(initialState.enableKiting);
  const [enableActives, setEnableActives] = useState(initialState.enableActives);
  const [catalogReloadKey, setCatalogReloadKey] = useState(0);
  const [result, setResult] = useState<DuelResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const lastSavedAtRef = useRef<number>(initialState.updatedAt);
  const isHydratingRemoteRef = useRef<boolean>(false);
  const hasCompletedRemoteSyncRef = useRef<boolean>(!persistRemote);

  useEffect(() => {
    if (!persistRemote) {
      hasCompletedRemoteSyncRef.current = true;
      return;
    }
    const ctrl = new AbortController();
    hasCompletedRemoteSyncRef.current = false;
    getJson<CombatBuildsSyncPayload>("/combat/builds", ctrl.signal)
      .then((remote) => {
        if (remote && typeof remote.updatedAt === "number" && remote.updatedAt > lastSavedAtRef.current) {
          isHydratingRemoteRef.current = true;
          lastSavedAtRef.current = remote.updatedAt;
          const nextA = sanitizeBuild(remote.a, "Valhein");
          const nextB = sanitizeBuild(remote.b, "Toro");
          const nextKiting = typeof remote.enable_kiting === "boolean" ? remote.enable_kiting : true;
          const nextActives = typeof remote.enable_actives === "boolean" ? remote.enable_actives : true;
          setBuilds({ a: nextA, b: nextB });
          setEnableKiting(nextKiting);
          setEnableActives(nextActives);
          try {
            localStorage.setItem(
              storageKey,
              JSON.stringify({
                a: nextA,
                b: nextB,
                enable_kiting: nextKiting,
                enable_actives: nextActives,
                updatedAt: remote.updatedAt,
              }),
            );
          } catch {
            // ignore storage errors
          }
        }
      })
      .catch((e: unknown) => {
        if (!isAbortError(e)) {
          console.warn("Could not fetch /combat/builds from server, using local storage:", e);
        }
      })
      .finally(() => {
        hasCompletedRemoteSyncRef.current = true;
      });
    return () => ctrl.abort();
  }, [persistRemote, storageKey]);

  useEffect(() => {
    const ctrl = new AbortController();
    getJson<CombatCatalog>("/combat/catalog", ctrl.signal)
      .then((cat) => {
        setCatalog(cat);
        // Saved heroes may no longer exist; reset those to defaults
        const known = new Set(cat.heroes.map((h) => h.name));
        setBuilds((prev) => ({
          a: known.has(prev.a.hero) ? prev.a : emptyBuild("Valhein"),
          b: known.has(prev.b.hero) ? prev.b : emptyBuild("Toro"),
        }));
      })
      .catch((e: unknown) => {
        if (!isAbortError(e)) setError(`โหลดข้อมูลไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
      });
    return () => ctrl.abort();
  }, [catalogReloadKey]);

  useEffect(() => {
    const shouldPersistSync = !isHydratingRemoteRef.current && hasCompletedRemoteSyncRef.current;
    if (isHydratingRemoteRef.current) {
      isHydratingRemoteRef.current = false;
    }

    const now = Date.now();
    if (shouldPersistSync) {
      lastSavedAtRef.current = now;
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            a: builds.a,
            b: builds.b,
            enable_kiting: enableKiting,
            enable_actives: enableActives,
            updatedAt: now,
          }),
        );
      } catch {
        // storage unavailable
      }
    }

    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const duelPayload = {
          a: { ...builds.a, enable_kiting: enableKiting, enable_actives: enableActives },
          b: { ...builds.b, enable_kiting: enableKiting, enable_actives: enableActives },
        };
        setResult(await postJson<DuelResult>("/combat/duel", duelPayload, ctrl.signal));
        setError(null);
      } catch (e) {
        if (!isAbortError(e)) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!ctrl.signal.aborted) setIsLoading(false);
      }
      if (persistRemote && shouldPersistSync && !ctrl.signal.aborted) {
        putJson(
          "/combat/builds",
          {
            a: builds.a,
            b: builds.b,
            enable_kiting: enableKiting,
            enable_actives: enableActives,
            updatedAt: now,
          },
          ctrl.signal,
        ).catch(() => {
          // non-fatal sync error
        });
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [builds, enableKiting, enableActives, persistRemote, storageKey]);

  const retryCatalog = useCallback(() => {
    setError(null);
    setCatalogReloadKey((n) => n + 1);
  }, []);

  const resetBuilds = useCallback(() => {
    lastSavedAtRef.current = Date.now();
    setBuilds({ a: emptyBuild("Valhein"), b: emptyBuild("Toro") });
    setEnableKiting(true);
    setEnableActives(true);
    setError(null);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    if (persistRemote) {
      deleteJson("/combat/builds").catch(() => {
        // ignore
      });
    }
  }, [persistRemote, storageKey]);

  const updateBuild = useCallback((side: Side, patch: Partial<CombatBuild>) => {
    setBuilds((prev) => ({ ...prev, [side]: { ...prev[side], ...patch } }));
  }, []);

  const swap = useCallback(() => setBuilds((p) => ({ a: p.b, b: p.a })), []);
  const mirror = useCallback(
    (from: Side) =>
      setBuilds((p) => {
        const to: Side = from === "a" ? "b" : "a";
        return {
          ...p,
          [to]: {
            ...p[from],
            hero: p[to].hero,
            skill_levels: {},
            skill_hits: {},
            skill_charges: {},
            active_combo_slots: undefined,
          },
        };
      }),
    [],
  );

  return {
    catalog,
    builds,
    result,
    error,
    isLoading,
    updateBuild,
    swap,
    mirror,
    enableKiting,
    setEnableKiting,
    enableActives,
    setEnableActives,
    retryCatalog,
    resetBuilds,
  };
}

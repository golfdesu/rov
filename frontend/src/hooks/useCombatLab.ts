import { useCallback, useEffect, useState } from "react";
import { type CombatBuild, type CombatCatalog, type DuelResult, type Side, emptyBuild } from "../types/combat";

const STORAGE_KEY = "rov-combat-lab-v1";

function sanitizeBuild(raw: unknown, fallbackHero: string): CombatBuild {
  const base = emptyBuild(fallbackHero);
  if (!raw || typeof raw !== "object") return base;
  const merged = { ...base, ...(raw as Partial<CombatBuild>) };
  if (typeof merged.hero !== "string" || !merged.hero) merged.hero = fallbackHero;
  return merged;
}

function loadSaved(): { a: CombatBuild; b: CombatBuild } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { a: sanitizeBuild(parsed?.a, "Valhein"), b: sanitizeBuild(parsed?.b, "Toro") };
    }
  } catch {
    // ignore unavailable or corrupt storage
  }
  return { a: emptyBuild("Valhein"), b: emptyBuild("Toro") };
}

export function useCombatLab() {
  const [catalog, setCatalog] = useState<CombatCatalog | null>(null);
  const [builds, setBuilds] = useState(loadSaved);
  const [result, setResult] = useState<DuelResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetch("/combat/catalog")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((cat: CombatCatalog) => {
        setCatalog(cat);
        // Saved heroes may no longer exist; reset those to defaults
        const known = new Set(cat.heroes.map((h) => h.name));
        setBuilds((prev) => ({
          a: known.has(prev.a.hero) ? prev.a : emptyBuild("Valhein"),
          b: known.has(prev.b.hero) ? prev.b : emptyBuild("Toro"),
        }));
      })
      .catch((e) => setError(`โหลดข้อมูลไม่สำเร็จ: ${e.message}`));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(builds));
    } catch {
      // storage unavailable
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const res = await fetch("/combat/duel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(builds),
          signal: ctrl.signal,
        });
        const body = await res.json();
        if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail));
        setResult(body);
        setError(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        if (!ctrl.signal.aborted) setIsLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [builds]);

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
  };
}

import type { LaneKey } from "../types/draft";
import { ApiError, deleteJson, getJson, putJson } from "./client";

export type HeroPoolScope = "personal" | "team";
export type HeroPoolLanes = Record<LaneKey, string[]>;

export interface HeroPoolItem {
  id: number;
  scope: HeroPoolScope;
  team_name: string;
  lanes: HeroPoolLanes;
  updated_at: number;
}

export interface HeroPoolOverview {
  personal: HeroPoolItem[];
  team: HeroPoolItem[];
  personal_limit: number;
  team_limit: number;
  is_paid: boolean;
  team_tier: "duo" | "team_pro" | null;
}

export const POOL_LANES: readonly LaneKey[] = ["DS_Lane", "Jungle", "Mid", "Dragon_Lane", "Roam"];

export function emptyPoolLanes(): HeroPoolLanes {
  return { DS_Lane: [], Jungle: [], Mid: [], Dragon_Lane: [], Roam: [] };
}

export function getHeroPools(signal?: AbortSignal) {
  return getJson<HeroPoolOverview>("/billing/hero-pools", signal);
}

export function saveHeroPool(payload: {
  scope: HeroPoolScope;
  team_name: string;
  lanes: HeroPoolLanes;
  create_only?: boolean;
  pool_id?: number;
}) {
  return putJson<HeroPoolItem>("/billing/hero-pools", payload);
}

export function deleteHeroPool(poolId: number) {
  return deleteJson<void>(`/billing/hero-pools/${poolId}`);
}

/** Case-insensitive exact team-name match; prefers shared team pool if both exist. */
export function findMatchingHeroPool(teamName: string, overview: HeroPoolOverview | null): HeroPoolItem | null {
  if (!overview) return null;
  const target = teamName.trim().toLowerCase();
  if (!target) return null;
  const teamMatch = overview.team.find((p) => p.team_name.trim().toLowerCase() === target);
  if (teamMatch) return teamMatch;
  return overview.personal.find((p) => p.team_name.trim().toLowerCase() === target) ?? null;
}

export function getPoolHeroSet(pool: HeroPoolItem | null): Set<string> {
  const out = new Set<string>();
  if (!pool) return out;
  for (const lane of POOL_LANES) {
    for (const hero of pool.lanes[lane] ?? []) {
      out.add(hero);
    }
  }
  return out;
}

export function getSavedPoolTeamNames(overview: HeroPoolOverview | null): string[] {
  if (!overview) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const pool of [...overview.team, ...overview.personal]) {
    const clean = pool.team_name.trim();
    const key = clean.toLowerCase();
    if (clean && !seen.has(key)) {
      seen.add(key);
      names.push(clean);
    }
  }
  return names;
}

const poolErrors: Record<string, string> = {
  pool_limit_reached: "ครบจำนวน Hero Pool ของแพ็กปัจจุบันแล้ว",
  membership_required: "บัญชีนี้ไม่มีสิทธิ์เข้าใช้ Team Hero Pool",
  invalid_team_name: "กรุณาระบุชื่อทีม 1–32 ตัวอักษร",
  duplicate_team_name: "มีชื่อทีมนี้อยู่แล้วในหมวดนี้ กรุณาใช้ชื่ออื่น",
  pool_not_found: "ไม่พบ Hero Pool ที่เลือก",
};

export function heroPoolErrorMessage(error: unknown): string {
  const detail = error instanceof ApiError && typeof error.detail === "string" ? error.detail : "";
  return poolErrors[detail] ?? "บันทึก Hero Pool ไม่สำเร็จ ลองอีกครั้ง";
}

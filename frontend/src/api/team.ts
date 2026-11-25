import type { HistorySeriesEdit, RecordedDraftGame, TournamentRef } from "../types/draft";
import { ApiError, getJson, postJson, putJson } from "./client";

export const teamPath = "/billing/team";
export type GroupTier = "duo" | "team_pro";
export const groupName: Record<GroupTier, string> = { duo: "Duo", team_pro: "Business" };

interface TeamAccount {
  id: number;
  username: string;
}

interface TeamInvitation {
  owner_id: number;
  owner_username: string;
  tier: GroupTier;
}

export interface Team extends TeamInvitation {
  is_owner: boolean;
  expires_at: number;
  capacity: number;
  members: TeamAccount[];
  sent: TeamAccount[];
}

export interface TeamOverview {
  team: Team | null;
  received: TeamInvitation[];
}

export interface TeamGame {
  id: number;
  author: string | null;
  game: RecordedDraftGame;
}

export function getTeam(signal?: AbortSignal) {
  return getJson<TeamOverview>(teamPath, signal);
}

export interface TeamSeriesCopyResult {
  copied: number;
  skipped: number;
}

export function shareTeamGame(team: Team, sourceId: string, game?: RecordedDraftGame) {
  return postJson<void>(`${teamPath}/history`, {
    owner_id: team.owner_id,
    tier: team.tier,
    source_id: sourceId,
    ...(game ? { game } : {}),
  });
}

export function shareTeamSeries(team: Team, sourceIds: string[], games?: RecordedDraftGame[]) {
  return postJson<TeamSeriesCopyResult>(`${teamPath}/history/batch`, {
    owner_id: team.owner_id,
    tier: team.tier,
    source_ids: sourceIds,
    ...(games && games.length > 0 ? { games } : {}),
  });
}

export function assignTeamSeriesTournament(gameId: number, tournament: TournamentRef | null) {
  return putJson<void>(`${teamPath}/history/${gameId}/tournament`, { tournament });
}

export function assignTeamSeriesTournaments(gameIds: number[], tournament: TournamentRef) {
  return putJson<void>(`${teamPath}/history/tournament`, { game_ids: gameIds, tournament });
}

export function renameTeamHistoryTournament(gameId: number, name: string) {
  return putJson<void>(`${teamPath}/history/${gameId}/name`, { target: "tournament", name });
}

export function editTeamHistorySeries(gameId: number, edit: HistorySeriesEdit) {
  return putJson<void>(`${teamPath}/history/${gameId}/series`, edit);
}

const teamErrors: Record<string, string> = {
  already_in_group: "ผู้ใช้นี้อยู่ในทีมอื่นแล้ว",
  game_not_found: "ยังไม่พบเกมในประวัติที่ซิงก์ ลองอีกครั้ง",
  history_full: "ประวัติทีมเต็มแล้ว ลบเกมเดิมก่อนบันทึก",
  invite_unavailable: "คำเชิญไม่พร้อมใช้งาน",
  invalid_team_game: "เกมนี้มีข้อมูล Pick/Ban ที่ต้องแก้ก่อนคัดลอกเข้าทีม",
  membership_required: "บัญชีนี้ไม่มีสิทธิ์เข้าทีมแล้ว",
  owner_required: "เฉพาะเจ้าของทีมเท่านั้น",
  pending_order: "ปิดรายการชำระเงินก่อนเข้าทีม",
  team_full: "ที่นั่งในทีมเต็มแล้ว",
};

export function teamErrorMessage(error: unknown) {
  const detail = error instanceof ApiError && typeof error.detail === "string" ? error.detail : "";
  return teamErrors[detail] ?? "ทำรายการทีมไม่สำเร็จ ลองอีกครั้ง";
}

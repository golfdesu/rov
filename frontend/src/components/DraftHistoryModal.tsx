import {
  BookmarkPlus,
  Clock,
  FolderOpen,
  History,
  Layers,
  Play,
  PlusCircle,
  RotateCcw,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { Hero, RecordedDraftGame, TeamId } from "../types/draft";
import { getGameSeriesGroup } from "../utils/draft";
import { displayName } from "../utils/heroNames";
import { HeroPortrait } from "./HeroPortrait";
import { Modal } from "./Modal";

interface DraftHistoryModalProps {
  games: RecordedDraftGame[];
  heroMap: Map<string, Hero>;
  hasCurrentDraftActions: boolean;
  onSaveCurrentSnapshot: () => void;
  onOpenNewSeries?: () => void;
  onSwitchSeries?: (groupName: string) => void;
  onLoadGame: (game: RecordedDraftGame) => void;
  onSetGameWinner?: (id: string, winner?: TeamId) => void;
  onDeleteGame: (id: string) => void;
  onDeleteGroup: (groupName: string) => void;
  onClearAllSeries: () => void;
  onClose: () => void;
}

export function DraftHistoryModal({
  games,
  heroMap,
  hasCurrentDraftActions,
  onSaveCurrentSnapshot,
  onOpenNewSeries,
  onSwitchSeries,
  onLoadGame,
  onSetGameWinner,
  onDeleteGame,
  onDeleteGroup,
  onClearAllSeries,
  onClose,
}: DraftHistoryModalProps) {
  const titleId = useId();
  const [selectedGroup, setSelectedGroup] = useState<string>("ALL");

  const groups = useMemo(() => {
    const map = new Map<string, RecordedDraftGame[]>();
    for (const g of games) {
      const groupName = getGameSeriesGroup(g);
      const list = map.get(groupName) ?? [];
      list.push(g);
      map.set(groupName, list);
    }
    return Array.from(map.entries()).map(([name, items]) => ({
      name,
      items,
      count: items.length,
      latestTimestamp: items[0]?.timestamp ?? "",
    }));
  }, [games]);

  // If currently selected group no longer exists (e.g. deleted), revert to "ALL"
  const activeGroup =
    selectedGroup === "ALL" || groups.some((grp) => grp.name === selectedGroup)
      ? selectedGroup
      : "ALL";

  const displayedGroups = useMemo(() => {
    if (activeGroup === "ALL") return groups;
    return groups.filter((grp) => grp.name === activeGroup);
  }, [groups, activeGroup]);

  return (
    <Modal labelledBy={titleId} className="max-h-[92vh] max-w-4xl" onClose={onClose}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2.5">
          <History className="h-4 w-4 text-gold" />
          <div>
            <h2 id={titleId} className="font-display text-sm font-bold tracking-wider text-ink">
              DRAFT & SERIES HISTORY · ประวัติการดราฟต์แยกตามกลุ่มซีรีส์ ({games.length})
            </h2>
            <p className="text-[11px] text-dim">
              ระบบจัดกลุ่มตามคู่แข่งขัน (เช่น BRU vs FS) อัตโนมัติ — บันทึกทนทานต่อการกด Refresh หรือรีสตาร์ทเซิร์ฟเวอร์
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenNewSeries && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenNewSeries();
              }}
              title="เริ่มแมตช์ / ซีรีส์ใหม่ (แยกประวัติออกจากแมตช์เดิม)"
              className="flex h-8 items-center gap-1.5 border border-gold bg-gold px-2.5 font-display text-[11px] font-bold tracking-wide text-bg transition-colors hover:bg-gold/90"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              <span>+ แมตช์ใหม่</span>
            </button>
          )}
          {hasCurrentDraftActions && (
            <button
              type="button"
              onClick={onSaveCurrentSnapshot}
              title="บันทึกกระดานดราฟต์ปัจจุบันเก็บเข้าประวัติโดยไม่ล้างกระดาน"
              className="flex h-8 items-center gap-1.5 border border-gold/60 bg-gold/10 px-2.5 font-display text-[11px] font-bold tracking-wide text-gold transition-colors hover:bg-gold hover:text-bg"
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              <span>บันทึกกระดานปัจจุบัน</span>
            </button>
          )}
          <button
            type="button"
            disabled={games.length === 0}
            onClick={() => {
              if (window.confirm("ล้างประวัติซีรีส์, Global Ban และกระดานปัจจุบันทั้งหมดเพื่อเริ่มซีรีส์ใหม่?")) {
                onClearAllSeries();
                onClose();
              }
            }}
            className="flex h-8 items-center gap-1.5 border border-red/40 bg-red/10 px-2.5 font-display text-[11px] font-semibold tracking-wide text-red transition-colors hover:bg-red hover:text-ink disabled:pointer-events-none disabled:opacity-35"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>รีเซ็ตทั้งซีรีส์</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-dim transition-colors hover:bg-panel-2 hover:text-ink"
            aria-label="ปิด"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Series Group Selector Bar */}
      {groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-panel-2/60 px-4 py-2">
          <span className="flex items-center gap-1 font-mono text-[11px] font-bold text-muted mr-1">
            <Layers className="h-3.5 w-3.5 text-gold" />
            <span>GROUP / แมตช์:</span>
          </span>
          <button
            type="button"
            onClick={() => setSelectedGroup("ALL")}
            className={`flex h-7 items-center gap-1.5 border px-2.5 font-display text-xs font-bold transition-colors ${
              activeGroup === "ALL"
                ? "border-gold bg-gold text-bg"
                : "border-line bg-bg text-muted hover:border-line-strong hover:text-ink"
            }`}
          >
            <span>ทั้งหมด</span>
            <span
              className={`px-1 font-mono text-[10px] ${
                activeGroup === "ALL" ? "bg-bg text-gold" : "bg-panel-2 text-dim"
              }`}
            >
              {games.length}
            </span>
          </button>

          {groups.map((grp) => {
            const isSelected = activeGroup === grp.name;
            return (
              <button
                key={grp.name}
                type="button"
                onClick={() => setSelectedGroup(grp.name)}
                className={`flex h-7 items-center gap-1.5 border px-2.5 font-display text-xs font-bold transition-colors ${
                  isSelected
                    ? "border-gold bg-gold text-bg"
                    : "border-line bg-bg text-muted hover:border-line-strong hover:text-ink"
                }`}
              >
                <span>{grp.name}</span>
                <span
                  className={`px-1 font-mono text-[10px] ${
                    isSelected ? "bg-bg text-gold" : "bg-panel-2 text-dim"
                  }`}
                >
                  {grp.count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Saved Games List Grouped by Matchup */}
      <div className="flex-1 overflow-y-auto p-4">
        {games.length === 0 ? (
          <div className="flex h-52 flex-col items-center justify-center gap-2 border border-dashed border-line bg-bg/40 p-6 text-center text-dim">
            <History className="h-7 w-7 text-muted/60" />
            <p className="font-display text-sm font-semibold text-muted">ยังไม่มีประวัติเกมที่บันทึกไว้ในระบบ</p>
            <p className="max-w-md text-xs text-dim">
              เมื่อกดปุ่ม &ldquo;จบเกมนี้ → บันทึก Global Ban&rdquo; หรือกด &ldquo;บันทึกกระดานปัจจุบัน&rdquo;
              รายละเอียดการแบนและเลือกฮีโร่จะถูกจัดกลุ่มตามคู่แข่งขัน (เช่น BRU vs FS) และเก็บรักษาไว้อย่างถาวร
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {displayedGroups.map((grp) => (
              <div key={grp.name} className="flex flex-col gap-3">
                {/* Group Section Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-gold/70 pb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="border border-gold/60 bg-gold/15 px-2 py-0.5 font-display text-xs font-bold text-gold">
                      {grp.name}
                    </span>
                    <span className="font-mono text-xs text-muted">
                      ({grp.count} เกมในซีรีส์)
                    </span>
                    {grp.latestTimestamp && (
                      <span className="hidden sm:flex items-center gap-1 font-mono text-[11px] text-dim">
                        <Clock className="h-3 w-3" />
                        ล่าสุด {grp.latestTimestamp}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {onSwitchSeries && (
                      <button
                        type="button"
                        onClick={() => {
                          onSwitchSeries(grp.name);
                          onClose();
                        }}
                        title={`สลับกระดานมาดราฟต์เกมถัดไปของซีรีส์ "${grp.name}"`}
                        className="flex h-6 items-center gap-1 border border-gold/60 bg-gold/15 px-2 font-display text-[10px] font-bold text-gold transition-colors hover:bg-gold hover:text-bg"
                      >
                        <Play className="h-3 w-3" />
                        <span>ดราฟต์ซีรีส์นี้ต่อ</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`ต้องการลบประวัติของกลุ่ม "${grp.name}" ทั้งหมด (${grp.count} เกม)?`)) {
                          onDeleteGroup(grp.name);
                        }
                      }}
                      title={`ลบประวัติเฉพาะกลุ่ม ${grp.name}`}
                      className="flex h-6 items-center gap-1 border border-red/40 bg-red/10 px-2 font-display text-[10px] font-semibold text-red transition-colors hover:bg-red hover:text-ink"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>ลบเฉพาะกลุ่มนี้</span>
                    </button>
                  </div>
                </div>

                {/* Games in this Group */}
                <div className="flex flex-col gap-3">
                  {grp.items.map((g) => {
                    const blueWin = Math.min(Math.max(g.blueWinRate ?? 50, 0), 100);
                    const redWin = 100 - blueWin;
                    const blueTeamId: TeamId = g.blueSideTeam;
                    const redTeamId: TeamId = g.blueSideTeam === "A" ? "B" : "A";
                    return (
                      <div
                        key={g.id}
                        className="flex flex-col gap-2.5 border border-line bg-panel-2/60 p-3 transition-colors hover:border-line-strong"
                      >
                        {/* Top Bar: Game Number, Teams, Win Rate, Actions */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="border border-gold/60 bg-gold/15 px-2 py-0.5 font-mono text-xs font-bold text-gold">
                              GAME {g.gameNumber}
                            </span>
                            <span className="font-display text-xs font-bold text-blue">{g.blueTeamName} (BLUE)</span>
                            <span className="font-mono text-[11px] text-dim">vs</span>
                            <span className="font-display text-xs font-bold text-red">{g.redTeamName} (RED)</span>
                            <span className="flex items-center gap-1 font-mono text-[11px] text-dim">
                              <Clock className="h-3 w-3" />
                              {g.timestamp}
                            </span>
                            {onSetGameWinner && (
                              <div className="inline-flex items-center gap-1 border border-line bg-bg px-1.5 py-0.5">
                                <Trophy className="h-3 w-3 text-gold" />
                                <span className="font-mono text-[10px] text-dim">WINNER:</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onSetGameWinner(g.id, g.winner === blueTeamId ? undefined : blueTeamId)
                                  }
                                  className={`px-1.5 py-0.5 font-display text-[10px] font-bold transition-colors ${
                                    g.winner === blueTeamId
                                      ? "bg-blue text-bg"
                                      : "text-blue hover:bg-blue/15"
                                  }`}
                                >
                                  {g.blueTeamName}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onSetGameWinner(g.id, g.winner === redTeamId ? undefined : redTeamId)
                                  }
                                  className={`px-1.5 py-0.5 font-display text-[10px] font-bold transition-colors ${
                                    g.winner === redTeamId
                                      ? "bg-red text-bg"
                                      : "text-red hover:bg-red/15"
                                  }`}
                                >
                                  {g.redTeamName}
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs">
                              <span className="font-bold text-blue">{blueWin.toFixed(1)}%</span>
                              <span className="mx-1 text-dim">:</span>
                              <span className="font-bold text-red">{redWin.toFixed(1)}%</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                onLoadGame(g);
                                onClose();
                              }}
                              className="flex h-7 items-center gap-1 border border-gold/60 bg-gold/15 px-2.5 font-display text-[11px] font-bold text-gold transition-colors hover:bg-gold hover:text-bg"
                            >
                              <FolderOpen className="h-3 w-3" />
                              <span>โหลดขึ้นกระดาน</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteGame(g.id)}
                              title="ลบเกมนี้"
                              className="flex h-7 w-7 items-center justify-center border border-line bg-bg text-dim transition-colors hover:border-red/50 hover:text-red"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Blue vs Red Picks & Bans */}
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          {/* Blue Side */}
                          <div className="flex flex-col gap-1.5 border-l-2 border-blue bg-bg/50 p-2">
                            <div className="flex items-center justify-between">
                              <span className="font-display text-[11px] font-bold text-blue">
                                BLUE · {g.blueTeamName}
                              </span>
                              <span className="font-mono text-[10px] text-dim">
                                PICKS ({g.bluePicks.length}/5) · BANS ({g.blueBans.length}/4)
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {g.bluePicks.map((name, idx) => (
                                <div
                                  key={`bp-${idx}-${name}`}
                                  title={`Pick ${idx + 1}: ${displayName(name)}`}
                                  className="flex items-center gap-1 border border-blue/40 bg-panel pr-1.5"
                                >
                                  <div className="h-7 w-7 shrink-0 overflow-hidden">
                                    <HeroPortrait name={name} hero={heroMap.get(name)} />
                                  </div>
                                  <span className="max-w-[68px] truncate font-display text-[11px] font-bold text-ink">
                                    {displayName(name)}
                                  </span>
                                </div>
                              ))}
                              {g.bluePicks.length === 0 && (
                                <span className="text-[11px] text-dim">ไม่มีตัวที่เลือก</span>
                              )}
                            </div>
                            {g.blueBans.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                                <span className="mr-1 font-mono text-[9px] font-bold text-red">BANS:</span>
                                {g.blueBans.map((name, idx) => (
                                  <div
                                    key={`bb-${idx}-${name}`}
                                    title={`Ban ${idx + 1}: ${displayName(name)}`}
                                    className="relative h-6 w-6 overflow-hidden border border-red/40"
                                  >
                                    <HeroPortrait name={name} hero={heroMap.get(name)} className="grayscale opacity-65" />
                                    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,transparent_45%,var(--color-red)_47%,var(--color-red)_53%,transparent_55%)] opacity-80" />
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Red Side */}
                          <div className="flex flex-col gap-1.5 border-l-2 border-red bg-bg/50 p-2">
                            <div className="flex items-center justify-between">
                              <span className="font-display text-[11px] font-bold text-red">
                                RED · {g.redTeamName}
                              </span>
                              <span className="font-mono text-[10px] text-dim">
                                PICKS ({g.redPicks.length}/5) · BANS ({g.redBans.length}/4)
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {g.redPicks.map((name, idx) => (
                                <div
                                  key={`rp-${idx}-${name}`}
                                  title={`Pick ${idx + 1}: ${displayName(name)}`}
                                  className="flex items-center gap-1 border border-red/40 bg-panel pr-1.5"
                                >
                                  <div className="h-7 w-7 shrink-0 overflow-hidden">
                                    <HeroPortrait name={name} hero={heroMap.get(name)} />
                                  </div>
                                  <span className="max-w-[68px] truncate font-display text-[11px] font-bold text-ink">
                                    {displayName(name)}
                                  </span>
                                </div>
                              ))}
                              {g.redPicks.length === 0 && (
                                <span className="text-[11px] text-dim">ไม่มีตัวที่เลือก</span>
                              )}
                            </div>
                            {g.redBans.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                                <span className="mr-1 font-mono text-[9px] font-bold text-red">BANS:</span>
                                {g.redBans.map((name, idx) => (
                                  <div
                                    key={`rb-${idx}-${name}`}
                                    title={`Ban ${idx + 1}: ${displayName(name)}`}
                                    className="relative h-6 w-6 overflow-hidden border border-red/40"
                                  >
                                    <HeroPortrait name={name} hero={heroMap.get(name)} className="grayscale opacity-65" />
                                    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,transparent_45%,var(--color-red)_47%,var(--color-red)_53%,transparent_55%)] opacity-80" />
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-line bg-bg px-4 py-2.5">
        <span className="font-mono text-xs text-muted">
          บันทึกอัตโนมัติ (LocalStorage + Server JSON) · จัดกลุ่มตามคู่แข่งขันอัตโนมัติ
        </span>
        <button
          type="button"
          onClick={onClose}
          className="border border-gold bg-gold px-4 py-1.5 font-display text-xs font-bold tracking-wider text-bg transition-colors hover:bg-gold/90"
        >
          ปิดหน้าต่าง
        </button>
      </div>
    </Modal>
  );
}

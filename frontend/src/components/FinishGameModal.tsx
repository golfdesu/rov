import { AlertTriangle, CheckCircle2, ShieldAlert, Trophy, X } from "lucide-react";
import { useId } from "react";
import type { TeamId } from "../types/draft";
import { Modal } from "./Modal";

interface FinishGameModalProps {
  gameNumber: number;
  seriesName: string;
  blueTeamName: string;
  redTeamName: string;
  blueSideTeam: TeamId;
  blueWins: number;
  redWins: number;
  bluePickCount: number;
  redPickCount: number;
  isDraftComplete: boolean;
  onConfirmWinner: (winner?: TeamId) => void;
  onClose: () => void;
}

/** Popup dialog for choosing which team won when ending the current draft game. */
export function FinishGameModal({
  gameNumber,
  seriesName,
  blueTeamName,
  redTeamName,
  blueSideTeam,
  blueWins,
  redWins,
  bluePickCount,
  redPickCount,
  isDraftComplete,
  onConfirmWinner,
  onClose,
}: FinishGameModalProps) {
  const titleId = useId();
  const redSideTeam: TeamId = blueSideTeam === "A" ? "B" : "A";
  const totalPicks = bluePickCount + redPickCount;
  const isUltimateGame = gameNumber >= 7;

  return (
    <Modal labelledBy={titleId} className="max-w-lg" onClose={onClose}>
      {(requestClose) => (
        <>
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <Trophy className="h-5 w-5 shrink-0 text-gold" />
          <div>
            <h2 id={titleId} className="font-display text-base font-bold text-ink">
              จบ Game {gameNumber} — เลือกทีมที่ชนะ
            </h2>
            <p className="font-mono text-[11px] text-muted">
              {seriesName} · สกอร์ซีรีส์ {blueTeamName} {blueWins} - {redWins} {redTeamName}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => requestClose()}
          aria-label="ปิดหน้าต่าง"
          className="p-1.5 text-muted transition-colors hover:bg-panel-2 hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 p-5">
        {!isDraftComplete && (
          <div className="flex items-start gap-2.5 border border-warn/50 bg-warn/10 px-3 py-2.5 text-xs text-warn">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-display font-bold">
                Game {gameNumber} ยังดราฟต์ไม่ครบ 10 ตัว ({totalPicks}/10)
              </p>
              <p className="mt-0.5 text-[11px] text-warn/90">
                สามารถกดเลือกผู้ชนะเพื่อบันทึกผลและนำฮีโร่ที่เลือกแล้วเข้า Global Ban ได้ทันที
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onConfirmWinner(blueSideTeam)}
            className="group flex flex-col items-start gap-2 border border-blue/50 bg-blue/10 p-3.5 text-left transition-all hover:border-blue hover:bg-blue/20"
          >
            <div className="flex w-full items-center justify-between gap-2">
              <span className="border border-blue/40 bg-blue/15 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-blue">
                Blue Side
              </span>
              <span className="font-mono text-[11px] text-muted">ชนะแล้ว {blueWins} เกม</span>
            </div>
            <div className="flex w-full items-center justify-between gap-2">
              <span className="truncate font-display text-lg font-extrabold text-ink group-hover:text-blue">
                {blueTeamName} ชนะ
              </span>
              <CheckCircle2 className="h-5 w-5 shrink-0 text-blue opacity-70 transition-opacity group-hover:opacity-100" />
            </div>
            <span className="text-[11px] text-muted">บันทึกผลชัยชนะให้ {blueTeamName}</span>
          </button>

          <button
            type="button"
            onClick={() => onConfirmWinner(redSideTeam)}
            className="group flex flex-col items-start gap-2 border border-red/50 bg-red/10 p-3.5 text-left transition-all hover:border-red hover:bg-red/20"
          >
            <div className="flex w-full items-center justify-between gap-2">
              <span className="border border-red/40 bg-red/15 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-red">
                Red Side
              </span>
              <span className="font-mono text-[11px] text-muted">ชนะแล้ว {redWins} เกม</span>
            </div>
            <div className="flex w-full items-center justify-between gap-2">
              <span className="truncate font-display text-lg font-extrabold text-ink group-hover:text-red">
                {redTeamName} ชนะ
              </span>
              <CheckCircle2 className="h-5 w-5 shrink-0 text-red opacity-70 transition-opacity group-hover:opacity-100" />
            </div>
            <span className="text-[11px] text-muted">บันทึกผลชัยชนะให้ {redTeamName}</span>
          </button>
        </div>

        <div className="flex items-start gap-2 border border-line bg-bg/70 px-3 py-2 text-[11px] text-muted">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
          <span>
            {isUltimateGame
              ? "Game 7 (Ultimate Battle): บันทึกประวัติดราฟต์และสกอร์ซีรีส์โดยไม่ติด Global Ban"
              : `ระบบจะนำฮีโร่ที่เลือกในเกมนี้ (${bluePickCount} Blue / ${redPickCount} Red) เข้า Global Ban ของแต่ละทีม และเริ่ม Game ${gameNumber + 1} อัตโนมัติ`}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-bg/60 px-5 py-3">
        <button
          type="button"
          onClick={() => onConfirmWinner(undefined)}
          className="border border-line bg-panel px-3 py-1.5 font-display text-xs font-semibold text-muted transition-colors hover:border-gold/50 hover:text-ink"
        >
          ข้าม (ไม่ระบุผู้ชนะ)
        </button>
        <button
          type="button"
          onClick={() => requestClose()}
          className="border border-line bg-panel-2 px-3.5 py-1.5 font-display text-xs font-semibold text-ink transition-colors hover:bg-panel"
        >
          ยกเลิก
        </button>
      </div>
        </>
      )}
    </Modal>
  );
}

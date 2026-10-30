import { PlusCircle, Swords, Users, X } from "lucide-react";
import { useId, useState } from "react";
import { Modal } from "./Modal";

interface NewSeriesModalProps {
  currentSeriesName?: string;
  defaultTeamA?: string;
  defaultTeamB?: string;
  hasCurrentActions: boolean;
  onConfirm: (teamA: string, teamB: string, seriesName?: string) => void;
  onClose: () => void;
}

const POPULAR_TEAMS = [
  // RPL (Thailand)
  "BRU",
  "BAC",
  "FS",
  "TLN",
  "EA",
  "KOG",
  "HD",
  "TEN",
  // AOG (Vietnam)
  "1S",
  "FL",
  "FPL",
  "GAM",
  "BOX",
  // GCS & APL
  "ONE",
  "HKA",
  "BMG",
  "DCG",
  "FW",
];

export function NewSeriesModal({
  currentSeriesName,
  defaultTeamA = "BAC",
  defaultTeamB = "TLN",
  hasCurrentActions,
  onConfirm,
  onClose,
}: NewSeriesModalProps) {
  const titleId = useId();
  const [teamA, setTeamA] = useState(defaultTeamA || "BAC");
  const [teamB, setTeamB] = useState(defaultTeamB || "TLN");
  const [customSeries, setCustomSeries] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalA = teamA.trim() || "TEAM A";
    const finalB = teamB.trim() || "TEAM B";
    const finalSeries = customSeries.trim() || `${finalA} vs ${finalB}`;
    onConfirm(finalA, finalB, finalSeries);
    onClose();
  };

  const currentPreview = customSeries.trim() || `${teamA.trim() || "TEAM A"} vs ${teamB.trim() || "TEAM B"}`;

  return (
    <Modal labelledBy={titleId} className="max-w-lg" onClose={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <Swords className="h-4 w-4 text-gold" />
          <div>
            <h2 id={titleId} className="font-display text-sm font-bold tracking-wider text-ink">
              เริ่มซีรีส์ / แมตช์ใหม่ (NEW SERIES)
            </h2>
            <p className="text-[11px] text-dim">
              สร้างคู่แข่งขันใหม่ — เริ่ม Game 1 สะอาดเอี่ยม และแยกประวัติออกจากแมตช์เดิม
              {currentSeriesName && <span className="text-muted"> (แมตช์ปัจจุบัน: {currentSeriesName})</span>}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-dim transition-colors hover:bg-panel-2 hover:text-ink"
          aria-label="ปิด"
        >
          <X size={18} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
        {hasCurrentActions && (
          <div className="border border-gold/40 bg-gold/10 px-3 py-2 text-[11px] leading-relaxed text-gold">
            💡 <strong>หมายเหตุ:</strong> มีฮีโร่ที่ดราฟต์ค้างอยู่ในกระดานปัจจุบัน
            {currentSeriesName ? ` ของ ${currentSeriesName}` : ""} ระบบจะ{" "}
            <strong>บันทึกเก็บเข้าประวัติแมตช์เดิมให้อัตโนมัติ</strong> ก่อนเริ่มแมตช์ใหม่
          </div>
        )}

        {/* Team Inputs */}
        <div className="grid grid-cols-2 gap-3">
          {/* Team A */}
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1 font-display text-xs font-bold text-blue">
              <span className="h-2 w-2 rounded-full bg-blue" />
              <span>ทีม A (เริ่มต้นฝั่ง BLUE)</span>
            </label>
            <input
              type="text"
              value={teamA}
              onChange={(e) => setTeamA(e.target.value.toUpperCase())}
              maxLength={14}
              placeholder="เช่น BRU, BAC"
              required
              className="h-9 border border-line bg-bg px-3 font-display text-sm font-bold text-ink focus:border-blue focus:outline-none"
            />
            {/* Quick Presets for Team A */}
            <div className="flex flex-wrap gap-1 pt-1">
              {POPULAR_TEAMS.slice(0, 8).map((t) => (
                <button
                  key={`a-${t}`}
                  type="button"
                  onClick={() => setTeamA(t)}
                  className={`px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors ${
                    teamA === t
                      ? "bg-blue text-ink"
                      : "border border-line bg-panel text-muted hover:border-blue/60 hover:text-ink"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Team B */}
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1 font-display text-xs font-bold text-red">
              <span className="h-2 w-2 rounded-full bg-red" />
              <span>ทีม B (เริ่มต้นฝั่ง RED)</span>
            </label>
            <input
              type="text"
              value={teamB}
              onChange={(e) => setTeamB(e.target.value.toUpperCase())}
              maxLength={14}
              placeholder="เช่น FS, TLN"
              required
              className="h-9 border border-line bg-bg px-3 font-display text-sm font-bold text-ink focus:border-red focus:outline-none"
            />
            {/* Quick Presets for Team B */}
            <div className="flex flex-wrap gap-1 pt-1">
              {POPULAR_TEAMS.slice(0, 8).map((t) => (
                <button
                  key={`b-${t}`}
                  type="button"
                  onClick={() => setTeamB(t)}
                  className={`px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors ${
                    teamB === t
                      ? "bg-red text-ink"
                      : "border border-line bg-panel text-muted hover:border-red/60 hover:text-ink"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Custom Series Name */}
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center justify-between font-display text-xs font-medium text-muted">
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5 text-gold" />
              <span>ชื่อกลุ่ม / ชื่อซีรีส์ (ไม่บังคับ)</span>
            </span>
            <span className="font-mono text-[10px] text-dim">
              ค่าเริ่มต้น: {teamA.trim() || "A"} vs {teamB.trim() || "B"}
            </span>
          </label>
          <input
            type="text"
            value={customSeries}
            onChange={(e) => setCustomSeries(e.target.value)}
            placeholder={`เช่น ${teamA || "TEAM A"} vs ${teamB || "TEAM B"} (Playoffs)`}
            maxLength={32}
            className="h-8 border border-line bg-bg px-3 font-display text-xs text-ink placeholder:text-dim focus:border-gold focus:outline-none"
          />
        </div>

        {/* Summary Card */}
        <div className="border border-line bg-panel-2/50 p-3">
          <div className="text-[11px] text-dim">แมตช์ใหม่ที่จะเริ่ม:</div>
          <div className="mt-0.5 font-display text-sm font-bold text-gold">{currentPreview}</div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
            <span>กระดาน: GAME 1</span>
            <span>•</span>
            <span>สถิติ Global Ban: รีเซ็ตเป็น 0 ฮีโร่</span>
            <span>•</span>
            <span>ประวัติแมตช์เดิม: ยังอยู่ครบ</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-3.5 font-display text-xs font-semibold text-muted transition-colors hover:text-ink"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            className="flex h-9 items-center gap-1.5 border border-gold bg-gold px-4 font-display text-xs font-bold tracking-wider text-bg shadow-sm transition-colors hover:bg-gold/90"
          >
            <PlusCircle className="h-4 w-4" />
            <span>สร้างแมตช์ใหม่ และเริ่มดราฟต์</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}

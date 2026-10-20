import type { DuelSide } from "../../types/combat";

interface LevelSweepProps {
  sweep: DuelSide["level_sweep"];
  currentLevel: number;
  color: string;
}

/** Combo damage as % of enemy HP at every level, with the build kept fixed. */
export function LevelSweep({ sweep, currentLevel, color }: LevelSweepProps) {
  const killLevel = sweep.find((s) => s.pct_enemy_hp >= 100)?.level;
  const max = Math.max(100, ...sweep.map((s) => s.pct_enemy_hp));
  return (
    <div className="border border-line bg-panel p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1">
        <h3 className="font-display text-[11px] font-semibold tracking-[0.18em] text-muted">คอมโบตามเลเวล</h3>
        <span className="text-[10px] text-dim">
          {killLevel ? `คอมโบเดียวฆ่าได้ตั้งแต่ Lv.${killLevel}` : "คอมโบเดียวยังฆ่าไม่ได้ทุกเลเวล"}
        </span>
      </div>
      <div className="relative flex h-20 items-end gap-0.5">
        <div
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-gold/60"
          style={{ bottom: `${(100 / max) * 100}%` }}
        />
        {sweep.map((s) => (
          <div
            key={s.level}
            title={`Lv.${s.level}: ${s.burst.toLocaleString()} (${s.pct_enemy_hp}%)`}
            className={`flex-1 ${s.level === currentLevel ? "bg-gold" : color} ${s.pct_enemy_hp >= 100 ? "" : "opacity-60"}`}
            style={{ height: `${Math.max(2, (s.pct_enemy_hp / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between font-mono text-[9px] text-dim">
        <span>1</span>
        <span>15</span>
      </div>
    </div>
  );
}

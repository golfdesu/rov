import { type BuildStats, STAT_LABELS } from "../../types/combat";

interface StatSheetProps {
  stats: BuildStats;
  effectiveHp: { physical: number; magic: number };
}

const SOURCE_LABELS: [keyof BuildStats["sources"], string][] = [
  ["items", "ไอเทม"],
  ["arcana", "รูน"],
  ["enchantments", "พลังแฝง"],
];

const ALWAYS_SHOWN = new Set(["max_hp", "attack_damage", "armor", "magic_defense", "movement_speed"]);

function fmt(v: number, pct?: boolean): string {
  const s = v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return pct ? `${s}%` : s;
}

export function StatSheet({ stats, effectiveHp }: StatSheetProps) {
  const s = stats.stats;
  const base = stats.sources.level;
  const rows = STAT_LABELS.filter(
    (l) =>
      ALWAYS_SHOWN.has(l.key) ||
      (s[l.key] && l.key !== "critical_damage") ||
      (l.key === "critical_damage" && s.critical_chance > 0),
  );

  return (
    <div className="border border-line bg-panel p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1">
        <h3 className="font-display text-[11px] font-semibold tracking-[0.18em] text-muted">สเตตัส Lv.{stats.level}</h3>
        <span className="font-mono text-[10px] text-dim">
          EHP กายภาพ {fmt(Math.round(effectiveHp.physical))} · เวท {fmt(Math.round(effectiveHp.magic))}
        </span>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {rows.map((l) => {
            const baseVal = base[l.key];
            const bonus = baseVal !== undefined ? s[l.key] - baseVal : null;
            const breakdown = SOURCE_LABELS.map(([src, label]) => {
              const v = stats.sources[src][l.key];
              return v ? `${label} +${fmt(v)}` : null;
            }).filter(Boolean);
            return (
              <tr key={l.key} className="border-b border-line/50">
                <td className="py-1 text-muted">{l.label}</td>
                <td className="py-1 text-right text-[10px] text-dim">{breakdown.join(" · ")}</td>
                <td className="w-28 py-1 text-right font-mono tabular-nums">
                  {fmt(s[l.key], l.pct)}
                  {bonus !== null && Math.abs(bonus) >= 0.05 && (
                    <span className="ml-1 text-[10px] text-good">+{fmt(bonus)}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {s.cooldown_reduction_uncapped > s.cooldown_reduction && (
        <p className="mt-2 text-[10px] text-gold">
          ลดคูลดาวน์เกินเพดาน 40% (รวม {fmt(s.cooldown_reduction_uncapped)}%) ส่วนที่เกินเสียเปล่า
        </p>
      )}
      {stats.enchantments_unmodeled.length > 0 && (
        <p className="mt-1 text-[10px] text-dim">
          พลังแฝงที่ยังไม่คิดตัวเลข: {stats.enchantments_unmodeled.join(", ")}
        </p>
      )}
      {stats.items_missing_price.length > 0 && (
        <p className="mt-1 text-[10px] text-dim">ไอเทมไม่มีข้อมูลราคา: {stats.items_missing_price.join(", ")}</p>
      )}
    </div>
  );
}

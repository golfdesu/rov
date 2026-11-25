import { useLanguage } from "../../i18n/language";
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
  const { t } = useLanguage();
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
        <h3 className="font-display text-[11px] font-semibold tracking-[0.18em] text-muted">{t("สเตตัส Lv.")}{stats.level}</h3>
        <span className="font-mono text-[10px] text-dim">
          {t("EHP กายภาพ")} {fmt(Math.round(effectiveHp.physical))} {t("· เวท")} {fmt(Math.round(effectiveHp.magic))}
        </span>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {rows.map((l) => {
            const baseVal = base[l.key];
            const bonus = baseVal !== undefined ? s[l.key] - baseVal : null;
            const breakdown = SOURCE_LABELS.map(([src, label]) => {
              const v = stats.sources[src][l.key];
              return v ? `${t(label)} +${fmt(v, l.pct)}` : null;
            }).filter(Boolean);
            return (
              <tr key={l.key} className="border-b border-line/50">
                <td className="py-1 text-muted">{t(l.label)}</td>
                <td className="py-1 text-right text-[10px] text-dim">{breakdown.join(" · ")}</td>
                <td className="w-28 py-1 text-right font-mono tabular-nums">
                  {fmt(s[l.key], l.pct)}
                  {bonus !== null && Math.abs(bonus) >= 0.05 && (
                    <span className="ml-1 text-[10px] text-good">+{fmt(bonus, l.pct)}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {s.cooldown_reduction_uncapped > s.cooldown_reduction && (
        <p className="mt-2 text-[10px] text-gold">
          {t("CDR เกินเพดาน 40% (รวม")} {fmt(s.cooldown_reduction_uncapped)}{t("%)")}
        </p>
      )}
      {stats.enchantments_unmodeled.length > 0 && (
        <p className="mt-1 text-[10px] text-dim">
          {t("พลังแฝงที่ยังไม่คำนวณ:")} {stats.enchantments_unmodeled.join(", ")}
        </p>
      )}
      {stats.items_missing_price.length > 0 && (
        <p className="mt-1 text-[10px] text-dim">{t("ไม่มีข้อมูลราคา:")} {stats.items_missing_price.join(", ")}</p>
      )}
      {stats.item_warnings && stats.item_warnings.length > 0 && (
        <div className="mt-2 rounded border border-gold/35 bg-gold/10 px-2.5 py-1.5 text-[10px] text-gold">
          {stats.item_warnings.map((w, i) => (
            <p key={i} className="break-words">• {t(w)}</p>
          ))}
        </div>
      )}
    </div>
  );
}

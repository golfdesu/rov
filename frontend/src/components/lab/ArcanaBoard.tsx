import { Minus, Plus, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import type { CatalogArcana } from "../../types/combat";

interface ArcanaBoardProps {
  arcana: CatalogArcana[];
  chosen: Record<string, number>;
  maxPerColor: number;
  onChange: (arcana: Record<string, number>) => void;
}

type ArcanaColor = "Red" | "Purple" | "Green";

const COLOR_CONFIG: Record<
  ArcanaColor,
  { label: string; tag: string; border: string; bg: string; activeTab: string; ring: string }
> = {
  Red: {
    label: "รูนสีแดง",
    tag: "พลังโจมตี / พลังเวท / คริติคอล",
    border: "border-red/40",
    bg: "bg-red/10",
    activeTab: "border-red bg-red/20 text-red font-bold",
    ring: "ring-red/50",
  },
  Purple: {
    label: "รูนสีม่วง",
    tag: "พลังชีวิต / ดูดเลือด / ความเร็ว",
    border: "border-purple-400/40",
    bg: "bg-purple-500/10",
    activeTab: "border-purple-400 bg-purple-500/20 text-purple-300 font-bold",
    ring: "ring-purple-400/50",
  },
  Green: {
    label: "รูนสีเขียว",
    tag: "ลดคูลดาวน์ / เจาะเกราะ / เจาะเวท",
    border: "border-emerald-400/40",
    bg: "bg-emerald-500/10",
    activeTab: "border-emerald-400 bg-emerald-500/20 text-emerald-300 font-bold",
    ring: "ring-emerald-400/50",
  },
};

const STAT_NAMES_TH: Record<string, string> = {
  attack_damage: "พลังโจมตี",
  ability_power: "พลังเวท",
  armor: "เกราะ",
  magic_defense: "ต้านเวท",
  max_hp: "HP",
  critical_chance_pct: "คริติคอล",
  critical_damage_pct: "ดาเมจคริ",
  attack_speed_pct: "ความเร็วโจมตี",
  movement_speed_pct: "ความเร็วเคลื่อนที่",
  cooldown_reduction_pct: "ลดคูลดาวน์",
  armor_pierce: "เจาะเกราะ",
  magic_pierce: "เจาะเวท",
  life_steal_pct: "ดูดเลือด",
  magic_life_steal_pct: "เวทแวมไพร์",
  hp_regen_5s: "ฟื้นฟู HP/5วิ",
};

function formatArcanaStat(key: string, val: number): string {
  const name = STAT_NAMES_TH[key] ?? key;
  const isPct = key.endsWith("_pct");
  return `+${val}${isPct ? "%" : ""} ${name}`;
}

export function ArcanaBoard({ arcana, chosen, maxPerColor, onChange }: ArcanaBoardProps) {
  const [activeColor, setActiveColor] = useState<ArcanaColor>("Red");

  const byColor = useMemo(() => {
    const map: Record<ArcanaColor, CatalogArcana[]> = { Red: [], Purple: [], Green: [] };
    for (const a of arcana) {
      if (a.color in map) {
        map[a.color as ArcanaColor].push(a);
      }
    }
    return map;
  }, [arcana]);

  const countByColor = useMemo(() => {
    const counts: Record<ArcanaColor, number> = { Red: 0, Purple: 0, Green: 0 };
    for (const a of arcana) {
      const c = chosen[a.name] ?? 0;
      if (a.color in counts) {
        counts[a.color as ArcanaColor] += c;
      }
    }
    return counts;
  }, [arcana, chosen]);

  const totalUsed = countByColor.Red + countByColor.Purple + countByColor.Green;
  const maxTotal = maxPerColor * 3;

  const handleAdjust = (name: string, color: ArcanaColor, delta: number) => {
    const cur = chosen[name] ?? 0;
    const colorUsed = countByColor[color];
    const availableInColor = maxPerColor - colorUsed;

    const nextVal = Math.max(0, Math.min(cur + delta, cur + availableInColor));
    const next = { ...chosen, [name]: nextVal };
    if (!nextVal) delete next[name];
    onChange(next);
  };

  const handleFillTen = (name: string, color: ArcanaColor) => {
    const cur = chosen[name] ?? 0;
    const otherInColor = countByColor[color] - cur;
    const canFill = maxPerColor - otherInColor;
    if (canFill <= 0) return;

    const next = { ...chosen, [name]: canFill };
    onChange(next);
  };

  const handleClearColor = (color: ArcanaColor) => {
    const next = { ...chosen };
    for (const a of byColor[color]) {
      delete next[a.name];
    }
    onChange(next);
  };

  const handleClearAll = () => {
    onChange({});
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-panel p-3">
      {/* Header & Total Counter */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-2">
        <div className="flex items-center gap-2">
          <span className="font-display text-xs font-bold tracking-wider text-ink">รูน (Tier 3 Arcana)</span>
          <span className="rounded bg-panel-2 px-2 py-0.5 font-mono text-[11px] font-semibold text-muted">
            รวม {totalUsed} / {maxTotal} เม็ด
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleClearColor(activeColor)}
            className="text-[10px] text-dim hover:text-muted"
          >
            ล้างสีนี้
          </button>
          <span className="text-dim">·</span>
          <button
            type="button"
            onClick={handleClearAll}
            className="flex items-center gap-1 text-[10px] text-dim hover:text-red"
          >
            <RotateCcw size={10} />
            ล้างทั้งหมด
          </button>
        </div>
      </div>

      {/* Color Tabs */}
      <div className="grid grid-cols-3 gap-1.5">
        {(["Red", "Purple", "Green"] as const).map((color) => {
          const cfg = COLOR_CONFIG[color];
          const count = countByColor[color];
          const isSelected = activeColor === color;
          return (
            <button
              key={color}
              type="button"
              onClick={() => setActiveColor(color)}
              className={`flex flex-col items-center justify-center rounded-md border p-1.5 text-xs transition-all ${
                isSelected
                  ? cfg.activeTab
                  : "border-line/60 bg-bg/40 text-muted hover:border-line hover:text-ink"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="font-semibold">{cfg.label}</span>
                <span className="font-mono text-[11px] font-bold">
                  ({count}/{maxPerColor})
                </span>
              </div>
              <span className="text-[9px] text-dim line-clamp-1">{cfg.tag}</span>
            </button>
          );
        })}
      </div>

      {/* Arcana Grid for Selected Color */}
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {byColor[activeColor].map((a) => {
          const count = chosen[a.name] ?? 0;
          const statsStr = Object.entries(a.stats)
            .map(([k, v]) => formatArcanaStat(k, v))
            .join(" · ");
          const isFilled = count > 0;

          return (
            <div
              key={a.name}
              className={`flex items-center gap-2.5 rounded-lg border p-2 transition-all ${
                isFilled
                  ? "border-gold/60 bg-panel-2 ring-1 ring-gold/40 shadow-sm"
                  : "border-line/50 bg-bg/30 hover:border-line hover:bg-bg/60"
              }`}
            >
              {/* Large Arcana Icon */}
              <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md border border-line/60 bg-bg/80 p-0.5">
                <img
                  src={a.icon}
                  alt={a.name}
                  className="h-full w-full object-contain"
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              </div>

              {/* Names & Stats */}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs font-bold text-ink">
                    {a.name_th ? `${a.name_th} (${a.name})` : a.name}
                  </span>
                </div>
                <div className="text-[10px] font-medium leading-tight text-gold line-clamp-1">
                  {statsStr}
                </div>
              </div>

              {/* Adjust Controls */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  aria-label={`ลด ${a.name}`}
                  onClick={() => handleAdjust(a.name, activeColor, -1)}
                  disabled={count <= 0}
                  className="grid h-7 w-7 place-items-center rounded border border-line bg-panel text-dim hover:border-muted hover:text-ink disabled:opacity-20"
                >
                  <Minus size={13} />
                </button>

                <span
                  className={`w-6 text-center font-mono text-xs font-bold tabular-nums ${
                    count > 0 ? "text-gold" : "text-dim"
                  }`}
                >
                  {count}
                </span>

                <button
                  type="button"
                  aria-label={`เพิ่ม ${a.name}`}
                  onClick={() => handleAdjust(a.name, activeColor, 1)}
                  disabled={countByColor[activeColor] >= maxPerColor}
                  className="grid h-7 w-7 place-items-center rounded border border-line bg-panel text-dim hover:border-muted hover:text-ink disabled:opacity-20"
                >
                  <Plus size={13} />
                </button>

                <button
                  type="button"
                  onClick={() => handleFillTen(a.name, activeColor)}
                  disabled={countByColor[activeColor] >= maxPerColor && count === 10}
                  className="ml-0.5 rounded border border-line/60 bg-bg px-1.5 py-1 text-[10px] font-mono font-bold text-muted hover:border-gold hover:text-gold disabled:opacity-20"
                  title="ใส่เต็ม 10 เม็ด"
                >
                  +10
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { StableButtonLabel } from "../StableButtonLabel";
import { useLanguage } from "../../i18n/language";
import { ArrowLeftRight, Copy } from "lucide-react";
import type { DuelResult, Side } from "../../types/combat";
import { displayName } from "../../utils/heroNames";

interface DuelSummaryProps {
  result: DuelResult;
  heroA: string;
  heroB: string;
  isLoading: boolean;
  onSwap: () => void;
  onMirror: (from: Side) => void;
  enableKiting?: boolean;
  onToggleKiting?: () => void;
  enableActives?: boolean;
  onToggleActives?: () => void;
  onReset?: () => void;
}

function HpChart({
  timeline,
  maxA,
  maxB,
}: {
  timeline: DuelResult["simulation"]["timeline"];
  maxA: number;
  maxB: number;
}) {
  const { t } = useLanguage();
  if (timeline.length < 2) return null;
  const w = 300;
  const h = 80;
  const tMax = timeline[timeline.length - 1].t || 1;
  const path = (key: "hp_a" | "hp_b", max: number) =>
    timeline
      .map((p, i) => `${i ? "L" : "M"}${((p.t / tMax) * w).toFixed(1)},${(h - (p[key] / max) * h).toFixed(1)}`)
      .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-20 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={t("กราฟ HP ระหว่างดวล")}
    >
      <path
        d={path("hp_a", maxA)}
        fill="none"
        stroke="var(--color-blue)"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={path("hp_b", maxB)}
        fill="none"
        stroke="var(--color-red)"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function SideColumn({
  label,
  color,
  data,
  sim,
}: {
  label: string;
  color: string;
  data: DuelResult["a"];
  sim: DuelResult["simulation"]["a"];
}) {
  const { t } = useLanguage();
  const top = Object.entries(sim.damage_breakdown).slice(0, 4);
  return (
    <div className="min-w-0 flex-1">
      <div className={`font-display text-sm font-bold ${color}`}>{label}</div>
      <div className="font-mono text-xl font-bold tabular-nums">
        {sim.remaining_hp_pct}%<span className="ml-1 text-[10px] font-normal text-dim">{t("HP เหลือ")}</span>
      </div>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-[11px]">
        <dt className="text-dim">{t("คอมโบ")}</dt>
        <dd className="text-right font-mono">{data.burst_pct_enemy_hp}%</dd>
        <dt className="text-dim">{t("DPS ตีปกติ")}</dt>
        <dd className="text-right font-mono">{data.basic_attack.dps.toLocaleString()}</dd>
        <dt className="text-dim">{t("ดาเมจรวม")}</dt>
        <dd className="text-right font-mono">{sim.damage_dealt.toLocaleString()}</dd>
        {data.burst_per_1000_gold !== null && (
          <>
            <dt className="text-dim">{t("คอมโบ/1000g")}</dt>
            <dd className="text-right font-mono">{data.burst_per_1000_gold.toLocaleString()}</dd>
          </>
        )}
        {sim.kiting && (sim.kiting.initial_delay > 0 || sim.kiting.interval_multiplier > 1.01) && (
          <>
            <dt className="text-dim">{t("ถูกคุมระยะ Kite")}</dt>
            <dd className="text-right font-mono text-gold">
              +{sim.kiting.initial_delay.toFixed(2)}{t("วิ / ×")}{sim.kiting.interval_multiplier.toFixed(2)}
            </dd>
          </>
        )}
      </dl>
      <ul className="mt-1 text-[10px] text-muted">
        {top.map(([k, v]) => (
          <li key={k} className="flex justify-between gap-2">
            <span className="truncate">{k}</span>
            <span className="font-mono">{v.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DuelSummary({
  result,
  heroA,
  heroB,
  isLoading,
  onSwap,
  onMirror,
  enableKiting = true,
  onToggleKiting,
  enableActives = true,
  onToggleActives,
  onReset,
}: DuelSummaryProps) {
  const { t } = useLanguage();
  const sim = result.simulation;
  const nameA = displayName(heroA);
  const nameB = displayName(heroB);
  const verdict =
    sim.winner === "a"
      ? t("{0} ชนะ", nameA)
      : sim.winner === "b"
        ? t("{0} ชนะ", nameB)
        : sim.winner === "draw"
          ? t("ตายพร้อมกัน")
          : t("ไม่มีใครตายใน 60 วินาที");
  const verdictColor = sim.winner === "a" ? "text-blue" : sim.winner === "b" ? "text-red" : "text-gold";

  return (
    <div className={`border border-line-strong bg-panel p-3 transition-opacity ${isLoading ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-display text-[10px] tracking-[0.2em] text-dim">{t("ผลดวล 1v1")}</div>
          <div className={`font-display text-2xl font-bold ${verdictColor}`}>{verdict}</div>
          {sim.time_to_kill !== null && (
            <div className="font-mono text-xs text-muted">{t("ใช้เวลา")} {sim.time_to_kill} {t("วินาที")}</div>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {onToggleKiting && (
            <button
              type="button"
              onClick={onToggleKiting}
              aria-pressed={enableKiting}
              title={t("เปิด/ปิด การคำนวณระยะยิงตอดและจังหวะ Kiting ของฮีโร่ตีไกลเทียบตัวประชิด")}
              className={`border px-2 py-1 text-[11px] font-medium transition-colors ${
                enableKiting
                  ? "border-gold/60 bg-gold/15 text-gold"
                  : "border-line text-muted hover:text-ink"
              }`}
            >
              Kiting: <StableButtonLabel message={enableKiting ? "เปิด" : "ปิด"} alternatives={["เปิด", "ปิด"]} />
            </button>
          )}
          {onToggleActives && (
            <button
              type="button"
              onClick={onToggleActives}
              aria-pressed={enableActives}
              title={t("เปิด/ปิด เอฟเฟกต์สกิลกดใช้ของไอเทม (Rock Shield / Bow of Slaughter ฯลฯ)")}
              className={`border px-2 py-1 text-[11px] font-medium transition-colors ${
                enableActives
                  ? "border-gold/60 bg-gold/15 text-gold"
                  : "border-line text-muted hover:text-ink"
              }`}
            >
              <StableButtonLabel message="Active ไอเทม:" /> <StableButtonLabel message={enableActives ? "เปิด" : "ปิด"} alternatives={["เปิด", "ปิด"]} />
            </button>
          )}
          <button
            type="button"
            onClick={onSwap}
            className="flex items-center gap-1 border border-line px-2 py-1 text-[11px] text-muted hover:text-ink"
          >
            <ArrowLeftRight size={12} /> <StableButtonLabel message="สลับฝั่ง" />
          </button>
          <button
            type="button"
            onClick={() => onMirror("a")}
            className="flex items-center gap-1 border border-line px-2 py-1 text-[11px] text-muted hover:text-ink"
          >
            <Copy size={12} /> <StableButtonLabel message="ให้ B ใส่ของเหมือน A" />
          </button>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="border border-line px-2 py-1 text-[11px] text-muted hover:border-red/60 hover:text-red"
            >
              <StableButtonLabel message="รีเซ็ต" />
            </button>
          )}
        </div>
      </div>

      <HpChart timeline={sim.timeline} maxA={result.a.build.stats.max_hp} maxB={result.b.build.stats.max_hp} />

      <div className="mt-2 flex gap-4">
        <SideColumn label={nameA} color="text-blue" data={result.a} sim={sim.a} />
        <SideColumn label={nameB} color="text-red" data={result.b} sim={sim.b} />
      </div>

      <details className="mt-3 text-[10px] text-dim">
        <summary className="cursor-pointer">{t("สมมติฐานของการจำลอง")}</summary>
        <ul className="mt-1 list-disc pl-4">
          {result.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

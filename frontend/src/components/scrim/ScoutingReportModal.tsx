import { Check, Copy, FileText, Flame, Layers, Printer, ShieldAlert, Swords, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../../i18n/language";
import type { Hero } from "../../types/draft";
import { LANE_SHORT } from "../../utils/draft";
import { displayName } from "../../utils/heroNames";
import {
  buildScoutingReportMarkdown,
  COMP_ARCHETYPE_LABELS,
  type PeriodDiffSummary,
  type ScrimAdvancedStats,
} from "../../utils/scrimAdvancedStats";
import { printScoutingReportPdf } from "../../utils/scoutingReportPdf";
import type { AllTeamsAnalyticsSummary, ScrimAnalyticsSummary } from "../../utils/scrimStats";
import { HeroPortrait } from "../HeroPortrait";
import { LaneIcon } from "../LaneIcon";

function wrPct(wins: number, decided: number): string {
  return decided > 0 ? `${((wins / decided) * 100).toFixed(1)}%` : "—";
}

export function ScoutingReportModal({
  open,
  onClose,
  focusTeam,
  opponentFilter,
  stats,
  allStats,
  advanced,
  periodDiff,
  heroMap,
}: {
  open: boolean;
  onClose: () => void;
  focusTeam: string;
  opponentFilter: string;
  stats: ScrimAnalyticsSummary;
  allStats: AllTeamsAnalyticsSummary | null;
  advanced: ScrimAdvancedStats;
  periodDiff?: PeriodDiffSummary | null;
  heroMap: Map<string, Hero>;
}) {
  const { language, t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const isAll = !focusTeam.trim() && allStats !== null;
  const headerTitle = isAll
    ? t("ใบสรุปสเกาต์: ภาพรวมทุกทีม")
    : `${t("ใบสรุปสเกาต์")}: ${focusTeam}${opponentFilter !== "ALL" ? ` vs ${opponentFilter}` : ""}`;

  const highRiskLanes = advanced.positionalPools.filter((p) => p.squeezeRisk === "high" || p.squeezeRisk === "medium");
  const blindSafe = advanced.blindCounterHeroes.filter((h) => h.classification === "blind_safe").slice(0, 5);
  const counterSpec = advanced.blindCounterHeroes.filter((h) => h.classification === "counter_specialist").slice(0, 5);
  const topFlex = advanced.flexSummary.flexHeroes.slice(0, 6);
  const topOpenings = advanced.compSummary.topOpenings.slice(0, 5);
  const topBans = isAll && allStats ? allStats.topBans.slice(0, 6) : stats.bansAgainstUs.slice(0, 6);
  const topHeroPicks = [...(isAll && allStats ? allStats.heroList : stats.allyList)]
    .filter((h) => h.games > 0)
    .sort((a, b) => b.games - a.games || b.wins - a.wins)
    .slice(0, 8);
  const activeDuos = (isAll && allStats ? allStats.topDuos : stats.topDuos).slice(0, 5);

  async function handleCopy() {
    const markdown = buildScoutingReportMarkdown({
      focusTeam,
      opponentFilter,
      stats,
      allStats,
      advanced,
      t,
    });
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be blocked in restricted browser contexts.
    }
  }

  async function handlePrintPdf() {
    if (printing) return;
    setPrinting(true);
    try {
      await printScoutingReportPdf({
        focusTeam,
        opponentFilter,
        stats,
        allStats,
        advanced,
        periodDiff,
        heroMap,
        language,
        t,
      });
    } finally {
      setPrinting(false);
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scouting-report-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/85 p-3 backdrop-blur-xs sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col border border-line-strong bg-panel shadow-2xl">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="size-4 shrink-0 text-gold" aria-hidden="true" />
            <h2 id="scouting-report-title" className="truncate font-display text-sm font-extrabold tracking-wide text-ink sm:text-base">
              {headerTitle}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex min-h-8 items-center gap-1.5 border border-gold/50 bg-gold/10 px-3 font-display text-xs font-bold text-gold hover:bg-gold hover:text-bg"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              <span>{t(copied ? "คัดลอกแล้ว" : "คัดลอกข้อความสรุป")}</span>
            </button>
            <button
              type="button"
              disabled={printing}
              onClick={() => void handlePrintPdf()}
              className="inline-flex min-h-8 items-center gap-1.5 border border-line-strong bg-bg px-3 font-display text-xs font-bold text-ink hover:border-gold/60 hover:text-gold disabled:opacity-60"
            >
              <Printer className="size-3.5" />
              <span>{t(printing ? "กำลังเตรียม PDF…" : "พิมพ์ / บันทึก PDF")}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("ปิดหน้าต่าง")}
              className="grid size-8 place-items-center border border-line bg-bg text-muted hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-xs">
          {/* Executive KPIs Strip */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="border border-line bg-bg p-2.5">
              <p className="font-mono text-[10px] text-dim">{t("ขอบเขตข้อมูล")}</p>
              <p className="mt-0.5 font-mono text-base font-extrabold text-ink">
                {isAll && allStats ? `${allStats.total}g (${allStats.seriesCount}s)` : `${stats.total}g (${stats.seriesCount}s)`}
              </p>
            </div>
            <div className="border border-line bg-bg p-2.5">
              <p className="font-mono text-[10px] text-dim">{isAll ? "Blue vs Red" : t("Win Rate รวม")}</p>
              <p className="mt-0.5 font-mono text-base font-extrabold text-gold">
                {isAll && allStats
                  ? `${wrPct(allStats.blueWins, allStats.decided)} / ${wrPct(allStats.redWins, allStats.decided)}`
                  : `${wrPct(stats.wins, stats.decided)} (${stats.wins}-${stats.losses})`}
              </p>
            </div>
            <div className="border border-line bg-bg p-2.5">
              <p className="font-mono text-[10px] text-dim">{t("แยกฝั่ง Blue / Red")}</p>
              <p className="mt-0.5 font-mono text-sm font-bold text-ink">
                <span className="text-blue">B {isAll && allStats ? wrPct(allStats.blueWins, allStats.decided) : wrPct(stats.blueWins, stats.blueDecided)}</span>
                {" · "}
                <span className="text-red">R {isAll && allStats ? wrPct(allStats.redWins, allStats.decided) : wrPct(stats.redWins, stats.redDecided)}</span>
              </p>
            </div>
            <div className="border border-line bg-bg p-2.5">
              <p className="font-mono text-[10px] text-dim">
                {isAll ? t("คลังฮีโร่รวม") : t("โอกาสปิดซีรีส์:")}
              </p>
              <p className="mt-0.5 font-mono text-sm font-bold text-ink">
                {isAll && allStats
                  ? `${allStats.uniqueHeroCount} ${t("ตัว")} (Eff ${allStats.effectiveHeroPool.toFixed(1)})`
                  : stats.seriesWinProb
                    ? `Bo5 ${stats.seriesWinProb.bo5Pct.toFixed(0)}% · Bo7 ${stats.seriesWinProb.bo7Pct.toFixed(0)}%`
                    : "—"}
              </p>
            </div>
          </div>

          {/* 5-Lane Positional Pool Snapshot */}
          <section className="border border-line bg-bg p-3">
            <h3 className="mb-2 flex items-center gap-1.5 font-display text-xs font-bold text-gold">
              <Layers className="size-3.5" />
              <span>{t("คลังฮีโร่ 5 เลน & จุดเสี่ยงโดนบีบแบน")}</span>
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
              {advanced.positionalPools.map((pool) => (
                <div key={pool.lane} className="border border-line/70 bg-panel p-2">
                  <div className="flex items-center justify-between gap-1 font-mono text-[11px]">
                    <span className="inline-flex items-center gap-1 font-bold text-ink">
                      <LaneIcon lane={pool.lane} className="size-3.5 text-gold" />
                      {LANE_SHORT[pool.lane]?.en ?? pool.lane}
                    </span>
                    <span className={pool.squeezeRisk === "high" ? "text-red" : pool.squeezeRisk === "medium" ? "text-gold" : "text-good"}>
                      Eff {pool.effectivePool.toFixed(1)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[10px] text-muted">
                    {pool.topHeroes.slice(0, 2).map((h) => `${displayName(h.hero)}(${h.games})`).join(", ") || "—"}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* 2-col Scouting Details */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <section className="border border-line bg-bg p-3">
              <h3 className="mb-2 flex items-center gap-1.5 font-display text-xs font-bold text-red">
                <ShieldAlert className="size-3.5" />
                <span>{t("จุดเสี่ยงโดนบีบแบน (เลนคลังตื้น)")}</span>
              </h3>
              {highRiskLanes.length === 0 ? (
                <p className="text-dim">{t("คลังฮีโร่กระจายดีทุกเลน ยังไม่มีเลนเสี่ยง")}</p>
              ) : (
                <ul className="space-y-1.5">
                  {highRiskLanes.map((p) => (
                    <li key={p.lane} className="flex items-center justify-between gap-2 border border-line/70 bg-panel px-2 py-1.5">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                        <LaneIcon lane={p.lane} className="size-3.5 text-gold" />
                        <span>{LANE_SHORT[p.lane]?.en ?? p.lane}</span>
                        <span className={p.squeezeRisk === "high" ? "font-mono text-[10px] text-red" : "font-mono text-[10px] text-gold"}>
                          ({p.squeezeRisk === "high" ? t("เสี่ยงโดนบีบสูง") : t("เสี่ยงปานกลาง")})
                        </span>
                      </span>
                      <span className="font-mono text-[11px] text-muted">
                        Eff {p.effectivePool.toFixed(1)} · {p.topHeroes.slice(0, 2).map((h) => displayName(h.hero)).join(", ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="border border-line bg-bg p-3">
              <h3 className="mb-2 font-display text-xs font-bold text-gold">
                {t("ตัวโดนแบนบ่อย & คู่เปิด Phase 1")}
              </h3>
              {topBans.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {topBans.map((b) => (
                    <span key={b.hero} className="inline-flex items-center gap-1 border border-red/35 bg-red/10 px-1.5 py-0.5 font-mono text-[11px] text-ink">
                      <div className="size-4 shrink-0 overflow-hidden">
                        <HeroPortrait name={b.hero} hero={heroMap.get(b.hero)} />
                      </div>
                      <span>{displayName(b.hero)}</span>
                      <strong className="text-red">{b.total}</strong>
                    </span>
                  ))}
                </div>
              )}
              {topOpenings.length === 0 ? (
                <p className="text-dim">{t("ยังไม่มีคู่เปิดเกมซ้ำ")}</p>
              ) : (
                <ul className="space-y-1">
                  {topOpenings.slice(0, 4).map((op) => (
                    <li key={`${op.a}-${op.b}`} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-semibold text-ink">{displayName(op.a)} + {displayName(op.b)}</span>
                      <span className="font-mono text-muted">
                        {op.games}g · <strong className="text-good">{wrPct(op.wins, op.decided)}</strong>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="border border-line bg-bg p-3">
              <h3 className="mb-2 font-display text-xs font-bold text-blue">
                {t("เปิดก่อนคุ้ม / ตัวแก้ทาง / ตัว Flex")}
              </h3>
              <div className="space-y-1.5 text-[11px]">
                <p>
                  <strong className="text-good">{t("เปิดก่อนคุ้ม:")}</strong>{" "}
                  <span className="text-ink">
                    {blindSafe.length > 0 ? blindSafe.map((h) => `${displayName(h.hero)} (${h.p1WrPct?.toFixed(0)}%)`).join(", ") : "—"}
                  </span>
                </p>
                <p>
                  <strong className="text-blue">{t("ตัวแก้ทาง:")}</strong>{" "}
                  <span className="text-ink">
                    {counterSpec.length > 0 ? counterSpec.map((h) => `${displayName(h.hero)} (${h.p2WrPct?.toFixed(0)}%)`).join(", ") : "—"}
                  </span>
                </p>
                <p>
                  <strong className="text-gold">{t("Flex:")}</strong>{" "}
                  <span className="text-ink">
                    {topFlex.length > 0 ? topFlex.map((h) => `${displayName(h.hero)} (${h.laneBreakdown.length}L)`).join(", ") : "—"}
                  </span>
                </p>
              </div>
              {advanced.compSummary.archetypeStats.length > 0 && (
                <p className="mt-2 border-t border-line/70 pt-1.5 text-[11px] text-muted">
                  <strong className="text-ink">{t("คอมพ์:")}</strong>{" "}
                  {advanced.compSummary.archetypeStats
                    .slice(0, 3)
                    .map((a) => `${t(COMP_ARCHETYPE_LABELS[a.key])} (${a.sharePct.toFixed(0)}%)`)
                    .join(" · ")}
                </p>
              )}
            </section>

            <section className="border border-line bg-bg p-3">
              <h3 className="mb-2 flex items-center gap-1.5 font-display text-xs font-bold text-good">
                <Swords className="size-3.5" />
                <span>{t(isAll ? "สามประสาน & ตัวนิยมสูงสุด" : "ฮีโร่ที่ชนะทางทีมนี้ & สามประสาน")}</span>
              </h3>
              {!isAll && stats.toughestEnemies.length > 0 && (
                <p className="mb-2 text-[11px] text-ink">
                  <strong className="text-red">{t("แพ้ทางเมื่อเจอ:")}</strong>{" "}
                  {stats.toughestEnemies
                    .slice(0, 4)
                    .map((e) => `${displayName(e.hero)} (${e.ourWins}-${e.ourLosses})`)
                    .join(", ")}
                </p>
              )}
              {activeDuos.length > 0 && (
                <p className="mb-1.5 text-[11px] text-ink">
                  <strong className="text-good">{t("คู่คอมโบ:")}</strong>{" "}
                  {activeDuos.slice(0, 3).map((d) => `${displayName(d.a)}+${displayName(d.b)} (${wrPct(d.wins, d.decided)})`).join(", ")}
                </p>
              )}
              {advanced.trioSummary.coreAxisTrios.length > 0 ? (
                <ul className="space-y-1 text-[11px]">
                  {advanced.trioSummary.coreAxisTrios.slice(0, 3).map((trio) => (
                    <li key={trio.heroes.join("-")} className="flex items-center justify-between gap-2">
                      <span className="truncate text-ink">{trio.heroes.map((h) => displayName(h)).join(" + ")}</span>
                      <span className="shrink-0 font-mono text-good">
                        {trio.games}g ({trio.wins}-{trio.losses})
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-dim">{t("ยังไม่มีแกน 3 ตัวซ้ำ")}</p>
              )}
            </section>
          </div>

          {/* Top Priority Heroes Strip */}
          {topHeroPicks.length > 0 && (
            <section className="border border-line bg-bg p-3">
              <h3 className="mb-2 flex items-center gap-1.5 font-display text-xs font-bold text-ink">
                <Flame className="size-3.5 text-gold" />
                <span>{t("ฮีโร่หลักที่ใช้บ่อย (Top {0})", topHeroPicks.length)}</span>
              </h3>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {topHeroPicks.map((h) => (
                  <div key={h.hero} className="flex items-center justify-between gap-1.5 border border-line/70 bg-panel px-2 py-1 text-[11px]">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <div className="size-5 shrink-0 overflow-hidden border border-line">
                        <HeroPortrait name={h.hero} hero={heroMap.get(h.hero)} />
                      </div>
                      <span className="truncate font-semibold text-ink">{displayName(h.hero)}</span>
                    </div>
                    <span className="shrink-0 font-mono tabular-nums text-muted">
                      {h.games}g · <strong className={h.decided > 0 && h.wins / h.decided >= 0.5 ? "text-good" : "text-red"}>{wrPct(h.wins, h.decided)}</strong>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

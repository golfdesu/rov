import {
  Activity,
  ChevronDown,
  ChevronUp,
  Compass,
  Crosshair,
  Flame,
  GitCompareArrows,
  Layers,
  Repeat,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useLanguage } from "../../i18n/language";
import type { Hero, RecordedDraftGame, TournamentRef } from "../../types/draft";
import { LANE_SHORT } from "../../utils/draft";
import { displayName } from "../../utils/heroNames";
import {
  COMP_ARCHETYPE_LABELS,
  computePeriodDiff,
  splitGamesForPeriodDiff,
  type PeriodDiffMode,
  type PeriodDiffSummary,
  type ScrimAdvancedStats,
  type SqueezeRiskLevel,
} from "../../utils/scrimAdvancedStats";
import { HeroPortrait } from "../HeroPortrait";
import { LaneIcon } from "../LaneIcon";

function wrText(wins: number, decided: number): string {
  return decided > 0 ? `${((wins / decided) * 100).toFixed(1)}%` : "—";
}

function fmtSigned(v: number, digits = 1): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function CollapsibleCard({
  id,
  as = "div",
  className = "",
  title,
  icon,
  badge,
  headerRight,
  defaultCollapsed = false,
  children,
}: {
  id?: string;
  as?: "div" | "section";
  className?: string;
  title: string;
  icon?: ReactNode;
  badge?: ReactNode;
  headerRight?: ReactNode;
  defaultCollapsed?: boolean;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const Tag = as;

  return (
    <Tag id={id} className={`border border-line bg-panel p-4 ${className}`.trim()}>
      <div className={`flex flex-wrap items-center justify-between gap-2 ${collapsed ? "" : "mb-3"}`}>
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <h2 className="font-display text-sm font-bold tracking-wider text-ink">{title}</h2>
          {badge}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {headerRight}
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-label={t(collapsed ? "กางกล่องวิเคราะห์" : "พับกล่องวิเคราะห์")}
            onClick={() => setCollapsed((v) => !v)}
            className="inline-flex min-h-8 items-center gap-1 border border-line bg-bg px-2.5 font-mono text-[11px] font-semibold text-muted transition-colors hover:border-gold/50 hover:text-gold"
          >
            {collapsed ? (
              <>
                <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
                <span>{t("กางดู")}</span>
              </>
            ) : (
              <>
                <ChevronUp className="size-3.5 shrink-0" aria-hidden="true" />
                <span>{t("พับเก็บ")}</span>
              </>
            )}
          </button>
        </div>
      </div>
      {!collapsed && children}
    </Tag>
  );
}

function CardExpandButton({
  expanded,
  totalCount,
  previewLimit,
  onToggle,
}: {
  expanded: boolean;
  totalCount: number;
  previewLimit: number;
  onToggle: () => void;
}) {
  const { t } = useLanguage();
  if (totalCount <= previewLimit) return null;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className="mt-2.5 flex min-h-8 w-full items-center justify-center gap-1.5 border border-line bg-bg/70 px-2.5 py-1 font-mono text-[11px] font-semibold text-muted transition-colors hover:border-gold/50 hover:text-gold"
    >
      {expanded ? (
        <>
          <ChevronUp className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{t("ย่อกลับ")}</span>
        </>
      ) : (
        <>
          <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{t("ดูทั้งหมด ({0})", totalCount)}</span>
        </>
      )}
    </button>
  );
}

function riskBadge(risk: SqueezeRiskLevel, t: (m: string) => string) {
  if (risk === "high") {
    return {
      label: t("เสี่ยงโดนบีบสูง"),
      cls: "border-red/50 bg-red/15 text-red",
    };
  }
  if (risk === "medium") {
    return {
      label: t("เสี่ยงปานกลาง"),
      cls: "border-gold/50 bg-gold/15 text-gold",
    };
  }
  if (risk === "low") {
    return {
      label: t("คลังลึก"),
      cls: "border-good/50 bg-good/15 text-good",
    };
  }
  return {
    label: t("ข้อมูลน้อย"),
    cls: "border-line bg-panel-2 text-dim",
  };
}

export function PositionalPoolCard({
  advanced,
  heroMap,
}: {
  advanced: ScrimAdvancedStats;
  heroMap: Map<string, Hero>;
}) {
  const { t } = useLanguage();
  const hasLaneData = advanced.positionalPools.some((p) => p.totalPicks > 0);
  const highRiskCount = advanced.positionalPools.filter((p) => p.squeezeRisk === "high").length;

  return (
    <CollapsibleCard
      title={t("คลังฮีโร่ 5 เลน & จุดเสี่ยงโดนบีบแบน")}
      icon={<Layers className="size-4 shrink-0 text-gold" />}
      badge={
        highRiskCount > 0 ? (
          <span className="border border-red/40 bg-red/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-red">
            {t("เลนเสี่ยงสูง {0} เลน", highRiskCount)}
          </span>
        ) : undefined
      }
    >
      {!hasLaneData ? (
        <p className="text-xs text-dim">{t("ยังไม่มีข้อมูลตำแหน่งเลนของฮีโร่ในชุดเกมนี้")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {advanced.positionalPools.map((pool) => {
            const badge = riskBadge(pool.squeezeRisk, t);
            const short = LANE_SHORT[pool.lane];
            return (
              <div key={pool.lane} className="flex flex-col justify-between border border-line bg-bg p-3">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <LaneIcon lane={pool.lane} className="size-4 text-gold" />
                      <span className="font-mono text-xs font-bold text-ink">{short?.en ?? pool.lane}</span>
                      <span className="text-[11px] text-dim">{t(short?.th ?? "")}</span>
                    </div>
                    <span className={`border px-1.5 py-0.5 font-mono text-[10px] font-bold ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>

                  <div className="mb-2 flex items-baseline justify-between font-mono text-xs tabular-nums">
                    <div>
                      <strong className="text-lg text-ink">{pool.uniqueHeroes}</strong>{" "}
                      <span className="text-[11px] text-dim">{t("ตัว")}</span>
                    </div>
                    <div className="text-right text-[11px] text-muted">
                      {t("ตัวหลัก")} <strong className="text-gold">{pool.effectivePool.toFixed(1)}</strong> ·{" "}
                      <span>{pool.totalPicks}g</span>
                    </div>
                  </div>

                  <div className="mb-2.5 space-y-1">
                    <div className="h-1.5 w-full bg-panel-2">
                      <div
                        className={
                          pool.squeezeRisk === "high"
                            ? "h-full bg-red"
                            : pool.squeezeRisk === "medium"
                              ? "h-full bg-gold"
                              : "h-full bg-good"
                        }
                        style={{ width: `${pool.evennessPct}%` }}
                      />
                    </div>
                    <div className="flex justify-between font-mono text-[10px] text-dim">
                      <span>{t("กระจาย {0}%", pool.evennessPct.toFixed(0))}</span>
                      <span>{t("ตัวหลัก {0}%", pool.topHeroSharePct.toFixed(0))}</span>
                    </div>
                  </div>
                </div>

                {pool.topHeroes.length === 0 ? (
                  <p className="text-[11px] text-dim">—</p>
                ) : (
                  <ul className="space-y-1 border-t border-line/70 pt-2">
                    {pool.topHeroes.slice(0, 3).map((h) => (
                      <li key={`${pool.lane}-${h.hero}`} className="flex items-center justify-between gap-1.5 text-[11px]">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <div className="size-5 shrink-0 overflow-hidden border border-line">
                            <HeroPortrait name={h.hero} hero={heroMap.get(h.hero)} />
                          </div>
                          <span className="truncate font-semibold text-ink">{displayName(h.hero)}</span>
                        </div>
                        <span className="shrink-0 font-mono tabular-nums text-muted">
                          {h.games}g ·{" "}
                          <strong className={h.decided > 0 && h.wins / h.decided >= 0.5 ? "text-good" : "text-ink"}>
                            {wrText(h.wins, h.decided)}
                          </strong>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </CollapsibleCard>
  );
}

export function FlexEffectivenessCard({
  advanced,
  heroMap,
}: {
  advanced: ScrimAdvancedStats;
  heroMap: Map<string, Hero>;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const { flexHeroes, withFlexGames, withFlexWins, withFlexDecided, withoutFlexGames, withoutFlexWins, withoutFlexDecided } =
    advanced.flexSummary;
  const previewLimit = 6;
  const visible = expanded ? flexHeroes : flexHeroes.slice(0, previewLimit);

  return (
    <CollapsibleCard
      title={t("สถิติตัว Flex")}
      icon={<Repeat className="size-4 shrink-0 text-blue" />}
      badge={
        flexHeroes.length > 0 ? (
          <span className="font-mono text-[11px] text-dim">({flexHeroes.length})</span>
        ) : undefined
      }
    >
      {flexHeroes.length === 0 ? (
        <p className="text-xs text-dim">
          {t("ยังไม่พบฮีโร่ที่ถูกโยกเล่นอย่างน้อย 2 เลนในขอบเขตนี้")}
        </p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between border border-blue/35 bg-blue/10 px-3 py-2 text-xs">
              <span className="font-semibold text-ink">{t("เกมที่มีตัว Flex ร่วมทีม")}</span>
              <span className="font-mono tabular-nums">
                <strong className="text-blue">{wrText(withFlexWins, withFlexDecided)}</strong>{" "}
                <span className="text-dim">({withFlexGames}g)</span>
              </span>
            </div>
            <div className="flex items-center justify-between border border-line bg-bg px-3 py-2 text-xs">
              <span className="text-muted">{t("เกมที่ไม่มีตัว Flex")}</span>
              <span className="font-mono tabular-nums">
                <strong className="text-ink">{wrText(withoutFlexWins, withoutFlexDecided)}</strong>{" "}
                <span className="text-dim">({withoutFlexGames}g)</span>
              </span>
            </div>
          </div>

          <ul className={expanded ? "grid max-h-80 grid-cols-1 gap-2 overflow-y-auto pr-1 md:grid-cols-2" : "grid grid-cols-1 gap-2 md:grid-cols-2"}>
            {visible.map((fh) => (
              <li key={fh.hero} className="flex flex-col gap-1.5 border border-line bg-bg px-2.5 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="size-6 shrink-0 overflow-hidden border border-line">
                      <HeroPortrait name={fh.hero} hero={heroMap.get(fh.hero)} />
                    </div>
                    <span className="truncate font-semibold text-ink">{displayName(fh.hero)}</span>
                    <span className="border border-blue/40 bg-blue/10 px-1 py-0.5 font-mono text-[9px] font-bold text-blue">
                      FLEX {fh.laneBreakdown.length}
                    </span>
                  </div>
                  <span className="shrink-0 font-mono tabular-nums">
                    <strong className={fh.wrPct !== null && fh.wrPct >= 50 ? "text-good" : "text-red"}>
                      {wrText(fh.wins, fh.decided)}
                    </strong>{" "}
                    <span className="text-dim">({fh.wins}W-{fh.losses}L)</span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {fh.laneBreakdown.map((lb) => (
                    <span
                      key={`${fh.hero}-${lb.lane}`}
                      className="inline-flex items-center gap-1 border border-line bg-panel px-1.5 py-0.5 font-mono text-[10px] text-muted"
                    >
                      <LaneIcon lane={lb.lane} className="size-3 text-gold" />
                      <span>{LANE_SHORT[lb.lane]?.en ?? lb.lane}</span>
                      <strong className="text-ink">{lb.games}g</strong>
                      <span className={lb.wrPct !== null && lb.wrPct >= 50 ? "text-good" : "text-dim"}>
                        ({wrText(lb.wins, lb.decided)})
                      </span>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>

          <CardExpandButton
            expanded={expanded}
            totalCount={flexHeroes.length}
            previewLimit={previewLimit}
            onToggle={() => setExpanded((v) => !v)}
          />
        </>
      )}
    </CollapsibleCard>
  );
}

export function BlindCounterSlotCard({
  advanced,
  heroMap,
}: {
  advanced: ScrimAdvancedStats;
  heroMap: Map<string, Hero>;
}) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<"blind" | "slots">("blind");
  const [onlyBothPhases, setOnlyBothPhases] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const filteredBlind = useMemo(() => {
    const list = onlyBothPhases
      ? advanced.blindCounterHeroes.filter((h) => h.p1Games > 0 && h.p2Games > 0)
      : advanced.blindCounterHeroes;
    return list;
  }, [advanced.blindCounterHeroes, onlyBothPhases]);

  const previewLimit = 7;
  const visibleBlind = expanded ? filteredBlind : filteredBlind.slice(0, previewLimit);

  return (
    <CollapsibleCard
      title={t("หยิบเปิด vs แก้ทาง & สถิติตามช่องดราฟต์")}
      icon={<Crosshair className="size-4 shrink-0 text-gold" />}
    >
      <div role="tablist" aria-label={t("Blind Pick vs Counter Pick & สถิติตาม Pick Slot")} className="mb-3 grid grid-cols-2 gap-1.5 border border-line bg-bg p-1">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "blind"}
          onClick={() => setTab("blind")}
          className={`flex min-h-8 items-center justify-center gap-1.5 border px-2 font-display text-xs font-bold transition-colors ${
            tab === "blind"
              ? "border-gold/60 bg-gold/15 text-gold"
              : "border-transparent text-muted hover:text-ink"
          }`}
        >
          <span>{t("เทียบ Blind vs Counter")}</span>
          <span className="font-mono text-[11px] tabular-nums opacity-85">({advanced.blindCounterHeroes.length})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "slots"}
          onClick={() => setTab("slots")}
          className={`flex min-h-8 items-center justify-center gap-1.5 border px-2 font-display text-xs font-bold transition-colors ${
            tab === "slots"
              ? "border-blue/60 bg-blue/15 text-blue"
              : "border-transparent text-muted hover:text-ink"
          }`}
        >
          <span>{t("ผลงานตาม Pick Slot")}</span>
        </button>
      </div>

      {tab === "blind" ? (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="font-mono text-dim">{t("เทียบตอนหยิบเปิด (P1–P3) กับหยิบปิด (P4–P5)")}</span>
            <label className="inline-flex min-h-7 cursor-pointer items-center gap-1.5 font-mono text-muted hover:text-ink">
              <input
                type="checkbox"
                className="size-3.5 accent-gold"
                checked={onlyBothPhases}
                onChange={(e) => setOnlyBothPhases(e.target.checked)}
              />
              <span>{t("เฉพาะตัวที่มีทั้ง P1 และ P2")}</span>
            </label>
          </div>
          {filteredBlind.length === 0 ? (
            <p className="text-xs text-dim">{t("ยังไม่มีข้อมูลฮีโร่เพียงพอในโหมดนี้")}</p>
          ) : (
            <>
              <ul className={expanded ? "max-h-96 space-y-1.5 overflow-y-auto pr-1" : "space-y-1.5"}>
                {visibleBlind.map((h) => {
                  const classBadge =
                    h.classification === "blind_safe"
                      ? { text: t("เปิดก่อนคุ้ม"), cls: "border-good/40 bg-good/10 text-good" }
                      : h.classification === "counter_specialist"
                        ? { text: t("ตัวแก้ทาง"), cls: "border-blue/40 bg-blue/10 text-blue" }
                        : h.classification === "blind_risk"
                          ? { text: t("เปิดก่อนเสี่ยง"), cls: "border-red/40 bg-red/10 text-red" }
                          : { text: t("สมดุล"), cls: "border-line bg-panel-2 text-dim" };
                  return (
                    <li key={h.hero} className="flex flex-wrap items-center justify-between gap-2 border border-line bg-bg px-2.5 py-1.5 text-xs">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="size-6 shrink-0 overflow-hidden border border-line">
                          <HeroPortrait name={h.hero} hero={heroMap.get(h.hero)} />
                        </div>
                        <span className="truncate font-semibold text-ink">{displayName(h.hero)}</span>
                        <span className={`border px-1.5 py-0.5 font-mono text-[10px] font-bold ${classBadge.cls}`}>
                          {classBadge.text}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2.5 font-mono text-[11px] tabular-nums">
                        <span className="text-muted">
                          P1–3:{" "}
                          <strong className={h.p1WrPct === null ? "text-dim" : h.p1WrPct >= 50 ? "text-good" : "text-red"}>
                            {h.p1WrPct !== null ? `${h.p1WrPct.toFixed(0)}%` : "—"}
                          </strong>{" "}
                          <span className="text-[10px] text-dim">({h.p1Games}g)</span>
                        </span>
                        <span className="text-dim">|</span>
                        <span className="text-muted">
                          P4–5:{" "}
                          <strong className={h.p2WrPct === null ? "text-dim" : h.p2WrPct >= 50 ? "text-good" : "text-red"}>
                            {h.p2WrPct !== null ? `${h.p2WrPct.toFixed(0)}%` : "—"}
                          </strong>{" "}
                          <span className="text-[10px] text-dim">({h.p2Games}g)</span>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <CardExpandButton
                expanded={expanded}
                totalCount={filteredBlind.length}
                previewLimit={previewLimit}
                onToggle={() => setExpanded((v) => !v)}
              />
            </>
          )}
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {advanced.draftSlots.map((slot) => (
            <div key={slot.slot} className="flex flex-col justify-between border border-line bg-bg p-2">
              <div>
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className={`font-extrabold ${slot.side === "blue" ? "text-blue" : "text-red"}`}>
                    {slot.slot}
                  </span>
                  <span className="text-[10px] text-dim">P{slot.phase}</span>
                </div>
                <p className={`mt-1 font-mono text-base font-extrabold tabular-nums ${slot.wrPct === null ? "text-dim" : slot.wrPct >= 50 ? "text-good" : "text-red"}`}>
                  {slot.wrPct !== null ? `${slot.wrPct.toFixed(0)}%` : "—"}
                </p>
                <p className="font-mono text-[10px] text-dim">
                  {slot.wins}W-{slot.losses}L ({slot.games}g)
                </p>
              </div>
              <div className="mt-2 space-y-1 border-t border-line/70 pt-1.5">
                {slot.topHeroes.slice(0, 2).map((th) => (
                  <div key={`${slot.slot}-${th.hero}`} className="flex items-center gap-1 text-[10px]">
                    <div className="size-4 shrink-0 overflow-hidden border border-line">
                      <HeroPortrait name={th.hero} hero={heroMap.get(th.hero)} />
                    </div>
                    <span className="min-w-0 truncate text-ink">{displayName(th.hero)}</span>
                    <span className="ml-auto shrink-0 font-mono text-dim">{th.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </CollapsibleCard>
  );
}

export function CompArchetypeCard({
  advanced,
  heroMap,
}: {
  advanced: ScrimAdvancedStats;
  heroMap: Map<string, Hero>;
}) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<"archetype" | "openings">("archetype");
  const [expanded, setExpanded] = useState(false);
  const { archetypeStats, archetypeMatchups, openingDiversityPct, openingEntropyLabel, topOpenings } =
    advanced.compSummary;

  const diversityBadge =
    openingEntropyLabel === "unpredictable"
      ? { text: t("เดายาก / หลากหลาย"), cls: "border-good/50 bg-good/15 text-good" }
      : openingEntropyLabel === "moderate"
        ? { text: t("หลากหลายปานกลาง"), cls: "border-gold/50 bg-gold/15 text-gold" }
        : openingEntropyLabel === "predictable"
          ? { text: t("เดาทางง่าย"), cls: "border-red/50 bg-red/15 text-red" }
          : { text: t("ข้อมูลน้อย"), cls: "border-line bg-panel-2 text-dim" };

  return (
    <CollapsibleCard
      title={t("แผนคอมพ์ทีม & คู่เปิดดราฟต์")}
      icon={<Compass className="size-4 shrink-0 text-gold" />}
    >
      <div role="tablist" aria-label={t("แผนคอมพ์ทีม & คู่เปิดดราฟต์")} className="mb-3 grid grid-cols-2 gap-1.5 border border-line bg-bg p-1">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "archetype"}
          onClick={() => setTab("archetype")}
          className={`flex min-h-8 items-center justify-center gap-1.5 border px-2 py-1.5 font-display text-xs font-bold transition-colors ${
            tab === "archetype"
              ? "border-gold/60 bg-gold/15 text-gold"
              : "border-transparent text-muted hover:text-ink"
          }`}
        >
          <span>{t("แผนคอมพ์ & คู่ชน")}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "openings"}
          onClick={() => setTab("openings")}
          className={`flex min-w-0 min-h-8 items-center justify-center gap-1.5 border px-2 py-1.5 font-display text-xs font-bold transition-colors ${
            tab === "openings"
              ? "border-blue/60 bg-blue/15 text-blue"
              : "border-transparent text-muted hover:text-ink"
          }`}
        >
          <span>{t("คู่เปิดดราฟต์")}</span>
        </button>
      </div>

      {tab === "archetype" ? (
        archetypeStats.length === 0 ? (
          <p className="text-xs text-dim">{t("ต้องมีเกมที่เลือกครบ 5 ตัวเพื่อจำแนกสไตล์คอมพ์")}</p>
        ) : (
          <div className="space-y-3">
            <ul className="space-y-1.5">
              {archetypeStats.map((arch) => (
                <li key={arch.key} className="border border-line bg-bg px-2.5 py-2 text-xs">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{t(COMP_ARCHETYPE_LABELS[arch.key])}</span>
                    <span className="font-mono tabular-nums">
                      <strong className={arch.wrPct !== null && arch.wrPct >= 50 ? "text-good" : "text-red"}>
                        {wrText(arch.wins, arch.decided)}
                      </strong>{" "}
                      <span className="text-dim">
                        ({arch.wins}W-{arch.losses}L · {arch.sharePct.toFixed(0)}%)
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-panel-2">
                    <div
                      className={arch.wrPct !== null && arch.wrPct >= 50 ? "h-full bg-good/80" : "h-full bg-gold/80"}
                      style={{ width: `${arch.sharePct}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>

            {archetypeMatchups.length > 0 && (
              <div className="border-t border-line pt-2.5">
                <p className="mb-2 font-mono text-[11px] font-bold text-gold">{t("คอมพ์เราเจอคอมพ์คู่แข่ง (≥2 เกม)")}</p>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {archetypeMatchups.slice(0, 6).map((m) => (
                    <div
                      key={`${m.ourArchetype}-${m.enemyArchetype}`}
                      className="flex items-center justify-between gap-2 border border-line bg-bg px-2 py-1.5 text-[11px]"
                    >
                      <span className="min-w-0 truncate text-ink">
                        {t(COMP_ARCHETYPE_LABELS[m.ourArchetype])} <span className="text-dim">vs</span>{" "}
                        {t(COMP_ARCHETYPE_LABELS[m.enemyArchetype])}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums">
                        <strong className={m.wrPct !== null && m.wrPct >= 50 ? "text-good" : "text-red"}>
                          {wrText(m.wins, m.decided)}
                        </strong>{" "}
                        <span className="text-dim">({m.wins}-{m.losses})</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border border-line bg-bg px-3 py-2">
            <div>
              <p className="font-mono text-[11px] text-muted">{t("ความหลากหลายในการเปิดดราฟต์ Phase 1")}</p>
              <p className="font-mono text-lg font-extrabold tabular-nums text-ink">
                {openingDiversityPct.toFixed(0)}%{" "}
                <span className="text-xs font-normal text-dim">
                  ({advanced.compSummary.uniqueOpeningCount} {t("ตัวที่เคยเปิด P1–P3")})
                </span>
              </p>
            </div>
            <span className={`border px-2 py-0.5 font-display text-xs font-bold ${diversityBadge.cls}`}>
              {diversityBadge.text}
            </span>
          </div>

          {topOpenings.length === 0 ? (
            <p className="text-xs text-dim">{t("ยังไม่มีคู่เปิดเกม (2 ตัวแรก) ที่ถูกใช้ซ้ำอย่างน้อย 2 เกม")}</p>
          ) : (
            <>
              <ul className={expanded ? "max-h-72 space-y-1.5 overflow-y-auto pr-1" : "space-y-1.5"}>
                {(expanded ? topOpenings : topOpenings.slice(0, 6)).map((op) => (
                  <li key={`${op.a}-${op.b}`} className="flex items-center justify-between gap-2 border border-line bg-bg px-2.5 py-1.5 text-xs">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <div className="size-5 shrink-0 overflow-hidden border border-line">
                        <HeroPortrait name={op.a} hero={heroMap.get(op.a)} />
                      </div>
                      <div className="size-5 shrink-0 overflow-hidden border border-line">
                        <HeroPortrait name={op.b} hero={heroMap.get(op.b)} />
                      </div>
                      <span className="truncate font-semibold text-ink">
                        {displayName(op.a)} + {displayName(op.b)}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono tabular-nums">
                      <span className="text-muted">{op.games}g · </span>
                      <strong className={op.wrPct !== null && op.wrPct >= 50 ? "text-good" : "text-red"}>
                        {wrText(op.wins, op.decided)}
                      </strong>{" "}
                      <span className="text-[10px] text-dim">({op.wins}-{op.losses})</span>
                    </span>
                  </li>
                ))}
              </ul>
              <CardExpandButton
                expanded={expanded}
                totalCount={topOpenings.length}
                previewLimit={6}
                onToggle={() => setExpanded((v) => !v)}
              />
            </>
          )}
        </div>
      )}
    </CollapsibleCard>
  );
}

export function TrioSynergyCard({
  advanced,
  heroMap,
}: {
  advanced: ScrimAdvancedStats;
  heroMap: Map<string, Hero>;
}) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<"core" | "all">("core");
  const [expanded, setExpanded] = useState(false);

  const list = tab === "core" ? advanced.trioSummary.coreAxisTrios : advanced.trioSummary.allTrios;
  const previewLimit = 6;
  const visible = expanded ? list : list.slice(0, previewLimit);

  return (
    <CollapsibleCard
      title={t("สามประสานคุมเกม")}
      icon={<Flame className="size-4 shrink-0 text-gold" />}
      badge={
        list.length > 0 ? <span className="font-mono text-[11px] text-dim">({list.length})</span> : undefined
      }
    >
      <div role="tablist" aria-label={t("สามประสานคุมเกม")} className="mb-3 grid grid-cols-2 gap-1.5 border border-line bg-bg p-1">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "core"}
          onClick={() => setTab("core")}
          className={`flex min-h-8 items-center justify-center gap-1.5 border px-2 py-1.5 font-display text-xs font-bold transition-colors ${
            tab === "core"
              ? "border-gold/60 bg-gold/15 text-gold"
              : "border-transparent text-muted hover:text-ink"
          }`}
        >
          <span>{t("ป่า + เมจ + โรม")}</span>
          <span className="font-mono text-[11px] tabular-nums opacity-85">({advanced.trioSummary.coreAxisTrios.length})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "all"}
          onClick={() => setTab("all")}
          className={`flex min-h-8 items-center justify-center gap-1.5 border px-2 py-1.5 font-display text-xs font-bold transition-colors ${
            tab === "all"
              ? "border-good/60 bg-good/15 text-good"
              : "border-transparent text-muted hover:text-ink"
          }`}
        >
          <span>{t("คอมโบ 3 ตัวทั้งหมด")}</span>
          <span className="font-mono text-[11px] tabular-nums opacity-85">({advanced.trioSummary.allTrios.length})</span>
        </button>
      </div>

      {list.length === 0 ? (
        <p className="text-xs text-dim">
          {t(tab === "core" ? "ยังไม่มีชุดแกน JGL+MID+SUP ที่เล่นซ้ำอย่างน้อย 2 เกม" : "ยังไม่มีข้อมูลคอมโบ 3 ตัวเพียงพอ")}
        </p>
      ) : (
        <>
          <ul className={expanded ? "grid max-h-96 grid-cols-1 gap-2 overflow-y-auto pr-1 lg:grid-cols-2" : "grid grid-cols-1 gap-2 lg:grid-cols-2"}>
            {visible.map((trio) => (
              <li
                key={trio.heroes.join("-")}
                className="flex flex-wrap items-center justify-between gap-2 border border-line bg-bg px-2.5 py-2 text-xs"
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  {trio.heroes.map((h) => (
                    <div key={h} className="size-6 shrink-0 overflow-hidden border border-line">
                      <HeroPortrait name={h} hero={heroMap.get(h)} />
                    </div>
                  ))}
                  <span className="truncate font-semibold text-ink">
                    {trio.heroes.map((h) => displayName(h)).join(" + ")}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2 font-mono tabular-nums">
                  <span className={`font-bold ${trio.deltaVsTeamPct >= 0 ? "text-good" : "text-red"}`}>
                    {(trio.bayesianWr * 100).toFixed(1)}%
                  </span>
                  <span className="text-ink">{wrText(trio.wins, trio.decided)}</span>
                  <span className="text-[11px] text-dim">
                    ({trio.wins}W-{trio.losses}L)
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <CardExpandButton
            expanded={expanded}
            totalCount={list.length}
            previewLimit={previewLimit}
            onToggle={() => setExpanded((v) => !v)}
          />
        </>
      )}
    </CollapsibleCard>
  );
}

export function PeriodDiffCard({
  scopedGames,
  activeGames,
  tournaments,
  focusTeam,
  opponentFilter,
  heroMap,
  precomputedDiff,
  controlledMode,
  onControlledModeChange,
}: {
  scopedGames: readonly RecordedDraftGame[];
  activeGames: readonly RecordedDraftGame[];
  tournaments: readonly TournamentRef[];
  focusTeam: string;
  opponentFilter: string;
  heroMap: Map<string, Hero>;
  precomputedDiff?: PeriodDiffSummary | null;
  controlledMode?: "split_half" | "last7_vs_prev";
  onControlledModeChange?: (mode: "split_half" | "last7_vs_prev") => void;
}) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<PeriodDiffMode>("split_half");
  const [tournA, setTournA] = useState<string>("");
  const [tournB, setTournB] = useState<string>("");
  const isServerDriven = precomputedDiff !== undefined;
  const canCompareTournaments = !isServerDriven && tournaments.length >= 2;
  const activeMode: PeriodDiffMode = isServerDriven
    ? (controlledMode ?? "split_half")
    : mode === "tournaments" && !canCompareTournaments
      ? "split_half"
      : mode;

  const { periodAGames, periodBGames, labelA, labelB } = useMemo(
    () =>
      isServerDriven
        ? { periodAGames: [] as RecordedDraftGame[], periodBGames: [] as RecordedDraftGame[], labelA: "", labelB: "" }
        : splitGamesForPeriodDiff(scopedGames, activeGames, activeMode, tournA, tournB, tournaments),
    [isServerDriven, scopedGames, activeGames, activeMode, tournA, tournB, tournaments],
  );

  const localDiff = useMemo(
    () =>
      isServerDriven
        ? null
        : computePeriodDiff(periodAGames, periodBGames, focusTeam, opponentFilter, labelA, labelB),
    [isServerDriven, periodAGames, periodBGames, focusTeam, opponentFilter, labelA, labelB],
  );
  const diff = precomputedDiff ?? localDiff ?? {
    periodA: { label: "ช่วงแรก", games: 0, decided: 0, wins: 0, wrPct: null, blueWins: 0, blueDecided: 0, blueWrPct: null, redWins: 0, redDecided: 0, redWrPct: null },
    periodB: { label: "ช่วงหลัง", games: 0, decided: 0, wins: 0, wrPct: null, blueWins: 0, blueDecided: 0, blueWrPct: null, redWins: 0, redDecided: 0, redWrPct: null },
    wrShiftPct: null,
    risingHeroes: [],
    fallingHeroes: [],
  };

  const setSelectedMode = (next: "split_half" | "last7_vs_prev") => {
    if (onControlledModeChange) onControlledModeChange(next);
    else setMode(next);
  };

  const resolvedTournA = tournA || tournaments[tournaments.length - 1]?.id || "";
  const resolvedTournB = tournB || tournaments[0]?.id || "";

  return (
    <CollapsibleCard
      title={t("เทียบฟอร์มตามช่วงเวลา")}
      icon={<GitCompareArrows className="size-4 shrink-0 text-gold" />}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={activeMode === "split_half"}
            onClick={() => setSelectedMode("split_half")}
            className="min-h-8 border border-line bg-bg px-2.5 font-display text-xs font-semibold text-muted aria-pressed:border-gold aria-pressed:bg-gold/15 aria-pressed:text-gold"
          >
            {t("ครึ่งแรก vs ครึ่งหลัง")}
          </button>
          <button
            type="button"
            aria-pressed={activeMode === "last7_vs_prev"}
            onClick={() => setSelectedMode("last7_vs_prev")}
            className="min-h-8 border border-line bg-bg px-2.5 font-display text-xs font-semibold text-muted aria-pressed:border-gold aria-pressed:bg-gold/15 aria-pressed:text-gold"
          >
            {t("7 วันล่าสุด vs ก่อนหน้า")}
          </button>
          {canCompareTournaments && (
            <button
              type="button"
              aria-pressed={activeMode === "tournaments"}
              onClick={() => setMode("tournaments")}
              className="min-h-8 border border-line bg-bg px-2.5 font-display text-xs font-semibold text-muted aria-pressed:border-gold aria-pressed:bg-gold/15 aria-pressed:text-gold"
            >
              {t("เทียบ 2 ทัวร์นาเมนต์")}
            </button>
          )}
        </div>

        {activeMode === "tournaments" && canCompareTournaments && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              aria-label={t("ช่วง A")}
              value={resolvedTournA}
              onChange={(e) => setTournA(e.target.value)}
              className="min-h-8 border border-line-strong bg-bg px-2 text-ink"
            >
              {tournaments.map((tr) => (
                <option key={`ta-${tr.id}`} value={tr.id}>
                  {tr.name}
                </option>
              ))}
            </select>
            <span className="font-mono text-dim">vs</span>
            <select
              aria-label={t("ช่วง B")}
              value={resolvedTournB}
              onChange={(e) => setTournB(e.target.value)}
              className="min-h-8 border border-line-strong bg-bg px-2 text-ink"
            >
              {tournaments.map((tr) => (
                <option key={`tb-${tr.id}`} value={tr.id}>
                  {tr.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {diff.periodA.games === 0 || diff.periodB.games === 0 ? (
        <p className="text-xs text-dim">{t("ต้องมีเกมในทั้ง 2 ช่วงเวลาเพื่อเปรียบเทียบ")}</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="border border-line bg-bg p-3">
              <p className="font-mono text-[11px] text-dim">A · {t(diff.periodA.label)}</p>
              <p className="mt-1 font-mono text-lg font-extrabold tabular-nums text-ink">
                {diff.periodA.wrPct !== null ? `${diff.periodA.wrPct.toFixed(1)}%` : "—"}{" "}
                <span className="text-xs font-normal text-muted">({diff.periodA.games}g)</span>
              </p>
              <p className="font-mono text-[11px] text-dim">
                Blue {diff.periodA.blueWrPct !== null ? `${diff.periodA.blueWrPct.toFixed(0)}%` : "—"} · Red{" "}
                {diff.periodA.redWrPct !== null ? `${diff.periodA.redWrPct.toFixed(0)}%` : "—"}
              </p>
            </div>

            <div className="border border-line bg-bg p-3">
              <p className="font-mono text-[11px] text-gold">B · {t(diff.periodB.label)}</p>
              <p className="mt-1 font-mono text-lg font-extrabold tabular-nums text-ink">
                {diff.periodB.wrPct !== null ? `${diff.periodB.wrPct.toFixed(1)}%` : "—"}{" "}
                <span className="text-xs font-normal text-muted">({diff.periodB.games}g)</span>
              </p>
              <p className="font-mono text-[11px] text-dim">
                Blue {diff.periodB.blueWrPct !== null ? `${diff.periodB.blueWrPct.toFixed(0)}%` : "—"} · Red{" "}
                {diff.periodB.redWrPct !== null ? `${diff.periodB.redWrPct.toFixed(0)}%` : "—"}
              </p>
            </div>

            <div className="flex flex-col justify-center border border-line bg-bg p-3">
              <p className="font-mono text-[11px] text-muted">
                {focusTeam.trim() ? t("การเปลี่ยนแปลง Win Rate (B - A)") : t("การเปลี่ยนแปลง Blue WR (B - A)")}
              </p>
              {(() => {
                const shift = focusTeam.trim()
                  ? diff.wrShiftPct
                  : diff.periodA.blueWrPct !== null && diff.periodB.blueWrPct !== null
                    ? diff.periodB.blueWrPct - diff.periodA.blueWrPct
                    : null;
                return (
                  <p className={`mt-1 font-mono text-xl font-extrabold tabular-nums ${shift === null ? "text-dim" : shift >= 0 ? "text-good" : "text-red"}`}>
                    {shift !== null ? fmtSigned(shift) : "—"}
                  </p>
                );
              })()}
              <p className="font-mono text-[11px] text-dim">
                {focusTeam.trim() ? t("เทียบตาม Pick Rate ของทีม") : t("เทียบตาม Contest Rate รวม")}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 flex items-center gap-1.5 font-mono text-[11px] font-bold text-good">
                <TrendingUp className="size-3.5" />
                <span>{t("ฮีโร่ที่ความนิยมพุ่งขึ้น")}</span>
              </p>
              {diff.risingHeroes.length === 0 ? (
                <p className="text-xs text-dim">{t("ไม่มีฮีโร่ที่ความนิยมพุ่งขึ้นชัดเจน")}</p>
              ) : (
                <ul className="space-y-1.5">
                  {diff.risingHeroes.slice(0, 6).map((h) => (
                    <li key={`up-${h.hero}`} className="flex items-center justify-between gap-2 border border-line bg-bg px-2.5 py-1.5 text-xs">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="size-6 shrink-0 overflow-hidden border border-line">
                          <HeroPortrait name={h.hero} hero={heroMap.get(h.hero)} />
                        </div>
                        <span className="truncate font-semibold text-ink">{displayName(h.hero)}</span>
                      </div>
                      <span className="shrink-0 font-mono tabular-nums">
                        <strong className="text-good">{fmtSigned(h.deltaPct, 0)}</strong>{" "}
                        <span className="text-[11px] text-dim">
                          ({h.gamesA}→{h.gamesB}p)
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="mb-2 flex items-center gap-1.5 font-mono text-[11px] font-bold text-red">
                <TrendingDown className="size-3.5" />
                <span>{t("ฮีโร่ที่ความนิยมลดลง")}</span>
              </p>
              {diff.fallingHeroes.length === 0 ? (
                <p className="text-xs text-dim">{t("ไม่มีฮีโร่ที่ความนิยมลดลงชัดเจน")}</p>
              ) : (
                <ul className="space-y-1.5">
                  {diff.fallingHeroes.slice(0, 6).map((h) => (
                    <li key={`dn-${h.hero}`} className="flex items-center justify-between gap-2 border border-line bg-bg px-2.5 py-1.5 text-xs">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="size-6 shrink-0 overflow-hidden border border-line">
                          <HeroPortrait name={h.hero} hero={heroMap.get(h.hero)} />
                        </div>
                        <span className="truncate font-semibold text-ink">{displayName(h.hero)}</span>
                      </div>
                      <span className="shrink-0 font-mono tabular-nums">
                        <strong className="text-red">{fmtSigned(h.deltaPct, 0)}</strong>{" "}
                        <span className="text-[11px] text-dim">
                          ({h.gamesA}→{h.gamesB}p)
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </CollapsibleCard>
  );
}

// Re-export icons used only in Section headers when imported by ScrimDashboardView if desired
export { Activity, ShieldAlert, Sparkles };

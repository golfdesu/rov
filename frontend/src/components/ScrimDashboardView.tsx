import {
  Activity,
  ArrowLeft,
  ArrowUpDown,
  BarChart3,
  BookOpen,
  ChevronDown,
  Layers,
  RotateCcw,
  Search,
  ShieldBan,
  SlidersHorizontal,
  Sparkles,
  Swords,
  Trophy,
  Users,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { getJson } from "../api/client";
import { getTeam, teamPath, type Team, type TeamGame } from "../api/team";
import { useLanguage } from "../i18n/language";
import type { Hero, LaneKey, RecordedDraftGame } from "../types/draft";
import { getGameSeriesGroup, getGameSeriesKey, LANE_SHORT, listTournaments } from "../utils/draft";
import { displayName } from "../utils/heroNames";
import {
  computeAllTeamsAnalytics,
  computeScrimAnalytics,
  localCalendarDate,
  recordedGameTime,
  type AllTeamsHeroPerf,
  type DuoStat,
  type EwmaPoint,
  type HeroPerf,
} from "../utils/scrimStats";
import { Alert } from "./Alert";
import { HeroPortrait } from "./HeroPortrait";
import { LaneIcon } from "./LaneIcon";
import { StableButtonLabel } from "./StableButtonLabel";

interface ScrimDashboardViewProps {
  personalGames: RecordedDraftGame[];
  heroMap: Map<string, Hero>;
  isPaid: boolean;
  teamHistoryEnabled: boolean;
  defaultTeamName?: string;
  onBack: () => void;
}

type HeroSortKey = "games" | "contest" | "bayesian" | "delta" | "winRate" | "phase1";
type LaneFilterKey = "ALL" | LaneKey;
type DatePreset = "all" | "last7" | "last30" | "custom";
type TeamHistory = {
  team: Team | null;
  games: RecordedDraftGame[];
  status: "loading" | "ready" | "error";
};

const LANES: readonly LaneKey[] = ["DS_Lane", "Jungle", "Mid", "Dragon_Lane", "Roam"];
const DASHBOARD_SECTIONS = [
  ["overview", "ภาพรวม"],
  ["form", "ฟอร์มล่าสุดและ G1–G7"],
  ["draft", "Pick/Ban"],
  ["heroes", "สถิติฮีโร่"],
  ["matchups", "คู่แข่งและคอมโบ"],
  ["methods", "วิธีคำนวณ"],
] as const;
type DashboardSection = typeof DASHBOARD_SECTIONS[number][0];
const HIDDEN_SECTIONS_KEY = "minidraft_scrim_hidden_sections";
const ALL_TOURNAMENTS = "*";
const FILTER_CONTROL_CLASS = "min-h-9 min-w-0 w-full border border-line-strong bg-panel px-2.5 font-display text-base font-semibold text-ink focus-visible:outline-2 focus-visible:outline-gold sm:text-xs";

function readHiddenSections(): DashboardSection[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(HIDDEN_SECTIONS_KEY) ?? "[]");
    return Array.isArray(stored)
      ? DASHBOARD_SECTIONS.map(([key]) => key).filter((key) => stored.includes(key))
      : [];
  } catch {
    return [];
  }
}

function useDetailsDismiss(detailsRef: RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      const details = detailsRef.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [detailsRef]);
}

function handleDetailsEscape(event: React.KeyboardEvent<HTMLDetailsElement>) {
  if (event.key !== "Escape" || !event.currentTarget.open) return;
  event.preventDefault();
  event.currentTarget.open = false;
  event.currentTarget.querySelector("summary")?.focus();
}

function SeriesPicker({
  options,
  selected,
  onChange,
}: {
  options: { key: string; name: string }[];
  selected: ReadonlySet<string>;
  onChange: (names: string[]) => void;
}) {
  const { t } = useLanguage();
  const labelId = useId();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const label = selected.size > 1
    ? t("เลือก {0} ซีรีส์", selected.size)
    : options.find(({ key }) => selected.has(key))?.name ?? t("ทุกซีรีส์");

  useDetailsDismiss(detailsRef);

  return (
    <div className="grid min-w-0 gap-1 text-xs text-muted">
      <span id={labelId} className="truncate font-mono text-[11px]">{t("เลือกซีรีส์")}</span>
      <details
        ref={detailsRef}
        className="group relative min-w-0"
        onKeyDown={handleDetailsEscape}
      >
        <summary
          aria-labelledby={`${labelId} ${labelId}-selection`}
          className={`${FILTER_CONTROL_CLASS} flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden`}
        >
          <span id={`${labelId}-selection`} className="min-w-0 truncate" title={label}>{label}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="absolute top-full left-0 z-30 mt-1 w-72 max-w-[calc(100vw-1.5rem)] border border-line-strong bg-panel shadow-xl sm:w-80">
          <button
            type="button"
            aria-pressed={selected.size === 0}
            onClick={() => onChange([])}
            className="min-h-9 w-full border-b border-line px-3 text-left font-semibold text-muted hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-gold aria-pressed:text-gold"
          >
            {t("ทุกซีรีส์")}
          </button>
          <div className="max-h-48 overflow-y-auto overscroll-contain p-1">
            {options.length === 0 ? (
              <p className="px-2 py-2 text-xs text-dim">{t("ไม่พบซีรีส์ในขอบเขตนี้")}</p>
            ) : options.map(({ key, name }) => (
              <label key={key} className="flex min-h-9 cursor-pointer items-center gap-2 px-2 py-1.5 text-ink hover:bg-panel-2">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-gold"
                  checked={selected.has(key)}
                  onChange={(event) => onChange(
                    event.target.checked ? [...selected, key] : [...selected].filter((value) => value !== key),
                  )}
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
              </label>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}

function SectionPicker({
  hiddenSections,
  onChange,
}: {
  hiddenSections: readonly DashboardSection[];
  onChange: React.Dispatch<React.SetStateAction<DashboardSection[]>>;
}) {
  const { t } = useLanguage();
  const labelId = useId();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const visibleCount = DASHBOARD_SECTIONS.length - hiddenSections.length;
  const summaryText = visibleCount === DASHBOARD_SECTIONS.length
    ? t("แสดงทั้งหมด")
    : t("แสดง {0}/{1} ส่วน", visibleCount, DASHBOARD_SECTIONS.length);

  useDetailsDismiss(detailsRef);

  return (
    <div className="grid min-w-0 gap-1 text-xs text-muted">
      <span id={labelId} className="truncate font-mono text-[11px]">{t("เลือกส่วนที่จะแสดง")}</span>
      <details
        ref={detailsRef}
        className="group relative min-w-0"
        onKeyDown={handleDetailsEscape}
      >
        <summary
          aria-labelledby={`${labelId} ${labelId}-selection`}
          className={`${FILTER_CONTROL_CLASS} flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden`}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <SlidersHorizontal className="size-3.5 shrink-0 text-gold" aria-hidden="true" />
            <span id={`${labelId}-selection`} className="min-w-0 truncate">{summaryText}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="absolute top-full right-0 z-30 mt-1 w-64 max-w-[calc(100vw-1.5rem)] border border-line-strong bg-panel p-2 shadow-xl">
          <div className="space-y-1">
            {DASHBOARD_SECTIONS.map(([key, label]) => (
              <label key={key} className="flex min-h-8 cursor-pointer items-center gap-2 px-1 text-xs text-ink hover:bg-panel-2">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-gold"
                  checked={!hiddenSections.includes(key)}
                  onChange={(event) => {
                    const show = event.target.checked;
                    onChange((current) => show ? current.filter((item) => item !== key) : [...current, key]);
                  }}
                />
                <span>{t(label)}</span>
              </label>
            ))}
          </div>
          <div className="mt-2 border-t border-line pt-2">
            <button
              type="button"
              className="min-h-8 w-full border border-line-strong px-2 font-display text-xs font-semibold text-gold enabled:hover:bg-gold/10 focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-50"
              disabled={hiddenSections.length === 0}
              onClick={() => onChange([])}
            >
              <StableButtonLabel message="แสดงทั้งหมด" />
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}

function wrPct(wins: number, decided: number): string {
  return decided > 0 ? `${((wins / decided) * 100).toFixed(1)}%` : "—";
}

function fmtSignedPct(value: number, digits = 1): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function fmtPValue(p: number): string {
  if (p < 0.001) return "<0.001";
  return p.toFixed(3);
}

function filterAndSortHeroes<T extends HeroPerf>(
  list: readonly T[],
  laneFilter: LaneFilterKey,
  heroSearch: string,
  sortBy: HeroSortKey,
): T[] {
  const q = heroSearch.trim().toLowerCase();
  return list
    .flatMap((row) => {
      if (q && !row.hero.toLowerCase().includes(q) && !displayName(row.hero).toLowerCase().includes(q)) {
        return [];
      }
      if (laneFilter === "ALL") return [row];
      const lane = row.lanes[laneFilter];
      return lane ? [{ ...row, ...lane }] : [];
    })
    .sort((a, b) => {
      if (sortBy === "contest") {
        const ac = "contestCount" in a ? (a as unknown as AllTeamsHeroPerf).contestCount : a.games;
        const bc = "contestCount" in b ? (b as unknown as AllTeamsHeroPerf).contestCount : b.games;
        return bc - ac || b.games - a.games;
      }
      if (sortBy === "bayesian") {
        return b.bayesianWr - a.bayesianWr || b.games - a.games;
      }
      if (sortBy === "delta") {
        return b.bayesianDeltaPct - a.bayesianDeltaPct || b.games - a.games;
      }
      if (sortBy === "winRate") {
        const aw = a.decided > 0 ? a.wins / a.decided : -1;
        const bw = b.decided > 0 ? b.wins / b.decided : -1;
        return bw - aw || b.games - a.games;
      }
      if (sortBy === "phase1") {
        const ap = a.games > 0 ? a.phase1Count / a.games : -1;
        const bp = b.games > 0 ? b.phase1Count / b.games : -1;
        return bp - ap || b.games - a.games;
      }
      return b.games - a.games || b.wins - a.wins;
    });
}

function HeroTableToolbar({
  title,
  count,
  laneFilter,
  onLaneChange,
  heroSearch,
  onSearchChange,
  sortBy,
  onSortChange,
  includeContestSort,
  includeDeltaSort,
}: {
  title: string;
  count: number;
  laneFilter: LaneFilterKey;
  onLaneChange: (lane: LaneFilterKey) => void;
  heroSearch: string;
  onSearchChange: (q: string) => void;
  sortBy: HeroSortKey;
  onSortChange: (key: HeroSortKey) => void;
  includeContestSort?: boolean;
  includeDeltaSort?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-display text-sm font-bold tracking-wider text-ink">
        {title} ({count})
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            aria-pressed={laneFilter === "ALL"}
            onClick={() => onLaneChange("ALL")}
            className="min-h-8 border border-line bg-bg px-2 font-mono text-[11px] font-bold text-muted aria-pressed:border-gold aria-pressed:bg-gold aria-pressed:text-bg"
          >
            ALL
          </button>
          {LANES.map((lane) => (
            <button
              key={lane}
              type="button"
              aria-pressed={laneFilter === lane}
              onClick={() => onLaneChange(lane)}
              className="inline-flex min-h-8 items-center gap-1 border border-line bg-bg px-2 font-mono text-[11px] font-bold text-muted aria-pressed:border-gold aria-pressed:bg-gold aria-pressed:text-bg"
            >
              <LaneIcon lane={lane} className="size-3" />
              <span>{LANE_SHORT[lane]?.en ?? lane}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-dim" />
          <input
            type="text"
            value={heroSearch}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("ค้นหาฮีโร่…")}
            className="h-8 border border-line-strong bg-bg pr-2 pl-7 text-xs text-ink"
          />
        </div>
        <label className="inline-flex items-center gap-1 text-xs text-muted">
          <ArrowUpDown className="size-3.5 text-gold" />
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as HeroSortKey)}
            className="h-8 border border-line-strong bg-bg px-2 text-xs text-ink"
          >
            <option value="games">{t("เรียงตามจำนวนเกม")}</option>
            {includeContestSort && <option value="contest">{t("เรียงตาม Contest Rate")}</option>}
            <option value="bayesian">{t("เรียงตาม Win Rate ปรับฐาน (Bayes)")}</option>
            {includeDeltaSort && <option value="delta">{t("เรียงตาม Delta เทียบทีม")}</option>}
            <option value="winRate">{t("เรียงตาม Win Rate")}</option>
            <option value="phase1">{t("เรียงตาม % หยิบ Phase แรก")}</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function PhasePickCard({
  phase1Top,
  phase2Top,
  heroMap,
}: {
  phase1Top: readonly HeroPerf[];
  phase2Top: readonly HeroPerf[];
  heroMap: Map<string, Hero>;
}) {
  const { t } = useLanguage();
  return (
    <div className="border border-line bg-panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="size-4 text-gold" />
        <h2 className="font-display text-sm font-bold tracking-wider text-ink">
          {t("จังหวะการหยิบ (3 ตัวแรก vs 2 ตัวท้าย)")}
        </h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {([
          ["หยิบเปิดก่อน / Priority (P1–P3)", "text-gold", phase1Top, (h: HeroPerf) => h.phase1Count, "p1"],
          ["หยิบปิด / Counter (P4–P5)", "text-blue", phase2Top, (h: HeroPerf) => h.phase2Count, "p2"],
        ] as const).map(([label, colorClass, rows, getCount, prefix]) => (
          <div key={prefix}>
            <p className={`mb-2 font-mono text-[11px] font-bold ${colorClass}`}>{t(label)}</p>
            <ul className="space-y-1.5">
              {rows.map((h) => (
                <li key={`${prefix}-${h.hero}`} className="flex items-center justify-between gap-2 border border-line bg-bg px-2 py-1.5 text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="size-6 shrink-0 overflow-hidden border border-line">
                      <HeroPortrait name={h.hero} hero={heroMap.get(h.hero)} />
                    </div>
                    <span className="truncate font-semibold text-ink">{displayName(h.hero)}</span>
                  </div>
                  <span className="shrink-0 font-mono text-muted">
                    {getCount(h)}g ·{" "}
                    <strong className="text-good">{(h.bayesianWr * 100).toFixed(1)}%</strong>
                    <span className="text-[10px] text-dim"> ({wrPct(h.wins, h.decided)})</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function DuosCard({ duos, heroMap }: { duos: readonly DuoStat[]; heroMap: Map<string, Hero> }) {
  const { t } = useLanguage();
  return (
    <div className="border border-line bg-panel p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-good" />
          <h2 className="font-display text-sm font-bold tracking-wider text-ink">
            {t("คู่คอมโบเสริมพลังจริง (Bradley-Terry Duos)")}
          </h2>
        </div>
        <span className="font-mono text-[10px] text-dim">Lift = Post WR - Expected BT</span>
      </div>
      {duos.length === 0 ? (
        <p className="text-xs text-dim">{t("ยังไม่มีข้อมูลคู่คอมโบเพียงพอ")}</p>
      ) : (
        <ul className="space-y-2">
          {duos.map((d) => (
            <li key={`${d.a}-${d.b}`} className="flex flex-wrap items-center justify-between gap-2 border border-line bg-bg px-2.5 py-2 text-xs">
              <div className="flex min-w-0 items-center gap-1.5">
                <div className="size-6 shrink-0 overflow-hidden border border-line">
                  <HeroPortrait name={d.a} hero={heroMap.get(d.a)} />
                </div>
                <div className="size-6 shrink-0 overflow-hidden border border-line">
                  <HeroPortrait name={d.b} hero={heroMap.get(d.b)} />
                </div>
                <span className="truncate font-semibold text-ink">
                  {displayName(d.a)} + {displayName(d.b)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2 font-mono">
                <span className={`font-bold ${d.synergyLiftPct >= 0 ? "text-good" : "text-red"}`}>
                  {fmtSignedPct(d.synergyLiftPct)}
                </span>
                <span className="text-ink">{wrPct(d.wins, d.decided)}</span>
                <span
                  className="text-[11px] text-dim"
                  title={`Z=${d.zScore.toFixed(2)} · Co-Pick ${d.coPickLift.toFixed(2)}x`}
                >
                  ({d.wins}W-{d.losses}L · {t("เสริมจริง")} {d.probSynergyPct.toFixed(0)}%)
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MethodsReferenceCard() {
  const { t } = useLanguage();
  return (
    <details className="border border-line bg-panel/60 px-4 py-3 font-mono text-xs leading-relaxed text-muted">
      <summary className="flex cursor-pointer items-center gap-2 font-display text-xs font-bold text-ink select-none hover:text-gold sm:text-sm">
        <BookOpen className="size-4 text-gold" />
        <span>{t("อ้างอิงทฤษฎี & สูตรคณิตศาสตร์เบื้องหลัง (คลิกเปิดดูได้)")}</span>
      </summary>
      <div className="mt-3 grid grid-cols-1 gap-3 border-t border-line pt-3 md:grid-cols-2">
        <div>
          <strong className="text-ink">1. Wilson (1927) 95% CI, Normal CDF &amp; Series DP:</strong>{" "}
          {t("คำนวณช่วงความน่าจะเป็นของ Win Rate, แปลง Z-Score เป็นโอกาส % ที่เหนือกว่าจริง และคำนวณโอกาสปิดซีรีส์ Bo5/Bo7 แบบสลับฝั่ง Blue/Red")}
        </div>
        <div>
          <strong className="text-ink">2. Empirical Bayes Shrinkage &amp; AI Draft Edge:</strong>{" "}
          {t("ดึงฮีโร่ที่เล่นไม่กี่เกมเข้าหาค่าเฉลี่ยทีม (Prior k=8) เพื่อวัด Bayes Delta และเทียบผลชนะจริงกับค่าคาดการณ์ของ AI เพื่อดูว่าชนะเกินคาดกี่เกม")}
        </div>
        <div>
          <strong className="text-ink">3. Bradley-Terry (1952) Synergy &amp; Lane Counter Lift:</strong>{" "}
          {t("เทียบ Win Rate คอมโบและคู่ชนเลนกับค่า Expected จากความเก่งเดี่ยว บอกได้ว่าคู่ไหนเสริมกันจริง (Lift +%) พร้อม Co-Pick และ Protective Ban Lift")}
        </div>
        <div>
          <strong className="text-ink">4. Shannon Entropy Effective Pool &amp; EWMA Momentum:</strong>{" "}
          {t("exp(H) วัดจำนวนฮีโร่ที่ทีมใช้งานกระจายจริงใน Global Ban ส่วน Weighted Linear Slope (G1–G7) และ EWMA (alpha=0.15) จับอาการล้าและฟอร์มล่าสุด")}
        </div>
      </div>
    </details>
  );
}

function CiRangeBar({
  ratePct,
  ci,
}: {
  ratePct: number;
  ci: [number, number];
}) {
  const lo = Math.max(0, Math.min(100, ci[0]));
  const hi = Math.max(lo, Math.min(100, ci[1]));
  const pt = Math.max(0, Math.min(100, ratePct));
  return (
    <div className="mt-2 space-y-1">
      <div className="relative h-2.5 w-full bg-bg">
        <div className="absolute top-0 bottom-0 left-1/2 w-px border-l border-dashed border-dim/60" />
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 bg-gold/40"
          style={{ left: `${lo}%`, width: `${Math.max(1.5, hi - lo)}%` }}
        />
        <div
          className="absolute top-1/2 h-2.5 w-1.5 -translate-x-1/2 -translate-y-1/2 bg-gold"
          style={{ left: `${pt}%` }}
        />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-dim">
        <span>0%</span>
        <span>
          Wilson 95% CI: [{lo.toFixed(1)}% – {hi.toFixed(1)}%]
        </span>
        <span>100%</span>
      </div>
    </div>
  );
}

function EwmaSparkline({
  points,
  currentPct,
  deltaPct,
  t,
}: {
  points: EwmaPoint[];
  currentPct: number | null;
  deltaPct: number | null;
  t: (msg: string) => string;
}) {
  if (points.length < 2 || currentPct === null) {
    return (
      <div className="flex h-28 items-center justify-center border border-dashed border-line bg-bg/60 text-xs text-dim">
        {t("ต้องมีเกมที่ลงผลชนะอย่างน้อย 2 เกมเพื่อสร้างกราฟ EWMA")}
      </div>
    );
  }

  const w = 320;
  const h = 92;
  const padLeft = 8;
  const padRight = 32;
  const padY = 10;
  const toX = (i: number) => padLeft + (i / Math.max(1, points.length - 1)) * (w - padLeft - padRight);
  const toY = (pct: number) => h - padY - (Math.max(0, Math.min(100, pct)) / 100) * (h - padY * 2);
  const poly = points.map((p, i) => `${toX(i).toFixed(1)},${toY(p.ewmaPct).toFixed(1)}`).join(" ");
  const y50 = toY(50);
  const last = points[points.length - 1];

  return (
    <div className="space-y-2 border border-line bg-bg p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs text-muted">{t("EWMA ฟอร์มล่าสุด (ถ่วงน้ำหนักแมตช์ใหม่)")}</span>
        <div className="flex items-baseline gap-1.5 font-mono">
          <strong className={`text-base ${currentPct >= 50 ? "text-good" : "text-red"}`}>
            {currentPct.toFixed(1)}%
          </strong>
          {deltaPct !== null && (
            <span className={`text-[11px] font-bold ${deltaPct >= 0 ? "text-good" : "text-red"}`}>
              ({fmtSignedPct(deltaPct)})
            </span>
          )}
        </div>
      </div>

      <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full overflow-visible">
        <line
          x1={padLeft}
          y1={y50}
          x2={w - padRight}
          y2={y50}
          stroke="currentColor"
          strokeDasharray="3 3"
          className="text-dim/40"
        />
        <polyline
          fill="none"
          stroke="#c99e40"
          strokeWidth="2"
          points={poly}
        />
        {points.map((p, i) => (
          <circle
            key={p.idx}
            cx={toX(i)}
            cy={toY(p.ewmaPct)}
            r={i === points.length - 1 ? 3.5 : 1.8}
            fill={p.win ? "#34d399" : "#f87171"}
          >
            <title>{`${p.label}: ${p.ewmaPct.toFixed(1)}%`}</title>
          </circle>
        ))}
        <text x={w - 2} y={y50 + 3} textAnchor="end" className="fill-dim font-mono text-[9px]">
          50%
        </text>
      </svg>

      <div className="flex flex-wrap items-center justify-between gap-x-2 font-mono text-[10px] text-dim">
        <span>{points.length} {t("เกมล่าสุด (ซ้ายเก่า → ขวาใหม่)")}</span>
        <span className={`min-w-0 break-words ${last.win ? "text-good" : "text-red"}`}>
          {t("ล่าสุด:")} {last.label}
        </span>
      </div>
    </div>
  );
}

export function ScrimDashboardView({
  personalGames,
  heroMap,
  isPaid,
  teamHistoryEnabled,
  onBack,
}: ScrimDashboardViewProps) {
  const { t } = useLanguage();
  const [source, setSource] = useState<"personal" | "team">("personal");
  const [{ team, games: teamGames, status: teamStatus }, setTeamHistory] = useState<TeamHistory>({
    team: null,
    games: [],
    status: "loading",
  });
  const [teamReload, setTeamReload] = useState(0);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [allTeamsSelected, setAllTeamsSelected] = useState(true);
  const [opponentFilter, setOpponentFilter] = useState("ALL");
  const [tournamentFilter, setTournamentFilter] = useState(ALL_TOURNAMENTS);
  const [seriesFilter, setSeriesFilter] = useState<string[]>([]);
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [today, setToday] = useState(() => localCalendarDate(new Date()));
  const [hiddenSections, setHiddenSections] = useState(readHiddenSections);
  const [laneFilter, setLaneFilter] = useState<LaneFilterKey>("ALL");
  const [heroSearch, setHeroSearch] = useState("");
  const [sortBy, setSortBy] = useState<HeroSortKey>("games");

  const canLoadTeamHistory = isPaid && teamHistoryEnabled;
  const showTeamHistory = canLoadTeamHistory && source === "team";

  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_SECTIONS_KEY, JSON.stringify(hiddenSections));
    } catch {
      // The controls remain available if browser storage is blocked.
    }
  }, [hiddenSections]);

  useEffect(() => {
    if (datePreset !== "last7" && datePreset !== "last30") return;
    const updateDay = () => setToday(localCalendarDate(new Date()));
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    const timer = window.setTimeout(updateDay, midnight.getTime() - Date.now());
    window.addEventListener("focus", updateDay);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", updateDay);
    };
  }, [datePreset, today]);

  useEffect(() => {
    if (!canLoadTeamHistory) return;
    const ctrl = new AbortController();
    async function loadTeamHistory() {
      let activeTeam: Team | null = null;
      try {
        activeTeam = (await getTeam(ctrl.signal)).team;
        if (ctrl.signal.aborted) return;
        if (!activeTeam) {
          setTeamHistory({ team: null, games: [], status: "ready" });
          setSource("personal");
          return;
        }
        setTeamHistory({ team: activeTeam, games: [], status: "loading" });
        const rows = await getJson<TeamGame[]>(`${teamPath}/history`, ctrl.signal);
        if (!ctrl.signal.aborted) {
          setTeamHistory({ team: activeTeam, games: rows.map(({ game }) => game), status: "ready" });
        }
      } catch {
        if (!ctrl.signal.aborted) {
          setTeamHistory({ team: activeTeam, games: [], status: "error" });
        }
      }
    }
    void loadTeamHistory();
    return () => ctrl.abort();
  }, [canLoadTeamHistory, teamReload]);

  function reloadTeamHistory() {
    setTeamHistory((current) => ({ ...current, status: "loading" }));
    setTeamReload((count) => count + 1);
  }

  const activeGames = showTeamHistory ? teamGames : personalGames;
  const tournaments = useMemo(() => listTournaments(activeGames), [activeGames]);
  const activeTournament = tournamentFilter === "" || tournaments.some(({ id }) => id === tournamentFilter)
    ? tournamentFilter
    : ALL_TOURNAMENTS;
  const tournamentGames = useMemo(() => activeTournament === ALL_TOURNAMENTS
    ? activeGames
    : activeGames.filter((game) => (game.tournament?.id ?? "") === activeTournament),
  [activeGames, activeTournament]);

  const teamNames = useMemo(() => {
    const counts = new Map<string, { display: string; count: number }>();
    for (const g of tournamentGames) {
      for (const name of [g.blueTeamName?.trim(), g.redTeamName?.trim()]) {
        if (!name) continue;
        const key = name.toLowerCase();
        const prev = counts.get(key);
        if (prev) prev.count += 1;
        else counts.set(key, { display: name, count: 1 });
      }
    }
    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .map((entry) => entry.display);
  }, [tournamentGames]);

  const focusTeam = useMemo(() => {
    if (allTeamsSelected) return "";
    const target = selectedTeam.trim().toLowerCase();
    if (target) {
      const exact = teamNames.find((n) => n.toLowerCase() === target);
      if (exact) return exact;
    }
    return "";
  }, [allTeamsSelected, selectedTeam, teamNames]);
  const allTeamsMode = focusTeam === "";

  const opponents = useMemo(() => {
    if (!focusTeam) return [];
    const focusLower = focusTeam.toLowerCase();
    const map = new Map<string, string>();
    for (const g of tournamentGames) {
      const b = g.blueTeamName?.trim() ?? "";
      const r = g.redTeamName?.trim() ?? "";
      if (b.toLowerCase() === focusLower && r && r.toLowerCase() !== focusLower) {
        if (!map.has(r.toLowerCase())) map.set(r.toLowerCase(), r);
      } else if (r.toLowerCase() === focusLower && b && b.toLowerCase() !== focusLower) {
        if (!map.has(b.toLowerCase())) map.set(b.toLowerCase(), b);
      }
    }
    return Array.from(map.values()).sort();
  }, [tournamentGames, focusTeam]);

  const seriesOptions = useMemo(() => {
    const selected = focusTeam.toLowerCase();
    const names = new Map<string, string>();
    for (const game of tournamentGames) {
      if (selected) {
        const onBlue = game.blueTeamName?.trim().toLowerCase() === selected;
        const onRed = game.redTeamName?.trim().toLowerCase() === selected;
        if (onBlue === onRed) continue;
      }
      const key = getGameSeriesKey(game);
      if (names.has(key)) continue;
      const name = getGameSeriesGroup(game);
      names.set(key, activeTournament === ALL_TOURNAMENTS && game.tournament ? `${name} · ${game.tournament.name}` : name);
    }
    const seen = new Map<string, number>();
    return [...names].sort(([, a], [, b]) => a.localeCompare(b)).map(([key, name]) => {
      const number = (seen.get(name) ?? 0) + 1;
      seen.set(name, number);
      return { key, name: number === 1 ? name : `${name} (${number})` };
    });
  }, [activeTournament, tournamentGames, focusTeam]);
  const activeSeries = useMemo(() => {
    const available = new Set(seriesOptions.map(({ key }) => key));
    return new Set(seriesFilter.filter((name) => available.has(name)));
  }, [seriesFilter, seriesOptions]);
  const invalidDateRange = datePreset === "custom" && Boolean(dateFrom && dateTo && dateFrom > dateTo);

  const scopeMatchesTeam = useMemo(() => {
    const focusLower = focusTeam.trim().toLowerCase();
    const oppLower = opponentFilter === "ALL" ? null : opponentFilter.trim().toLowerCase();
    return (game: RecordedDraftGame) => {
      if (!focusLower) return true;
      const bName = game.blueTeamName?.trim().toLowerCase() ?? "";
      const rName = game.redTeamName?.trim().toLowerCase() ?? "";
      const isBlue = bName === focusLower;
      const isRed = rName === focusLower;
      if (isBlue === isRed) return false;
      if (!oppLower) return true;
      return (isBlue ? rName : bName) === oppLower;
    };
  }, [focusTeam, opponentFilter]);

  const { scopedGames, undatedExcludedCount } = useMemo(() => {
    if (invalidDateRange) return { scopedGames: [] as RecordedDraftGame[], undatedExcludedCount: 0 };
    let from = "";
    let to = "";
    if (datePreset === "custom") {
      from = dateFrom;
      to = dateTo;
    } else if (datePreset !== "all") {
      const day = new Date(`${today}T00:00:00`);
      to = today;
      day.setDate(day.getDate() - (datePreset === "last7" ? 6 : 29));
      from = localCalendarDate(day);
    }
    if (activeSeries.size === 0 && !from && !to) {
      return { scopedGames: tournamentGames, undatedExcludedCount: 0 };
    }
    let undated = 0;
    const filtered = tournamentGames.filter((game) => {
      if (activeSeries.size > 0 && !activeSeries.has(getGameSeriesKey(game))) return false;
      if (!from && !to) return true;
      const time = recordedGameTime(game);
      if (time === null) {
        if (scopeMatchesTeam(game)) undated += 1;
        return false;
      }
      const day = localCalendarDate(new Date(time));
      return (!from || day >= from) && (!to || day <= to);
    });
    return { scopedGames: filtered, undatedExcludedCount: undated };
  }, [tournamentGames, activeSeries, dateFrom, datePreset, dateTo, invalidDateRange, scopeMatchesTeam, today]);

  const stats = useMemo(
    () => computeScrimAnalytics(scopedGames, focusTeam, opponentFilter),
    [scopedGames, focusTeam, opponentFilter],
  );
  const allStats = useMemo(
    () => (allTeamsMode ? computeAllTeamsAnalytics(scopedGames) : null),
    [allTeamsMode, scopedGames],
  );

  const filteredHeroRows = useMemo(
    () => filterAndSortHeroes(stats.allyList, laneFilter, heroSearch, sortBy),
    [stats.allyList, laneFilter, heroSearch, sortBy],
  );
  const filteredAllHeroRows = useMemo(
    () => (allStats ? filterAndSortHeroes(allStats.heroList, laneFilter, heroSearch, sortBy) : []),
    [allStats, laneFilter, heroSearch, sortBy],
  );

  const hasActiveFilters =
    activeTournament !== ALL_TOURNAMENTS ||
    activeSeries.size > 0 ||
    datePreset !== "all" ||
    (!allTeamsMode && opponentFilter !== "ALL");

  function resetFilters() {
    setTournamentFilter(ALL_TOURNAMENTS);
    setAllTeamsSelected(true);
    setSelectedTeam("");
    setOpponentFilter("ALL");
    setSeriesFilter([]);
    setDatePreset("all");
    setDateFrom("");
    setDateTo("");
  }

  function selectSpecificTeam(teamName: string) {
    setAllTeamsSelected(false);
    setSelectedTeam(teamName);
    setOpponentFilter("ALL");
    setSeriesFilter([]);
  }

  const overallWrPct = stats.decided > 0 ? (stats.wins / stats.decided) * 100 : 0;
  const activeSideTest = allStats ? allStats.sideTest : stats.sideTest;
  const sideVerdict = !activeSideTest.significant95
    ? "ข้อมูลยังไม่พอสรุปว่าฝั่งไหนดีกว่า"
    : activeSideTest.diffPct > 0 ? "ฝั่ง Blue ชนะบ่อยกว่าในชุดนี้" : "ฝั่ง Red ชนะบ่อยกว่าในชุดนี้";

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-bg px-3 py-4 sm:px-6 sm:py-5">
      <div className="mx-auto max-w-[1600px] space-y-5">
        {/* Top Header */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              aria-label={t("กลับหน้า Draft Board")}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 border border-line-strong bg-panel px-2 font-display text-xs font-semibold text-ink transition-colors hover:border-gold/60 hover:text-gold sm:px-3"
            >
              <ArrowLeft className="size-4" />
              <span className="hidden sm:inline"><StableButtonLabel message="กลับหน้า Draft Board" /></span>
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <BarChart3 className="size-5 shrink-0 text-gold" />
                <h1 className="font-display text-base font-extrabold tracking-wider text-ink sm:text-xl">
                  SCRIM ANALYTICS DASHBOARD
                </h1>
              </div>
              <p className="text-xs text-muted">
                {t("วิเคราะห์ข้อมูลดราฟต์เชิงลึก: Win Rate ตามฝั่ง, เกม G1–G7, ลำดับ Phase, คอมโบ และคู่แข่ง")}
              </p>
            </div>
          </div>

          {isPaid && (
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
              <div className={`grid max-w-full border border-line-strong bg-panel p-0.5 ${canLoadTeamHistory && team ? "grid-cols-2" : "grid-cols-1"}`}>
                <button
                  type="button"
                  aria-pressed={!showTeamHistory}
                  onClick={() => {
                    if (!showTeamHistory) return;
                    setSource("personal");
                    setOpponentFilter("ALL");
                    setTournamentFilter(ALL_TOURNAMENTS);
                    setAllTeamsSelected(true);
                    setSelectedTeam("");
                    setSeriesFilter([]);
                  }}
                  className="min-h-8 px-3 font-display text-xs font-semibold text-muted aria-pressed:bg-gold/15 aria-pressed:text-gold"
                >
                  <StableButtonLabel message="ประวัติส่วนตัว" /> ({personalGames.length})
                </button>
                {canLoadTeamHistory && team && (
                  <button
                    type="button"
                    aria-pressed={showTeamHistory}
                    onClick={() => {
                      if (showTeamHistory) return;
                      setSource("team");
                      setOpponentFilter("ALL");
                      setTournamentFilter(ALL_TOURNAMENTS);
                      setAllTeamsSelected(true);
                      setSelectedTeam("");
                      setSeriesFilter([]);
                    }}
                    className="min-h-8 px-3 font-display text-xs font-semibold text-muted aria-pressed:bg-blue/15 aria-pressed:text-blue"
                  >
                    <StableButtonLabel message="ประวัติทีม" />{teamStatus === "ready" ? ` (${teamGames.length})` : ""}
                  </button>
                )}
              </div>
            </div>
          )}
        </header>

        {isPaid && (
          <div className="space-y-2.5 border border-line bg-panel/60 p-3">
            <div
              role="group"
              aria-label={t("กรองเกม")}
              className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-end"
            >
              {tournaments.length > 0 && (
                <label className="grid min-w-0 gap-1 text-xs text-muted lg:min-w-[165px] lg:flex-1">
                  <span className="truncate font-mono text-[11px]">{t("ทัวร์นาเมนต์")}</span>
                  <select
                    className={FILTER_CONTROL_CLASS}
                    value={activeTournament}
                    onChange={(event) => {
                      const value = event.target.value;
                      setTournamentFilter(value);
                      const nextGames = value === ALL_TOURNAMENTS
                        ? activeGames
                        : activeGames.filter((game) => (game.tournament?.id ?? "") === value);
                      const currentLower = focusTeam.trim().toLowerCase();
                      const hasCurrentTeam = Boolean(currentLower) && nextGames.some(
                        (g) => g.blueTeamName?.trim().toLowerCase() === currentLower
                          || g.redTeamName?.trim().toLowerCase() === currentLower,
                      );
                      if (hasCurrentTeam) {
                        setAllTeamsSelected(false);
                        setSelectedTeam(focusTeam);
                      } else {
                        setAllTeamsSelected(true);
                        setSelectedTeam("");
                        if (sortBy === "delta") setSortBy("games");
                      }
                      setSeriesFilter([]);
                      setOpponentFilter("ALL");
                    }}
                  >
                    <option value={ALL_TOURNAMENTS}>{t("ทุกทัวร์นาเมนต์")}</option>
                    <option value="">{t("ไม่สังกัดทัวร์นาเมนต์")}</option>
                    {tournaments.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                  </select>
                </label>
              )}
              {teamNames.length > 0 && (
                <label className="grid min-w-0 gap-1 text-xs text-muted lg:min-w-[140px] lg:flex-1">
                  <span className="truncate font-mono text-[11px]">{t("ทีม")}</span>
                  <select
                    value={focusTeam}
                    onChange={(e) => {
                      const value = e.target.value;
                      setAllTeamsSelected(value === "");
                      setSelectedTeam(value);
                      setOpponentFilter("ALL");
                      setSeriesFilter([]);
                      if (value === "" && sortBy === "delta") setSortBy("games");
                      if (value !== "" && sortBy === "contest") setSortBy("games");
                    }}
                    className={`${FILTER_CONTROL_CLASS} font-bold text-gold`}
                  >
                    <option value="">{t("ทุกทีม")}</option>
                    {teamNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!allTeamsMode && teamNames.length > 0 && (
                <label className="grid min-w-0 gap-1 text-xs text-muted lg:min-w-[140px] lg:flex-1">
                  <span className="truncate font-mono text-[11px]">{t("เจอคู่แข่ง")}</span>
                  <select
                    value={opponentFilter}
                    onChange={(e) => setOpponentFilter(e.target.value)}
                    className={FILTER_CONTROL_CLASS}
                  >
                    <option value="ALL">{t("ทุกทีม")}</option>
                    {opponents.map((opp) => (
                      <option key={opp} value={opp}>
                        {opp}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="min-w-0 lg:min-w-[175px] lg:flex-1">
                <SeriesPicker options={seriesOptions} selected={activeSeries} onChange={setSeriesFilter} />
              </div>
              <label className="grid min-w-0 gap-1 text-xs text-muted lg:min-w-[145px] lg:flex-1">
                <span className="truncate font-mono text-[11px]">{t("วันที่บันทึก")}</span>
                <select
                  className={FILTER_CONTROL_CLASS}
                  value={datePreset}
                  onChange={(event) => {
                    const nextPreset = event.target.value as DatePreset;
                    const currentToday = localCalendarDate(new Date());
                    setToday(currentToday);
                    if (nextPreset === "custom") {
                      if (!dateFrom && !dateTo) {
                        let minTime = Infinity;
                        let maxTime = -Infinity;
                        for (const game of tournamentGames) {
                          if (activeSeries.size > 0 && !activeSeries.has(getGameSeriesKey(game))) continue;
                          if (!scopeMatchesTeam(game)) continue;
                          const time = recordedGameTime(game);
                          if (time === null) continue;
                          if (time < minTime) minTime = time;
                          if (time > maxTime) maxTime = time;
                        }
                        const fallbackFrom = Number.isFinite(minTime)
                          ? localCalendarDate(new Date(minTime))
                          : currentToday;
                        const maxDatedDay = Number.isFinite(maxTime)
                          ? localCalendarDate(new Date(maxTime))
                          : currentToday;
                        setDateFrom(fallbackFrom);
                        setDateTo(maxDatedDay > currentToday ? maxDatedDay : currentToday);
                      }
                    } else {
                      setDateFrom("");
                      setDateTo("");
                    }
                    setDatePreset(nextPreset);
                  }}
                >
                  <option value="all">{t("ทุกช่วงเวลา")}</option>
                  <option value="last7">{t("7 วันล่าสุด")}</option>
                  <option value="last30">{t("30 วันล่าสุด")}</option>
                  <option value="custom">{t("กำหนดวันที่เอง")}</option>
                </select>
              </label>
              <div className="min-w-0 lg:min-w-[165px] lg:flex-1">
                <SectionPicker hiddenSections={hiddenSections} onChange={setHiddenSections} />
              </div>
            </div>

            {datePreset === "custom" && (
              <div className="grid grid-cols-2 gap-2.5 sm:max-w-md">
                <label className="grid min-w-0 gap-1 text-xs text-muted">
                  <span className="truncate font-mono text-[11px]">{t("วันที่บันทึกเริ่มต้น")}</span>
                  <input type="date" className={FILTER_CONTROL_CLASS} value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} />
                </label>
                <label className="grid min-w-0 gap-1 text-xs text-muted">
                  <span className="truncate font-mono text-[11px]">{t("วันที่บันทึกสิ้นสุด")}</span>
                  <input type="date" className={FILTER_CONTROL_CLASS} value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} />
                </label>
              </div>
            )}

            {(hasActiveFilters || undatedExcludedCount > 0) && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-2 text-[11px]">
                <span className="font-mono text-dim">
                  {!invalidDateRange && (
                    <>
                      {allTeamsMode
                        ? t("กำลังแสดงภาพรวมทุกทีม ({0} เกม)", scopedGames.length)
                        : t("กำลังแสดงข้อมูลทีม {0} ({1} เกม)", focusTeam, stats.total)}
                      {undatedExcludedCount > 0 && (
                        <span className="ml-2 text-gold">
                          · {t("หมายเหตุ: ไม่รวม {0} เกมที่ไม่ได้บันทึกวันที่", undatedExcludedCount)}
                        </span>
                      )}
                    </>
                  )}
                </span>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex min-h-7 items-center gap-1 border border-line-strong bg-panel px-2.5 font-display text-[11px] font-semibold text-gold hover:border-gold"
                  >
                    <RotateCcw className="size-3" />
                    <span><StableButtonLabel message="ล้างตัวกรอง" /></span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {canLoadTeamHistory && teamStatus === "error" && (showTeamHistory || !team) && (
          <Alert className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("โหลดประวัติทีมไม่สำเร็จ")}</span>
            <button type="button" onClick={reloadTeamHistory} className="min-h-8 border border-current px-2.5 font-semibold">
              <StableButtonLabel message="ลองใหม่" />
            </button>
          </Alert>
        )}

        {!isPaid ? (
          <section className="mx-auto max-w-xl space-y-4 border border-gold/40 bg-panel p-8 text-center">
            <Trophy className="mx-auto size-12 text-gold" />
            <h2 className="font-display text-lg font-bold text-ink">
              {t("Scrim Analytics พร้อมใช้งานสำหรับแพ็ก Pro, Duo และ Team Pro")}
            </h2>
            <p className="text-sm text-muted">
              {t("วิเคราะห์ Win Rate ฝั่ง Blue/Red, เกมที่ 1–7, ฮีโร่ที่หยิบและโดนแบนบ่อย รวมถึงคู่แข่งที่แพ้ทางจากประวัติ 500 เกมอัตโนมัติ")}
            </p>
            <a
              href="#plans"
              className="inline-flex min-h-10 items-center justify-center border border-gold bg-gold px-6 font-display text-xs font-bold text-bg hover:bg-gold/90"
            >
              <StableButtonLabel message="ดูแพ็ก" />
            </a>
          </section>
        ) : showTeamHistory && teamStatus !== "ready" ? (
          teamStatus === "loading" && (
            <section role="status" className="border border-dashed border-line bg-panel/40 p-8 text-center text-sm text-muted">
              {t("กำลังโหลดประวัติทีม")}
            </section>
          )
        ) : invalidDateRange ? (
          <Alert>{t("วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น")}</Alert>
        ) : (allTeamsMode ? scopedGames.length : stats.total) === 0 ? (
          <section className="space-y-3 border border-dashed border-line bg-panel/40 p-10 text-center text-sm text-muted">
            <p>{activeGames.length === 0 ? t("ยังไม่มีเกมที่บันทึกในประวัติสำหรับแสดงสถิติ") : t("ไม่พบเกมตามตัวกรอง")}</p>
            {activeGames.length > 0 && hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex min-h-9 items-center gap-1.5 border border-gold/60 bg-gold/10 px-4 font-display text-xs font-bold text-gold hover:bg-gold hover:text-bg"
              >
                <RotateCcw className="size-3.5" />
                <span><StableButtonLabel message="ล้างตัวกรอง" /></span>
              </button>
            )}
          </section>
        ) : DASHBOARD_SECTIONS.every(([key]) => hiddenSections.includes(key)) ? (
          <p role="status" className="border border-dashed border-line bg-panel/40 p-6 text-center text-sm text-muted">
            {t("เลือกอย่างน้อยหนึ่งส่วนเพื่อแสดงบน Dashboard")}
          </p>
        ) : allTeamsMode && allStats ? (
          <>
            {/* All Teams Row 1: Executive KPIs */}
            {!hiddenSections.includes("overview") && (
            <section aria-label={t("ภาพรวมทัวร์นาเมนต์")} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="border border-line bg-panel p-4">
                <p className="font-mono text-xs text-muted">{t("จำนวนเกมทั้งหมด")}</p>
                <p className="mt-1 font-mono text-2xl font-extrabold text-ink">
                  {allStats.total} <span className="text-sm font-normal text-dim">({allStats.seriesCount} {t("ซีรีส์")})</span>
                </p>
                <p className="mt-1.5 font-mono text-xs text-muted">
                  {t("ลงผลแล้ว {0}/{1} เกม", allStats.decided, allStats.total)} ·{" "}
                  <strong className="text-gold">{allStats.teamRows.length}</strong> {t("ทีม")}
                </p>
              </div>

              <div className="border border-line bg-panel p-4">
                <p className="font-mono text-xs text-muted">{t("อัตราชนะแยกฝั่ง (Blue vs Red)")}</p>
                <div className="mt-2 flex items-baseline justify-between gap-3">
                  <div>
                    <span className="font-mono text-xs font-bold text-blue">BLUE </span>
                    <span className="font-mono text-lg font-extrabold text-ink">
                      {wrPct(allStats.blueWins, allStats.decided)}
                    </span>
                    <p className="font-mono text-[11px] text-dim">
                      {allStats.blueWins}/{allStats.decided}
                      {allStats.blueCi ? ` · [${allStats.blueCi[0].toFixed(0)}–${allStats.blueCi[1].toFixed(0)}%]` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-xs font-bold text-red">RED </span>
                    <span className="font-mono text-lg font-extrabold text-ink">
                      {wrPct(allStats.redWins, allStats.decided)}
                    </span>
                    <p className="font-mono text-[11px] text-dim">
                      {allStats.redWins}/{allStats.decided}
                      {allStats.redCi ? ` · [${allStats.redCi[0].toFixed(0)}–${allStats.redCi[1].toFixed(0)}%]` : ""}
                    </p>
                  </div>
                </div>
                <p
                  title={`p=${fmtPValue(allStats.sideTest.pValue)}`}
                  className={`mt-2 font-mono text-[11px] ${allStats.sideTest.significant95 ? "font-bold text-gold" : "text-dim"}`}
                >
                  {t(sideVerdict)}
                </p>
              </div>

              <div className="border border-line bg-panel p-4">
                <p className="font-mono text-xs text-muted">{t("ความกว้างคลังฮีโร่ (Hero Pool Depth)")}</p>
                <p className="mt-1 font-mono text-2xl font-extrabold text-ink">
                  {allStats.uniqueHeroCount} <span className="text-sm font-normal text-dim">{t("ตัวที่ใช้จริง")}</span>
                </p>
                <p className="mt-1 font-mono text-xs text-gold">
                  Effective Pool: <strong>{allStats.effectiveHeroPool.toFixed(1)}</strong> {t("ตัว")}
                  <span className="text-dim"> · {t("กระจายใช้งาน")} {allStats.poolEvennessPct.toFixed(0)}%</span>
                </p>
              </div>

              <div className="border border-gold/30 bg-panel p-4">
                <p className="font-mono text-xs text-muted">{t("ทีมผลงานเด่นสุด")}</p>
                {(() => {
                  const topTeam = allStats.teamRows.find((r) => r.decided >= 2) ?? allStats.teamRows[0];
                  if (!topTeam) return <p className="mt-2 font-mono text-sm text-dim">—</p>;
                  return (
                    <>
                      <div className="mt-1 flex items-baseline justify-between gap-2">
                        <span className="truncate font-display text-xl font-extrabold text-gold">{topTeam.team}</span>
                        <span className="font-mono text-lg font-extrabold text-good">{wrPct(topTeam.wins, topTeam.decided)}</span>
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-muted">
                        {topTeam.wins}W-{topTeam.losses}L ({topTeam.seriesCount} {t("ซีรีส์")})
                      </p>
                      <button
                        type="button"
                        onClick={() => selectSpecificTeam(topTeam.team)}
                        className="mt-2 inline-flex min-h-7 items-center border border-gold/50 bg-gold/10 px-2.5 font-display text-[11px] font-bold text-gold hover:bg-gold hover:text-bg"
                      >
                        {t("เจาะลึกทีม {0}", topTeam.team)}
                      </button>
                    </>
                  );
                })()}
              </div>
            </section>
            )}

            {/* All Teams Row 2: G1-G7 Side Split + Team Standings */}
            {!hiddenSections.includes("form") && (
            <section className="grid gap-4 lg:grid-cols-3">
              <div className="border border-line bg-panel p-4 lg:col-span-2">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Layers className="size-4 text-gold" />
                    <h2 className="font-display text-sm font-bold tracking-wider text-ink">
                      {t("สัดส่วนชนะ Blue vs Red แยกตามเกม (G1–G7)")}
                    </h2>
                  </div>
                  <span className="font-mono text-[11px] text-dim">Blue % / Red %</span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                  {[1, 2, 3, 4, 5, 6, 7].map((gNum) => {
                    const row = allStats.byGameNum.get(gNum);
                    const hasData = Boolean(row && row.decided > 0);
                    const bluePct = row && row.decided > 0 ? (row.blueWins / row.decided) * 100 : 50;
                    return (
                      <div key={gNum} className="flex flex-col justify-between border border-line bg-bg p-2.5">
                        <div className="flex items-center justify-between font-mono text-xs">
                          <span className="font-bold text-gold">G{gNum}{gNum === 7 ? " Ult" : ""}</span>
                          <span className="text-dim">{row?.total ?? 0}g</span>
                        </div>
                        <div className="my-2 flex h-16 flex-col justify-end overflow-hidden bg-panel-2/60 p-1">
                          {hasData ? (
                            <div className="flex h-full w-full flex-col">
                              <div className="bg-red/75" style={{ height: `${100 - bluePct}%` }} />
                              <div className="bg-blue/85" style={{ height: `${bluePct}%` }} />
                            </div>
                          ) : (
                            <div className="h-[4%] w-full bg-line" />
                          )}
                        </div>
                        <div className="flex items-baseline justify-between font-mono text-[10px]">
                          <span className={hasData ? "font-bold text-blue" : "text-dim"}>
                            {row && row.decided > 0 ? `B:${bluePct.toFixed(0)}%` : "—"}
                          </span>
                          <span className={hasData ? "font-bold text-red" : "text-dim"}>
                            {row && row.decided > 0 ? `R:${(100 - bluePct).toFixed(0)}%` : "0-0"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="border border-line bg-panel p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Trophy className="size-4 text-gold" />
                    <h2 className="font-display text-sm font-bold tracking-wider text-ink">
                      {t("อันดับผลงานแต่ละทีม")}
                    </h2>
                  </div>
                  <span className="font-mono text-[10px] text-dim">{t("คลิกเพื่อดูรายทีม")}</span>
                </div>
                <div className="max-h-56 overflow-y-auto border border-line">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 bg-panel-2 font-mono text-[10px] text-muted">
                      <tr>
                        <th className="px-2.5 py-1.5">{t("ทีม")}</th>
                        <th className="px-2.5 py-1.5 text-right">{t("เกม")}</th>
                        <th className="px-2.5 py-1.5 text-right">W - L</th>
                        <th className="px-2.5 py-1.5 text-right">WR%</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line bg-bg">
                      {allStats.teamRows.map((row) => (
                        <tr
                          key={row.team}
                          onClick={() => selectSpecificTeam(row.team)}
                          className="cursor-pointer transition-colors hover:bg-panel-2/60"
                        >
                          <td className="px-2.5 py-1.5 font-display font-bold text-ink">
                            {row.team}
                            <span className="ml-1 font-mono text-[10px] font-normal text-dim">({row.seriesCount}s)</span>
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono text-muted">{row.games}</td>
                          <td className="px-2.5 py-1.5 text-right font-mono text-muted">{row.wins}-{row.losses}</td>
                          <td className={`px-2.5 py-1.5 text-right font-mono font-bold ${row.decided === 0 ? "text-dim" : row.wins / row.decided >= 0.5 ? "text-good" : "text-red"}`}>
                            {wrPct(row.wins, row.decided)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
            )}

            {/* All Teams Row 3: Pick Timing & Ban / Contest Intelligence */}
            {!hiddenSections.includes("draft") && (
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <PhasePickCard phase1Top={allStats.phase1Top} phase2Top={allStats.phase2Top} heroMap={heroMap} />

              <div className="space-y-3 border border-line bg-panel p-4">
                <div className="flex items-center gap-2">
                  <ShieldBan className="size-4 text-red" />
                  <h2 className="font-display text-sm font-bold tracking-wider text-ink">
                    {t("ฮีโร่ที่ถูกแบนบ่อย & อัตรา Contest (Pick + Ban)")}
                  </h2>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-2 font-mono text-[11px] font-bold text-red">{t("ฮีโร่ที่ถูกแบนบ่อย")}</p>
                    <ul className="space-y-1.5">
                      {allStats.topBans.map((b) => (
                        <li key={`tb-${b.hero}`} className="flex items-center justify-between gap-2 border border-line bg-bg px-2 py-1.5 text-xs">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="size-6 shrink-0 overflow-hidden border border-line">
                              <HeroPortrait name={b.hero} hero={heroMap.get(b.hero)} />
                            </div>
                            <span className="truncate font-semibold text-ink">{displayName(b.hero)}</span>
                          </div>
                          <span className="shrink-0 font-mono text-muted">
                            <strong className="text-red">{b.total}</strong>{" "}
                            <span className="text-[10px] text-dim">(P1:{b.p1}/P2:{b.p2})</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-2 font-mono text-[11px] font-bold text-gold">{t("Contest Rate สูงสุด")}</p>
                    <ul className="space-y-1.5">
                      {allStats.topContested.map((h) => (
                        <li key={`tc-${h.hero}`} className="flex items-center justify-between gap-2 border border-line bg-bg px-2 py-1.5 text-xs">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="size-6 shrink-0 overflow-hidden border border-line">
                              <HeroPortrait name={h.hero} hero={heroMap.get(h.hero)} />
                            </div>
                            <span className="truncate font-semibold text-ink">{displayName(h.hero)}</span>
                          </div>
                          <span className="shrink-0 font-mono text-muted">
                            <strong className="text-gold">{h.contestPct.toFixed(0)}%</strong>{" "}
                            <span className="text-[10px] text-dim">({h.games}P/{h.bans}B)</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </section>
            )}

            {/* All Teams Row 4: Full Sortable Hero Performance Table */}
            {!hiddenSections.includes("heroes") && (
            <section className="border border-line bg-panel p-4">
              <HeroTableToolbar
                title={t("ตารางผลงานฮีโร่ทั้งหมด")}
                count={filteredAllHeroRows.length}
                laneFilter={laneFilter}
                onLaneChange={setLaneFilter}
                heroSearch={heroSearch}
                onSearchChange={setHeroSearch}
                sortBy={sortBy}
                onSortChange={setSortBy}
                includeContestSort
              />
              <div className="max-h-96 overflow-auto border border-line">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-panel-2 font-mono text-[11px] text-muted">
                    <tr>
                      <th className="px-3 py-2">{t("ฮีโร่")}</th>
                      <th className="px-3 py-2">{t(laneFilter === "ALL" ? "เลนหลัก" : "เลน")}</th>
                      <th className="px-3 py-2 text-right">{t("Pick")}</th>
                      <th className="px-3 py-2 text-right">{t("Ban")}</th>
                      <th className="px-3 py-2 text-right">Contest%</th>
                      <th className="px-3 py-2 text-right">W - L</th>
                      <th className="px-3 py-2">{t("Win Rate")}</th>
                      <th className="px-3 py-2 text-right">{t("Bayes WR")}</th>
                      <th className="px-3 py-2 text-right">{t("หยิบ Phase แรก")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line bg-bg">
                    {filteredAllHeroRows.map((row) => {
                      const topLane = laneFilter === "ALL"
                        ? Object.entries(row.lanes).sort((a, b) => b[1].games - a[1].games)[0]?.[0] as LaneKey | undefined
                        : laneFilter;
                      const wr = row.decided > 0 ? (row.wins / row.decided) * 100 : 0;
                      const p1Pct = row.games > 0 ? (row.phase1Count / row.games) * 100 : 0;
                      return (
                        <tr key={row.hero} className="hover:bg-panel-2/40">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="size-6 shrink-0 overflow-hidden border border-line">
                                <HeroPortrait name={row.hero} hero={heroMap.get(row.hero)} />
                              </div>
                              <span className="font-semibold text-ink">{displayName(row.hero)}</span>
                              {row.flexLaneCount >= 2 && (
                                <span className="border border-blue/40 bg-blue/10 px-1 py-0.5 font-mono text-[9px] font-bold text-blue">
                                  FLEX {row.flexLaneCount}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono text-muted">
                            {topLane ? (LANE_SHORT[topLane]?.en ?? topLane) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-ink">{row.games}</td>
                          <td className="px-3 py-2 text-right font-mono text-red">{row.bans}</td>
                          <td className="px-3 py-2 text-right font-mono text-gold">{row.contestPct.toFixed(0)}%</td>
                          <td className="px-3 py-2 text-right font-mono text-muted">{row.wins}-{row.losses}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-20 bg-panel-2">
                                <div
                                  className={wr >= 50 ? "h-full bg-good" : "h-full bg-red"}
                                  style={{ width: `${row.decided > 0 ? wr : 0}%` }}
                                />
                              </div>
                              <span className={`font-mono font-bold ${row.decided === 0 ? "text-dim" : wr >= 50 ? "text-good" : "text-red"}`}>
                                {wrPct(row.wins, row.decided)}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-ink">
                            {(row.bayesianWr * 100).toFixed(1)}%
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-gold">
                            {row.games > 0 ? `${p1Pct.toFixed(0)}%` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
            )}

            {/* All Teams Row 5: Duos & Lane Matchups */}
            {!hiddenSections.includes("matchups") && (
            <section className="grid gap-4 lg:grid-cols-2">
              <DuosCard duos={allStats.topDuos} heroMap={heroMap} />

              <div className="border border-line bg-panel p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Swords className="size-4 text-gold" />
                    <h2 className="font-display text-sm font-bold tracking-wider text-ink">
                      {t("ชนเลนตรง (Same-Lane Matchups · Bradley-Terry)")}
                    </h2>
                  </div>
                  <span className="font-mono text-[10px] text-dim">Counter Lift</span>
                </div>
                {allStats.laneStrengths.length === 0 ? (
                  <p className="text-xs text-dim">
                    {t("ยังไม่มีข้อมูลการชนเลนตรง (ต้องลงตำแหน่งเลนของฮีโร่อย่างน้อย 2 เกมต่อคู่)")}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {allStats.laneStrengths.map((m) => (
                      <li
                        key={`als-${m.lane}-${m.allyHero}-${m.enemyHero}`}
                        title={`${t("มั่นใจ")} ${m.probAdvantagePct.toFixed(0)}% · Z=${m.zScore.toFixed(2)} · Counter Lift ${fmtSignedPct(m.counterLiftPct)}`}
                        className="flex items-center justify-between gap-2 border border-line bg-bg px-2.5 py-1.5 text-xs"
                      >
                        <div className="min-w-0 truncate">
                          <span className="mr-1.5 font-mono text-[10px] text-gold">
                            {LANE_SHORT[m.lane]?.en ?? m.lane}
                          </span>
                          <span className="font-semibold text-good">{displayName(m.allyHero)}</span>
                          <span className="mx-1 text-[10px] text-dim">{t("ชนะทาง")}</span>
                          <span className="font-semibold text-ink">{displayName(m.enemyHero)}</span>
                        </div>
                        <span className="shrink-0 font-mono">
                          <strong className="text-good">{wrPct(m.wins, m.decided)}</strong>{" "}
                          <span className="text-muted">({m.wins}W-{m.losses}L)</span>{" "}
                          <span className="text-[10px] text-dim">{fmtSignedPct(m.counterLiftPct)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
            )}

            {!hiddenSections.includes("methods") && <MethodsReferenceCard />}
          </>
        ) : (
          <>
            {/* Row 1: Executive KPIs */}
            {!hiddenSections.includes("overview") && (
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="border border-line bg-panel p-4">
                <p className="font-mono text-xs text-muted">{t("จำนวนเกมทั้งหมด")}</p>
                <p className="mt-1 font-mono text-2xl font-extrabold text-ink">
                  {stats.total} <span className="text-sm font-normal text-dim">({stats.seriesCount} {t("ซีรีส์")})</span>
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-xs">
                  <span className="text-good">{stats.wins}W - {stats.losses}L</span>
                  {stats.ewmaCurrentPct !== null && (
                    <span className="border border-line bg-bg px-1.5 py-0.5 text-[11px] text-ink">
                      {t("ฟอร์มล่าสุด EWMA:")}{" "}
                      <strong className={stats.ewmaCurrentPct >= 50 ? "text-good" : "text-red"}>
                        {stats.ewmaCurrentPct.toFixed(1)}%
                      </strong>
                    </span>
                  )}
                </div>
              </div>

              <div className="border border-gold/30 bg-panel p-4">
                <p className="font-mono text-xs text-muted">{t("Win Rate รวม")}</p>
                <p className="mt-1 font-mono text-2xl font-extrabold text-gold">
                  {wrPct(stats.wins, stats.decided)}
                </p>
                <p className="mt-1 font-mono text-[11px] text-muted">
                  {t("ลงผลแล้ว {0}/{1} เกม", stats.decided, stats.total)}
                </p>
                {stats.overallCi && (
                  <CiRangeBar ratePct={overallWrPct} ci={stats.overallCi} />
                )}
                {stats.draftEdge !== null && (
                  <p
                    className="mt-1.5 font-mono text-[11px] text-muted"
                    title={`${t("ชนะจริง")} ${stats.draftEdge.actualWins} · ${t("AI คาดการณ์")} ${stats.draftEdge.expectedWins.toFixed(1)} (${stats.draftEdge.evaluatedGames}g)`}
                  >
                    {t("เทียบ AI ดราฟต์:")}{" "}
                    <strong className={stats.draftEdge.winsAboveExpected >= 0 ? "text-good" : "text-red"}>
                      {stats.draftEdge.winsAboveExpected >= 0 ? "+" : ""}
                      {stats.draftEdge.winsAboveExpected.toFixed(1)} {t("เกม")}
                    </strong>
                  </p>
                )}
              </div>

              <div className="border border-line bg-panel p-4">
                <p className="font-mono text-xs text-muted">{t("อัตราชนะแยกฝั่ง (Blue vs Red)")}</p>
                <div className="mt-2 flex items-baseline justify-between gap-3">
                  <div>
                    <span className="font-mono text-xs font-bold text-blue">BLUE </span>
                    <span className="font-mono text-lg font-extrabold text-ink">
                      {wrPct(stats.blueWins, stats.blueDecided)}
                    </span>
                    <p className="font-mono text-[11px] text-dim">
                      {stats.blueWins}/{stats.blueDecided}
                      {stats.blueCi ? ` · [${stats.blueCi[0].toFixed(0)}–${stats.blueCi[1].toFixed(0)}%]` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-xs font-bold text-red">RED </span>
                    <span className="font-mono text-lg font-extrabold text-ink">
                      {wrPct(stats.redWins, stats.redDecided)}
                    </span>
                    <p className="font-mono text-[11px] text-dim">
                      {stats.redWins}/{stats.redDecided}
                      {stats.redCi ? ` · [${stats.redCi[0].toFixed(0)}–${stats.redCi[1].toFixed(0)}%]` : ""}
                    </p>
                  </div>
                </div>
                <p
                  title={`p=${fmtPValue(stats.sideTest.pValue)}`}
                  className={`mt-2 font-mono text-[11px] ${stats.sideTest.significant95 ? "font-bold text-gold" : "text-dim"}`}
                >
                  {t(sideVerdict)}
                </p>
                {stats.seriesWinProb !== null && (
                  <p
                    className="mt-1 font-mono text-[11px] text-muted"
                    title={`${t("เริ่ม Blue:")} ${stats.seriesWinProb.bo5StartBluePct.toFixed(1)}% · ${t("เริ่ม Red:")} ${stats.seriesWinProb.bo5StartRedPct.toFixed(1)}%`}
                  >
                    {t("โอกาสปิดซีรีส์:")} Bo5{" "}
                    <strong className="text-ink">{stats.seriesWinProb.bo5Pct.toFixed(0)}%</strong> · Bo7{" "}
                    <strong className="text-ink">{stats.seriesWinProb.bo7Pct.toFixed(0)}%</strong>
                  </p>
                )}
              </div>

              <div className="border border-line bg-panel p-4">
                <p className="font-mono text-xs text-muted">{t("ความกว้างคลังฮีโร่ (Hero Pool Depth)")}</p>
                <p className="mt-1 font-mono text-2xl font-extrabold text-ink">
                  {stats.uniqueHeroCount} <span className="text-sm font-normal text-dim">{t("ตัวที่ใช้จริง")}</span>
                </p>
                <p className="mt-1 font-mono text-xs text-gold">
                  Effective Pool: <strong>{stats.effectiveHeroPool.toFixed(1)}</strong> {t("ตัว")}
                  <span className="text-dim"> · {t("กระจายใช้งาน")} {stats.poolEvennessPct.toFixed(0)}%</span>
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-dim">
                  {t("เฉลี่ย")} {(stats.uniqueHeroCount / 5).toFixed(1)} {t("ตัว/ตำแหน่ง")}
                </p>
              </div>
            </section>
            )}

            {/* Row 2: Global Ban Curve (G1-G7) + EWMA Momentum */}
            {!hiddenSections.includes("form") && (
            <section className="grid gap-4 lg:grid-cols-3">
              <div className="border border-line bg-panel p-4 lg:col-span-2">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Layers className="size-4 text-gold" />
                    <h2 className="font-display text-sm font-bold tracking-wider text-ink">
                      {t("ผลงานแยกตามลำดับเกมในซีรีส์ Global Ban (G1–G7)")}
                    </h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                    {stats.fatigueSlopePctPerGame !== null ? (
                      <span
                        className={`border px-2 py-0.5 ${
                          stats.fatigueSlopePctPerGame >= 0
                            ? "border-good/40 bg-good/10 text-good"
                            : "border-red/40 bg-red/10 text-red"
                        }`}
                      >
                        {t("ความชัน G1→G7:")} {fmtSignedPct(stats.fatigueSlopePctPerGame)}/{t("เกม")}
                      </span>
                    ) : (
                      <span className="text-dim">{t("เช็กความแข็งแกร่งช่วงต้นซีรีส์ vs เกมตัดสิน G5–G7")}</span>
                    )}
                    {[1, 2, 3].some((n) => (stats.byGameNum.get(n)?.decided ?? 0) > 0) &&
                      [4, 5, 6, 7].some((n) => (stats.byGameNum.get(n)?.decided ?? 0) > 0) && (
                        <span className="text-dim" title={`p=${fmtPValue(stats.earlyVsLateTest.pValue)}`}>
                          G1–3 vs G4–7: {t("มั่นใจ")} {stats.earlyVsLateTest.probDominantPct.toFixed(0)}%
                        </span>
                      )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                  {[1, 2, 3, 4, 5, 6, 7].map((gNum) => {
                    const row = stats.byGameNum.get(gNum);
                    const pct = row && row.decided > 0 ? (row.wins / row.decided) * 100 : 0;
                    const hasData = Boolean(row && row.decided > 0);
                    const ciLabel = row?.ci ? `Wilson 95% CI: [${row.ci[0].toFixed(1)}%–${row.ci[1].toFixed(1)}%]` : undefined;
                    return (
                      <div key={gNum} title={ciLabel} className="flex flex-col justify-between border border-line bg-bg p-2.5">
                        <div className="flex items-center justify-between font-mono text-xs">
                          <span className="font-bold text-gold">G{gNum}{gNum === 7 ? " Ult" : ""}</span>
                          <span className="text-dim">{row?.total ?? 0}g</span>
                        </div>
                        <div className="my-2 flex h-16 items-end bg-panel-2/60 p-1">
                          <div
                            className={`w-full transition-all ${!hasData ? "bg-line" : pct >= 50 ? "bg-good/80" : "bg-red/80"}`}
                            style={{ height: `${hasData ? Math.max(10, pct) : 4}%` }}
                          />
                        </div>
                        <div className="flex items-baseline justify-between font-mono text-xs">
                          <strong className={!hasData ? "text-dim" : pct >= 50 ? "text-good" : "text-red"}>
                            {row ? wrPct(row.wins, row.decided) : "—"}
                          </strong>
                          <span className="text-[10px] text-muted">
                            {row ? `${row.wins}W-${row.decided - row.wins}L` : "0-0"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="border border-line bg-panel p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Activity className="size-4 text-gold" />
                  <h2 className="font-display text-sm font-bold tracking-wider text-ink">
                    {t("แนวโน้มฟอร์มล่าสุด (EWMA Momentum)")}
                  </h2>
                </div>
                <EwmaSparkline
                  points={stats.ewmaSeries}
                  currentPct={stats.ewmaCurrentPct}
                  deltaPct={stats.ewmaDeltaPct}
                  t={t}
                />
              </div>
            </section>
            )}

            {/* Row 3: Draft Phase & Ban Intelligence (+ Protective Phase 2 Bans) */}
            {!hiddenSections.includes("draft") && (
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <PhasePickCard phase1Top={stats.phase1Top} phase2Top={stats.phase2Top} heroMap={heroMap} />

              <div className="space-y-3 border border-line bg-panel p-4">
                <div className="flex items-center gap-2">
                  <ShieldBan className="size-4 text-red" />
                  <h2 className="font-display text-sm font-bold tracking-wider text-ink">
                    {t("สถิติการแบน (โดนคู่แข่ง Target Ban vs แบนออกเอง)")}
                  </h2>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-2 font-mono text-[11px] font-bold text-red">{t("โดนคู่แข่งแบนใส่บ่อยสุด")}</p>
                    <ul className="space-y-1.5">
                      {stats.bansAgainstUs.map((b) => (
                        <li key={`bu-${b.hero}`} className="flex items-center justify-between gap-2 border border-line bg-bg px-2 py-1.5 text-xs">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="size-6 shrink-0 overflow-hidden border border-line">
                              <HeroPortrait name={b.hero} hero={heroMap.get(b.hero)} />
                            </div>
                            <span className="truncate font-semibold text-ink">{displayName(b.hero)}</span>
                          </div>
                          <span className="shrink-0 font-mono text-muted">
                            <strong className="text-red">{b.total}</strong>{" "}
                            <span className="text-[10px] text-dim">(P1:{b.p1}/P2:{b.p2})</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-2 font-mono text-[11px] font-bold text-muted">{t("ตัวที่ทีมเราแบนทิ้งบ่อยสุด")}</p>
                    <ul className="space-y-1.5">
                      {stats.bansByUs.map((b) => (
                        <li key={`bo-${b.hero}`} className="flex items-center justify-between gap-2 border border-line bg-bg px-2 py-1.5 text-xs">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="size-6 shrink-0 overflow-hidden border border-line">
                              <HeroPortrait name={b.hero} hero={heroMap.get(b.hero)} />
                            </div>
                            <span className="truncate font-semibold text-ink">{displayName(b.hero)}</span>
                          </div>
                          <span className="shrink-0 font-mono text-muted">
                            <strong className="text-ink">{b.total}</strong>{" "}
                            <span className="text-[10px] text-dim">(P1:{b.p1}/P2:{b.p2})</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {stats.protectiveBans.length > 0 && (
                  <div className="border-t border-line pt-2.5">
                    <p className="mb-1.5 font-mono text-[11px] font-bold text-gold">
                      {t("แบนแก้ทาง Phase 2 (คู่แข่งรีบแบนหลังเราเปิด Phase แรก)")}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {stats.protectiveBans.map((pb) => (
                        <span
                          key={`${pb.pickedHero}-${pb.bannedHero}`}
                          className="border border-line bg-bg px-2 py-1 font-mono text-[11px] text-muted"
                        >
                          <strong className="text-ink">{displayName(pb.pickedHero)}</strong> → Ban{" "}
                          <strong className="text-red">{displayName(pb.bannedHero)}</strong>{" "}
                          <span className="text-gold">({pb.coCount}x · Lift {pb.banLift.toFixed(1)}x)</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
            )}

            {/* Row 4: 5-Lane Sortable Hero Table with Bayesian WR & Team Delta */}
            {!hiddenSections.includes("heroes") && (
            <section className="border border-line bg-panel p-4">
              <HeroTableToolbar
                title={t("ตารางผลงานฮีโร่ทั้งหมดของทีม")}
                count={filteredHeroRows.length}
                laneFilter={laneFilter}
                onLaneChange={setLaneFilter}
                heroSearch={heroSearch}
                onSearchChange={setHeroSearch}
                sortBy={sortBy}
                onSortChange={setSortBy}
                includeDeltaSort
              />

              <div className="max-h-96 overflow-auto border border-line">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-panel-2 font-mono text-[11px] text-muted">
                    <tr>
                      <th className="px-3 py-2">{t("ฮีโร่")}</th>
                      <th className="px-3 py-2">{t(laneFilter === "ALL" ? "เลนหลัก" : "เลน")}</th>
                      <th className="px-3 py-2 text-right">{t("เกม")}</th>
                      <th className="px-3 py-2 text-right">W - L</th>
                      <th className="px-3 py-2">{t("Win Rate")}</th>
                      <th
                        className="px-3 py-2 text-right"
                        title={t("Win Rate ปรับฐานแบบ Empirical Bayes เทียบค่าเฉลี่ยของทีม")}
                      >
                        {t("Bayes WR (เทียบทีม)")}
                      </th>
                      <th
                        className="px-3 py-2 text-right"
                        title={t("สัดส่วนที่หยิบใน 3 ตัวแรกของทีม ก่อนแบนรอบ 2")}
                      >
                        {t("หยิบ Phase แรก")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line bg-bg">
                    {filteredHeroRows.map((row) => {
                      const topLane = laneFilter === "ALL"
                        ? Object.entries(row.lanes).sort((a, b) => b[1].games - a[1].games)[0]?.[0] as LaneKey | undefined
                        : laneFilter;
                      const wr = row.decided > 0 ? (row.wins / row.decided) * 100 : 0;
                      const p1Pct = (row.phase1Count / row.games) * 100;
                      const bayWrPct = row.bayesianWr * 100;
                      return (
                        <tr key={row.hero} className="hover:bg-panel-2/40">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="size-6 shrink-0 overflow-hidden border border-line">
                                <HeroPortrait name={row.hero} hero={heroMap.get(row.hero)} />
                              </div>
                              <span className="font-semibold text-ink">{displayName(row.hero)}</span>
                              {row.flexLaneCount >= 2 && (
                                <span className="border border-blue/40 bg-blue/10 px-1 py-0.5 font-mono text-[9px] font-bold text-blue">
                                  FLEX {row.flexLaneCount}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono text-muted">
                            {topLane ? (LANE_SHORT[topLane]?.en ?? topLane) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-ink">{row.games}</td>
                          <td className="px-3 py-2 text-right font-mono text-muted">
                            {row.wins}-{row.losses}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-20 bg-panel-2">
                                <div
                                  className={wr >= 50 ? "h-full bg-good" : "h-full bg-red"}
                                  style={{ width: `${row.decided > 0 ? wr : 0}%` }}
                                />
                              </div>
                              <span
                                className={`font-mono font-bold ${
                                  row.decided === 0 ? "text-dim" : wr >= 50 ? "text-good" : "text-red"
                                }`}
                              >
                                {wrPct(row.wins, row.decided)}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            <strong className="text-ink">{bayWrPct.toFixed(1)}%</strong>{" "}
                            <span
                              className={`text-[11px] font-bold ${
                                row.bayesianDeltaPct >= 0 ? "text-good" : "text-red"
                              }`}
                            >
                              ({fmtSignedPct(row.bayesianDeltaPct)})
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            <span className="text-gold">{p1Pct.toFixed(0)}%</span>
                            {(row.b1Count > 0 || row.r5Count > 0) && (
                              <span className="ml-1.5 text-[10px] text-dim">
                                {row.b1Count > 0 ? `B1:${row.b1Count}` : ""}
                                {row.b1Count > 0 && row.r5Count > 0 ? " " : ""}
                                {row.r5Count > 0 ? `R5:${row.r5Count}` : ""}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
            )}

            {/* Row 5: Bradley-Terry Duos, Enemy Threats, Direct Lane Counters & H2H */}
            {!hiddenSections.includes("matchups") && (
            <section className="grid gap-4 lg:grid-cols-2">
              <DuosCard duos={stats.topDuos} heroMap={heroMap} />

              <div className="border border-line bg-panel p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Swords className="size-4 text-red" />
                    <h2 className="font-display text-sm font-bold tracking-wider text-ink">
                      {t("ฮีโร่ฝั่งตรงข้ามที่แพ้ทาง")}
                    </h2>
                  </div>
                  <span className="font-mono text-[10px] text-dim">{t("เทียบ Win Rate เฉลี่ยทีม")}</span>
                </div>
                {stats.toughestEnemies.length === 0 ? (
                  <p className="text-xs text-dim">{t("ยังไม่มีข้อมูลผลแพ้ชนะเพียงพอ")}</p>
                ) : (
                  <ul className="space-y-2">
                    {stats.toughestEnemies.map((e) => (
                      <li key={e.hero} className="flex flex-wrap items-center justify-between gap-2 border border-line bg-bg px-2.5 py-2 text-xs">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="size-6 shrink-0 overflow-hidden border border-line">
                            <HeroPortrait name={e.hero} hero={heroMap.get(e.hero)} />
                          </div>
                          <span className="truncate font-semibold text-ink">{displayName(e.hero)}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 font-mono">
                          <span className="font-bold text-red">{fmtSignedPct(e.threatDeltaPct)}</span>
                          <span className="text-ink">{wrPct(e.ourWins, e.decided)}</span>
                          <span
                            className="text-[11px] text-dim"
                            title={`Z=${e.zScore.toFixed(2)}`}
                          >
                            ({e.ourWins}W-{e.ourLosses}L · {t("แพ้จริง")} {e.probThreatPct.toFixed(0)}%)
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="border border-line bg-panel p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Swords className="size-4 text-gold" />
                    <h2 className="font-display text-sm font-bold tracking-wider text-ink">
                      {t("ชนเลนตรง (Same-Lane Matchups · Bradley-Terry)")}
                    </h2>
                  </div>
                  <span className="font-mono text-[10px] text-dim">Counter Lift</span>
                </div>
                {stats.laneStrengths.length === 0 && stats.laneWeaknesses.length === 0 ? (
                  <p className="text-xs text-dim">
                    {t("ยังไม่มีข้อมูลการชนเลนตรง (ต้องลงตำแหน่งเลนของฮีโร่อย่างน้อย 2 เกมต่อคู่)")}
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="mb-1.5 font-mono text-[11px] font-bold text-good">{t("คู่เลนที่ได้เปรียบ")}</p>
                      <ul className="space-y-1.5">
                        {stats.laneStrengths.map((m) => (
                          <li
                            key={`ls-${m.lane}-${m.allyHero}-${m.enemyHero}`}
                            title={`${t("มั่นใจ")} ${m.probAdvantagePct.toFixed(0)}% · Z=${m.zScore.toFixed(2)}`}
                            className="flex items-center justify-between gap-1.5 border border-line bg-bg px-2 py-1.5 text-[11px]"
                          >
                            <div className="min-w-0 truncate">
                              <span className="mr-1 font-mono text-[10px] text-gold">
                                {LANE_SHORT[m.lane]?.en ?? m.lane}
                              </span>
                              <span className="font-semibold text-good">{displayName(m.allyHero)}</span>
                              <span className="mx-1 text-[10px] text-dim">{t("ชนะทาง")}</span>
                              <span className="font-semibold text-ink">{displayName(m.enemyHero)}</span>
                            </div>
                            <span className="shrink-0 font-mono text-good">
                              {fmtSignedPct(m.counterLiftPct)} ({m.wins}W-{m.losses}L)
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-1.5 font-mono text-[11px] font-bold text-red">{t("คู่เลนที่เสียเปรียบ")}</p>
                      <ul className="space-y-1.5">
                        {stats.laneWeaknesses.map((m) => (
                          <li
                            key={`lw-${m.lane}-${m.allyHero}-${m.enemyHero}`}
                            title={`${t("เสียเปรียบจริง")} ${(100 - m.probAdvantagePct).toFixed(0)}% · Z=${m.zScore.toFixed(2)}`}
                            className="flex items-center justify-between gap-1.5 border border-line bg-bg px-2 py-1.5 text-[11px]"
                          >
                            <div className="min-w-0 truncate">
                              <span className="mr-1 font-mono text-[10px] text-gold">
                                {LANE_SHORT[m.lane]?.en ?? m.lane}
                              </span>
                              <span className="font-semibold text-red">{displayName(m.allyHero)}</span>
                              <span className="mx-1 text-[10px] text-dim">{t("แพ้ทาง")}</span>
                              <span className="font-semibold text-ink">{displayName(m.enemyHero)}</span>
                            </div>
                            <span className="shrink-0 font-mono text-red">
                              {fmtSignedPct(m.counterLiftPct)} ({m.wins}W-{m.losses}L)
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>

              <div className="border border-line bg-panel p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="font-display text-sm font-bold tracking-wider text-ink">
                    {t("สถิติเจอแต่ละทีม (Head-to-Head)")}
                  </h2>
                  {opponentFilter !== "ALL" && (
                    <button
                      type="button"
                      onClick={() => setOpponentFilter("ALL")}
                      className="text-xs font-semibold text-gold underline"
                    >
                      {t("ดูทุกทีม")}
                    </button>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto border border-line">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 bg-panel-2 font-mono text-[10px] text-muted">
                      <tr>
                        <th className="px-2.5 py-1.5">{t("คู่แข่ง")}</th>
                        <th className="px-2.5 py-1.5 text-right">{t("เกม")}</th>
                        <th className="px-2.5 py-1.5 text-right">WR%</th>
                        <th className="px-2.5 py-1.5">{t("ตัวที่เจอบ่อย")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line bg-bg">
                      {stats.opponentRows.map((row) => {
                        const decided = row.wins + row.losses;
                        const active = opponentFilter.toLowerCase() === row.opponent.toLowerCase();
                        const ciTip = row.ci
                          ? `Wilson 95% CI: [${row.ci[0].toFixed(1)}%–${row.ci[1].toFixed(1)}%] · p=${fmtPValue(row.vsTeamTest.pValue)}`
                          : undefined;
                        return (
                          <tr
                            key={row.opponent}
                            title={ciTip}
                            onClick={() => setOpponentFilter(active ? "ALL" : row.opponent)}
                            className={`cursor-pointer transition-colors hover:bg-panel-2/60 ${
                              active ? "bg-gold/10" : ""
                            }`}
                          >
                            <td className="px-2.5 py-2 font-display font-bold text-ink [overflow-wrap:anywhere]">
                              {row.opponent}
                              <span className="ml-1 font-mono text-[10px] font-normal text-dim">
                                ({row.seriesCount}s)
                              </span>
                            </td>
                            <td className="px-2.5 py-2 text-right font-mono text-muted">
                              {row.wins}-{row.losses}
                            </td>
                            <td
                              className={`px-2.5 py-2 text-right font-mono font-bold ${
                                decided === 0 ? "text-dim" : row.wins / decided >= 0.5 ? "text-good" : "text-red"
                              }`}
                            >
                              {wrPct(row.wins, decided)}
                              {row.vsTeamTest.significant95 && (
                                <span className="ml-1 text-[10px] text-gold" title={`p=${fmtPValue(row.vsTeamTest.pValue)}`}>
                                  *
                                </span>
                              )}
                            </td>
                            <td className="px-2.5 py-2 text-[11px] text-muted">
                              {row.topEnemies.map(([h]) => displayName(h)).join(", ") || "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
            )}

            {/* Row 6: Collapsible Deep Math & Citations Reference */}
            {!hiddenSections.includes("methods") && <MethodsReferenceCard />}
          </>
        )}
      </div>
    </main>
  );
}

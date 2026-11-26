import {
  Activity,
  ArrowLeft,
  ArrowUpDown,
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileText,
  Gift,
  Info,
  Layers,
  RotateCcw,
  Search,
  ShieldBan,
  Sparkles,
  Swords,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { ApiError, getJson, isAbortError } from "../api/client";
import {
  fetchSampleAnalytics,
  type SampleAnalyticsResponse,
  type SampleDatasetId,
  type SampleTournamentOption,
} from "../api/sampleAnalytics";
import { getTeam, teamPath, type Team, type TeamGame } from "../api/team";
import { useLanguage } from "../i18n/language";
import type { Hero, LaneKey, RecordedDraftGame } from "../types/draft";
import { getGameSeriesGroup, getGameSeriesKey, LANE_SHORT, listTournaments } from "../utils/draft";
import { displayName } from "../utils/heroNames";
import { computePeriodDiff, computeScrimAdvancedStats, splitGamesForPeriodDiff } from "../utils/scrimAdvancedStats";
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
import {
  BlindCounterSlotCard,
  CompArchetypeCard,
  FlexEffectivenessCard,
  PeriodDiffCard,
  PositionalPoolCard,
  TrioSynergyCard,
} from "./scrim/ScrimAdvancedCards";
import { ScoutingReportModal } from "./scrim/ScoutingReportModal";
import { StableButtonLabel } from "./StableButtonLabel";
import { trackTelemetryEvent } from "../utils/telemetry";

interface ScrimDashboardViewProps {
  personalGames: RecordedDraftGame[];
  heroMap: Map<string, Hero>;
  isPaid: boolean;
  isAuthenticated?: boolean;
  teamHistoryEnabled: boolean;
  freePromoUntil?: number | null;
  defaultTeamName?: string;
  onOpenAuthModal?: () => void;
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
const SCRIM_TABS = [
  ["overview", "ภาพรวม & ฟอร์ม"],
  ["draft", "ดราฟต์ & Pick/Ban"],
  ["heroes", "ตารางฮีโร่ & เมต้า"],
  ["matchups", "คอมโบ & Matchups"],
] as const;
type ScrimDashboardTab = typeof SCRIM_TABS[number][0];
const SAVED_FILTERS_KEY_PREFIX = "minidraft_scrim_filters_v1:";
const ALL_TOURNAMENTS = "*";
const EMPTY_GAMES: RecordedDraftGame[] = [];
const DEFAULT_SAMPLE_TOURNAMENT_ID: SampleDatasetId = "rpl-2026-winter";
const DEFAULT_SAMPLE_TEAM = "BRU";
const SAMPLE_TOURNAMENT_DEFAULTS: readonly SampleTournamentOption[] = [
  { id: "rpl-2026-winter", name: "RPL 2026 Winter", totalGames: 307 },
  { id: "rpl-2026-summer", name: "RPL 2026 Summer", totalGames: 291 },
];

function resolveSampleDatasetId(value: string): SampleDatasetId {
  if (value === "rpl-2026-summer" || value === "sample-league-2026") return "rpl-2026-summer";
  return "rpl-2026-winter";
}

function isSampleTournamentId(value: string): boolean {
  return value === "rpl-2026-winter" || value === "rpl-2026-summer" || value === "sample-league-2026";
}
const FILTER_CONTROL_CLASS = "min-h-9 min-w-0 w-full border border-line-strong bg-panel px-2.5 font-display text-base font-semibold text-ink focus-visible:outline-2 focus-visible:outline-gold sm:text-xs";

const VALID_DATE_PRESETS: ReadonlySet<DatePreset> = new Set(["all", "last7", "last30", "custom"]);
const VALID_LANE_FILTERS: ReadonlySet<LaneFilterKey> = new Set(["ALL", ...LANES]);
const VALID_SORT_KEYS: ReadonlySet<HeroSortKey> = new Set(["games", "contest", "bayesian", "delta", "winRate", "phase1"]);

interface SavedScrimFilters {
  source: "personal" | "team" | "sample";
  tournamentFilter: string;
  allTeamsSelected: boolean;
  selectedTeam: string;
  opponentFilter: string;
  seriesFilter: string[];
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
  laneFilter: LaneFilterKey;
  sortBy: HeroSortKey;
}

function defaultScrimFilters(): SavedScrimFilters {
  return {
    source: "sample",
    tournamentFilter: DEFAULT_SAMPLE_TOURNAMENT_ID,
    allTeamsSelected: false,
    selectedTeam: DEFAULT_SAMPLE_TEAM,
    opponentFilter: "ALL",
    seriesFilter: [],
    datePreset: "all",
    dateFrom: "",
    dateTo: "",
    laneFilter: "ALL",
    sortBy: "games",
  };
}

function readSavedFilters(isPaid: boolean): SavedScrimFilters {
  const defaults = defaultScrimFilters();
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(`${SAVED_FILTERS_KEY_PREFIX}${isPaid ? "paid" : "demo"}`) ?? "null");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
    const obj = raw as Record<string, unknown>;
    const datePreset = typeof obj.datePreset === "string" && VALID_DATE_PRESETS.has(obj.datePreset as DatePreset)
      ? (obj.datePreset as DatePreset)
      : defaults.datePreset;
    const laneFilter = typeof obj.laneFilter === "string" && VALID_LANE_FILTERS.has(obj.laneFilter as LaneFilterKey)
      ? (obj.laneFilter as LaneFilterKey)
      : defaults.laneFilter;
    const sortBy = typeof obj.sortBy === "string" && VALID_SORT_KEYS.has(obj.sortBy as HeroSortKey)
      ? (obj.sortBy as HeroSortKey)
      : defaults.sortBy;
    const savedSource = !isPaid
      ? "sample"
      : obj.source === "team"
        ? "team"
        : obj.source === "personal"
          ? "personal"
          : "sample";
    return {
      source: savedSource,
      tournamentFilter: typeof obj.tournamentFilter === "string" ? obj.tournamentFilter : defaults.tournamentFilter,
      allTeamsSelected: typeof obj.allTeamsSelected === "boolean" ? obj.allTeamsSelected : defaults.allTeamsSelected,
      selectedTeam: typeof obj.selectedTeam === "string" ? obj.selectedTeam : defaults.selectedTeam,
      opponentFilter: typeof obj.opponentFilter === "string" && obj.opponentFilter ? obj.opponentFilter : defaults.opponentFilter,
      seriesFilter: Array.isArray(obj.seriesFilter) ? obj.seriesFilter.filter((v): v is string => typeof v === "string") : [],
      datePreset,
      dateFrom: typeof obj.dateFrom === "string" ? obj.dateFrom : "",
      dateTo: typeof obj.dateTo === "string" ? obj.dateTo : "",
      laneFilter,
      sortBy,
    };
  } catch {
    return defaults;
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
        <div className="absolute top-full right-0 z-30 mt-1 w-[min(18rem,calc(100vw-2rem))] border border-line-strong bg-panel shadow-xl sm:right-auto sm:left-0 sm:w-80">
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
            className="h-8 w-full border border-line-strong bg-bg pr-8 pl-7 text-base text-ink sm:w-44 sm:text-xs"
          />
          {heroSearch && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label={t("ล้างคำค้นหา")}
              className="absolute top-1/2 right-0.5 grid size-7 -translate-y-1/2 place-items-center text-dim hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <label className="inline-flex items-center gap-1 text-xs text-muted">
          <ArrowUpDown className="size-3.5 text-gold" />
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as HeroSortKey)}
            className="h-8 max-w-full border border-line-strong bg-bg px-2 text-base text-ink sm:text-xs"
          >
            <option value="games">{t("เรียงตามจำนวนเกม")}</option>
            {includeContestSort && <option value="contest">{t("เรียงตาม Contest Rate")}</option>}
            <option value="bayesian">{t("เรียงตาม Win Rate ปรับฐาน")}</option>
            {includeDeltaSort && <option value="delta">{t("เรียงตามส่วนต่างเทียบทีม")}</option>}
            <option value="winRate">{t("เรียงตาม Win Rate")}</option>
            <option value="phase1">{t("เรียงตาม % หยิบ Phase 1")}</option>
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
  previewLimit = 6,
}: {
  phase1Top: readonly HeroPerf[];
  phase2Top: readonly HeroPerf[];
  heroMap: Map<string, Hero>;
  previewLimit?: number;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const maxRows = Math.max(phase1Top.length, phase2Top.length);
  const expandedHeightClass = previewLimit >= 9 ? "max-h-[28rem]" : "max-h-80";
  return (
    <div className="border border-line bg-panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="size-4 text-gold" />
        <h2 className="font-display text-sm font-bold tracking-wider text-ink">
          {t("จังหวะการหยิบ (Phase 1 vs Phase 2)")}
        </h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {([
          ["หยิบเปิด Phase 1 (P1–P3)", "text-gold", phase1Top, (h: HeroPerf) => h.phase1Count, "p1"],
          ["หยิบปิด Phase 2 (P4–P5)", "text-blue", phase2Top, (h: HeroPerf) => h.phase2Count, "p2"],
        ] as const).map(([label, colorClass, rows, getCount, prefix]) => {
          const visibleRows = expanded ? rows : rows.slice(0, previewLimit);
          return (
            <div key={prefix}>
              <p className={`mb-2 font-mono text-[11px] font-bold ${colorClass}`}>{t(label)}</p>
              <ul className={expanded ? `${expandedHeightClass} space-y-1.5 overflow-y-auto pr-1` : "space-y-1.5"}>
                {visibleRows.map((h) => (
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
          );
        })}
      </div>
      <ExpandScrollButton
        expanded={expanded}
        totalCount={maxRows}
        previewLimit={previewLimit}
        onToggle={() => setExpanded((v) => !v)}
      />
    </div>
  );
}

function ExpandScrollButton({
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
      className="mt-2.5 flex min-h-7 w-full items-center justify-center gap-1.5 border border-line bg-bg/70 px-2.5 py-1 font-mono text-[11px] font-semibold text-muted transition-colors hover:border-gold/50 hover:text-gold"
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

function DuosCard({ duos, heroMap }: { duos: readonly DuoStat[]; heroMap: Map<string, Hero> }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const previewLimit = 8;
  const visibleDuos = expanded ? duos : duos.slice(0, previewLimit);
  return (
    <div className="border border-line bg-panel p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-good" />
          <h2 className="font-display text-sm font-bold tracking-wider text-ink">
            {t("คู่คอมโบเด่น")}
          </h2>
          {duos.length > previewLimit && (
            <span className="font-mono text-[11px] text-dim">({duos.length})</span>
          )}
        </div>
        <span className="font-mono text-[10px] text-dim">
          {t("ชนะมากกว่าคาด")}
        </span>
      </div>
      {duos.length === 0 ? (
        <p className="text-xs text-dim">{t("ยังไม่มีข้อมูลคู่คอมโบเพียงพอ")}</p>
      ) : (
        <>
          <ul className={expanded ? "max-h-96 space-y-2 overflow-y-auto pr-1" : "space-y-2"}>
            {visibleDuos.map((d) => (
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
                  <span className="text-[11px] text-dim">
                    ({d.wins}W-{d.losses}L · {t("เสริมจริง")} {d.probSynergyPct.toFixed(0)}%)
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <ExpandScrollButton
            expanded={expanded}
            totalCount={duos.length}
            previewLimit={previewLimit}
            onToggle={() => setExpanded((v) => !v)}
          />
        </>
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
        <span>{t("คำอธิบายค่าสถิติ")}</span>
      </summary>
      <div className="mt-3 grid grid-cols-1 gap-3 border-t border-line pt-3 md:grid-cols-2">
        <div>
          <strong className="text-ink">1. {t("ช่วง Win Rate (95% CI) & โอกาสชนะซีรีส์")}:</strong>{" "}
          {t("ประมาณช่วง Win Rate ที่น่าเชื่อถือเมื่อจำนวนเกมยังน้อย และคำนวณโอกาสปิดซีรีส์ Bo5/Bo7 แบบสลับฝั่ง Blue/Red")}
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
        <div>
          <strong className="text-ink">{t("5. Positional Pool, Flex & Blind/Counter:")}</strong>{" "}
          {t("วัด Shannon Entropy ราย 5 เลนเพื่อเตือนจุดเสี่ยงโดนบีบ Global Ban, แยก WR ตอนหยิบเปิด (P1–P3) vs หยิบปิด (P4–P5) และเทียบเกมที่ใช้ตัว Flex")}
        </div>
        <div>
          <strong className="text-ink">{t("6. Trio Core, Comp Archetypes & Period Diff:")}</strong>{" "}
          {t("วิเคราะห์แกน 3 ตัว (JGL+MID+SUP), จำแนกสไตล์คอมพ์ทีมจาก Role, ความหลากหลาย Phase 1 และเทียบเมต้าข้ามช่วงเวลา/ทัวร์นาเมนต์")}
        </div>
        <div className="md:col-span-2">
          <strong className="text-ink">{t("7. จำนวนเกมที่แนะนำ:")}</strong>{" "}
          {t("20+ เกมสำหรับดูภาพรวมเบื้องต้น · 40+ เกมสำหรับจัดลำดับแบน/หยิบและฟอร์มทีม · 100+ เกมสำหรับสถิติคอมโบ คู่เลน และสเกาต์คู่แข่ง")}
        </div>
      </div>
    </details>
  );
}

function SampleSizeNotice({ decided }: { decided: number }) {
  const { t } = useLanguage();
  const message =
    decided < 20
      ? t(
          "ข้อมูลที่มีผลแพ้-ชนะยังมี {0} เกม — ควรมีอย่างน้อย 40 เกมเพื่อให้สถิติทีมแม่นยำ และ 100+ เกมสำหรับคอมโบกับคู่เลน",
          decided,
        )
      : t(
          "ข้อมูลที่มีผลแพ้-ชนะมี {0} เกม — พอเห็นภาพรวมแล้ว ควรเก็บให้ครบ 40 เกมเพื่อให้สถิติทีมนิ่งขึ้น",
          decided,
        );
  return (
    <p
      role="status"
      className="flex items-start gap-2 border border-gold/35 bg-gold/10 px-3.5 py-2.5 text-xs text-ink/90"
    >
      <Info className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
      <span>{message}</span>
    </p>
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
          95% CI: [{lo.toFixed(1)}% – {hi.toFixed(1)}%]
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
}: {
  points: EwmaPoint[];
  currentPct: number | null;
  deltaPct: number | null;
}) {
  const { t } = useLanguage();
  if (points.length < 2 || currentPct === null) {
    return (
      <div className="flex h-28 items-center justify-center border border-dashed border-line bg-bg/60 text-xs text-dim">
        {t("ต้องมีเกมที่ลงผลชนะอย่างน้อย 2 เกมเพื่อสร้างกราฟแนวโน้มฟอร์ม")}
      </div>
    );
  }

  const recent10 = points.slice(-10);
  const recentWins = recent10.filter((p) => p.win).length;
  const recentWr = Math.round((recentWins / recent10.length) * 100);
  const trendLabel =
    deltaPct !== null && deltaPct >= 5
      ? "ฟอร์มกำลังขึ้น"
      : deltaPct !== null && deltaPct <= -5
        ? "ฟอร์มดรอปลง"
        : "ฟอร์มทรงตัว";
  const trendClass =
    deltaPct !== null && deltaPct >= 5
      ? "border-good/40 bg-good/15 text-good"
      : deltaPct !== null && deltaPct <= -5
        ? "border-red/40 bg-red/15 text-red"
        : "border-line-strong bg-panel text-muted";

  const w = 320;
  const h = 86;
  const padLeft = 8;
  const padRight = 32;
  const padY = 10;
  const toX = (i: number) => padLeft + (i / Math.max(1, points.length - 1)) * (w - padLeft - padRight);
  const toY = (pct: number) => h - padY - (Math.max(0, Math.min(100, pct)) / 100) * (h - padY * 2);
  const poly = points.map((p, i) => `${toX(i).toFixed(1)},${toY(p.ewmaPct).toFixed(1)}`).join(" ");
  const y50 = toY(50);
  const last = points[points.length - 1];

  return (
    <div className="space-y-2.5 border border-line bg-bg p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted">
          {t("ชนะ {0} จาก {1} เกมล่าสุด ({2}%)", recentWins, recent10.length, recentWr)}
        </span>
        <span
          title={t("ดัชนีความต่อเนื่องฟอร์มล่าสุด {0}% (ให้น้ำหนักแมตช์ใหม่มากสุด)", currentPct.toFixed(1))}
          className={`border px-2 py-0.5 font-display text-[11px] font-bold ${trendClass}`}
        >
          {t(trendLabel)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1" aria-label={t("ผล {0} เกมล่าสุด", recent10.length)}>
        {recent10.map((p) => (
          <span
            key={`wl-${p.idx}`}
            title={`${p.label} · ${p.win ? t("ชนะ") : t("แพ้")}`}
            className={`grid size-6 place-items-center border font-mono text-[11px] font-extrabold ${
              p.win
                ? "border-good/50 bg-good/20 text-good"
                : "border-red/50 bg-red/20 text-red"
            }`}
          >
            {p.win ? "W" : "L"}
          </span>
        ))}
      </div>

      <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full overflow-visible">
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
          stroke="var(--color-gold)"
          strokeWidth="2"
          points={poly}
        />
        {points.map((p, i) => (
          <circle
            key={p.idx}
            cx={toX(i)}
            cy={toY(p.ewmaPct)}
            r={i === points.length - 1 ? 3.5 : 2.2}
            fill={p.win ? "var(--color-good)" : "var(--color-red)"}
          >
            <title>{`${p.label} · ${p.win ? t("ชนะ") : t("แพ้")} (${p.ewmaPct.toFixed(1)}%)`}</title>
          </circle>
        ))}
        <text x={w - 2} y={y50 + 3} textAnchor="end" className="fill-dim font-mono text-[9px]">
          50%
        </text>
      </svg>

      <div className="flex flex-wrap items-center justify-between gap-x-2 font-mono text-[10px] text-dim">
        <span>{t("จุดเขียว = ชนะ · จุดแดง = แพ้")} ({points.length} {t("เกม")})</span>
        <span className={`min-w-0 break-words font-semibold ${last.win ? "text-good" : "text-red"}`}>
          {t("ล่าสุด:")} {last.label} ({last.win ? t("ชนะ") : t("แพ้")})
        </span>
      </div>
    </div>
  );
}

function ScrimTabBar({
  activeTab,
  onSelectTab,
}: {
  activeTab: ScrimDashboardTab;
  onSelectTab: (tab: ScrimDashboardTab) => void;
}) {
  const { t } = useLanguage();
  return (
    <div
      role="tablist"
      aria-label={t("หมวดวิเคราะห์สถิติ")}
      className="grid grid-cols-2 gap-1.5 border-b border-line pb-2 sm:flex sm:flex-wrap sm:justify-end"
    >
      {SCRIM_TABS.map(([tabKey, tabLabel]) => {
        const selected = activeTab === tabKey;
        return (
          <button
            key={tabKey}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelectTab(tabKey)}
            className={`min-h-10 min-w-0 border px-2.5 py-1.5 text-center font-display text-xs font-bold leading-tight tracking-wide transition-colors sm:shrink-0 sm:px-4 ${
              selected
                ? "border-gold/70 bg-gold/15 text-gold"
                : "border-line bg-panel text-muted hover:border-line-strong hover:text-ink"
            }`}
          >
            {t(tabLabel)}
          </button>
        );
      })}
    </div>
  );
}

export function ScrimDashboardView({
  personalGames,
  heroMap,
  isPaid,
  isAuthenticated = true,
  teamHistoryEnabled,
  freePromoUntil,
  onOpenAuthModal,
  onBack,
}: ScrimDashboardViewProps) {
  const { language, t } = useLanguage();
  const [nowMs] = useState(Date.now);
  const demoPromoActive = Boolean(!isPaid && freePromoUntil && freePromoUntil * 1000 > nowMs);
  const demoPromoShortDate =
    demoPromoActive && freePromoUntil
      ? new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
          day: "numeric",
          month: "short",
          timeZone: "Asia/Bangkok",
        }).format(freePromoUntil * 1000)
      : "";
  const [initialFilters] = useState(() => readSavedFilters(isPaid));
  const [source, setSource] = useState<"personal" | "team" | "sample">(initialFilters.source);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [enemyTab, setEnemyTab] = useState<"tough" | "favorable">("tough");
  const [activeTab, setActiveTab] = useState<ScrimDashboardTab>("overview");
  const [reportOpen, setReportOpen] = useState(false);
  const isCardExpanded = (key: string) => Boolean(expandedCards[key]);
  const toggleCard = (key: string) => setExpandedCards((prev) => ({ ...prev, [key]: !prev[key] }));
  const [{ team, games: teamGames, status: teamStatus }, setTeamHistory] = useState<TeamHistory>({
    team: null,
    games: [],
    status: "loading",
  });
  const [teamReload, setTeamReload] = useState(0);
  const [selectedTeam, setSelectedTeam] = useState(initialFilters.selectedTeam);
  const [allTeamsSelected, setAllTeamsSelected] = useState(initialFilters.allTeamsSelected);
  const [opponentFilter, setOpponentFilter] = useState(initialFilters.opponentFilter);
  const [tournamentFilter, setTournamentFilter] = useState(initialFilters.tournamentFilter);
  const [seriesFilter, setSeriesFilter] = useState<string[]>(initialFilters.seriesFilter);
  const [datePreset, setDatePreset] = useState<DatePreset>(initialFilters.datePreset);
  const [dateFrom, setDateFrom] = useState(initialFilters.dateFrom);
  const [dateTo, setDateTo] = useState(initialFilters.dateTo);
  const [today, setToday] = useState(() => localCalendarDate(new Date()));
  const [laneFilter, setLaneFilter] = useState<LaneFilterKey>(initialFilters.laneFilter);
  const [heroSearch, setHeroSearch] = useState("");
  const [sortBy, setSortBy] = useState<HeroSortKey>(initialFilters.sortBy);
  const [samplePeriodMode, setSamplePeriodMode] = useState<"split_half" | "last7_vs_prev">("split_half");
  const [sampleReload, setSampleReload] = useState(0);
  const [sampleState, setSampleState] = useState<{
    key: string;
    data: SampleAnalyticsResponse | null;
    error: boolean;
  }>({ key: "", data: null, error: false });

  const demoMode = !isPaid;
  const showSampleData = demoMode || source === "sample";
  const canLoadTeamHistory = isPaid && teamHistoryEnabled;
  const showTeamHistory = canLoadTeamHistory && source === "team";

  const activeSampleDataset: SampleDatasetId = resolveSampleDatasetId(tournamentFilter);
  const sampleData = showSampleData ? sampleState.data : null;
  const sampleTournamentOptions = sampleData?.availableTournaments ?? SAMPLE_TOURNAMENT_DEFAULTS;
  const sampleEffectiveDatePreset = datePreset === "custom" ? "all" : datePreset;
  const knownSampleTeams = sampleState.data?.teamNames;
  const trimmedSelectedTeam = selectedTeam.trim();
  const sampleQueryTeam = allTeamsSelected
    ? ""
    : trimmedSelectedTeam &&
        (!knownSampleTeams || knownSampleTeams.some((n) => n.toLowerCase() === trimmedSelectedTeam.toLowerCase()))
      ? trimmedSelectedTeam
      : showSampleData
        ? DEFAULT_SAMPLE_TEAM
        : "";
  const knownSampleOpps = sampleState.data?.opponents;
  const sampleQueryOpp =
    allTeamsSelected || opponentFilter === "ALL" || (knownSampleOpps && knownSampleOpps.some((o) => o.toLowerCase() === opponentFilter.toLowerCase()))
      ? allTeamsSelected
        ? "ALL"
        : opponentFilter
      : "ALL";
  const sampleRequestKey = showSampleData
    ? `${activeSampleDataset}|${sampleQueryTeam}|${sampleQueryOpp}|${sampleEffectiveDatePreset}|${samplePeriodMode}|${sampleReload}`
    : "";
  const sampleLoading = Boolean(sampleRequestKey) && sampleState.key !== sampleRequestKey;
  const sampleError = Boolean(sampleRequestKey) && sampleState.key === sampleRequestKey && sampleState.error;

  useEffect(() => {
    if (!sampleRequestKey) return;
    let cancelled = false;
    const ctrl = new AbortController();
    void fetchSampleAnalytics({
      team: sampleQueryTeam,
      opponent: sampleQueryOpp,
      datePreset: sampleEffectiveDatePreset,
      periodMode: samplePeriodMode,
      dataset: activeSampleDataset,
      signal: ctrl.signal,
    })
      .then((data) => {
        if (!cancelled) setSampleState({ key: sampleRequestKey, data, error: false });
      })
      .catch((err) => {
        if (!cancelled && !isAbortError(err)) {
          if (err instanceof ApiError && err.status === 422 && (sampleQueryTeam || sampleQueryOpp !== "ALL")) {
            setSelectedTeam(DEFAULT_SAMPLE_TEAM);
            setAllTeamsSelected(false);
            setOpponentFilter("ALL");
            return;
          }
          setSampleState((prev) => ({ key: sampleRequestKey, data: prev.data, error: true }));
        }
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [sampleRequestKey, activeSampleDataset, sampleQueryTeam, sampleQueryOpp, sampleEffectiveDatePreset, samplePeriodMode]);

  useEffect(() => {
    try {
      const payload: SavedScrimFilters = {
        source,
        tournamentFilter,
        allTeamsSelected,
        selectedTeam,
        opponentFilter,
        seriesFilter,
        datePreset,
        dateFrom,
        dateTo,
        laneFilter,
        sortBy,
      };
      localStorage.setItem(`${SAVED_FILTERS_KEY_PREFIX}${isPaid ? "paid" : "demo"}`, JSON.stringify(payload));
    } catch {
      // The controls remain available if browser storage is blocked.
    }
  }, [
    isPaid,
    source,
    tournamentFilter,
    allTeamsSelected,
    selectedTeam,
    opponentFilter,
    seriesFilter,
    datePreset,
    dateFrom,
    dateTo,
    laneFilter,
    sortBy,
  ]);

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
        const fetchedTeam = (await getTeam(ctrl.signal)).team;
        activeTeam = fetchedTeam?.tier === "team_pro" ? fetchedTeam : null;
        if (ctrl.signal.aborted) return;
        if (!activeTeam) {
          setTeamHistory({ team: null, games: [], status: "ready" });
          setSource((prev) => (prev === "team" ? "personal" : prev));
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

  const activeGames = showSampleData ? EMPTY_GAMES : showTeamHistory ? teamGames : personalGames;
  const personalTournaments = useMemo(() => listTournaments(personalGames), [personalGames]);
  const teamTournaments = useMemo(() => listTournaments(teamGames), [teamGames]);
  const personalHasUnassigned = useMemo(() => personalGames.some((g) => !g.tournament?.id), [personalGames]);
  const teamHasUnassigned = useMemo(() => teamGames.some((g) => !g.tournament?.id), [teamGames]);
  const tournaments = useMemo(
    () =>
      showSampleData
        ? sampleTournamentOptions.map(({ id, name }) => ({ id, name }))
        : showTeamHistory
          ? teamTournaments
          : personalTournaments,
    [showSampleData, sampleTournamentOptions, showTeamHistory, teamTournaments, personalTournaments],
  );
  const activeTournament = showSampleData
    ? activeSampleDataset
    : tournamentFilter === "" || tournaments.some(({ id }) => id === tournamentFilter)
      ? tournamentFilter
      : ALL_TOURNAMENTS;
  const tournamentGames = useMemo(() => activeTournament === ALL_TOURNAMENTS
    ? activeGames
    : activeGames.filter((game) => (game.tournament?.id ?? "") === activeTournament),
  [activeGames, activeTournament]);

  const teamNames = useMemo(() => {
    if (showSampleData) return sampleData?.teamNames ?? [];
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
  }, [showSampleData, sampleData, tournamentGames]);

  const focusTeam = useMemo(() => {
    if (allTeamsSelected) return "";
    const target = selectedTeam.trim().toLowerCase();
    if (target) {
      const exact = teamNames.find((n) => n.toLowerCase() === target);
      if (exact) return exact;
      if (showSampleData && target === DEFAULT_SAMPLE_TEAM.toLowerCase()) return DEFAULT_SAMPLE_TEAM;
    }
    return "";
  }, [allTeamsSelected, selectedTeam, teamNames, showSampleData]);
  const allTeamsMode = focusTeam === "";

  const opponents = useMemo(() => {
    if (showSampleData) return sampleData?.opponents ?? [];
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
  }, [showSampleData, sampleData, tournamentGames, focusTeam]);

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

  const localStats = useMemo(
    () => (showSampleData ? computeScrimAnalytics(EMPTY_GAMES, "", "ALL") : computeScrimAnalytics(scopedGames, focusTeam, opponentFilter)),
    [showSampleData, scopedGames, focusTeam, opponentFilter],
  );
  const stats = showSampleData ? (sampleData?.stats ?? localStats) : localStats;
  const allStats = useMemo(
    () =>
      showSampleData
        ? (allTeamsMode ? sampleData?.allStats ?? null : null)
        : (allTeamsMode ? computeAllTeamsAnalytics(scopedGames) : null),
    [showSampleData, sampleData, allTeamsMode, scopedGames],
  );
  const localAdvancedStats = useMemo(
    () =>
      showSampleData
        ? computeScrimAdvancedStats(EMPTY_GAMES, heroMap, "", "ALL")
        : computeScrimAdvancedStats(scopedGames, heroMap, focusTeam, opponentFilter),
    [showSampleData, scopedGames, heroMap, focusTeam, opponentFilter],
  );
  const advancedStats = showSampleData ? (sampleData?.advanced ?? localAdvancedStats) : localAdvancedStats;
  const displayScopedCount = showSampleData ? (sampleData?.scopedGameCount ?? 0) : scopedGames.length;
  const sampleTotalCount =
    sampleData?.totalGames ??
    sampleTournamentOptions.find((item) => item.id === activeSampleDataset)?.totalGames ??
    307;

  const localPeriodDiff = useMemo(() => {
    if (showSampleData || scopedGames.length === 0) return null;
    const split = splitGamesForPeriodDiff(scopedGames, activeGames, "split_half", "", "", tournaments);
    return computePeriodDiff(split.periodAGames, split.periodBGames, focusTeam, opponentFilter, split.labelA, split.labelB);
  }, [showSampleData, scopedGames, activeGames, tournaments, focusTeam, opponentFilter]);
  const modalPeriodDiff = showSampleData ? (sampleData?.periodDiff ?? null) : localPeriodDiff;

  const filteredHeroRows = useMemo(
    () => filterAndSortHeroes(stats.allyList, laneFilter, heroSearch, sortBy),
    [stats.allyList, laneFilter, heroSearch, sortBy],
  );
  const filteredAllHeroRows = useMemo(
    () => (allStats ? filterAndSortHeroes(allStats.heroList, laneFilter, heroSearch, sortBy) : []),
    [allStats, laneFilter, heroSearch, sortBy],
  );

  const hasActiveFilters =
    (!showSampleData && (activeTournament !== ALL_TOURNAMENTS || activeSeries.size > 0)) ||
    (showSampleData ? sampleEffectiveDatePreset !== "all" : datePreset !== "all") ||
    (!allTeamsMode && opponentFilter !== "ALL");

  function resetFilters() {
    setTournamentFilter(showSampleData ? activeSampleDataset : ALL_TOURNAMENTS);
    setAllTeamsSelected(true);
    setSelectedTeam("");
    setOpponentFilter("ALL");
    setSeriesFilter([]);
    setDatePreset("all");
    setDateFrom("");
    setDateTo("");
  }

  function enterSampleSource(datasetId: SampleDatasetId = DEFAULT_SAMPLE_TOURNAMENT_ID) {
    setSource("sample");
    setTournamentFilter(datasetId);
    setAllTeamsSelected(false);
    setSelectedTeam((prev) => (prev.trim() && prev.trim().toLowerCase() !== "vgd" ? prev : DEFAULT_SAMPLE_TEAM));
    setOpponentFilter("ALL");
    setSeriesFilter([]);
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
              <div className="flex flex-wrap items-center gap-2">
                <BarChart3 className="size-5 shrink-0 text-gold" />
                <h1 className="font-display text-base font-extrabold tracking-wider text-ink sm:text-xl">
                  {t("สถิติซ้อมทีม")}
                </h1>
                <span className="border border-gold/45 bg-gold/10 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-gold uppercase">
                  Beta
                </span>
              </div>
              <p className="text-xs text-muted">
                {t("สรุป Win Rate ตามฝั่ง, ฟอร์มรายเกม, คอมโบ และคู่แข่ง")}
              </p>
            </div>
          </div>

          {displayScopedCount > 0 && (
            <button
              type="button"
              onClick={() => {
                trackTelemetryEvent("feat_scouting_pdf");
                setReportOpen(true);
              }}
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 border border-gold/50 bg-gold/10 px-3 font-display text-xs font-bold text-gold hover:bg-gold hover:text-bg"
            >
              <FileText className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{t("Scouting Report")}</span>
            </button>
          )}
        </header>

        {demoMode ? (
          <section
            aria-label={t("โหมดตัวอย่าง (Read-only · {0} เกม)", sampleTotalCount)}
            className="flex flex-wrap items-center justify-between gap-3 border border-gold/45 bg-gold/10 px-4 py-3"
          >
            <div className="min-w-0 space-y-0.5">
              <p className="flex items-center gap-1.5 font-display text-xs font-bold tracking-wide text-gold sm:text-sm">
                <Trophy className="size-4 shrink-0" aria-hidden="true" />
                <span>{t("โหมดตัวอย่าง (Read-only · {0} เกม)", sampleTotalCount)}</span>
              </p>
              <p className="text-xs text-ink/90">
                {personalGames.length > 0
                  ? t("คุณมีประวัติบันทึกไว้แล้ว {0} เกม — อัปเกรดเป็น Pro, Duo หรือ Business เพื่อวิเคราะห์ข้อมูลจริงของคุณทันที", personalGames.length)
                  : t("ลองกดกรองทีม คู่แข่ง เลน และช่วงวันที่ได้เต็มที่ · อัปเกรดเพื่อวิเคราะห์ข้อมูลดราฟต์ของคุณเองสูงสุด 500 เกม")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              {demoPromoActive &&
                (!isAuthenticated && onOpenAuthModal ? (
                  <button
                    type="button"
                    onClick={onOpenAuthModal}
                    className="inline-flex min-h-9 w-full shrink-0 items-center justify-center gap-1.5 border border-gold bg-gold px-4 text-center font-display text-xs font-bold text-bg hover:bg-gold/90 sm:w-auto"
                  >
                    <Gift className="size-3.5 shrink-0" aria-hidden="true" />
                    <span>{t("รับ Pro ฟรีถึง {0}", demoPromoShortDate)}</span>
                  </button>
                ) : (
                  <a
                    href="#plans"
                    className="inline-flex min-h-9 w-full shrink-0 items-center justify-center gap-1.5 border border-gold bg-gold px-4 text-center font-display text-xs font-bold text-bg hover:bg-gold/90 sm:w-auto"
                  >
                    <Gift className="size-3.5 shrink-0" aria-hidden="true" />
                    <span>{t("รับ Pro ฟรีถึง {0}", demoPromoShortDate)}</span>
                  </a>
                ))}
              {!isAuthenticated && onOpenAuthModal ? (
                <button
                  type="button"
                  onClick={onOpenAuthModal}
                  className={`inline-flex min-h-9 w-full shrink-0 items-center justify-center border px-4 text-center font-display text-xs font-bold sm:w-auto ${
                    demoPromoActive
                      ? "border-gold/60 bg-panel text-gold hover:bg-gold/10"
                      : "border-gold bg-gold text-bg hover:bg-gold/90"
                  }`}
                >
                  <StableButtonLabel message="เข้าสู่ระบบ" className="inline-grid text-center" />
                </button>
              ) : (
                <a
                  href="#plans"
                  className={`inline-flex min-h-9 w-full shrink-0 items-center justify-center border px-4 text-center font-display text-xs font-bold sm:w-auto ${
                    demoPromoActive
                      ? "border-gold/60 bg-panel text-gold hover:bg-gold/10"
                      : "border-gold bg-gold text-bg hover:bg-gold/90"
                  }`}
                >
                  <StableButtonLabel message="ดูแพ็ก" className="inline-grid text-center" />
                </a>
              )}
            </div>
          </section>
        ) : source === "sample" && (
          <section
            aria-label={t("ข้อมูลตัวอย่าง")}
            className="flex flex-wrap items-center gap-2 border border-line-strong bg-panel/80 px-4 py-2.5 text-xs text-muted"
          >
            <Trophy className="size-4 shrink-0 text-gold" aria-hidden="true" />
            <span>
              {t("กำลังดูข้อมูลตัวอย่าง (Read-only · {0} เกม) — เลือกทัวร์นาเมนต์อื่นเพื่อดูข้อมูลจริงของคุณ", sampleTotalCount)}
            </span>
          </section>
        )}

        {(isPaid || demoMode) && (
          <div className="space-y-2.5 border border-line bg-panel/60 p-3">
            <div
              role="group"
              aria-label={t("กรองเกม")}
              className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-end"
            >
              {(tournaments.length > 0 || !demoMode) && (
                <label className="grid min-w-0 gap-1 text-xs text-muted lg:min-w-[180px] lg:flex-1">
                  <span className="truncate font-mono text-[11px]">{t("ทัวร์นาเมนต์")}</span>
                  <select
                    className={FILTER_CONTROL_CLASS}
                    value={showSampleData ? activeSampleDataset : `${showTeamHistory ? "team" : "personal"}:${activeTournament}`}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (!demoMode) {
                        if (isSampleTournamentId(value)) {
                          const nextDataset = resolveSampleDatasetId(value);
                          if (source !== "sample") enterSampleSource(nextDataset);
                          else setTournamentFilter(nextDataset);
                          return;
                        }
                        const nextSource: "personal" | "team" = value.startsWith("team:") ? "team" : "personal";
                        const nextTour = value.slice(nextSource.length + 1);
                        const nextSourceGames = nextSource === "team" ? teamGames : personalGames;
                        const nextGames =
                          nextTour === ALL_TOURNAMENTS
                            ? nextSourceGames
                            : nextSourceGames.filter((game) => (game.tournament?.id ?? "") === nextTour);
                        setSource(nextSource);
                        setTournamentFilter(nextTour);
                        const currentLower = focusTeam.trim().toLowerCase();
                        const hasCurrentTeam =
                          Boolean(currentLower) &&
                          nextGames.some(
                            (g) =>
                              g.blueTeamName?.trim().toLowerCase() === currentLower ||
                              g.redTeamName?.trim().toLowerCase() === currentLower,
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
                        return;
                      }
                      setTournamentFilter(resolveSampleDatasetId(value));
                    }}
                  >
                    {!demoMode ? (
                      <>
                        <optgroup label={t("ประวัติส่วนตัว ({0})", personalGames.length)}>
                          <option value={`personal:${ALL_TOURNAMENTS}`}>{t("ทุกทัวร์นาเมนต์ (ส่วนตัว)")}</option>
                          {(personalHasUnassigned || (!showTeamHistory && !showSampleData && activeTournament === "")) && (
                            <option value="personal:">{t("ไม่สังกัดทัวร์นาเมนต์")}</option>
                          )}
                          {personalTournaments.map(({ id, name }) => (
                            <option key={`personal:${id}`} value={`personal:${id}`}>
                              {name}
                            </option>
                          ))}
                        </optgroup>
                        {canLoadTeamHistory && team && (
                          <optgroup label={t("ประวัติทีม · {0} ({1})", team.owner_username, teamGames.length)}>
                            <option value={`team:${ALL_TOURNAMENTS}`}>{t("ทุกทัวร์นาเมนต์ (ทีม)")}</option>
                            {(teamHasUnassigned || (showTeamHistory && activeTournament === "")) && (
                              <option value="team:">{t("ไม่สังกัดทัวร์นาเมนต์ (ทีม)")}</option>
                            )}
                            {teamTournaments.map(({ id, name }) => (
                              <option key={`team:${id}`} value={`team:${id}`}>
                                {t("{0} (ทีม)", name)}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label={t("ข้อมูลตัวอย่าง")}>
                          {sampleTournamentOptions.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({item.totalGames})
                            </option>
                          ))}
                        </optgroup>
                      </>
                    ) : (
                      sampleTournamentOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.totalGames})
                        </option>
                      ))
                    )}
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
              {!showSampleData && (
                <div className="min-w-0 lg:min-w-[175px] lg:flex-1">
                  <SeriesPicker options={seriesOptions} selected={activeSeries} onChange={setSeriesFilter} />
                </div>
              )}
              <label className="grid min-w-0 gap-1 text-xs text-muted lg:min-w-[145px] lg:flex-1">
                <span className="truncate font-mono text-[11px]">{t("วันที่บันทึก")}</span>
                <select
                  className={FILTER_CONTROL_CLASS}
                  value={showSampleData && datePreset === "custom" ? "all" : datePreset}
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
                  {!showSampleData && <option value="custom">{t("กำหนดวันที่เอง")}</option>}
                </select>
              </label>
            </div>

            {!showSampleData && datePreset === "custom" && (
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
                        ? t("กำลังแสดงภาพรวมทุกทีม ({0} เกม)", displayScopedCount)
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

        {canLoadTeamHistory && teamStatus === "error" && (showTeamHistory || (source === "personal" && !team)) && (
          <Alert className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("โหลดประวัติทีมไม่สำเร็จ")}</span>
            <button type="button" onClick={reloadTeamHistory} className="min-h-8 border border-current px-2.5 font-semibold">
              <StableButtonLabel message="ลองใหม่" />
            </button>
          </Alert>
        )}

        {showSampleData && sampleError ? (
          <Alert className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("โหลดข้อมูลตัวอย่างไม่สำเร็จ")}</span>
            <button type="button" onClick={() => setSampleReload((c) => c + 1)} className="min-h-8 border border-current px-2.5 font-semibold">
              <StableButtonLabel message="ลองใหม่" />
            </button>
          </Alert>
        ) : showSampleData && (sampleLoading || !sampleData) ? (
          <section role="status" className="border border-dashed border-line bg-panel/40 p-8 text-center text-sm text-muted">
            {t("กำลังโหลดข้อมูลตัวอย่าง…")}
          </section>
        ) : !demoMode && showTeamHistory && teamStatus !== "ready" ? (
          teamStatus === "loading" && (
            <section role="status" className="border border-dashed border-line bg-panel/40 p-8 text-center text-sm text-muted">
              {t("กำลังโหลดประวัติทีม")}
            </section>
          )
        ) : !showSampleData && invalidDateRange ? (
          <Alert>{t("วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น")}</Alert>
        ) : (allTeamsMode ? displayScopedCount : stats.total) === 0 ? (
          <section className="space-y-3 border border-dashed border-line bg-panel/40 p-10 text-center text-sm text-muted">
            <p>
              {showTeamHistory && team && teamGames.length === 0
                ? t("ยังไม่มีเกมในประวัติทีม {0} — เปิด 'ประวัติเกม' บนกระดานดราฟต์เพื่อบันทึกหรือแชร์เกมเข้าทีม", team.owner_username)
                : !showSampleData && activeGames.length === 0
                  ? t("ยังไม่มีเกมที่บันทึกในประวัติสำหรับแสดงสถิติ")
                  : t("ไม่พบเกมตามตัวกรอง")}
            </p>
            {showTeamHistory && team && teamGames.length === 0 ? (
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <a
                  href="#"
                  className="inline-flex min-h-9 items-center border border-gold bg-gold px-4 font-display text-xs font-bold text-bg hover:bg-gold/90"
                >
                  {t("ไปกระดานดราฟต์")}
                </a>
                {team.is_owner && team.members.length === 1 && (
                  <a
                    href="#profile"
                    className="inline-flex min-h-9 items-center border border-blue/50 bg-blue/10 px-4 font-display text-xs font-bold text-blue hover:bg-blue/20"
                  >
                    {t("ชวนเพื่อนเข้าทีม")}
                  </a>
                )}
              </div>
            ) : (
              !showSampleData && activeGames.length === 0 && (
                <p className="text-xs text-dim">
                  {t("แนะนำบันทึกอย่างน้อย 40 เกมที่มีผลแพ้-ชนะ เพื่อให้สถิติทีมและเมต้าวิเคราะห์ได้แม่นยำ")}
                </p>
              )
            )}
            {(showSampleData || activeGames.length > 0) && hasActiveFilters && (
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
        ) : (
          <>
            {!showSampleData && (allTeamsMode && allStats ? allStats.decided : stats.decided) < 40 && (
              <SampleSizeNotice decided={allTeamsMode && allStats ? allStats.decided : stats.decided} />
            )}
            {allTeamsMode && allStats ? (
          <>
            {/* All Teams Executive KPIs */}
            <section id="scrim-overview" aria-label={t("ภาพรวมทัวร์นาเมนต์")} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="border border-line bg-panel p-4 clip-chamfer-sm">
                <p className="font-mono text-xs text-muted">{t("จำนวนเกมทั้งหมด")}</p>
                <p className="mt-1 font-mono text-2xl font-extrabold tabular-nums text-ink">
                  {allStats.total} <span className="text-sm font-normal text-dim">({allStats.seriesCount} {t("ซีรีส์")})</span>
                </p>
                <p className="mt-1.5 font-mono text-xs tabular-nums text-muted">
                  {t("ลงผลแล้ว {0}/{1} เกม", allStats.decided, allStats.total)} ·{" "}
                  <strong className="text-gold">{allStats.teamRows.length}</strong> {t("ทีม")}
                </p>
              </div>

              <div className="border border-line bg-panel p-4 clip-chamfer-sm">
                <p className="font-mono text-xs text-muted">{t("อัตราชนะแยกฝั่ง")}</p>
                <div className="mt-2 flex items-baseline justify-between gap-3">
                  <div>
                    <span className="font-mono text-xs font-bold text-blue">BLUE </span>
                    <span className="font-mono text-lg font-extrabold tabular-nums text-ink">
                      {wrPct(allStats.blueWins, allStats.decided)}
                    </span>
                    <p
                      className="font-mono text-[11px] tabular-nums text-dim"
                      title={allStats.blueCi ? `Wilson 95% CI: [${allStats.blueCi[0].toFixed(0)}–${allStats.blueCi[1].toFixed(0)}%]` : undefined}
                    >
                      {allStats.blueWins}/{allStats.decided}
                      {allStats.blueCi ? ` · ${allStats.blueCi[0].toFixed(0)}–${allStats.blueCi[1].toFixed(0)}%` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-xs font-bold text-red">RED </span>
                    <span className="font-mono text-lg font-extrabold tabular-nums text-ink">
                      {wrPct(allStats.redWins, allStats.decided)}
                    </span>
                    <p
                      className="font-mono text-[11px] tabular-nums text-dim"
                      title={allStats.redCi ? `Wilson 95% CI: [${allStats.redCi[0].toFixed(0)}–${allStats.redCi[1].toFixed(0)}%]` : undefined}
                    >
                      {allStats.redWins}/{allStats.decided}
                      {allStats.redCi ? ` · ${allStats.redCi[0].toFixed(0)}–${allStats.redCi[1].toFixed(0)}%` : ""}
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

              <div className="border border-line bg-panel p-4 clip-chamfer-sm">
                <p className="font-mono text-xs text-muted">{t("คลังฮีโร่ที่ใช้")}</p>
                <p className="mt-1 font-mono text-2xl font-extrabold tabular-nums text-ink">
                  {allStats.uniqueHeroCount} <span className="text-sm font-normal text-dim">{t("ตัวที่ใช้จริง")}</span>
                </p>
                <p
                  className="mt-1 font-mono text-xs tabular-nums text-gold"
                  title="Effective Hero Pool (inverse Simpson / perplexity)"
                >
                  {t("ตัวหลัก:")} <strong>{allStats.effectiveHeroPool.toFixed(1)}</strong> {t("ตัว")}
                  <span className="text-dim"> · {t("กระจายใช้งาน")} {allStats.poolEvennessPct.toFixed(0)}%</span>
                </p>
              </div>

              <div className="border border-gold/30 bg-panel p-4 clip-chamfer-sm">
                <p className="font-mono text-xs text-muted">{t("ทีมผลงานเด่นสุด")}</p>
                {(() => {
                  const topTeam = allStats.teamRows.find((r) => r.decided >= 2) ?? allStats.teamRows[0];
                  if (!topTeam) return <p className="mt-2 font-mono text-sm text-dim">—</p>;
                  return (
                    <>
                      <div className="mt-1 flex items-baseline justify-between gap-2">
                        <span className="truncate font-display text-xl font-extrabold text-gold">{topTeam.team}</span>
                        <span className="font-mono text-lg font-extrabold tabular-nums text-good">{wrPct(topTeam.wins, topTeam.decided)}</span>
                      </div>
                      <p className="mt-1 font-mono text-[11px] tabular-nums text-muted">
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

            {/* 4-Tab Bar */}
            <ScrimTabBar activeTab={activeTab} onSelectTab={setActiveTab} />

            {activeTab === "overview" && (
              <div className="space-y-4">
                <section id="scrim-form" className="grid gap-4 lg:grid-cols-12">
                  <div className="min-w-0 border border-line bg-panel p-4 lg:col-span-7">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Layers className="size-4 text-gold" />
                        <h2 className="font-display text-sm font-bold tracking-wider text-ink">
                          {t("สัดส่วนชนะ Blue vs Red แยกตามเกม (G1–G7)")}
                        </h2>
                      </div>
                      <span className="font-mono text-[11px] text-dim">Blue % / Red %</span>
                    </div>
                    <div className="flex snap-x gap-1.5 overflow-x-auto pb-1 lg:grid lg:grid-cols-7 lg:overflow-visible lg:pb-0">
                      {[1, 2, 3, 4, 5, 6, 7].map((gNum) => {
                        const row = allStats.byGameNum.get(gNum);
                        const hasData = Boolean(row && row.decided > 0);
                        const bluePct = row && row.decided > 0 ? (row.blueWins / row.decided) * 100 : 50;
                        return (
                          <div key={gNum} className="flex min-w-[82px] shrink-0 snap-start flex-col justify-between border border-line bg-bg p-2 lg:min-w-0">
                            <div className="flex items-center justify-between font-mono text-[11px] tabular-nums">
                              <span className="font-bold text-gold">G{gNum}{gNum === 7 ? " Ult" : ""}</span>
                              <span className="text-dim">{row?.total ?? 0}g</span>
                            </div>
                            <div className="my-2 flex h-20 items-end justify-center bg-panel-2/40 px-1 py-1.5">
                              {hasData ? (
                                <div className="flex h-full w-6 flex-col overflow-hidden rounded-t-[1px]">
                                  <div className="bg-red/75" style={{ height: `${100 - bluePct}%` }} />
                                  <div className="bg-blue/85" style={{ height: `${bluePct}%` }} />
                                </div>
                              ) : (
                                <div className="h-[4%] w-6 bg-line" />
                              )}
                            </div>
                            <div className="flex flex-col items-center gap-0.5 font-mono text-[10px] tabular-nums">
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

                  <div className="border border-line bg-panel p-4 lg:col-span-5">
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
                              className="transition-colors hover:bg-panel-2/60"
                            >
                              <td className="px-2.5 py-1">
                                <button
                                  type="button"
                                  onClick={() => selectSpecificTeam(row.team)}
                                  className="inline-flex min-h-7 w-full items-center gap-1 text-left font-display font-bold text-ink hover:text-gold"
                                >
                                  <span className="truncate">{row.team}</span>
                                  <span className="font-mono text-[10px] font-normal text-dim">({row.seriesCount}s)</span>
                                  <ChevronRight className="ml-auto size-3.5 shrink-0 text-dim" aria-hidden="true" />
                                </button>
                              </td>
                              <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-muted">{row.games}</td>
                              <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-muted">{row.wins}-{row.losses}</td>
                              <td className={`px-2.5 py-1.5 text-right font-mono font-bold tabular-nums ${row.decided === 0 ? "text-dim" : row.wins / row.decided >= 0.5 ? "text-good" : "text-red"}`}>
                                {wrPct(row.wins, row.decided)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>

                <PositionalPoolCard advanced={advancedStats} heroMap={heroMap} />
                <CompArchetypeCard advanced={advancedStats} heroMap={heroMap} />
              </div>
            )}

            {activeTab === "draft" && (
              <div className="space-y-4">
                <section id="scrim-draft" className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
                  <PhasePickCard phase1Top={allStats.phase1Top} phase2Top={allStats.phase2Top} heroMap={heroMap} previewLimit={6} />

                  <div className="space-y-3 border border-line bg-panel p-4">
                    <div className="flex items-center gap-2">
                      <ShieldBan className="size-4 text-red" />
                      <h2 className="font-display text-sm font-bold tracking-wider text-ink">
                        {t("ฮีโร่ที่ถูกแบนบ่อย & Contest Rate")}
                      </h2>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="mb-2 font-mono text-[11px] font-bold text-red">{t("ฮีโร่ที่ถูกแบนบ่อย")}</p>
                        <ul className={isCardExpanded("allBans") ? "max-h-80 space-y-1.5 overflow-y-auto pr-1" : "space-y-1.5"}>
                          {(isCardExpanded("allBans") ? allStats.topBans : allStats.topBans.slice(0, 6)).map((b) => (
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
                        <ul className={isCardExpanded("allBans") ? "max-h-80 space-y-1.5 overflow-y-auto pr-1" : "space-y-1.5"}>
                          {(isCardExpanded("allBans") ? allStats.topContested : allStats.topContested.slice(0, 6)).map((h) => (
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
                    <ExpandScrollButton
                      expanded={isCardExpanded("allBans")}
                      totalCount={Math.max(allStats.topBans.length, allStats.topContested.length)}
                      previewLimit={6}
                      onToggle={() => toggleCard("allBans")}
                    />
                  </div>
                </section>

                <section className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
                  <BlindCounterSlotCard advanced={advancedStats} heroMap={heroMap} />
                  <FlexEffectivenessCard advanced={advancedStats} heroMap={heroMap} />
                </section>
              </div>
            )}

            {activeTab === "heroes" && (
              <div className="space-y-4">
                <section id="scrim-heroes" className="border border-line bg-panel p-4">
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
                  <div className="max-h-[32rem] overflow-auto border border-line">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="sticky top-0 bg-panel-2 font-mono text-[11px] text-muted">
                        <tr>
                          <th className="whitespace-nowrap px-3 py-2">{t("ฮีโร่")}</th>
                          <th className="whitespace-nowrap px-3 py-2">{t(laneFilter === "ALL" ? "เลนหลัก" : "เลน")}</th>
                          <th className="whitespace-nowrap px-3 py-2 text-right">{t("Pick")}</th>
                          <th className="whitespace-nowrap px-3 py-2 text-right">{t("Ban")}</th>
                          <th className="whitespace-nowrap px-3 py-2 text-right">Contest%</th>
                          <th className="whitespace-nowrap px-3 py-2 text-right">W - L</th>
                          <th className="whitespace-nowrap px-3 py-2">{t("Win Rate")}</th>
                          <th className="whitespace-nowrap px-3 py-2 text-right">{t("WR ปรับฐาน")}</th>
                          <th className="whitespace-nowrap px-3 py-2 text-right">{t("หยิบ P1")}</th>
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

                <PeriodDiffCard
                  scopedGames={scopedGames}
                  activeGames={activeGames}
                  tournaments={tournaments}
                  focusTeam={focusTeam}
                  opponentFilter={opponentFilter}
                  heroMap={heroMap}
                  precomputedDiff={showSampleData ? (sampleData?.periodDiff ?? null) : undefined}
                  controlledMode={showSampleData ? samplePeriodMode : undefined}
                  onControlledModeChange={showSampleData ? setSamplePeriodMode : undefined}
                />
              </div>
            )}

            {activeTab === "matchups" && (
              <div className="space-y-4">
                <section id="scrim-matchups" className="grid items-start gap-4 lg:grid-cols-2">
                  <DuosCard duos={allStats.topDuos} heroMap={heroMap} />

                  <div className="border border-line bg-panel p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Swords className="size-4 text-gold" />
                        <h2 className="font-display text-sm font-bold tracking-wider text-ink">
                          {t("สถิติชนเลนตรง (ตัวต่อตัว)")}
                        </h2>
                        {allStats.laneStrengths.length > 8 && (
                          <span className="font-mono text-[11px] text-dim">({allStats.laneStrengths.length})</span>
                        )}
                      </div>
                      <span className="font-mono text-[10px] text-dim">{t("ความได้เปรียบเลน")}</span>
                    </div>
                    {allStats.laneStrengths.length === 0 ? (
                      <p className="text-xs text-dim">
                        {t("ยังไม่มีข้อมูลการชนเลนตรง (ต้องลงตำแหน่งเลนของฮีโร่อย่างน้อย 2 เกมต่อคู่)")}
                      </p>
                    ) : (
                      <>
                        <ul className={isCardExpanded("allLane") ? "max-h-96 space-y-1.5 overflow-y-auto pr-1" : "space-y-1.5"}>
                          {(isCardExpanded("allLane") ? allStats.laneStrengths : allStats.laneStrengths.slice(0, 8)).map((m) => (
                            <li
                              key={`als-${m.lane}-${m.allyHero}-${m.enemyHero}`}
                              title={`${t("มั่นใจ")} ${m.probAdvantagePct.toFixed(0)}% · Z=${m.zScore.toFixed(2)} · Counter Lift ${fmtSignedPct(m.counterLiftPct)}`}
                              className="flex flex-wrap items-center justify-between gap-2 border border-line bg-bg px-2.5 py-1.5 text-xs"
                            >
                              <div className="flex min-w-0 items-center gap-1.5">
                                <span className="shrink-0 font-mono text-[10px] font-bold text-gold">
                                  {LANE_SHORT[m.lane]?.en ?? m.lane}
                                </span>
                                <div className="size-5 shrink-0 overflow-hidden border border-line">
                                  <HeroPortrait name={m.allyHero} hero={heroMap.get(m.allyHero)} />
                                </div>
                                <span className="truncate font-semibold text-good">{displayName(m.allyHero)}</span>
                                <span className="shrink-0 text-[10px] text-dim">{t("ชนะทาง")}</span>
                                <div className="size-5 shrink-0 overflow-hidden border border-line">
                                  <HeroPortrait name={m.enemyHero} hero={heroMap.get(m.enemyHero)} />
                                </div>
                                <span className="truncate font-semibold text-ink">{displayName(m.enemyHero)}</span>
                              </div>
                              <span className="shrink-0 font-mono tabular-nums">
                                <strong className="text-good">{wrPct(m.wins, m.decided)}</strong>{" "}
                                <span className="text-muted">({m.wins}W-{m.losses}L)</span>{" "}
                                <span className="text-[10px] text-dim">{fmtSignedPct(m.counterLiftPct)}</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                        <ExpandScrollButton
                          expanded={isCardExpanded("allLane")}
                          totalCount={allStats.laneStrengths.length}
                          previewLimit={8}
                          onToggle={() => toggleCard("allLane")}
                        />
                      </>
                    )}
                  </div>
                </section>

                <TrioSynergyCard advanced={advancedStats} heroMap={heroMap} />
              </div>
            )}

            <MethodsReferenceCard />
          </>
        ) : (
          <>
            {/* Team View Executive KPIs */}
            <section id="scrim-overview" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="border border-line bg-panel p-4 clip-chamfer-sm">
                <p className="font-mono text-xs text-muted">{t("จำนวนเกมทั้งหมด")}</p>
                <p className="mt-1 font-mono text-2xl font-extrabold tabular-nums text-ink">
                  {stats.total} <span className="text-sm font-normal text-dim">({stats.seriesCount} {t("ซีรีส์")})</span>
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-xs tabular-nums">
                  <span className="text-good">{stats.wins}W - {stats.losses}L</span>
                  {stats.ewmaCurrentPct !== null && (
                    <span
                      className="border border-line bg-bg px-1.5 py-0.5 text-[11px] text-ink"
                      title={t("ดัชนีความต่อเนื่องฟอร์มล่าสุด {0}% (ให้น้ำหนักแมตช์ใหม่มากสุด)", stats.ewmaCurrentPct.toFixed(1))}
                    >
                      {t("ฟอร์มช่วงหลัง:")}{" "}
                      <strong className={stats.ewmaCurrentPct >= 50 ? "text-good" : "text-red"}>
                        {stats.ewmaCurrentPct.toFixed(1)}%
                      </strong>
                    </span>
                  )}
                </div>
              </div>

              <div className="border border-gold/30 bg-panel p-4 clip-chamfer-sm">
                <p className="font-mono text-xs text-muted">{t("Win Rate รวม")}</p>
                <p className="mt-1 font-mono text-2xl font-extrabold tabular-nums text-gold">
                  {wrPct(stats.wins, stats.decided)}
                </p>
                <p className="mt-1 font-mono text-[11px] tabular-nums text-muted">
                  {t("ลงผลแล้ว {0}/{1} เกม", stats.decided, stats.total)}
                </p>
                {stats.overallCi && (
                  <CiRangeBar ratePct={overallWrPct} ci={stats.overallCi} />
                )}
                {stats.draftEdge !== null && (
                  <p
                    className="mt-1.5 font-mono text-[11px] tabular-nums text-muted"
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

              <div className="border border-line bg-panel p-4 clip-chamfer-sm">
                <p className="font-mono text-xs text-muted">{t("อัตราชนะแยกฝั่ง")}</p>
                <div className="mt-2 flex items-baseline justify-between gap-3">
                  <div>
                    <span className="font-mono text-xs font-bold text-blue">BLUE </span>
                    <span className="font-mono text-lg font-extrabold tabular-nums text-ink">
                      {wrPct(stats.blueWins, stats.blueDecided)}
                    </span>
                    <p
                      className="font-mono text-[11px] tabular-nums text-dim"
                      title={stats.blueCi ? `Wilson 95% CI: [${stats.blueCi[0].toFixed(0)}–${stats.blueCi[1].toFixed(0)}%]` : undefined}
                    >
                      {stats.blueWins}/{stats.blueDecided}
                      {stats.blueCi ? ` · ${stats.blueCi[0].toFixed(0)}–${stats.blueCi[1].toFixed(0)}%` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-xs font-bold text-red">RED </span>
                    <span className="font-mono text-lg font-extrabold tabular-nums text-ink">
                      {wrPct(stats.redWins, stats.redDecided)}
                    </span>
                    <p
                      className="font-mono text-[11px] tabular-nums text-dim"
                      title={stats.redCi ? `Wilson 95% CI: [${stats.redCi[0].toFixed(0)}–${stats.redCi[1].toFixed(0)}%]` : undefined}
                    >
                      {stats.redWins}/{stats.redDecided}
                      {stats.redCi ? ` · ${stats.redCi[0].toFixed(0)}–${stats.redCi[1].toFixed(0)}%` : ""}
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
                    className="mt-1 font-mono text-[11px] tabular-nums text-muted"
                    title={`${t("เริ่ม Blue:")} ${stats.seriesWinProb.bo5StartBluePct.toFixed(1)}% · ${t("เริ่ม Red:")} ${stats.seriesWinProb.bo5StartRedPct.toFixed(1)}%`}
                  >
                    {t("โอกาสปิดซีรีส์:")} Bo5{" "}
                    <strong className="text-ink">{stats.seriesWinProb.bo5Pct.toFixed(0)}%</strong> · Bo7{" "}
                    <strong className="text-ink">{stats.seriesWinProb.bo7Pct.toFixed(0)}%</strong>
                  </p>
                )}
              </div>

              <div className="border border-line bg-panel p-4 clip-chamfer-sm">
                <p className="font-mono text-xs text-muted">{t("คลังฮีโร่ที่ใช้")}</p>
                <p className="mt-1 font-mono text-2xl font-extrabold tabular-nums text-ink">
                  {stats.uniqueHeroCount} <span className="text-sm font-normal text-dim">{t("ตัวที่ใช้จริง")}</span>
                </p>
                <p
                  className="mt-1 font-mono text-xs tabular-nums text-gold"
                  title="Effective Hero Pool (inverse Simpson / perplexity)"
                >
                  {t("ตัวหลัก:")} <strong>{stats.effectiveHeroPool.toFixed(1)}</strong> {t("ตัว")}
                  <span className="text-dim"> · {t("กระจายใช้งาน")} {stats.poolEvennessPct.toFixed(0)}%</span>
                </p>
                <p className="mt-0.5 font-mono text-[11px] tabular-nums text-dim">
                  {t("เฉลี่ย")} {(stats.uniqueHeroCount / 5).toFixed(1)} {t("ตัว/ตำแหน่ง")}
                </p>
              </div>
            </section>

            {/* 4-Tab Bar */}
            <ScrimTabBar activeTab={activeTab} onSelectTab={setActiveTab} />

            {activeTab === "overview" && (
              <div className="space-y-4">
                <section id="scrim-form" className="grid gap-4 lg:grid-cols-12">
              <div className="min-w-0 border border-line bg-panel p-4 lg:col-span-7">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Layers className="size-4 text-gold" />
                    <h2 className="font-display text-sm font-bold tracking-wider text-ink">
                      {t("ผลงานแยกตามลำดับเกมในซีรีส์ Global Ban (G1–G7)")}
                    </h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums">
                    {stats.fatigueSlopePctPerGame !== null ? (
                      <span
                        title={`G1→G7 slope: ${fmtSignedPct(stats.fatigueSlopePctPerGame)}/game`}
                        className={`border px-2 py-0.5 ${
                          stats.fatigueSlopePctPerGame >= 0
                            ? "border-good/40 bg-good/10 text-good"
                            : "border-red/40 bg-red/10 text-red"
                        }`}
                      >
                        {stats.fatigueSlopePctPerGame >= 1.5
                          ? t("ท้ายซีรีส์แข็งขึ้น ({0}/เกม)", fmtSignedPct(stats.fatigueSlopePctPerGame))
                          : stats.fatigueSlopePctPerGame <= -1.5
                            ? t("ท้ายซีรีส์แผ่วลง ({0}/เกม)", fmtSignedPct(stats.fatigueSlopePctPerGame))
                            : t("ท้ายซีรีส์คงที่ ({0}/เกม)", fmtSignedPct(stats.fatigueSlopePctPerGame))}
                      </span>
                    ) : (
                      <span className="text-dim">{t("เช็กความแข็งแกร่งช่วงต้นซีรีส์ vs เกมตัดสิน G5–G7")}</span>
                    )}
                    {[1, 2, 3].some((n) => (stats.byGameNum.get(n)?.decided ?? 0) > 0) &&
                      [4, 5, 6, 7].some((n) => (stats.byGameNum.get(n)?.decided ?? 0) > 0) && (
                        <span className="text-dim">
                          G1–3 vs G4–7: {t("มั่นใจ")} {stats.earlyVsLateTest.probDominantPct.toFixed(0)}%
                        </span>
                      )}
                  </div>
                </div>
                <div className="flex snap-x gap-1.5 overflow-x-auto pb-1 lg:grid lg:grid-cols-7 lg:overflow-visible lg:pb-0">
                  {[1, 2, 3, 4, 5, 6, 7].map((gNum) => {
                    const row = stats.byGameNum.get(gNum);
                    const pct = row && row.decided > 0 ? (row.wins / row.decided) * 100 : 0;
                    const hasData = Boolean(row && row.decided > 0);
                    const ciLabel = row?.ci ? `95% CI: [${row.ci[0].toFixed(1)}%–${row.ci[1].toFixed(1)}%]` : undefined;
                    return (
                      <div key={gNum} title={ciLabel} className="flex min-w-[82px] shrink-0 snap-start flex-col justify-between border border-line bg-bg p-2 lg:min-w-0">
                        <div className="flex items-center justify-between font-mono text-[11px] tabular-nums">
                          <span className="font-bold text-gold">G{gNum}{gNum === 7 ? " Ult" : ""}</span>
                          <span className="text-dim">{row?.total ?? 0}g</span>
                        </div>
                        <div className="my-2 flex h-20 items-end justify-center bg-panel-2/40 px-1 py-1.5">
                          <div
                            className={`w-6 rounded-t-[1px] transition-all ${!hasData ? "bg-line" : pct >= 50 ? "bg-good/80" : "bg-red/80"}`}
                            style={{ height: `${hasData ? Math.max(10, pct) : 4}%` }}
                          />
                        </div>
                        <div className="flex flex-col items-center gap-0.5 font-mono tabular-nums">
                          <strong className={`text-xs ${!hasData ? "text-dim" : pct >= 50 ? "text-good" : "text-red"}`}>
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

              <div className="border border-line bg-panel p-4 lg:col-span-5">
                <div className="mb-3 flex items-center gap-2">
                  <Activity className="size-4 text-gold" />
                  <h2 className="font-display text-sm font-bold tracking-wider text-ink">
                    {t("ฟอร์มช่วงหลัง")}
                  </h2>
                </div>
                <EwmaSparkline
                  points={stats.ewmaSeries}
                  currentPct={stats.ewmaCurrentPct}
                  deltaPct={stats.ewmaDeltaPct}
                />
              </div>
            </section>

            <PositionalPoolCard advanced={advancedStats} heroMap={heroMap} />

            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <div className="border border-line bg-panel p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="font-display text-sm font-bold tracking-wider text-ink">
                    {t("สถิติเจอแต่ละทีม (Head-to-Head)")}
                  </h2>
                  {opponentFilter !== "ALL" && (
                    <button
                      type="button"
                      onClick={() => setOpponentFilter("ALL")}
                      className="inline-flex min-h-7 items-center border border-gold/40 bg-gold/10 px-2.5 text-xs font-semibold text-gold hover:bg-gold hover:text-bg"
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
                            className={`transition-colors hover:bg-panel-2/60 ${
                              active ? "bg-gold/10" : ""
                            }`}
                          >
                            <td className="px-2.5 py-1">
                              <button
                                type="button"
                                onClick={() => setOpponentFilter(active ? "ALL" : row.opponent)}
                                className="inline-flex min-h-7 w-full items-center gap-1 text-left font-display font-bold text-ink hover:text-gold [overflow-wrap:anywhere]"
                              >
                                <span>{row.opponent}</span>
                                <span className="font-mono text-[10px] font-normal text-dim">
                                  ({row.seriesCount}s)
                                </span>
                              </button>
                            </td>
                            <td className="px-2.5 py-2 text-right font-mono tabular-nums text-muted">
                              {row.wins}-{row.losses}
                            </td>
                            <td
                              className={`px-2.5 py-2 text-right font-mono font-bold tabular-nums ${
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

              <CompArchetypeCard advanced={advancedStats} heroMap={heroMap} />
            </div>
              </div>
            )}

            {activeTab === "draft" && (
              <div className="space-y-4">
                <section id="scrim-draft" className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <PhasePickCard phase1Top={stats.phase1Top} phase2Top={stats.phase2Top} heroMap={heroMap} previewLimit={9} />

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
                    <ul className={isCardExpanded("teamBans") ? "max-h-80 space-y-1.5 overflow-y-auto pr-1" : "space-y-1.5"}>
                      {(isCardExpanded("teamBans") ? stats.bansAgainstUs : stats.bansAgainstUs.slice(0, 6)).map((b) => (
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
                    <ul className={isCardExpanded("teamBans") ? "max-h-80 space-y-1.5 overflow-y-auto pr-1" : "space-y-1.5"}>
                      {(isCardExpanded("teamBans") ? stats.bansByUs : stats.bansByUs.slice(0, 6)).map((b) => (
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
                <ExpandScrollButton
                  expanded={isCardExpanded("teamBans")}
                  totalCount={Math.max(stats.bansAgainstUs.length, stats.bansByUs.length)}
                  previewLimit={6}
                  onToggle={() => toggleCard("teamBans")}
                />

                {stats.protectiveBans.length > 0 && (
                  <div className="border-t border-line pt-2.5">
                    <div className="mb-2">
                      <p className="font-mono text-[11px] font-bold text-gold">
                        {t("คู่แข่งมักแบนตามหลังเราหยิบ (Phase 2)")}
                        {stats.protectiveBans.length > 6 && (
                          <span className="ml-1.5 font-normal text-dim">({stats.protectiveBans.length})</span>
                        )}
                      </p>
                      <p className="text-[11px] text-dim">
                        {t("เมื่อเราหยิบตัวซ้ายใน Phase 1 คู่แข่งมักรีบแบนตัวขวาใน Phase 2")}
                      </p>
                    </div>
                    <div className={isCardExpanded("protectiveBans") ? "flex max-h-64 flex-wrap gap-2 overflow-y-auto pr-1" : "flex flex-wrap gap-2"}>
                      {(isCardExpanded("protectiveBans") ? stats.protectiveBans : stats.protectiveBans.slice(0, 6)).map((pb) => (
                        <div
                          key={`${pb.pickedHero}-${pb.bannedHero}`}
                          title={t("บ่อยกว่าปกติ {0} เท่า", pb.banLift.toFixed(1))}
                          className="inline-flex max-w-full flex-wrap items-center gap-1.5 border border-line bg-bg px-2.5 py-1.5 text-xs"
                        >
                          <div className="size-6 shrink-0 overflow-hidden border border-line">
                            <HeroPortrait name={pb.pickedHero} hero={heroMap.get(pb.pickedHero)} />
                          </div>
                          <strong className="font-semibold text-ink">{displayName(pb.pickedHero)}</strong>
                          <span className="font-mono text-[11px] text-dim">→ {t("แบน")}</span>
                          <div className="size-6 shrink-0 overflow-hidden border border-red/50">
                            <HeroPortrait name={pb.bannedHero} hero={heroMap.get(pb.bannedHero)} />
                          </div>
                          <strong className="font-semibold text-red">{displayName(pb.bannedHero)}</strong>
                          <span className="ml-0.5 border border-gold/40 bg-gold/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-gold">
                            {t("{0} ครั้ง", pb.coCount)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <ExpandScrollButton
                      expanded={isCardExpanded("protectiveBans")}
                      totalCount={stats.protectiveBans.length}
                      previewLimit={6}
                      onToggle={() => toggleCard("protectiveBans")}
                    />
                  </div>
                )}
              </div>
            </section>

            <section className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <BlindCounterSlotCard advanced={advancedStats} heroMap={heroMap} />
              <FlexEffectivenessCard advanced={advancedStats} heroMap={heroMap} />
            </section>
              </div>
            )}

            {activeTab === "heroes" && (
              <div className="space-y-4">
                <section id="scrim-heroes" className="border border-line bg-panel p-4">
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

              <div className="max-h-[32rem] overflow-auto border border-line">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-panel-2 font-mono text-[11px] text-muted">
                    <tr>
                      <th className="whitespace-nowrap px-3 py-2">{t("ฮีโร่")}</th>
                      <th className="whitespace-nowrap px-3 py-2">{t(laneFilter === "ALL" ? "เลนหลัก" : "เลน")}</th>
                      <th className="whitespace-nowrap px-3 py-2 text-right">{t("เกม")}</th>
                      <th className="whitespace-nowrap px-3 py-2 text-right">W - L</th>
                      <th className="whitespace-nowrap px-3 py-2">{t("Win Rate")}</th>
                      <th
                        className="whitespace-nowrap px-3 py-2 text-right"
                        title={t("Win Rate ปรับฐานเทียบค่าเฉลี่ยของทีม")}
                      >
                        {t("ฟอร์มเทียบทีม")}
                      </th>
                      <th
                        className="whitespace-nowrap px-3 py-2 text-right"
                        title={t("สัดส่วนที่หยิบใน Phase 1 (P1–P3)")}
                      >
                        {t("หยิบ P1")}
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
                            <div className="text-gold">{p1Pct.toFixed(0)}%</div>
                            {(row.b1Count > 0 || row.r5Count > 0) && (
                              <div className="mt-0.5 flex flex-wrap justify-end gap-x-1.5 text-[10px] leading-tight whitespace-nowrap">
                                {row.b1Count > 0 && (
                                  <span
                                    className="text-blue/90"
                                    title={t("หยิบเปิดตัวแรกสุดฝั่ง Blue {0} เกม", row.b1Count)}
                                  >
                                    {t("เปิดแรก {0}", row.b1Count)}
                                  </span>
                                )}
                                {row.b1Count > 0 && row.r5Count > 0 && (
                                  <span className="text-dim" aria-hidden="true">·</span>
                                )}
                                {row.r5Count > 0 && (
                                  <span
                                    className="text-red/90"
                                    title={t("หยิบเป็นตัวสุดท้าย (ไม้ปิด) ฝั่ง Red {0} เกม", row.r5Count)}
                                  >
                                    {t("ปิดท้าย {0}", row.r5Count)}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <PeriodDiffCard
              scopedGames={scopedGames}
              activeGames={activeGames}
              tournaments={tournaments}
              focusTeam={focusTeam}
              opponentFilter={opponentFilter}
              heroMap={heroMap}
              precomputedDiff={showSampleData ? (sampleData?.periodDiff ?? null) : undefined}
              controlledMode={showSampleData ? samplePeriodMode : undefined}
              onControlledModeChange={showSampleData ? setSamplePeriodMode : undefined}
            />
              </div>
            )}

            {activeTab === "matchups" && (
              <div className="space-y-4">
                <section id="scrim-matchups" className="grid items-start gap-4 lg:grid-cols-2">
              <DuosCard duos={stats.topDuos} heroMap={heroMap} />

              {(() => {
                const isToughTab = enemyTab === "tough";
                const activeEnemies = isToughTab ? stats.toughestEnemies : stats.favorableEnemies;
                const enemyExpandKey = isToughTab ? "teamEnemiesTough" : "teamEnemiesFavorable";
                const enemyExpanded = isCardExpanded(enemyExpandKey);
                return (
                  <div className="border border-line bg-panel p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Swords className={`size-4 ${isToughTab ? "text-red" : "text-good"}`} />
                        <h2 className="font-display text-sm font-bold tracking-wider text-ink">
                          {t("ผลงานเมื่อเจอฮีโร่ฝั่งตรงข้าม")}
                        </h2>
                      </div>
                      <span className="font-mono text-[10px] text-dim">{t("เทียบ Win Rate เฉลี่ยทีม")}</span>
                    </div>
                    <div role="tablist" aria-label={t("ผลงานเมื่อเจอฮีโร่ฝั่งตรงข้าม")} className="mb-3 grid grid-cols-2 gap-1.5 border border-line bg-bg p-1">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={isToughTab}
                        onClick={() => setEnemyTab("tough")}
                        className={`flex min-h-8 items-center justify-center gap-1.5 border px-2 font-display text-xs font-bold transition-colors ${
                          isToughTab
                            ? "border-red/60 bg-red/15 text-red"
                            : "border-transparent text-muted hover:text-ink"
                        }`}
                      >
                        <span>{t("ฮีโร่ที่แพ้ทาง")}</span>
                        <span className="font-mono text-[11px] tabular-nums opacity-85">({stats.toughestEnemies.length})</span>
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={!isToughTab}
                        onClick={() => setEnemyTab("favorable")}
                        className={`flex min-h-8 items-center justify-center gap-1.5 border px-2 font-display text-xs font-bold transition-colors ${
                          !isToughTab
                            ? "border-good/60 bg-good/15 text-good"
                            : "border-transparent text-muted hover:text-ink"
                        }`}
                      >
                        <span>{t("รับมือได้ดี")}</span>
                        <span className="font-mono text-[11px] tabular-nums opacity-85">({stats.favorableEnemies.length})</span>
                      </button>
                    </div>
                    {activeEnemies.length === 0 ? (
                      <p className="text-xs text-dim">
                        {t(isToughTab ? "ยังไม่มีฮีโร่ฝั่งตรงข้ามที่แพ้ทางชัดเจน" : "ยังไม่มีฮีโร่ฝั่งตรงข้ามที่ชนะทางชัดเจน")}
                      </p>
                    ) : (
                      <>
                        <ul className={enemyExpanded ? "max-h-96 space-y-2 overflow-y-auto pr-1" : "space-y-2"}>
                          {(enemyExpanded ? activeEnemies : activeEnemies.slice(0, 8)).map((e) => (
                            <li key={`${enemyTab}-${e.hero}`} className="flex flex-wrap items-center justify-between gap-2 border border-line bg-bg px-2.5 py-2 text-xs">
                              <div className="flex min-w-0 items-center gap-2">
                                <div className="size-6 shrink-0 overflow-hidden border border-line">
                                  <HeroPortrait name={e.hero} hero={heroMap.get(e.hero)} />
                                </div>
                                <span className="truncate font-semibold text-ink">{displayName(e.hero)}</span>
                              </div>
                              <div className="flex shrink-0 items-center gap-2 font-mono tabular-nums">
                                <span className={`font-bold ${isToughTab ? "text-red" : "text-good"}`}>{fmtSignedPct(e.threatDeltaPct)}</span>
                                <span className="text-ink">{wrPct(e.ourWins, e.decided)}</span>
                                <span
                                  className="text-[11px] text-dim"
                                  title={`Z=${e.zScore.toFixed(2)}`}
                                >
                                  ({e.ourWins}W-{e.ourLosses}L · {t(isToughTab ? "แพ้ทางจริง" : "ชนะทางจริง")}{" "}
                                  {(isToughTab ? e.probThreatPct : 100 - e.probThreatPct).toFixed(0)}%)
                                </span>
                              </div>
                            </li>
                          ))}
                        </ul>
                        <ExpandScrollButton
                          expanded={enemyExpanded}
                          totalCount={activeEnemies.length}
                          previewLimit={8}
                          onToggle={() => toggleCard(enemyExpandKey)}
                        />
                      </>
                    )}
                  </div>
                );
              })()}

              <div className="border border-line bg-panel p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Swords className="size-4 text-gold" />
                    <h2 className="font-display text-sm font-bold tracking-wider text-ink">
                      {t("สถิติชนเลนตรง (ตัวต่อตัว)")}
                    </h2>
                  </div>
                  <span className="font-mono text-[10px] text-dim">{t("ความได้เปรียบเลน")}</span>
                </div>
                {stats.laneStrengths.length === 0 && stats.laneWeaknesses.length === 0 ? (
                  <p className="text-xs text-dim">
                    {t("ยังไม่มีข้อมูลการชนเลนตรง (ต้องลงตำแหน่งเลนของฮีโร่อย่างน้อย 2 เกมต่อคู่)")}
                  </p>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="mb-1.5 font-mono text-[11px] font-bold text-good">{t("คู่เลนที่ได้เปรียบ")}</p>
                        <ul className={isCardExpanded("teamLane") ? "max-h-96 space-y-1.5 overflow-y-auto pr-1" : "space-y-1.5"}>
                          {(isCardExpanded("teamLane") ? stats.laneStrengths : stats.laneStrengths.slice(0, 6)).map((m) => (
                            <li
                              key={`ls-${m.lane}-${m.allyHero}-${m.enemyHero}`}
                              title={`${t("มั่นใจ")} ${m.probAdvantagePct.toFixed(0)}% · Z=${m.zScore.toFixed(2)}`}
                              className="flex flex-wrap items-center justify-between gap-1.5 border border-line bg-bg px-2 py-1.5 text-[11px]"
                            >
                              <div className="flex min-w-0 items-center gap-1">
                                <span className="shrink-0 font-mono text-[10px] font-bold text-gold">
                                  {LANE_SHORT[m.lane]?.en ?? m.lane}
                                </span>
                                <div className="size-4.5 shrink-0 overflow-hidden border border-line">
                                  <HeroPortrait name={m.allyHero} hero={heroMap.get(m.allyHero)} />
                                </div>
                                <span className="truncate font-semibold text-good">{displayName(m.allyHero)}</span>
                                <span className="shrink-0 text-[10px] text-dim">›</span>
                                <div className="size-4.5 shrink-0 overflow-hidden border border-line">
                                  <HeroPortrait name={m.enemyHero} hero={heroMap.get(m.enemyHero)} />
                                </div>
                                <span className="truncate font-semibold text-ink">{displayName(m.enemyHero)}</span>
                              </div>
                              <span className="shrink-0 font-mono tabular-nums text-good">
                                {fmtSignedPct(m.counterLiftPct)} ({m.wins}W-{m.losses}L)
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="mb-1.5 font-mono text-[11px] font-bold text-red">{t("คู่เลนที่เสียเปรียบ")}</p>
                        <ul className={isCardExpanded("teamLane") ? "max-h-96 space-y-1.5 overflow-y-auto pr-1" : "space-y-1.5"}>
                          {(isCardExpanded("teamLane") ? stats.laneWeaknesses : stats.laneWeaknesses.slice(0, 6)).map((m) => (
                            <li
                              key={`lw-${m.lane}-${m.allyHero}-${m.enemyHero}`}
                              title={`${t("เสียเปรียบจริง")} ${(100 - m.probAdvantagePct).toFixed(0)}% · Z=${m.zScore.toFixed(2)}`}
                              className="flex flex-wrap items-center justify-between gap-1.5 border border-line bg-bg px-2 py-1.5 text-[11px]"
                            >
                              <div className="flex min-w-0 items-center gap-1">
                                <span className="shrink-0 font-mono text-[10px] font-bold text-gold">
                                  {LANE_SHORT[m.lane]?.en ?? m.lane}
                                </span>
                                <div className="size-4.5 shrink-0 overflow-hidden border border-line">
                                  <HeroPortrait name={m.allyHero} hero={heroMap.get(m.allyHero)} />
                                </div>
                                <span className="truncate font-semibold text-red">{displayName(m.allyHero)}</span>
                                <span className="shrink-0 text-[10px] text-dim">‹</span>
                                <div className="size-4.5 shrink-0 overflow-hidden border border-line">
                                  <HeroPortrait name={m.enemyHero} hero={heroMap.get(m.enemyHero)} />
                                </div>
                                <span className="truncate font-semibold text-ink">{displayName(m.enemyHero)}</span>
                              </div>
                              <span className="shrink-0 font-mono tabular-nums text-red">
                                {fmtSignedPct(m.counterLiftPct)} ({m.wins}W-{m.losses}L)
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <ExpandScrollButton
                      expanded={isCardExpanded("teamLane")}
                      totalCount={Math.max(stats.laneStrengths.length, stats.laneWeaknesses.length)}
                      previewLimit={6}
                      onToggle={() => toggleCard("teamLane")}
                    />
                  </>
                )}
              </div>
            </section>

            <TrioSynergyCard advanced={advancedStats} heroMap={heroMap} />
              </div>
            )}

            <MethodsReferenceCard />
          </>
        )}
          </>
        )}
      </div>

      <ScoutingReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        focusTeam={focusTeam}
        opponentFilter={opponentFilter}
        stats={stats}
        allStats={allStats}
        advanced={advancedStats}
        periodDiff={modalPeriodDiff}
        heroMap={heroMap}
      />
    </main>
  );
}

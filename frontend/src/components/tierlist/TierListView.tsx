import {
  ArrowUpDown,
  Filter,
  Info,
  LayoutGrid,
  Search,
  Table as TableIcon,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { Hero, RoleType } from "../../types/draft";
import { displayName, matchesHeroQuery } from "../../utils/heroNames";
import { HeroPortrait } from "../HeroPortrait";
import { Modal } from "../Modal";

interface TierListViewProps {
  heroes: Hero[];
}

type LaneFilter = "ALL" | "DS_Lane" | "Jungle" | "Mid" | "Dragon_Lane" | "Roam";
type RoleFilter = "ALL" | RoleType;
type ViewMode = "board" | "table";
type SortField =
  | "rank"
  | "tier"
  | "name"
  | "role"
  | "presence_rate"
  | "win_rate"
  | "pick_rate"
  | "ban_rate";
type SortOrder = "asc" | "desc";

const LANE_FILTERS: { key: LaneFilter; label: string; th: string }[] = [
  { key: "ALL", label: "ALL", th: "ทั้งหมด" },
  { key: "DS_Lane", label: "DS LANE", th: "ออฟเลน" },
  { key: "Jungle", label: "JGL", th: "ป่า" },
  { key: "Mid", label: "MID", th: "เลนกลาง" },
  { key: "Dragon_Lane", label: "ADL", th: "แครี่" },
  { key: "Roam", label: "SUP", th: "โรมมิ่ง" },
];

const ROLE_FILTERS: { key: RoleFilter; label: string }[] = [
  { key: "ALL", label: "All Roles (ทุกสาย)" },
  { key: "Fighter", label: "Fighter (ไฟต์เตอร์)" },
  { key: "Assassin", label: "Assassin (แอสซาซิน)" },
  { key: "Mage", label: "Mage (เมจ)" },
  { key: "Carry", label: "Carry (แครี่)" },
  { key: "Support", label: "Support (ซัพพอร์ต)" },
  { key: "Tank", label: "Tank (แทงค์)" },
];

const TIER_ORDER: Record<string, number> = {
  "S+": 0,
  S: 1,
  A: 2,
  B: 3,
  C: 4,
};

const TIER_META: Record<
  string,
  { label: string; title: string; badge: string; border: string; glow: string }
> = {
  "S+": {
    label: "S+",
    title: "GOD TIER / MUST BAN-PICK (PRESENCE ≥ 45%)",
    badge: "bg-red-500/20 text-red-300 border-red-500/50 shadow-[0_0_12px_rgba(239,68,68,0.25)]",
    border: "border-red-500/30",
    glow: "bg-gradient-to-r from-red-950/40 via-red-900/10 to-transparent",
  },
  S: {
    label: "S",
    title: "TIER 1 / META DECIDERS (PRESENCE ≥ 25%)",
    badge: "bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-[0_0_12px_rgba(245,158,11,0.25)]",
    border: "border-amber-500/30",
    glow: "bg-gradient-to-r from-amber-950/40 via-amber-900/10 to-transparent",
  },
  A: {
    label: "A",
    title: "TIER 2 / CORE VIABLE (PRESENCE ≥ 12%)",
    badge: "bg-blue-500/20 text-blue-300 border-blue-500/50",
    border: "border-blue-500/30",
    glow: "bg-gradient-to-r from-blue-950/40 via-blue-900/10 to-transparent",
  },
  B: {
    label: "B",
    title: "TIER 3 / SITUATIONAL & COUNTER (PRESENCE ≥ 4%)",
    badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/50",
    border: "border-emerald-500/30",
    glow: "bg-gradient-to-r from-emerald-950/40 via-emerald-900/10 to-transparent",
  },
  C: {
    label: "C",
    title: "TIER 4 / NICHE OR OFF-META (PRESENCE < 4%)",
    badge: "bg-zinc-700/30 text-zinc-400 border-zinc-600/40",
    border: "border-zinc-800/80",
    glow: "bg-gradient-to-r from-zinc-900/40 via-zinc-900/10 to-transparent",
  },
};

export function TierListView({ heroes }: TierListViewProps) {
  const [selectedLane, setSelectedLane] = useState<LaneFilter>("ALL");
  const [selectedRole, setSelectedRole] = useState<RoleFilter>("ALL");
  const [includeFlex, setIncludeFlex] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [inspectHero, setInspectHero] = useState<Hero | null>(null);

  // Table sorting (default: Excel rank ascending 1..130)
  const [sortField, setSortField] = useState<SortField>("rank");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Global keydown: shortcut '/' to focus search
  const handleContainerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "/" && document.activeElement !== searchInputRef.current) {
      e.preventDefault();
      searchInputRef.current?.focus();
    }
  };

  // Filtered heroes list
  const filteredHeroes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return heroes.filter((h) => {
      // Lane match: strictly match primary pro lane by default; optionally include flex lanes
      if (selectedLane !== "ALL") {
        const target = selectedLane.toLowerCase();
        const mainStr = (h.main_pro_lane || "").toLowerCase();
        if (includeFlex) {
          const laneStr = (h.lane || "").toLowerCase();
          if (!laneStr.includes(target) && mainStr !== target) {
            return false;
          }
        } else {
          if (mainStr !== target) {
            return false;
          }
        }
      }
      // Role match
      if (selectedRole !== "ALL") {
        if (h.role !== selectedRole) {
          return false;
        }
      }
      // Query match
      if (q && !matchesHeroQuery(h.name, q)) {
        return false;
      }
      return true;
    });
  }, [heroes, selectedLane, selectedRole, searchQuery, includeFlex]);

  // Grouped by tier for Board View (sorted strictly by Excel Rank within tier)
  const groupedByTier = useMemo(() => {
    const tiers: Record<string, Hero[]> = {
      "S+": [],
      S: [],
      A: [],
      B: [],
      C: [],
    };
    for (const h of filteredHeroes) {
      if (tiers[h.tier]) {
        tiers[h.tier].push(h);
      } else {
        tiers.C.push(h);
      }
    }
    // Sort each tier by Rank ascending (exact match with Excel)
    for (const t of Object.keys(tiers)) {
      tiers[t].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
    }
    return tiers;
  }, [filteredHeroes]);

  // Sorted list for Table View
  const sortedTableHeroes = useMemo(() => {
    const list = [...filteredHeroes];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === "rank") {
        cmp = (a.rank ?? 999) - (b.rank ?? 999);
      } else if (sortField === "tier") {
        cmp = (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99);
        if (cmp === 0) cmp = (a.rank ?? 999) - (b.rank ?? 999);
      } else if (sortField === "name") {
        cmp = displayName(a.name).localeCompare(displayName(b.name));
      } else if (sortField === "role") {
        cmp = a.role.localeCompare(b.role);
      } else if (sortField === "presence_rate") {
        cmp = (a.presence_rate ?? 0) - (b.presence_rate ?? 0);
      } else if (sortField === "win_rate") {
        cmp = (a.win_rate ?? 50) - (b.win_rate ?? 50);
      } else if (sortField === "pick_rate") {
        cmp = (a.pick_rate ?? 0) - (b.pick_rate ?? 0);
      } else if (sortField === "ban_rate") {
        cmp = (a.ban_rate ?? 0) - (b.ban_rate ?? 0);
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filteredHeroes, sortField, sortOrder]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      // Ascending by default for rank/tier/name, descending for percentages
      setSortOrder(field === "rank" || field === "tier" || field === "name" ? "asc" : "desc");
    }
  };

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-bg"
      onKeyDown={handleContainerKeyDown}
      tabIndex={-1}
    >
      {/* Top Controls Header */}
      <div className="shrink-0 border-b border-line bg-panel/70 px-4 py-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1920px] flex-col gap-3">
          {/* Row 1: Title, Quick Search & View Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-lg font-bold tracking-wider text-ink sm:text-xl">
                  META TIER LIST 2026
                </h1>
                <span className="rounded border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] font-semibold text-gold">
                  EXCEL MASTER SYNCED
                </span>
              </div>
              <p className="text-xs text-muted">
                Authoritative Tier List & Pro Draft Statistics directly synced with RoV Pro Draft Master 2026
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* Search Box */}
              <div className="relative w-44 sm:w-64">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ค้นหาฮีโร่... (กด /)"
                  className="h-8 w-full rounded border border-line bg-bg pl-8 pr-7 text-xs text-ink placeholder-dim focus:border-gold focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-dim hover:text-ink"
                    aria-label="ล้างการค้นหา"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* View Mode Toggle */}
              <div className="flex items-center rounded border border-line bg-panel p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode("board")}
                  title="Tier Board View"
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    viewMode === "board"
                      ? "bg-gold/20 text-gold"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Board</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("table")}
                  title="Table Data View (Excel Style)"
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    viewMode === "table"
                      ? "bg-gold/20 text-gold"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  <TableIcon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Table</span>
                </button>
              </div>
            </div>
          </div>

          {/* Row 2: Lane Filters & Role Dropdown */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {/* Lane Filter Buttons (Desktop md+) */}
            <div className="hidden md:flex flex-wrap items-center gap-1">
              <span className="mr-1 flex items-center gap-1 text-[11px] font-semibold tracking-wider text-dim uppercase">
                <Filter className="h-3 w-3" />
                LANE:
              </span>
              {LANE_FILTERS.map((f) => (
                <button
                  type="button"
                  key={f.key}
                  onClick={() => setSelectedLane(f.key)}
                  className={`rounded border px-2.5 py-1 text-xs font-semibold tracking-wide transition-all ${
                    selectedLane === f.key
                      ? "border-gold bg-gold/15 text-gold shadow-[0_0_8px_rgba(245,196,81,0.2)]"
                      : "border-line bg-panel text-muted hover:border-line-strong hover:text-ink"
                  }`}
                >
                  {f.label}
                  <span className="ml-1 text-[10px] font-normal text-dim">({f.th})</span>
                </button>
              ))}

              {/* Include Flex Lanes Toggle (shown when filtering by a specific lane) */}
              {selectedLane !== "ALL" && (
                <label className="ml-2 flex items-center gap-1.5 cursor-pointer text-[11px] font-medium text-muted hover:text-ink select-none">
                  <input
                    type="checkbox"
                    checked={includeFlex}
                    onChange={(e) => setIncludeFlex(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-line bg-panel text-gold focus:ring-0 cursor-pointer accent-[#f5c451]"
                  />
                  <span>รวม Flex (≥15%)</span>
                </label>
              )}
            </div>

            {/* Mobile Lane Filter Dropdown (< md) */}
            <div className="flex md:hidden items-center gap-1.5">
              <span className="flex items-center gap-1 text-[11px] font-semibold tracking-wider text-dim uppercase">
                <Filter className="h-3 w-3" />
                LANE:
              </span>
              <select
                aria-label="กรองตามเลน"
                value={selectedLane}
                onChange={(e) => setSelectedLane(e.target.value as LaneFilter)}
                className="h-7 rounded border border-line bg-bg px-2 text-xs font-medium text-ink focus:border-gold focus:outline-none"
              >
                {LANE_FILTERS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label} ({f.th})
                  </option>
                ))}
              </select>
              {selectedLane !== "ALL" && (
                <label className="ml-1 flex items-center gap-1 cursor-pointer text-[11px] font-medium text-muted hover:text-ink select-none">
                  <input
                    type="checkbox"
                    checked={includeFlex}
                    onChange={(e) => setIncludeFlex(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-line bg-panel text-gold focus:ring-0 cursor-pointer accent-[#f5c451]"
                  />
                  <span>Flex</span>
                </label>
              )}
            </div>

            {/* Role Filter & Hero Count */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs text-muted">
                <span className="text-[11px] font-semibold text-dim uppercase">ROLE:</span>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as RoleFilter)}
                  className="h-7 rounded border border-line bg-bg px-2 text-xs font-medium text-ink focus:border-gold focus:outline-none"
                >
                  {ROLE_FILTERS.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="text-[11px] font-mono text-dim">
                <span className="text-ink font-semibold">{filteredHeroes.length}</span> / {heroes.length} HEROES
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-[1920px]">
          {viewMode === "board" ? (
            /* ================= BOARD VIEW ================= */
            <div className="space-y-4">
              {(["S+", "S", "A", "B", "C"] as const).map((tierKey) => {
                const tierMeta = TIER_META[tierKey];
                const list = groupedByTier[tierKey] || [];
                if (list.length === 0 && (selectedLane !== "ALL" || selectedRole !== "ALL" || searchQuery)) {
                  return null;
                }

                return (
                  <div
                    key={tierKey}
                    className={`flex flex-col rounded-lg border ${tierMeta.border} bg-panel/50 overflow-hidden shadow-sm transition-all sm:flex-row`}
                  >
                    {/* Tier Indicator Header / Sidebar */}
                    <div
                      className={`flex shrink-0 items-center justify-between border-b sm:border-b-0 sm:border-r ${tierMeta.border} ${tierMeta.glow} px-4 py-3 sm:w-48 sm:flex-col sm:items-start sm:justify-center`}
                    >
                      <div className="flex items-center gap-2 sm:flex-col sm:items-start sm:gap-1">
                        <span
                          className={`inline-flex items-center justify-center rounded px-3 py-1 font-display text-xl font-black tracking-wider border ${tierMeta.badge}`}
                        >
                          {tierKey}
                        </span>
                        <span className="text-[10px] font-bold tracking-wider text-muted uppercase">
                          {tierMeta.title}
                        </span>
                      </div>
                      <span className="font-mono text-xs text-dim">
                        {list.length} {list.length === 1 ? "Hero" : "Heroes"}
                      </span>
                    </div>

                    {/* Heroes Grid Inside Tier */}
                    <div className="flex-1 p-3">
                      {list.length === 0 ? (
                        <div className="py-6 text-center text-xs text-dim italic">
                          ไม่มีฮีโร่ใน Tier นี้ตามเงื่อนไขตัวกรอง
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12">
                          {list.map((h) => (
                            <button
                              type="button"
                              key={h.id}
                              onClick={() => setInspectHero(h)}
                              className="group relative flex flex-col items-center rounded border border-line bg-panel p-1.5 text-left transition-all hover:scale-105 hover:border-gold/80 hover:bg-panel-2 hover:shadow-[0_0_12px_rgba(245,196,81,0.2)]"
                            >
                              {/* Hero Avatar with Ratio 1:1 */}
                              <div className="relative aspect-square w-full overflow-hidden rounded bg-bg">
                                <HeroPortrait name={h.name} hero={h} />

                                {/* Top-Left Rank Badge */}
                                {typeof h.rank === "number" && h.rank <= 130 && (
                                  <div className="absolute left-0 top-0 rounded-br bg-black/80 px-1 py-0.2 font-mono text-[9px] font-bold text-gold">
                                    #{h.rank}
                                  </div>
                                )}

                                {/* Bottom-Right Presence / WR Badge */}
                                {typeof h.presence_rate === "number" && (
                                  <div
                                    className={`absolute bottom-0 right-0 rounded-tl px-1 py-0.2 font-mono text-[9px] font-bold ${
                                      h.presence_rate >= 45
                                        ? "bg-red-950/90 text-red-300"
                                        : h.presence_rate >= 25
                                          ? "bg-amber-950/90 text-amber-300"
                                          : h.presence_rate >= 12
                                            ? "bg-blue-950/90 text-blue-300"
                                            : "bg-zinc-900/90 text-zinc-400"
                                    }`}
                                  >
                                    {h.presence_rate.toFixed(1)}%
                                  </div>
                                )}
                              </div>

                              {/* Hero Info */}
                              <div className="mt-1 w-full text-center">
                                <div className="truncate font-display text-xs font-semibold text-ink group-hover:text-gold">
                                  {displayName(h.name)}
                                </div>
                                <div className="truncate text-[9.5px] text-dim">
                                  {includeFlex &&
                                  selectedLane !== "ALL" &&
                                  h.main_pro_lane?.toLowerCase() !== selectedLane.toLowerCase() ? (
                                    <span className="font-semibold text-purple-400">
                                      Flex ({h.main_pro_lane})
                                    </span>
                                  ) : (
                                    h.main_pro_lane || h.lane
                                  )}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ================= TABLE VIEW (EXCEL STYLE) ================= */
            <div className="overflow-hidden rounded-lg border border-line bg-panel/70 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-line bg-panel-2/90 font-display text-[11px] font-bold tracking-wider text-muted uppercase">
                    <tr>
                      <th
                        className="cursor-pointer py-3 pl-4 pr-2 hover:text-ink"
                        onClick={() => toggleSort("rank")}
                      >
                        <div className="flex items-center gap-1">
                          RANK <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th
                        className="cursor-pointer px-3 py-3 hover:text-ink"
                        onClick={() => toggleSort("tier")}
                      >
                        <div className="flex items-center gap-1">
                          TIER <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th
                        className="cursor-pointer px-3 py-3 hover:text-ink"
                        onClick={() => toggleSort("name")}
                      >
                        <div className="flex items-center gap-1">
                          HERO <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th
                        className="cursor-pointer px-3 py-3 hover:text-ink"
                        onClick={() => toggleSort("role")}
                      >
                        <div className="flex items-center gap-1">
                          ROLE <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th className="px-3 py-3">PRO LANE</th>
                      <th
                        className="cursor-pointer px-3 py-3 text-right hover:text-ink"
                        onClick={() => toggleSort("presence_rate")}
                      >
                        <div className="flex items-center justify-end gap-1">
                          PRESENCE <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th
                        className="cursor-pointer px-3 py-3 text-right hover:text-ink"
                        onClick={() => toggleSort("pick_rate")}
                      >
                        <div className="flex items-center justify-end gap-1">
                          PICK RATE <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th
                        className="cursor-pointer px-3 py-3 text-right hover:text-ink"
                        onClick={() => toggleSort("ban_rate")}
                      >
                        <div className="flex items-center justify-end gap-1">
                          BAN RATE <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th
                        className="cursor-pointer px-3 py-3 text-right hover:text-ink"
                        onClick={() => toggleSort("win_rate")}
                      >
                        <div className="flex items-center justify-end gap-1">
                          WIN RATE <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                      <th className="px-3 py-3 text-right">PRO GAMES (P/B)</th>
                      <th className="py-3 pl-3 pr-4">META NOTE / RATIONALE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60 font-mono">
                    {sortedTableHeroes.map((h) => {
                      const tierMeta = TIER_META[h.tier] ?? TIER_META.C;
                      return (
                        <tr
                          key={h.id}
                          onClick={() => setInspectHero(h)}
                          className="cursor-pointer transition-colors hover:bg-panel-2/60"
                        >
                          <td className="py-2.5 pl-4 pr-2 font-bold text-gold">
                            #{h.rank ?? "-"}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`inline-flex min-w-[28px] items-center justify-center rounded px-1.5 py-0.5 text-xs font-black border ${tierMeta.badge}`}
                            >
                              {h.tier}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-display text-sm font-semibold text-ink">
                            <div className="flex items-center gap-2">
                              <div className="h-7 w-7 shrink-0 overflow-hidden rounded bg-bg">
                                <HeroPortrait name={h.name} hero={h} />
                              </div>
                              <span>{displayName(h.name)}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 font-sans text-xs text-muted">{h.role}</td>
                          <td className="px-3 py-2.5 font-sans text-xs text-dim">
                            <div className="flex items-center gap-1.5">
                              <span className="rounded bg-panel-2 px-1.5 py-0.5 font-medium text-ink/80">
                                {h.main_pro_lane || h.lane}
                              </span>
                              {includeFlex &&
                                selectedLane !== "ALL" &&
                                h.main_pro_lane?.toLowerCase() !== selectedLane.toLowerCase() && (
                                  <span className="rounded border border-purple-500/40 bg-purple-500/20 px-1 py-0.5 text-[9px] font-bold text-purple-300">
                                    FLEX
                                  </span>
                                )}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right font-bold text-ink">
                            {typeof h.presence_rate === "number" ? `${h.presence_rate.toFixed(1)}%` : "-"}
                          </td>
                          <td className="px-3 py-2.5 text-right text-muted">
                            {typeof h.pick_rate === "number" ? `${h.pick_rate.toFixed(1)}%` : "-"}
                          </td>
                          <td className="px-3 py-2.5 text-right text-muted">
                            {typeof h.ban_rate === "number" ? `${h.ban_rate.toFixed(1)}%` : "-"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-bold">
                            <span
                              className={
                                typeof h.win_rate === "number"
                                  ? h.win_rate >= 55
                                    ? "text-emerald-400"
                                    : h.win_rate >= 50
                                      ? "text-blue-400"
                                      : "text-zinc-400"
                                  : "text-dim"
                              }
                            >
                              {typeof h.win_rate === "number" ? `${h.win_rate.toFixed(1)}%` : "-"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs text-dim">
                            {typeof h.total_picks === "number" && typeof h.total_bans === "number"
                              ? `${h.total_picks}P / ${h.total_bans}B`
                              : "-"}
                          </td>
                          <td className="max-w-xs truncate py-2.5 pl-3 pr-4 font-sans text-[11px] text-dim">
                            {h.tier_reason || "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Hero Detail Modal */}
      {inspectHero && (
        <Modal
          labelledBy="hero-inspect-title"
          className="max-w-md p-5"
          onClose={() => setInspectHero(null)}
        >
          <div className="flex items-start gap-4">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-line bg-bg shadow-md">
              <HeroPortrait name={inspectHero.name} hero={inspectHero} />
              {typeof inspectHero.rank === "number" && inspectHero.rank <= 130 && (
                <div className="absolute left-0 top-0 rounded-br bg-black/90 px-1.5 py-0.5 font-mono text-[10px] font-bold text-gold">
                  #{inspectHero.rank}
                </div>
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 id="hero-inspect-title" className="font-display text-xl font-bold tracking-wide text-ink">
                  {displayName(inspectHero.name)}
                </h3>
                <span
                  className={`rounded border px-2 py-0.5 text-xs font-black ${
                    (TIER_META[inspectHero.tier] ?? TIER_META.C).badge
                  }`}
                >
                  {inspectHero.tier}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                <span>{inspectHero.role}</span>
                <span>•</span>
                <span className="font-semibold text-gold">
                  {inspectHero.main_pro_lane || inspectHero.lane}
                </span>
              </div>
              {inspectHero.lane &&
                inspectHero.main_pro_lane &&
                inspectHero.lane !== inspectHero.main_pro_lane && (
                  <div className="mt-1 text-[11px] text-purple-300">
                    <span className="text-dim">Flex Positions: </span>
                    <span className="font-medium">{inspectHero.lane}</span>
                  </div>
                )}
              {inspectHero.name !== displayName(inspectHero.name) && (
                <div className="mt-0.5 text-[10px] text-dim">
                  Global Alias: {inspectHero.name}
                </div>
              )}
            </div>
          </div>

          {/* Pro Stats Grid */}
          <div className="mt-4 grid grid-cols-4 gap-2 rounded border border-line bg-bg p-3 text-center font-mono">
            <div>
              <div className="text-[9px] font-semibold text-dim uppercase">PRESENCE</div>
              <div className="mt-1 text-sm font-bold text-ink">
                {typeof inspectHero.presence_rate === "number" ? `${inspectHero.presence_rate.toFixed(1)}%` : "-"}
              </div>
            </div>
            <div>
              <div className="text-[9px] font-semibold text-dim uppercase">PICK RATE</div>
              <div className="mt-1 text-sm font-bold text-ink">
                {typeof inspectHero.pick_rate === "number" ? `${inspectHero.pick_rate.toFixed(1)}%` : "-"}
              </div>
            </div>
            <div>
              <div className="text-[9px] font-semibold text-dim uppercase">BAN RATE</div>
              <div className="mt-1 text-sm font-bold text-ink">
                {typeof inspectHero.ban_rate === "number" ? `${inspectHero.ban_rate.toFixed(1)}%` : "-"}
              </div>
            </div>
            <div>
              <div className="text-[9px] font-semibold text-dim uppercase">WIN RATE</div>
              <div
                className={`mt-1 text-sm font-bold ${
                  (inspectHero.win_rate ?? 50) >= 55
                    ? "text-emerald-400"
                    : (inspectHero.win_rate ?? 50) >= 50
                      ? "text-blue-400"
                      : "text-zinc-400"
                }`}
              >
                {typeof inspectHero.win_rate === "number" ? `${inspectHero.win_rate.toFixed(1)}%` : "-"}
              </div>
            </div>
          </div>

          {/* Games Count */}
          {(typeof inspectHero.total_picks === "number" || typeof inspectHero.total_bans === "number") && (
            <div className="mt-2 flex items-center justify-between rounded border border-line/60 bg-panel-2/40 px-3 py-1.5 font-mono text-[11px] text-muted">
              <span>Pro Games (2026):</span>
              <span className="font-semibold text-ink">
                {inspectHero.total_picks ?? 0} Picks / {inspectHero.total_bans ?? 0} Bans
              </span>
            </div>
          )}

          {/* Rationale / Note */}
          {inspectHero.tier_reason && (
            <div className="mt-3 rounded border border-gold/30 bg-gold/5 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-gold">
                <Info className="h-3.5 w-3.5" />
                <span>Meta Tuning Rationale:</span>
              </div>
              <p className="mt-1 text-xs text-ink/90 leading-relaxed">
                {inspectHero.tier_reason}
              </p>
            </div>
          )}

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => setInspectHero(null)}
              className="rounded border border-line bg-panel-2 px-4 py-1.5 text-xs font-semibold text-muted hover:border-gold hover:text-ink"
            >
              ปิด
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

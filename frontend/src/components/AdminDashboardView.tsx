import {
  ArrowLeft,
  ArrowUpDown,
  BarChart3,
  Coins,
  Globe,
  RefreshCw,
  Repeat,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, getJson } from "../api/client";
import { useLanguage } from "../i18n/language";
import type { AdminStatsResponse, AdminUserActivityItem, AdminUsersResponse } from "../types/auth";

interface AdminDashboardViewProps {
  onBack: () => void;
}

type UserFilterMode = "all" | "returning" | "draft_saved" | "practice_played" | "willing" | "not_willing";
type SortColumn = "active_days" | "saved_series_games" | "practice_games" | "predict_calls" | "last_activity" | "created_at";

const INITIAL_VISIBLE_USERS = 50;

function lastActivityKey(u: AdminUserActivityItem): string {
  return [u.last_draft_save_th ?? "", u.last_practice_save_th ?? "", u.last_visit ?? "", u.created_at_th ?? ""]
    .sort()
    .reverse()[0] ?? "";
}

export function AdminDashboardView({ onBack }: AdminDashboardViewProps) {
  const { t } = useLanguage();
  const [stats, setStats] = useState<AdminStatsResponse | null>(null);
  const [usersReport, setUsersReport] = useState<AdminUsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filterMode, setFilterMode] = useState<UserFilterMode>("all");
  const [sortBy, setSortBy] = useState<SortColumn>("active_days");
  const [sortDesc, setSortDesc] = useState(true);
  const [showAllUsers, setShowAllUsers] = useState(false);
  const [refererRange, setRefererRange] = useState<"today" | "7d">("today");

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, usersRes] = await Promise.all([
        getJson<AdminStatsResponse>("/admin/stats"),
        getJson<AdminUsersResponse>("/admin/users"),
      ]);
      setStats(statsRes);
      setUsersReport(usersRes);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
        setStats(null);
        setUsersReport(null);
      }
      setError(err instanceof Error ? err.message : "ไม่สามารถโหลดข้อมูล Dashboard ได้");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([
      getJson<AdminStatsResponse>("/admin/stats", ctrl.signal),
      getJson<AdminUsersResponse>("/admin/users", ctrl.signal),
    ])
      .then(([statsRes, usersRes]) => {
        if (ctrl.signal.aborted) return;
        setStats(statsRes);
        setUsersReport(usersRes);
        setError(null);
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
          setStats(null);
          setUsersReport(null);
        }
        setError(err instanceof Error ? err.message : "ไม่สามารถโหลดข้อมูล Dashboard ได้");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, []);

  const toggleSort = (col: SortColumn) => {
    if (sortBy === col) {
      setSortDesc((d) => !d);
    } else {
      setSortBy(col);
      setSortDesc(true);
    }
  };

  const filteredUsers = useMemo(() => {
    const list = usersReport?.users ?? [];
    const q = query.trim().toLowerCase();
    const matched = list.filter((u) => {
      if (filterMode === "returning" && u.active_days < 2) return false;
      if (filterMode === "draft_saved" && u.saved_series_games < 1) return false;
      if (filterMode === "practice_played" && u.practice_games < 1) return false;
      if (filterMode === "willing" && u.survey_choice !== "willing") return false;
      if (filterMode === "not_willing" && u.survey_choice !== "not_willing") return false;
      if (q) {
        const hay = `${u.username} ${u.display_name} ${u.email ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return [...matched].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "active_days") {
        cmp = a.active_days - b.active_days || a.saved_series_games + a.practice_games - (b.saved_series_games + b.practice_games);
      } else if (sortBy === "saved_series_games") {
        cmp = a.saved_series_games - b.saved_series_games || a.active_days - b.active_days;
      } else if (sortBy === "practice_games") {
        cmp = a.practice_games - b.practice_games || a.active_days - b.active_days;
      } else if (sortBy === "predict_calls") {
        cmp = a.predict_calls - b.predict_calls || a.saved_series_games - b.saved_series_games;
      } else if (sortBy === "last_activity") {
        cmp = lastActivityKey(a).localeCompare(lastActivityKey(b));
      } else {
        cmp = a.created_at_th.localeCompare(b.created_at_th);
      }
      if (cmp === 0) cmp = a.id - b.id;
      return sortDesc ? -cmp : cmp;
    });
  }, [usersReport, query, filterMode, sortBy, sortDesc]);

  const visibleUsers = showAllUsers ? filteredUsers : filteredUsers.slice(0, INITIAL_VISIBLE_USERS);
  const estimatedGuests =
    stats?.cloudflare && stats.cloudflare.total_uniques > stats.users.total
      ? stats.cloudflare.total_uniques - stats.users.total
      : null;

  const sortHeaderBtn = (col: SortColumn, label: string, alignRight = true) => (
    <button
      type="button"
      onClick={() => toggleSort(col)}
      className={`inline-flex items-center gap-1 font-display text-[11px] font-bold tracking-wide transition-colors hover:text-gold ${
        alignRight ? "justify-end" : "justify-start"
      } ${sortBy === col ? "text-gold" : "text-muted"}`}
    >
      <span>{label}</span>
      <ArrowUpDown className="h-3 w-3 shrink-0" />
    </button>
  );

  return (
    <main className="mx-auto flex w-full max-w-[1680px] flex-1 flex-col gap-4 overflow-y-auto px-3 py-4 sm:px-6">
      {/* Top Toolbar */}
      <header className="flex flex-wrap items-center justify-between gap-3 border border-line bg-panel px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <BarChart3 className="h-5 w-5 shrink-0 text-gold" />
          <div className="min-w-0">
            <h1 className="truncate font-display text-base font-extrabold tracking-wider text-ink sm:text-lg">
              OWNER ANALYTICS DASHBOARD · MINIDRAFT
            </h1>
            <p className="font-mono text-[11px] text-dim">
              {usersReport ? `อัปเดตล่าสุด: ${usersReport.generated_at_th} (UTC+7)` : t("กำลังโหลดข้อมูล...")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleRefresh()}
            className="inline-flex h-8 items-center gap-1.5 border border-line-strong bg-panel-2 px-3 font-display text-xs font-semibold text-ink transition-colors hover:border-gold/60 hover:text-gold disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-gold ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-8 items-center gap-1.5 border border-gold/50 bg-gold/10 px-3 font-display text-xs font-bold text-gold transition-colors hover:bg-gold hover:text-bg"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>กลับหน้า Draft</span>
          </button>
        </div>
      </header>

      {error && <div className="border border-red/40 bg-red/10 px-4 py-2.5 text-xs text-red">{t(error)}</div>}

      {/* Top KPI Cards */}
      {stats && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="border border-line bg-panel p-3.5">
            <div className="flex items-center justify-between text-xs text-muted">
              <span className="font-display font-bold">สมาชิกทั้งหมด</span>
              <Users className="h-4 w-4 text-blue" />
            </div>
            <div className="mt-1 font-mono text-2xl font-extrabold text-ink">{stats.users.total.toLocaleString()}</div>
            <div className="mt-1 font-mono text-[11px] text-dim">
              วันนี้ +{stats.users.new_today} · Google {stats.users.google} · Discord {stats.users.discord}
            </div>
          </div>

          <div className="border border-line bg-panel p-3.5">
            <div className="flex items-center justify-between text-xs text-muted">
              <span className="font-display font-bold">กลับมาใช้ซ้ำ (Retention)</span>
              <Repeat className="h-4 w-4 text-good" />
            </div>
            <div className="mt-1 font-mono text-2xl font-extrabold text-good">
              {stats.retention ? `${stats.retention.returning_clients.toLocaleString()} เครื่อง` : "-"}
            </div>
            <div className="mt-1 font-mono text-[11px] text-dim">
              {stats.retention
                ? `วันนี้ ${stats.retention.today_dau} (ซ้ำ ${stats.retention.today_returning}) · D1 ${stats.retention.d1_pct}%`
                : "ไม่มีข้อมูล"}
            </div>
          </div>

          <div className="border border-line bg-panel p-3.5">
            <div className="flex items-center justify-between text-xs text-muted">
              <span className="font-display font-bold">Cloudflare Uniques</span>
              <Globe className="h-4 w-4 text-gold" />
            </div>
            <div className="mt-1 font-mono text-2xl font-extrabold text-gold">
              {stats.cloudflare ? stats.cloudflare.total_uniques.toLocaleString() : "-"}
            </div>
            <div className="mt-1 font-mono text-[11px] text-dim">
              {stats.cloudflare
                ? `วันนี้ ${stats.cloudflare.today_uniques.toLocaleString()} คน · Guest ~${estimatedGuests?.toLocaleString() ?? "-"}`
                : "Cloudflare token ไม่ได้ตั้งค่า"}
            </div>
          </div>

          <div className="border border-line bg-panel p-3.5">
            <div className="flex items-center justify-between text-xs text-muted">
              <span className="font-display font-bold">ผลสำรวจความพร้อมจ่าย</span>
              <Coins className="h-4 w-4 text-gold" />
            </div>
            <div className="mt-1 font-mono text-2xl font-extrabold text-ink">
              {stats.survey.willing_pct}%{" "}
              <span className="text-xs font-normal text-muted">
                ({stats.survey.willing_total}/{stats.survey.total})
              </span>
            </div>
            <div className="mt-1 font-mono text-[11px] text-dim">
              สมาชิกพร้อม {stats.survey.willing_member} · Guest {stats.survey.willing_guest}
            </div>
          </div>
        </section>
      )}

      {/* Power Users & User Activity Table */}
      <section className="flex flex-col gap-3 border border-line bg-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-gold" />
            <h2 className="font-display text-sm font-bold tracking-wide text-ink sm:text-base">
              อันดับการใช้งานรายบัญชี ({filteredUsers.length.toLocaleString()} / {usersReport?.total_users ?? 0})
            </h2>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-dim" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหา @username, ชื่อ, email..."
              className="h-8 w-full border border-line-strong bg-bg pr-3 pl-8 font-mono text-xs text-ink placeholder:text-dim focus:border-gold focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ["all", "ทั้งหมด"],
              ["returning", "เข้าซ้ำ 2+ วัน"],
              ["draft_saved", "เซฟ Draft 1+ เกม"],
              ["practice_played", "เล่น vs AI"],
              ["willing", "พร้อมจ่าย"],
              ["not_willing", "ไม่พร้อม"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilterMode(key)}
              className={`h-7 border px-2.5 font-display text-[11px] font-semibold transition-colors ${
                filterMode === key
                  ? "border-gold bg-gold font-bold text-bg"
                  : "border-line-strong bg-bg text-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto border border-line bg-bg/50">
          <table className="w-full min-w-[900px] border-collapse text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-line bg-panel-2/70">
                <th className="px-3 py-2 text-[11px] font-bold text-dim">#</th>
                <th className="px-3 py-2 text-[11px] font-bold text-muted">บัญชี / ชื่อ / Email</th>
                <th className="px-3 py-2 text-right">{sortHeaderBtn("active_days", "วันใช้งาน")}</th>
                <th className="px-3 py-2 text-right">{sortHeaderBtn("saved_series_games", "Draft (เกม)")}</th>
                <th className="px-3 py-2 text-right">{sortHeaderBtn("practice_games", "vs AI (เกม)")}</th>
                <th className="px-3 py-2 text-right">{sortHeaderBtn("predict_calls", "เรียก AI")}</th>
                <th className="px-3 py-2 text-center text-[11px] font-bold text-muted">แบบสอบถาม</th>
                <th className="px-3 py-2 text-right">{sortHeaderBtn("last_activity", "ใช้งานล่าสุด")}</th>
                <th className="px-3 py-2 text-right">{sortHeaderBtn("created_at", "สมัครเมื่อ")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visibleUsers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-dim">
                    {loading ? "กำลังโหลดรายชื่อผู้ใช้..." : "ไม่พบบัญชีที่ตรงกับตัวกรอง"}
                  </td>
                </tr>
              ) : (
                visibleUsers.map((u, idx) => (
                  <tr key={u.id} className="hover:bg-panel-2/40">
                    <td className="px-3 py-2 text-dim">{idx + 1}</td>
                    <td className="max-w-[300px] px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-bold text-gold">@{u.username}</span>
                        <span className="shrink-0 border border-line bg-panel px-1 py-0 text-[9px] text-muted uppercase">
                          {u.auth_provider}
                        </span>
                      </div>
                      <div className="truncate text-[11px] text-ink">{u.display_name}</div>
                      {u.email && <div className="truncate text-[10px] text-dim">{u.email}</div>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={u.active_days >= 2 ? "font-extrabold text-good" : "text-ink"}>
                        {u.active_days}
                      </span>
                      {u.last_visit && <div className="text-[10px] text-dim">{u.last_visit.slice(5)}</div>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={u.saved_series_games > 0 ? "font-bold text-blue" : "text-dim"}>
                        {u.saved_series_games}
                      </span>
                      {u.draft_step_index > 0 && (
                        <div className="text-[10px] text-dim">step {u.draft_step_index}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={u.practice_games > 0 ? "font-bold text-gold" : "text-dim"}>
                        {u.practice_games}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={u.predict_calls > 0 ? "font-bold text-ink" : "text-dim"}>
                        {u.predict_calls.toLocaleString()}
                      </span>
                      {u.draft_save_calls > 0 && (
                        <div className="text-[10px] text-dim">save {u.draft_save_calls}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {u.survey_choice === "willing" ? (
                        <span className="border border-good/40 bg-good/15 px-1.5 py-0.5 text-[10px] font-bold text-good">
                          พร้อมจ่าย
                        </span>
                      ) : u.survey_choice === "not_willing" ? (
                        <span className="border border-line-strong bg-panel-2 px-1.5 py-0.5 text-[10px] text-muted">
                          ไม่พร้อม
                        </span>
                      ) : (
                        <span className="text-dim">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-[11px] text-muted">
                      {lastActivityKey(u).slice(5, 16) || "-"}
                    </td>
                    <td className="px-3 py-2 text-right text-[11px] text-dim">{u.created_at_th.slice(5, 16)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {filteredUsers.length > INITIAL_VISIBLE_USERS && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setShowAllUsers((prev) => !prev)}
              className="border border-line-strong bg-panel-2 px-4 py-1.5 font-display text-xs font-semibold text-ink transition-colors hover:border-gold/60 hover:text-gold"
            >
              {showAllUsers
                ? `ย่อแสดง ${INITIAL_VISIBLE_USERS} อันดับแรก`
                : `แสดงทั้งหมด (${filteredUsers.length.toLocaleString()} บัญชี)`}
            </button>
          </div>
        )}
      </section>

      {/* Bottom 2 Columns: Returning Unlinked Guests + Cloudflare Sources / Retention Daily */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-2.5 border border-line bg-panel p-4">
          <h2 className="font-display text-sm font-bold tracking-wide text-ink">
            เครื่อง Guest ที่ใช้งานบ่อย (ไม่ได้ล็อกอิน)
          </h2>
          <div className="max-h-72 overflow-y-auto border border-line bg-bg/50">
            <table className="w-full border-collapse text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-line bg-panel-2/70 text-[11px] text-muted">
                  <th className="px-3 py-2">Client ID</th>
                  <th className="px-3 py-2 text-right">วันใช้งาน</th>
                  <th className="px-3 py-2 text-right">ครั้งแรก</th>
                  <th className="px-3 py-2 text-right">ล่าสุด</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(usersReport?.top_guest_clients ?? []).map((g) => (
                  <tr key={g.client_id} className="hover:bg-panel-2/40">
                    <td className="px-3 py-1.5 text-ink">{g.client_id}</td>
                    <td className="px-3 py-1.5 text-right font-bold text-good">{g.active_days}</td>
                    <td className="px-3 py-1.5 text-right text-dim">{g.first_visit?.slice(5) ?? "-"}</td>
                    <td className="px-3 py-1.5 text-right text-muted">{g.last_visit?.slice(5) ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {stats?.cloudflare && (
          <section className="flex flex-col gap-2.5 border border-line bg-panel p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-bold tracking-wide text-ink">
                ช่องทางที่คนกดเข้ามา (Top Sources)
              </h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setRefererRange("today")}
                  className={`border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                    refererRange === "today"
                      ? "border-gold/60 bg-gold/15 text-gold"
                      : "border-line bg-bg text-muted hover:text-ink"
                  }`}
                >
                  วันนี้
                </button>
                <button
                  type="button"
                  onClick={() => setRefererRange("7d")}
                  className={`border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                    refererRange === "7d"
                      ? "border-gold/60 bg-gold/15 text-gold"
                      : "border-line bg-bg text-muted hover:text-ink"
                  }`}
                >
                  7 วัน
                </button>
              </div>
            </div>
            {(() => {
              const items =
                refererRange === "today"
                  ? (stats.cloudflare.referers_today ?? [])
                  : (stats.cloudflare.referers_7d ?? []);
              const total = items.reduce((acc, item) => acc + item.visits, 0);
              return (
                <div className="flex flex-col gap-1.5 border border-line bg-bg/50 p-3">
                  {items.length === 0 ? (
                    <div className="py-4 text-center font-mono text-xs text-dim">ยังไม่มีข้อมูลช่องทาง</div>
                  ) : (
                    items.map((item) => {
                      const pct = total > 0 ? Math.round((item.visits / total) * 100) : 0;
                      return (
                        <div key={item.source} className="flex items-center gap-2 font-mono text-[11px]">
                          <span className="w-36 shrink-0 truncate text-ink">{item.source}</span>
                          <div className="h-2 flex-1 overflow-hidden bg-panel-2">
                            <div className="h-full bg-gold/80" style={{ width: `${Math.max(4, pct)}%` }} />
                          </div>
                          <span className="w-20 shrink-0 text-right text-muted">
                            {item.visits.toLocaleString()} ({pct}%)
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })()}
          </section>
        )}
      </div>
    </main>
  );
}

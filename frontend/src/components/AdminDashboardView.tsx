import {
  Activity,
  ArrowLeft,
  ArrowUpDown,
  BarChart3,
  BookOpen,
  Coins,
  Cpu,
  Globe,
  RefreshCw,
  Repeat,
  Search,
  ShieldCheck,
  Sigma,
  Sparkles,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, getJson } from "../api/client";
import { useLanguage } from "../i18n/language";
import type {
  AdminAnalyticsResponse,
  AdminStatsResponse,
  AdminUserActivityItem,
  AdminUsersResponse,
  GuardrailPowerSummary,
  KaplanMeierPoint,
} from "../types/auth";

interface AdminDashboardViewProps {
  onBack: () => void;
}

type UserFilterMode = "all" | "returning" | "draft_saved" | "practice_played" | "willing" | "not_willing";
type SortColumn =
  | "active_days"
  | "saved_series_games"
  | "practice_games"
  | "predict_calls"
  | "p_alive"
  | "last_activity"
  | "created_at";

const INITIAL_VISIBLE_USERS = 50;

const FEATURE_LABELS_TH: Record<string, string> = {
  active_days: "เข้าเว็บซ้ำ (2+ วัน)",
  predict_calls: "กดเรียก AI ช่วยคิด (5+ ครั้ง)",
  draft_games: "เซฟเกมดราฟต์ไว้ (1+ เกม)",
  practice_games: "เล่นโหมดซ้อม vs AI (1+ เกม)",
  oauth_linked: "ล็อกอิน Google / Discord",
  tenure_days: "สมัครมานานกว่า 1 วัน",
};

const MARKOV_STATE_LABELS_TH: Record<string, string> = {
  "New (D0)": "เข้าเว็บวันแรก",
  "Active (D1+)": "เคยกลับมาใช้แล้ว",
  Dormant: "เคยเงียบหายไป",
};

function lastActivityKey(u: AdminUserActivityItem): string {
  return (
    [u.last_draft_save_th ?? "", u.last_practice_save_th ?? "", u.last_visit ?? "", u.created_at_th ?? ""]
      .sort()
      .reverse()[0] ?? ""
  );
}

function PowerBadge({ summary }: { summary?: GuardrailPowerSummary }) {
  if (!summary) return null;
  let label = `ข้อมูลยังไม่พอสรุป (ต้องรอ ~${summary.required_n_per_arm_mde10} คน/กลุ่ม)`;
  let cls = "border-gold/40 bg-gold/10 text-gold";
  if (summary.status === "reliable_significant") {
    label = `มั่นใจได้ทางสถิติ (${summary.achieved_power_pct}%)`;
    cls = "border-good/50 bg-good/15 text-good";
  } else if (summary.status === "significant_moderate_power") {
    label = `ผลเริ่มชัด (p=${summary.p_value ?? "-"})`;
    cls = "border-blue/50 bg-blue/15 text-blue";
  } else if (summary.status === "no_material_effect") {
    label = "ข้อมูลพอแล้ว: แทบไม่ต่างกัน";
    cls = "border-line-strong bg-panel-2 text-muted";
  }
  return <span className={`border px-1.5 py-0.5 font-mono text-[9px] font-bold ${cls}`}>{label}</span>;
}

function ConfidenceIntervalBar({
  label,
  ratePct,
  ci,
  bayesPct,
  n,
  willing,
  accentClass = "bg-gold",
}: {
  label: string;
  ratePct: number;
  ci: [number, number];
  bayesPct?: number;
  n: number;
  willing: number;
  accentClass?: string;
}) {
  const lo = Math.max(0, Math.min(100, ci[0]));
  const hi = Math.max(lo, Math.min(100, ci[1]));
  const pt = Math.max(0, Math.min(100, ratePct));
  return (
    <div className="flex flex-col gap-1 border border-line bg-panel p-2 font-mono text-[10px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-ink">{label}</span>
        <span className="text-muted">
          <strong className="text-ink">{ratePct}%</strong> ({willing}/{n} คน)
          {bayesPct !== undefined && <span className="text-dim"> · ปรับฐาน {bayesPct}%</span>}
        </span>
      </div>
      <div className="relative h-2.5 w-full bg-bg">
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 bg-line-strong"
          style={{ left: `${lo}%`, width: `${Math.max(1.5, hi - lo)}%` }}
        />
        <div
          className={`absolute top-1/2 h-2.5 w-1.5 -translate-x-1/2 -translate-y-1/2 ${accentClass}`}
          style={{ left: `${pt}%` }}
        />
      </div>
      <div className="flex justify-between text-[9px] text-dim">
        <span>0%</span>
        <span>
          ค่าจริงที่น่าจะเป็นไปได้: [{lo}% – {hi}%]
        </span>
        <span>100%</span>
      </div>
    </div>
  );
}

function KaplanMeierChart({ member, guest }: { member: KaplanMeierPoint[]; guest: KaplanMeierPoint[] }) {
  const maxDay = Math.max(1, member[member.length - 1]?.day ?? 0, guest[guest.length - 1]?.day ?? 0);
  const W = 440;
  const H = 150;
  const padL = 34;
  const padR = 14;
  const padT = 12;
  const padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const toX = (day: number) => padL + (day / maxDay) * plotW;
  const toY = (pct: number) => padT + ((100 - Math.max(0, Math.min(100, pct))) / 100) * plotH;

  const buildPolyline = (pts: KaplanMeierPoint[]) =>
    pts.map((p) => `${toX(p.day).toFixed(1)},${toY(p.survival_pct).toFixed(1)}`).join(" ");

  const buildBand = (pts: KaplanMeierPoint[]) => {
    if (pts.length < 2) return "";
    const upper = pts.map((p) => `${toX(p.day).toFixed(1)},${toY(p.ci_high).toFixed(1)}`);
    const lower = [...pts].reverse().map((p) => `${toX(p.day).toFixed(1)},${toY(p.ci_low).toFixed(1)}`);
    return [...upper, ...lower].join(" ");
  };

  const dayTicks = Array.from({ length: maxDay + 1 }, (_, i) => i).filter(
    (d) => maxDay <= 7 || d === 0 || d === maxDay || d % Math.ceil(maxDay / 5) === 0,
  );

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-36 w-full select-none"
      role="img"
      aria-label="กราฟสัดส่วนคนที่ยังกลับมาใช้งานเทียบ สมาชิก vs Guest"
    >
      {[0, 25, 50, 75, 100].map((yVal) => {
        const y = toY(yVal);
        return (
          <g key={yVal}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="rgba(255,255,255,0.08)" strokeDasharray="2 3" />
            <text x={padL - 5} y={y + 3} textAnchor="end" fill="#8b96a8" fontSize="9" fontFamily="monospace">
              {yVal}%
            </text>
          </g>
        );
      })}
      {dayTicks.map((d) => {
        const x = toX(d);
        return (
          <text key={d} x={x} y={H - 6} textAnchor="middle" fill="#8b96a8" fontSize="9" fontFamily="monospace">
            วันที่ {d}
          </text>
        );
      })}

      {guest.length >= 2 && <polygon points={buildBand(guest)} fill="rgba(201,158,64,0.12)" />}
      {member.length >= 2 && <polygon points={buildBand(member)} fill="rgba(56,152,236,0.14)" />}

      {guest.length >= 2 && (
        <polyline fill="none" stroke="#c99e40" strokeWidth="2" strokeDasharray="4 2" points={buildPolyline(guest)} />
      )}
      {member.length >= 2 && <polyline fill="none" stroke="#3898ec" strokeWidth="2.2" points={buildPolyline(member)} />}

      {guest.map((p) => (
        <circle key={`g-${p.day}`} cx={toX(p.day)} cy={toY(p.survival_pct)} r="2.6" fill="#c99e40" />
      ))}
      {member.map((p) => (
        <circle key={`m-${p.day}`} cx={toX(p.day)} cy={toY(p.survival_pct)} r="2.8" fill="#3898ec" />
      ))}
    </svg>
  );
}

export function AdminDashboardView({ onBack }: AdminDashboardViewProps) {
  const { t } = useLanguage();
  const [stats, setStats] = useState<AdminStatsResponse | null>(null);
  const [usersReport, setUsersReport] = useState<AdminUsersResponse | null>(null);
  const [analytics, setAnalytics] = useState<AdminAnalyticsResponse | null>(null);
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
      const [statsRes, usersRes, analyticsRes] = await Promise.all([
        getJson<AdminStatsResponse>("/admin/stats"),
        getJson<AdminUsersResponse>("/admin/users"),
        getJson<AdminAnalyticsResponse>("/admin/analytics"),
      ]);
      setStats(statsRes);
      setUsersReport(usersRes);
      setAnalytics(analyticsRes);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
        setStats(null);
        setUsersReport(null);
        setAnalytics(null);
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
      getJson<AdminAnalyticsResponse>("/admin/analytics", ctrl.signal),
    ])
      .then(([statsRes, usersRes, analyticsRes]) => {
        if (ctrl.signal.aborted) return;
        setStats(statsRes);
        setUsersReport(usersRes);
        setAnalytics(analyticsRes);
        setError(null);
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
          setStats(null);
          setUsersReport(null);
          setAnalytics(null);
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

  const userScores = useMemo(() => analytics?.user_btyd_scores ?? {}, [analytics]);

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
        cmp =
          a.active_days - b.active_days ||
          a.saved_series_games + a.practice_games - (b.saved_series_games + b.practice_games);
      } else if (sortBy === "saved_series_games") {
        cmp = a.saved_series_games - b.saved_series_games || a.active_days - b.active_days;
      } else if (sortBy === "practice_games") {
        cmp = a.practice_games - b.practice_games || a.active_days - b.active_days;
      } else if (sortBy === "predict_calls") {
        cmp = a.predict_calls - b.predict_calls || a.saved_series_games - b.saved_series_games;
      } else if (sortBy === "p_alive") {
        const sa = userScores[String(a.id)]?.p_alive_pct ?? 0;
        const sb = userScores[String(b.id)]?.p_alive_pct ?? 0;
        cmp = sa - sb || (userScores[String(a.id)]?.behavior_score ?? 0) - (userScores[String(b.id)]?.behavior_score ?? 0);
      } else if (sortBy === "last_activity") {
        cmp = lastActivityKey(a).localeCompare(lastActivityKey(b));
      } else {
        cmp = a.created_at_th.localeCompare(b.created_at_th);
      }
      if (cmp === 0) cmp = a.id - b.id;
      return sortDesc ? -cmp : cmp;
    });
  }, [usersReport, query, filterMode, sortBy, sortDesc, userScores]);

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

  const btyd = analytics?.btyd_alive;
  const btydTotal = Math.max(1, btyd?.total_clients ?? 1);
  const kmMember = analytics?.kaplan_meier_survival?.member ?? [];
  const kmGuest = analytics?.kaplan_meier_survival?.guest ?? [];
  const aiTrustLiftVsRandom =
    analytics && analytics.ai_trust.random_top5_baseline_pct > 0
      ? (analytics.ai_trust.top5_pct / analytics.ai_trust.random_top5_baseline_pct).toFixed(1)
      : null;

  return (
    <main className="mx-auto flex w-full max-w-[1680px] flex-1 flex-col gap-4 overflow-y-auto px-3 py-4 sm:px-6">
      {/* Top Toolbar */}
      <header className="flex flex-wrap items-center justify-between gap-3 border border-line bg-panel px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <BarChart3 className="h-5 w-5 shrink-0 text-gold" />
          <div className="min-w-0">
            <h1 className="truncate font-display text-base font-extrabold tracking-wider text-ink sm:text-lg">
              แดชบอร์ดเจ้าของเว็บ · MINIDRAFT
            </h1>
            <p className="font-mono text-[11px] text-dim">
              {usersReport ? `อัปเดตล่าสุด: ${usersReport.generated_at_th} (เวลาไทย)` : t("กำลังโหลดข้อมูล...")}
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
            <span>รีเฟรช</span>
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
              <span className="font-display font-bold">กลับมาใช้ซ้ำ (ไม่ลืมเว็บ)</span>
              <Repeat className="h-4 w-4 text-good" />
            </div>
            <div className="mt-1 font-mono text-2xl font-extrabold text-good">
              {stats.retention ? `${stats.retention.returning_clients.toLocaleString()} เครื่อง` : "-"}
            </div>
            <div className="mt-1 font-mono text-[11px] text-dim">
              {stats.retention
                ? `วันนี้ ${stats.retention.today_dau} (ซ้ำ ${stats.retention.today_returning}) · กลับมาพรุ่งนี้ ${stats.retention.d1_pct}%`
                : "ไม่มีข้อมูล"}
            </div>
          </div>

          <div className="border border-line bg-panel p-3.5">
            <div className="flex items-center justify-between text-xs text-muted">
              <span className="font-display font-bold">คนเข้าเว็บทั้งหมด</span>
              <Globe className="h-4 w-4 text-gold" />
            </div>
            <div className="mt-1 font-mono text-2xl font-extrabold text-gold">
              {stats.cloudflare ? stats.cloudflare.total_uniques.toLocaleString() : "-"}
            </div>
            <div className="mt-1 font-mono text-[11px] text-dim">
              {stats.cloudflare
                ? `วันนี้ ${stats.cloudflare.today_uniques.toLocaleString()} คน · ไม่ล็อกอิน ~${estimatedGuests?.toLocaleString() ?? "-"}`
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
                ({stats.survey.willing_total}/{stats.survey.total} คน)
              </span>
            </div>
            <div className="mt-1 font-mono text-[11px] text-dim">
              สมาชิกพร้อม {stats.survey.willing_member} · ขาจร {stats.survey.willing_guest}
            </div>
          </div>
        </section>
      )}

      {/* Plain-Thai Behavior & AI Summary Section */}
      {analytics && (
        <section className="flex flex-col gap-3 border border-gold/35 bg-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sigma className="h-4 w-4 text-gold" />
              <h2 className="font-display text-sm font-bold tracking-wide text-ink sm:text-base">
                สรุปวิเคราะห์พฤติกรรมผู้ใช้ &amp; ความแม่นยำ AI (แปลผลให้อ่านง่าย)
              </h2>
            </div>
            <span className="border border-gold/40 bg-gold/10 px-2 py-0.5 font-mono text-[10px] font-bold text-gold">
              วิเคราะห์จากข้อมูลใช้งานจริง
            </span>
          </div>

          {/* Row 1: 3 Core Plain-Thai Insight Cards */}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            {/* Card 1: Tomorrow Return Probability */}
            <div className="flex flex-col gap-2 border border-line bg-bg/60 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-xs font-bold text-good">
                  1. โอกาสที่คนจะกลับมาใช้วันพรุ่งนี้
                </span>
                <span className="font-mono text-[10px] text-dim">
                  14 วันข้างหน้าใช้เฉลี่ย{" "}
                  {analytics.markov_retention.expected_active_days_14d ??
                    analytics.markov_retention.expected_active_streak_days}{" "}
                  วัน
                </span>
              </div>

              {analytics.markov_retention.matrix_3x3 ? (
                <table className="w-full border-collapse border border-line font-mono text-[10px]">
                  <thead>
                    <tr className="border-b border-line bg-panel text-muted">
                      <th className="px-2 py-1 text-left">กลุ่มผู้ใช้เดิม</th>
                      <th className="px-2 py-1 text-right">วัดจาก</th>
                      <th className="px-2 py-1 text-right text-good">กลับมาวันถัดไป</th>
                      <th className="px-2 py-1 text-right text-dim">เงียบหายไป</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {analytics.markov_retention.matrix_3x3.map((row) => (
                      <tr key={row.from_state} className="bg-panel/40">
                        <td className="px-2 py-1 font-bold text-ink">
                          {MARKOV_STATE_LABELS_TH[row.from_state] ?? row.from_state}
                        </td>
                        <td className="px-2 py-1 text-right text-dim">{row.sample}</td>
                        <td
                          className="px-2 py-1 text-right font-bold text-good"
                          style={{ backgroundColor: `rgba(74, 222, 128, ${Math.min(0.28, row.to_active_pct / 220)})` }}
                        >
                          {row.to_active_pct}%
                        </td>
                        <td
                          className="px-2 py-1 text-right text-muted"
                          style={{ backgroundColor: `rgba(255, 255, 255, ${Math.min(0.08, row.to_dormant_pct / 900)})` }}
                        >
                          {row.to_dormant_pct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}

              <div className="border-l-2 border-good/60 bg-panel/60 px-2.5 py-1.5 font-mono text-[10px] text-ink">
                <strong className="text-good">สรุปให้:</strong> คนเข้าวันแรก 100 คน จะกลับมาพรุ่งนี้ ~
                {Math.round(analytics.markov_retention.transitions.new_to_active_pct)} คน · แต่ถ้ากลับมาแล้ว โอกาสใช้ต่อจะเพิ่มเป็น{" "}
                <strong className="text-good">{analytics.markov_retention.transitions.retained_to_active_pct}%</strong>{" "}
                (ระยะยาวเหลือแอคทีฟ ~{analytics.markov_retention.steady_state_active_pct ?? 0}%)
              </div>
            </div>

            {/* Card 2: Do Heavy Users Actually Want to Pay More? */}
            <div className="flex flex-col gap-2 border border-line bg-bg/60 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="font-display text-xs font-bold text-gold">
                  2. คนที่ใช้เว็บจริง ยอมจ่ายมากกว่าขาจรไหม?
                </span>
                <PowerBadge summary={analytics.experiment_guardrails?.wtp_engaged_vs_casual} />
              </div>

              <ConfidenceIntervalBar
                label="กลุ่มใช้จริง (เข้าซ้ำ 2+ วัน / เล่นเกม / เรียก AI 10+)"
                ratePct={analytics.bayesian_wtp.engaged.empirical_pct}
                ci={analytics.bayesian_wtp.engaged.wilson_ci_95}
                bayesPct={analytics.bayesian_wtp.engaged.bayes_posterior_pct}
                n={analytics.bayesian_wtp.engaged.n}
                willing={analytics.bayesian_wtp.engaged.willing}
                accentClass="bg-good"
              />
              <ConfidenceIntervalBar
                label="กลุ่มขาจร (เพิ่งลองเข้าครั้งแรก)"
                ratePct={analytics.bayesian_wtp.casual.empirical_pct}
                ci={analytics.bayesian_wtp.casual.wilson_ci_95}
                bayesPct={analytics.bayesian_wtp.casual.bayes_posterior_pct}
                n={analytics.bayesian_wtp.casual.n}
                willing={analytics.bayesian_wtp.casual.willing}
                accentClass="bg-blue"
              />

              <div className="border-l-2 border-gold/60 bg-panel/60 px-2.5 py-1.5 font-mono text-[10px] text-ink">
                <strong className="text-gold">สรุปให้:</strong>{" "}
                {analytics.bayesian_wtp.engaged_vs_casual_test.significant_95
                  ? `กลุ่มใช้จริงพร้อมจ่ายสูงกว่าขาจรอย่างชัดเจน (+${analytics.bayesian_wtp.engaged_vs_casual_test.diff_pct}%)`
                  : `ตอนนี้ผลต่างกันยังไม่ชัดเจนทางสถิติ (p=${analytics.bayesian_wtp.engaged_vs_casual_test.p_value}) ยังสรุปไม่ได้ว่าใช้เยอะแล้วอยากจ่ายเพิ่ม · ฝั่งไม่ล็อกอินพร้อมจ่าย ${analytics.bayesian_wtp.guests.empirical_pct}%`}
              </div>
            </div>

            {/* Card 3: Active Users Remaining + Member vs Guest Loyalty */}
            <div className="flex flex-col gap-2 border border-line bg-bg/60 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="font-display text-xs font-bold text-blue">
                  3. เหลือคนใช้งานอยู่จริงกี่เครื่อง &amp; สมาชิกติดเว็บแค่ไหน?
                </span>
                <PowerBadge summary={analytics.experiment_guardrails?.member_vs_guest_retention} />
              </div>

              {btyd && (
                <div className="flex flex-col gap-1 border border-line bg-panel p-2 font-mono text-[10px]">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-ink">
                      คาดว่ายังไม่เลิกใช้: <strong className="text-good">{btyd.expected_alive_clients}</strong> /{" "}
                      {btyd.total_clients} เครื่อง
                    </span>
                    <span className="text-dim">7 วันหน้า ~{btyd.expected_7d_repeat_visits} ครั้ง</span>
                  </div>
                  <div className="flex h-2.5 w-full overflow-hidden bg-bg">
                    <div
                      className="bg-blue"
                      style={{ width: `${(btyd.segments.new_today / btydTotal) * 100}%` }}
                      title={`เข้าใหม่วันนี้: ${btyd.segments.new_today}`}
                    />
                    <div
                      className="bg-good"
                      style={{ width: `${(btyd.segments.active_core / btydTotal) * 100}%` }}
                      title={`ขาประจำ (>=70%): ${btyd.segments.active_core}`}
                    />
                    <div
                      className="bg-gold"
                      style={{ width: `${(btyd.segments.slipping / btydTotal) * 100}%` }}
                      title={`กำลังจะหาย (30-69%): ${btyd.segments.slipping}`}
                    />
                    <div
                      className="bg-line-strong"
                      style={{ width: `${(btyd.segments.dormant / btydTotal) * 100}%` }}
                      title={`หายไปแล้ว (<30%): ${btyd.segments.dormant}`}
                    />
                  </div>
                  <div className="flex flex-wrap justify-between gap-x-2 text-[9px] text-dim">
                    <span className="text-blue">ใหม่วันนี้ {btyd.segments.new_today}</span>
                    <span className="text-good">ขาประจำ {btyd.segments.active_core}</span>
                    <span className="text-gold">ใกล้หาย {btyd.segments.slipping}</span>
                    <span>หายแล้ว {btyd.segments.dormant}</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
                <div className="border border-line bg-panel p-2">
                  <div className="text-[9px] text-dim">สมาชิก vs คนไม่ล็อกอิน</div>
                  <div className="font-extrabold text-blue">
                    กลับมาบ่อยกว่า {analytics.member_vs_guest_retention.relative_risk} เท่า
                  </div>
                  <div className="text-[9px] text-dim">
                    สมาชิก {analytics.member_vs_guest_retention.member.rate_pct}% vs Guest{" "}
                    {analytics.member_vs_guest_retention.guest.rate_pct}%
                  </div>
                </div>
                <div className="border border-line bg-panel p-2">
                  <div className="text-[9px] text-dim">ยอดใช้งานกระจุกตัวสูง</div>
                  <div className="font-extrabold text-gold">
                    Top 10% สร้าง {analytics.usage_distribution.top_10pct_share_pct}% เกม
                  </div>
                  <div className="text-[9px] text-dim">
                    พรุ่งนี้คาดว่าเข้า ~<strong className="text-good">{analytics.load_forecast.dau_next_day.expected_next_day}</strong> คน
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: Retention Survival Chart + What Behavior Drives WTP? */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {/* Card 4: Visual Survival Curve */}
            <div className="flex flex-col gap-2 border border-line bg-bg/60 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-display text-xs font-bold text-ink">
                  4. กราฟความอยู่รอด: ผ่านไปกี่วันคนถึงเลิกเข้าเว็บ?
                </span>
                <div className="flex items-center gap-3 font-mono text-[10px]">
                  <span className="flex items-center gap-1 text-blue">
                    <span className="inline-block h-1.5 w-3 bg-blue" /> สมาชิก ({kmMember[0]?.at_risk ?? 0})
                  </span>
                  <span className="flex items-center gap-1 text-gold">
                    <span className="inline-block h-1.5 w-3 bg-gold" /> ไม่ล็อกอิน ({kmGuest[0]?.at_risk ?? 0})
                  </span>
                </div>
              </div>

              <div className="border border-line bg-panel/70 px-2 pt-2 pb-1">
                <KaplanMeierChart member={kmMember} guest={kmGuest} />
              </div>

              <div className="font-mono text-[10px] text-dim">
                เส้นยิ่งอยู่สูง = คนยังอยู่เยอะ · อัตรากลับมาใช้ซ้ำจริง:{" "}
                {analytics.markov_retention.survival_curve
                  .map((s) => `วันที่ ${s.day}: ${s.pct}% (${s.survived}/${s.eligible})`)
                  .join(" · ")}
              </div>
            </div>

            {/* Card 5: Which Behavior Makes People Willing to Pay? */}
            <div className="flex flex-col gap-2 border border-line bg-bg/60 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-display text-xs font-bold text-ink">
                  5. พฤติกรรมแบบไหน ทำให้คนอยากจ่ายเงินมากที่สุด?
                </span>
                <span className="font-mono text-[10px] text-dim">
                  {analytics.bayesian_wtp.spearman_engagement_vs_wtp.p_value < 0.05
                    ? "ภาพรวมการใช้งานสัมพันธ์กับการพร้อมจ่าย"
                    : "ภาพรวม: ความถี่ใช้งานยังไม่ค่อยตรงกับปุ่มพร้อมจ่าย"}
                </span>
              </div>

              <div className="overflow-x-auto border border-line bg-panel/70">
                <table className="w-full border-collapse font-mono text-[10px]">
                  <thead>
                    <tr className="border-b border-line bg-panel text-muted">
                      <th className="px-2 py-1.5 text-left">พฤติกรรมการใช้งาน</th>
                      <th className="px-2 py-1.5 text-left">ความเชื่อมโยง</th>
                      <th className="px-2 py-1.5 text-right">กลุ่มทำบ่อย</th>
                      <th className="px-2 py-1.5 text-right">กลุ่มไม่ทำ</th>
                      <th className="px-2 py-1.5 text-right">ต่างกัน</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {(analytics.behavioral_signals ?? []).map((sig) => {
                      let statusText = "ยังไม่ชัด (คนตอบน้อย)";
                      let statusClass = "text-dim";
                      if (sig.p_value < 0.05) {
                        statusText = sig.rho >= 0 ? "ยิ่งทำยิ่งอยากจ่าย" : "ยิ่งทำยิ่งไม่อยากจ่าย";
                        statusClass = "font-bold text-good";
                      } else if (Math.abs(sig.rho) >= 0.1) {
                        statusText = sig.rho >= 0 ? "เริ่มมีแนวโน้ม +" : "เริ่มมีแนวโน้ม -";
                        statusClass = "text-gold";
                      }
                      return (
                        <tr key={sig.key} className="hover:bg-panel-2/40">
                          <td className="px-2 py-1 text-ink">{FEATURE_LABELS_TH[sig.key] ?? sig.label}</td>
                          <td className={`px-2 py-1 ${statusClass}`} title={`rho=${sig.rho}, p=${sig.p_value}`}>
                            {statusText}
                          </td>
                          <td className="px-2 py-1 text-right text-ink">
                            {sig.high_wtp_pct}% <span className="text-[9px] text-dim">({sig.high_n})</span>
                          </td>
                          <td className="px-2 py-1 text-right text-dim">
                            {sig.low_wtp_pct}% ({sig.low_n})
                          </td>
                          <td className="px-2 py-1 text-right font-bold text-gold">
                            {sig.lift > 0 ? `${sig.lift} เท่า` : "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Row 3: Operational AI Usage, Trust & Devices */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="border border-line bg-bg/60 p-3 font-mono text-[11px]">
              <div className="mb-1.5 flex items-center justify-between font-display text-xs font-bold text-ink">
                <span className="flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-gold" /> ยอดเรียก AI (สมาชิก vs Guest) &amp; ความเร็ว
                </span>
                <span
                  className={`flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                    analytics.experiment_guardrails?.latency_sla.status === "pass"
                      ? "border-good/50 bg-good/15 text-good"
                      : analytics.experiment_guardrails?.latency_sla.status === "warn"
                        ? "border-red/50 bg-red/15 text-red"
                        : "border-line bg-panel text-dim"
                  }`}
                >
                  <ShieldCheck className="h-2.5 w-2.5" />
                  {analytics.experiment_guardrails?.latency_sla.status === "pass"
                    ? `ตอบเร็วมาก (${analytics.latency.p95_ms} ms)`
                    : analytics.experiment_guardrails?.latency_sla.status === "warn"
                      ? "ช้าเกิน 500 ms"
                      : "รอเก็บข้อมูล"}
                </span>
              </div>
              <div className="flex items-center justify-between text-muted">
                <span>
                  สมาชิก: <strong className="text-blue">{analytics.guest_vs_member_predicts.member}</strong> (
                  {analytics.guest_vs_member_predicts.member_share_pct}%)
                </span>
                <span>
                  Guest: <strong className="text-gold">{analytics.guest_vs_member_predicts.guest}</strong> (
                  {analytics.guest_vs_member_predicts.guest_share_pct}%)
                </span>
              </div>
              <div className="mt-1.5 text-[10px] text-dim">
                รวม {analytics.latency.total_requests} ครั้ง · เฉลี่ย{" "}
                <strong className="text-ink">{analytics.latency.mean_ms} ms</strong> · ปกติ{" "}
                <strong className="text-good">{analytics.latency.p50_ms} ms</strong>
              </div>
            </div>

            <div className="border border-line bg-bg/60 p-3 font-mono text-[11px]">
              <div className="mb-1.5 flex items-center justify-between font-display text-xs font-bold text-ink">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-good" /> คนเชื่อคำแนะนำ AI แค่ไหน?
                </span>
                <span className="text-[10px] text-dim">{analytics.ai_trust.total_logged_picks} ตัวที่หยิบ</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted">
                <span>
                  หยิบตัวอันดับ #1: <strong className="text-good">{analytics.ai_trust.top1_pct}%</strong>
                </span>
                <span>
                  ติด Top 5: <strong className="text-gold">{analytics.ai_trust.top5_pct}%</strong>
                </span>
                <span>
                  ติด Top 10: <strong className="text-ink">{analytics.ai_trust.top10_pct}%</strong>
                </span>
              </div>
              <div className="mt-1.5 text-[10px] text-dim">
                {analytics.ai_trust.total_logged_picks > 0
                  ? `เลือกตาม Top-5 สูงกว่าเดาสุ่ม (3.85%) ถึง ${aiTrustLiftVsRandom ?? "-"} เท่า`
                  : "กำลังรอเก็บข้อมูลการกดหยิบฮีโร่หลัง Deploy"}
              </div>
            </div>

            <div className="border border-line bg-bg/60 p-3 font-mono text-[11px]">
              <div className="mb-1.5 flex items-center justify-between font-display text-xs font-bold text-ink">
                <span className="flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5 text-blue" /> เล่นจบเกม, อุปกรณ์ &amp; เครื่องมือที่ใช้
                </span>
                <span className="text-[10px] text-dim">
                  ครบ 18 ตัว: ดราฟต์ {analytics.feature_usage.draft_completed_18} / ซ้อม AI{" "}
                  {analytics.feature_usage.practice_completed_18}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] text-muted">
                <span>
                  มือถือ {analytics.feature_usage.devices.mobile} / คอม {analytics.feature_usage.devices.desktop}
                </span>
                <span>· จับเวลา {analytics.feature_usage.tools.timer_start}</span>
                <span>· เลือกเลน {analytics.feature_usage.tools.pick_lane}</span>
                <span>· สลับฮีโร่ {analytics.feature_usage.tools.replace_hero}</span>
              </div>
              <div className="mt-1 text-[10px] text-dim">
                ลีกที่ใช้:{" "}
                {Object.entries(analytics.feature_usage.leagues)
                  .map(([k, v]) => `${k}:${v}`)
                  .join(" · ")}
              </div>
            </div>
          </div>

          {/* Collapsible Deep Math / Citations Reference for Optional Reading */}
          <details className="border border-line bg-bg/40 px-3 py-2 font-mono text-[10px] text-muted">
            <summary className="flex cursor-pointer items-center gap-1.5 font-display text-[11px] font-bold text-ink select-none hover:text-gold">
              <BookOpen className="h-3.5 w-3.5 text-gold" />
              <span>อ้างอิงทฤษฎี &amp; สูตรเบื้องหลังทั้งหมด (คลิกเปิดดูได้ถ้าสนใจเชิงลึก)</span>
            </summary>
            <div className="mt-2 grid grid-cols-1 gap-2 border-t border-line pt-2 md:grid-cols-2">
              <div>
                <strong className="text-ink">1. BTYD P(Alive) &amp; Gamma-Poisson (Fader, Hardie &amp; Lee 2005, 2009):</strong>{" "}
                ใช้ความถี่การเข้า, วันที่ล่าสุด และอายุบัญชี คำนวณโอกาสที่ผู้ใช้ยังไม่เลิกใช้แบบ Non-contractual
              </div>
              <div>
                <strong className="text-ink">2. Markov Retention (Pfeifer &amp; Carraway 2000):</strong>{" "}
                ตาราง 3×3 คำนวณโอกาสย้ายสถานะรายวัน (เข้าใหม่ / แอคทีฟ / หายไป) และคาดการณ์จำนวนวันที่เข้าใน 14 วัน
              </div>
              <div>
                <strong className="text-ink">3. Kaplan–Meier Survival (Kaplan &amp; Meier 1958):</strong>{" "}
                เส้นอัตราอยู่รอดที่หักลบคนที่เพิ่งเข้ามาใหม่ไม่ให้ตัวหารเพี้ยน พร้อมช่วงความเชื่อมั่น 95% Greenwood
              </div>
              <div>
                <strong className="text-ink">4. Wilson (1927), Katz (1978), Kohavi (2020) &amp; Sifa (2015):</strong>{" "}
                ช่วงความเชื่อมั่นสำหรับ sample เล็ก, การคำนวณ Power กันด่วนสรุป และอันดับพฤติกรรมที่สัมพันธ์กับ WTP
              </div>
            </div>
          </details>
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
          <table className="w-full min-w-[980px] border-collapse text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-line bg-panel-2/70">
                <th className="px-3 py-2 text-[11px] font-bold text-dim">#</th>
                <th className="px-3 py-2 text-[11px] font-bold text-muted">บัญชี / ชื่อ / Email</th>
                <th className="px-3 py-2 text-right">{sortHeaderBtn("active_days", "วันใช้งาน")}</th>
                <th className="px-3 py-2 text-right">{sortHeaderBtn("saved_series_games", "Draft (เกม)")}</th>
                <th className="px-3 py-2 text-right">{sortHeaderBtn("practice_games", "vs AI (เกม)")}</th>
                <th className="px-3 py-2 text-right">{sortHeaderBtn("predict_calls", "เรียก AI")}</th>
                <th className="px-3 py-2 text-right">{sortHeaderBtn("p_alive", "โอกาสกลับมาใช้")}</th>
                <th className="px-3 py-2 text-center text-[11px] font-bold text-muted">แบบสอบถาม</th>
                <th className="px-3 py-2 text-right">{sortHeaderBtn("last_activity", "ใช้งานล่าสุด")}</th>
                <th className="px-3 py-2 text-right">{sortHeaderBtn("created_at", "สมัครเมื่อ")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visibleUsers.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-dim">
                    {loading ? "กำลังโหลดรายชื่อผู้ใช้..." : "ไม่พบบัญชีที่ตรงกับตัวกรอง"}
                  </td>
                </tr>
              ) : (
                visibleUsers.map((u, idx) => {
                  const bScore = userScores[String(u.id)];
                  let tierLabel = "-";
                  let tierBadge = "text-dim";
                  if (bScore) {
                    if (bScore.btyd_tier === "Core") {
                      tierLabel = `ขาประจำ (${bScore.p_alive_pct}%)`;
                      tierBadge = "text-good";
                    } else if (bScore.btyd_tier === "At-Risk") {
                      tierLabel = `กำลังจะหาย (${bScore.p_alive_pct}%)`;
                      tierBadge = "text-gold";
                    } else if (bScore.btyd_tier === "New") {
                      tierLabel = "เพิ่งเข้าใหม่";
                      tierBadge = "text-blue";
                    } else {
                      tierLabel = `หายไปนาน (${bScore.p_alive_pct}%)`;
                      tierBadge = "text-dim";
                    }
                  }
                  return (
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
                          <div className="text-[10px] text-dim">ถึงตัวที่ {u.draft_step_index}</div>
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
                          <div className="text-[10px] text-dim">เซฟ {u.draft_save_calls}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {bScore ? (
                          <>
                            <div className={`font-bold ${tierBadge}`}>{tierLabel}</div>
                            <div className="text-[10px] text-dim">คะแนนใช้งาน {bScore.behavior_score}/100</div>
                          </>
                        ) : (
                          <span className="text-dim">-</span>
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
                  );
                })
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

      {/* Bottom 2 Columns: Returning Unlinked Guests + Cloudflare Sources */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-2.5 border border-line bg-panel p-4">
          <h2 className="font-display text-sm font-bold tracking-wide text-ink">
            เครื่อง Guest ที่ใช้งานบ่อย (ไม่ได้ล็อกอิน)
          </h2>
          <div className="max-h-72 overflow-y-auto border border-line bg-bg/50">
            <table className="w-full border-collapse text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-line bg-panel-2/70 text-[11px] text-muted">
                  <th className="px-3 py-2">รหัสเครื่อง</th>
                  <th className="px-3 py-2 text-center">อุปกรณ์</th>
                  <th className="px-3 py-2 text-right">วันใช้งาน</th>
                  <th className="px-3 py-2 text-right">เรียก AI</th>
                  <th className="px-3 py-2 text-right">ล่าสุด</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(usersReport?.top_guest_clients ?? []).map((g) => (
                  <tr key={g.client_id} className="hover:bg-panel-2/40">
                    <td className="max-w-[200px] truncate px-3 py-1.5 text-ink">{g.client_id}</td>
                    <td className="px-3 py-1.5 text-center text-[10px] text-dim">{g.device_type ?? "-"}</td>
                    <td className="px-3 py-1.5 text-right font-bold text-good">{g.active_days}</td>
                    <td className="px-3 py-1.5 text-right font-bold text-gold">
                      {(g.predict_calls ?? 0).toLocaleString()}
                    </td>
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

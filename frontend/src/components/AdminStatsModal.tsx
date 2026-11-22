import { StableButtonLabel } from "./StableButtonLabel";
import { useLanguage } from "../i18n/language";
import { BarChart3, Coins, ExternalLink, Globe, RefreshCw, Repeat, Users, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ApiError, getJson } from "../api/client";
import type { AdminStatsResponse } from "../types/auth";
import { Modal } from "./Modal";

interface AdminStatsModalProps {
  onClose: () => void;
}

type SurveyChoiceFilter = "all" | "willing" | "not_willing";

let cachedAdminStats: AdminStatsResponse | null = null;

/** Owner-only production & survey analytics dashboard modal. */
export function AdminStatsModal({ onClose }: AdminStatsModalProps) {
  const { t } = useLanguage();
  const titleId = useId();
  const [data, setData] = useState<AdminStatsResponse | null>(() => cachedAdminStats);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [choiceFilter, setChoiceFilter] = useState<SurveyChoiceFilter>("all");
  const [membersOnly, setMembersOnly] = useState(false);
  const [refererRange, setRefererRange] = useState<"today" | "7d">("today");

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getJson<AdminStatsResponse>("/admin/stats");
      cachedAdminStats = res;
      setData(res);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
        cachedAdminStats = null;
        setData(null);
      }
      setError(err instanceof Error ? err.message : "ไม่สามารถดึงข้อมูลสถิติได้");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    getJson<AdminStatsResponse>("/admin/stats", ctrl.signal)
      .then((res) => {
        if (!ctrl.signal.aborted) {
          cachedAdminStats = res;
          setData(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (!ctrl.signal.aborted) {
          if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
            cachedAdminStats = null;
            setData(null);
          }
          setError(err instanceof Error ? err.message : "ไม่สามารถดึงข้อมูลสถิติได้");
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) {
          setLoading(false);
        }
      });
    return () => ctrl.abort();
  }, []);

  const notWillingPct = data && data.survey.total > 0 ? Math.round((100 - data.survey.willing_pct) * 10) / 10 : 0;
  const estimatedGuests =
    data?.cloudflare && data.cloudflare.total_uniques > data.users.total
      ? data.cloudflare.total_uniques - data.users.total
      : null;

  const filteredVotes = useMemo(() => {
    if (!data) return [];
    return data.survey.recent.filter((item) => {
      if (choiceFilter !== "all" && item.choice !== choiceFilter) return false;
      if (membersOnly && !item.username) return false;
      return true;
    });
  }, [data, choiceFilter, membersOnly]);

  return (
    <Modal labelledBy={titleId} className="max-w-2xl" onClose={onClose}>
      {(requestClose) => (
        <>
          <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-2">
              <BarChart3 className="h-4 w-4 shrink-0 text-gold" />
              <div className="min-w-0">
                <h2 id={titleId} className="truncate font-display text-sm font-bold tracking-wider text-ink sm:text-base">
                  {t("OWNER ANALYTICS · สถิติระบบ")}
                </h2>
                {data && (
                  <p className="font-mono text-[10px] text-dim sm:text-[11px]">
                    {t("อัปเดตล่าสุด:")} {data.generated_at_th} (UTC+7)
                  </p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <a
                href="/#admin"
                target="_blank"
                rel="noopener noreferrer"
                title={t("เปิดหน้า Dashboard เต็มจอในแท็บใหม่")}
                className="inline-flex h-8 items-center gap-1.5 border border-gold/50 bg-gold/10 px-2.5 font-display text-xs font-bold text-gold transition-colors hover:bg-gold hover:text-bg"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Dashboard</span>
              </a>
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleRefresh()}
                className="inline-flex h-8 items-center gap-1.5 border border-line-strong bg-panel-2 px-2.5 font-display text-xs font-semibold text-ink transition-colors hover:border-gold/60 hover:text-gold disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-gold ${loading ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
              <button
                type="button"
                onClick={() => requestClose()}
                aria-label={t("ปิด")}
                className="inline-flex h-8 w-8 items-center justify-center rounded text-dim transition-colors hover:bg-panel-2 hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-4 overflow-y-auto p-4 sm:p-5">
            {error && (
              <div className="border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
                {t(error)}
              </div>
            )}

            {!data && loading && (
              <div className="py-10 text-center font-mono text-xs text-muted">
                {t("กำลังโหลดข้อมูลสถิติล่าสุด...")}
              </div>
            )}

            {data && (
              <>
                {/* 1. Pricing Survey Summary (Clickable filter cards) */}
                <section className="flex flex-col gap-2.5 border border-gold/35 bg-panel-2/60 p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Coins className="h-4 w-4 text-gold" />
                      <h3 className="font-display text-xs font-bold tracking-wide text-ink sm:text-sm">
                        {t("ผลสำรวจความพร้อมจ่ายรายเดือน (คลิกการ์ดเพื่อกรองรายชื่อ)")}
                      </h3>
                    </div>
                    <span className="border border-gold/50 bg-gold/10 px-2 py-0.5 font-mono text-xs font-bold text-gold">
                      {t("รวม")} {data.survey.total.toLocaleString()} {t("คน")}
                    </span>
                  </div>

                  <div className="h-2.5 w-full overflow-hidden bg-bg">
                    <div
                      className="h-full bg-good transition-all duration-300"
                      style={{ width: `${data.survey.willing_pct}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setChoiceFilter((prev) => (prev === "willing" ? "all" : "willing"))}
                      className={`border p-2.5 text-left transition-all ${
                        choiceFilter === "willing"
                          ? "border-good bg-good/20 ring-1 ring-good"
                          : "border-good/40 bg-good/10 hover:border-good/80"
                      }`}
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="font-display text-xs font-bold text-good"><StableButtonLabel message="พร้อมจ่าย (Willing)" /></span>
                        <span className="font-mono text-sm font-extrabold text-good">
                          {data.survey.willing_total.toLocaleString()} <StableButtonLabel message="คน (" />{data.survey.willing_pct}%)
                        </span>
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-muted">
                        <StableButtonLabel message="สมาชิก:" /> <strong className="text-ink">{data.survey.willing_member}</strong> · Guest:{" "}
                        <strong className="text-ink">{data.survey.willing_guest}</strong>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setChoiceFilter((prev) => (prev === "not_willing" ? "all" : "not_willing"))}
                      className={`border p-2.5 text-left transition-all ${
                        choiceFilter === "not_willing"
                          ? "border-gold bg-panel ring-1 ring-gold"
                          : "border-line-strong bg-bg/70 hover:border-ink/40"
                      }`}
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="font-display text-xs font-bold text-muted"><StableButtonLabel message="ไม่พร้อม (Not Willing)" /></span>
                        <span className="font-mono text-sm font-extrabold text-ink">
                          {data.survey.not_willing_total.toLocaleString()} <StableButtonLabel message="คน (" />{notWillingPct}%)
                        </span>
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-muted">
                        <StableButtonLabel message="สมาชิก:" /> <strong className="text-ink">{data.survey.not_willing_member}</strong> · Guest:{" "}
                        <strong className="text-ink">{data.survey.not_willing_guest}</strong>
                      </div>
                    </button>
                  </div>
                </section>

                {/* 2. Filterable Survey Responses List */}
                <section className="flex flex-col gap-2.5 border border-line bg-panel-2/30 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display text-xs font-bold tracking-wide text-ink sm:text-sm">
                      {t("รายชื่อผู้ตอบแบบสอบถาม (")}{filteredVotes.length.toLocaleString()} {t("รายการ)")}
                    </h3>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setChoiceFilter("all")}
                        className={`h-7 border px-2 font-display text-[11px] font-semibold transition-colors ${
                          choiceFilter === "all"
                            ? "border-gold bg-gold text-bg font-bold"
                            : "border-line-strong bg-bg text-muted hover:text-ink"
                        }`}
                      >
                        <StableButtonLabel message="ทั้งหมด (" />{data.survey.total})
                      </button>
                      <button
                        type="button"
                        onClick={() => setChoiceFilter("willing")}
                        className={`h-7 border px-2 font-display text-[11px] font-semibold transition-colors ${
                          choiceFilter === "willing"
                            ? "border-good bg-good text-bg font-bold"
                            : "border-good/40 bg-good/10 text-good hover:border-good"
                        }`}
                      >
                        <StableButtonLabel message="พร้อมจ่าย (" />{data.survey.willing_total})
                      </button>
                      <button
                        type="button"
                        onClick={() => setChoiceFilter("not_willing")}
                        className={`h-7 border px-2 font-display text-[11px] font-semibold transition-colors ${
                          choiceFilter === "not_willing"
                            ? "border-ink bg-ink text-bg font-bold"
                            : "border-line-strong bg-bg text-muted hover:text-ink"
                        }`}
                      >
                        <StableButtonLabel message="ไม่พร้อม (" />{data.survey.not_willing_total})
                      </button>
                      <button
                        type="button"
                        onClick={() => setMembersOnly((v) => !v)}
                        className={`h-7 border px-2 font-display text-[11px] font-semibold transition-colors ${
                          membersOnly
                            ? "border-blue bg-blue/20 text-blue font-bold"
                            : "border-line-strong bg-bg text-muted hover:text-ink"
                        }`}
                      >
                        <StableButtonLabel message={membersOnly ? "✓ เฉพาะสมาชิก (@)" : "เฉพาะสมาชิก (@)"} alternatives={["✓ เฉพาะสมาชิก (@)", "เฉพาะสมาชิก (@)"]} />
                      </button>
                    </div>
                  </div>

                  {filteredVotes.length === 0 ? (
                    <div className="border border-line bg-bg/50 py-5 text-center font-mono text-xs text-dim">
                      {t("ไม่พบรายการตามตัวกรองที่เลือก")}
                    </div>
                  ) : (
                    <div className="max-h-56 overflow-y-auto border border-line bg-bg/60 divide-y divide-line">
                      {filteredVotes.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-2 px-3 py-2 font-mono text-[11px]"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="w-7 shrink-0 text-dim">#{item.id}</span>
                            <span
                              className={`shrink-0 px-1.5 py-0.5 text-[10px] font-bold ${
                                item.choice === "willing"
                                  ? "border border-good/40 bg-good/15 text-good"
                                  : "border border-line-strong bg-panel-2 text-muted"
                              }`}
                            >
                              {item.choice === "willing" ? t("พร้อมจ่าย") : t("ไม่พร้อม")}
                            </span>
                            {item.username ? (
                              <div className="min-w-0 truncate">
                                <span className="font-bold text-gold">@{item.username}</span>
                                {item.display_name && item.display_name !== item.username && (
                                  <span className="ml-1.5 text-ink">({item.display_name})</span>
                                )}
                                {item.email && (
                                  <span className="ml-1.5 text-[10px] text-dim">{item.email}</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted">{t("Guest (ไม่ได้ล็อกอิน)")}</span>
                            )}
                          </div>
                          <span className="shrink-0 text-[10px] text-dim">{item.updated_at_th.slice(5)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* 3. Users Database Summary */}
                <section className="flex flex-col gap-2.5 border border-line bg-panel-2/40 p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-blue" />
                      <h3 className="font-display text-xs font-bold tracking-wide text-ink sm:text-sm">
                        {t("ฐานข้อมูลสมาชิก (SQLite Users)")}
                      </h3>
                    </div>
                    <span className="font-mono text-xs font-bold text-good">
                      {t("วันนี้ +")}{data.users.new_today.toLocaleString()} {t("คน")}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="border border-line bg-bg/60 p-2.5">
                      <div className="font-mono text-[10px] text-dim">{t("ผู้ใช้ทั้งหมด")}</div>
                      <div className="mt-0.5 font-mono text-base font-extrabold text-ink">
                        {data.users.total.toLocaleString()}
                      </div>
                    </div>
                    <div className="border border-line bg-bg/60 p-2.5">
                      <div className="font-mono text-[10px] text-dim">Google / Discord / Pass</div>
                      <div className="mt-0.5 font-mono text-xs font-bold text-ink">
                        {data.users.google} / {data.users.discord} / {data.users.password_only}
                      </div>
                    </div>
                    <div className="border border-line bg-bg/60 p-2.5">
                      <div className="font-mono text-[10px] text-dim">{t("บันทึกดราฟต์ไว้")}</div>
                      <div className="mt-0.5 font-mono text-base font-extrabold text-ink">
                        {data.users.saved_draft_states.toLocaleString()}
                      </div>
                    </div>
                    <div className="border border-line bg-bg/60 p-2.5">
                      <div className="font-mono text-[10px] text-dim">Active Sessions</div>
                      <div className="mt-0.5 font-mono text-base font-extrabold text-ink">
                        {data.users.active_sessions.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {data.users.signups_by_day.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <span className="font-mono text-[10px] text-dim">{t("สมัครรายวัน:")}</span>
                      {data.users.signups_by_day.map((d) => (
                        <span
                          key={d.date}
                          className="border border-line bg-bg px-2 py-0.5 font-mono text-[11px] text-muted"
                        >
                          {d.date.slice(5)}: <strong className="text-ink">{d.count}</strong>
                        </span>
                      ))}
                    </div>
                  )}
                </section>

                {/* 4. Cloudflare Traffic & Guest Estimate */}
                {data.cloudflare && (
                  <section className="flex flex-col gap-2.5 border border-line bg-panel-2/40 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4 text-gold" />
                        <h3 className="font-display text-xs font-bold tracking-wide text-ink sm:text-sm">
                          {t("ผู้เข้าชมทั้งหมด & Guest (Cloudflare Analytics)")}
                        </h3>
                      </div>
                      <span className="font-mono text-[10px] text-dim">Cache 60s</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <div className="border border-line bg-bg/60 p-2.5">
                        <div className="font-mono text-[10px] text-dim">{t("วันนี้ (Uniques / Visits)")}</div>
                        <div className="mt-0.5 font-mono text-sm font-extrabold text-gold">
                          {data.cloudflare.today_uniques.toLocaleString()} {t("คน /")}{" "}
                          {data.cloudflare.today_rum_visits.toLocaleString()} visits
                        </div>
                      </div>
                      <div className="border border-line bg-bg/60 p-2.5">
                        <div className="font-mono text-[10px] text-dim">{t("สะสมทั้งหมด (Uniques)")}</div>
                        <div className="mt-0.5 font-mono text-sm font-extrabold text-ink">
                          {data.cloudflare.total_uniques.toLocaleString()} {t("คน")}
                        </div>
                      </div>
                      <div className="col-span-2 border border-line bg-bg/60 p-2.5 sm:col-span-1">
                        <div className="font-mono text-[10px] text-dim">{t("ส่วนต่าง Guest (ไม่ได้สมัคร)")}</div>
                        <div className="mt-0.5 font-mono text-sm font-extrabold text-ink">
                          {estimatedGuests !== null ? t("~{0} คน", estimatedGuests.toLocaleString()) : "-"}
                        </div>
                      </div>
                    </div>

                    {/* Top Sources / Referrers */}
                    {(() => {
                      const activeReferers =
                        refererRange === "today"
                          ? (data.cloudflare.referers_today ?? [])
                          : (data.cloudflare.referers_7d ?? []);
                      const totalRefVisits = activeReferers.reduce((sum, item) => sum + item.visits, 0);
                      return (
                        <div className="border border-line bg-bg/60 p-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
                            <span className="font-mono text-[11px] font-bold text-ink">
                              {t("ช่องทางที่คนกดเข้ามา (Top Sources)")}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setRefererRange("today")}
                                className={`cursor-pointer border px-2 py-0.5 font-mono text-[10px] font-semibold transition-colors ${
                                  refererRange === "today"
                                    ? "border-gold/60 bg-gold/15 text-gold"
                                    : "border-line bg-bg text-muted hover:text-ink"
                                }`}
                              >
                                <StableButtonLabel message="วันนี้" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setRefererRange("7d")}
                                className={`cursor-pointer border px-2 py-0.5 font-mono text-[10px] font-semibold transition-colors ${
                                  refererRange === "7d"
                                    ? "border-gold/60 bg-gold/15 text-gold"
                                    : "border-line bg-bg text-muted hover:text-ink"
                                }`}
                              >
                                <StableButtonLabel message="7 วัน" />
                              </button>
                            </div>
                          </div>

                          {activeReferers.length === 0 ? (
                            <p className="py-1 text-center font-mono text-[11px] text-dim">
                              {t("ยังไม่มีข้อมูลช่องทางในช่วงเวลานี้")}
                            </p>
                          ) : (
                            <div className="flex flex-col gap-1.5">
                              {activeReferers.map((item) => {
                                const pct =
                                  totalRefVisits > 0 ? Math.round((item.visits / totalRefVisits) * 100) : 0;
                                return (
                                  <div key={item.source} className="flex items-center gap-2 text-[11px]">
                                    <span className="w-32 shrink-0 truncate font-mono text-ink sm:w-40">
                                      {item.source}
                                    </span>
                                    <div className="h-2 flex-1 overflow-hidden bg-panel-2">
                                      <div
                                        className="h-full bg-gold/75 transition-all duration-300"
                                        style={{ width: `${Math.max(4, pct)}%` }}
                                      />
                                    </div>
                                    <span className="w-20 shrink-0 text-right font-mono text-muted">
                                      {item.visits.toLocaleString()} ({pct}%)
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </section>
                )}

                {/* 5. First-Party Returning Users & Retention */}
                {data.retention && (
                  <section className="flex flex-col gap-2.5 border border-line bg-panel-2/40 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Repeat className="h-4 w-4 text-good" />
                        <h3 className="font-display text-xs font-bold tracking-wide text-ink sm:text-sm">
                          {t("คนกลับมาใช้ซ้ำ (Retention & Returning Users)")}
                        </h3>
                      </div>
                      <span className="font-mono text-[10px] text-dim">
                        {t("สะสม")} {data.retention.total_tracked_clients.toLocaleString()} {t("เครื่อง")}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <div className="border border-line bg-bg/60 p-2.5">
                        <div className="font-mono text-[10px] text-dim">{t("วันนี้ (ใหม่ / กลับมาซ้ำ)")}</div>
                        <div className="mt-0.5 font-mono text-sm font-extrabold text-ink">
                          {data.retention.today_dau.toLocaleString()} {t("คน")}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-muted">
                          {t("ใหม่")} <strong className="text-gold">{data.retention.today_new}</strong> {t("· ซ้ำ")}{" "}
                          <strong className="text-good">{data.retention.today_returning}</strong>
                        </div>
                      </div>
                      <div className="border border-line bg-bg/60 p-2.5">
                        <div className="font-mono text-[10px] text-dim">{t("กลับมาซ้ำ >= 2 วัน")}</div>
                        <div className="mt-0.5 font-mono text-sm font-extrabold text-good">
                          {data.retention.returning_clients.toLocaleString()} {t("เครื่อง (")}{data.retention.returning_pct}%)
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-muted">
                          {t("จากทั้งหมด")} {data.retention.total_tracked_clients.toLocaleString()} {t("เครื่อง")}
                        </div>
                      </div>
                      <div className="col-span-2 border border-line bg-bg/60 p-2.5 sm:col-span-1">
                        <div className="font-mono text-[10px] text-dim">D1+ Retention</div>
                        <div className="mt-0.5 font-mono text-sm font-extrabold text-gold">
                          {data.retention.d1_eligible > 0 ? `${data.retention.d1_pct}%` : "-"}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-muted">
                          {data.retention.d1_retained} / {data.retention.d1_eligible} {t("เครื่องจากวันก่อน")}
                        </div>
                      </div>
                    </div>

                    {data.retention.daily_breakdown.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="font-mono text-[10px] text-dim">{t("รายวัน (ใหม่/ซ้ำ):")}</span>
                        {data.retention.daily_breakdown.map((d) => (
                          <span
                            key={d.date}
                            className="border border-line bg-bg px-2 py-0.5 font-mono text-[11px] text-muted"
                          >
                            {d.date.slice(5)}: <strong className="text-gold">{d.new}</strong>/
                            <strong className="text-good">{d.returning}</strong>
                          </span>
                        ))}
                      </div>
                    )}
                  </section>
                )}
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

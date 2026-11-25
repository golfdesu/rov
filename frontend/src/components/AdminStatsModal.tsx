import { StableButtonLabel } from "./StableButtonLabel";
import { useLanguage } from "../i18n/language";
import { BarChart3, ExternalLink, Globe, MessageSquare, RefreshCw, Repeat, Users, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ApiError, getJson } from "../api/client";
import type { AdminFeedbackResponse, AdminStatsResponse } from "../types/auth";
import { Modal } from "./Modal";

interface AdminStatsModalProps {
  onClose: () => void;
}

type FeedbackSenderFilter = "all" | "member" | "guest";

let cachedAdminStats: AdminStatsResponse | null = null;
let cachedAdminFeedback: AdminFeedbackResponse | null = null;

/** Owner-only production & feedback analytics dashboard modal. */
export function AdminStatsModal({ onClose }: AdminStatsModalProps) {
  const { t } = useLanguage();
  const titleId = useId();
  const [data, setData] = useState<AdminStatsResponse | null>(() => cachedAdminStats);
  const [feedbackData, setFeedbackData] = useState<AdminFeedbackResponse | null>(() => cachedAdminFeedback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [senderFilter, setSenderFilter] = useState<FeedbackSenderFilter>("all");
  const [refererRange, setRefererRange] = useState<"today" | "7d">("today");

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, feedbackRes] = await Promise.all([
        getJson<AdminStatsResponse>("/admin/stats"),
        getJson<AdminFeedbackResponse>("/admin/feedback"),
      ]);
      cachedAdminStats = statsRes;
      cachedAdminFeedback = feedbackRes;
      setData(statsRes);
      setFeedbackData(feedbackRes);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
        cachedAdminStats = null;
        cachedAdminFeedback = null;
        setData(null);
        setFeedbackData(null);
      }
      setError(err instanceof Error ? err.message : "ไม่สามารถดึงข้อมูลสถิติได้");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([
      getJson<AdminStatsResponse>("/admin/stats", ctrl.signal),
      getJson<AdminFeedbackResponse>("/admin/feedback", ctrl.signal),
    ])
      .then(([statsRes, feedbackRes]) => {
        if (!ctrl.signal.aborted) {
          cachedAdminStats = statsRes;
          cachedAdminFeedback = feedbackRes;
          setData(statsRes);
          setFeedbackData(feedbackRes);
          setError(null);
        }
      })
      .catch((err) => {
        if (!ctrl.signal.aborted) {
          if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
            cachedAdminStats = null;
            cachedAdminFeedback = null;
            setData(null);
            setFeedbackData(null);
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

  const estimatedGuests =
    data?.cloudflare && data.cloudflare.total_uniques > data.users.total
      ? data.cloudflare.total_uniques - data.users.total
      : null;

  const filteredFeedbacks = useMemo(() => {
    if (!feedbackData) return [];
    return feedbackData.items.filter((item) => {
      if (senderFilter === "member" && item.is_guest) return false;
      if (senderFilter === "guest" && !item.is_guest) return false;
      return true;
    });
  }, [feedbackData, senderFilter]);

  return (
    <Modal labelledBy={titleId} className="max-w-2xl" onClose={onClose}>
      {(requestClose) => (
        <>
          <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-2">
              <BarChart3 className="h-4 w-4 shrink-0 text-gold" />
              <div className="min-w-0">
                <h2 id={titleId} className="truncate font-display text-sm font-bold tracking-wider text-ink sm:text-base">
                  {t("สถิติระบบ")}
                </h2>
                {data && (
                  <p className="truncate font-mono text-[10px] text-dim sm:text-[11px]">
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
                aria-label={t("รีเฟรช")}
                className="inline-flex h-8 items-center gap-1.5 border border-line-strong bg-panel-2 px-2.5 font-display text-xs font-semibold text-ink transition-colors hover:border-gold/60 hover:text-gold disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-gold ${loading ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">{t("รีเฟรช")}</span>
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
                {/* 1. Written User Feedback Inbox */}
                <section className="flex flex-col gap-2.5 border border-gold/35 bg-panel-2/60 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-gold" />
                      <h3 className="font-display text-xs font-bold tracking-wide text-ink sm:text-sm">
                        {t("ข้อความ Feedback จากผู้ใช้")}
                      </h3>
                    </div>
                    <div className="flex items-center gap-1.5 font-mono text-[11px]">
                      <span className="border border-gold/50 bg-gold/10 px-2 py-0.5 font-bold whitespace-nowrap text-gold">
                        {t("ทั้งหมด {0}", (feedbackData?.total ?? data.feedback?.total ?? 0).toLocaleString())}
                      </span>
                      <span className="border border-good/40 bg-good/10 px-2 py-0.5 font-bold whitespace-nowrap text-good">
                        {t("วันนี้ +{0}", (feedbackData?.today ?? data.feedback?.today ?? 0).toLocaleString())}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSenderFilter("all")}
                      className={`min-h-7 border px-2 py-0.5 font-display text-[11px] font-semibold whitespace-nowrap transition-colors ${
                        senderFilter === "all"
                          ? "border-gold bg-gold text-bg font-bold"
                          : "border-line-strong bg-bg text-muted hover:text-ink"
                      }`}
                    >
                      {t("ทั้งหมด ({0})", feedbackData?.total ?? 0)}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSenderFilter("member")}
                      className={`min-h-7 border px-2 py-0.5 font-display text-[11px] font-semibold whitespace-nowrap transition-colors ${
                        senderFilter === "member"
                          ? "border-blue bg-blue text-bg font-bold"
                          : "border-blue/40 bg-blue/10 text-blue hover:border-blue"
                      }`}
                    >
                      {t("เฉพาะสมาชิก ({0})", feedbackData?.member_total ?? 0)}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSenderFilter("guest")}
                      className={`min-h-7 border px-2 py-0.5 font-display text-[11px] font-semibold whitespace-nowrap transition-colors ${
                        senderFilter === "guest"
                          ? "border-ink bg-ink text-bg font-bold"
                          : "border-line-strong bg-bg text-muted hover:text-ink"
                      }`}
                    >
                      {t("Guest ({0})", feedbackData?.guest_total ?? 0)}
                    </button>
                  </div>

                  {filteredFeedbacks.length === 0 ? (
                    <div className="border border-line bg-bg/50 py-5 text-center font-mono text-xs text-dim">
                      {t("ยังไม่มีข้อความ Feedback")}
                    </div>
                  ) : (
                    <div className="max-h-64 divide-y divide-line overflow-y-auto border border-line bg-bg/60">
                      {filteredFeedbacks.map((item) => (
                        <div key={item.id} className="flex flex-col gap-1.5 px-3 py-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="text-dim">#{item.id}</span>
                              {item.username ? (
                                <>
                                  <span className="font-bold text-gold">@{item.username}</span>
                                  {item.display_name && item.display_name !== item.username && (
                                    <span className="text-ink">({item.display_name})</span>
                                  )}
                                  {item.email && <span className="text-[10px] text-dim">{item.email}</span>}
                                </>
                              ) : item.is_guest ? (
                                <span className="border border-line-strong bg-panel-2 px-1.5 py-0.5 text-[10px] text-muted">
                                  Guest
                                </span>
                              ) : (
                                <span className="border border-line-strong bg-panel-2 px-1.5 py-0.5 text-[10px] text-muted">
                                  {t("สมาชิกที่ลบบัญชี")}
                                </span>
                              )}
                              {item.page_context && (
                                <span className="border border-line bg-panel px-1.5 py-0.5 text-[10px] text-dim">
                                  {item.page_context}
                                </span>
                              )}
                            </div>
                            <span className="shrink-0 text-[10px] text-dim">{item.created_at_th.slice(5)}</span>
                          </div>
                          <p className="text-xs leading-relaxed whitespace-pre-wrap break-words text-ink">
                            {item.message}
                          </p>
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
                        {t("บัญชีสมาชิก")}
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
                          {t("ผู้เข้าชม (Cloudflare)")}
                        </h3>
                      </div>
                      <span className="font-mono text-[10px] text-dim">Cache 60s</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <div className="border border-line bg-bg/60 p-2.5">
                        <div className="font-mono text-[10px] text-dim">{t("วันนี้ (คน / ครั้ง)")}</div>
                        <div className="mt-0.5 font-mono text-sm font-extrabold text-gold">
                          {data.cloudflare.today_uniques.toLocaleString()} {t("คน /")}{" "}
                          {data.cloudflare.today_rum_visits.toLocaleString()} {t("ครั้ง")}
                        </div>
                      </div>
                      <div className="border border-line bg-bg/60 p-2.5">
                        <div className="font-mono text-[10px] text-dim">{t("ผู้เข้าชมสะสม")}</div>
                        <div className="mt-0.5 font-mono text-sm font-extrabold text-ink">
                          {data.cloudflare.total_uniques.toLocaleString()} {t("คน")}
                        </div>
                      </div>
                      <div className="col-span-2 border border-line bg-bg/60 p-2.5 sm:col-span-1">
                        <div className="font-mono text-[10px] text-dim">{t("Guest โดยประมาณ")}</div>
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
                              {t("ช่องทางเข้าเว็บ")}
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
                          {t("การกลับมาใช้ซ้ำ")}
                        </h3>
                      </div>
                      <span className="font-mono text-[10px] text-dim">
                        {t("สะสม")} {data.retention.total_tracked_clients.toLocaleString()} {t("เครื่อง")}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <div className="border border-line bg-bg/60 p-2.5">
                        <div className="font-mono text-[10px] text-dim">{t("วันนี้ (ใหม่ / ซ้ำ)")}</div>
                        <div className="mt-0.5 font-mono text-sm font-extrabold text-ink">
                          {data.retention.today_dau.toLocaleString()} {t("คน")}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-muted">
                          {t("ใหม่")} <strong className="text-gold">{data.retention.today_new}</strong> {t("· ซ้ำ")}{" "}
                          <strong className="text-good">{data.retention.today_returning}</strong>
                        </div>
                      </div>
                      <div className="border border-line bg-bg/60 p-2.5">
                        <div className="font-mono text-[10px] text-dim">{t("กลับมาใช้ซ้ำ (7 วันล่าสุด)")}</div>
                        <div className="mt-0.5 font-mono text-sm font-extrabold text-good">
                          {t(
                            "{0} เครื่อง ({1}%)",
                            (data.retention.active_returning_7d ?? data.retention.returning_clients).toLocaleString(),
                            data.retention.active_returning_7d_pct ?? data.retention.returning_pct,
                          )}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-muted">
                          {t(
                            "ขาประจำ 3+ วัน: {0} · แวะ 2 วัน: {1}",
                            data.retention.active_repeat_3plus_7d ?? 0,
                            data.retention.active_returned_once_7d ?? 0,
                          )}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-dim">
                          {t(
                            "สะสม {0} · หาย >7 วัน {1}",
                            data.retention.returning_clients,
                            data.retention.dormant_returning ?? 0,
                          )}
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

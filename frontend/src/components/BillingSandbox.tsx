import { ArrowLeft, ArrowRight, Check, CreditCard, Crosshair, Gift, Users, UsersRound } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError, getJson, postJson } from "../api/client";
import { useLanguage } from "../i18n/language";
import { handleSpaLinkClick, navigateTo } from "../utils/navigation";
import { Alert } from "./Alert";
import { StableButtonLabel } from "./StableButtonLabel";

type Tier = "pro" | "duo" | "team_pro";
type OrderStatus = "pending" | "paid" | "closed";

interface PrepaidPass {
  tier: Tier;
  days: 30 | 90;
  amount: number;
}

interface BillingOrder extends PrepaidPass {
  id: string;
  status: OrderStatus;
  paid_at: number | null;
}

interface BillingSummary {
  packages: PrepaidPass[];
  active_pass: {
    tier: Tier;
    expires_at: number;
    is_owner: boolean;
    source?: "paid" | "promo_free" | "team_member" | "manual" | null;
  } | null;
  orders: BillingOrder[];
  promo_claimable?: boolean;
  promo_expires_at?: number | null;
  is_owner_account?: boolean;
}

interface TierDetails {
  description: string;
  seats: 1 | 2 | 5;
  badge?: string;
  badgeClass?: string;
  benefits: readonly string[];
  Icon: typeof Crosshair;
  cardClass: string;
  iconClass: string;
  actionClass: string;
}

const tierNames: Record<Tier, string> = { pro: "Pro", duo: "Duo", team_pro: "Business" };
const tierDetails: Record<Tier, TierDetails> = {
  pro: {
    description: "สำหรับ 1 บัญชี",
    seats: 1,
    badge: "ยอดนิยม",
    badgeClass: "border-gold/50 bg-gold/15 text-gold",
    benefits: [
      "ประวัติส่วนตัว 500 เกม",
      "Hero Pools ส่วนตัว 50 ชุด",
      "สถิติซ้อมทีมจากข้อมูลตัวเอง",
    ],
    Icon: Crosshair,
    cardClass: "border-gold/50 from-gold/12 ring-1 ring-gold/25",
    iconClass: "border-gold/35 bg-gold/15 text-gold",
    actionClass: "border-gold bg-gold text-bg enabled:hover:bg-gold/90",
  },
  duo: {
    description: "สำหรับ 2 บัญชี",
    seats: 2,
    benefits: [
      "สิทธิ์ Pro ครบทุกฟีเจอร์สำหรับ 2 บัญชี",
      "ชวนเพื่อนเข้ากลุ่ม 1 คนผ่านหน้าโปรไฟล์",
      "แยกประวัติและ Hero Pools ส่วนตัวคนละชุด",
    ],
    Icon: Users,
    cardClass: "border-good/30 from-good/10",
    iconClass: "border-good/30 bg-good/10 text-good",
    actionClass: "border-good/60 bg-good/15 text-good enabled:hover:bg-good enabled:hover:text-bg",
  },
  team_pro: {
    description: "สำหรับทีมสูงสุด 5 บัญชี",
    seats: 5,
    badge: "คุ้มสุดต่อคน",
    badgeClass: "border-blue/50 bg-blue/15 text-blue",
    benefits: [
      "สิทธิ์ Pro ครบทุกฟีเจอร์สูงสุด 5 บัญชี",
      "แชร์ประวัติทีมร่วมกัน 500 เกม + วิเคราะห์สถิติทีม",
      "แชร์ Hero Pools ทีม 50 ชุด + จัดการสมาชิก",
    ],
    Icon: UsersRound,
    cardClass: "border-blue/35 from-blue/10",
    iconClass: "border-blue/30 bg-blue/10 text-blue",
    actionClass: "border-blue/60 bg-blue/15 text-blue enabled:hover:bg-blue enabled:hover:text-bg",
  },
};
const comparisonRows: readonly { feature: string; free: string | null; pro: string | null; duo: string | null; team_pro: string }[] = [
  {
    feature: "Draft Board + AI + Global Ban",
    free: "✓",
    pro: "✓",
    duo: "✓",
    team_pro: "✓",
  },
  {
    feature: "จำนวนบัญชี",
    free: "1",
    pro: "1",
    duo: "2",
    team_pro: "สูงสุด 5",
  },
  {
    feature: "ประวัติส่วนตัว",
    free: "14 เกม",
    pro: "500 เกม",
    duo: "คนละ 500 เกม",
    team_pro: "คนละ 500 เกม",
  },
  {
    feature: "ประวัติดราฟต์ vs AI",
    free: "100 เกม",
    pro: "1,000 เกม",
    duo: "คนละ 1,000 เกม",
    team_pro: "คนละ 1,000 เกม",
  },
  {
    feature: "Hero Pools ส่วนตัว",
    free: "2 ชุด",
    pro: "50 ชุด",
    duo: "คนละ 50 ชุด",
    team_pro: "คนละ 50 ชุด",
  },
  {
    feature: "สถิติซ้อมทีม",
    free: "โหมดตัวอย่าง",
    pro: "ข้อมูลตัวเอง",
    duo: "ข้อมูลตัวเอง",
    team_pro: "ข้อมูลตัวเอง & ทีม",
  },
  {
    feature: "พื้นที่แชร์ร่วมกันในทีม",
    free: null,
    pro: null,
    duo: null,
    team_pro: "500 เกม · 50 ชุด",
  },
];
const passDurations = [30, 90] as const;
const statusMessages: Record<OrderStatus, string> = {
  pending: "รอชำระเงิน",
  paid: "จ่ายสำเร็จ",
  closed: "ปิดรายการแล้ว",
};
const actionClass = "inline-flex min-h-10 items-center justify-center border px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-50";
const primaryAction = `${actionClass} border-gold bg-gold text-bg enabled:hover:bg-gold/90`;

export function BillingSandbox({
  username,
  view = "profile",
  livemode = false,
}: {
  username: string;
  view?: "profile" | "plans";
  livemode?: boolean;
}) {
  const { language, t } = useLanguage();
  const sectionId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [duration, setDuration] = useState<PrepaidPass["days"]>(30);
  const [processing, setProcessing] = useState<Tier | "cancel" | "promo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promoClaimedUntil, setPromoClaimedUntil] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [showAllOrders, setShowAllOrders] = useState(false);
  const [nowMs] = useState(Date.now);
  const busy = processing !== null;
  const pending = summary?.orders.find((order) => order.status === "pending");
  const activePass = summary?.active_pass;
  const isOwnerAccount = Boolean(summary?.is_owner_account) && activePass?.tier === "team_pro";
  const promoDaysLeft =
    activePass &&
    activePass.source === "promo_free" &&
    !isOwnerAccount &&
    activePass.expires_at * 1000 > nowMs
      ? Math.max(1, Math.ceil((activePass.expires_at * 1000 - nowMs) / 86_400_000))
      : null;
  const showPromoExpiringAlert = promoDaysLeft !== null && promoDaysLeft <= 4;
  const packages = summary?.packages ?? [];
  const proDisplayPackages: PrepaidPass[] = [
    { tier: "pro", days: 30, amount: 5900 },
    { tier: "pro", days: 90, amount: 13900 },
  ];
  const catalogDisplayPackages: PrepaidPass[] = [
    ...proDisplayPackages,
    { tier: "duo", days: 30, amount: 10900 },
    { tier: "duo", days: 90, amount: 25900 },
    { tier: "team_pro", days: 30, amount: 23900 },
    { tier: "team_pro", days: 90, amount: 56900 },
  ];
  const allDisplayPackages = isOwnerAccount
    ? catalogDisplayPackages
    : activePass?.tier === "pro" && !packages.some((pass) => pass.tier === "pro")
      ? [...proDisplayPackages, ...packages]
      : packages;
  const displayPackages = allDisplayPackages.filter((pass) => pass.days === duration);
  const maxSavingsPct = allDisplayPackages.reduce((best, pass) => {
    if (pass.days !== 90) return best;
    const monthly = allDisplayPackages.find((candidate) => candidate.tier === pass.tier && candidate.days === 30);
    if (!monthly || monthly.amount <= 0) return best;
    const pct = Math.round(((monthly.amount * 3 - pass.amount) / (monthly.amount * 3)) * 100);
    return Math.max(best, pct);
  }, 0);
  const canResume = pending && packages.some((pass) => pass.tier === pending.tier && pass.days === pending.days);
  const dateFormat = new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  useEffect(() => headingRef.current?.focus(), []);
  useEffect(() => {
    if (view === "profile" && activePass?.tier) {
      window.dispatchEvent(new Event("activepasschange"));
    }
  }, [view, activePass?.tier, activePass?.expires_at]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    async function load() {
      try {
        const data = await getJson<BillingSummary>("/billing", controller.signal);
        if (controller.signal.aborted) return;
        setSummary(data);
        if (data.orders.some((order) => order.status === "pending")) {
          timer = window.setTimeout(load, 4000);
        }
      } catch {
        if (!controller.signal.aborted) setError("โหลดข้อมูลการชำระเงินไม่สำเร็จ");
      }
    }
    const reloadOnReturn = () => setRefresh((value) => value + 1);
    void load();
    window.addEventListener("focus", reloadOnReturn);
    window.addEventListener("billingchange", reloadOnReturn);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      window.removeEventListener("focus", reloadOnReturn);
      window.removeEventListener("billingchange", reloadOnReturn);
    };
  }, [refresh]);

  async function checkout(pass: PrepaidPass) {
    setProcessing(pass.tier);
    setError(null);
    try {
      const { url } = await postJson<{ url: string | null }>("/billing/checkout", {
        tier: pass.tier,
        days: pass.days,
        expected_username: username,
      });
      if (url) {
        window.location.assign(url);
        return;
      }
      if (view === "plans") {
        navigateTo("/profile");
      }
    } catch (error) {
      const detail = error instanceof ApiError ? error.detail : null;
      const message = detail === "pending_order"
        ? "ปิดรายการเดิมก่อนเลือกแพ็กใหม่"
        : detail === "pass_active" || detail === "team_active" || detail === "duo_transition" || detail === "group_member"
          ? "แพ็กปัจจุบันยังไม่หมดอายุ"
          : "เปิดหน้าชำระเงินไม่สำเร็จ ลองอีกครั้ง";
      setError(message);
    }
    setRefresh((value) => value + 1);
    setProcessing(null);
  }

  async function cancel(order: BillingOrder) {
    setProcessing("cancel");
    setError(null);
    try {
      await postJson<void>(`/billing/orders/${order.id}/cancel`, { expected_username: username });
    } catch (error) {
      const message = error instanceof ApiError && error.detail === "checkout_pending"
        ? "กำลังรอ Stripe ยืนยันยอด"
        : "ปิดรายการไม่สำเร็จ ลองอีกครั้ง";
      setError(message);
    } finally {
      setRefresh((value) => value + 1);
      setProcessing(null);
    }
  }

  async function claimPromo() {
    setProcessing("promo");
    setError(null);
    setPromoClaimedUntil(null);
    try {
      const claimed = await postJson<{ tier: Tier; expires_at: number }>("/billing/promo/claim", {
        expected_username: username,
      });
      setPromoClaimedUntil(claimed.expires_at);
      window.dispatchEvent(new Event("activepasschange"));
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : null;
      const message = detail === "promo_ended"
        ? "หมดเวลารับสิทธิ์ Pro ฟรีแล้ว"
        : detail === "promo_already_claimed"
          ? "บัญชีนี้รับสิทธิ์ Pro ฟรีไปแล้ว"
          : detail === "pass_active"
            ? "บัญชีนี้มีแพ็กที่ใช้งานอยู่แล้ว"
            : "รับสิทธิ์ไม่สำเร็จ ลองอีกครั้ง";
      setError(message);
    } finally {
      setRefresh((value) => value + 1);
      setProcessing(null);
    }
  }

  function passLabel(pass: PrepaidPass) {
    return t("{0} · {1} วัน", tierNames[pass.tier], pass.days);
  }

  const paymentNotice = (
    <>
      {error && (
        <Alert>
          {t(error)}
          <button
            type="button"
            className="ml-2 min-h-7 font-semibold underline"
            onClick={() => { setError(null); setRefresh((value) => value + 1); }}
          >
            {t("เช็กสถานะ")}
          </button>
        </Alert>
      )}
      {!summary && !error && <p role="status" className="text-sm text-muted">{t("กำลังโหลด…")}</p>}
      {pending && (
        <div className="space-y-2 border border-line bg-bg p-3">
          <p role="status" className="text-sm text-ink">
            {passLabel(pending)} · {t("{0} บาท", pending.amount / 100)} · {t(statusMessages.pending)}
          </p>
          <div className="flex flex-wrap gap-2">
            {canResume && (
              <button
                type="button"
                disabled={busy}
                className={primaryAction}
                onClick={() => void checkout(pending)}
              >
                <StableButtonLabel message="จ่ายต่อ" />
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              className={`${actionClass} border-line-strong text-ink`}
              onClick={() => void cancel(pending)}
            >
              <StableButtonLabel message="ปิดรายการ" />
            </button>
          </div>
        </div>
      )}
    </>
  );

  if (view === "plans") {
    return (
      <main
        aria-labelledby={`${sectionId}-heading`}
        className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_top,var(--color-panel-2),transparent_32rem)] px-4 pt-3 pb-8 sm:px-6 sm:pt-6 sm:pb-12"
      >
        <div className={`mx-auto space-y-4 sm:space-y-6 ${displayPackages.length > 2 ? "max-w-6xl" : "max-w-4xl"}`}>
          <a
            href="/profile"
            onClick={(e) => handleSpaLinkClick(e, "/profile")}
            className="inline-flex min-h-9 items-center gap-2 text-sm font-medium text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-gold"
          >
            <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
            <StableButtonLabel message="กลับไปหน้าโปรไฟล์" />
          </a>
          <header className="space-y-2 px-2 text-center sm:space-y-3 sm:py-2">
            <h1
              ref={headingRef}
              id={`${sectionId}-heading`}
              tabIndex={-1}
              className="font-display text-3xl leading-tight font-extrabold tracking-tight text-ink outline-none sm:text-5xl"
            >
              {t("เลือกแพ็ก MiniDraft")}
            </h1>
            <p className="flex flex-wrap justify-center gap-x-2 text-sm text-muted sm:text-base">
              <span>{t("ชำระผ่าน PromptPay · ไม่ต่ออายุอัตโนมัติ")}</span>
              {!livemode && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{t("โหมดทดสอบ")}</span>
                </>
              )}
            </p>
          </header>
          {paymentNotice}
          {promoClaimedUntil !== null && (
            <p role="status" className="border border-good/40 bg-good/10 px-4 py-2.5 text-center text-xs font-semibold text-good sm:text-sm">
              {t("รับสิทธิ์ Pro ฟรีเรียบร้อยแล้ว ใช้งานได้ถึง {0}", dateFormat.format(promoClaimedUntil * 1000))}
            </p>
          )}
          {summary?.promo_claimable && summary.promo_expires_at && (
            <div className="mx-auto flex max-w-2xl flex-col gap-3 border border-gold/50 bg-gold/10 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                <Gift className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
                <div className="min-w-0 space-y-0.5">
                  <p className="font-display text-sm font-bold text-gold">{t("รับสิทธิ์ Pro ฟรี")}</p>
                  <p className="text-xs leading-relaxed text-ink">
                    {t(
                      "ปลดล็อกประวัติ 500 เกม, Hero Pools 50 ชุด และสถิติซ้อมทีมฟรี (หมดอายุ {0} โดยข้อมูลไม่หาย)",
                      dateFormat.format(summary.promo_expires_at * 1000),
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                className={`${primaryAction} w-full shrink-0 sm:w-auto`}
                onClick={() => void claimPromo()}
              >
                <span>{processing === "promo" ? t("กำลังรับสิทธิ์…") : t("รับสิทธิ์ Pro ฟรี")}</span>
              </button>
            </div>
          )}
          {showPromoExpiringAlert && activePass && (
            <div className="mx-auto max-w-2xl border border-gold/60 bg-gold/15 px-4 py-3 text-center text-xs leading-relaxed text-ink sm:text-sm">
              <strong className="font-display text-gold">
                {t("สิทธิ์ Pro ฟรีจะหมดอายุในอีก {0} วัน ({1})", promoDaysLeft, dateFormat.format(activePass.expires_at * 1000))}
              </strong>
              {" — "}
              <span>{t("ข้อมูลทั้งหมดไม่หาย ต่อ Pro ได้หลังหมดอายุ หรืออัปเกรดเป็น Duo/Business ได้เลย")}</span>
            </div>
          )}
          {summary && !pending && (allDisplayPackages.length > 0 ? (
            <>
              {isOwnerAccount && (
                <p className="mx-auto max-w-2xl border border-purple-400/50 bg-purple-500/12 px-4 py-2 text-center text-xs text-purple-200">
                  {t("มุมมอง Owner — แสดงหน้าแพ็กเกจเหมือนผู้ใช้ทั่วไป (ปิดปุ่มชำระเงินไว้)")}
                </p>
              )}
              {activePass?.tier === "pro" && (
                <p className="mx-auto max-w-2xl border border-line-strong bg-panel px-4 py-2 text-center text-xs text-muted">
                  {t(
                    "คุณกำลังใช้งานแพ็ก Pro อยู่ — ต่ออายุ Pro ได้หลังหมดอายุ หรืออัปเกรดเป็น Duo/Business ได้ทันทีโดยแปลงวัน Pro ที่เหลือเป็นวันโบนัส",
                  )}
                </p>
              )}
              <fieldset
                className="relative mx-auto grid w-full max-w-72 grid-cols-2 border border-line-strong bg-bg/75 p-1"
                disabled={busy}
              >
                <legend className="sr-only">{t("ระยะเวลาแพ็ก")}</legend>
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] border border-gold/35 bg-gold/10 transition-transform duration-200 motion-reduce:transition-none ${duration === 90 ? "translate-x-full" : ""}`}
                />
                {passDurations.map((days) => (
                  <label key={days} className="relative min-w-0 cursor-pointer">
                    <input
                      className="peer sr-only"
                      type="radio"
                      name={`${sectionId}-duration`}
                      checked={duration === days}
                      onChange={() => setDuration(days)}
                    />
                    <span className="flex min-h-10 items-center justify-center gap-1.5 px-2 text-sm font-semibold text-muted hover:text-ink peer-checked:text-gold peer-focus-visible:outline-2 peer-focus-visible:outline-gold peer-disabled:opacity-50">
                      <span>{t("{0} วัน", days)}</span>
                      {days === 90 && maxSavingsPct > 0 && (
                        <span className="border border-good/40 bg-good/15 px-1.5 py-0.5 font-mono text-[10px] leading-none font-bold text-good">
                          -{maxSavingsPct}%
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className={displayPackages.length > 2
                ? "grid gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3"
                : displayPackages.length === 2 ? "grid gap-3 sm:grid-cols-2 sm:gap-5" : "mx-auto grid max-w-md"}>
                {displayPackages.map((pass) => {
                  const name = tierNames[pass.tier];
                  const details = tierDetails[pass.tier];
                  const Icon = details.Icon;
                  const monthly = allDisplayPackages.find((candidate) => candidate.tier === pass.tier && candidate.days === 30);
                  const savings = monthly && pass.days === 90 ? (monthly.amount * 3 - pass.amount) / 100 : 0;
                  const perSeatMonthly = details.seats > 1
                    ? Math.round(pass.amount / 100 / details.seats / (pass.days / 30))
                    : 0;
                  const isCurrentTier = !isOwnerAccount && activePass?.tier === pass.tier;
                  const isLockedCurrentTier =
                    isCurrentTier && !packages.some((candidate) => candidate.tier === pass.tier && candidate.days === pass.days);
                  return (
                    <article
                      key={pass.tier}
                      aria-labelledby={`${sectionId}-${pass.tier}`}
                      className={`flex min-w-0 flex-col border bg-panel bg-linear-to-b to-transparent p-4 shadow-[0_16px_36px_-24px_#000] sm:p-6 ${details.cardClass}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className={`clip-chamfer-sm grid size-10 shrink-0 place-items-center border ${details.iconClass}`}>
                            <Icon className="size-5" aria-hidden="true" />
                          </div>
                          <div className="min-w-0">
                            <h2 id={`${sectionId}-${pass.tier}`} className="font-display text-xl leading-tight font-bold text-ink sm:text-2xl">{name}</h2>
                            <p className="text-sm text-muted">{t(details.description)}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          {isCurrentTier && (
                            <span className="border border-good/50 bg-good/15 px-2 py-0.5 font-display text-[11px] font-bold tracking-wide whitespace-nowrap text-good">
                              {t("ใช้อยู่")}
                            </span>
                          )}
                          {details.badge && !isCurrentTier && (
                            <span className={`border px-2 py-0.5 font-display text-[11px] font-bold tracking-wide whitespace-nowrap ${details.badgeClass ?? ""}`}>
                              {t(details.badge)}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 sm:mt-5">
                        <span className="font-mono text-3xl leading-none font-bold tracking-tight text-ink tabular-nums sm:text-4xl">{pass.amount / 100}</span>
                        <span className="text-sm text-muted">{t("บาท")} / {t("{0} วัน", pass.days)}</span>
                      </p>
                      <p className="mt-1.5 flex min-h-5 flex-wrap items-center gap-x-2 text-xs leading-5">
                        {savings > 0 && (
                          <span className="font-semibold text-good">{t("ประหยัด {0} บาท", savings)}</span>
                        )}
                        {savings > 0 && perSeatMonthly > 0 && (
                          <span aria-hidden="true" className="text-dim">·</span>
                        )}
                        {perSeatMonthly > 0 && (
                          <span className="font-mono text-muted">{t("เฉลี่ย ~{0} บาท/คน/30 วัน", perSeatMonthly)}</span>
                        )}
                      </p>
                      {isLockedCurrentTier ? (
                        <button
                          type="button"
                          disabled
                          className={`${actionClass} mt-3 w-full cursor-not-allowed border-line-strong bg-panel-2 text-muted opacity-80`}
                        >
                          <span>{t("แพ็กเกจปัจจุบัน")}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy || isOwnerAccount}
                          className={`${actionClass} mt-3 w-full gap-2 transition-colors ${details.actionClass} ${isOwnerAccount ? "cursor-not-allowed opacity-70" : ""}`}
                          onClick={() => {
                            if (!isOwnerAccount) void checkout(pass);
                          }}
                        >
                          <span>
                            {processing === pass.tier
                              ? t("กำลังเปิดหน้าชำระเงิน…")
                              : activePass?.tier === "pro"
                                ? t("อัปเกรดเป็น {0}", name)
                                : t("เลือก {0}", name)}
                          </span>
                          <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
                        </button>
                      )}
                      <ul className="mt-4 space-y-2 border-t border-line-strong/70 pt-3 text-sm text-ink sm:mt-5 sm:pt-4">
                        {details.benefits.map((benefit) => (
                          <li key={benefit} className="flex items-start gap-2">
                            <Check className="mt-0.5 size-4 shrink-0 text-good" aria-hidden="true" />
                            <span>{t(benefit)}</span>
                          </li>
                        ))}
                      </ul>
                    </article>
                  );
                })}
              </div>

              <section aria-labelledby={`${sectionId}-compare`} className="border border-line bg-panel/70 p-4 sm:p-5">
                <h2 id={`${sectionId}-compare`} className="mb-3 font-display text-sm font-bold tracking-wide text-ink">
                  {t("เทียบสิทธิ์แต่ละแพ็ก")}
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[540px] border-collapse text-left text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-line-strong text-muted">
                        <th className="sticky left-0 z-10 bg-panel py-2 pr-3 font-display font-semibold">{t("ฟีเจอร์")}</th>
                        <th className="px-3 py-2 font-display font-semibold">Free</th>
                        <th className="px-3 py-2 font-display font-bold text-gold">Pro</th>
                        <th className="px-3 py-2 font-display font-bold text-good">Duo</th>
                        <th className="py-2 pl-3 font-display font-bold text-blue">Business</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/70">
                      {comparisonRows.map((row) => (
                        <tr key={row.feature}>
                          <td className="sticky left-0 z-10 bg-panel py-2.5 pr-3 font-medium text-ink">{t(row.feature)}</td>
                          <td className="px-3 py-2.5 font-mono text-muted">
                            {row.free === null ? <span className="text-dim">—</span> : row.free === "✓" ? <span className="font-bold text-good">✓</span> : t(row.free)}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-ink">
                            {row.pro === null ? <span className="text-dim">—</span> : row.pro === "✓" ? <span className="font-bold text-good">✓</span> : t(row.pro)}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-ink">
                            {row.duo === null ? <span className="text-dim">—</span> : row.duo === "✓" ? <span className="font-bold text-good">✓</span> : t(row.duo)}
                          </td>
                          <td className="py-2.5 pl-3 font-mono text-ink">
                            {row.team_pro === "✓" ? <span className="font-bold text-good">✓</span> : t(row.team_pro)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <p className="text-center text-xs text-muted">
                {t("เมื่อหมดอายุจะกลับเป็นแพ็ก Free โดยประวัติและข้อมูลทั้งหมดไม่หาย")}
              </p>
            </>
          ) : (
            <p role="status" className="border border-line bg-panel p-4 text-sm text-muted">
              {t("ซื้อแพ็กได้อีกครั้งหลังหมดอายุ")}
            </p>
          ))}
        </div>
      </main>
    );
  }

  return (
    <section aria-labelledby={`${sectionId}-heading`} className="border border-line bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-linear-to-r from-good/10 to-transparent p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="clip-chamfer-sm grid size-10 shrink-0 place-items-center border border-good/35 bg-good/10 text-good">
            <CreditCard className="size-5" aria-hidden="true" />
          </div>
          <h2 id={`${sectionId}-heading`} className="font-display text-lg font-bold text-ink">
            {t("แพ็กและการชำระเงิน")}
          </h2>
        </div>
        {!livemode && (
          <span className="border border-line-strong bg-panel-2 px-2 py-0.5 font-mono text-[11px] text-muted">
            {t("โหมดทดสอบ")}
          </span>
        )}
      </header>
      <div className="space-y-4 p-4 sm:p-5">
      {summary && (
        <div aria-live="polite" className="space-y-1">
          <p className="text-xs text-muted">{t("แพ็กปัจจุบัน")}</p>
          <p className="font-display text-base font-bold text-ink">
            {isOwnerAccount ? "Owner" : activePass ? tierNames[activePass.tier] : "Free"}
          </p>
          {isOwnerAccount ? (
            <p className="text-sm font-semibold text-gold">
              {t("สิทธิ์เจ้าของระบบ · ปลดล็อกทุกฟีเจอร์ถาวร")}
            </p>
          ) : (
            activePass && (
              <p className="text-sm font-semibold text-good">
                {t("ใช้ได้ถึง {0}", dateFormat.format(activePass.expires_at * 1000))}
              </p>
            )
          )}
          {!isOwnerAccount &&
            activePass &&
            (activePass.tier === "duo" || activePass.tier === "team_pro") &&
            activePass.is_owner && (
              <p className="pt-0.5 text-xs text-blue">
                <a href="#team-setup" className="font-semibold underline underline-offset-2 hover:text-ink">
                  {t("จัดการสมาชิกและเริ่มใช้งานทีมด้านล่าง")}
                </a>
              </p>
            )}
        </div>
      )}
      {showPromoExpiringAlert && activePass && (
        <div className="space-y-1.5 border border-gold/60 bg-gold/15 p-3 text-xs leading-relaxed text-ink">
          <p className="font-display font-bold text-gold">
            {t("สิทธิ์ Pro ฟรีจะหมดอายุในอีก {0} วัน ({1})", promoDaysLeft, dateFormat.format(activePass.expires_at * 1000))}
          </p>
          <p>{t("ข้อมูลทั้งหมดไม่หาย ต่อ Pro ได้หลังหมดอายุ หรืออัปเกรดเป็น Duo/Business ได้เลย")}</p>
        </div>
      )}
      {paymentNotice}
      {promoClaimedUntil !== null && (
        <p role="status" className="text-xs font-semibold text-good">
          {t("รับสิทธิ์ Pro ฟรีเรียบร้อยแล้ว ใช้งานได้ถึง {0}", dateFormat.format(promoClaimedUntil * 1000))}
        </p>
      )}
      {summary?.promo_claimable && summary.promo_expires_at && (
        <div className="space-y-2.5 border border-gold/50 bg-gold/10 p-3.5">
          <div className="flex items-start gap-2.5">
            <Gift className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-display text-sm font-bold text-gold">{t("รับสิทธิ์ Pro ฟรี")}</p>
              <p className="text-xs leading-relaxed text-ink">
                {t(
                  "ปลดล็อกประวัติ 500 เกม, Hero Pools 50 ชุด และสถิติซ้อมทีมฟรี (หมดอายุ {0} โดยข้อมูลไม่หาย)",
                  dateFormat.format(summary.promo_expires_at * 1000),
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            className={`${primaryAction} w-full sm:w-auto`}
            onClick={() => void claimPromo()}
          >
            <span>{processing === "promo" ? t("กำลังรับสิทธิ์…") : t("รับสิทธิ์ Pro ฟรี")}</span>
          </button>
        </div>
      )}
      {isOwnerAccount && !pending && (
        <a
          href="/plans"
          onClick={(e) => handleSpaLinkClick(e, "/plans")}
          className={`${actionClass} w-full gap-2 border-purple-400/60 bg-purple-500/12 text-purple-300 hover:border-purple-400 hover:bg-purple-500/20 sm:w-auto`}
        >
          <span>{t("ดูหน้าแพ็กเกจ")}</span>
          <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
        </a>
      )}
      {!isOwnerAccount && !pending && (packages.length > 0 ? (
        <a
          href="/plans"
          onClick={(e) => handleSpaLinkClick(e, "/plans")}
          className={`${actionClass} w-full gap-2 border-gold/60 text-gold hover:bg-gold/10 sm:w-auto`}
        >
          <StableButtonLabel message={activePass ? "จัดการ / เปลี่ยนแพ็ก" : "ดูแพ็ก"} alternatives={["จัดการ / เปลี่ยนแพ็ก", "ดูแพ็ก"]} />
          <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
        </a>
      ) : activePass && (
        <p className="text-xs text-muted">{t("ต่ออายุหรือเปลี่ยนแพ็กได้อีกครั้งหลังหมดอายุ")}</p>
      ))}
      {summary?.orders.some((order) => order.status !== "pending") && (() => {
        const completedOrders = summary.orders.filter((order) => order.status !== "pending");
        const visibleOrders = showAllOrders ? completedOrders : completedOrders.slice(0, 5);
        return (
        <div className="border-t border-line pt-3">
          <h3 className="text-sm font-semibold text-ink">{t("รายการล่าสุด")}</h3>
          <ul aria-label={t("รายการล่าสุด")} className="divide-y divide-line">
            {visibleOrders.map((order) => (
              <li key={order.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-xs text-muted">
                <span className="font-mono tabular-nums">{passLabel(order)} · {t("{0} บาท", order.amount / 100)}</span>
                <span className="flex items-center gap-1.5 font-mono tabular-nums">
                  <span className={`border px-1.5 py-0.5 text-[10px] font-semibold ${order.status === "paid" ? "border-good/40 bg-good/10 text-good" : "border-line bg-bg text-dim"}`}>
                    {t(statusMessages[order.status])}
                  </span>
                  {order.paid_at && <span>{dateFormat.format(order.paid_at * 1000)}</span>}
                </span>
              </li>
            ))}
          </ul>
          {completedOrders.length > 5 && (
            <button
              type="button"
              onClick={() => setShowAllOrders((prev) => !prev)}
              className="mt-2 inline-flex min-h-7 items-center border border-line-strong bg-panel-2 px-2.5 text-xs font-semibold text-ink hover:border-gold/50 hover:text-gold"
            >
              {showAllOrders ? t("ย่อรายการ") : t("ดูทั้งหมด ({0})", completedOrders.length)}
            </button>
          )}
        </div>
        );
      })()}
      </div>
    </section>
  );
}

import { useLanguage } from "../i18n/language";
import { StableButtonLabel } from "./StableButtonLabel";
import { Flame, Link2, Loader2, Shield, Sparkles, Swords, Trophy, Zap } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { DraftStep, Hero, HeroRecommendation, LaneKey } from "../types/draft";
import { LANE_SHORT, heroFitsLaneSet, heroLanes, laneKey, missingLaneKeys } from "../utils/draft";
import { displayName } from "../utils/heroNames";
import { HeroPortrait } from "./HeroPortrait";
import { LaneIcon } from "./LaneIcon";

const LANE_FILTER_TABS = [
  { key: "ALL", short: "ALL", label: "ALL" },
  { key: "DS_Lane", short: "DSL", label: "DSL" },
  { key: "Jungle", short: "JGL", label: "JGL" },
  { key: "Mid", short: "MID", label: "MID" },
  { key: "Dragon_Lane", short: "ADL", label: "ADL" },
  { key: "Roam", short: "SUP", label: "SUP" },
] as const;

interface AiPanelProps {
  recommendations: HeroRecommendation[];
  banUnlockedHeroes?: HeroRecommendation[];
  missingAllyLanes: string[];
  currentStep: DraftStep | null;
  heroMap: Map<string, Hero>;
  isLoading: boolean;
  blueWinRate: number;
  winHistory: number[];
  allowLock?: boolean;
  onLockHero: (name: string) => void;
  variant?: "full" | "ribbon";
  allyPoolName?: string;
  allyPoolHeroes?: Set<string>;
  allyPoolHeroLanes?: Map<string, Set<LaneKey>>;
  enemyPoolName?: string;
  enemyPoolHeroes?: Set<string>;
  filterByAllyPool?: boolean;
}

function Sparkline({ values }: { values: number[] }) {
  const pts = values
    .map((v, i) => [i, v] as const)
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v));
  if (pts.length < 2) return null;
  const w = 240;
  const h = 36;
  const maxStep = Math.max(9, ...pts.map(([i]) => i));
  const x = (i: number) => (i / maxStep) * w;
  const y = (v: number) => h - ((v - 30) / 40) * h;
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(Math.min(Math.max(v, 30), 70)).toFixed(1)}`);
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-full" aria-label="Blue win probability over the draft">
      <line x1="0" x2={w} y1={h / 2} y2={h / 2} stroke="var(--color-line-strong)" strokeDasharray="2 3" />
      <path d={d.join(" ")} fill="none" stroke="var(--color-gold)" strokeWidth="1.5" />
      <circle cx={x(last[0])} cy={y(Math.min(Math.max(last[1], 30), 70))} r="2.5" fill="var(--color-gold)" />
    </svg>
  );
}

export const AiPanel = memo(function AiPanel({
  recommendations,
  banUnlockedHeroes = [],
  missingAllyLanes,
  currentStep,
  heroMap,
  isLoading,
  blueWinRate,
  winHistory,
  allowLock = true,
  onLockHero,
  variant = "full",
  allyPoolName,
  allyPoolHeroes,
  allyPoolHeroLanes,
  enemyPoolName,
  enemyPoolHeroes,
  filterByAllyPool = false,
}: AiPanelProps) {
  const { t } = useLanguage();
  const [laneFilterState, setLaneFilterState] = useState<{ step: number | undefined; lane: string }>({
    step: currentStep?.step,
    lane: "ALL",
  });
  const selectedLane = laneFilterState.step === currentStep?.step ? laneFilterState.lane : "ALL";
  const toggleLane = (key: string) => {
    setLaneFilterState((prev) => {
      const current = prev.step === currentStep?.step ? prev.lane : "ALL";
      return {
        step: currentStep?.step,
        lane: current === key && key !== "ALL" ? "ALL" : key,
      };
    });
  };

  const isBan = currentStep?.action === "ban";
  const sideText = currentStep?.side === "blue" ? "text-blue" : "text-red";
  const missing = useMemo(
    () => (isBan ? new Set<string>() : missingLaneKeys(missingAllyLanes)),
    [isBan, missingAllyLanes],
  );
  const effectivePickPoolLanes = isBan ? undefined : allyPoolHeroLanes;

  const { shown, maxProb } = useMemo(() => {
    const targetPoolHeroes = isBan ? enemyPoolHeroes : allyPoolHeroes;
    const poolMatches =
      filterByAllyPool && targetPoolHeroes && targetPoolHeroes.size > 0
        ? recommendations.filter((r) => targetPoolHeroes.has(r.hero_name))
        : [];
    const poolFiltered = poolMatches.length > 0 ? poolMatches : recommendations;
    let filteredRecs: HeroRecommendation[];
    if (selectedLane === "ALL") {
      const missingMatches =
        !isBan && missing.size > 0 && missing.size < 5
          ? poolFiltered.filter((r) => heroFitsLaneSet(r.hero_name, r.primary_lane, missing, effectivePickPoolLanes))
          : poolFiltered;
      const baseList = missingMatches.length > 0 ? missingMatches : poolFiltered;
      filteredRecs = baseList.map((r, i) => ({ ...r, rank: i + 1 }));
    } else {
      filteredRecs = poolFiltered
        .filter((r) => {
          if (effectivePickPoolLanes?.get(r.hero_name)?.has(selectedLane as LaneKey)) return true;
          if (laneKey(r.primary_lane) === selectedLane) return true;
          const h = heroMap.get(r.hero_name);
          return Boolean(h && heroLanes(h.lane).includes(selectedLane));
        })
        .map((r, i) => ({ ...r, rank: i + 1 }));
    }
    const nextShown = filteredRecs.slice(0, 5);
    return {
      shown: nextShown,
      maxProb: Math.max(...nextShown.map((r) => r.probability_pct), 1),
    };
  }, [
    isBan,
    enemyPoolHeroes,
    allyPoolHeroes,
    filterByAllyPool,
    recommendations,
    selectedLane,
    missing,
    effectivePickPoolLanes,
    heroMap,
  ]);

  if (!currentStep) {
    const blueWins = blueWinRate >= 50;
    if (variant === "ribbon") {
      return (
        <section className="flex shrink-0 items-center justify-between gap-2 border border-line bg-panel px-3 py-1.5">
          <div className="flex items-center gap-2">
            <Trophy className={`h-4 w-4 ${blueWins ? "text-blue" : "text-red"}`} />
            <span className="font-display text-xs font-bold tracking-wider text-gold">DRAFT COMPLETE</span>
          </div>
          <div className={`font-mono text-xs font-bold tabular-nums ${blueWins ? "text-blue" : "text-red"}`}>
            {blueWins ? "BLUE" : "RED"} FAVOURED ({(blueWins ? blueWinRate : 100 - blueWinRate).toFixed(1)}%)
          </div>
        </section>
      );
    }
    return (
      <section className="flex shrink-0 flex-col items-center justify-center gap-2 border border-line bg-panel p-4 text-center clip-chamfer sm:flex-row sm:justify-between sm:px-6 sm:py-3">
        <div className="flex items-center gap-3">
          <Trophy className={`h-7 w-7 shrink-0 ${blueWins ? "text-blue" : "text-red"}`} />
          <div className="text-left">
            <div className="font-display text-[10px] font-semibold tracking-[0.2em] text-muted">DRAFT COMPLETE</div>
            <div className={`font-mono text-xl font-bold tabular-nums sm:text-2xl ${blueWins ? "text-blue" : "text-red"}`}>
              {blueWins ? "BLUE" : "RED"} FAVOURED ·{" "}
              {(blueWins ? blueWinRate : 100 - blueWinRate).toFixed(1)}%
            </div>
          </div>
        </div>
        <div className="w-full max-w-[240px]">
          <Sparkline values={winHistory} />
        </div>
      </section>
    );
  }

  if (variant === "ribbon") {
    return (
      <section className="flex shrink-0 items-center gap-1.5 border border-line bg-panel px-2 py-1">
        <div className="flex shrink-0 items-center gap-1 pr-1 border-r border-line">
          <Sparkles className="h-3 w-3 text-gold" />
          <span className="font-display text-[10.5px] font-bold tracking-wider">
            AI <span className={sideText}>{isBan ? "BAN" : "PICK"}</span>
          </span>
          {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted" />}
        </div>

        <div
          className={`flex min-w-0 flex-1 items-center gap-1 overflow-x-auto transition-opacity ${
            isLoading ? "opacity-50" : ""
          }`}
        >
          {isLoading && shown.length === 0 ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-7 w-20 shrink-0 animate-pulse bg-panel-2" />
            ))
          ) : shown.length === 0 ? (
            <span className="py-1 font-mono text-[10px] text-muted">{t("ไม่มีคำแนะนำ")}</span>
          ) : (
            <>
              {shown.map((rec, idx) => {
                const hero = heroMap.get(rec.hero_name);
                const win = rec.lookahead_win_rate_pct ?? rec.predicted_win_rate_pct;
                const lane = laneKey(rec.primary_lane);
                const fillsLane =
                  !isBan &&
                  missing.size > 0 &&
                  missing.size < 5 &&
                  heroFitsLaneSet(rec.hero_name, rec.primary_lane, missing, effectivePickPoolLanes);
                return (
                  <button
                    type="button"
                    key={rec.hero_name}
                    disabled={!allowLock}
                    onClick={() => onLockHero(rec.hero_name)}
                    title={`#${rec.rank} ${displayName(rec.hero_name)} (${LANE_SHORT[lane]?.en ?? lane} · ${win.toFixed(1)}%)`}
                    className={`flex h-7 shrink-0 items-center gap-1 border px-1.5 transition-colors disabled:cursor-not-allowed ${
                      idx === 0
                        ? "border-gold/70 bg-gold/10 enabled:hover:bg-gold/20"
                        : "border-line bg-bg enabled:hover:border-line-strong enabled:hover:bg-panel-2"
                    }`}
                  >
                    <span
                      className={`font-mono text-[9px] font-bold ${idx === 0 ? "text-gold" : "text-muted"}`}
                    >
                      #{rec.rank}
                    </span>
                    <div className="h-4.5 w-4.5 shrink-0 overflow-hidden border border-line">
                      <HeroPortrait name={rec.hero_name} hero={hero} />
                    </div>
                    <span className="max-w-[68px] truncate font-display text-[10.5px] font-bold text-ink">
                      {displayName(rec.hero_name)}
                    </span>
                    {!isBan && allyPoolHeroes?.has(rec.hero_name) && (
                      <span className="border border-gold/60 bg-gold/15 px-1 font-mono text-[8px] font-bold text-gold">
                        POOL
                      </span>
                    )}
                    {isBan && enemyPoolHeroes?.has(rec.hero_name) && (
                      <span
                        title={enemyPoolName ? `${enemyPoolName}` : undefined}
                        className="max-w-[72px] truncate border border-red/60 bg-red/15 px-1 font-mono text-[8px] font-bold text-red"
                      >
                        {enemyPoolName ? enemyPoolName : "TARGET"}
                      </span>
                    )}
                    <span
                      className={`font-mono text-[9px] font-semibold tabular-nums ${
                        fillsLane || win >= 50 ? "text-good" : "text-muted"
                      }`}
                    >
                      {win.toFixed(0)}% WR
                    </span>
                  </button>
                );
              })}
              {banUnlockedHeroes.slice(0, 2).map((u) => (
                <button
                  type="button"
                  key={`unlock-${u.hero_name}`}
                  disabled={!allowLock}
                  onClick={() => onLockHero(u.hero_name)}
                  className="flex h-7 shrink-0 items-center gap-1 border border-gold/50 bg-gold/10 px-1.5 font-display text-[10px] font-bold text-gold disabled:cursor-not-allowed"
                >
                  <Flame className="h-3 w-3 shrink-0" />
                  <span className="max-w-[96px] truncate">{displayName(u.hero_name)}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-col overflow-hidden border border-line bg-panel clip-chamfer">
      {/* Compact Header with Inline Lane Filter Tabs, Missing Lanes & Unlocked Heroes */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-2.5 py-1 xl:px-3.5 xl:py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-gold" />
          <h2 className="truncate font-display text-xs font-bold tracking-wider sm:text-base">
            {isBan ? "BAN PRIORITY" : "PICK PRIORITY"}
            <span className={`ml-1.5 ${sideText}`}>· {currentStep.side.toUpperCase()}</span>
          </h2>
          {isLoading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted" />}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Interactive Lane Filter Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-1" role="group" aria-label={t("กรองตำแหน่งที่แนะนำ")}>
            {LANE_FILTER_TABS.map((tab) => {
              const active = selectedLane === tab.key;
              const isMissing = !isBan && tab.key !== "ALL" && missing.size < 5 && missing.has(tab.key);
              return (
                <button
                  type="button"
                  key={tab.key}
                  onClick={() => toggleLane(tab.key)}
                  title={
                    tab.key === "ALL"
                      ? t("แสดงคำแนะนำทุกตำแหน่ง")
                      : t("กรองเฉพาะตำแหน่ง {0}{1}", t(tab.label), isMissing ? t(" (เลนที่ทีมยังขาด)") : "")
                  }
                  className={`border h-8 sm:h-7 px-2.5 sm:px-1.5 font-mono text-xs sm:text-[10px] font-bold transition-colors touch-manipulation inline-flex items-center justify-center gap-1 shrink-0 ${
                    active
                      ? "border-ink/55 bg-panel-2 text-ink shadow-sm"
                      : isMissing
                        ? "border-good/60 bg-good/10 text-good hover:bg-good/20"
                        : "border-line bg-bg text-muted hover:border-line-strong hover:text-ink"
                  }`}
                >
                  {tab.key !== "ALL" && <LaneIcon lane={tab.key} className="h-3.5 w-3.5 sm:h-3 sm:w-3" />}
                  <span className={tab.key === "ALL" ? undefined : "hidden sm:inline"}>
                    <StableButtonLabel message={tab.label} />
                  </span>
                  {isMissing && !active && (
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-good" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Ban-Unlocked Heroes strip */}
      {banUnlockedHeroes.length > 0 && (
        <div className="flex shrink-0 flex-nowrap items-center gap-1.5 overflow-x-auto border-b border-line bg-gold/5 px-2.5 py-1 sm:gap-2 xl:px-3.5">
          <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold text-gold sm:text-[11px]">
            <Flame className="h-3.5 w-3.5 shrink-0" />
            {t("ตัวหลุดแบน:")}
          </span>
          {banUnlockedHeroes.slice(0, 4).map((u) => {
            const triggers = (u.triggered_by ?? []).map(displayName).join(", ");
            return (
              <button
                type="button"
                key={u.hero_name}
                disabled={!allowLock}
                onClick={() => onLockHero(u.hero_name)}
                title={triggers ? t("เก่งขึ้นเพราะแบน {0}", triggers) : undefined}
                className="flex min-h-7 shrink-0 items-center gap-1.5 border border-gold/40 bg-panel px-2 py-1 text-left transition-colors enabled:hover:border-gold enabled:hover:bg-panel-2 disabled:cursor-not-allowed"
              >
                <div className="h-4.5 w-4.5 shrink-0 overflow-hidden">
                  <HeroPortrait name={u.hero_name} hero={heroMap.get(u.hero_name)} />
                </div>
                <span className="font-display text-[11px] font-bold whitespace-nowrap text-ink">
                  {displayName(u.hero_name)}
                </span>
                {triggers && <span className="font-mono text-[9px] whitespace-nowrap text-gold">{t("← แบน")} {triggers}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Recommendation list: vertical on Mobile/iPad, 5-column horizontal deck on Laptop/Desktop (lg+) */}
      <ol
        className={`min-h-0 flex-1 divide-y divide-line overflow-y-auto transition-opacity lg:grid lg:grid-cols-5 lg:divide-x lg:divide-y-0 lg:overflow-hidden ${
          isLoading ? "opacity-50" : ""
        }`}
      >
        {isLoading && shown.length === 0 &&
          Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex h-[60px] items-center gap-3 px-3 lg:h-[128px] lg:flex-col lg:justify-center">
              <div className="h-11 w-11 animate-pulse bg-panel-2" />
              <div className="h-3.5 w-24 animate-pulse bg-panel-2" />
            </li>
          ))}
        {!isLoading && shown.length === 0 && (
          <li className="col-span-5 flex h-[60px] items-center justify-center p-4 font-mono text-xs text-muted lg:h-[128px]">
            {t("ไม่มีคำแนะนำสำหรับตำแหน่งนี้")}
          </li>
        )}
        {shown.map((rec, idx) => {
          const hero = heroMap.get(rec.hero_name);
          const lane = laneKey(rec.primary_lane);
          const fillsLane =
            !isBan &&
            missing.size > 0 &&
            missing.size < 5 &&
            heroFitsLaneSet(rec.hero_name, rec.primary_lane, missing, effectivePickPoolLanes);
          const triggerNames = (rec.triggered_by ?? []).map(displayName);
          const triggerTitle =
            rec.trigger_reason === "counter"
              ? t("แก้ทาง {0}", triggerNames.join(", "))
              : rec.trigger_reason === "combo"
                ? t("คอมโบกับ {0}", triggerNames.join(", "))
                : isBan || rec.trigger_reason === "protect"
                  ? t("เซฟ {0}", triggerNames.join(", "))
                  : t("ไร้ตัวแก้จากการแบน {0}", triggerNames.join(", "));

          const triggerBadgeText =
            rec.trigger_reason === "counter"
              ? t("ชนะทาง {0}", triggerNames.join(", "))
              : rec.trigger_reason === "combo"
                ? t("คู่ {0}", triggerNames.join(", "))
                : isBan || rec.trigger_reason === "protect"
                  ? t("เซฟ {0}", triggerNames.join(", "))
                  : t("ไร้ตัวแก้ ({0})", triggerNames.join(", "));

          const TriggerIcon =
            rec.trigger_reason === "counter"
              ? Swords
              : rec.trigger_reason === "combo"
                ? Link2
                : isBan || rec.trigger_reason === "protect"
                  ? Shield
                  : Zap;

          const triggerBadgeClass =
            rec.trigger_reason === "counter"
              ? "border-red/50 bg-red/10 text-red"
              : rec.trigger_reason === "combo"
                ? "border-blue/50 bg-blue/10 text-blue"
                : "border-gold/40 bg-gold/10 text-gold";

          return (
            <li key={rec.hero_name} className="min-w-0 overflow-hidden">
              <button
                type="button"
                disabled={!allowLock}
                onClick={() => onLockHero(rec.hero_name)}
                className={`group flex h-full w-full min-w-0 items-center gap-2.5 overflow-hidden px-3 py-2 text-left transition-colors enabled:hover:bg-panel-2 disabled:cursor-not-allowed sm:px-3.5 sm:py-2.5 lg:flex-col lg:items-stretch lg:justify-between lg:gap-1 lg:p-1.5 xl:gap-1.5 xl:p-2.5 ${
                  idx === 0 ? "bg-gold/[0.04]" : ""
                }`}
              >
                {/* 1. Desktop Layout (lg+): Vertical Stack, Full-Width Trigger Badge & Probability Bar */}
                <div className="hidden w-full min-w-0 flex-col items-center gap-1 lg:flex xl:gap-1.5">
                  {/* Portrait + Rank */}
                  <div
                    className={`relative h-9 w-9 shrink-0 overflow-hidden border xl:h-13 xl:w-13 ${
                      idx === 0 ? "border-gold/70 ring-1 ring-gold/40" : "border-line"
                    }`}
                  >
                    <HeroPortrait name={rec.hero_name} hero={hero} />
                    <span
                      className={`absolute top-0 left-0 px-1.5 font-mono text-[9px] font-bold ${
                        idx === 0 ? "bg-gold text-bg" : "bg-bg/85 text-ink"
                      }`}
                    >
                      #{rec.rank}
                    </span>
                  </div>

                  {/* Name + Lane */}
                  <div className="flex w-full min-w-0 items-baseline justify-between gap-1">
                    <span className="truncate font-display text-[11px] font-bold leading-tight text-ink xl:text-sm">
                      {displayName(rec.hero_name)}
                    </span>
                    <span
                      className={`shrink-0 font-mono text-[9px] font-bold ${
                        fillsLane ? "border border-good/50 bg-good/10 px-1 text-good" : "text-muted"
                      }`}
                      title={fillsLane ? t("เติมเลนที่ยังขาด: {0}", LANE_SHORT[lane]?.th ?? lane) : undefined}
                    >
                      {fillsLane && "+"}
                      {LANE_SHORT[lane]?.en ?? lane}
                    </span>
                  </div>

                  {/* Full-width Trigger Badge */}
                  {!isBan && allyPoolHeroes?.has(rec.hero_name) && (
                    <span className="w-full truncate border border-gold/60 bg-gold/10 px-1 py-0.2 text-center font-mono text-[8.5px] font-bold text-gold">
                      POOL{allyPoolName ? ` · ${allyPoolName}` : ""}
                    </span>
                  )}
                  {isBan && enemyPoolHeroes?.has(rec.hero_name) && (
                    <span className="w-full truncate border border-red/60 bg-red/10 px-1 py-0.2 text-center font-mono text-[8.5px] font-bold text-red">
                      ENEMY POOL{enemyPoolName ? ` · ${enemyPoolName}` : ""}
                    </span>
                  )}
                  {triggerNames.length > 0 ? (
                    <div className="w-full min-w-0" title={triggerTitle}>
                      <span
                        className={`flex w-full items-center justify-center gap-1 border px-1 py-0.5 font-mono text-[9px] leading-tight ${triggerBadgeClass}`}
                      >
                        <TriggerIcon className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{triggerBadgeText}</span>
                      </span>
                    </div>
                  ) : (
                    <div className="w-full truncate text-center font-mono text-[10px] text-dim">{rec.primary_role}</div>
                  )}

                  {/* Probability Bar */}
                  <div className="flex w-full items-center gap-1 pt-0.5">
                    <div className="h-1.5 min-w-0 flex-1 bg-panel-2">
                      <div
                        className={idx === 0 ? "h-full bg-gold" : "h-full bg-muted/60"}
                        style={{ width: `${(rec.probability_pct / maxProb) * 100}%` }}
                      />
                    </div>
                    <span className="shrink-0 font-mono text-[10px] font-bold tabular-nums text-ink">
                      {rec.probability_pct.toFixed(0)}%
                    </span>
                  </div>
                </div>

                {/* 2. Mobile & Tablet Layout (<lg): Horizontal Row */}
                <div className="flex w-full min-w-0 items-center gap-2.5 lg:hidden">
                  <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
                    <span className={`w-3.5 shrink-0 font-mono text-xs font-bold sm:w-4 sm:text-sm ${idx === 0 ? "text-gold" : "text-dim"}`}>
                      {rec.rank}
                    </span>
                    <div
                      className={`relative h-10 w-10 shrink-0 overflow-hidden border sm:h-11 sm:w-11 ${
                        idx === 0 ? "border-gold/70 ring-1 ring-gold/40" : "border-line"
                      }`}
                    >
                      <HeroPortrait name={rec.hero_name} hero={hero} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-display text-sm font-bold leading-tight tracking-wide sm:text-base">
                          {displayName(rec.hero_name)}
                        </span>
                        {!isBan && allyPoolHeroes?.has(rec.hero_name) && (
                          <span className="shrink-0 border border-gold/60 bg-gold/10 px-1 font-mono text-[8.5px] font-bold text-gold">
                            POOL
                          </span>
                        )}
                        {isBan && enemyPoolHeroes?.has(rec.hero_name) && (
                          <span
                            title={enemyPoolName ? `${enemyPoolName}` : undefined}
                            className="max-w-[72px] shrink-0 truncate border border-red/60 bg-red/10 px-1 font-mono text-[8.5px] font-bold text-red"
                          >
                            {enemyPoolName ? enemyPoolName : "TARGET"}
                          </span>
                        )}
                        <span
                          className={`inline-flex shrink-0 items-center gap-1 font-mono text-[9.5px] font-bold sm:text-[10px] ${
                            fillsLane ? "border border-good/50 bg-good/10 p-0.5 text-good sm:px-1 sm:py-0" : "text-muted"
                          }`}
                          title={fillsLane ? t("เติมเลนที่ยังขาด: {0}", LANE_SHORT[lane]?.th ?? lane) : LANE_SHORT[lane]?.th ?? lane}
                          aria-label={LANE_SHORT[lane]?.th ?? lane}
                        >
                          <LaneIcon lane={lane} className="h-3 w-3 shrink-0" />
                          <span className="hidden sm:inline">
                            {fillsLane && "+"}
                            {LANE_SHORT[lane]?.en ?? lane}
                          </span>
                        </span>
                      </div>

                      {/* Trigger badge */}
                      {triggerNames.length > 0 ? (
                        <div className="mt-0.5 min-w-0" title={triggerTitle}>
                          <span
                            className={`inline-flex max-w-full items-center gap-1 border px-1 py-0.5 font-mono text-[9px] leading-tight ${triggerBadgeClass}`}
                          >
                            <TriggerIcon className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                            <span className="truncate">{triggerBadgeText}</span>
                          </span>
                        </div>
                      ) : (
                        <div className="mt-0.5 truncate text-[10.5px] text-dim">{rec.primary_role}</div>
                      )}

                      {/* Probability bar */}
                      <div className="mt-1 flex items-center gap-1.5">
                        <div className="h-1.5 min-w-0 flex-1 bg-panel-2">
                          <div
                            className={idx === 0 ? "h-full bg-gold" : "h-full bg-muted/60"}
                            style={{ width: `${(rec.probability_pct / maxProb) * 100}%` }}
                          />
                        </div>
                        <span className="shrink-0 font-mono text-[10px] text-muted tabular-nums">
                          {rec.probability_pct.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ol>

      {winHistory.filter((v) => v !== undefined).length >= 2 && (
        <div className="shrink-0 border-t border-line px-3 pt-1.5 pb-1 lg:hidden">
          <div className="flex items-center justify-between font-display text-[9px] tracking-wider text-dim">
            <span>BLUE WIN TREND</span>
            <span>50%</span>
          </div>
          <Sparkline values={winHistory} />
        </div>
      )}
    </section>
  );
});

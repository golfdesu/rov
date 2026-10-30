import { Flame, Loader2, Sparkles, Trophy } from "lucide-react";
import type { DraftStep, Hero, HeroRecommendation } from "../types/draft";
import { LANE_SHORT, laneKey, missingLaneKeys } from "../utils/draft";
import { displayName } from "../utils/heroNames";
import { HeroPortrait } from "./HeroPortrait";

interface AiPanelProps {
  recommendations: HeroRecommendation[];
  banUnlockedHeroes?: HeroRecommendation[];
  missingAllyLanes: string[];
  currentStep: DraftStep | null;
  heroMap: Map<string, Hero>;
  isLoading: boolean;
  useLookahead: boolean;
  blueWinRate: number;
  winHistory: number[];
  onLockHero: (name: string) => void;
  variant?: "full" | "ribbon";
}

function Sparkline({ values }: { values: number[] }) {
  const pts = values.map((v, i) => [i, v] as const).filter(([, v]) => v !== undefined);
  if (pts.length < 2) return null;
  const w = 240;
  const h = 36;
  const x = (i: number) => (i / 17) * w;
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

export function AiPanel({
  recommendations,
  banUnlockedHeroes = [],
  missingAllyLanes,
  currentStep,
  heroMap,
  isLoading,
  useLookahead,
  blueWinRate,
  winHistory,
  onLockHero,
  variant = "full",
}: AiPanelProps) {
  if (!currentStep) {
    const blueWins = blueWinRate >= 50;
    if (variant === "ribbon") {
      return (
        <section className="flex shrink-0 items-center justify-between gap-2 border border-line bg-panel px-3 py-1.5">
          <div className="flex items-center gap-2">
            <Trophy className={`h-4 w-4 ${blueWins ? "text-blue" : "text-red"}`} />
            <span className="font-display text-xs font-bold tracking-wider text-gold">DRAFT COMPLETE</span>
          </div>
          <div className={`font-mono text-xs font-bold ${blueWins ? "text-blue" : "text-red"}`}>
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
            <div className={`font-display text-xl font-bold sm:text-2xl ${blueWins ? "text-blue" : "text-red"}`}>
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

  const isBan = currentStep.action === "ban";
  const sideText = currentStep.side === "blue" ? "text-blue" : "text-red";
  const shown = recommendations.slice(0, 5);
  const maxProb = Math.max(...shown.map((r) => r.probability_pct), 1);
  const missing = isBan ? new Set<string>() : missingLaneKeys(missingAllyLanes);

  if (variant === "ribbon") {
    return (
      <section className="flex shrink-0 flex-col border border-line bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-line px-2.5 py-1.5">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-gold" />
            <span className="font-display text-xs font-bold tracking-wider">
              AI {isBan ? "BAN" : "PICK"}
              <span className={`ml-1 ${sideText}`}>· {currentStep.side.toUpperCase()}</span>
            </span>
            {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted" />}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {!isBan &&
              missingAllyLanes.length > 0 &&
              missingAllyLanes.length < 5 &&
              missingAllyLanes.map((lane) => {
                const k = laneKey(lane);
                return (
                  <span
                    key={lane}
                    className="border border-good/50 bg-good/10 px-1.5 py-0.2 font-mono text-[10px] font-bold text-good"
                  >
                    ขาด {LANE_SHORT[k]?.en ?? k}
                  </span>
                );
              })}
            {banUnlockedHeroes.slice(0, 2).map((u) => (
              <button
                type="button"
                key={u.hero_name}
                onClick={() => onLockHero(u.hero_name)}
                className="flex items-center gap-1 border border-gold/50 bg-gold/10 px-1.5 py-0.2 font-display text-[10px] font-bold text-gold"
              >
                <Flame className="h-3 w-3" />
                <span>{displayName(u.hero_name)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={`grid grid-cols-5 gap-1 p-1.5 sm:gap-1.5 transition-opacity ${isLoading ? "opacity-50" : ""}`}>
          {shown.length === 0
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse bg-panel-2" />
              ))
            : shown.map((rec, idx) => {
                const hero = heroMap.get(rec.hero_name);
                const win = rec.lookahead_win_rate_pct ?? rec.predicted_win_rate_pct;
                const lane = laneKey(rec.primary_lane);
                const fillsLane = missing.size < 5 && missing.has(lane);
                return (
                  <button
                    type="button"
                    key={rec.hero_name}
                    onClick={() => onLockHero(rec.hero_name)}
                    className={`flex min-w-0 flex-col items-center overflow-hidden border p-1 text-center transition-colors ${
                      idx === 0
                        ? "border-gold/70 bg-gold/10 hover:bg-gold/20"
                        : "border-line bg-bg hover:border-line-strong hover:bg-panel-2"
                    }`}
                  >
                    <div className="relative h-9 w-9 shrink-0 overflow-hidden border border-line min-[380px]:h-10 min-[380px]:w-10 sm:h-11 sm:w-11">
                      <HeroPortrait name={rec.hero_name} hero={hero} />
                      <span
                        className={`absolute top-0 left-0 px-1 font-mono text-[8px] font-bold sm:text-[9px] ${
                          idx === 0 ? "bg-gold text-bg" : "bg-bg/85 text-ink"
                        }`}
                      >
                        #{rec.rank}
                      </span>
                    </div>
                    <span className="mt-0.5 w-full truncate font-display text-[10px] font-bold leading-tight text-ink sm:text-[11px]">
                      {displayName(rec.hero_name)}
                    </span>
                    <div className="flex max-w-full items-center justify-center gap-0.5 truncate font-mono text-[8.5px] leading-none sm:gap-1 sm:text-[9px]">
                      <span className={`truncate ${fillsLane ? "font-bold text-good" : "text-muted"}`}>
                        {LANE_SHORT[lane]?.en ?? lane}
                      </span>
                      <span className={`shrink-0 ${win >= 50 ? "text-good" : "text-muted"}`}>{win.toFixed(0)}%</span>
                    </div>
                  </button>
                );
              })}
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-col overflow-hidden border border-line bg-panel clip-chamfer">
      {/* Compact Header with Inline Missing Lanes & Unlocked Heroes */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 sm:px-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-gold" />
          <h2 className="truncate font-display text-xs font-bold tracking-wider sm:text-base">
            AI {isBan ? "BAN" : "PICK"} SUGGESTIONS
            <span className={`ml-1.5 ${sideText}`}>· {currentStep.side.toUpperCase()}</span>
          </h2>
          {isLoading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted" />}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {!isBan && missingAllyLanes.length > 0 && missingAllyLanes.length < 5 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] font-semibold text-good sm:text-[11px]">ขาดเลน:</span>
              {missingAllyLanes.map((lane) => {
                const k = laneKey(lane);
                return (
                  <span
                    key={lane}
                    className="border border-good/50 bg-good/10 px-1.5 py-0.2 font-mono text-[9.5px] font-bold text-good sm:text-[10px]"
                  >
                    {LANE_SHORT[k]?.en ?? k}
                  </span>
                );
              })}
            </div>
          )}
          <span className="hidden font-mono text-[10px] text-dim xl:inline">
            {useLookahead ? "POLICY + MINIMAX d2" : "POLICY HEAD"}
          </span>
        </div>
      </div>

      {/* Ban-Unlocked Heroes strip */}
      {banUnlockedHeroes.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-gold/5 px-3 py-1.5 sm:gap-2 sm:px-3.5">
          <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold text-gold sm:text-[11px]">
            <Flame className="h-3.5 w-3.5" />
            ตัวปลดล็อก:
          </span>
          {banUnlockedHeroes.slice(0, 4).map((u) => {
            const triggers = (u.triggered_by ?? []).map(displayName).join(", ");
            return (
              <button
                type="button"
                key={u.hero_name}
                onClick={() => onLockHero(u.hero_name)}
                title={triggers ? `เก่งขึ้นเพราะแบน ${triggers}` : undefined}
                className="flex max-w-full min-w-0 items-center gap-1.5 border border-gold/40 bg-panel px-2 py-0.5 text-left transition-colors hover:border-gold hover:bg-panel-2"
              >
                <div className="h-4.5 w-4.5 shrink-0 overflow-hidden">
                  <HeroPortrait name={u.hero_name} hero={heroMap.get(u.hero_name)} />
                </div>
                <span className="truncate font-display text-[11px] font-bold text-ink">{displayName(u.hero_name)}</span>
                {triggers && <span className="truncate font-mono text-[9px] text-gold">← แบน {triggers}</span>}
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
        {shown.length === 0 &&
          Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex h-[60px] items-center gap-3 px-3 lg:h-[128px] lg:flex-col lg:justify-center">
              <div className="h-11 w-11 animate-pulse bg-panel-2" />
              <div className="h-3.5 w-24 animate-pulse bg-panel-2" />
            </li>
          ))}
        {shown.map((rec, idx) => {
          const hero = heroMap.get(rec.hero_name);
          const win = rec.lookahead_win_rate_pct ?? rec.predicted_win_rate_pct;
          const lane = laneKey(rec.primary_lane);
          const fillsLane = missing.size < 5 && missing.has(lane);
          const triggerNames = (rec.triggered_by ?? []).map(displayName);
          const triggerTitle =
            rec.trigger_reason === "counter"
              ? `แก้ทาง ${triggerNames.join(", ")}`
              : rec.trigger_reason === "combo"
                ? `คอมโบกับ ${triggerNames.join(", ")}`
                : isBan || rec.trigger_reason === "protect"
                  ? `ปกป้อง ${triggerNames.join(", ")}`
                  : `ปลดล็อกจากการแบน ${triggerNames.join(", ")}`;

          const triggerBadgeText =
            rec.trigger_reason === "counter"
              ? `⚔️ แก้ ${triggerNames.join(", ")}`
              : rec.trigger_reason === "combo"
                ? `🤝 คู่ ${triggerNames.join(", ")}`
                : isBan || rec.trigger_reason === "protect"
                  ? `🛡️ ป้อง ${triggerNames.join(", ")}`
                  : `⚡ ปลดล็อก (${triggerNames.join(", ")})`;

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
                onClick={() => onLockHero(rec.hero_name)}
                className={`group flex h-full w-full min-w-0 items-center gap-2.5 overflow-hidden px-3 py-2 text-left transition-colors hover:bg-panel-2 sm:px-3.5 sm:py-2.5 lg:flex-col lg:items-stretch lg:justify-between lg:gap-1.5 lg:p-2 xl:p-2.5 ${
                  idx === 0 ? "bg-gold/[0.04]" : ""
                }`}
              >
                {/* 1. Desktop Layout (lg+): Vertical Stack, Full-Width Trigger Badge & 2-Tier Metrics */}
                <div className="hidden w-full min-w-0 flex-col items-center gap-1.5 lg:flex">
                  {/* Portrait + Rank */}
                  <div
                    className={`relative h-11 w-11 shrink-0 overflow-hidden border xl:h-13 xl:w-13 ${
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
                    <span className="truncate font-display text-xs font-bold leading-tight text-ink xl:text-sm">
                      {displayName(rec.hero_name)}
                    </span>
                    <span
                      className={`shrink-0 font-mono text-[9px] font-bold ${
                        fillsLane ? "border border-good/50 bg-good/10 px-1 text-good" : "text-muted"
                      }`}
                      title={fillsLane ? `เติมเลนที่ยังขาด: ${LANE_SHORT[lane]?.th ?? lane}` : undefined}
                    >
                      {fillsLane && "+"}
                      {LANE_SHORT[lane]?.en ?? lane}
                    </span>
                  </div>

                  {/* Full-width Trigger Badge */}
                  {triggerNames.length > 0 ? (
                    <div className="w-full min-w-0" title={triggerTitle}>
                      <span
                        className={`block w-full truncate border px-1 py-0.5 text-center font-mono text-[9px] leading-tight ${triggerBadgeClass}`}
                      >
                        {triggerBadgeText}
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

                  {/* 2-Tier Metrics: Tier 1 = WIN, Tier 2 = SYN & CTR (prevents overflow at 1024px) */}
                  <div className="flex w-full min-w-0 flex-col gap-0.5 border-t border-line/60 pt-1">
                    <div className="flex w-full items-baseline justify-between gap-1">
                      <span className="font-display text-[8.5px] tracking-wider text-dim">WIN</span>
                      <span
                        className={`font-mono text-[11px] font-bold tabular-nums xl:text-xs ${
                          win >= 50 ? "text-good" : "text-ink"
                        }`}
                      >
                        {win.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex w-full min-w-0 items-center justify-between gap-1 font-mono text-[9.5px] tabular-nums xl:text-[10.5px]">
                      <span className="truncate">
                        <span className="font-display text-[8px] text-dim">SYN </span>
                        <span
                          className={
                            rec.synergy_edge_pct > 0 ? "text-good" : rec.synergy_edge_pct < 0 ? "text-red" : "text-dim"
                          }
                        >
                          {rec.synergy_edge_pct > 0 ? "+" : ""}
                          {rec.synergy_edge_pct.toFixed(1)}
                        </span>
                      </span>
                      <span className="truncate">
                        <span className="font-display text-[8px] text-dim">CTR </span>
                        <span
                          className={
                            rec.counter_edge_pct > 0 ? "text-good" : rec.counter_edge_pct < 0 ? "text-red" : "text-dim"
                          }
                        >
                          {rec.counter_edge_pct > 0 ? "+" : ""}
                          {rec.counter_edge_pct.toFixed(1)}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* 2. Mobile & Tablet Layout (<lg): Horizontal Row with Stacked Right Metrics */}
                <div className="flex w-full min-w-0 items-center justify-between gap-2.5 lg:hidden">
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
                      <div className="flex min-w-0 items-baseline gap-1.5">
                        <span className="truncate font-display text-sm font-bold leading-tight tracking-wide sm:text-base">
                          {displayName(rec.hero_name)}
                        </span>
                        <span
                          className={`shrink-0 font-mono text-[9.5px] font-bold sm:text-[10px] ${
                            fillsLane ? "border border-good/50 bg-good/10 px-1 text-good" : "text-muted"
                          }`}
                          title={fillsLane ? `เติมเลนที่ยังขาด: ${LANE_SHORT[lane]?.th ?? lane}` : undefined}
                        >
                          {fillsLane && "+"}
                          {LANE_SHORT[lane]?.en ?? lane}
                        </span>
                      </div>

                      {/* Trigger badge */}
                      {triggerNames.length > 0 ? (
                        <div className="mt-0.5 min-w-0" title={triggerTitle}>
                          <span
                            className={`block max-w-full truncate border px-1 py-0.2 font-mono text-[9px] leading-tight ${triggerBadgeClass}`}
                          >
                            {triggerBadgeText}
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

                  {/* Right Stacked Metrics (WIN on top, SYN · CTR below) */}
                  <div className="flex shrink-0 flex-col items-end justify-center gap-0.5 text-right">
                    <div className="flex items-baseline gap-1">
                      <span className="font-display text-[9px] tracking-wider text-dim">WIN</span>
                      <span
                        className={`font-mono text-xs font-bold tabular-nums sm:text-sm ${
                          win >= 50 ? "text-good" : "text-ink"
                        }`}
                      >
                        {win.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-1 font-mono text-[10px] tabular-nums sm:text-[10.5px]">
                      <span>
                        <span className="font-display text-[8px] text-dim">SYN </span>
                        <span
                          className={
                            rec.synergy_edge_pct > 0 ? "text-good" : rec.synergy_edge_pct < 0 ? "text-red" : "text-dim"
                          }
                        >
                          {rec.synergy_edge_pct > 0 ? "+" : ""}
                          {rec.synergy_edge_pct.toFixed(1)}
                        </span>
                      </span>
                      <span className="text-line-strong">·</span>
                      <span>
                        <span className="font-display text-[8px] text-dim">CTR </span>
                        <span
                          className={
                            rec.counter_edge_pct > 0 ? "text-good" : rec.counter_edge_pct < 0 ? "text-red" : "text-dim"
                          }
                        >
                          {rec.counter_edge_pct > 0 ? "+" : ""}
                          {rec.counter_edge_pct.toFixed(1)}
                        </span>
                      </span>
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
}

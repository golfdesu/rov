import { CornerDownLeft, Loader2, Sparkles, Trophy } from "lucide-react";
import type { DraftStep, Hero, HeroRecommendation } from "../types/draft";
import { LANE_SHORT, laneKey, missingLaneKeys } from "../utils/draft";
import { displayName } from "../utils/heroNames";
import { HeroPortrait } from "./HeroPortrait";

interface AiPanelProps {
  recommendations: HeroRecommendation[];
  missingAllyLanes: string[];
  currentStep: DraftStep | null;
  heroMap: Map<string, Hero>;
  isLoading: boolean;
  useLookahead: boolean;
  blueWinRate: number;
  winHistory: number[];
  onLockHero: (name: string) => void;
}

function Sparkline({ values }: { values: number[] }) {
  const pts = values.map((v, i) => [i, v] as const).filter(([, v]) => v !== undefined);
  if (pts.length < 2) return null;
  const w = 240;
  const h = 40;
  const x = (i: number) => (i / 17) * w;
  const y = (v: number) => h - ((v - 30) / 40) * h;
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(Math.min(Math.max(v, 30), 70)).toFixed(1)}`);
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full" aria-label="Blue win probability over the draft">
      <line x1="0" x2={w} y1={h / 2} y2={h / 2} stroke="var(--color-line-strong)" strokeDasharray="2 3" />
      <path d={d.join(" ")} fill="none" stroke="var(--color-gold)" strokeWidth="1.5" />
      <circle cx={x(last[0])} cy={y(Math.min(Math.max(last[1], 30), 70))} r="2.5" fill="var(--color-gold)" />
    </svg>
  );
}

export function AiPanel({
  recommendations,
  missingAllyLanes,
  currentStep,
  heroMap,
  isLoading,
  useLookahead,
  blueWinRate,
  winHistory,
  onLockHero,
}: AiPanelProps) {
  if (!currentStep) {
    const blueWins = blueWinRate >= 50;
    return (
      <section className="flex flex-col items-center gap-3 border border-line bg-panel p-6 text-center clip-chamfer">
        <Trophy className={`h-8 w-8 ${blueWins ? "text-blue" : "text-red"}`} />
        <div className="font-display text-xs font-semibold tracking-[0.25em] text-muted">DRAFT COMPLETE</div>
        <div className={`font-display text-3xl font-bold ${blueWins ? "text-blue" : "text-red"}`}>
          {blueWins ? "BLUE" : "RED"} FAVOURED
        </div>
        <div className="font-mono text-sm text-muted">
          {blueWins ? blueWinRate.toFixed(1) : (100 - blueWinRate).toFixed(1)}% projected win probability
        </div>
        <div className="w-full max-w-sm">
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

  return (
    <section className="flex flex-col border border-line bg-panel clip-chamfer">
      {/* Panel header */}
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-gold" />
          <h2 className="font-display text-sm font-bold tracking-wider">
            AI {isBan ? "BAN" : "PICK"} SUGGESTIONS
            <span className={`ml-2 ${sideText}`}>· {currentStep.side.toUpperCase()}</span>
          </h2>
          {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
        </div>
        <span className="hidden font-mono text-[10px] text-dim sm:inline">
          {useLookahead ? "POLICY + MINIMAX d2" : "POLICY HEAD"}
        </span>
      </div>

      {/* Missing lanes */}
      {!isBan && missingAllyLanes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2">
          <span className="text-[11px] font-semibold text-good">ยังขาดเลน</span>
          {missingAllyLanes.map((lane) => {
            const k = laneKey(lane);
            return (
              <span
                key={lane}
                className="border border-good/50 bg-good/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-good"
              >
                {LANE_SHORT[k]?.en ?? k}
                <span className="ml-1 font-sans font-normal text-muted">{LANE_SHORT[k]?.th}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Recommendation list */}
      <ol className={`divide-y divide-line transition-opacity ${isLoading ? "opacity-50" : ""}`}>
        {shown.length === 0 &&
          Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex h-[60px] items-center gap-3 px-4">
              <div className="h-9 w-16 animate-pulse bg-panel-2" />
              <div className="h-3 w-32 animate-pulse bg-panel-2" />
            </li>
          ))}
        {shown.map((rec, idx) => {
          const hero = heroMap.get(rec.hero_name);
          const win = rec.lookahead_win_rate_pct ?? rec.predicted_win_rate_pct;
          const lane = laneKey(rec.primary_lane);
          const fillsLane = missing.size < 5 && missing.has(lane);
          return (
            <li key={rec.hero_name}>
              <button
                type="button"
                onClick={() => onLockHero(rec.hero_name)}
                className="group flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-panel-2"
              >
                <span className={`w-4 font-mono text-sm font-bold ${idx === 0 ? "text-gold" : "text-dim"}`}>
                  {rec.rank}
                </span>
                <div
                  className={`h-12 w-12 shrink-0 overflow-hidden border ${idx === 0 ? "border-gold/60" : "border-line"}`}
                >
                  <HeroPortrait name={rec.hero_name} hero={hero} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate font-display text-[15px] font-bold tracking-wide">{displayName(rec.hero_name)}</span>
                    <span
                      className={`shrink-0 font-mono text-[10px] font-bold ${fillsLane ? "border border-good/50 bg-good/10 px-1 text-good" : "text-muted"}`}
                      title={fillsLane ? `เติมเลนที่ยังขาด: ${LANE_SHORT[lane]?.th ?? lane}` : undefined}
                    >
                      {fillsLane && "+ "}
                      {LANE_SHORT[lane]?.en ?? lane}
                    </span>
                    <span className="hidden shrink-0 text-[11px] text-dim sm:inline">{rec.primary_role}</span>
                  </div>
                  {/* Policy probability bar */}
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1 flex-1 bg-panel-2">
                      <div
                        className={idx === 0 ? "h-full bg-gold" : "h-full bg-muted/60"}
                        style={{ width: `${(rec.probability_pct / maxProb) * 100}%` }}
                      />
                    </div>
                    <span className="w-11 text-right font-mono text-[10px] text-muted tabular-nums">
                      {rec.probability_pct.toFixed(1)}%
                    </span>
                  </div>
                  {rec.capabilities.length > 0 && (
                    <div className="mt-1 hidden flex-wrap gap-1 md:flex">
                      {rec.capabilities.map((c) => (
                        <span key={c} className="bg-panel-2 px-1 text-[10px] text-muted">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <dl className="hidden shrink-0 grid-cols-3 gap-x-3 text-right sm:grid">
                  <dt className="font-display text-[9px] tracking-wider text-dim">WIN</dt>
                  <dt className="font-display text-[9px] tracking-wider text-dim">SYN</dt>
                  <dt className="font-display text-[9px] tracking-wider text-dim">CTR</dt>
                  <dd className={`font-mono text-sm font-bold tabular-nums ${win >= 50 ? "text-good" : "text-ink"}`}>
                    {win.toFixed(1)}
                  </dd>
                  <dd
                    className={`font-mono text-xs tabular-nums ${rec.synergy_edge_pct > 0 ? "text-good" : rec.synergy_edge_pct < 0 ? "text-red" : "text-dim"}`}
                  >
                    {rec.synergy_edge_pct > 0 ? "+" : ""}
                    {rec.synergy_edge_pct.toFixed(1)}
                  </dd>
                  <dd
                    className={`font-mono text-xs tabular-nums ${rec.counter_edge_pct > 0 ? "text-good" : rec.counter_edge_pct < 0 ? "text-red" : "text-dim"}`}
                  >
                    {rec.counter_edge_pct > 0 ? "+" : ""}
                    {rec.counter_edge_pct.toFixed(1)}
                  </dd>
                </dl>

                <span
                  className={`hidden shrink-0 items-center gap-1 border px-2 py-1 font-display text-[10px] font-bold tracking-wider transition-colors lg:flex ${
                    idx === 0
                      ? "border-gold/60 text-gold group-hover:bg-gold group-hover:text-bg"
                      : "border-line-strong text-muted group-hover:border-ink group-hover:text-ink"
                  }`}
                >
                  {isBan ? "BAN" : "LOCK"}
                  {idx === 0 && <CornerDownLeft className="h-3 w-3" />}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {winHistory.filter((v) => v !== undefined).length >= 2 && (
        <div className="border-t border-line px-4 pt-2 pb-1">
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

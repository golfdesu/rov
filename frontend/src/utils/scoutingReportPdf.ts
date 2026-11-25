import type { Hero, LaneKey } from "../types/draft";
import { LANE_SHORT } from "./draft";
import { displayName } from "./heroNames";
import { getHeroFallbackImage } from "./imageFallback";
import { COMP_ARCHETYPE_LABELS, type PeriodDiffSummary, type ScrimAdvancedStats } from "./scrimAdvancedStats";
import type { AllTeamsAnalyticsSummary, ScrimAnalyticsSummary } from "./scrimStats";

function esc(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pct(wins: number, decided: number): string {
  return decided > 0 ? `${((wins / decided) * 100).toFixed(1)}%` : "—";
}

function signed(v: number, digits = 1): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function wrClass(wins: number, decided: number): string {
  if (decided <= 0) return "muted";
  return wins / decided >= 0.5 ? "good" : "bad";
}

function heroImg(name: string, heroMap: Map<string, Hero>): string {
  const rel = heroMap.get(name)?.image_url || getHeroFallbackImage(displayName(name));
  if (typeof window !== "undefined" && window.location?.origin) {
    try {
      return new URL(rel, window.location.origin).href;
    } catch {
      return rel;
    }
  }
  return rel;
}

function heroChipHtml(name: string, heroMap: Map<string, Hero>, extra = ""): string {
  return `<span class="hero-inline"><img src="${esc(heroImg(name, heroMap))}" alt="${esc(displayName(name))}" /><span>${esc(displayName(name))}</span>${extra ? `<span class="mono muted">${extra}</span>` : ""}</span>`;
}

export interface ScoutingPdfParams {
  focusTeam: string;
  opponentFilter: string;
  stats: ScrimAnalyticsSummary;
  allStats: AllTeamsAnalyticsSummary | null;
  advanced: ScrimAdvancedStats;
  periodDiff?: PeriodDiffSummary | null;
  heroMap: Map<string, Hero>;
  language?: "th" | "en";
  t: (msg: string, ...args: (string | number)[]) => string;
}

export function buildScoutingReportPrintHtml({
  focusTeam,
  opponentFilter,
  stats,
  allStats,
  advanced,
  periodDiff,
  heroMap,
  language = "th",
  t,
}: ScoutingPdfParams): string {
  const isAll = !focusTeam.trim() && allStats !== null;
  const reportTitle = isAll
    ? t("ใบสรุปสเกาต์: ภาพรวมทุกทีม")
    : `${t("ใบสรุปสเกาต์")}: ${focusTeam}${opponentFilter !== "ALL" ? ` vs ${opponentFilter}` : ""}`;
  const generatedAt = new Date().toLocaleString(language === "en" ? "en-US" : "th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  // 1. KPI Strip
  const totalGames = isAll && allStats ? allStats.total : stats.total;
  const totalSeries = isAll && allStats ? allStats.seriesCount : stats.seriesCount;
  const kpiCardsHtml = isAll && allStats
    ? `
      <div class="kpi"><div class="kpi-lbl">${esc(t("ขอบเขตข้อมูล"))}</div><div class="kpi-val">${allStats.total} <small>(${allStats.seriesCount} ${esc(t("ซีรีส์"))})</small></div><div class="kpi-sub">${allStats.teamRows.length} ${esc(t("ทีม"))} · ${allStats.decided}/${allStats.total} ${esc(t("ลงผลแล้ว"))}</div></div>
      <div class="kpi"><div class="kpi-lbl">Blue Side WR</div><div class="kpi-val blue">${pct(allStats.blueWins, allStats.decided)}</div><div class="kpi-sub">${allStats.blueWins}/${allStats.decided} ${allStats.blueCi ? `· CI [${allStats.blueCi[0].toFixed(0)}–${allStats.blueCi[1].toFixed(0)}%]` : ""}</div></div>
      <div class="kpi"><div class="kpi-lbl">Red Side WR</div><div class="kpi-val bad">${pct(allStats.redWins, allStats.decided)}</div><div class="kpi-sub">${allStats.redWins}/${allStats.decided} ${allStats.redCi ? `· CI [${allStats.redCi[0].toFixed(0)}–${allStats.redCi[1].toFixed(0)}%]` : ""}</div></div>
      <div class="kpi"><div class="kpi-lbl">${esc(t("คลังฮีโร่รวม"))}</div><div class="kpi-val">${allStats.uniqueHeroCount} <small>${esc(t("ตัว"))}</small></div><div class="kpi-sub">Eff ${allStats.effectiveHeroPool.toFixed(1)} · ${allStats.poolEvennessPct.toFixed(0)}% ${esc(t("กระจายใช้งาน"))}</div></div>
      <div class="kpi"><div class="kpi-lbl">${esc(t("ทีมผลงานเด่นสุด"))}</div><div class="kpi-val gold">${esc(allStats.teamRows[0]?.team ?? "—")}</div><div class="kpi-sub">${allStats.teamRows[0] ? `${allStats.teamRows[0].wins}W-${allStats.teamRows[0].losses}L (${pct(allStats.teamRows[0].wins, allStats.teamRows[0].decided)})` : "—"}</div></div>
    `
    : (() => {
        const recent10 = stats.ewmaSeries.slice(-10);
        const rWins = recent10.filter((p) => p.win).length;
        return `
      <div class="kpi"><div class="kpi-lbl">${esc(t("ขอบเขตข้อมูล"))}</div><div class="kpi-val">${stats.total} <small>(${stats.seriesCount} ${esc(t("ซีรีส์"))})</small></div><div class="kpi-sub"><strong class="${wrClass(stats.wins, stats.decided)}">${stats.wins}W-${stats.losses}L</strong> · ${stats.decided}/${stats.total} ${esc(t("ลงผลแล้ว"))}</div></div>
      <div class="kpi"><div class="kpi-lbl">${esc(t("Win Rate รวม"))}</div><div class="kpi-val gold">${pct(stats.wins, stats.decided)}</div><div class="kpi-sub">${stats.overallCi ? `CI [${stats.overallCi[0].toFixed(1)}–${stats.overallCi[1].toFixed(1)}%]` : "—"}</div></div>
      <div class="kpi"><div class="kpi-lbl">${esc(t("แยกฝั่ง Blue / Red"))}</div><div class="kpi-val"><span class="blue">B ${pct(stats.blueWins, stats.blueDecided)}</span> · <span class="bad">R ${pct(stats.redWins, stats.redDecided)}</span></div><div class="kpi-sub">${stats.seriesWinProb ? `Bo5 ${stats.seriesWinProb.bo5Pct.toFixed(0)}% · Bo7 ${stats.seriesWinProb.bo7Pct.toFixed(0)}%` : `${stats.blueWins}/${stats.blueDecided} vs ${stats.redWins}/${stats.redDecided}`}</div></div>
      <div class="kpi"><div class="kpi-lbl">${esc(t("ฟอร์มช่วงหลัง"))}</div><div class="kpi-val ${stats.ewmaCurrentPct !== null && stats.ewmaCurrentPct >= 50 ? "good" : "bad"}">${stats.ewmaCurrentPct !== null ? `${stats.ewmaCurrentPct.toFixed(1)}%` : "—"}</div><div class="kpi-sub">${recent10.length > 0 ? `${rWins}/${recent10.length} ${esc(t("เกมล่าสุด"))}` : "—"}</div></div>
      <div class="kpi"><div class="kpi-lbl">${esc(t("คลังฮีโร่ที่ใช้"))}</div><div class="kpi-val">${stats.uniqueHeroCount} <small>${esc(t("ตัว"))}</small></div><div class="kpi-sub">${esc(t("ตัวหลัก"))} ${stats.effectiveHeroPool.toFixed(1)} · ${(stats.uniqueHeroCount / 5).toFixed(1)} ${esc(t("ตัว/ตำแหน่ง"))}</div></div>
    `;
      })();

  // 2. G1-G7 Curve
  const gStripHtml = [1, 2, 3, 4, 5, 6, 7]
    .map((gNum) => {
      if (isAll && allStats) {
        const row = allStats.byGameNum.get(gNum);
        const bluePct = row && row.decided > 0 ? (row.blueWins / row.decided) * 100 : null;
        return `<div class="g-cell"><div class="g-top"><strong>G${gNum}</strong><span>${row?.total ?? 0}g</span></div><div class="g-bar-bg"><div class="g-bar-fill blue-bg" style="height:${bluePct ?? 4}%"></div></div><div class="g-stat"><span class="blue">${bluePct !== null ? `B:${bluePct.toFixed(0)}%` : "—"}</span></div></div>`;
      }
      const row = stats.byGameNum.get(gNum);
      const pVal = row && row.decided > 0 ? (row.wins / row.decided) * 100 : null;
      return `<div class="g-cell"><div class="g-top"><strong>G${gNum}</strong><span>${row?.total ?? 0}g</span></div><div class="g-bar-bg"><div class="g-bar-fill ${pVal !== null && pVal >= 50 ? "good-bg" : "bad-bg"}" style="height:${pVal !== null ? Math.max(8, pVal) : 4}%"></div></div><div class="g-stat"><strong class="${pVal !== null && pVal >= 50 ? "good" : pVal !== null ? "bad" : "muted"}">${row ? pct(row.wins, row.decided) : "—"}</strong><div>${row ? `${row.wins}W-${row.decided - row.wins}L` : "0-0"}</div></div></div>`;
    })
    .join("");

  // 3. Positional Pools Table
  const poolsHtml = advanced.positionalPools
    .map((pool) => {
      const riskLabel =
        pool.squeezeRisk === "high"
          ? `<span class="pill bad-pill">${esc(t("เสี่ยงโดนบีบสูง"))}</span>`
          : pool.squeezeRisk === "medium"
            ? `<span class="pill gold-pill">${esc(t("เสี่ยงปานกลาง"))}</span>`
            : pool.squeezeRisk === "low"
              ? `<span class="pill good-pill">${esc(t("คลังลึก"))}</span>`
              : `<span class="pill muted-pill">${esc(t("ข้อมูลน้อย"))}</span>`;
      const topsHtml = pool.topHeroes
        .slice(0, 4)
        .map((h) => heroChipHtml(h.hero, heroMap, ` ${h.games}g (${pct(h.wins, h.decided)})`))
        .join(" ");
      return `<tr>
        <td><strong>${esc(LANE_SHORT[pool.lane]?.en ?? pool.lane)}</strong> <span class="muted">${esc(t(LANE_SHORT[pool.lane]?.th ?? ""))}</span></td>
        <td class="num"><strong>${pool.uniqueHeroes}</strong></td>
        <td class="num">${pool.effectivePool.toFixed(1)}</td>
        <td class="num">${pool.evennessPct.toFixed(0)}%</td>
        <td class="num">${pool.topHeroSharePct.toFixed(0)}%</td>
        <td>${riskLabel}</td>
        <td><div class="chip-wrap">${topsHtml || "—"}</div></td>
      </tr>`;
    })
    .join("");

  // 4. Bans & Reactive Phase-2 Bans
  const banLeft = isAll && allStats ? allStats.topBans.slice(0, 8) : stats.bansAgainstUs.slice(0, 8);
  const banLeftTitle = isAll ? t("ฮีโร่ที่ถูกแบนบ่อย") : t("โดนคู่แข่งแบนใส่บ่อยสุด");
  const banRightTitle = isAll ? t("Contest Rate สูงสุด") : t("ตัวที่ทีมเราแบนทิ้งบ่อยสุด");
  const banRightRows = isAll && allStats
    ? allStats.topContested
        .slice(0, 8)
        .map((h) => `<tr><td>${heroChipHtml(h.hero, heroMap)}</td><td class="num gold"><strong>${h.contestPct.toFixed(0)}%</strong></td><td class="num muted">${h.games}P / ${h.bans}B</td></tr>`)
        .join("")
    : stats.bansByUs
        .slice(0, 8)
        .map((b) => `<tr><td>${heroChipHtml(b.hero, heroMap)}</td><td class="num"><strong>${b.total}</strong></td><td class="num muted">P1:${b.p1} / P2:${b.p2}</td></tr>`)
        .join("");
  const reactiveHtml = !isAll && stats.protectiveBans.length > 0
    ? `<div class="sub-box"><strong>${esc(t("คู่แข่งมักแบนตามหลังเราหยิบ (Phase 2)"))}:</strong> <div class="chip-wrap">${stats.protectiveBans
        .slice(0, 8)
        .map((pb) => `<span class="badge">${esc(displayName(pb.pickedHero))} → <span class="bad">${esc(displayName(pb.bannedHero))}</span> (${pb.coCount}x · ${pb.banLift.toFixed(1)}x)</span>`)
        .join("")}</div></div>`
    : "";

  // 5. Blind vs Counter & 7 Slots
  const blindRows = advanced.blindCounterHeroes
    .slice(0, 12)
    .map((h) => {
      const clsPill =
        h.classification === "blind_safe"
          ? `<span class="pill good-pill">${esc(t("เปิดก่อนคุ้ม"))}</span>`
          : h.classification === "counter_specialist"
            ? `<span class="pill blue-pill">${esc(t("ตัวแก้ทาง"))}</span>`
            : h.classification === "blind_risk"
              ? `<span class="pill bad-pill">${esc(t("เปิดก่อนเสี่ยง"))}</span>`
              : `<span class="pill muted-pill">${esc(t("สมดุล"))}</span>`;
      return `<tr>
        <td>${heroChipHtml(h.hero, heroMap)}</td>
        <td>${clsPill}</td>
        <td class="num">${h.p1WrPct !== null ? `<strong class="${h.p1WrPct >= 50 ? "good" : "bad"}">${h.p1WrPct.toFixed(0)}%</strong>` : "—"} <span class="muted">(${h.p1Games}g)</span></td>
        <td class="num">${h.p2WrPct !== null ? `<strong class="${h.p2WrPct >= 50 ? "good" : "bad"}">${h.p2WrPct.toFixed(0)}%</strong>` : "—"} <span class="muted">(${h.p2Games}g)</span></td>
      </tr>`;
    })
    .join("");

  const slotsHtml = advanced.draftSlots
    .map((s) => {
      const topStr = s.topHeroes.slice(0, 2).map((th) => `${displayName(th.hero)} (${th.count})`).join(", ");
      return `<div class="slot-box"><div class="slot-head"><strong class="${s.side === "blue" ? "blue" : "bad"}">${esc(s.slot)}</strong><span>P${s.phase}</span></div><div class="slot-wr ${s.wrPct !== null && s.wrPct >= 50 ? "good" : s.wrPct !== null ? "bad" : "muted"}">${s.wrPct !== null ? `${s.wrPct.toFixed(0)}%` : "—"}</div><div class="slot-sub">${s.wins}W-${s.losses}L (${s.games}g)</div><div class="slot-tops">${esc(topStr || "—")}</div></div>`;
    })
    .join("");

  // 6. Flex Picks
  const flexRows = advanced.flexSummary.flexHeroes
    .slice(0, 10)
    .map((f) => {
      const lanesStr = f.laneBreakdown
        .map((lb) => `${LANE_SHORT[lb.lane]?.en ?? lb.lane} ${lb.games}g (${pct(lb.wins, lb.decided)})`)
        .join(" · ");
      return `<tr>
        <td>${heroChipHtml(f.hero, heroMap)}</td>
        <td class="num"><strong>${f.games}</strong></td>
        <td class="num">${f.wins}-${f.losses}</td>
        <td class="num ${f.wrPct !== null && f.wrPct >= 50 ? "good" : "bad"}"><strong>${pct(f.wins, f.decided)}</strong></td>
        <td>${esc(lanesStr)}</td>
      </tr>`;
    })
    .join("");

  // 7. Top Hero Table (Top 15)
  const sortedHeroes = [...(isAll && allStats ? allStats.heroList : stats.allyList)]
    .filter((h) => h.games > 0)
    .sort((a, b) => b.games - a.games || b.wins - a.wins)
    .slice(0, 15);
  const heroTableRows = sortedHeroes
    .map((h) => {
      const topLane = (Object.entries(h.lanes).sort((a, b) => b[1].games - a[1].games)[0]?.[0] ?? "") as LaneKey | "";
      const p1Pct = h.games > 0 ? (h.phase1Count / h.games) * 100 : 0;
      const rightStat = isAll && "contestPct" in h
        ? `<td class="num gold">${Number((h as { contestPct: number }).contestPct).toFixed(0)}%</td>`
        : `<td class="num ${h.bayesianDeltaPct >= 0 ? "good" : "bad"}">${signed(h.bayesianDeltaPct)}</td>`;
      return `<tr>
        <td>${heroChipHtml(h.hero, heroMap)}</td>
        <td class="mono">${esc(topLane ? (LANE_SHORT[topLane]?.en ?? topLane) : "—")}</td>
        <td class="num"><strong>${h.games}</strong></td>
        <td class="num">${h.wins}-${h.losses}</td>
        <td class="num ${wrClass(h.wins, h.decided)}"><strong>${pct(h.wins, h.decided)}</strong></td>
        <td class="num">${(h.bayesianWr * 100).toFixed(1)}%</td>
        ${rightStat}
        <td class="num">${p1Pct.toFixed(0)}%</td>
        <td class="num muted">F:${h.b1Count} / L:${h.r5Count}</td>
      </tr>`;
    })
    .join("");

  // 8. Comp Archetypes & Openings
  const archRows = advanced.compSummary.archetypeStats
    .map((a) => `<tr><td>${esc(t(COMP_ARCHETYPE_LABELS[a.key]))}</td><td class="num">${a.games} (${a.sharePct.toFixed(0)}%)</td><td class="num">${a.wins}-${a.losses}</td><td class="num ${wrClass(a.wins, a.decided)}"><strong>${pct(a.wins, a.decided)}</strong></td></tr>`)
    .join("");
  const openingRows = advanced.compSummary.topOpenings
    .slice(0, 8)
    .map((op) => `<tr><td>${heroChipHtml(op.a, heroMap)} + ${heroChipHtml(op.b, heroMap)}</td><td class="num">${op.games}g</td><td class="num">${op.wins}-${op.losses}</td><td class="num ${wrClass(op.wins, op.decided)}"><strong>${pct(op.wins, op.decided)}</strong></td></tr>`)
    .join("");

  // 9. Duos & Trios
  const activeDuos = (isAll && allStats ? allStats.topDuos : stats.topDuos).slice(0, 8);
  const duoRows = activeDuos
    .map((d) => `<tr><td>${heroChipHtml(d.a, heroMap)} + ${heroChipHtml(d.b, heroMap)}</td><td class="num ${d.synergyLiftPct >= 0 ? "good" : "bad"}"><strong>${signed(d.synergyLiftPct)}</strong></td><td class="num">${pct(d.wins, d.decided)}</td><td class="num muted">${d.wins}W-${d.losses}L</td></tr>`)
    .join("");
  const trioList = advanced.trioSummary.coreAxisTrios.length > 0 ? advanced.trioSummary.coreAxisTrios : advanced.trioSummary.allTrios;
  const trioRows = trioList
    .slice(0, 6)
    .map((tr) => `<tr><td>${tr.heroes.map((h) => heroChipHtml(h, heroMap)).join(" + ")}</td><td class="num">${tr.games}g</td><td class="num ${tr.deltaVsTeamPct >= 0 ? "good" : "bad"}"><strong>${(tr.bayesianWr * 100).toFixed(1)}%</strong></td><td class="num muted">${tr.wins}W-${tr.losses}L</td></tr>`)
    .join("");

  // 10. Enemy Threats & Direct Lane Counters
  const enemyHtml = !isAll
    ? `<div class="grid-2 card">
        <div>
          <h3>${esc(t("ฮีโร่ที่แพ้ทาง"))}</h3>
          <table><thead><tr><th>${esc(t("ฮีโร่"))}</th><th class="num">Delta</th><th class="num">W-L</th><th class="num">WR%</th></tr></thead><tbody>
          ${stats.toughestEnemies.slice(0, 8).map((e) => `<tr><td>${heroChipHtml(e.hero, heroMap)}</td><td class="num bad"><strong>${signed(e.threatDeltaPct)}</strong></td><td class="num">${e.ourWins}-${e.ourLosses}</td><td class="num">${pct(e.ourWins, e.decided)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">—</td></tr>`}
          </tbody></table>
        </div>
        <div>
          <h3>${esc(t("รับมือได้ดี"))}</h3>
          <table><thead><tr><th>${esc(t("ฮีโร่"))}</th><th class="num">Delta</th><th class="num">W-L</th><th class="num">WR%</th></tr></thead><tbody>
          ${stats.favorableEnemies.slice(0, 8).map((e) => `<tr><td>${heroChipHtml(e.hero, heroMap)}</td><td class="num good"><strong>${signed(e.threatDeltaPct)}</strong></td><td class="num">${e.ourWins}-${e.ourLosses}</td><td class="num">${pct(e.ourWins, e.decided)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">—</td></tr>`}
          </tbody></table>
        </div>
      </div>`
    : "";

  const laneStrengthList = isAll && allStats ? allStats.laneStrengths : stats.laneStrengths;
  const laneMatchupHtml = `
    <div class="card">
      <h3>${esc(t("สถิติชนเลนตรง (ตัวต่อตัว)"))}</h3>
      <div class="grid-2">
        <div>
          <div class="sub-lbl good">${esc(t("คู่เลนที่ได้เปรียบ"))}</div>
          <table><thead><tr><th>Lane</th><th>Matchup</th><th class="num">Lift</th><th class="num">W-L</th></tr></thead><tbody>
          ${laneStrengthList.slice(0, 6).map((m) => `<tr><td class="mono">${esc(LANE_SHORT[m.lane]?.en ?? m.lane)}</td><td>${esc(displayName(m.allyHero))} vs ${esc(displayName(m.enemyHero))}</td><td class="num good">${signed(m.counterLiftPct)}</td><td class="num">${m.wins}-${m.losses}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">—</td></tr>`}
          </tbody></table>
        </div>
        <div>
          <div class="sub-lbl ${isAll ? "good" : "bad"}">${esc(isAll ? t("คู่คอมโบเด่น") : t("คู่เลนที่เสียเปรียบ"))}</div>
          <table><thead><tr><th>${isAll ? "Duo" : "Lane"}</th><th>${isAll ? "Win%" : "Matchup"}</th><th class="num">Lift</th><th class="num">W-L</th></tr></thead><tbody>
          ${(isAll ? activeDuos.slice(0, 6).map((d) => `<tr><td>${esc(displayName(d.a))} + ${esc(displayName(d.b))}</td><td class="num">${pct(d.wins, d.decided)}</td><td class="num good">${signed(d.synergyLiftPct)}</td><td class="num">${d.wins}-${d.losses}</td></tr>`) : stats.laneWeaknesses.slice(0, 6).map((m) => `<tr><td class="mono">${esc(LANE_SHORT[m.lane]?.en ?? m.lane)}</td><td>${esc(displayName(m.allyHero))} vs ${esc(displayName(m.enemyHero))}</td><td class="num bad">${signed(m.counterLiftPct)}</td><td class="num">${m.wins}-${m.losses}</td></tr>`)).join("") || `<tr><td colspan="4" class="muted">—</td></tr>`}
          </tbody></table>
        </div>
      </div>
    </div>`;

  // 11. H2H / Standings + Period Diff
  const standingsHtml = isAll && allStats
    ? `<div class="card"><h3>${esc(t("อันดับผลงานแต่ละทีม"))}</h3><table><thead><tr><th>${esc(t("ทีม"))}</th><th class="num">${esc(t("เกม"))}</th><th class="num">W-L</th><th class="num">WR%</th><th class="num">Blue</th><th class="num">Red</th></tr></thead><tbody>${allStats.teamRows.map((r) => `<tr><td><strong>${esc(r.team)}</strong> <span class="muted">(${r.seriesCount}s)</span></td><td class="num">${r.games}</td><td class="num">${r.wins}-${r.losses}</td><td class="num ${wrClass(r.wins, r.decided)}"><strong>${pct(r.wins, r.decided)}</strong></td><td class="num">${pct(r.blueWins, r.blueDecided)}</td><td class="num">${pct(r.redWins, r.redDecided)}</td></tr>`).join("")}</tbody></table></div>`
    : `<div class="card"><h3>${esc(t("สถิติเจอแต่ละทีม"))}</h3><table><thead><tr><th>${esc(t("คู่แข่ง"))}</th><th class="num">${esc(t("เกม"))}</th><th class="num">W-L</th><th class="num">WR%</th><th>${esc(t("ตัวที่เจอบ่อย"))}</th></tr></thead><tbody>${stats.opponentRows.map((r) => `<tr><td><strong>${esc(r.opponent)}</strong> <span class="muted">(${r.seriesCount}s)</span></td><td class="num">${r.games}</td><td class="num">${r.wins}-${r.losses}</td><td class="num ${wrClass(r.wins, r.wins + r.losses)}"><strong>${pct(r.wins, r.wins + r.losses)}</strong></td><td class="muted">${esc(r.topEnemies.map(([h]) => displayName(h)).join(", ") || "—")}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">—</td></tr>`}</tbody></table></div>`;

  const periodHtml = periodDiff && periodDiff.periodA.games > 0 && periodDiff.periodB.games > 0
    ? `<div class="card">
        <h3>${esc(t("เทียบฟอร์มตามช่วงเวลา"))}</h3>
        <p class="sub-line">A (${esc(t(periodDiff.periodA.label))}): <strong>${periodDiff.periodA.wrPct !== null ? `${periodDiff.periodA.wrPct.toFixed(1)}%` : "—"}</strong> (${periodDiff.periodA.games}g) &nbsp;|&nbsp; B (${esc(t(periodDiff.periodB.label))}): <strong>${periodDiff.periodB.wrPct !== null ? `${periodDiff.periodB.wrPct.toFixed(1)}%` : "—"}</strong> (${periodDiff.periodB.games}g) &nbsp;|&nbsp; Shift: <strong>${periodDiff.wrShiftPct !== null ? signed(periodDiff.wrShiftPct) : "—"}</strong></p>
        <div class="grid-2">
          <div><div class="sub-lbl good">${esc(t("ฮีโร่ที่ความนิยมพุ่งขึ้น"))}</div><div class="chip-wrap">${periodDiff.risingHeroes.slice(0, 6).map((h) => heroChipHtml(h.hero, heroMap, ` <strong class="good">${signed(h.deltaPct, 0)}</strong> (${h.gamesA}→${h.gamesB})`)).join(" ") || "—"}</div></div>
          <div><div class="sub-lbl bad">${esc(t("ฮีโร่ที่ความนิยมลดลง"))}</div><div class="chip-wrap">${periodDiff.fallingHeroes.slice(0, 6).map((h) => heroChipHtml(h.hero, heroMap, ` <strong class="bad">${signed(h.deltaPct, 0)}</strong> (${h.gamesA}→${h.gamesB})`)).join(" ") || "—"}</div></div>
        </div>
      </div>`
    : "";

  return `<!doctype html>
<html lang="${language === "en" ? "en" : "th"}">
<head>
<meta charset="utf-8" />
<title>${esc(reportTitle)} — MiniDraft</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  body { margin: 0; font-family: "IBM Plex Sans Thai", "Segoe UI", system-ui, sans-serif; color: #0f172a; background: #ffffff; font-size: 10px; line-height: 1.38; }
  .doc-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 8px; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 10px; }
  .doc-brand { font-size: 9px; font-weight: 700; letter-spacing: 0.12em; color: #b45309; text-transform: uppercase; }
  h1 { margin: 2px 0 0; font-size: 16px; font-weight: 800; color: #0f172a; overflow-wrap: anywhere; }
  .doc-meta { text-align: right; font-family: ui-monospace, monospace; font-size: 9px; color: #475569; shrink: 0; white-space: nowrap; }
  .kpi-row { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; margin-bottom: 10px; break-inside: avoid; }
  .kpi { min-width: 0; border: 1px solid #cbd5e1; background: #f8fafc; padding: 6px 8px; border-radius: 3px; overflow-wrap: break-word; }
  .kpi-lbl { font-size: 8.5px; color: #475569; font-weight: 600; }
  .kpi-val { font-family: ui-monospace, monospace; font-size: 13px; font-weight: 800; margin-top: 2px; color: #0f172a; }
  .kpi-val small { font-size: 9.5px; font-weight: 500; color: #64748b; }
  .kpi-sub { font-family: ui-monospace, monospace; font-size: 8.5px; color: #475569; margin-top: 1px; }
  .card { border: 1px solid #cbd5e1; background: #ffffff; padding: 8px 10px; margin-bottom: 9px; border-radius: 3px; break-inside: avoid; }
  h3 { margin: 0 0 6px; font-size: 11px; font-weight: 800; color: #0f172a; border-left: 3px solid #d97706; padding-left: 6px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 9px; }
  th, td { border-bottom: 1px solid #e2e8f0; padding: 3.5px 5px; text-align: left; vertical-align: middle; }
  th { background: #f1f5f9; font-weight: 700; color: #334155; font-size: 8.5px; text-transform: uppercase; }
  .num { text-align: right; font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .mono { font-family: ui-monospace, monospace; }
  .good { color: #047857; }
  .bad { color: #be123c; }
  .blue { color: #1d4ed8; }
  .gold { color: #b45309; }
  .muted { color: #64748b; }
  .pill { display: inline-block; padding: 1px 5px; border-radius: 2px; font-size: 8px; font-weight: 700; font-family: ui-monospace, monospace; white-space: nowrap; }
  .good-pill { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
  .bad-pill { background: #ffe4e6; color: #9f1239; border: 1px solid #fecdd3; }
  .gold-pill { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
  .blue-pill { background: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; }
  .muted-pill { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }
  .hero-inline { display: inline-flex; align-items: center; gap: 4px; margin-right: 4px; white-space: nowrap; }
  .hero-inline img { width: 14px; height: 14px; border-radius: 2px; object-fit: cover; object-position: 50% 20%; border: 1px solid #cbd5e1; }
  .chip-wrap { display: flex; flex-wrap: wrap; gap: 3px 6px; align-items: center; }
  .badge { border: 1px solid #cbd5e1; background: #f8fafc; padding: 1.5px 5px; font-size: 8.5px; border-radius: 2px; }
  .sub-box { margin-top: 6px; padding-top: 5px; border-top: 1px dashed #cbd5e1; font-size: 9px; }
  .sub-lbl { font-size: 9.5px; font-weight: 700; margin-bottom: 4px; }
  .sub-line { margin: 0 0 6px; font-family: ui-monospace, monospace; font-size: 9px; color: #334155; }
  .g-strip { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
  .g-cell { min-width: 0; border: 1px solid #e2e8f0; background: #f8fafc; padding: 5px; text-align: center; }
  .g-top { display: flex; justify-content: space-between; font-family: ui-monospace, monospace; font-size: 9px; }
  .g-bar-bg { height: 34px; display: flex; align-items: flex-end; justify-content: center; background: #e2e8f0; margin: 4px 0; padding: 2px; }
  .g-bar-fill { width: 16px; border-radius: 1px; }
  .good-bg { background: #10b981; }
  .bad-bg { background: #e11d48; }
  .blue-bg { background: #2563eb; }
  .g-stat { font-family: ui-monospace, monospace; font-size: 8.5px; }
  .slot-strip { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 5px; margin-top: 7px; }
  .slot-box { min-width: 0; border: 1px solid #cbd5e1; background: #f8fafc; padding: 5px; overflow-wrap: break-word; }
  .slot-head { display: flex; justify-content: space-between; font-family: ui-monospace, monospace; font-size: 9px; }
  .slot-wr { font-family: ui-monospace, monospace; font-size: 12px; font-weight: 800; margin-top: 2px; }
  .slot-sub { font-family: ui-monospace, monospace; font-size: 8px; color: #64748b; }
  .slot-tops { font-size: 8px; color: #334155; margin-top: 3px; border-top: 1px solid #e2e8f0; padding-top: 2px; }
</style>
</head>
<body>
  <header class="doc-head">
    <div>
      <div class="doc-brand">MINIDRAFT · SCOUTING REPORT</div>
      <h1>${esc(reportTitle)}</h1>
    </div>
    <div class="doc-meta">
      <div>${esc(totalGames)} ${esc(t("เกม"))} · ${esc(totalSeries)} ${esc(t("ซีรีส์"))}</div>
      <div>${esc(generatedAt)}</div>
    </div>
  </header>

  <div class="kpi-row">${kpiCardsHtml}</div>

  <div class="card">
    <h3>${esc(isAll ? t("สัดส่วนชนะ Blue vs Red แยกตามเกม (G1–G7)") : t("ผลงานแยกตามลำดับเกมในซีรีส์ Global Ban (G1–G7)"))}</h3>
    ${!isAll && stats.fatigueSlopePctPerGame !== null ? `<p class="sub-line">Slope: <strong>${signed(stats.fatigueSlopePctPerGame)}/game</strong> · G1–3 vs G4–7: ${esc(t("มั่นใจ"))} ${stats.earlyVsLateTest.probDominantPct.toFixed(0)}%</p>` : ""}
    <div class="g-strip">${gStripHtml}</div>
  </div>

  <div class="card">
    <h3>${esc(t("คลังฮีโร่ 5 เลน & จุดเสี่ยงโดนบีบแบน"))}</h3>
    <table>
      <thead><tr><th>${esc(t("เลน"))}</th><th class="num">Unique</th><th class="num">${esc(t("ตัวหลัก"))}</th><th class="num">Even</th><th class="num">Top1</th><th>Squeeze Risk</th><th>Top Heroes</th></tr></thead>
      <tbody>${poolsHtml}</tbody>
    </table>
  </div>

  <div class="card">
    <div class="grid-2">
      <div>
        <h3>${esc(banLeftTitle)}</h3>
        <table><thead><tr><th>${esc(t("ฮีโร่"))}</th><th class="num">Total</th><th class="num">Phase</th></tr></thead><tbody>
          ${banLeft.map((b) => `<tr><td>${heroChipHtml(b.hero, heroMap)}</td><td class="num bad"><strong>${b.total}</strong></td><td class="num muted">P1:${b.p1} / P2:${b.p2}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">—</td></tr>`}
        </tbody></table>
      </div>
      <div>
        <h3>${esc(banRightTitle)}</h3>
        <table><thead><tr><th>${esc(t("ฮีโร่"))}</th><th class="num">${isAll ? "Contest" : "Total"}</th><th class="num">${isAll ? "Pick/Ban" : "Phase"}</th></tr></thead><tbody>
          ${banRightRows || `<tr><td colspan="3" class="muted">—</td></tr>`}
        </tbody></table>
      </div>
    </div>
    ${reactiveHtml}
  </div>

  <div class="card">
    <h3>${esc(t("หยิบเปิด vs แก้ทาง & สถิติตามช่องดราฟต์"))}</h3>
    <table>
      <thead><tr><th>${esc(t("ฮีโร่"))}</th><th>Class</th><th class="num">Blind (P1–P3)</th><th class="num">Counter (P4–P5)</th></tr></thead>
      <tbody>${blindRows || `<tr><td colspan="4" class="muted">—</td></tr>`}</tbody>
    </table>
    <div class="slot-strip">${slotsHtml}</div>
  </div>

  ${advanced.flexSummary.flexHeroes.length > 0 ? `<div class="card">
    <h3>${esc(t("สถิติตัว Flex"))}</h3>
    <p class="sub-line">${esc(t("เกมที่มีตัว Flex ร่วมทีม"))}: <strong>${pct(advanced.flexSummary.withFlexWins, advanced.flexSummary.withFlexDecided)}</strong> (${advanced.flexSummary.withFlexGames}g) &nbsp;|&nbsp; ${esc(t("เกมที่ไม่มีตัว Flex"))}: <strong>${pct(advanced.flexSummary.withoutFlexWins, advanced.flexSummary.withoutFlexDecided)}</strong> (${advanced.flexSummary.withoutFlexGames}g)</p>
    <table><thead><tr><th>${esc(t("ฮีโร่"))}</th><th class="num">${esc(t("เกม"))}</th><th class="num">W-L</th><th class="num">WR%</th><th>Per-Lane Breakdown</th></tr></thead><tbody>${flexRows}</tbody></table>
  </div>` : ""}

  <div class="card">
    <h3>${esc(t("ตารางผลงานฮีโร่ทั้งหมด"))} (Top ${sortedHeroes.length})</h3>
    <table>
      <thead><tr><th>${esc(t("ฮีโร่"))}</th><th>Lane</th><th class="num">Pick</th><th class="num">W-L</th><th class="num">WR%</th><th class="num">${esc(t("WR ปรับฐาน"))}</th><th class="num">${isAll ? "Contest%" : "Delta"}</th><th class="num">P1%</th><th class="num">First / Last</th></tr></thead>
      <tbody>${heroTableRows || `<tr><td colspan="9" class="muted">—</td></tr>`}</tbody>
    </table>
  </div>

  <div class="card">
    <div class="grid-2">
      <div>
        <h3>${esc(t("แผนคอมพ์ทีม & คู่เปิดดราฟต์"))}</h3>
        <p class="sub-line">${esc(t("ความหลากหลายในการเปิดดราฟต์ Phase 1"))}: <strong>${advanced.compSummary.openingDiversityPct.toFixed(0)}%</strong> (${advanced.compSummary.uniqueOpeningCount} ${esc(t("ตัวที่เคยเปิด P1–P3"))})</p>
        <table><thead><tr><th>Archetype</th><th class="num">Usage</th><th class="num">W-L</th><th class="num">WR%</th></tr></thead><tbody>${archRows || `<tr><td colspan="4" class="muted">—</td></tr>`}</tbody></table>
      </div>
      <div>
        <h3>${esc(t("4. คู่เปิด Phase 1 ยอดฮิต"))}</h3>
        <table><thead><tr><th>Opening Pair</th><th class="num">${esc(t("เกม"))}</th><th class="num">W-L</th><th class="num">WR%</th></tr></thead><tbody>${openingRows || `<tr><td colspan="4" class="muted">—</td></tr>`}</tbody></table>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="grid-2">
      <div>
        <h3>${esc(t("คู่คอมโบเด่น"))}</h3>
        <table><thead><tr><th>Duo</th><th class="num">Lift</th><th class="num">WR%</th><th class="num">W-L</th></tr></thead><tbody>${duoRows || `<tr><td colspan="4" class="muted">—</td></tr>`}</tbody></table>
      </div>
      <div>
        <h3>${esc(t("สามประสานคุมเกม"))}</h3>
        <table><thead><tr><th>Trio</th><th class="num">${esc(t("เกม"))}</th><th class="num">${esc(t("WR ปรับฐาน"))}</th><th class="num">W-L</th></tr></thead><tbody>${trioRows || `<tr><td colspan="4" class="muted">—</td></tr>`}</tbody></table>
      </div>
    </div>
  </div>

  ${enemyHtml}
  ${laneMatchupHtml}
  ${standingsHtml}
  ${periodHtml}
</body>
</html>`;
}

export async function printScoutingReportPdf(params: ScoutingPdfParams): Promise<void> {
  const html = buildScoutingReportPrintHtml(params);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  const imgs = Array.from(doc.images);
  await Promise.race([
    Promise.all(
      imgs.map(
        (img) =>
          img.complete ||
          new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
      ),
    ),
    new Promise<void>((resolve) => window.setTimeout(resolve, 1500)),
  ]);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    iframe.remove();
  };
  win.addEventListener("afterprint", cleanup, { once: true });
  win.focus();
  win.print();
  window.setTimeout(cleanup, 30000);
}

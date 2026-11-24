import { BarChart3, ExternalLink, ShieldBan, Trophy, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { getJson } from "../api/client";
import { getTeam, teamPath, type Team, type TeamGame } from "../api/team";
import { useLanguage } from "../i18n/language";
import type { Hero, LaneKey, RecordedDraftGame } from "../types/draft";
import { LANE_SHORT } from "../utils/draft";
import { displayName } from "../utils/heroNames";
import { HeroPortrait } from "./HeroPortrait";
import { Modal } from "./Modal";
import { StableButtonLabel } from "./StableButtonLabel";

interface ScrimAnalyticsModalProps {
  personalGames: RecordedDraftGame[];
  heroMap: Map<string, Hero>;
  isPaid: boolean;
  teamHistoryEnabled: boolean;
  defaultTeamName?: string;
  onClose: () => void;
}

interface HeroCountStat {
  hero: string;
  count: number;
  wins: number;
  losses: number;
  lanes: Partial<Record<LaneKey, number>>;
}

function wrPct(wins: number, decided: number): string {
  return decided > 0 ? `${((wins / decided) * 100).toFixed(1)}%` : "—";
}

export function ScrimAnalyticsModal({
  personalGames,
  heroMap,
  isPaid,
  teamHistoryEnabled,
  defaultTeamName = "",
  onClose,
}: ScrimAnalyticsModalProps) {
  const { t } = useLanguage();
  const titleId = useId();
  const [source, setSource] = useState<"personal" | "team">("personal");
  const [team, setTeam] = useState<Team | null>(null);
  const [teamGames, setTeamGames] = useState<RecordedDraftGame[] | null>(null);
  const [teamGamesError, setTeamGamesError] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string>(defaultTeamName.trim());
  const [opponentFilter, setOpponentFilter] = useState<string>("ALL");

  useEffect(() => {
    if (!isPaid || !teamHistoryEnabled) return;
    const ctrl = new AbortController();
    getTeam(ctrl.signal)
      .then((res) => {
        if (ctrl.signal.aborted || !res.team) return null;
        setTeam(res.team);
        setTeamGamesError(null);
        return getJson<TeamGame[]>(`${teamPath}/history`, ctrl.signal);
      })
      .then((rows) => {
        if (rows && !ctrl.signal.aborted) {
          setTeamGames(rows.map((r) => r.game));
        }
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setTeamGamesError("โหลดประวัติทีมไม่สำเร็จ");
      });
    return () => ctrl.abort();
  }, [isPaid, teamHistoryEnabled]);

  const teamGamesLoading = isPaid && teamHistoryEnabled && team !== null && teamGames === null && teamGamesError === null;
  const activeGames = useMemo(
    () => (source === "team" && team ? (teamGames ?? []) : personalGames),
    [source, team, teamGames, personalGames],
  );

  const teamNames = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const g of activeGames) {
      for (const raw of [g.blueTeamName?.trim(), g.redTeamName?.trim()]) {
        if (!raw) continue;
        const key = raw.toLowerCase();
        const prev = counts.get(key);
        if (prev) prev.count += 1;
        else counts.set(key, { label: raw, count: 1 });
      }
    }
    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .map((entry) => entry.label);
  }, [activeGames]);

  const focusTeam = useMemo(() => {
    if (selectedTeam) {
      const match = teamNames.find((n) => n.toLowerCase() === selectedTeam.toLowerCase());
      if (match) return match;
    }
    return teamNames[0] ?? "";
  }, [selectedTeam, teamNames]);

  const opponents = useMemo(() => {
    const map = new Map<string, string>();
    const focusLower = focusTeam.toLowerCase();
    for (const g of activeGames) {
      const b = g.blueTeamName?.trim() ?? "";
      const r = g.redTeamName?.trim() ?? "";
      if (b.toLowerCase() === focusLower && r) {
        const key = r.toLowerCase();
        if (!map.has(key)) map.set(key, r);
      } else if (r.toLowerCase() === focusLower && b) {
        const key = b.toLowerCase();
        if (!map.has(key)) map.set(key, b);
      }
    }
    return Array.from(map.values()).sort();
  }, [activeGames, focusTeam]);

  const activeOpponent =
    opponentFilter === "ALL" || opponents.some((o) => o.toLowerCase() === opponentFilter.toLowerCase())
      ? opponentFilter
      : "ALL";

  const analytics = useMemo(() => {
    const focusLower = focusTeam.toLowerCase();
    const oppLower = activeOpponent === "ALL" ? null : activeOpponent.toLowerCase();
    let total = 0;
    let wins = 0;
    let losses = 0;
    let blueWins = 0;
    let blueDecided = 0;
    let redWins = 0;
    let redDecided = 0;
    const byGameNum = new Map<number, { total: number; wins: number; decided: number }>();
    const allyPicks = new Map<string, HeroCountStat>();
    const enemyPicks = new Map<string, HeroCountStat>();
    const bannedAgainstUs = new Map<string, number>();

    for (const g of activeGames) {
      const bName = g.blueTeamName?.trim() ?? "";
      const rName = g.redTeamName?.trim() ?? "";
      const isBlue = bName.toLowerCase() === focusLower;
      const isRed = rName.toLowerCase() === focusLower;
      if (!focusLower || (!isBlue && !isRed)) continue;
      const oppName = isBlue ? rName : bName;
      if (oppLower && oppName.toLowerCase() !== oppLower) continue;

      total += 1;
      const teamId = isBlue ? g.blueSideTeam : g.blueSideTeam === "A" ? "B" : "A";
      const decided = g.winner === "A" || g.winner === "B";
      const didWin = decided && g.winner === teamId;
      if (decided) {
        if (didWin) wins += 1;
        else losses += 1;
        if (isBlue) {
          blueDecided += 1;
          if (didWin) blueWins += 1;
        } else {
          redDecided += 1;
          if (didWin) redWins += 1;
        }
      }

      const gnEntry = byGameNum.get(g.gameNumber) ?? { total: 0, wins: 0, decided: 0 };
      gnEntry.total += 1;
      if (decided) {
        gnEntry.decided += 1;
        if (didWin) gnEntry.wins += 1;
      }
      byGameNum.set(g.gameNumber, gnEntry);

      const ourPicks = isBlue ? g.bluePicks : g.redPicks;
      const theirPicks = isBlue ? g.redPicks : g.bluePicks;
      const theirBans = isBlue ? g.redBans : g.blueBans;

      for (const hero of ourPicks) {
        const st = allyPicks.get(hero) ?? { hero, count: 0, wins: 0, losses: 0, lanes: {} };
        st.count += 1;
        if (decided) {
          if (didWin) st.wins += 1;
          else st.losses += 1;
        }
        const lane = g.pickLanes?.[hero];
        if (lane) st.lanes[lane] = (st.lanes[lane] ?? 0) + 1;
        allyPicks.set(hero, st);
      }
      for (const hero of theirPicks) {
        const st = enemyPicks.get(hero) ?? { hero, count: 0, wins: 0, losses: 0, lanes: {} };
        st.count += 1;
        if (decided) {
          if (didWin) st.wins += 1;
          else st.losses += 1;
        }
        enemyPicks.set(hero, st);
      }
      for (const hero of theirBans) bannedAgainstUs.set(hero, (bannedAgainstUs.get(hero) ?? 0) + 1);
    }

    return {
      total,
      wins,
      losses,
      decided: wins + losses,
      blueWins,
      blueDecided,
      redWins,
      redDecided,
      byGameNum,
      topPicks: Array.from(allyPicks.values()).sort((a, b) => b.count - a.count).slice(0, 8),
      toughestEnemies: Array.from(enemyPicks.values())
        .filter((e) => e.wins + e.losses >= 1)
        .sort((a, b) => a.wins / (a.wins + a.losses) - b.wins / (b.wins + b.losses) || b.count - a.count)
        .slice(0, 6),
      bannedAgainstUs: Array.from(bannedAgainstUs.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6),
    };
  }, [activeGames, focusTeam, activeOpponent]);

  return (
    <Modal labelledBy={titleId} className="max-w-4xl overflow-hidden" onClose={onClose}>
      {(requestClose) => (
        <>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-gold" />
              <h2 id={titleId} className="font-display text-sm font-bold tracking-wider text-ink sm:text-base">
                {t("SCRIM ANALYTICS · วิเคราะห์สถิติซ้อมทีม")}
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {isPaid && (
                <a
                  href="/#analytics"
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t("เปิดหน้า Dashboard เต็มจอในแท็บใหม่")}
                  className="inline-flex h-8 items-center gap-1.5 border border-gold/50 bg-gold/10 px-2.5 font-display text-xs font-bold text-gold transition-colors hover:bg-gold hover:text-bg"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Dashboard</span>
                </a>
              )}
              <button
                type="button"
                onClick={() => requestClose()}
                aria-label={t("ปิด")}
                className="inline-flex h-8 w-8 items-center justify-center rounded text-dim hover:bg-panel-2 hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {!isPaid ? (
            <div className="space-y-4 p-6 text-center">
              <Trophy className="mx-auto size-10 text-gold" />
              <p className="font-display text-base font-bold text-ink">
                {t("Scrim Analytics พร้อมใช้งานสำหรับแพ็ก Pro, Duo และ Team Pro")}
              </p>
              <p className="mx-auto max-w-md text-xs text-muted">
                {t("วิเคราะห์ Win Rate ฝั่ง Blue/Red, เกมที่ 1–7, ฮีโร่ที่หยิบและโดนแบนบ่อย รวมถึงคู่แข่งที่แพ้ทางจากประวัติ 500 เกมอัตโนมัติ")}
              </p>
              <a
                href="#plans"
                onClick={() => requestClose()}
                className="inline-flex min-h-10 items-center justify-center border border-gold bg-gold px-5 font-display text-xs font-bold text-bg hover:bg-gold/90"
              >
                <StableButtonLabel message="ดูแพ็ก" />
              </a>
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {/* Source & filters */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-pressed={source === "personal"}
                    onClick={() => {
                      setSource("personal");
                      setOpponentFilter("ALL");
                    }}
                    className="min-h-8 border border-line-strong px-3 text-xs font-semibold text-muted aria-pressed:border-gold aria-pressed:text-gold"
                  >
                    <StableButtonLabel message="ประวัติส่วนตัว" /> ({personalGames.length})
                  </button>
                  {team && (
                    <button
                      type="button"
                      aria-pressed={source === "team"}
                      onClick={() => {
                        setSource("team");
                        setOpponentFilter("ALL");
                      }}
                      className="min-h-8 border border-line-strong px-3 text-xs font-semibold text-muted aria-pressed:border-blue aria-pressed:text-blue"
                    >
                      <StableButtonLabel message="ประวัติทีม" /> ({teamGames?.length ?? 0})
                    </button>
                  )}
                </div>

                {teamNames.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-muted">
                      <span>{t("ทีม:")}</span>
                      <select
                        value={focusTeam}
                        onChange={(e) => {
                          setSelectedTeam(e.target.value);
                          setOpponentFilter("ALL");
                        }}
                        className="min-h-8 border border-line-strong bg-bg px-2 font-display text-xs font-bold text-ink"
                      >
                        {teamNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-muted">
                      <span>{t("เจอ:")}</span>
                      <select
                        value={activeOpponent}
                        onChange={(e) => setOpponentFilter(e.target.value)}
                        className="min-h-8 border border-line-strong bg-bg px-2 font-display text-xs font-bold text-ink"
                      >
                        <option value="ALL">{t("ทุกทีม")}</option>
                        {opponents.map((opp) => (
                          <option key={opp} value={opp}>
                            {opp}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>

              {source === "team" && teamGamesLoading ? (
                <p className="border border-dashed border-line p-8 text-center text-xs text-muted" role="status">
                  {t("กำลังโหลดประวัติทีม")}…
                </p>
              ) : source === "team" && teamGamesError ? (
                <p className="border border-red/40 bg-red/10 p-6 text-center text-xs text-red">
                  {t(teamGamesError)}
                </p>
              ) : analytics.total === 0 ? (
                <p className="border border-dashed border-line p-8 text-center text-xs text-muted">
                  {t("ยังไม่มีเกมที่บันทึกในประวัติสำหรับแสดงสถิติ")}
                </p>
              ) : (
                <>
                  {/* KPI cards */}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="border border-line bg-bg p-3">
                      <p className="text-[11px] text-muted">{t("จำนวนเกมทั้งหมด")}</p>
                      <p className="font-mono text-xl font-bold text-ink">{analytics.total}</p>
                      <p className="text-[11px] text-dim">
                        {analytics.wins}W - {analytics.losses}L
                      </p>
                    </div>
                    <div className="border border-line bg-bg p-3">
                      <p className="text-[11px] text-muted">{t("Win Rate รวม")}</p>
                      <p className="font-mono text-xl font-bold text-gold">
                        {wrPct(analytics.wins, analytics.decided)}
                      </p>
                      <p className="text-[11px] text-dim">
                        {analytics.decided} {t("เกมที่ลงผลชนะ")}
                      </p>
                    </div>
                    <div className="border border-blue/30 bg-blue/5 p-3">
                      <p className="text-[11px] text-blue">Blue Side WR</p>
                      <p className="font-mono text-xl font-bold text-ink">
                        {wrPct(analytics.blueWins, analytics.blueDecided)}
                      </p>
                      <p className="text-[11px] text-dim">
                        {analytics.blueWins}/{analytics.blueDecided}
                      </p>
                    </div>
                    <div className="border border-red/30 bg-red/5 p-3">
                      <p className="text-[11px] text-red">Red Side WR</p>
                      <p className="font-mono text-xl font-bold text-ink">
                        {wrPct(analytics.redWins, analytics.redDecided)}
                      </p>
                      <p className="text-[11px] text-dim">
                        {analytics.redWins}/{analytics.redDecided}
                      </p>
                    </div>
                  </div>

                  {/* Game 1-7 */}
                  <div className="border border-line bg-bg p-3">
                    <p className="mb-2 text-xs font-bold text-ink">{t("ผลงานแยกตามลำดับเกม (G1–G7)")}</p>
                    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                      {[1, 2, 3, 4, 5, 6, 7].map((gNum) => {
                        const row = analytics.byGameNum.get(gNum);
                        return (
                          <div key={gNum} className="border border-line bg-panel px-2 py-1.5 text-center">
                            <p className="font-mono text-[10px] font-bold text-gold">G{gNum}</p>
                            <p className="font-mono text-xs font-bold text-ink">
                              {row ? wrPct(row.wins, row.decided) : "—"}
                            </p>
                            <p className="font-mono text-[10px] text-dim">{row?.total ?? 0}g</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Hero picks & bans */}
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="border border-line bg-bg p-3">
                      <p className="mb-2 text-xs font-bold text-ink">{t("ฮีโร่ที่ทีมหยิบบ่อยสุด")}</p>
                      <ul className="space-y-1.5">
                        {analytics.topPicks.map((item) => {
                          const topLane = Object.entries(item.lanes).sort((a, b) => b[1] - a[1])[0]?.[0] as
                            | LaneKey
                            | undefined;
                          return (
                            <li key={item.hero} className="flex items-center justify-between gap-2 text-xs">
                              <div className="flex min-w-0 items-center gap-2">
                                <div className="size-6 shrink-0 overflow-hidden border border-line">
                                  <HeroPortrait name={item.hero} hero={heroMap.get(item.hero)} />
                                </div>
                                <span className="truncate font-semibold text-ink">{displayName(item.hero)}</span>
                                {topLane && (
                                  <span className="border border-line px-1 font-mono text-[10px] text-muted">
                                    {LANE_SHORT[topLane]?.en ?? topLane}
                                  </span>
                                )}
                              </div>
                              <span className="shrink-0 font-mono text-muted">
                                {item.count}g · <strong className="text-good">{wrPct(item.wins, item.wins + item.losses)}</strong>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    <div className="space-y-3">
                      <div className="border border-line bg-bg p-3">
                        <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-ink">
                          <ShieldBan className="size-3.5 text-red" />
                          <span>{t("ตัวที่โดนคู่แข่งแบนใส่บ่อยสุด")}</span>
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {analytics.bannedAgainstUs.map(([hero, cnt]) => (
                            <span
                              key={hero}
                              className="inline-flex items-center gap-1 border border-line bg-panel px-2 py-1 text-xs"
                            >
                              <span>{displayName(hero)}</span>
                              <strong className="font-mono text-red">{cnt}</strong>
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="border border-line bg-bg p-3">
                        <p className="mb-2 text-xs font-bold text-ink">{t("ฮีโร่ฝั่งตรงข้ามที่แพ้ทาง")}</p>
                        {analytics.toughestEnemies.length === 0 ? (
                          <p className="text-xs text-dim">{t("ยังไม่มีข้อมูลผลแพ้ชนะเพียงพอ")}</p>
                        ) : (
                          <ul className="space-y-1">
                            {analytics.toughestEnemies.map((item) => (
                              <li key={item.hero} className="flex items-center justify-between text-xs">
                                <span className="text-ink">{displayName(item.hero)}</span>
                                <span className="font-mono text-red">
                                  {wrPct(item.wins, item.wins + item.losses)} ({item.wins}W-{item.losses}L)
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

import { History, Play, Trash2, Trophy, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { useLanguage } from "../i18n/language";
import type { Hero } from "../types/draft";
import { displayName } from "../utils/heroNames";
import { MAX_PRACTICE_HISTORY, type PracticeHistoryEntry } from "../utils/practiceHistory";
import { ConfirmDialog } from "./ConfirmDialog";
import { HeroPortrait } from "./HeroPortrait";
import { Modal } from "./Modal";
import { StableButtonLabel } from "./StableButtonLabel";

interface PracticeHistoryModalProps {
  entries: PracticeHistoryEntry[];
  heroMap: Map<string, Hero>;
  onLoadEntry: (entry: PracticeHistoryEntry) => void;
  onDeleteEntry: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}

export function PracticeHistoryModal({
  entries,
  heroMap,
  onLoadEntry,
  onDeleteEntry,
  onClearAll,
  onClose,
}: PracticeHistoryModalProps) {
  const { t, language } = useLanguage();
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const stats = useMemo(() => {
    if (entries.length === 0) {
      return { total: 0, favoured: 0, favouredPct: 0, avgWin: 50 };
    }
    const favoured = entries.filter((item) => item.playerEstimate >= 50).length;
    const sum = entries.reduce((acc, item) => acc + item.playerEstimate, 0);
    return {
      total: entries.length,
      favoured,
      favouredPct: (favoured / entries.length) * 100,
      avgWin: sum / entries.length,
    };
  }, [entries]);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(language === "en" ? "en-GB" : "th-TH", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [language],
  );

  return (
    <Modal
      labelledBy={titleId}
      initialFocusRef={titleRef}
      mobileSheet
      onClose={onClose}
      className="flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden p-0 sm:max-h-[88dvh]"
    >
      {(requestClose) => (
        <>
          <div className="h-0.5 w-full shrink-0 bg-gold" />

          {/* Header */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5 sm:px-4 sm:py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <History className="size-4 shrink-0 text-gold sm:size-5" aria-hidden="true" />
              <div className="min-w-0">
                <h2
                  id={titleId}
                  ref={titleRef}
                  tabIndex={-1}
                  className="flex flex-wrap items-center gap-2 font-display text-xs font-bold tracking-wider text-ink sm:text-sm lg:text-base"
                >
                  <span>{t("ประวัติฝึกดราฟต์ vs AI")}</span>
                  <span className="border border-gold/60 bg-gold/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-gold sm:px-2 sm:text-xs">
                    {entries.length}/{MAX_PRACTICE_HISTORY}
                  </span>
                </h2>
                <p className="hidden text-[11px] text-dim sm:block lg:text-xs">
                  {t("บันทึกเกมที่ดราฟต์จบอัตโนมัติ (แยกจากกระดานหลัก)")}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={entries.length === 0}
                onClick={() =>
                  setConfirmState({
                    title: t("ล้างประวัติทั้งหมด?"),
                    message: t("ลบประวัติดราฟต์แข่งกับ AI ทั้งหมดที่บันทึกไว้? (ไม่สามารถย้อนกลับได้)"),
                    onConfirm: () => {
                      setConfirmState(null);
                      onClearAll();
                    },
                  })
                }
                className="flex h-7 items-center gap-1 border border-red/40 bg-red/10 px-2 font-display text-[11px] font-semibold tracking-wide text-red transition-colors hover:bg-red hover:text-ink disabled:pointer-events-none disabled:opacity-35 sm:h-8 sm:px-2.5 lg:text-xs"
              >
                <Trash2 className="size-3.5 shrink-0" aria-hidden="true" />
                <StableButtonLabel message="ล้างทั้งหมด" />
              </button>
              <button
                type="button"
                onClick={() => requestClose()}
                aria-label={t("ปิด")}
                className="grid size-8 place-items-center border border-line bg-bg text-dim transition-colors hover:border-ink/40 hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Summary Bar */}
          {entries.length > 0 && (
            <dl className="grid shrink-0 grid-cols-3 gap-2 border-b border-line bg-bg/70 px-3 py-2.5 sm:px-4">
              <div className="border border-line bg-panel px-2.5 py-1.5">
                <dt className="truncate font-mono text-[10px] text-dim">{t("เกมที่เล่น")}</dt>
                <dd className="font-mono text-sm font-bold text-ink tabular-nums sm:text-base">{stats.total}</dd>
              </div>
              <div className="border border-line bg-panel px-2.5 py-1.5">
                <dt className="truncate font-mono text-[10px] text-dim">{t("ได้เปรียบ")}</dt>
                <dd className="font-mono text-sm font-bold text-good tabular-nums sm:text-base">
                  {stats.favoured}/{stats.total}{" "}
                  <span className="text-[11px] text-muted">({stats.favouredPct.toFixed(0)}%)</span>
                </dd>
              </div>
              <div className="border border-line bg-panel px-2.5 py-1.5">
                <dt className="truncate font-mono text-[10px] text-dim">{t("Win% เฉลี่ย")}</dt>
                <dd
                  className={`font-mono text-sm font-bold tabular-nums sm:text-base ${
                    stats.avgWin >= 50 ? "text-gold" : "text-ink"
                  }`}
                >
                  {stats.avgWin.toFixed(1)}%
                </dd>
              </div>
            </dl>
          )}

          {/* Body */}
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3 sm:px-4">
            {entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center border border-dashed border-line-strong bg-bg/50 px-4 py-12 text-center">
                <Trophy className="mb-2.5 size-8 text-dim" aria-hidden="true" />
                <p className="font-display text-sm font-bold text-ink">{t("ยังไม่มีประวัติฝึกดราฟต์กับ AI")}</p>
                <p className="mt-1 max-w-md text-xs text-muted">
                  {t("ดราฟต์กับ AI ให้ครบ 18 เทิร์น แล้วระบบจะบันทึกเกมพร้อมผลประเมินให้อัตโนมัติ")}
                </p>
              </div>
            ) : (
              entries.map((entry) => {
                const playerFavoured = entry.playerEstimate >= 50;
                const formattedTime = (() => {
                  const date = new Date(entry.recordedAt);
                  return Number.isNaN(date.getTime()) ? entry.recordedAt : dateFormatter.format(date);
                })();
                const blueLabel = t(entry.playerSide === "blue" ? "คุณ" : "AI");
                const redLabel = t(entry.playerSide === "red" ? "คุณ" : "AI");

                return (
                  <article
                    key={entry.id}
                    className="border border-line-strong bg-panel p-2.5 transition-colors hover:border-gold/40 sm:p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 pb-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="border border-gold/40 bg-gold/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-gold">
                          Bo{entry.gameCount} · {t("เกม {0}/{1}", entry.gameNumber, entry.gameCount)}
                        </span>
                        <span
                          className={`border px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                            entry.playerSide === "blue"
                              ? "border-blue/40 bg-blue/10 text-blue"
                              : "border-red/40 bg-red/10 text-red"
                          }`}
                        >
                          {t("คุณ")} ({t(entry.playerSide === "blue" ? "ฝั่งน้ำเงิน" : "ฝั่งแดง")})
                        </span>
                        <span
                          className={`border px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ${
                            playerFavoured
                              ? "border-good/50 bg-good/15 text-good"
                              : "border-line bg-panel-2 text-muted"
                          }`}
                        >
                          {entry.playerEstimate.toFixed(1)}%
                        </span>
                        <span className="font-mono text-[10px] text-dim">{formattedTime}</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => requestClose(() => onLoadEntry(entry))}
                          title={t("โหลดเกมนี้เข้ากระดานเพื่อทบทวนหรือลองแก้ Pick 1–5 ใหม่")}
                          className="inline-flex h-7 items-center gap-1 border border-gold bg-gold px-2.5 font-display text-[11px] font-bold text-bg transition-colors hover:bg-gold/90"
                        >
                          <Play className="size-3 shrink-0 fill-current" aria-hidden="true" />
                          <StableButtonLabel message="เปิดทบทวน" />
                        </button>
                        <button
                          type="button"
                          aria-label={t("ลบเกมนี้")}
                          title={t("ลบเกมนี้")}
                          onClick={() =>
                            setConfirmState({
                              title: t("ลบประวัติดราฟต์นี้?"),
                              message: t("ต้องการลบเกม {0} ออกจากประวัติฝึกดราฟต์ vs AI ใช่ไหม?", entry.gameNumber),
                              onConfirm: () => {
                                setConfirmState(null);
                                onDeleteEntry(entry.id);
                              },
                            })
                          }
                          className="grid size-7 place-items-center border border-red/40 bg-red/10 text-red transition-colors hover:bg-red hover:text-ink"
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    {/* Blue & Red 5v5 Heroes */}
                    <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="border border-blue/25 bg-bg/60 p-2">
                        <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
                          <span className="shrink-0 font-display font-bold text-blue">
                            BLUE · {blueLabel}
                          </span>
                          <span className="min-w-0 truncate font-mono text-[10px] text-dim">
                            {entry.blueBans.map((b) => displayName(b)).join(", ")}
                          </span>
                        </div>
                        <div className="grid grid-cols-5 gap-1">
                          {entry.bluePicks.map((hero) => (
                            <div
                              key={hero}
                              title={displayName(hero)}
                              className="group relative aspect-square overflow-hidden border border-blue/40 bg-panel-2"
                            >
                              <HeroPortrait name={hero} hero={heroMap.get(hero)} />
                              <span className="sr-only">{displayName(hero)}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="border border-red/25 bg-bg/60 p-2">
                        <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
                          <span className="shrink-0 font-display font-bold text-red">
                            RED · {redLabel}
                          </span>
                          <span className="min-w-0 truncate font-mono text-[10px] text-dim">
                            {entry.redBans.map((b) => displayName(b)).join(", ")}
                          </span>
                        </div>
                        <div className="grid grid-cols-5 gap-1">
                          {entry.redPicks.map((hero) => (
                            <div
                              key={hero}
                              title={displayName(hero)}
                              className="group relative aspect-square overflow-hidden border border-red/40 bg-panel-2"
                            >
                              <HeroPortrait name={hero} hero={heroMap.get(hero)} />
                              <span className="sr-only">{displayName(hero)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between border-t border-line bg-bg/70 px-3 py-2 text-[11px] text-dim sm:px-4">
            <span>{t("บันทึกอัตโนมัติสูงสุด {0} เกมล่าสุด", MAX_PRACTICE_HISTORY)}</span>
            <span>
              {entries.length}/{MAX_PRACTICE_HISTORY}
            </span>
          </div>

          {confirmState && (
            <ConfirmDialog
              title={confirmState.title}
              message={confirmState.message}
              confirmLabel="ลบ"
              tone="danger"
              onConfirm={confirmState.onConfirm}
              onCancel={() => setConfirmState(null)}
            />
          )}
        </>
      )}
    </Modal>
  );
}

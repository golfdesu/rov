import { StableButtonLabel } from "./StableButtonLabel";
import { useLanguage } from "../i18n/language";
import { RotateCcw, X } from "lucide-react";
import { CANONICAL_LANES, type Hero, type LaneKey } from "../types/draft";
import { LANE_SHORT, laneKey } from "../utils/draft";
import { displayName } from "../utils/heroNames";
import { HeroPortrait } from "./HeroPortrait";
import { LaneIcon } from "./LaneIcon";
import { Modal } from "./Modal";

interface PickLaneModalProps {
  heroName: string;
  side: "blue" | "red";
  teamName: string;
  hero?: Hero;
  currentLane?: LaneKey;
  lockedByLane?: Partial<Record<LaneKey, string>>;
  onSelectLane: (lane?: LaneKey) => void;
  onClose: () => void;
}

export function PickLaneModal({
  heroName,
  side,
  teamName,
  hero,
  currentLane,
  lockedByLane = {},
  onSelectLane,
  onClose,
}: PickLaneModalProps) {
  const { t } = useLanguage();
  const isBlue = side === "blue";
  const defaultLane = laneKey(
    hero?.main_pro_lane && hero.main_pro_lane !== "Unpicked" ? hero.main_pro_lane : hero?.lane,
  );
  const defaultShort = LANE_SHORT[defaultLane];

  return (
    <Modal labelledBy="pick-lane-title" className="sm:max-w-sm" mobileSheet onClose={onClose}>
      {(requestClose) => {
        const handleSelect = (lane?: LaneKey) => {
          onSelectLane(lane);
          requestClose();
        };
        return (
          <>
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`h-11 w-11 shrink-0 overflow-hidden border ${isBlue ? "border-blue/60" : "border-red/60"}`}>
            <HeroPortrait name={heroName} hero={hero} />
          </div>
          <div className="min-w-0">
            <div className={`font-mono text-[10px] font-bold tracking-wider ${isBlue ? "text-blue" : "text-red"}`}>
              {isBlue ? "BLUE" : "RED"} · {teamName}
            </div>
            <h3 id="pick-lane-title" className="truncate font-display text-base font-bold text-ink">
              {displayName(heroName)}
            </h3>
            <p className="text-[11px] text-muted">
              {t("เลือกตำแหน่งที่เล่นจริงในเกมนี้")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => requestClose()}
          aria-label={t("ปิดหน้าต่างเลือกเลน")}
          className="flex h-9 w-9 shrink-0 items-center justify-center border border-line text-muted transition-colors hover:border-line-strong hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-2 p-4">
        <button
          type="button"
          onClick={() => handleSelect(undefined)}
          className={`flex min-h-[44px] w-full items-center justify-between gap-2 border px-3 py-2 text-left transition-colors ${
            !currentLane
              ? "border-gold/70 bg-gold/15 text-gold"
              : "border-line bg-bg/60 text-ink hover:border-line-strong hover:bg-panel-2"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-line bg-panel">
              <RotateCcw className="h-4 w-4" />
            </div>
            <div>
              <div className="font-mono text-xs font-bold tracking-wide">AUTO</div>
              <div className="text-xs text-muted">
                <StableButtonLabel message={defaultShort ? ["ค่าเริ่มต้น ({0})", defaultShort.en] : "ค่าอัตโนมัติ"} />
              </div>
            </div>
          </div>
          {!currentLane && <span className="font-mono text-[10px] font-bold text-gold">ACTIVE</span>}
        </button>

        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {CANONICAL_LANES.map((lane) => {
            const key = lane.key as LaneKey;
            const short = LANE_SHORT[key];
            const isSelected = currentLane === key;
            const isDefault = key === defaultLane;
            const lockedBy = lockedByLane[key];
            const isTaken = Boolean(lockedBy && lockedBy !== heroName);
            return (
              <button
                key={key}
                type="button"
                disabled={isTaken}
                onClick={() => handleSelect(key)}
                title={
                  isTaken && lockedBy
                    ? t("ตำแหน่งนี้ถูกล็อกให้ {0} แล้ว", displayName(lockedBy))
                    : undefined
                }
                className={`flex min-h-[48px] items-center justify-between gap-2.5 border px-3 py-2 text-left transition-colors ${
                  isSelected
                    ? "border-gold bg-gold/20 text-gold"
                    : isTaken
                      ? "cursor-not-allowed border-line/60 bg-bg/40 text-dim opacity-55"
                      : "border-line bg-bg/80 text-ink hover:border-line-strong hover:bg-panel-2"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center border ${
                      isSelected
                        ? "border-gold/60 bg-gold/10 text-gold"
                        : isTaken
                          ? "border-line/60 bg-panel/50 text-dim"
                          : "border-line bg-panel text-ink"
                    }`}
                  >
                    <LaneIcon lane={key} className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-mono text-xs font-bold">
                      <span>{short?.en ?? key}</span>
                      {isDefault && <span className="text-[9px] font-normal text-muted">{t("(หลัก)")}</span>}
                    </div>
                    <div className="truncate text-xs text-muted">
                      <StableButtonLabel message={isTaken && lockedBy ? ["ล็อก: {0}", displayName(lockedBy)] : short?.th ?? lane.nameTh} />
                    </div>
                  </div>
                </div>
                {isSelected && <span className="shrink-0 font-mono text-[10px] font-bold text-gold"><StableButtonLabel message="เลือกอยู่" /></span>}
              </button>
            );
          })}
        </div>
      </div>
          </>
        );
      }}
    </Modal>
  );
}

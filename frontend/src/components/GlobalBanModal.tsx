import { StableButtonLabel } from "./StableButtonLabel";
import { useLanguage } from "../i18n/language";
import { ArrowLeftRight, Check, Layers, Search, Trash2, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import type { GlobalBanState, Hero, RecordedDraftGame, RoleType } from "../types/draft";
import {
  EMPTY_GLOBAL_BANS,
  getGameUnlockStatus,
  getMaxUnlockedGame,
  heroOriginGameMap,
  resolveSeriesName,
  ROLES,
  syncSeriesGlobalBans,
} from "../utils/draft";
import { displayName, matchesHeroQuery } from "../utils/heroNames";
import { HeroPortrait } from "./HeroPortrait";
import { Modal } from "./Modal";

export type GlobalBanCategoryKey = "teamAUsed" | "teamBUsed" | "universalBans";

interface GlobalBanModalProps {
  heroes: Hero[];
  heroMap: Map<string, Hero>;
  globalBans: GlobalBanState;
  seriesGames?: RecordedDraftGame[];
  activeBoardHeroes?: ReadonlySet<string>;
  initialCategory?: GlobalBanCategoryKey;
  onChange: (next: GlobalBanState) => void;
  onSelectGameNumber?: (g: number, globalBansOverride?: GlobalBanState, skipAutoSave?: boolean) => void;
  onClose: () => void;
}

const ROLE_LABELS: Record<RoleType, string> = {
  Fighter: "ไฟต์เตอร์",
  Assassin: "แอสซาซิน",
  Mage: "เมจ",
  Carry: "แครี่",
  Tank: "แทงค์",
  Support: "ซัพพอร์ต",
};

const MAX_TEAM_GLOBAL_BANS = 30;
const MAX_UNIVERSAL_BANS = 20;
const MAX_EFFECTIVE_MASKED_BANS = 40;

export function GlobalBanModal({
  heroes,
  heroMap,
  globalBans,
  seriesGames = [],
  activeBoardHeroes,
  initialCategory = "teamAUsed",
  onChange,
  onSelectGameNumber,
  onClose,
}: GlobalBanModalProps) {
  const { t } = useLanguage();
  const [activeCategory, setActiveCategory] = useState<GlobalBanCategoryKey>(initialCategory);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<RoleType | null>(null);
  const [limitNotice, setLimitNotice] = useState<string | null>(null);
  const titleId = useId();
  const searchRef = useRef<HTMLInputElement>(null);

  const teamAIsBlue = globalBans.blueSideTeam === "A";
  const blueTeamNameField = teamAIsBlue ? "teamAName" : "teamBName";
  const redTeamNameField = teamAIsBlue ? "teamBName" : "teamAName";
  const blueNameValue = globalBans[blueTeamNameField];
  const redNameValue = globalBans[redTeamNameField];

  const originMap = useMemo(
    () => heroOriginGameMap(seriesGames, resolveSeriesName(globalBans)),
    [seriesGames, globalBans],
  );

  const teamACat = {
    key: "teamAUsed" as GlobalBanCategoryKey,
    label: t("{0} เคยใช้", globalBans.teamAName),
    shortLabel: globalBans.teamAName,
    sideBadge: teamAIsBlue ? t("อยู่ฝั่ง BLUE (ซ้าย)") : t("อยู่ฝั่ง RED (ขวา)"),
    shortSide: teamAIsBlue ? "BLUE" : "RED",
    desc: t("ฮีโร่ที่ทีม {0} หยิบใช้ไปแล้วในซีรีส์นี้ (จะตามทีม {1} ไปอัตโนมัติไม่ว่าจะสลับไปอยู่ฝั่งฟ้าหรือแดง)", globalBans.teamAName, globalBans.teamAName),
    activeTabClass: teamAIsBlue ? "border-blue bg-blue/15 text-blue" : "border-red bg-red/15 text-red",
    ringClass: teamAIsBlue
      ? "border-blue bg-blue/15 ring-2 ring-blue/60"
      : "border-red bg-red/15 ring-2 ring-red/60",
    badgeClass: teamAIsBlue ? "bg-blue text-ink" : "bg-red text-ink",
  };

  const teamBCat = {
    key: "teamBUsed" as GlobalBanCategoryKey,
    label: t("{0} เคยใช้", globalBans.teamBName),
    shortLabel: globalBans.teamBName,
    sideBadge: !teamAIsBlue ? t("อยู่ฝั่ง BLUE (ซ้าย)") : t("อยู่ฝั่ง RED (ขวา)"),
    shortSide: !teamAIsBlue ? "BLUE" : "RED",
    desc: t("ฮีโร่ที่ทีม {0} หยิบใช้ไปแล้วในซีรีส์นี้ (จะตามทีม {1} ไปอัตโนมัติไม่ว่าจะสลับไปอยู่ฝั่งฟ้าหรือแดง)", globalBans.teamBName, globalBans.teamBName),
    activeTabClass: !teamAIsBlue ? "border-blue bg-blue/15 text-blue" : "border-red bg-red/15 text-red",
    ringClass: !teamAIsBlue
      ? "border-blue bg-blue/15 ring-2 ring-blue/60"
      : "border-red bg-red/15 ring-2 ring-red/60",
    badgeClass: !teamAIsBlue ? "bg-blue text-ink" : "bg-red text-ink",
  };

  // Always order tabs Left = Current Blue Side, Middle = Current Red Side, Right = Universal Ban
  const categories = [
    teamAIsBlue ? teamACat : teamBCat,
    teamAIsBlue ? teamBCat : teamACat,
    {
      key: "universalBans" as GlobalBanCategoryKey,
      label: t("แบนร่วมทั้งซีรีส์"),
      shortLabel: t("แบนร่วม"),
      sideBadge: "GLOBAL BAN",
      shortSide: "GLOBAL",
      desc: t("ฮีโร่ที่ถูกแบนร่วมทั้งสองทีมตลอดซีรีส์ หรือแบนจากกติกาพิเศษ — ทั้งสองทีมจะไม่สามารถเลือกใช้ได้"),
      activeTabClass: "border-gold bg-gold/15 text-gold",
      ringClass: "border-gold bg-gold/15 ring-2 ring-gold/60",
      badgeClass: "bg-gold text-bg",
    },
  ];

  const currentCat = categories.find((c) => c.key === activeCategory) ?? categories[0];
  const activeList = globalBans[activeCategory];
  const activeSet = useMemo(() => new Set(activeList), [activeList]);
  const teamASet = useMemo(() => new Set(globalBans.teamAUsed), [globalBans.teamAUsed]);
  const teamBSet = useMemo(() => new Set(globalBans.teamBUsed), [globalBans.teamBUsed]);
  const univSet = useMemo(() => new Set(globalBans.universalBans), [globalBans.universalBans]);

  const totalCount =
    globalBans.teamAUsed.length + globalBans.teamBUsed.length + globalBans.universalBans.length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return heroes
      .filter((h) => (!q || matchesHeroQuery(h.name, q)) && (!role || h.role === role))
      .sort((a, b) => displayName(a.name).localeCompare(displayName(b.name)));
  }, [heroes, query, role]);

  const toggleHero = (heroName: string) => {
    const list = globalBans[activeCategory];
    const exists = list.includes(heroName);
    if (!exists) {
      if (activeBoardHeroes?.has(heroName)) {
        setLimitNotice(t("ไม่สามารถเพิ่ม {0} ได้ เนื่องจากถูกเลือก/แบนอยู่บนกระดานปัจจุบัน", displayName(heroName)));
        return;
      }
      if (activeCategory === "universalBans" && list.length >= MAX_UNIVERSAL_BANS) {
        setLimitNotice(t("แบนร่วมทั้งซีรีส์ได้สูงสุด {0} ตัวละคร", MAX_UNIVERSAL_BANS));
        return;
      }
      if (activeCategory !== "universalBans" && list.length >= MAX_TEAM_GLOBAL_BANS) {
        setLimitNotice(t("แบนสะสมต่อทีมได้สูงสุด {0} ตัวละคร", MAX_TEAM_GLOBAL_BANS));
        return;
      }
      const nextTeamA = activeCategory === "teamAUsed" ? [...list, heroName] : globalBans.teamAUsed;
      const nextTeamB = activeCategory === "teamBUsed" ? [...list, heroName] : globalBans.teamBUsed;
      const nextUniv = activeCategory === "universalBans" ? [...list, heroName] : globalBans.universalBans;
      const maskedA = new Set([...nextTeamA, ...nextUniv]).size;
      const maskedB = new Set([...nextTeamB, ...nextUniv]).size;
      if (maskedA > MAX_EFFECTIVE_MASKED_BANS || maskedB > MAX_EFFECTIVE_MASKED_BANS) {
        setLimitNotice(t("จำนวนแบนรวมต่อฝั่งต้องไม่เกิน {0} ตัวละคร", MAX_EFFECTIVE_MASKED_BANS));
        return;
      }
    }
    setLimitNotice(null);
    const nextList = exists ? list.filter((n) => n !== heroName) : [...list, heroName];
    onChange({
      ...globalBans,
      [activeCategory]: nextList,
    });
  };

  const clearCategory = (key: GlobalBanCategoryKey) => {
    onChange({
      ...globalBans,
      [key]: [],
    });
  };

  const swapTeamSides = () => {
    onChange({
      ...globalBans,
      blueSideTeam: globalBans.blueSideTeam === "A" ? "B" : "A",
    });
  };

  const clearAll = () => {
    const targetGame = globalBans.gameNumber;
    const clearedBase: GlobalBanState = {
      ...EMPTY_GLOBAL_BANS,
      seriesName: globalBans.seriesName,
      teamAName: globalBans.teamAName,
      teamBName: globalBans.teamBName,
      blueSideTeam: globalBans.blueSideTeam,
      gameNumber: targetGame,
    };
    const syncedForCurrent = syncSeriesGlobalBans(clearedBase, seriesGames, targetGame, []);
    const candidateState: GlobalBanState = {
      ...clearedBase,
      ...syncedForCurrent,
    };
    const maxUnlocked = getMaxUnlockedGame(candidateState, seriesGames);
    const nextGame = Math.min(targetGame, maxUnlocked);
    const syncedForNext =
      nextGame === targetGame
        ? syncedForCurrent
        : syncSeriesGlobalBans(candidateState, seriesGames, nextGame, []);
    const nextState: GlobalBanState = {
      ...candidateState,
      ...syncedForNext,
      gameNumber: nextGame,
    };
    if (nextGame !== targetGame && onSelectGameNumber) {
      onSelectGameNumber(nextGame, nextState);
      return;
    }
    onChange(nextState);
  };

  const handleClose = () => {
    const normalized: GlobalBanState = {
      ...globalBans,
      teamAName: globalBans.teamAName.trim() || "TEAM A",
      teamBName: globalBans.teamBName.trim() || "TEAM B",
    };
    const namesFixed =
      normalized.teamAName !== globalBans.teamAName || normalized.teamBName !== globalBans.teamBName;

    const currentStatus = getGameUnlockStatus(normalized.gameNumber, normalized, seriesGames);
    if (!currentStatus.isUnlocked) {
      const maxUnlocked = getMaxUnlockedGame(normalized, seriesGames);
      if (onSelectGameNumber) {
        onSelectGameNumber(maxUnlocked, normalized, false);
      } else {
        onChange({ ...normalized, gameNumber: maxUnlocked });
      }
    } else if (namesFixed) {
      onChange(normalized);
    }
    onClose();
  };

  const handleTeamNameChange = (field: "teamAName" | "teamBName", value: string) => {
    const anchorSeries =
      !globalBans.seriesName && seriesGames.length > 0 ? resolveSeriesName(globalBans) : globalBans.seriesName;
    onChange({
      ...globalBans,
      ...(anchorSeries !== undefined ? { seriesName: anchorSeries } : {}),
      [field]: value,
    });
  };

  return (
    <Modal labelledBy={titleId} className="max-w-4xl overflow-hidden" onClose={handleClose}>
      {(requestClose) => (
        <>
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Layers className="h-4 w-4 shrink-0 text-gold" />
          <div className="min-w-0">
            <h2 id={titleId} className="truncate font-display text-xs font-bold tracking-wider text-ink sm:text-sm">
              GLOBAL BAN PICK
              <span className="hidden sm:inline"> {t("· จัดการฮีโร่ที่แต่ละทีมเคยใช้ในซีรีส์")}</span>
            </h2>
            <p className="hidden text-[11px] text-dim sm:block">
              {t("ผูกประวัติตัวที่ใช้แล้วกับชื่อทีม (สลับฝั่งฟ้า/แดงได้อิสระโดยตัวที่เคยใช้จะตามทีมไปอัตโนมัติ)")}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={clearAll}
            disabled={totalCount === 0}
            title={t("ล้างข้อมูลฮีโร่ที่เคยใช้ทั้งหมด")}
            className="flex h-7 shrink-0 items-center gap-1 border border-red/40 bg-red/10 px-2 font-display text-[11px] font-semibold tracking-wide whitespace-nowrap text-red transition-colors hover:bg-red hover:text-ink disabled:pointer-events-none disabled:opacity-35 sm:h-8 sm:gap-1.5 sm:px-2.5"
          >
            <Trash2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            <span><StableButtonLabel message="ล้างทั้งหมด" /></span>
          </button>
          <button
            type="button"
            onClick={() => requestClose()}
            className="shrink-0 rounded p-1 text-dim transition-colors hover:bg-panel-2 hover:text-ink"
            aria-label={t("ปิด")}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Unified Scroll Body on Mobile (< sm) so controls never crush the 130-hero grid; Split Pane on sm+ */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto sm:overflow-hidden">
        {/* Team Name & Side Assignment Bar (Left = Current BLUE, Right = Current RED) */}
        <div className="flex shrink-0 flex-col gap-2 border-b border-line bg-panel-2/60 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-2.5 sm:px-4 sm:py-2.5">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1 sm:flex-none sm:gap-1.5">
              <span className="shrink-0 bg-blue px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink">
                BLUE<span className="hidden sm:inline"> {t("(ซ้าย)")}</span>
              </span>
              <input
                type="text"
                value={blueNameValue}
                placeholder="TEAM BLUE"
                onChange={(e) => handleTeamNameChange(blueTeamNameField, e.target.value)}
                onBlur={(e) => {
                  if (!e.target.value.trim()) {
                    const fallback = blueTeamNameField === "teamAName" ? "TEAM A" : "TEAM B";
                    onChange({ ...globalBans, [blueTeamNameField]: fallback });
                  }
                }}
                maxLength={14}
                aria-label={t("ชื่อทีมฝั่ง Blue")}
                className="h-7 min-w-0 flex-1 border border-line bg-bg px-1.5 font-display text-xs font-bold text-ink focus:border-blue focus:outline-none sm:w-28 sm:flex-none sm:px-2"
              />
            </div>

            <button
              type="button"
              onClick={swapTeamSides}
              title={t("สลับฝั่ง Blue ⇄ Red")}
              className="flex h-7 shrink-0 items-center gap-1 border border-gold/60 bg-gold/10 px-2 font-display text-[10px] font-bold whitespace-nowrap text-gold transition-colors hover:bg-gold hover:text-bg sm:gap-1.5 sm:px-2.5 sm:text-[11px]"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              <span className="hidden sm:inline"><StableButtonLabel message="สลับฝั่ง Blue ⇄ Red" /></span>
            </button>

            <div className="flex min-w-0 flex-1 items-center gap-1 sm:flex-none sm:gap-1.5">
              <span className="shrink-0 bg-red px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink">
                RED<span className="hidden sm:inline"> {t("(ขวา)")}</span>
              </span>
              <input
                type="text"
                value={redNameValue}
                placeholder="TEAM RED"
                onChange={(e) => handleTeamNameChange(redTeamNameField, e.target.value)}
                onBlur={(e) => {
                  if (!e.target.value.trim()) {
                    const fallback = redTeamNameField === "teamAName" ? "TEAM A" : "TEAM B";
                    onChange({ ...globalBans, [redTeamNameField]: fallback });
                  }
                }}
                maxLength={14}
                aria-label={t("ชื่อทีมฝั่ง Red")}
                className="h-7 min-w-0 flex-1 border border-line bg-bg px-1.5 font-display text-xs font-bold text-ink focus:border-red focus:outline-none sm:w-28 sm:flex-none sm:px-2"
              />
            </div>

            <div className="flex w-full items-center gap-1.5 sm:w-auto">
              <span className="shrink-0 font-mono text-[10px] font-bold text-muted">SERIES:</span>
              <input
                type="text"
                value={globalBans.seriesName ?? ""}
                placeholder={`${globalBans.teamAName} vs ${globalBans.teamBName}`}
                onChange={(e) => onChange({ ...globalBans, seriesName: e.target.value })}
                maxLength={24}
                title={t("ชื่อกลุ่มหรือชื่อซีรีส์ (เช่น BRU vs FS หรือปล่อยว่างเพื่อใช้ชื่อทีมอัตโนมัติ)")}
                aria-label={t("ชื่อกลุ่มซีรีส์")}
                className="h-7 min-w-0 flex-1 border border-line bg-bg px-2 font-display text-xs text-ink placeholder:text-dim focus:border-gold focus:outline-none sm:w-32 sm:flex-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-1 overflow-x-auto">
            <span className="mr-1 shrink-0 font-mono text-[10px] text-muted sm:text-[11px]">GAME:</span>
            {[1, 2, 3, 4, 5, 6, 7].map((g) => {
              const unlockStatus = getGameUnlockStatus(g, globalBans, seriesGames);
              const isUnlocked = unlockStatus.isUnlocked;
              const isCurrent = globalBans.gameNumber === g;

              let buttonTitle = `Game ${g}`;
              if (!isUnlocked) {
                const missingStr = unlockStatus.missingGames.map((mg) => `G${mg}`).join(", ");
                buttonTitle = t("Game {0} ล็อก: ต้องจบ {1} หรือใส่ Global Ban ฝั่งละอย่างน้อย {2} ตัว (Team A: {3}/{4}, Team B: {5}/{6})", g, missingStr, unlockStatus.requiredCount, unlockStatus.aCount, unlockStatus.requiredCount, unlockStatus.bCount, unlockStatus.requiredCount);
              } else if (g === 7) {
                buttonTitle = t("Game 7 Ultimate Battle (ปลดล็อก Global Ban ของทั้งสองทีม)");
              }

              return (
                <button
                  key={g}
                  type="button"
                  disabled={!isUnlocked}
                  onClick={() => {
                    if (!isUnlocked) return;
                    if (onSelectGameNumber) {
                      onSelectGameNumber(g);
                    } else {
                      onChange({ ...globalBans, gameNumber: g });
                    }
                  }}
                  className={`h-7 shrink-0 px-2 font-mono text-xs font-bold transition-colors ${
                    isCurrent
                      ? "border border-gold bg-gold text-bg"
                      : !isUnlocked
                        ? "cursor-not-allowed border border-line/40 bg-bg/40 text-dim/40"
                        : "border border-line bg-bg text-muted hover:border-line-strong hover:text-ink"
                  }`}
                  title={buttonTitle}
                >
                  G{g}
                </button>
              );
            })}
          </div>
        </div>

        {/* Category Tabs */}
        <div className="grid shrink-0 grid-cols-3 gap-1.5 border-b border-line bg-bg/60 px-3 py-1.5 sm:gap-2 sm:px-4 sm:py-2.5">
          {categories.map((cat) => {
            const isActive = activeCategory === cat.key;
            const count = globalBans[cat.key].length;
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => setActiveCategory(cat.key)}
                className={`flex min-w-0 items-center justify-between gap-1 border px-2 py-1 text-left transition-all sm:px-3 sm:py-2 ${
                  isActive ? cat.activeTabClass : "border-line bg-panel text-muted hover:border-line-strong hover:text-ink"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[9px] font-bold tracking-wider opacity-85 sm:text-[10px]">
                    <span className="sm:hidden">{cat.shortSide}</span>
                    <span className="hidden sm:inline">{cat.sideBadge}</span>
                  </div>
                  <div className="truncate font-display text-[11px] font-bold sm:text-xs">
                    <span className="sm:hidden">{cat.shortLabel}</span>
                    <span className="hidden sm:inline">{cat.label}</span>
                  </div>
                </div>
                <span
                  className={`ml-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center px-1 font-mono text-[10px] font-bold sm:ml-2 sm:h-6 sm:min-w-6 sm:px-1.5 sm:text-xs ${
                    count > 0 ? cat.badgeClass : "border border-line bg-bg text-dim"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Active Category Selected Heroes Bar */}
        <div className="shrink-0 border-b border-line bg-panel-2/40 px-3 py-1.5 sm:px-4 sm:py-2.5">
          {(() => {
            const unlockStatus = getGameUnlockStatus(globalBans.gameNumber, globalBans, seriesGames);
            if (globalBans.gameNumber <= 1 || unlockStatus.isUnlocked) return null;
            const targetGame = getMaxUnlockedGame(globalBans, seriesGames);
            return (
              <div className="mb-1.5 border border-gold/50 bg-gold/10 px-2.5 py-1 text-[11px] font-medium text-gold sm:mb-2">
                {t("จำนวนฮีโร่ไม่ถึงเกณฑ์ Game")} {globalBans.gameNumber} {t("(ต้องการฝั่งละ")} {unlockStatus.requiredCount} {t("ตัว) — เมื่อปิดหน้าต่างจะบันทึกกระดานปัจจุบันและย้อนกลับไป Game")} {targetGame}
              </div>
            );
          })()}
          {limitNotice && (
            <div className="mb-1.5 border border-red/50 bg-red/10 px-2.5 py-1 text-[11px] font-medium text-red sm:mb-2">
              {limitNotice}
            </div>
          )}
          <div className="mb-1 flex items-center justify-between gap-2 sm:mb-1.5">
            <span className="truncate text-[11px] text-muted sm:hidden">
              {currentCat.label} ({activeList.length})
            </span>
            <span className="hidden text-[11px] text-muted sm:inline">{currentCat.desc}</span>
            {activeList.length > 0 && (
              <button
                type="button"
                onClick={() => clearCategory(activeCategory)}
                className="shrink-0 font-display text-[11px] font-semibold text-dim underline underline-offset-2 hover:text-ink"
              >
                <StableButtonLabel message="ล้างหมวดนี้ (" />{activeList.length})
              </button>
            )}
          </div>

          {activeList.length === 0 ? (
            <div className="flex h-7 items-center truncate border border-dashed border-line px-2.5 text-[11px] text-dim sm:h-10 sm:px-3 sm:text-xs">
              {t("ยังไม่มีตัวในหมวดนี้ — แตะเลือกฮีโร่ด้านล่าง")}
            </div>
          ) : (
            <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto py-0.5 sm:max-h-24 sm:gap-1.5">
              {activeList.map((name) => {
                const hero = heroMap.get(name);
                const originGame =
                  activeCategory === "teamAUsed"
                    ? originMap.teamAGameByHero[name]
                    : activeCategory === "teamBUsed"
                      ? originMap.teamBGameByHero[name]
                      : undefined;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleHero(name)}
                    title={t("คลิกเพื่อลบ {0}{1}", displayName(name), originGame ? t(" (เลือกใช้ใน Game {0})", originGame) : t(" (เพิ่มด้วยตัวเอง)"))}
                    className="group flex items-center gap-1 border border-line-strong bg-bg py-0.5 pr-1.5 pl-0.5 text-[11px] text-ink transition-colors hover:border-red/60 hover:bg-red/10 sm:gap-1.5 sm:pr-2 sm:pl-1 sm:text-xs"
                  >
                    <div className="h-5 w-5 shrink-0 overflow-hidden sm:h-6 sm:w-6">
                      <HeroPortrait name={name} hero={hero} />
                    </div>
                    <span className="font-medium">{displayName(name)}</span>
                    {originGame !== undefined && (
                      <span className="bg-panel-2 px-1 font-mono text-[9px] font-bold text-gold">G{originGame}</span>
                    )}
                    <X className="h-3 w-3 text-dim group-hover:text-red" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Search & Role Filters */}
        <div className="flex shrink-0 flex-col gap-1.5 border-b border-line px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:px-4 sm:py-2.5">
          <div className="relative flex flex-1 items-center">
            <Search size={15} className="pointer-events-none absolute left-3 text-dim" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t("ค้นหาฮีโร่ในหน้าต่าง Global Ban")}
              placeholder={t("ค้นหาฮีโร่ (เช่น Florentino, มอร์ตอส, ริคเตอร์...)")}
              className="h-8 w-full border border-line bg-bg pr-8 pl-9 text-xs text-ink placeholder:text-dim focus:border-gold/60 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
                className="absolute right-1 grid size-6 place-items-center text-dim hover:text-ink"
                aria-label={t("ล้างคำค้นหา")}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex flex-nowrap items-center gap-1 overflow-x-auto pb-0.5 sm:flex-wrap sm:overflow-visible sm:pb-0">
            <button
              type="button"
              onClick={() => setRole(null)}
              className={`h-7 shrink-0 border px-2 font-display text-[11px] font-semibold tracking-wide transition-colors ${
                role === null
                  ? "border-gold/60 bg-gold/10 text-gold"
                  : "border-line text-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              ALL
            </button>
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(role === r ? null : r)}
                className={`h-7 shrink-0 border px-2 font-display text-[11px] font-semibold tracking-wide transition-colors ${
                  role === r
                    ? "border-gold/60 bg-gold/10 text-gold"
                    : "border-line text-muted hover:border-line-strong hover:text-ink"
                }`}
              >
                <StableButtonLabel message={ROLE_LABELS[r]} />
              </button>
            ))}
          </div>
        </div>

        {/* Hero Selection Grid */}
        <div className="min-h-[240px] p-2.5 sm:min-h-0 sm:flex-1 sm:overflow-y-auto sm:p-3">
          {filtered.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center text-center text-dim">
              <p className="text-sm">{t("ไม่พบฮีโร่ที่ตรงกับคำค้นหา")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-1 sm:grid-cols-7 sm:gap-1.5 md:grid-cols-9 lg:grid-cols-10">
              {filtered.map((h) => {
                const isSelected = activeSet.has(h.name);
                const isOnActiveBoard = !isSelected && Boolean(activeBoardHeroes?.has(h.name));
                const inA = teamASet.has(h.name);
                const inB = teamBSet.has(h.name);
                const inUniv = univSet.has(h.name);
                const dName = displayName(h.name);

                return (
                  <button
                    key={h.name}
                    type="button"
                    disabled={isOnActiveBoard}
                    onClick={() => toggleHero(h.name)}
                    title={isOnActiveBoard ? t("{0} ถูกเลือก/แบนอยู่บนกระดานปัจจุบัน", dName) : dName}
                    className={`group relative flex flex-col items-center border p-0.5 transition-all sm:p-1 ${
                      isSelected
                        ? currentCat.ringClass
                        : isOnActiveBoard
                          ? "cursor-not-allowed border-line/40 bg-bg/20 opacity-40"
                          : "border-line/70 bg-bg/40 hover:border-line-strong hover:bg-panel-2"
                    }`}
                  >
                    <div className="relative aspect-square w-full overflow-hidden">
                      <HeroPortrait
                        name={h.name}
                        hero={h}
                        className={`transition-transform group-hover:scale-105 ${isSelected ? "opacity-90" : ""}`}
                      />
                      {/* Status Badges */}
                      <div className="absolute top-0.5 left-0.5 flex flex-wrap gap-0.5">
                        {inA && (
                          <span
                            className={`px-1 font-mono text-[8px] font-bold leading-tight text-ink ${
                              teamAIsBlue ? "bg-blue" : "bg-red"
                            }`}
                          >
                            {globalBans.teamAName.slice(0, 4)}
                          </span>
                        )}
                        {inB && (
                          <span
                            className={`px-1 font-mono text-[8px] font-bold leading-tight text-ink ${
                              !teamAIsBlue ? "bg-blue" : "bg-red"
                            }`}
                          >
                            {globalBans.teamBName.slice(0, 4)}
                          </span>
                        )}
                        {inUniv && (
                          <span className="bg-gold px-1 font-mono text-[8px] font-bold leading-tight text-bg">BAN</span>
                        )}
                      </div>
                      {isSelected && (
                        <div className="absolute right-0.5 bottom-0.5 flex h-4 w-4 items-center justify-center bg-bg/90 text-gold">
                          <Check className="h-3 w-3" />
                        </div>
                      )}
                    </div>
                    <span
                      className={`mt-0.5 w-full truncate text-center text-[9px] leading-tight sm:mt-1 sm:text-[10px] ${
                        isSelected ? "font-bold text-ink" : "text-muted group-hover:text-ink"
                      }`}
                      title={dName}
                    >
                      {dName}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line bg-bg px-3 py-2 sm:px-4 sm:py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-muted sm:gap-3 sm:text-xs">
          <span>
            {globalBans.teamAName}
            <span className="hidden sm:inline"> ({teamAIsBlue ? "Blue" : "Red"})</span>:{" "}
            <strong className={teamAIsBlue ? "text-blue" : "text-red"}>{globalBans.teamAUsed.length}</strong>
          </span>
          <span>·</span>
          <span>
            {globalBans.teamBName}
            <span className="hidden sm:inline"> ({!teamAIsBlue ? "Blue" : "Red"})</span>:{" "}
            <strong className={!teamAIsBlue ? "text-blue" : "text-red"}>{globalBans.teamBUsed.length}</strong>
          </span>
          <span>·</span>
          <span>
            {t("ร่วม:")} <strong className="text-gold">{globalBans.universalBans.length}</strong>
          </span>
        </div>
        <button
          type="button"
          onClick={() => requestClose()}
          className="shrink-0 border border-gold bg-gold px-3 py-1.5 font-display text-xs font-bold tracking-wider whitespace-nowrap text-bg transition-colors hover:bg-gold/90 sm:px-4"
        >
          <StableButtonLabel message="เสร็จสิ้น" />
        </button>
      </div>
        </>
      )}
    </Modal>
  );
}

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
  initialCategory?: GlobalBanCategoryKey;
  onChange: (next: GlobalBanState) => void;
  onSelectGameNumber?: (g: number) => void;
  onClose: () => void;
}

const ROLE_LABELS: Record<RoleType, string> = {
  Warrior: "ไฟต์เตอร์",
  Assassin: "แอสซาซิน",
  Mage: "เมจ",
  Marksman: "แครี่",
  Tank: "แทงค์",
  Support: "ซัพพอร์ต",
};

export function GlobalBanModal({
  heroes,
  heroMap,
  globalBans,
  seriesGames = [],
  initialCategory = "teamAUsed",
  onChange,
  onSelectGameNumber,
  onClose,
}: GlobalBanModalProps) {
  const [activeCategory, setActiveCategory] = useState<GlobalBanCategoryKey>(initialCategory);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<RoleType | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

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
    label: `${globalBans.teamAName} เคยใช้`,
    sideBadge: teamAIsBlue ? "อยู่ฝั่ง BLUE (ซ้าย)" : "อยู่ฝั่ง RED (ขวา)",
    desc: `ฮีโร่ที่ทีม ${globalBans.teamAName} หยิบใช้ไปแล้วในซีรีส์นี้ (จะตามทีม ${globalBans.teamAName} ไปอัตโนมัติไม่ว่าจะสลับไปอยู่ฝั่งฟ้าหรือแดง)`,
    activeTabClass: teamAIsBlue ? "border-blue bg-blue/15 text-blue" : "border-red bg-red/15 text-red",
    ringClass: teamAIsBlue
      ? "border-blue bg-blue/15 ring-2 ring-blue/60"
      : "border-red bg-red/15 ring-2 ring-red/60",
    badgeClass: teamAIsBlue ? "bg-blue text-ink" : "bg-red text-ink",
  };

  const teamBCat = {
    key: "teamBUsed" as GlobalBanCategoryKey,
    label: `${globalBans.teamBName} เคยใช้`,
    sideBadge: !teamAIsBlue ? "อยู่ฝั่ง BLUE (ซ้าย)" : "อยู่ฝั่ง RED (ขวา)",
    desc: `ฮีโร่ที่ทีม ${globalBans.teamBName} หยิบใช้ไปแล้วในซีรีส์นี้ (จะตามทีม ${globalBans.teamBName} ไปอัตโนมัติไม่ว่าจะสลับไปอยู่ฝั่งฟ้าหรือแดง)`,
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
      label: "แบนร่วมทั้งซีรีส์",
      sideBadge: "GLOBAL BAN",
      desc: "ฮีโร่ที่ถูกแบนร่วมทั้งสองทีมตลอดซีรีส์ หรือแบนจากกติกาพิเศษ — ทั้งสองทีมจะไม่สามารถเลือกใช้ได้",
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
    const clearedState: GlobalBanState = {
      ...EMPTY_GLOBAL_BANS,
      seriesName: globalBans.seriesName,
      teamAName: globalBans.teamAName,
      teamBName: globalBans.teamBName,
      blueSideTeam: globalBans.blueSideTeam,
      gameNumber: 1,
    };
    const maxUnlocked = getMaxUnlockedGame(clearedState, seriesGames);
    const nextGame = Math.min(globalBans.gameNumber, maxUnlocked);
    onChange({
      ...clearedState,
      gameNumber: nextGame,
    });
  };

  const handleClose = () => {
    const currentStatus = getGameUnlockStatus(globalBans.gameNumber, globalBans, seriesGames);
    if (!currentStatus.isUnlocked) {
      const maxUnlocked = getMaxUnlockedGame(globalBans, seriesGames);
      onChange({ ...globalBans, gameNumber: maxUnlocked });
    }
    onClose();
  };

  return (
    <Modal labelledBy={titleId} className="max-h-[92vh] max-w-4xl" initialFocusRef={searchInputRef} onClose={handleClose}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Layers className="h-4 w-4 text-gold" />
          <div>
            <h2 id={titleId} className="font-display text-sm font-bold tracking-wider text-ink">
              GLOBAL BAN PICK · จัดการฮีโร่ที่แต่ละทีมเคยใช้ในซีรีส์
            </h2>
            <p className="text-[11px] text-dim">
              ผูกประวัติตัวที่ใช้แล้วกับชื่อทีม (สลับฝั่งฟ้า/แดงได้อิสระโดยตัวที่เคยใช้จะตามทีมไปอัตโนมัติ)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={clearAll}
            disabled={totalCount === 0}
            title="ล้างข้อมูลฮีโร่ที่เคยใช้ทั้งหมด"
            className="flex h-8 items-center gap-1.5 border border-red/40 bg-red/10 px-2.5 font-display text-[11px] font-semibold tracking-wide text-red transition-colors hover:bg-red hover:text-ink disabled:pointer-events-none disabled:opacity-35"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>ล้างทั้งหมด</span>
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="rounded p-1 text-dim transition-colors hover:bg-panel-2 hover:text-ink"
            aria-label="ปิด"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Team Name & Side Assignment Bar (Left = Current BLUE, Right = Current RED) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel-2/60 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="bg-blue px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink">
              BLUE (ซ้าย)
            </span>
            <input
              type="text"
              value={blueNameValue}
              placeholder="TEAM BLUE"
              onChange={(e) =>
                onChange({ ...globalBans, [blueTeamNameField]: e.target.value })
              }
              onBlur={(e) => {
                if (!e.target.value.trim()) {
                  onChange({ ...globalBans, [blueTeamNameField]: "TEAM BLUE" });
                }
              }}
              maxLength={14}
              aria-label="ชื่อทีมฝั่ง Blue"
              className="h-7 w-28 border border-line bg-bg px-2 font-display text-xs font-bold text-ink focus:border-blue focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={swapTeamSides}
            className="flex h-7 items-center gap-1.5 border border-gold/60 bg-gold/10 px-2.5 font-display text-[11px] font-bold text-gold transition-colors hover:bg-gold hover:text-bg"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            <span>สลับฝั่ง Blue ⇄ Red</span>
          </button>

          <div className="flex items-center gap-1.5">
            <span className="bg-red px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink">
              RED (ขวา)
            </span>
            <input
              type="text"
              value={redNameValue}
              placeholder="TEAM RED"
              onChange={(e) =>
                onChange({ ...globalBans, [redTeamNameField]: e.target.value })
              }
              onBlur={(e) => {
                if (!e.target.value.trim()) {
                  onChange({ ...globalBans, [redTeamNameField]: "TEAM RED" });
                }
              }}
              maxLength={14}
              aria-label="ชื่อทีมฝั่ง Red"
              className="h-7 w-28 border border-line bg-bg px-2 font-display text-xs font-bold text-ink focus:border-red focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] font-bold text-muted">SERIES:</span>
            <input
              type="text"
              value={globalBans.seriesName ?? ""}
              placeholder={`${globalBans.teamAName} vs ${globalBans.teamBName}`}
              onChange={(e) => onChange({ ...globalBans, seriesName: e.target.value })}
              maxLength={24}
              title="ชื่อกลุ่มหรือชื่อซีรีส์ (เช่น BRU vs FS หรือปล่อยว่างเพื่อใช้ชื่อทีมอัตโนมัติ)"
              aria-label="ชื่อกลุ่มซีรีส์"
              className="h-7 w-32 border border-line bg-bg px-2 font-display text-xs text-ink placeholder:text-dim focus:border-gold focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-1">
          <span className="mr-1 font-mono text-[11px] text-muted">GAME:</span>
          {[1, 2, 3, 4, 5, 6, 7].map((g) => {
            const unlockStatus = getGameUnlockStatus(g, globalBans, seriesGames);
            const isUnlocked = unlockStatus.isUnlocked;
            const isCurrent = globalBans.gameNumber === g;

            let buttonTitle = `Game ${g}`;
            if (g === 7) {
              buttonTitle = "Game 7 Ultimate Battle (ปลดล็อก Global Ban ของทั้งสองทีม)";
            } else if (!isUnlocked) {
              const missingStr = unlockStatus.missingGames.map((mg) => `G${mg}`).join(", ");
              buttonTitle = `Game ${g} ล็อก: ต้องจบ ${missingStr} หรือใส่ Global Ban ฝั่งละอย่างน้อย ${unlockStatus.requiredCount} ตัว (Team A: ${unlockStatus.aCount}/${unlockStatus.requiredCount}, Team B: ${unlockStatus.bCount}/${unlockStatus.requiredCount})`;
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
                className={`h-7 px-2 font-mono text-xs font-bold transition-colors ${
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
      <div className="grid grid-cols-3 gap-1.5 border-b border-line bg-bg/60 px-3 py-2 sm:gap-2 sm:px-4 sm:py-2.5">
        {categories.map((cat) => {
          const isActive = activeCategory === cat.key;
          const count = globalBans[cat.key].length;
          return (
            <button
              key={cat.key}
              type="button"
              onClick={() => setActiveCategory(cat.key)}
              className={`flex min-w-0 items-center justify-between gap-1 border px-2 py-1.5 text-left transition-all sm:px-3 sm:py-2 ${
                isActive ? cat.activeTabClass : "border-line bg-panel text-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[9px] font-bold tracking-wider opacity-85 sm:text-[10px]">
                  {cat.sideBadge}
                </div>
                <div className="truncate font-display text-[11px] font-bold sm:text-xs">{cat.label}</div>
              </div>
              <span
                className={`ml-1 flex h-5 min-w-5 shrink-0 items-center justify-center px-1 font-mono text-[11px] font-bold sm:ml-2 sm:h-6 sm:min-w-6 sm:px-1.5 sm:text-xs ${
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
      <div className="border-b border-line bg-panel-2/40 px-4 py-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted">{currentCat.desc}</span>
          {activeList.length > 0 && (
            <button
              type="button"
              onClick={() => clearCategory(activeCategory)}
              className="shrink-0 font-display text-[11px] font-semibold text-dim underline underline-offset-2 hover:text-ink"
            >
              ล้างหมวดนี้ ({activeList.length})
            </button>
          )}
        </div>

        {activeList.length === 0 ? (
          <div className="flex h-10 items-center border border-dashed border-line px-3 text-xs text-dim">
            ยังไม่มีฮีโร่ในหมวด {currentCat.label} — คลิกเลือกฮีโร่จากตารางด้านล่าง
          </div>
        ) : (
          <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto py-0.5">
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
                  title={`คลิกเพื่อลบ ${displayName(name)}${originGame ? ` (เลือกใช้ใน Game ${originGame})` : " (เพิ่มด้วยตัวเอง)"}`}
                  className="group flex items-center gap-1.5 border border-line-strong bg-bg py-0.5 pr-2 pl-1 text-xs text-ink transition-colors hover:border-red/60 hover:bg-red/10"
                >
                  <div className="h-6 w-6 shrink-0 overflow-hidden">
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
      <div className="flex flex-col gap-2 border-b border-line px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex flex-1 items-center">
          <Search size={15} className="pointer-events-none absolute left-3 text-dim" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาฮีโร่ (เช่น Florentino, มอร์ตอส, ริคเตอร์...)"
            className="h-8 w-full border border-line bg-bg pr-8 pl-9 text-xs text-ink placeholder:text-dim focus:border-gold/60 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2.5 text-dim hover:text-ink"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setRole(null)}
            className={`h-7 border px-2 font-display text-[11px] font-semibold tracking-wide transition-colors ${
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
              className={`h-7 border px-2 font-display text-[11px] font-semibold tracking-wide transition-colors ${
                role === r
                  ? "border-gold/60 bg-gold/10 text-gold"
                  : "border-line text-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              {ROLE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {/* Hero Selection Grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {filtered.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center text-center text-dim">
            <p className="text-sm">ไม่พบฮีโร่ที่ตรงกับคำค้นหา</p>
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-7 md:grid-cols-9 lg:grid-cols-10">
            {filtered.map((h) => {
              const isSelected = activeSet.has(h.name);
              const inA = teamASet.has(h.name);
              const inB = teamBSet.has(h.name);
              const inUniv = univSet.has(h.name);
              const dName = displayName(h.name);

              return (
                <button
                  key={h.name}
                  type="button"
                  onClick={() => toggleHero(h.name)}
                  className={`group relative flex flex-col items-center border p-1 transition-all ${
                    isSelected
                      ? currentCat.ringClass
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
                    className={`mt-1 w-full truncate text-center text-[10px] leading-tight ${
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

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-line bg-bg px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-muted">
          <span>
            {globalBans.teamAName} ({teamAIsBlue ? "Blue" : "Red"}):{" "}
            <strong className={teamAIsBlue ? "text-blue" : "text-red"}>{globalBans.teamAUsed.length}</strong>
          </span>
          <span>·</span>
          <span>
            {globalBans.teamBName} ({!teamAIsBlue ? "Blue" : "Red"}):{" "}
            <strong className={!teamAIsBlue ? "text-blue" : "text-red"}>{globalBans.teamBUsed.length}</strong>
          </span>
          <span>·</span>
          <span>
            แบนร่วม: <strong className="text-gold">{globalBans.universalBans.length}</strong>
          </span>
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="border border-gold bg-gold px-4 py-1.5 font-display text-xs font-bold tracking-wider text-bg transition-colors hover:bg-gold/90"
        >
          เสร็จสิ้น
        </button>
      </div>
    </Modal>
  );
}

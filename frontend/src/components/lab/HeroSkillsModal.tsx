import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Droplet,
  ExternalLink,
  Heart,
  ImageIcon,
  LayoutGrid,
  Shield,
  Sparkles,
  Swords,
  Target,
  Wind,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { getJson } from "../../api/client";
import { resolveScalingValue, type BuildStats, type CatalogHeroSkill, type ScalingValue, type SkillDamageRow } from "../../types/combat";
import type { Hero } from "../../types/draft";
import { displayName } from "../../utils/heroNames";
import { getFormBadge } from "../../utils/heroForms";
import {
  getInGameSkillRows,
  getInGameTagCapsules,
  getSlotCircledNumber,
  parseSkillEffects,
  tokenizeThaiSkillDescription,
} from "../../utils/skillEffects";
import { HeroPortrait } from "../HeroPortrait";
import { Modal } from "../Modal";

interface HeroSkillsModalProps {
  hero: string;
  skills: CatalogHeroSkill[];
  heroObj?: { name: string; role: string | null; ranged: boolean };
  heroDraft?: Hero;
  buildStats?: BuildStats;
  skillRows?: SkillDamageRow[];
  enemyName?: string;
  onClose: () => void;
}

interface HeroScreenshotsResponse {
  hero: string;
  folder: string;
  skill_screenshots: string[];
  status_screenshots: string[];
}

interface ScreenshotItem {
  url: string;
  label: string;
  type: "skill" | "status";
  slotKey?: string;
}

type ViewMode = "ingame" | "screenshot" | "live_calc";

const TYPE_CONFIG: Record<
  CatalogHeroSkill["damage_type"],
  { labelTh: string; color: string; border: string; bg: string }
> = {
  physical: {
    labelTh: "กายภาพ",
    color: "text-[#ff9f43]",
    border: "border-[#ff9f43]/40",
    bg: "bg-[#ff9f43]/10",
  },
  magic: {
    labelTh: "เวท",
    color: "text-[#b07cff]",
    border: "border-[#b07cff]/40",
    bg: "bg-[#b07cff]/10",
  },
  true: {
    labelTh: "ความเสียหายจริง",
    color: "text-ink",
    border: "border-ink/40",
    bg: "bg-ink/10",
  },
  none: {
    labelTh: "สถานะ / บัฟ",
    color: "text-dim",
    border: "border-line",
    bg: "bg-panel-2",
  },
};

const SLOT_ORDER = [
  "Passive",
  "Skill 1",
  "Skill 2",
  "Skill 3",
  "Skill 4",
  "Skill 5",
  "Ultimate",
  "Passive 2",
  "Passive (Berserker Mode)",
  "Skill 1 (Berserker Mode)",
  "Skill 2 (Berserker Mode)",
  "Ultimate (Berserker Mode)",
  "Skill 4 (Berserker Mode)",
];

function slotLabelTh(slot: string): string {
  if (slot === "Passive") return "สกิลติดตัว";
  if (slot === "Passive 2" || slot === "Passive (Berserker Mode)") return "สกิลติดตัว 2";
  if (slot === "Ultimate" || slot === "Ultimate (Berserker Mode)") return "อัลติเมท";
  return slot.replace(" (Berserker Mode)", "").replace("Skill ", "สกิล ");
}

const NON_DAMAGE_OWN_HP_SKILLS = new Set([
  "Charlotte|Skill 2",
  "Edras|Skill 2",
  "Edras|Skill 2 (Berserker Mode)",
  "Ming|Passive",
  "Omega|Skill 1",
  "Roxie|Skill 2",
  "Tachi|Passive",
  "Volkath|Passive",
]);

function formatScaling(scaling?: Record<string, ScalingValue>, skillLevel = 1): string[] {
  if (!scaling) return [];
  const v = (key: string) => resolveScalingValue(scaling[key], skillLevel);
  const list: string[] = [];
  if (v("ad_pct")) list.push(`+${v("ad_pct")}% AD`);
  if (v("bonus_ad_pct")) list.push(`+${v("bonus_ad_pct")}% Bonus AD`);
  if (v("as_to_ad")) list.push(`+${v("as_to_ad")} AD/1% Bonus AS`);
  if (v("ap_pct")) list.push(`+${v("ap_pct")}% AP`);
  if (v("bonus_ap_pct")) list.push(`+${v("bonus_ap_pct")}% Bonus AP`);
  if (v("bonus_dmg_hp_pct")) list.push(`+${v("bonus_dmg_hp_pct")}% Max HP ตัวเอง`);
  else if (v("own_hp_pct")) list.push(`+${v("own_hp_pct")}% HP ตัวเอง`);
  else if (v("hp_pct")) list.push(`+${v("hp_pct")}% HP`);
  else if (v("max_hp_pct")) list.push(`+${v("max_hp_pct")}% Max HP`);
  if (v("bonus_hp_pct") || v("bonus_max_hp_pct")) {
    list.push(`+${v("bonus_hp_pct") + v("bonus_max_hp_pct")}% Bonus HP`);
  }
  if (v("burn_max_hp_pct")) list.push(`เผา +${v("burn_max_hp_pct")}% Max HP/วิ`);
  if (v("bonus_armor_pct")) list.push(`+${v("bonus_armor_pct")}% Bonus Armor`);
  if (v("armor_pct")) list.push(`+${v("armor_pct")}% เกราะ`);
  if (v("magic_defense_pct")) list.push(`+${v("magic_defense_pct")}% ต้านเวท`);
  const tgtHp = v("target_hp_pct") + v("target_max_hp_pct") + v("target_current_hp_pct");
  if (tgtHp) list.push(`+${tgtHp}% HP ศัตรู`);
  if (v("target_hp_ap_pct")) list.push(`+${v("target_hp_ap_pct")}% HP ศัตรู/100 AP`);
  const lostHp = v("target_lost_hp_pct") + v("lost_hp_pct");
  if (lostHp) list.push(`+${lostHp}% HP ที่หายไปศัตรู`);
  if (v("lost_hp_ap_pct")) list.push(`+${v("lost_hp_ap_pct")}% HP ที่หายไปศัตรู/100 AP`);
  if (v("lost_hp_bonus_ad_pct")) list.push(`+${v("lost_hp_bonus_ad_pct")}% HP ที่หายไปศัตรู/100 Bonus AD`);
  if (v("target_hp_per_100_ad_pct")) list.push(`+${v("target_hp_per_100_ad_pct")}% HP ศัตรู/100 AD`);
  if (v("target_hp_per_100_bonus_ad_pct")) {
    list.push(`+${v("target_hp_per_100_bonus_ad_pct")}% HP ศัตรู/100 Bonus AD`);
  }
  if (v("target_hp_per_100_ap_pct")) list.push(`+${v("target_hp_per_100_ap_pct")}% HP ศัตรู/100 AP`);
  if (v("level_scaling")) list.push(`+${v("level_scaling")}/Lv`);
  return list;
}

export function HeroSkillsModal({
  hero,
  skills,
  heroObj,
  heroDraft,
  buildStats,
  skillRows,
  enemyName,
  onClose,
}: HeroSkillsModalProps) {
  const dName = displayName(hero);
  const [prevHero, setPrevHero] = useState<string>(hero);
  const [selectedSlot, setSelectedSlot] = useState<string>(skills[0]?.slot ?? "Passive");
  const [viewMode, setViewMode] = useState<ViewMode>("ingame");
  const [screenshotsData, setScreenshotsData] = useState<HeroScreenshotsResponse | null>(null);
  const [selectedScreenshotIdx, setSelectedScreenshotIdx] = useState<number>(0);
  const [failedIcons, setFailedIcons] = useState<Record<string, boolean>>({});

  if (prevHero !== hero) {
    setPrevHero(hero);
    setSelectedSlot(skills[0]?.slot ?? "Passive");
    setSelectedScreenshotIdx(0);
  }

  const titleId = useId();

  // Load screenshots from API
  useEffect(() => {
    let cancelled = false;
    getJson<HeroScreenshotsResponse>(`/combat/hero-screenshots/${encodeURIComponent(hero)}`)
      .then((data) => {
        if (!cancelled) setScreenshotsData(data);
      })
      .catch(() => {
        if (!cancelled) setScreenshotsData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [hero]);

  const sortedSkills = useMemo(() => {
    if (skills.length > 4) return skills;
    return [...skills].sort((a, b) => {
      const ia = SLOT_ORDER.indexOf(a.slot);
      const ib = SLOT_ORDER.indexOf(b.slot);
      if (ia !== -1 && ib !== -1) return ia - ib;
      return a.slot.localeCompare(b.slot);
    });
  }, [skills]);

  const activeSkill = sortedSkills.find((s) => s.slot === selectedSlot) ?? sortedSkills[0];
  const activeRow = skillRows?.find((r) => r.slot === activeSkill?.slot || r.name === activeSkill?.name);

  const skillProfile = useMemo(() => {
    if (!activeSkill) return null;
    return parseSkillEffects(activeSkill, hero, buildStats?.level, activeRow?.skill_level);
  }, [activeSkill, hero, buildStats?.level, activeRow?.skill_level]);

  // Unified list of screenshot items
  const allScreenshots = useMemo<ScreenshotItem[]>(() => {
    if (!screenshotsData) return [];
    const list: ScreenshotItem[] = [];
    const skillImgs = screenshotsData.skill_screenshots || [];
    skillImgs.forEach((url, i) => {
      const fileName = (url.split("/").pop() || url).toLowerCase();
      let label = `สกิล ${i}`;
      let slotKey = `Skill ${i}`;

      if (fileName.startsWith("passive") || fileName.includes("_passive")) {
        label = "สกิลติดตัว (P)";
        slotKey = "Passive";
      } else if (fileName.startsWith("skill1") || fileName.includes("_skill1")) {
        label = "สกิล 1";
        slotKey = "Skill 1";
      } else if (fileName.startsWith("skill2") || fileName.includes("_skill2")) {
        label = "สกิล 2";
        slotKey = "Skill 2";
      } else if (fileName.startsWith("ultimate") || fileName.includes("_ultimate") || fileName.startsWith("skill3")) {
        label = "อัลติเมท (Ult)";
        slotKey = "Ultimate";
      } else if (fileName.startsWith("skill4") || fileName.includes("_skill4")) {
        label = "สกิล 4";
        slotKey = "Skill 4";
      } else {
        if (i === 0) {
          label = "สกิลติดตัว (P)";
          slotKey = "Passive";
        } else if (i === 1) {
          label = "สกิล 1";
          slotKey = "Skill 1";
        } else if (i === 2) {
          label = "สกิล 2";
          slotKey = "Skill 2";
        } else if (i === 3) {
          label = "อัลติเมท (Ult)";
          slotKey = "Ultimate";
        }
      }

      if (fileName.includes("_awakened")) {
        label += " (ตื่นรู้)";
        slotKey = `${slotKey} (Berserker Mode)`;
      } else if (fileName.includes("_normal")) {
        label += " (ปกติ)";
      } else if (fileName.includes("_form2")) {
        label += " (รวมดาบ)";
        if (slotKey === "Passive") slotKey = "Passive 2";
        else if (slotKey === "Skill 1") slotKey = "Skill 3";
        else if (slotKey === "Skill 2") slotKey = "Skill 4";
        else if (slotKey === "Ultimate") slotKey = "Skill 5";
      } else if (fileName.includes("_form1")) {
        label += " (ดาบคู่)";
      } else if (fileName.includes("_fox")) {
        label += " (ร่างจิ้งจอก)";
        if (slotKey === "Skill 1") slotKey = "Skill 4";
        else if (slotKey === "Skill 2") slotKey = "Skill 5";
      } else if (fileName.includes("_human")) {
        label += " (ร่างมนุษย์)";
        if (slotKey === "Ultimate") slotKey = "Skill 3";
      } else if (fileName.includes("_cannon")) {
        label += " (ปืนใหญ่)";
      } else if (fileName.includes("_rapid")) {
        label += " (ปืนกล)";
      }

      if (fileName.includes("_v2")) {
        label += " (หน้า 2)";
      }

      list.push({ url, label, type: "skill", slotKey });
    });

    const statusImgs = screenshotsData.status_screenshots || [];
    statusImgs.forEach((url) => {
      const fileName = (url.split("/").pop() || url).toLowerCase();
      const isLv15 = fileName.includes("lv15");
      let statusLabel = isLv15 ? "สเตตัส Lv 15" : "สเตตัส Lv 1";
      if (fileName.includes("_alt")) {
        statusLabel += " (ในเกม)";
      }
      list.push({
        url,
        label: statusLabel,
        type: "status",
      });
    });

    return list;
  }, [screenshotsData]);

  const findScreenshotIdxForSlot = (slot: string) =>
    allScreenshots.findIndex(
      (s) => s.slotKey === slot || (slot.startsWith("Passive") && s.slotKey === "Passive")
    );

  const selectScreenshotAt = (idx: number) => {
    const clamped = Math.max(0, Math.min(allScreenshots.length - 1, idx));
    setSelectedScreenshotIdx(clamped);
    const targetSlot = allScreenshots[clamped]?.slotKey;
    if (targetSlot && sortedSkills.some((sk) => sk.slot === targetSlot)) {
      setSelectedSlot(targetSlot);
    }
  };

  // Synchronize screenshot selection when switching slot or jumping to screenshot view
  const jumpToSkillScreenshot = (slot: string) => {
    const idx = findScreenshotIdxForSlot(slot);
    if (idx !== -1) {
      setSelectedScreenshotIdx(idx);
    }
    setViewMode("screenshot");
  };

  // Compute live bonus scaling from active hero buildStats for a given skill level
  const calcBonusScaling = useCallback(
    (skillLv: number) => {
      if (!buildStats || !activeSkill?.scaling) return 0;
      const st = buildStats.stats;
      const baseLv = buildStats.sources.level;
      const sc = activeSkill.scaling;
      const skLv = Math.max(1, skillLv);
      const v = (key: string) => resolveScalingValue(sc[key], skLv);
      let b = 0;
      if (v("ad_pct")) b += (st.attack_damage * v("ad_pct")) / 100;
      if (v("bonus_ad_pct")) {
        const bonusAd = Math.max(0, st.attack_damage - (st.base_attack_damage ?? 0));
        b += (bonusAd * v("bonus_ad_pct")) / 100;
      }
      if (v("as_to_ad")) {
        const bonusAs = Math.max(0, st.attack_speed - (baseLv.attack_speed ?? 0));
        b += v("as_to_ad") * bonusAs;
      }
      if (v("ap_pct")) b += (st.ability_power * v("ap_pct")) / 100;
      if (v("bonus_ap_pct")) b += (st.ability_power * v("bonus_ap_pct")) / 100;
      if (!NON_DAMAGE_OWN_HP_SKILLS.has(`${hero}|${activeSkill.slot}`)) {
        const ownHpPct = v("bonus_dmg_hp_pct") || v("own_hp_pct") || v("hp_pct") || v("max_hp_pct");
        if (ownHpPct) b += (st.max_hp * ownHpPct) / 100;
        const bonusHpPct = v("bonus_hp_pct") + v("bonus_max_hp_pct");
        if (bonusHpPct) {
          const bonusHp = Math.max(0, st.max_hp - (baseLv.max_hp ?? 0));
          b += (bonusHp * bonusHpPct) / 100;
        }
      }
      if (v("bonus_armor_pct")) {
        const bonusArmor = Math.max(0, st.armor - (baseLv.armor ?? 0));
        b += (bonusArmor * v("bonus_armor_pct")) / 100;
      }
      if (v("armor_pct")) b += (st.armor * v("armor_pct")) / 100;
      if (v("magic_defense_pct")) b += (st.magic_defense * v("magic_defense_pct")) / 100;
      if (v("level_scaling")) b += v("level_scaling") * Math.max(0, buildStats.level - 1);
      return Math.round(b);
    },
    [buildStats, activeSkill, hero],
  );
  const bonusScalingVal = useMemo(
    () => calcBonusScaling(Math.max(1, activeRow?.skill_level ?? 1)),
    [calcBonusScaling, activeRow?.skill_level],
  );

  const isUltimateSlot =
    activeSkill?.slot === "Ultimate" ||
    activeSkill?.level_slot === "Ultimate" ||
    activeSkill?.base_damage?.length === 3 ||
    activeSkill?.cooldown?.length === 3;
  const baseCdr = buildStats?.stats.cooldown_reduction ?? 0;
  const ultCdrBonus = isUltimateSlot ? (buildStats?.stats.ultimate_cdr_bonus ?? 0) : 0;
  const heroCdr = Math.min(40, baseCdr + ultCdrBonus);

  // Max levels for active skill
  const isPassive = activeSkill?.slot.startsWith("Passive") ?? false;
  const maxLevels = isPassive ? 1 : isUltimateSlot ? 3 : 6;
  const maxProgLen = skillProfile?.progressions?.reduce((acc, p) => Math.max(acc, p.values.length), 0) ?? 0;
  const numRows = isPassive
    ? Math.max(1, activeSkill?.base_damage?.length ?? 0)
    : Math.max(maxLevels, maxProgLen);

  // Authentic in-game table rows
  const inGameRows = useMemo(() => {
    if (!activeSkill || !skillProfile) return [];
    return getInGameSkillRows(activeSkill, skillProfile, maxLevels, hero);
  }, [activeSkill, skillProfile, maxLevels, hero]);

  const isHeroLevelScaling = isPassive && inGameRows.length > 0 && inGameRows[0].values.length === 6;
  const milestoneLabels = ["LV 1", "LV 4", "LV 7", "LV 10", "LV 13", "LV 15"];
  const activeMilestoneIdx = useMemo(() => {
    if (!isHeroLevelScaling || !buildStats) return -1;
    const lv = buildStats.level;
    const ms = [1, 4, 7, 10, 13, 15];
    return ms.findIndex((m, i, arr) => lv >= m && (i === arr.length - 1 || lv < arr[i + 1]));
  }, [isHeroLevelScaling, buildStats]);

  const tagCapsules = useMemo(() => {
    if (!activeSkill) return [];
    return getInGameTagCapsules(activeSkill);
  }, [activeSkill]);

  const circledNumber = useMemo(() => {
    if (!activeSkill) return "①";
    return getSlotCircledNumber(activeSkill.slot);
  }, [activeSkill]);

  const thaiTokens = useMemo(() => {
    const text = activeSkill?.desc_th || activeSkill?.description || "";
    return tokenizeThaiSkillDescription(text);
  }, [activeSkill]);

  return (
    <Modal labelledBy={titleId} className="max-h-[94vh] max-w-4xl" onClose={onClose}>
      {/* Modal Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 bg-panel-2/70">
        <div className="flex items-center gap-3">
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded clip-chamfer ring-1 ring-gold">
            <HeroPortrait name={hero} hero={heroDraft} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span id={titleId} className="font-display text-sm font-bold tracking-wider text-ink">{dName}</span>
              {dName !== hero && <span className="text-xs text-dim">({hero})</span>}
              {heroObj?.role && (
                <span className="rounded bg-panel px-1.5 py-0.5 font-mono text-[9px] font-semibold text-gold">
                  {heroObj.role} {heroObj.ranged ? "· ระยะไกล" : "· ระยะใกล้"}
                </span>
              )}
              {buildStats && (
                <span className="rounded border border-line/60 bg-bg px-1.5 py-0.5 font-mono text-[9px] text-muted">
                  เลเวล {buildStats.level} · AD {Math.round(buildStats.stats.attack_damage)} · AP {Math.round(buildStats.stats.ability_power)}
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted">คำอธิบายสกิลทางการ รูปแบบหน้าต่างในเกม และภาพสกรีนช็อตแคปจริง 130 ฮีโร่</p>
          </div>
        </div>

        {/* View Mode Toggle Controls */}
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-line bg-bg p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewMode("ingame")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold transition-all ${
                viewMode === "ingame"
                  ? "bg-gold text-bg shadow-sm font-bold"
                  : "text-muted hover:text-ink hover:bg-panel"
              }`}
              title="รูปแบบหน้าต่างทางการเหมือนในเกม RoV"
            >
              <LayoutGrid size={13} />
              <span>หน้าต่างในเกม</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeSkill?.slot) {
                  jumpToSkillScreenshot(activeSkill.slot);
                } else {
                  setViewMode("screenshot");
                }
              }}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold transition-all ${
                viewMode === "screenshot"
                  ? "bg-gold text-bg shadow-sm font-bold"
                  : "text-muted hover:text-ink hover:bg-panel"
              }`}
              title="ดูภาพสกรีนช็อตแคปจริงจากในเกม"
            >
              <ImageIcon size={13} />
              <span>รูปแคปจริง ({allScreenshots.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("live_calc")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold transition-all ${
                viewMode === "live_calc"
                  ? "bg-gold text-bg shadow-sm font-bold"
                  : "text-muted hover:text-ink hover:bg-panel"
              }`}
              title="ตารางคำนวณดาเมจจริงและการเจาะเกราะตามของที่ใส่"
            >
              <Swords size={13} />
              <span>คำนวณดาเมจจริง</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-dim transition-colors hover:bg-panel hover:text-ink"
            aria-label="ปิด"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Skill Slot Selector Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line/60 bg-bg/40 p-2.5">
        {sortedSkills.map((s) => {
          const isSelected = s.slot === activeSkill?.slot;
          const tCfg = TYPE_CONFIG[s.damage_type] || TYPE_CONFIG.none;
          const badge = getFormBadge(hero, s.slot);
          const cNum = getSlotCircledNumber(s.slot);
          return (
            <button
              key={s.slot}
              type="button"
              onClick={() => {
                setSelectedSlot(s.slot);
                if (viewMode === "screenshot") {
                  const idx = findScreenshotIdxForSlot(s.slot);
                  if (idx !== -1) setSelectedScreenshotIdx(idx);
                }
              }}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-all ${
                isSelected
                  ? "border-gold bg-gold/15 font-bold text-gold shadow-sm ring-1 ring-gold"
                  : "border-line/60 bg-panel/70 text-muted hover:border-line hover:text-ink"
              }`}
            >
              {s.icon_url && !failedIcons[s.icon_url] ? (
                <img
                  key={s.icon_url}
                  src={s.icon_url}
                  alt={s.name}
                  className="h-6 w-6 rounded object-contain"
                  onError={() => {
                    if (s.icon_url) {
                      const iconUrl = s.icon_url;
                      setFailedIcons((prev) => ({ ...prev, [iconUrl]: true }));
                    }
                  }}
                />
              ) : (
                <div className="grid h-6 w-6 place-items-center rounded bg-line font-display text-xs font-bold text-gold">
                  {cNum}
                </div>
              )}
              <div className="text-left">
                <div className="flex items-center gap-1">
                  <span className="font-mono text-[10px] font-bold text-gold">{cNum}</span>
                  <span className="text-[10px] leading-tight text-dim">{slotLabelTh(s.slot)}</span>
                  {badge && (
                    <span className={`rounded border px-1 py-0.5 font-mono text-[8px] font-semibold ${badge.style}`}>
                      {badge.label}
                    </span>
                  )}
                </div>
                <div className={`truncate max-w-[110px] font-medium leading-tight ${isSelected ? "text-gold" : tCfg.color}`}>
                  {s.name}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Content Area */}
      {viewMode === "screenshot" ? (
        /* SCREENSHOT VIEWER */
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {allScreenshots.length > 0 ? (
            <div className="flex flex-col gap-3">
              {/* Screenshot Selector Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-panel p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {allScreenshots.map((item, idx) => {
                    const isCur = idx === selectedScreenshotIdx;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => selectScreenshotAt(idx)}
                        className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-all ${
                          isCur
                            ? "border-gold bg-gold text-bg font-bold shadow-sm"
                            : "border-line/60 bg-panel-2 text-muted hover:border-line hover:text-ink"
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-1 text-xs">
                  <button
                    type="button"
                    disabled={selectedScreenshotIdx <= 0}
                    onClick={() => selectScreenshotAt(selectedScreenshotIdx - 1)}
                    className="rounded border border-line p-1 text-muted hover:bg-panel-2 hover:text-ink disabled:opacity-30"
                    title="ภาพก่อนหน้า"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="font-mono text-dim text-[11px] px-1">
                    {selectedScreenshotIdx + 1} / {allScreenshots.length}
                  </span>
                  <button
                    type="button"
                    disabled={selectedScreenshotIdx >= allScreenshots.length - 1}
                    onClick={() => selectScreenshotAt(selectedScreenshotIdx + 1)}
                    className="rounded border border-line p-1 text-muted hover:bg-panel-2 hover:text-ink disabled:opacity-30"
                    title="ภาพถัดไป"
                  >
                    <ChevronRight size={16} />
                  </button>
                  <a
                    href={allScreenshots[selectedScreenshotIdx]?.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 flex items-center gap-1 rounded border border-line/80 bg-panel-2 px-2 py-1 text-[11px] font-semibold text-gold hover:border-gold hover:text-gold"
                    title="เปิดรูปขนาดเต็มในแท็บใหม่"
                  >
                    <ExternalLink size={12} />
                    <span>รูปขนาดเต็ม</span>
                  </a>
                </div>
              </div>

              {/* Large Image View */}
              <div className="relative flex min-h-[460px] items-center justify-center overflow-hidden rounded-xl border border-line bg-black/80 p-2 shadow-2xl">
                <img
                  src={allScreenshots[selectedScreenshotIdx]?.url}
                  alt={allScreenshots[selectedScreenshotIdx]?.label}
                  className="max-h-[66vh] w-auto rounded-lg object-contain shadow-md"
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted px-1">
                <span className="font-mono text-dim">
                  ไฟล์: {allScreenshots[selectedScreenshotIdx]?.url.split("/").pop()}
                </span>
                <span className="text-dim">
                  ภาพสกรีนช็อตของจริงในเกมที่บันทึกไว้ในระบบ (โฟลเดอร์ heroes/{screenshotsData?.folder || hero}/)
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <ImageIcon size={48} className="text-dim mb-3" />
              <div className="font-display text-sm font-bold text-ink">ยังไม่มีภาพสกรีนช็อตสำหรับ {dName}</div>
              <p className="text-xs text-muted mt-1 max-w-md">
                ยังไม่พบไฟล์ภาพในโฟลเดอร์ heroes/{hero}/skill/ สามารถสลับไปดูข้อมูลที่หน้าต่างในเกมได้ทันที
              </p>
              <button
                type="button"
                onClick={() => setViewMode("ingame")}
                className="mt-4 rounded-md border border-gold bg-gold/15 px-3 py-1.5 text-xs font-bold text-gold hover:bg-gold/25"
              >
                สลับไปดูหน้าต่างในเกม
              </button>
            </div>
          )}
        </div>
      ) : viewMode === "ingame" ? (
        /* AUTHENTIC IN-GAME ROV SKILL CARD */
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeSkill && (
            <div className="flex flex-col gap-3.5 rounded-xl border border-gold/30 bg-gradient-to-b from-[#161d2b]/95 to-[#0c121d]/95 p-4 shadow-xl">
              {/* In-Game Header: Circled Number + Name + In-Game Tag Capsules */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-3">
                <div className="flex items-center gap-3">
                  {/* Circled Slot Icon */}
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gold/60 bg-gold/10 font-display text-2xl font-black text-gold shadow-md">
                    {circledNumber}
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="font-display text-lg font-bold tracking-wide text-ink">
                        {activeSkill.name}
                      </h3>
                      {getFormBadge(hero, activeSkill.slot) && (
                        <span
                          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold ${
                            getFormBadge(hero, activeSkill.slot)!.style
                          }`}
                        >
                          {getFormBadge(hero, activeSkill.slot)!.label}
                        </span>
                      )}
                    </div>

                    {/* Official In-Game Rounded Tag Capsules */}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {tagCapsules.map((cap, i) => (
                        <span
                          key={i}
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wider ${cap.bg} ${cap.text} ${cap.border}`}
                        >
                          {cap.label}
                        </span>
                      ))}
                      {skillProfile?.summaryBadge && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${skillProfile.summaryBadge.badgeClass}`}
                        >
                          {skillProfile.summaryBadge.text}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Quick Screenshot Link Button */}
                {allScreenshots.length > 0 && (
                  <button
                    type="button"
                    onClick={() => jumpToSkillScreenshot(activeSkill.slot)}
                    className="flex items-center gap-1.5 rounded-lg border border-gold/40 bg-gold/10 px-2.5 py-1 text-xs font-semibold text-gold transition-colors hover:border-gold hover:bg-gold/20"
                    title="เปิดดูภาพแคปจริงของสกิลนี้"
                  >
                    <ImageIcon size={13} />
                    <span>ดูรูปแคปจริง</span>
                  </button>
                )}
              </div>

              {/* In-Game Resource Stats Bar: Cooldown & Mana */}
              <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-dim border-b border-line/40 pb-2.5">
                {activeSkill.cooldown && activeSkill.cooldown.length > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <Clock size={13} className="text-muted" />
                    <span>คูลดาวน์:</span>
                    <span className="font-bold text-ink">
                      {activeSkill.cooldown.join(" / ")} วิ
                    </span>
                    {heroCdr > 0 && (() => {
                      const curSkillLv = activeRow?.skill_level ?? 1;
                      const cdIdx = Math.min(Math.max(1, curSkillLv) - 1, activeSkill.cooldown.length - 1);
                      const baseCd = activeSkill.cooldown[cdIdx];
                      const reducedCd = (baseCd * (1 - heroCdr / 100)).toFixed(1);
                      return (
                        <span className="text-[10px] text-gold">
                          {curSkillLv > 0
                            ? `(เหลือ ${reducedCd}วิ ที่ Lv.${curSkillLv} ด้วย CDR ${heroCdr}%)`
                            : `(Lv.1: ${reducedCd}วิ ด้วย CDR ${heroCdr}% — ยังไม่อัพสกิล)`}
                        </span>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-muted">
                    <Clock size={13} />
                    <span>คูลดาวน์: ไม่มี</span>
                  </div>
                )}

                {activeSkill.mana_cost && activeSkill.mana_cost.length > 0 && Math.max(...activeSkill.mana_cost) > 0 ? (
                  <div className="flex items-center gap-1.5 text-blue">
                    <Droplet size={13} />
                    <span>ใช้มานา:</span>
                    <span className="font-bold text-blue-200">
                      {activeSkill.mana_cost.join(" / ")}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-muted">
                    <Droplet size={13} />
                    <span>ไม่ใช้มานา / พลังงาน</span>
                  </div>
                )}
              </div>

              {/* In-Game Syntax-Highlighted Thai Description */}
              <div className="rounded-lg border border-line/70 bg-bg/60 p-3.5 text-xs leading-relaxed">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-gold">
                  <Sparkles size={12} />
                  <span>คำอธิบายสกิล (รายละเอียดทางการในเกม)</span>
                </div>
                <div className="whitespace-pre-line text-muted">
                  {thaiTokens.map((t, idx) => (
                    <span key={idx} className={t.className}>
                      {t.text}
                    </span>
                  ))}
                </div>
              </div>

              {/* Authentic In-Game Horizontal Progression Table (LV 1 - LV 6) */}
              {inGameRows.length > 0 && (
                <div className="rounded-lg border border-line bg-panel/80 p-3">
                  <div className="mb-2 flex items-center justify-between border-b border-line/50 pb-2">
                    <div className="flex items-center gap-2">
                      <Zap size={14} className="text-gold" />
                      <h4 className="font-display text-xs font-bold tracking-wider text-ink">
                        {isHeroLevelScaling
                          ? "ตารางค่าสถิติสกิลตามเลเวลฮีโร่ (LV 1, 4, 7, 10, 13, 15)"
                          : `ตารางค่าสถิติสกิลตามเลเวล (LV 1 - LV ${maxLevels})`}
                      </h4>
                    </div>
                    {buildStats && (
                      <span className="font-mono text-[10px] text-gold">
                        ★ ไฮไลต์ตามเลเวลฮีโร่ปัจจุบัน (Lv {buildStats.level})
                      </span>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead>
                        <tr className="border-b border-line/60 text-left text-[11px] text-dim">
                          <th className="py-2 pr-3 font-semibold text-ink">สถิติสกิล</th>
                          {isHeroLevelScaling
                            ? milestoneLabels.map((lbl, i) => {
                                const isCur = activeMilestoneIdx === i;
                                return (
                                  <th
                                    key={lbl}
                                    className={`py-2 px-2 text-center font-bold transition-colors ${
                                      isCur
                                        ? "bg-gold/20 text-gold border-b-2 border-gold font-black"
                                        : "text-muted"
                                    }`}
                                  >
                                    {lbl}
                                  </th>
                                );
                              })
                            : Array.from({ length: maxLevels }, (_, i) => {
                                const lv = i + 1;
                                const isCur = activeRow?.skill_level === lv;
                                return (
                                  <th
                                    key={lv}
                                    className={`py-2 px-2 text-center font-bold transition-colors ${
                                      isCur
                                        ? "bg-gold/20 text-gold border-b-2 border-gold font-black"
                                        : "text-muted"
                                    }`}
                                  >
                                    LV {lv}
                                  </th>
                                );
                              })}
                        </tr>
                      </thead>
                      <tbody>
                        {inGameRows.map((row) => (
                          <tr
                            key={row.code}
                            className="border-t border-line/30 transition-colors hover:bg-panel-2/50"
                          >
                            <td className="py-2 pr-3 font-bold text-dim">
                              <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-mono text-gold mr-1.5">
                                {row.code}
                              </span>
                              <span className="text-[11px] font-sans font-medium text-ink">
                                {row.label.split(" (")[0]}
                              </span>
                            </td>
                            {Array.from({ length: isHeroLevelScaling ? 6 : maxLevels }, (_, i) => {
                              const lv = i + 1;
                              const val = row.values[i] ?? "—";
                              const isCur = isHeroLevelScaling
                                ? activeMilestoneIdx === i
                                : activeRow?.skill_level === lv;
                              return (
                                <td
                                  key={lv}
                                  className={`py-2 px-2 text-center tabular-nums transition-colors ${
                                    isCur
                                      ? "bg-gold/10 font-black text-gold ring-1 ring-gold/40"
                                      : row.colorClass
                                  }`}
                                >
                                  {val}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Scaling Ratios */}
              {activeSkill.scaling && Object.keys(activeSkill.scaling).length > 0 && (
                <div className="rounded-lg border border-line bg-panel/70 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gold">
                    <Swords size={13} />
                    <span>สูตรการคูณพลังโจมตี (Scaling Ratios)</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {formatScaling(activeSkill.scaling, Math.max(1, activeRow?.skill_level ?? 1)).map((s, idx) => (
                      <span
                        key={idx}
                        className="rounded border border-gold/40 bg-gold/10 px-2 py-1 font-mono text-xs font-semibold text-gold"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* LIVE CALCULATION VIEW (COMBAT SIMULATOR) */
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeSkill && (
            <>
              {/* Overview info */}
              <div className="flex flex-col gap-3 rounded-lg border border-line bg-panel-2/40 p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {activeSkill.icon_url ? (
                      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 border-gold/50 bg-bg p-0.5 shadow-md">
                        <img
                          src={activeSkill.icon_url}
                          alt={activeSkill.name}
                          className="h-full w-full object-contain"
                        />
                      </div>
                    ) : (
                      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg border border-line bg-bg font-display text-xl font-bold text-gold">
                        {circledNumber}
                      </div>
                    )}

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] font-bold tracking-wider text-gold">
                          {slotLabelTh(activeSkill.slot)}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold border ${
                            TYPE_CONFIG[activeSkill.damage_type]?.bg
                          } ${TYPE_CONFIG[activeSkill.damage_type]?.color} ${
                            TYPE_CONFIG[activeSkill.damage_type]?.border
                          }`}
                        >
                          {TYPE_CONFIG[activeSkill.damage_type]?.labelTh || activeSkill.damage_type}
                        </span>
                      </div>
                      <h3 className="font-display text-base font-bold text-ink mt-0.5">
                        {activeSkill.name}
                      </h3>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1 shrink-0 text-xs font-mono">
                    {activeSkill.cooldown && activeSkill.cooldown.length > 0 && (
                      <div className="flex items-center gap-1 text-dim">
                        <Clock size={12} className="text-muted" />
                        <span>{activeSkill.cooldown.join(" / ")} วิ</span>
                      </div>
                    )}
                    {activeSkill.mana_cost && activeSkill.mana_cost.length > 0 && activeSkill.mana_cost[0] > 0 && (
                      <div className="flex items-center gap-1 text-blue">
                        <Droplet size={12} />
                        <span>{activeSkill.mana_cost.join(" / ")}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Highlights Grid */}
                {skillProfile?.highlights && skillProfile.highlights.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {skillProfile.highlights.map((h, i) => (
                      <div key={i} className={`flex items-start gap-2 rounded-lg border p-2 text-xs ${h.badgeClass}`}>
                        <div className="mt-0.5 shrink-0">
                          {h.icon === "shield" && <Shield size={14} />}
                          {h.icon === "heart" && <Heart size={14} />}
                          {h.icon === "speed" && <Wind size={14} />}
                          {h.icon === "zap" && <Zap size={14} />}
                          {h.icon === "swords" && <Swords size={14} />}
                          {h.icon === "target" && <Target size={14} />}
                          {h.icon === "clock" && <Clock size={14} />}
                          {h.icon === "sparkles" && <Sparkles size={14} />}
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold leading-tight">{h.title}</div>
                          <div className="text-[11px] leading-tight opacity-90 mt-0.5">{h.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Combat Damage Calculation Table */}
              <div className="rounded-lg border border-line bg-panel p-3">
                <div className="mb-2 flex items-center justify-between border-b border-line/50 pb-2">
                  <div className="flex items-center gap-2">
                    <Swords size={14} className="text-gold" />
                    <h4 className="font-display text-xs font-bold tracking-wider text-ink">
                      ตารางคำนวณดาเมจและเอฟเฟกต์ตามของสวมใส่ (Lv 1 - {numRows})
                    </h4>
                  </div>
                  {buildStats && (
                    <span className="font-mono text-[10px] text-dim">
                      คำนวณตามของและรูนปัจจุบัน (CDR {heroCdr}%)
                    </span>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-line/40 text-left text-[10px] text-dim">
                        <th className="py-1.5 font-normal">เลเวล</th>
                        {skillProfile?.isDefensiveOrBuffOnly ? (
                          <>
                            {skillProfile.progressions.length > 0 ? (
                              skillProfile.progressions.map((prog) => (
                                <th key={prog.id} className={`py-1.5 text-right font-normal ${prog.textClass}`}>
                                  {prog.label}
                                </th>
                              ))
                            ) : (
                              <th className="py-1.5 text-center font-normal text-dim">ผลลัพธ์ของสกิล</th>
                            )}
                          </>
                        ) : (
                          <>
                            <th className="py-1.5 text-right font-normal">
                              {skillProfile?.baseValueType === "shield"
                                ? "โล่พื้นฐาน"
                                : skillProfile?.baseValueType === "heal"
                                ? "ฟื้นฟูพื้นฐาน"
                                : "ดาเมจพื้นฐาน"}
                            </th>
                            {bonusScalingVal > 0 && (
                              <th className="py-1.5 text-right font-normal">+โบนัสของ/รูน</th>
                            )}
                            <th className="py-1.5 text-right font-normal">
                              {skillProfile?.baseValueType === "shield"
                                ? "รวมโล่ป้องกัน"
                                : skillProfile?.baseValueType === "heal"
                                ? "รวมปริมาณฟื้นฟู"
                                : "รวมดาเมจดิบ"}
                            </th>
                            {skillProfile?.baseValueType === "damage" &&
                              activeRow &&
                              activeRow.mitigation_multiplier > 0 &&
                              activeRow.mitigation_multiplier < 1 && (
                                <th className="py-1.5 text-right font-normal">เข้าจริง (ใส่ {enemyName ?? "ศัตรู"})</th>
                              )}
                            {skillProfile?.progressions
                              .filter((p) => p.category !== "damage")
                              .map((prog) => (
                                <th key={prog.id} className={`py-1.5 text-right font-normal ${prog.textClass}`}>
                                  {prog.shortLabel}
                                </th>
                              ))}
                          </>
                        )}
                        <th className="py-1.5 text-right font-normal">คูลดาวน์</th>
                        <th className="py-1.5 text-right font-normal">มานา</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: numRows }, (_, idx) => {
                        const lv = idx + 1;
                        const pickAt = (arr?: number[]) =>
                          arr && arr.length > 0 ? arr[Math.min(idx, arr.length - 1)] : 0;
                        const baseDmg = pickAt(activeSkill.base_damage);
                        const rowBonusVal = calcBonusScaling(lv);
                        const rawDmg = baseDmg + rowBonusVal;
                        const baseCd = pickAt(activeSkill.cooldown);
                        const finalCd = baseCd > 0 ? Number((baseCd * (1 - heroCdr / 100)).toFixed(1)) : 0;
                        const mana = pickAt(activeSkill.mana_cost);
                        const isCurrentLv = activeRow?.skill_level === lv;
                        const finalDmg = activeRow?.mitigation_multiplier
                          ? Math.round(rawDmg * activeRow.mitigation_multiplier)
                          : rawDmg;

                        return (
                          <tr
                            key={lv}
                            className={`border-t border-line/30 font-mono transition-colors ${
                              isCurrentLv
                                ? "bg-gold/10 font-bold text-gold"
                                : "hover:bg-panel-2/40 text-muted"
                            }`}
                          >
                            <td className="py-1.5">
                              <span className="flex items-center gap-1.5">
                                {isCurrentLv && <ChevronRight size={11} className="text-gold" />}
                                <span>Lv {lv}</span>
                                {isCurrentLv && (
                                  <span className="rounded bg-gold/20 px-1 text-[9px] text-gold">ปัจจุบัน</span>
                                )}
                              </span>
                            </td>

                            {skillProfile?.isDefensiveOrBuffOnly ? (
                              <>
                                {skillProfile.progressions.length > 0 ? (
                                  skillProfile.progressions.map((prog) => {
                                    const val = prog.values[Math.min(idx, prog.values.length - 1)];
                                    return (
                                      <td
                                        key={prog.id}
                                        className={`py-1.5 text-right tabular-nums font-bold ${prog.textClass}`}
                                      >
                                        {val}
                                      </td>
                                    );
                                  })
                                ) : (
                                  <td className="py-1.5 text-center text-dim text-[11px]">
                                    — สกิลสถานะคงที่ —
                                  </td>
                                )}
                              </>
                            ) : (
                              <>
                                <td className="py-1.5 text-right tabular-nums text-ink">
                                  {baseDmg > 0 ? baseDmg.toLocaleString() : "—"}
                                </td>
                                {bonusScalingVal > 0 && (
                                  <td className="py-1.5 text-right tabular-nums text-gold">
                                    +{rowBonusVal.toLocaleString()}
                                  </td>
                                )}
                                <td className="py-1.5 text-right tabular-nums font-bold text-ink">
                                  {rawDmg > 0 ? rawDmg.toLocaleString() : "—"}
                                </td>
                                {skillProfile?.baseValueType === "damage" &&
                                  activeRow &&
                                  activeRow.mitigation_multiplier > 0 &&
                                  activeRow.mitigation_multiplier < 1 && (
                                    <td className="py-1.5 text-right tabular-nums font-bold text-good">
                                      {finalDmg > 0 ? finalDmg.toLocaleString() : "—"}
                                    </td>
                                  )}
                                {skillProfile?.progressions
                                  .filter((p) => p.category !== "damage")
                                  .map((prog) => {
                                    const val = prog.values[Math.min(idx, prog.values.length - 1)];
                                    return (
                                      <td
                                        key={prog.id}
                                        className={`py-1.5 text-right tabular-nums font-semibold ${prog.textClass}`}
                                      >
                                        {val}
                                      </td>
                                    );
                                  })}
                              </>
                            )}

                            <td className="py-1.5 text-right tabular-nums text-muted">
                              {baseCd > 0 ? (
                                <span>
                                  {finalCd}วิ
                                  {heroCdr > 0 && <span className="text-[10px] text-dim"> ({baseCd}วิ)</span>}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-blue">
                              {mana > 0 ? mana : "0"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

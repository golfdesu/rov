export type SkillEffectCategory =
  | "damage_reduction"
  | "shield"
  | "heal"
  | "move_speed"
  | "attack_speed"
  | "slow"
  | "pierce"
  | "defense"
  | "ad_buff"
  | "ap_buff"
  | "control"
  | "duration"
  | "damage"
  | "other";

export interface SkillProgressionEffect {
  id: string;
  label: string; // e.g. "ลดความเสียหาย (Damage Reduction)"
  shortLabel: string; // e.g. "ทน/ลดความเสียหาย"
  category: SkillEffectCategory;
  values: string[]; // e.g. ["40%", "44%", "48%", "52%", "56%", "60%"]
  unit: string; // e.g. "%" or "วิ"
  badgeClass: string; // tailwind classes
  textClass: string;
}

export interface SkillSpecialHighlight {
  icon: "shield" | "heart" | "zap" | "speed" | "swords" | "target" | "clock" | "sparkles";
  title: string;
  detail: string;
  badgeClass: string;
}

export interface ParsedSkillProfile {
  isDefensiveOrBuffOnly: boolean;
  hasDamage: boolean;
  isDamageReductionSkill: boolean;
  isShieldSkill: boolean;
  isHealSkill: boolean;
  isBuffSkill: boolean;
  baseValueType: "damage" | "shield" | "heal" | "buff";
  progressions: SkillProgressionEffect[];
  highlights: SkillSpecialHighlight[];
  summaryBadge?: { text: string; badgeClass: string };
}

interface SkillLike {
  name: string;
  slot: string;
  type?: string;
  damage_type: string;
  base_damage?: number[];
  cooldown?: number[] | number;
  base_cooldown?: number;
  mana_cost?: number[] | number | null;
  scaling?: Record<string, number>;
  description?: string;
  desc_th?: string;
}

const CATEGORY_STYLES: Record<
  SkillEffectCategory,
  { badgeClass: string; textClass: string; defaultLabel: string; defaultShort: string }
> = {
  damage_reduction: {
    badgeClass: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    textClass: "text-emerald-400",
    defaultLabel: "ลดความเสียหาย (Damage Reduction)",
    defaultShort: "ทน/ลดความเสียหาย",
  },
  shield: {
    badgeClass: "border-sky-500/40 bg-sky-500/10 text-sky-400",
    textClass: "text-sky-400",
    defaultLabel: "โล่ป้องกัน (Shield)",
    defaultShort: "โล่ป้องกัน",
  },
  heal: {
    badgeClass: "border-green-500/40 bg-green-500/10 text-green-400",
    textClass: "text-green-400",
    defaultLabel: "ฟื้นฟูพลังชีวิต (Heal)",
    defaultShort: "ฟื้นฟูเลือด",
  },
  move_speed: {
    badgeClass: "border-cyan-500/40 bg-cyan-500/10 text-cyan-400",
    textClass: "text-cyan-400",
    defaultLabel: "ความเร็วเคลื่อนที่ (Move Speed)",
    defaultShort: "ความเร็วเคลื่อนที่",
  },
  attack_speed: {
    badgeClass: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    textClass: "text-amber-400",
    defaultLabel: "ความเร็วโจมตี (Attack Speed)",
    defaultShort: "ความเร็วโจมตี",
  },
  slow: {
    badgeClass: "border-indigo-500/40 bg-indigo-500/10 text-indigo-400",
    textClass: "text-indigo-400",
    defaultLabel: "สโลว์ศัตรู (Slow)",
    defaultShort: "สโลว์ศัตรู",
  },
  pierce: {
    badgeClass: "border-orange-500/40 bg-orange-500/10 text-orange-400",
    textClass: "text-orange-400",
    defaultLabel: "เจาะเกราะ (Armor Pierce)",
    defaultShort: "เจาะเกราะ",
  },
  defense: {
    badgeClass: "border-teal-500/40 bg-teal-500/10 text-teal-400",
    textClass: "text-teal-400",
    defaultLabel: "เพิ่มเกราะ/ต้านทาน (Defense)",
    defaultShort: "เพิ่มเกราะ/ต้านทาน",
  },
  ad_buff: {
    badgeClass: "border-gold/40 bg-gold/10 text-gold",
    textClass: "text-gold",
    defaultLabel: "เพิ่มพลังโจมตี (Bonus AD)",
    defaultShort: "พลังโจมตี",
  },
  ap_buff: {
    badgeClass: "border-purple-500/40 bg-purple-500/10 text-purple-400",
    textClass: "text-purple-400",
    defaultLabel: "เพิ่มพลังเวท (Bonus AP)",
    defaultShort: "พลังเวท",
  },
  control: {
    badgeClass: "border-pink-500/40 bg-pink-500/10 text-pink-400",
    textClass: "text-pink-400",
    defaultLabel: "ผลควบคุม (Crowd Control)",
    defaultShort: "ผลควบคุม",
  },
  duration: {
    badgeClass: "border-line bg-panel text-muted",
    textClass: "text-muted",
    defaultLabel: "ระยะเวลาสกิล (Duration)",
    defaultShort: "ระยะเวลา",
  },
  damage: {
    badgeClass: "border-[#ff9f43]/40 bg-[#ff9f43]/10 text-[#ff9f43]",
    textClass: "text-[#ff9f43]",
    defaultLabel: "ดาเมจสกิล (Damage)",
    defaultShort: "ดาเมจ",
  },
  other: {
    badgeClass: "border-line bg-panel text-muted",
    textClass: "text-muted",
    defaultLabel: "ผลลัพธ์ของสกิล (Skill Effect)",
    defaultShort: "ผลของสกิล",
  },
};

/**
 * Parses slash progressions e.g. "40/44/48/52/56/60%" from text descriptions.
 */
function extractSlashSeries(text: string): Array<{ raw: string; values: string[]; context: string }> {
  if (!text) return [];
  // Match 2 to 6 numbers separated by slashes, optionally ending with % or s
  const slashRegex = /(?:^|[^\w/])((?:\d+(?:\.\d+)?%?\s*\/\s*){2,5}\d+(?:\.\d+)?%?s?)(?:[^\w/]|$)/g;
  const results: Array<{ raw: string; values: string[]; context: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = slashRegex.exec(text)) !== null) {
    const rawMatch = match[1].trim();
    const cleanRaw = rawMatch.replace(/\s+/g, "");
    const parts = cleanRaw.split("/").map((p) => p.trim());
    if (parts.length >= 2) {
      const idx = match.index;
      const start = Math.max(0, idx - 50);
      const end = Math.min(text.length, idx + rawMatch.length + 50);
      const context = text.slice(start, end).toLowerCase();

      // Normalize % unit if last part has % but previous do not
      const endsWithPct = cleanRaw.endsWith("%");
      const normalizedParts = endsWithPct
        ? parts.map((p) => (p.endsWith("%") ? p : `${p}%`))
        : parts;

      results.push({
        raw: cleanRaw,
        values: normalizedParts,
        context,
      });
    }
  }

  return results;
}

/**
 * Categorize progression by analyzing surrounding context.
 */
function categorizeContext(ctx: string): SkillEffectCategory {
  if (
    ctx.includes("damage reduction") ||
    ctx.includes("reducing damage") ||
    ctx.includes("reduces damage") ||
    ctx.includes("reduced damage") ||
    ctx.includes("ลดความเสียหาย") ||
    ctx.includes("ทนความเสียหาย") ||
    ctx.includes("ต้านความเสียหาย")
  ) {
    return "damage_reduction";
  }
  if (
    ctx.includes("shield") ||
    ctx.includes("absorb") ||
    ctx.includes("absorbing") ||
    ctx.includes("barrier") ||
    ctx.includes("โล่") ||
    ctx.includes("เกราะป้องกัน")
  ) {
    return "shield";
  }
  if (
    ctx.includes("heal") ||
    ctx.includes("recovering") ||
    ctx.includes("restoring") ||
    ctx.includes("regenerat") ||
    ctx.includes("ฟื้นฟู") ||
    ctx.includes("รักษา")
  ) {
    return "heal";
  }
  if (
    ctx.includes("movement speed") ||
    ctx.includes("move speed") ||
    ctx.includes("ความเร็วเคลื่อนที่") ||
    ctx.includes("วิ่งเร็ว")
  ) {
    return "move_speed";
  }
  if (
    ctx.includes("attack speed") ||
    ctx.includes("ความเร็วโจมตี") ||
    ctx.includes("ตีเร็ว")
  ) {
    return "attack_speed";
  }
  if (
    ctx.includes("armor pierce") ||
    ctx.includes("magic pierce") ||
    ctx.includes("pierce") ||
    ctx.includes("เจาะเกราะ")
  ) {
    return "pierce";
  }
  if (
    ctx.includes("armor") ||
    ctx.includes("magic defense") ||
    ctx.includes("defense") ||
    ctx.includes("def down") ||
    ctx.includes("def ") ||
    ctx.includes("เกราะ") ||
    ctx.includes("ต้านทาน")
  ) {
    return "defense";
  }
  if (
    ctx.includes("attack damage") ||
    ctx.includes("bonus ad") ||
    ctx.includes("ad ") ||
    ctx.includes("พลังโจมตี")
  ) {
    return "ad_buff";
  }
  if (
    ctx.includes("ability power") ||
    ctx.includes("ap ") ||
    ctx.includes("พลังเวท")
  ) {
    return "ap_buff";
  }
  if (
    ctx.includes("slow") ||
    ctx.includes("สโลว์") ||
    ctx.includes("ลดความเร็ว")
  ) {
    return "slow";
  }
  if (
    ctx.includes("duration") ||
    ctx.includes("seconds") ||
    ctx.includes("วินาที") ||
    ctx.includes("วิ")
  ) {
    return "duration";
  }
  if (ctx.includes("damage") || ctx.includes("ความเสียหาย")) {
    return "damage";
  }
  return "other";
}

/**
 * Main parser extracting progression effects and UI highlights for any RoV skill.
 */
export function parseSkillEffects(
  skill: SkillLike,
  heroName?: string,
  heroLevel?: number,
  skillLevel?: number
): ParsedSkillProfile {
  const desc = skill.description ?? "";
  const descTh = skill.desc_th ?? "";
  const stype = (skill.type ?? "").toLowerCase();
  const dtype = skill.damage_type;
  const bd = skill.base_damage ?? [];
  const sc = skill.scaling ?? {};

  const hasPositiveBaseDmg = bd.some((v) => v > 0);
  const hasOffensiveScaling = Boolean(
    sc.ad_pct ||
      sc.bonus_ad_pct ||
      sc.ap_pct ||
      sc.bonus_ap_pct ||
      sc.target_hp_pct ||
      sc.target_max_hp_pct ||
      sc.target_current_hp_pct ||
      sc.target_hp_per_100_ad_pct ||
      sc.target_hp_per_100_bonus_ad_pct ||
      sc.target_hp_per_100_ap_pct
  );

  const isDmgType = dtype === "physical" || dtype === "magic" || dtype === "true";
  const hasDamage = hasPositiveBaseDmg || (isDmgType && hasOffensiveScaling);

  // Check type keywords
  const isTypeShield = stype.includes("shield") || desc.toLowerCase().includes("shield absorbing");
  const isTypeHeal = stype.includes("heal") || desc.toLowerCase().includes("healing");
  const isTypeDamageReduction =
    stype.includes("damage reduction") ||
    desc.toLowerCase().includes("damage reduction") ||
    descTh.includes("ลดความเสียหาย");

  let baseValueType: "damage" | "shield" | "heal" | "buff" = "damage";
  if (!hasDamage) {
    if (isTypeDamageReduction) baseValueType = "buff";
    else if (isTypeShield) baseValueType = "shield";
    else if (isTypeHeal) baseValueType = "heal";
    else baseValueType = "buff";
  } else if (dtype === "none") {
    if (isTypeShield) baseValueType = "shield";
    else if (isTypeHeal) baseValueType = "heal";
    else baseValueType = "buff";
  }

  // Extract progressions from both English (typically structured with slashes) and Thai
  const extractedEn = extractSlashSeries(desc);
  const extractedTh = extractSlashSeries(descTh);
  const rawList = [...extractedEn, ...extractedTh];

  // De-duplicate and categorize progressions
  const progressions: SkillProgressionEffect[] = [];
  const seenKeys = new Set<string>();

  for (const item of rawList) {
    const key = item.values.join("/");
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const category = categorizeContext(item.context);
    const cfg = CATEGORY_STYLES[category] || CATEGORY_STYLES.other;

    progressions.push({
      id: `${category}-${key}`,
      label: cfg.defaultLabel,
      shortLabel: cfg.defaultShort,
      category,
      values: item.values,
      unit: item.raw.endsWith("%") ? "%" : item.raw.endsWith("s") ? "วิ" : "",
      badgeClass: cfg.badgeClass,
      textClass: cfg.textClass,
    });
  }

  // Build highlights
  const highlights: SkillSpecialHighlight[] = [];

  // 1. Omen Skill 2 Specific Highlighting
  if (
    (heroName === "Omen" || skill.name === "Untouchable") &&
    skill.slot === "Skill 2"
  ) {
    const drValues = progressions.find((p) => p.category === "damage_reduction")?.values ?? [
      "40%",
      "44%",
      "48%",
      "52%",
      "56%",
      "60%",
    ];
    highlights.push({
      icon: "shield",
      title: "ทน/ลดความเสียหาย",
      detail: `ลดความเสียหายที่ได้รับลง ${drValues[0]} - ${drValues[drValues.length - 1]} (ตามเลเวลสกิล)`,
      badgeClass: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    });
    highlights.push({
      icon: "speed",
      title: "เพิ่มความเร็วเคลื่อนที่",
      detail: "+30% ความเร็วเคลื่อนที่เป็นเวลา 2 วินาที",
      badgeClass: "border-cyan-500/40 bg-cyan-500/10 text-cyan-400",
    });
    highlights.push({
      icon: "swords",
      title: "สะท้อนการโจมตีปกติ",
      detail: "สะท้อนดาเมจการโจมตีปกติกลับหาผู้โจมตีเป็นกายภาพ พร้อมสโลว์ 30% (ติดผลไอเทม)",
      badgeClass: "border-gold/40 bg-gold/10 text-gold",
    });
  } else {
    // Generic progression highlights
    for (const prog of progressions) {
      if (prog.category === "damage" && hasDamage) continue; // already shown in damage columns
      let icon: SkillSpecialHighlight["icon"] = "sparkles";
      if (prog.category === "damage_reduction" || prog.category === "shield" || prog.category === "defense") {
        icon = "shield";
      } else if (prog.category === "heal") {
        icon = "heart";
      } else if (prog.category === "move_speed") {
        icon = "speed";
      } else if (prog.category === "attack_speed") {
        icon = "zap";
      } else if (prog.category === "pierce" || prog.category === "ad_buff" || prog.category === "ap_buff") {
        icon = "target";
      } else if (prog.category === "duration") {
        icon = "clock";
      }

      const firstVal = prog.values[0];
      const lastVal = prog.values[prog.values.length - 1];
      const rangeText = prog.values.length > 1 ? `${firstVal} - ${lastVal}` : firstVal;

      highlights.push({
        icon,
        title: prog.shortLabel,
        detail: `${prog.label}: ${rangeText} (Lv 1 - ${prog.values.length})`,
        badgeClass: prog.badgeClass,
      });
    }
  }

  // Known special utility heroes without slash numbers
  if (heroName === "Stuart" && skill.slot === "Skill 2") {
    highlights.push({
      icon: "shield",
      title: "อมตะความเสียหายกายภาพ",
      detail: "ป้องกันความเสียหายกายภาพ 100% เป็นเวลา 1.5 วินาที พร้อมวิ่งเร็วขึ้น 30%",
      badgeClass: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    });
  } else if (heroName === "Dextra" && skill.slot === "Ultimate") {
    highlights.push({
      icon: "heart",
      title: "อมตะ + เปลี่ยนดาเมจเป็นเลือด",
      detail: "อมตะ 2.5 วินาที ลบล้างสถานะ CC และแปลงดาเมจที่ได้รับทั้งหมดเป็นพลังชีวิต 100%",
      badgeClass: "border-green-500/40 bg-green-500/10 text-green-400",
    });
  } else if (heroName === "Kil'Groth" && skill.slot === "Ultimate") {
    highlights.push({
      icon: "zap",
      title: "ลบล้างสถานะ + ต้าน CC สมบูรณ์",
      detail: "ลบล้างทุกสถานะผิดปกติ ป้องกัน CC นาน 4 วินาที และเพิ่มความเร็วเคลื่อนที่ 80% (ค่อยๆ ลดลง)",
      badgeClass: "border-cyan-500/40 bg-cyan-500/10 text-cyan-400",
    });
  } else if (heroName === "Taara" && skill.slot === "Ultimate" && highlights.length === 0) {
    highlights.push({
      icon: "heart",
      title: "ฟื้นฟูเลือดมหาศาล",
      detail: "ฟื้นฟู 6% Max HP + 6% เลือดที่เสีย ทุก 1 วินาที (นาน 5 / 6 / 7 วินาที) + วิ่งเร็ว 30%",
      badgeClass: "border-green-500/40 bg-green-500/10 text-green-400",
    });
  }

  // Progression lookup
  const drProg = progressions.find((p) => p.category === "damage_reduction");
  const shieldProg = progressions.find((p) => p.category === "shield");
  const healProg = progressions.find((p) => p.category === "heal");
  const asProg = progressions.find((p) => p.category === "attack_speed");
  const msProg = progressions.find((p) => p.category === "move_speed");
  const pierceProg = progressions.find((p) => p.category === "pierce");
  const adProg = progressions.find((p) => p.category === "ad_buff");

  // Check exact hero passive scaling profile first
  const exactProfile = heroName
    ? getExactHeroPassiveScaling(heroName, skill.slot, skill.name, heroLevel ?? 1)
    : null;

  if (exactProfile) {
    for (const h of exactProfile.highlights) {
      highlights.push(h);
    }
  }

  // Summary badge for quick cards
  let summaryBadge: { text: string; badgeClass: string } | undefined;
  if (exactProfile) {
    summaryBadge = {
      text: exactProfile.summaryBadgeText(heroLevel ?? 1),
      badgeClass: exactProfile.badgeClass,
    };
  } else {
    const pickProgVal = (prog: SkillProgressionEffect): string => {
      if (skillLevel && skillLevel >= 1 && skillLevel <= prog.values.length) {
        return `${prog.values[skillLevel - 1]} (Lv ${skillLevel})`;
      }
      return `${prog.values[0]} (Lv 1) - ${prog.values[prog.values.length - 1]} (Lv ${prog.values.length})`;
    };

    if (drProg) {
      summaryBadge = {
        text: `🛡️ ลดดาเมจ ${pickProgVal(drProg)}`,
        badgeClass: drProg.badgeClass,
      };
    } else if (shieldProg) {
      summaryBadge = {
        text: `🛡️ โล่ ${pickProgVal(shieldProg)}`,
        badgeClass: shieldProg.badgeClass,
      };
    } else if (healProg) {
      summaryBadge = {
        text: `💖 ฟื้นฟู ${pickProgVal(healProg)}`,
        badgeClass: healProg.badgeClass,
      };
    } else if (asProg) {
      summaryBadge = {
        text: `⚡ ตีเร็ว +${pickProgVal(asProg)}`,
        badgeClass: asProg.badgeClass,
      };
    } else if (pierceProg) {
      summaryBadge = {
        text: `🎯 เจาะเกราะ ${pickProgVal(pierceProg)}`,
        badgeClass: pierceProg.badgeClass,
      };
    } else if (adProg) {
      summaryBadge = {
        text: `⚔️ AD +${pickProgVal(adProg)}`,
        badgeClass: adProg.badgeClass,
      };
    } else if (msProg) {
      summaryBadge = {
        text: `🏃 วิ่งเร็ว +${pickProgVal(msProg)}`,
        badgeClass: msProg.badgeClass,
      };
    } else if (isTypeShield) {
      summaryBadge = {
        text: "🛡️ โล่ป้องกัน",
        badgeClass: CATEGORY_STYLES.shield.badgeClass,
      };
    } else if (isTypeHeal) {
      summaryBadge = {
        text: "💖 ฟื้นฟูเลือด",
        badgeClass: CATEGORY_STYLES.heal.badgeClass,
      };
    } else if (!hasDamage && isTypeDamageReduction) {
      summaryBadge = {
        text: "🛡️ ทนความเสียหาย",
        badgeClass: CATEGORY_STYLES.damage_reduction.badgeClass,
      };
    }
  }

  const isDefensiveOrBuffOnly = !hasDamage;

  return {
    isDefensiveOrBuffOnly,
    hasDamage,
    isDamageReductionSkill: isTypeDamageReduction || Boolean(drProg),
    isShieldSkill: isTypeShield || Boolean(shieldProg),
    isHealSkill: isTypeHeal || Boolean(healProg),
    isBuffSkill: !hasDamage && !isTypeShield && !isTypeHeal && !isTypeDamageReduction,
    baseValueType,
    progressions,
    highlights,
    summaryBadge,
  };
}

export interface InGameTableRow {
  code: string; // "DMG", "CD", "DEF Up", "DEF Down", "SLOW", "SPD Down", "SPD Up", "ATK SPD", "Shield", "Heal", "MANA"
  label: string; // Full Thai label e.g. "ดาเมจพื้นฐาน (Base DMG)"
  values: string[]; // ["120", "150", "180", "210", "240", "270"]
  colorClass: string;
}

export interface ExactHeroPassiveConfig {
  milestones: number[];
  rows: InGameTableRow[];
  highlights: SkillSpecialHighlight[];
  summaryBadgeText: (level: number) => string;
  badgeClass: string;
}

export function getExactHeroPassiveScaling(
  heroName: string,
  slot: string,
  skillName: string,
  _currentLevel: number = 1
): ExactHeroPassiveConfig | null {
  const isPassive = slot.startsWith("Passive") || slot === "Passive";
  const ms = [1, 4, 7, 10, 13, 15];

  // 1. Qi - Protection Aura
  if (heroName === "Qi" && (isPassive || skillName === "Protection Aura")) {
    return {
      milestones: ms,
      rows: [
        {
          code: "DEF Up",
          label: "เกราะ/ต้านเวท 1สแต็ก (3สแต็ก)",
          values: ms.map((lv) => {
            const p = 30 + 5 * (lv - 1);
            return `${p} (${p * 3})`;
          }),
          colorClass: "text-emerald-300 font-bold",
        },
        {
          code: "DMG",
          label: "ดาเมจพิเศษ (+25%AD)",
          values: ms.map((lv) => (30 + 5 * (lv - 1)).toString()),
          colorClass: "text-ink font-bold",
        },
        {
          code: "Heal",
          label: "ฟื้นฟูเลือด (Heal)",
          values: Array(6).fill("100"),
          colorClass: "text-green-300 font-bold",
        },
      ],
      highlights: [
        {
          icon: "shield",
          title: "เกราะ & ต้านเวท (+30-100 ต่อสแต็ก)",
          detail: "เพิ่ม 30 (+5 ต่อ Lv.ฮีโร่) เกราะและต้านเวท นาน 5 วิ (สะสมครบ 3 สแต็ก = 90 - 300 หน่วย)",
          badgeClass: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
        },
        {
          icon: "swords",
          title: "โจมตีพิเศษ & ฮีลเลือด (+100% ตีไว)",
          detail: "สกิลโดนศัตรู ตีไวขึ้น 100% 2 ครั้ง เสริมดาเมจ 30 (+5/Lv) (+25%AD) และฮีล 100 HP (สะสม 4 ครั้ง)",
          badgeClass: "border-amber-500/40 bg-amber-500/10 text-amber-400",
        },
      ],
      summaryBadgeText: (lv) => `🛡️ เกราะ/ต้านเวท ${(30 + 5 * (lv - 1)) * 3} (3สแต็ก) [Lv ${lv}]`,
      badgeClass: CATEGORY_STYLES.defense.badgeClass,
    };
  }

  // 2. Veres - Bloody Kiss
  if (heroName === "Veres" && (isPassive || skillName === "Bloody Kiss")) {
    return {
      milestones: ms,
      rows: [
        {
          code: "DMG",
          label: "ดาเมจรอบตัว (+175%AD)",
          values: ms.map((lv) => (300 + 25 * (lv - 1)).toString()),
          colorClass: "text-ink font-bold",
        },
        {
          code: "Heal",
          label: "ดูดเลือดพื้นฐาน (Base Lifesteal)",
          values: ms.map((lv) => `${(8.0 + (7.0 / 14) * (lv - 1)).toFixed(1)}%`),
          colorClass: "text-green-300 font-bold",
        },
      ],
      highlights: [
        {
          icon: "swords",
          title: "ดาเมจรอบตัว (+25 ต่อ Lv)",
          detail: "สร้างความเสียหายกายภาพ 300 (+25 ต่อ Lv.ฮีโร่) (+175%AD) แก่ศัตรูรอบๆ เมื่อสะสมครบ 4 ครั้ง",
          badgeClass: "border-[#ff9f43]/40 bg-[#ff9f43]/10 text-[#ff9f43]",
        },
        {
          icon: "heart",
          title: "ดูดเลือดพื้นฐาน (8% - 15%)",
          detail: "ดูดเลือดพื้นฐาน 8% (+0.5%/Lv, สูงสุด 15% ที่ Lv.15) และเพิ่มขึ้นตาม HP ที่เสียไป สูงสุด 10 เท่า (80% - 150%)",
          badgeClass: "border-green-500/40 bg-green-500/10 text-green-400",
        },
      ],
      summaryBadgeText: (lv) => `⚔️ ดาเมจ ${300 + 25 * (Math.min(15, Math.max(1, lv)) - 1)} [Lv ${Math.min(15, Math.max(1, lv))}]`,
      badgeClass: CATEGORY_STYLES.damage.badgeClass,
    };
  }

  // 3. Aleister - Wicked Plot
  if (heroName === "Aleister" && (isPassive || skillName === "Wicked Plot")) {
    return {
      milestones: ms,
      rows: [
        {
          code: "DMG",
          label: "ดาเมจจริง (+30%AP)",
          values: ms.map((lv) => (84 + 10 * (lv - 1)).toString()),
          colorClass: "text-ink font-bold",
        },
      ],
      highlights: [
        {
          icon: "zap",
          title: "ดาเมจจริงสายฟ้า (+10 ต่อ Lv)",
          detail: "สะสมคำสาปครบ 3 ครั้ง ระเบิดความเสียหายจริง 84 (+10 ต่อ Lv.ฮีโร่) (+30%AP)",
          badgeClass: "border-ink/40 bg-ink/10 text-ink",
        },
      ],
      summaryBadgeText: (lv) => `⚡ ดาเมจจริง ${84 + 10 * (lv - 1)} [Lv ${lv}]`,
      badgeClass: CATEGORY_STYLES.damage.badgeClass,
    };
  }

  // 4. Max - Static Shock
  if (heroName === "Max" && (isPassive || skillName === "Static Shock")) {
    return {
      milestones: ms,
      rows: [
        {
          code: "DMG",
          label: "ดาเมจจริง/วิ (+35%โบนัส AD)",
          values: ms.map((lv) => (70 + 5 * (lv - 1)).toString()),
          colorClass: "text-ink font-bold",
        },
        {
          code: "DEF Down",
          label: "ลดการฟื้นฟู (Anti-Heal)",
          values: Array(6).fill("40%"),
          colorClass: "text-amber-300 font-bold",
        },
      ],
      highlights: [
        {
          icon: "zap",
          title: "ดาเมจจริงช็อตไฟฟ้า (+5 ต่อ Lv)",
          detail: "สร้างความเสียหายจริง 70 (+5 ต่อ Lv.ฮีโร่) (+35% โบนัส AD) ต่อวินาที นาน 3 วิ",
          badgeClass: "border-ink/40 bg-ink/10 text-ink",
        },
        {
          icon: "target",
          title: "ตัดเลือดศัตรู 40%",
          detail: "ลดความสามารถฟื้นฟูเลือดของศัตรูลง 40% นาน 3 วิ (ไม่ทับซ้อนกับไอเทมตัดเลือด)",
          badgeClass: "border-amber-500/40 bg-amber-500/10 text-amber-400",
        },
      ],
      summaryBadgeText: (lv) => `⚡ ดาเมจจริง ${70 + 5 * (lv - 1)}/วิ [Lv ${lv}]`,
      badgeClass: CATEGORY_STYLES.damage.badgeClass,
    };
  }

  // 5. Murad - Rift
  if (heroName === "Murad" && (isPassive || skillName === "Rift")) {
    return {
      milestones: ms,
      rows: [
        {
          code: "DEF Down",
          label: "เจาะเกราะ (Pierce)",
          values: ms.map((lv) => Math.min(200, 60 + 10 * (lv - 1)).toString()),
          colorClass: "text-orange-300 font-bold",
        },
      ],
      highlights: [
        {
          icon: "target",
          title: "เจาะเกราะสะสม (+10 ต่อ Lv)",
          detail: "โจมตีปกติครบ 4 ครั้ง ได้รับเจาะเกราะ 60 (+10 ต่อ Lv.ฮีโร่ สูงสุด 200) และปลดล็อกอัลติเมท 5 วิ",
          badgeClass: "border-orange-500/40 bg-orange-500/10 text-orange-400",
        },
      ],
      summaryBadgeText: (lv) => `🎯 เจาะเกราะ ${Math.min(200, 60 + 10 * (lv - 1))} [Lv ${lv}]`,
      badgeClass: CATEGORY_STYLES.pierce.badgeClass,
    };
  }

  // 6. Taara - Fighting Spirit
  if (heroName === "Taara" && (isPassive || skillName === "Fighting Spirit")) {
    return {
      milestones: ms,
      rows: [
        {
          code: "DMG",
          label: "โบนัส AD ต่อ 1% เลือดที่เสีย",
          values: ms.map((lv) => (3.0 + (4.0 / 14) * (lv - 1)).toFixed(1)),
          colorClass: "text-gold font-bold",
        },
      ],
      highlights: [
        {
          icon: "swords",
          title: "ยิ่งเลือดยิ่งแรง (+0.29 AD/Lv)",
          detail: "เสียเลือด 1% ได้รับ 3.0 ถึง 7.0 โบนัส AD (+0.29 ต่อ Lv.ฮีโร่)",
          badgeClass: "border-gold/40 bg-gold/10 text-gold",
        },
      ],
      summaryBadgeText: (lv) => `⚔️ AD +${(3.0 + (4.0 / 14) * (lv - 1)).toFixed(1)}/1%HP [Lv ${lv}]`,
      badgeClass: CATEGORY_STYLES.ad_buff.badgeClass,
    };
  }

  // 7. Ormarr - Deterrence
  if (heroName === "Ormarr" && (isPassive || skillName === "Deterrence")) {
    return {
      milestones: ms,
      rows: [
        {
          code: "DMG",
          label: "ดาเมจเวท (% Max HP)",
          values: ms.map((lv) => `${(4.0 + (4.0 / 14) * (lv - 1)).toFixed(1)}%`),
          colorClass: "text-purple-300 font-bold",
        },
      ],
      highlights: [
        {
          icon: "zap",
          title: "สตั๊น & ดาเมจ % เลือดสูงสุด",
          detail: "ความเสียหายมีโอกาสติดสตั๊น 0.75 วิ และทำดาเมจเวท 4.0% (+0.29%/Lv สูงสุด 8.0%) ของ Max HP",
          badgeClass: "border-purple-500/40 bg-purple-500/10 text-purple-400",
        },
      ],
      summaryBadgeText: (lv) => `💥 ดาเมจ ${(4.0 + (4.0 / 14) * (lv - 1)).toFixed(1)}% HP [Lv ${lv}]`,
      badgeClass: CATEGORY_STYLES.damage.badgeClass,
    };
  }

  // 8. Kil'Groth - The Fanatic
  if (heroName === "Kil'Groth" && (isPassive || skillName === "The Fanatic")) {
    return {
      milestones: ms,
      rows: [
        {
          code: "ATK SPD",
          label: "ตีไว 1สแต็ก (5สแต็ก)",
          values: ms.map((lv) => {
            const one = 8.0 + (6.0 / 14) * (lv - 1);
            return `${one.toFixed(1)}% (${(one * 5).toFixed(1)}%)`;
          }),
          colorClass: "text-amber-300 font-bold",
        },
      ],
      highlights: [
        {
          icon: "zap",
          title: "เร่งความเร็วโจมตี (+0.43%/Lv)",
          detail: "ตีปกติเพิ่มความเร็วโจมตี 8.0% (+0.43%/Lv) ต่อสแต็ก สะสม 5 สแต็ก = 40% ถึง 70%",
          badgeClass: "border-amber-500/40 bg-amber-500/10 text-amber-400",
        },
      ],
      summaryBadgeText: (lv) =>
        `⚡ ตีไว +${((8.0 + (6.0 / 14) * (Math.min(15, Math.max(1, lv)) - 1)) * 5).toFixed(1)}% (5สแต็ก) [Lv ${Math.min(15, Math.max(1, lv))}]`,
      badgeClass: CATEGORY_STYLES.attack_speed.badgeClass,
    };
  }

  // 9. Lu Bu - Tyrant
  if (heroName === "Lu Bu" && (isPassive || skillName === "Tyrant")) {
    return {
      milestones: ms,
      rows: [
        {
          code: "ATK SPD",
          label: "เพิ่มความเร็วโจมตี (ATK SPD)",
          values: ms.map((lv) => `${(35.0 + (35.0 / 14) * (lv - 1)).toFixed(1)}%`),
          colorClass: "text-amber-300 font-bold",
        },
      ],
      highlights: [
        {
          icon: "zap",
          title: "คลื่นดาบตีไว (+2.5%/Lv)",
          detail: "ใช้สกิลแล้วตีปกติเปลี่ยนเป็นคลื่นดาบ เพิ่มตีไว +35% (+2.5%/Lv สูงสุด 70%) สะสม 5 ครั้ง",
          badgeClass: "border-amber-500/40 bg-amber-500/10 text-amber-400",
        },
      ],
      summaryBadgeText: (lv) => `⚡ ตีไว +${(35.0 + (35.0 / 14) * (lv - 1)).toFixed(1)}% [Lv ${lv}]`,
      badgeClass: CATEGORY_STYLES.attack_speed.badgeClass,
    };
  }

  // 10. Lauriel - Divine Punishment
  if (heroName === "Lauriel" && (isPassive || skillName === "Divine Punishment")) {
    return {
      milestones: ms,
      rows: [
        {
          code: "SLOW",
          label: "สโลว์ศัตรู (Slow)",
          values: ms.map((lv) => `${(50.0 + (40.0 / 14) * (lv - 1)).toFixed(1)}%`),
          colorClass: "text-indigo-300 font-bold",
        },
        {
          code: "DMG",
          label: "ดาเมจจริง (+50%AP)",
          values: Array(6).fill("160"),
          colorClass: "text-ink font-bold",
        },
        {
          code: "Heal",
          label: "ฟื้นฟูเลือด (+1%โบนัส HP)",
          values: Array(6).fill("140"),
          colorClass: "text-green-300 font-bold",
        },
      ],
      highlights: [
        {
          icon: "target",
          title: "สโลว์มหาศาล (+2.86%/Lv)",
          detail: "ระเบิดสัญลักษณ์ สโลว์ศัตรู 50% (+2.86%/Lv สูงสุด 90%) 1 วิ พร้อมดาเมจจริง 160 และฮีล 140",
          badgeClass: "border-indigo-500/40 bg-indigo-500/10 text-indigo-400",
        },
      ],
      summaryBadgeText: (lv) => `❄️ สโลว์ ${(50.0 + (40.0 / 14) * (lv - 1)).toFixed(1)}% [Lv ${lv}]`,
      badgeClass: CATEGORY_STYLES.slow.badgeClass,
    };
  }

  // 11. Ata - Child of the Sea
  if (heroName === "Ata" && (isPassive || skillName === "Child of the Sea")) {
    return {
      milestones: ms,
      rows: [
        {
          code: "DMG",
          label: "โบนัสดาเมจตีปกติ (+1% Max HP)",
          values: ms.map((lv) => (28 + 2 * (lv - 1)).toString()),
          colorClass: "text-ink font-bold",
        },
      ],
      highlights: [
        {
          icon: "swords",
          title: "โบนัสดาเมจตีปกติ (+2 ต่อ Lv)",
          detail: "โจมตีปกติสร้างโบนัสดาเมจกายภาพ 28 (+2 ต่อ Lv.ฮีโร่) (+1% Max HP)",
          badgeClass: "border-[#ff9f43]/40 bg-[#ff9f43]/10 text-[#ff9f43]",
        },
      ],
      summaryBadgeText: (lv) => `⚔️ ดาเมจ ${28 + 2 * (lv - 1)} [Lv ${lv}]`,
      badgeClass: CATEGORY_STYLES.damage.badgeClass,
    };
  }

  // 12. Chaugnar - Faithful Herald
  if (heroName === "Chaugnar" && (isPassive || skillName === "Faithful Herald")) {
    return {
      milestones: ms,
      rows: [
        {
          code: "SPD Up",
          label: "เพิ่มความเร็วเคลื่อนที่ (SPD Up)",
          values: ms.map((lv) => `${(6.0 + (4.0 / 14) * (lv - 1)).toFixed(1)}%`),
          colorClass: "text-cyan-300 font-bold",
        },
      ],
      highlights: [
        {
          icon: "speed",
          title: "วิ่งเร็วขึ้น (+0.29%/Lv)",
          detail: "เพิ่มความเร็วเคลื่อนที่ 6.0% (+0.29% ต่อ Lv.ฮีโร่ สูงสุด 10.0%)",
          badgeClass: "border-cyan-500/40 bg-cyan-500/10 text-cyan-400",
        },
      ],
      summaryBadgeText: (lv) => `🏃 วิ่งเร็ว +${(6.0 + (4.0 / 14) * (lv - 1)).toFixed(1)}% [Lv ${lv}]`,
      badgeClass: CATEGORY_STYLES.move_speed.badgeClass,
    };
  }

  // 13. Errol - Blood Drinker
  if (heroName === "Errol" && (isPassive || skillName === "Blood Drinker")) {
    return {
      milestones: ms,
      rows: [
        {
          code: "ATK SPD",
          label: "ตีไว 1สแต็ก (5สแต็ก)",
          values: ms.map((lv) => {
            const one = 7.0 + (7.0 / 14) * (lv - 1);
            return `${one.toFixed(1)}% (${(one * 5).toFixed(1)}%)`;
          }),
          colorClass: "text-amber-300 font-bold",
        },
      ],
      highlights: [
        {
          icon: "zap",
          title: "ตีไวคลั่ง (+0.5%/Lv)",
          detail: "สัญลักษณ์แต่ละอันเพิ่มตีไว 7.0% (+0.5%/Lv) สะสม 5 อัน = 35% ถึง 70% และดูดเลือด 3.5%",
          badgeClass: "border-amber-500/40 bg-amber-500/10 text-amber-400",
        },
      ],
      summaryBadgeText: (lv) =>
        `⚡ ตีไว +${((7.0 + (7.0 / 14) * (Math.min(15, Math.max(1, lv)) - 1)) * 5).toFixed(1)}% (5สแต็ก) [Lv ${Math.min(15, Math.max(1, lv))}]`,
      badgeClass: CATEGORY_STYLES.attack_speed.badgeClass,
    };
  }

  // 14. Stuart - Drain Charge
  if (heroName === "Stuart" && (isPassive || skillName === "Drain Charge")) {
    return {
      milestones: ms,
      rows: [
        {
          code: "ATK SPD",
          label: "เพิ่มความเร็วโจมตี (ATK SPD)",
          values: ms.map((lv) => `${(50.0 + (30.0 / 14) * (lv - 1)).toFixed(1)}%`),
          colorClass: "text-amber-300 font-bold",
        },
        {
          code: "SPD Up",
          label: "เพิ่มความเร็วเคลื่อนที่ (SPD Up)",
          values: ms.map((lv) => `${(20.0 + (10.0 / 14) * (lv - 1)).toFixed(1)}%`),
          colorClass: "text-cyan-300 font-bold",
        },
      ],
      highlights: [
        {
          icon: "zap",
          title: "สถานะเสริมพลัง ตีไว & วิ่งเร็ว",
          detail: "ตีไว +50% (+2.14%/Lv สูงสุด 80%) และวิ่งเร็ว +20% (+0.71%/Lv สูงสุด 30%) นาน 6 วิ",
          badgeClass: "border-amber-500/40 bg-amber-500/10 text-amber-400",
        },
      ],
      summaryBadgeText: (lv) => `⚡ ตีไว +${(50.0 + (30.0 / 14) * (lv - 1)).toFixed(1)}% [Lv ${lv}]`,
      badgeClass: CATEGORY_STYLES.attack_speed.badgeClass,
    };
  }

  // 15. Sephera - Living Water
  if (heroName === "Sephera" && (isPassive || skillName === "Living Water")) {
    return {
      milestones: ms,
      rows: [
        {
          code: "Heal",
          label: "ฟื้นฟูเลือดพันธมิตร (+10% AP)",
          values: ms.map((lv) => (50 + 5 * (lv - 1)).toString()),
          colorClass: "text-green-300 font-bold",
        },
      ],
      highlights: [
        {
          icon: "heart",
          title: "ฟื้นฟูเลือดพันธมิตร (+5 ต่อ Lv)",
          detail: "ใช้สกิลแล้วฟื้นฟูเลือดให้เพื่อนที่เลือดน้อยสุด 50 (+5 ต่อ Lv.ฮีโร่) (+10% AP)",
          badgeClass: "border-green-500/40 bg-green-500/10 text-green-400",
        },
      ],
      summaryBadgeText: (lv) => `💖 ฮีล ${50 + 5 * (lv - 1)} [Lv ${lv}]`,
      badgeClass: CATEGORY_STYLES.heal.badgeClass,
    };
  }

  // 16. Bright - The Holy Soul Returns (Melee Bonus)
  if (heroName === "Bright" && (slot === "Ultimate" || skillName === "The Holy Soul Returns")) {
    return {
      milestones: ms,
      rows: [
        {
          code: "DMG",
          label: "โบนัสดาเมจตีใกล้ (Melee Bonus)",
          values: ms.map((lv) => (18 + 3 * (lv - 1)).toString()),
          colorClass: "text-ink font-bold",
        },
      ],
      highlights: [
        {
          icon: "swords",
          title: "ตีใกล้โบนัสดาเมจ (+3 ต่อ Lv)",
          detail: "ขณะเปิดอัลติเมท ตีปกติระยะใกล้สร้างโบนัสความเสียหายกายภาพ 18 (+3 ต่อ Lv.ฮีโร่ สูงสุด 60)",
          badgeClass: "border-[#ff9f43]/40 bg-[#ff9f43]/10 text-[#ff9f43]",
        },
      ],
      summaryBadgeText: (lv) => `⚔️ ตีใกล้ +${18 + 3 * (lv - 1)} [Lv ${lv}]`,
      badgeClass: CATEGORY_STYLES.damage.badgeClass,
    };
  }

  // 17. Tamyn - Shadow Devourer
  if (heroName === "Tamyn" && (isPassive || skillName === "Shadow Devourer")) {
    return {
      milestones: ms,
      rows: [
        {
          code: "DMG",
          label: "โบนัสดาเมจ (+28% โบนัส AD)",
          values: ms.map((lv) => (182 + 13 * (lv - 1)).toString()),
          colorClass: "text-ink font-bold",
        },
        {
          code: "Heal",
          label: "ฟื้นฟูเลือด (+2% โบนัส HP)",
          values: ms.map((lv) => (100 + 7 * (lv - 1)).toString()),
          colorClass: "text-green-300 font-bold",
        },
      ],
      highlights: [
        {
          icon: "swords",
          title: "หอกศักดิ์สิทธิ์ (+13 ต่อ Lv)",
          detail: "โจมตีพิเศษสร้างโบนัสดาเมจ 182 (+13 ต่อ Lv) (+28% โบนัส AD) ลด CD สกิล 1 วิ",
          badgeClass: "border-[#ff9f43]/40 bg-[#ff9f43]/10 text-[#ff9f43]",
        },
        {
          icon: "heart",
          title: "ฟื้นฟูเลือด (+7 ต่อ Lv)",
          detail: "เก็บหอกฟื้นฟู 100 (+7 ต่อ Lv) (+2% โบนัส HP) โจมตีพิเศษโดนฮีล x2",
          badgeClass: "border-green-500/40 bg-green-500/10 text-green-400",
        },
      ],
      summaryBadgeText: (lv) => `⚔️ ดาเมจ ${182 + 13 * (lv - 1)} [Lv ${lv}]`,
      badgeClass: CATEGORY_STYLES.damage.badgeClass,
    };
  }

  // 18. Flowborn (Mage)
  if (heroName === "Flowborn (Mage)" && isPassive) {
    return {
      milestones: ms,
      rows: [
        {
          code: "DMG",
          label: "โบนัส AP ในบ่อน้ำพุ",
          values: ms.map((lv) => (50 + 4 * (lv - 1)).toString()),
          colorClass: "text-purple-300 font-bold",
        },
      ],
      highlights: [
        {
          icon: "sparkles",
          title: "โบนัส AP ในบ่อ (+4 ต่อ Lv)",
          detail: "ได้รับพลังเวทในบ่อน้ำพุ 50 (+4 ต่อ Lv.ฮีโร่ สูงสุด 106 AP)",
          badgeClass: "border-purple-500/40 bg-purple-500/10 text-purple-400",
        },
      ],
      summaryBadgeText: (lv) => `✨ AP +${50 + 4 * (lv - 1)} [Lv ${lv}]`,
      badgeClass: CATEGORY_STYLES.ap_buff.badgeClass,
    };
  }

  // 19. Flowborn (Marksman)
  if (heroName === "Flowborn (Marksman)" && isPassive) {
    return {
      milestones: ms,
      rows: [
        {
          code: "ATK SPD",
          label: "เพิ่มความเร็วโจมตี (ATK SPD)",
          values: ms.map((lv) => `${(10.0 + (9.9 / 14) * (lv - 1)).toFixed(1)}%`),
          colorClass: "text-amber-300 font-bold",
        },
      ],
      highlights: [
        {
          icon: "zap",
          title: "โบนัสตีไวในบ่อ (+0.71%/Lv)",
          detail: "ได้รับความเร็วโจมตีในบ่อน้ำพุ 10.0% (+0.71% ต่อ Lv.ฮีโร่ สูงสุด 19.9%)",
          badgeClass: "border-amber-500/40 bg-amber-500/10 text-amber-400",
        },
      ],
      summaryBadgeText: (lv) => `⚡ ตีไว +${(10.0 + (9.9 / 14) * (lv - 1)).toFixed(1)}% [Lv ${lv}]`,
      badgeClass: CATEGORY_STYLES.attack_speed.badgeClass,
    };
  }

  // 20. Omega
  if (heroName === "Omega") {
    if (slot === "Skill 1" || skillName === "Vanguard Mode") {
      return {
        milestones: ms,
        rows: [
          {
            code: "SPD Up",
            label: "โบนัสความเร็วเคลื่อนที่ (+2.5%/Lv)",
            values: ms.map((lv) => `${(5.0 + 2.5 * (lv - 1)).toFixed(1)}%`),
            colorClass: "text-cyan-300 font-bold",
          },
        ],
        highlights: [
          {
            icon: "zap",
            title: "เร่งความเร็ว Vanguard (+2.5%/Lv)",
            detail: "ขณะเปิดสกิล 1 ได้รับความเร็วเคลื่อนที่เพิ่ม 5.0% (+2.5% ต่อ Lv.ฮีโร่ สูงสุด 40.0%)",
            badgeClass: CATEGORY_STYLES.move_speed.badgeClass,
          },
        ],
        summaryBadgeText: (lv) =>
          `⚡ วิ่งเร็ว +${(5.0 + 2.5 * (Math.min(15, Math.max(1, lv)) - 1)).toFixed(1)}% [Lv ${Math.min(15, Math.max(1, lv))}]`,
        badgeClass: CATEGORY_STYLES.move_speed.badgeClass,
      };
    }
    if (isPassive || skillName === "Surviving Memory") {
      return {
        milestones: ms,
        rows: [
          {
            code: "DMG",
            label: "โบนัสดาเมจใส่ครีป (+6%โบนัส HP)",
            values: ms.map((lv) => (150 + 10 * (lv - 1)).toString()),
            colorClass: "text-ink font-bold",
          },
        ],
        highlights: [
          {
            icon: "swords",
            title: "โบนัสดาเมจครีป (+10 ต่อ Lv)",
            detail: "โจมตีพิเศษสร้างโบนัส 150 (+10 ต่อ Lv.ฮีโร่) (+6% โบนัส HP) ใส่ครีป และสตั๊นป้อม 2 วิ",
            badgeClass: "border-[#ff9f43]/40 bg-[#ff9f43]/10 text-[#ff9f43]",
          },
        ],
        summaryBadgeText: (lv) =>
          `💥 ดาเมจครีป ${150 + 10 * (Math.min(15, Math.max(1, lv)) - 1)} [Lv ${Math.min(15, Math.max(1, lv))}]`,
        badgeClass: CATEGORY_STYLES.damage.badgeClass,
      };
    }
  }

  return null;
}

export function getSlotCircledNumber(slot: string): string {
  if (slot.startsWith("Passive")) return "Ⓟ";
  if (slot === "Skill 1" || slot.startsWith("Skill 1")) return "①";
  if (slot === "Skill 2" || slot.startsWith("Skill 2")) return "②";
  if (slot === "Skill 3" || slot.startsWith("Skill 3")) return "③";
  if (slot === "Skill 4" || slot.startsWith("Skill 4")) return "④";
  if (slot === "Skill 5" || slot.startsWith("Skill 5")) return "⑤";
  if (slot === "Ultimate" || slot.startsWith("Ultimate")) return "③";
  return "①";
}

export function getInGameTagCapsules(skill: SkillLike): Array<{ label: string; bg: string; text: string; border: string }> {
  const list: Array<{ label: string; bg: string; text: string; border: string }> = [];
  const dtype = skill.damage_type;
  const stype = (skill.type ?? "").toLowerCase();
  const desc = (skill.desc_th ?? skill.description ?? "").toLowerCase();

  // Primary damage type pill
  if (dtype === "physical") {
    list.push({ label: "กายภาพ", bg: "bg-[#7c2d2d]/80", text: "text-[#fca5a5]", border: "border-[#ef4444]/50" });
  } else if (dtype === "magic") {
    list.push({ label: "เวท", bg: "bg-[#581c87]/80", text: "text-[#d8b4fe]", border: "border-[#a855f7]/50" });
  } else if (dtype === "true") {
    list.push({ label: "ความเสียหายจริง", bg: "bg-slate-700/80", text: "text-white font-bold", border: "border-slate-400/60" });
  }

  // Effect pills based on in-game screenshots
  if (stype.includes("damage reduction") || desc.includes("ลดความเสียหาย") || desc.includes("ทนความเสียหาย")) {
    list.push({ label: "ลดความเสียหาย", bg: "bg-[#115e59]/80", text: "text-[#5eead4]", border: "border-[#14b8a6]/50" });
  }
  if (stype.includes("speed") || desc.includes("ความเร็วเคลื่อนที่") || desc.includes("วิ่งเร็ว")) {
    list.push({ label: "เพิ่มความเร็ว", bg: "bg-[#1e3a8a]/80", text: "text-[#93c5fd]", border: "border-[#3b82f6]/50" });
  }
  if (stype.includes("control") || stype.includes("stun") || stype.includes("restrict") || desc.includes("ควบคุม") || desc.includes("สตั๊น") || desc.includes("ดึง")) {
    list.push({ label: "ควบคุม", bg: "bg-[#164e63]/80", text: "text-[#67e8f9]", border: "border-[#06b6d4]/50" });
  }
  if (stype.includes("heal") || desc.includes("ฟื้นฟู") || desc.includes("รักษา")) {
    list.push({ label: "ฟื้นฟู", bg: "bg-[#14532d]/80", text: "text-[#86efac]", border: "border-[#22c55e]/50" });
  }
  if (stype.includes("shield") || desc.includes("โล่") || desc.includes("เกราะป้องกัน")) {
    list.push({ label: "โล่ป้องกัน", bg: "bg-[#075985]/80", text: "text-[#7dd3fc]", border: "border-[#0ea5e9]/50" });
  }
  if (stype.includes("damage up") || desc.includes("ลดเกราะ") || desc.includes("เพิ่มความเสียหาย")) {
    list.push({ label: "เพิ่มความเสียหาย", bg: "bg-[#065f46]/80", text: "text-[#6ee7b7]", border: "border-[#10b981]/50" });
  }

  return list.filter((item, index, self) => index === self.findIndex((t) => t.label === item.label));
}

export function getInGameSkillRows(
  skill: SkillLike,
  profile: ParsedSkillProfile,
  maxLevels: number,
  heroName?: string
): InGameTableRow[] {
  const rows: InGameTableRow[] = [];
  const bd = skill.base_damage ?? [];
  const cdArr = Array.isArray(skill.cooldown) ? skill.cooldown : skill.cooldown ? [skill.cooldown] : [];
  const manaArr = Array.isArray(skill.mana_cost) ? skill.mana_cost : skill.mana_cost ? [skill.mana_cost] : [];
  const isPassiveSlot = skill.slot.startsWith("Passive") || skill.slot === "Passive";

  // Exact hero passive level scaling profiles (e.g. Qi, Veres, Aleister, Max, Murad, Taara, etc.)
  if (heroName) {
    const exact = getExactHeroPassiveScaling(heroName, skill.slot, skill.name);
    if (exact && isPassiveSlot) {
      return exact.rows.map((r) => ({ ...r, values: [...r.values] }));
    }
  } else if (skill.name === "Protection Aura" || (isPassiveSlot && skill.desc_th?.includes("Aura"))) {
    const exact = getExactHeroPassiveScaling("Qi", skill.slot, skill.name);
    if (exact && isPassiveSlot) {
      return exact.rows.map((r) => ({ ...r, values: [...r.values] }));
    }
  }

  // 1. DMG or Shield or Heal primary row
  if (profile.baseValueType === "shield" && bd.length > 0) {
    rows.push({
      code: "Shield",
      label: "โล่ป้องกัน (Shield)",
      values: bd.map((v) => v.toLocaleString()),
      colorClass: "text-sky-300 font-bold",
    });
  } else if (profile.baseValueType === "heal" && bd.length > 0) {
    rows.push({
      code: "Heal",
      label: "ฟื้นฟูเลือด (Heal)",
      values: bd.map((v) => v.toLocaleString()),
      colorClass: "text-green-300 font-bold",
    });
  } else if (bd.length > 0 && bd.some((v) => v > 0)) {
    rows.push({
      code: "DMG",
      label: "ดาเมจพื้นฐาน (Base DMG)",
      values: bd.map((v) => v.toLocaleString()),
      colorClass: "text-ink font-bold",
    });
  }

  // 2. DEF Up row (Damage reduction like Omen S2)
  const drProg = profile.progressions.find((p) => p.category === "damage_reduction");
  if (drProg) {
    rows.push({
      code: "DEF Up",
      label: "ลดความเสียหาย (DEF Up)",
      values: [...drProg.values],
      colorClass: "text-emerald-300 font-bold",
    });
  }

  // 3. DEF Down row (Armor reduction like Qi S2)
  const defDownProg = profile.progressions.find(
    (p) => p.category === "defense" && (skill.desc_th?.includes("ลดเกราะ") || skill.description?.includes("reducing"))
  );
  if (defDownProg) {
    rows.push({
      code: "DEF Down",
      label: "ลดเกราะศัตรู (DEF Down)",
      values: [...defDownProg.values],
      colorClass: "text-amber-300 font-bold",
    });
  }

  // 4. SLOW row (duration like Omen S1: 1.5, 1.7, 1.9, 2.1, 2.3, 2.5)
  const isSlowContext = Boolean(
    skill.desc_th?.includes("สโลว์") ||
      skill.desc_th?.includes("ลดความเร็ว") ||
      skill.description?.toLowerCase().includes("slow")
  );
  const slowDurProg = profile.progressions.find(
    (p) =>
      p.category === "duration" ||
      (isSlowContext &&
        !p.values.some((v) => v.includes("%")) &&
        p.values.some((v) => v === "1.5" || v === "2.5" || v.endsWith("วิ")))
  );
  if (slowDurProg) {
    rows.push({
      code: isSlowContext ? "SLOW" : "Duration",
      label: isSlowContext ? "ระยะเวลาสโลว์ (SLOW)" : "ระยะเวลา (Duration)",
      values: [...slowDurProg.values],
      colorClass: isSlowContext ? "text-indigo-300 font-bold" : "text-sky-300 font-mono",
    });
  }

  // 5. SPD Down row (Movement speed slow % like Omen S1: 25%, 30%, 35%, 40%, 45%, 50%)
  const spdDownProg = profile.progressions.find((p) => p.category === "slow");
  if (spdDownProg) {
    rows.push({
      code: "SPD Down",
      label: "สโลว์ความเร็ว (SPD Down)",
      values: [...spdDownProg.values],
      colorClass: "text-indigo-300 font-bold",
    });
  }

  // 6. SPD Up row (Movement speed boost % like Celica S1)
  const spdUpProg = profile.progressions.find((p) => p.category === "move_speed");
  if (spdUpProg) {
    rows.push({
      code: "SPD Up",
      label: "เพิ่มความเร็ว (SPD Up)",
      values: [...spdUpProg.values],
      colorClass: "text-cyan-300 font-bold",
    });
  }

  // 7. ATK SPD row (Attack speed % like Erin S2)
  const atkSpdProg = profile.progressions.find((p) => p.category === "attack_speed");
  if (atkSpdProg) {
    rows.push({
      code: "ATK SPD",
      label: "เพิ่มความเร็วโจมตี (ATK SPD)",
      values: [...atkSpdProg.values],
      colorClass: "text-amber-300 font-bold",
    });
  }

  // 8. Shield row if not added yet
  const shieldProg = profile.progressions.find((p) => p.category === "shield");
  if (shieldProg && !rows.some((r) => r.code === "Shield")) {
    rows.push({
      code: "Shield",
      label: "โล่ป้องกัน (Shield)",
      values: [...shieldProg.values],
      colorClass: "text-sky-300 font-bold",
    });
  }

  // 9. Heal row if not added yet
  const healProg = profile.progressions.find((p) => p.category === "heal");
  if (healProg && !rows.some((r) => r.code === "Heal")) {
    rows.push({
      code: "Heal",
      label: "ฟื้นฟูเลือด (Heal)",
      values: [...healProg.values],
      colorClass: "text-green-300 font-bold",
    });
  }

  // 10. Cooldown row (CD)
  if (cdArr.length > 0) {
    rows.push({
      code: "CD",
      label: "คูลดาวน์ (CD)",
      values: cdArr.map((v) => (Number.isInteger(v) ? v.toString() : v.toFixed(1))),
      colorClass: "text-muted font-mono",
    });
  }

  // 11. Mana cost row (MANA)
  if (manaArr.length > 0 && Math.max(...manaArr) > 0 && (new Set(manaArr).size > 1 || rows.length <= 2)) {
    rows.push({
      code: "MANA",
      label: "การใช้มานา (MANA)",
      values: manaArr.map((v) => v.toString()),
      colorClass: "text-blue-300 font-mono",
    });
  }

  // Pad rows if any row has fewer elements than maxLevels
  for (const row of rows) {
    if (row.values.length < maxLevels && row.values.length > 0) {
      row.values = [...row.values];
      const lastVal = row.values[row.values.length - 1];
      while (row.values.length < maxLevels) {
        row.values.push(lastVal);
      }
    }
  }

  return rows;
}

export interface TextToken {
  text: string;
  className?: string;
}

export function tokenizeThaiSkillDescription(desc: string): TextToken[] {
  if (!desc) return [];
  const regex = /(ความเสียหายกายภาพ|ความเสียหายเวท|ความเสียหายจริง|\(\+[\d.]+%?\s*(?:AD|AP|HP|Bonus AD|Max HP)\)|\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?\s*วิ)/g;
  const tokens: TextToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(desc)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: desc.slice(lastIndex, match.index) });
    }
    const val = match[1];
    let className = "text-ink font-semibold";
    if (val === "ความเสียหายกายภาพ") {
      className = "text-[#ff6b6b] font-bold";
    } else if (val === "ความเสียหายเวท") {
      className = "text-[#c084fc] font-bold";
    } else if (val === "ความเสียหายจริง") {
      className = "text-white font-black underline decoration-slate-400";
    } else if (val.includes("AD")) {
      className = "text-amber-300 font-bold";
    } else if (val.includes("AP")) {
      className = "text-cyan-300 font-bold";
    } else if (val.includes("HP")) {
      className = "text-green-300 font-bold";
    } else if (val.includes("%") || val.includes("วิ")) {
      className = "text-white font-semibold";
    }
    tokens.push({ text: val, className });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < desc.length) {
    tokens.push({ text: desc.slice(lastIndex) });
  }

  return tokens;
}

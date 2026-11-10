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
export function parseSkillEffects(skill: SkillLike, heroName?: string): ParsedSkillProfile {
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

  // Summary badge for quick cards
  let summaryBadge: { text: string; badgeClass: string } | undefined;
  const drProg = progressions.find((p) => p.category === "damage_reduction");
  const shieldProg = progressions.find((p) => p.category === "shield");
  const healProg = progressions.find((p) => p.category === "heal");
  const asProg = progressions.find((p) => p.category === "attack_speed");
  const msProg = progressions.find((p) => p.category === "move_speed");
  const pierceProg = progressions.find((p) => p.category === "pierce");
  const adProg = progressions.find((p) => p.category === "ad_buff");

  if (drProg) {
    const f = drProg.values[0];
    const l = drProg.values[drProg.values.length - 1];
    summaryBadge = {
      text: `🛡️ ลดดาเมจ ${f}-${l}`,
      badgeClass: drProg.badgeClass,
    };
  } else if (shieldProg) {
    const f = shieldProg.values[0];
    const l = shieldProg.values[shieldProg.values.length - 1];
    summaryBadge = {
      text: `🛡️ โล่ ${f}-${l}`,
      badgeClass: shieldProg.badgeClass,
    };
  } else if (healProg) {
    const f = healProg.values[0];
    const l = healProg.values[healProg.values.length - 1];
    summaryBadge = {
      text: `💖 ฟื้นฟู ${f}-${l}`,
      badgeClass: healProg.badgeClass,
    };
  } else if (asProg) {
    const f = asProg.values[0];
    const l = asProg.values[asProg.values.length - 1];
    summaryBadge = {
      text: `⚡ ตีเร็ว +${f}-${l}`,
      badgeClass: asProg.badgeClass,
    };
  } else if (pierceProg) {
    const f = pierceProg.values[0];
    const l = pierceProg.values[pierceProg.values.length - 1];
    summaryBadge = {
      text: `🎯 เจาะเกราะ ${f}-${l}`,
      badgeClass: pierceProg.badgeClass,
    };
  } else if (adProg) {
    const f = adProg.values[0];
    const l = adProg.values[adProg.values.length - 1];
    summaryBadge = {
      text: `⚔️ AD +${f}-${l}`,
      badgeClass: adProg.badgeClass,
    };
  } else if (msProg) {
    const f = msProg.values[0];
    const l = msProg.values[msProg.values.length - 1];
    summaryBadge = {
      text: `🏃 วิ่งเร็ว +${f}-${l}`,
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
  maxLevels: number
): InGameTableRow[] {
  const rows: InGameTableRow[] = [];
  const bd = skill.base_damage ?? [];
  const cdArr = Array.isArray(skill.cooldown) ? skill.cooldown : skill.cooldown ? [skill.cooldown] : [];
  const manaArr = Array.isArray(skill.mana_cost) ? skill.mana_cost : skill.mana_cost ? [skill.mana_cost] : [];

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
      values: drProg.values,
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
      values: defDownProg.values,
      colorClass: "text-amber-300 font-bold",
    });
  }

  // 4. SLOW row (duration like Omen S1: 1.5, 1.7, 1.9, 2.1, 2.3, 2.5)
  const slowDurProg = profile.progressions.find(
    (p) => p.category === "duration" || p.values.some((v) => v.includes("1.5") || v.includes("2.5"))
  );
  if (slowDurProg) {
    rows.push({
      code: "SLOW",
      label: "ระยะเวลาสโลว์ (SLOW)",
      values: slowDurProg.values,
      colorClass: "text-indigo-300 font-bold",
    });
  }

  // 5. SPD Down row (Movement speed slow % like Omen S1: 25%, 30%, 35%, 40%, 45%, 50%)
  const spdDownProg = profile.progressions.find((p) => p.category === "slow");
  if (spdDownProg) {
    rows.push({
      code: "SPD Down",
      label: "สโลว์ความเร็ว (SPD Down)",
      values: spdDownProg.values,
      colorClass: "text-indigo-300 font-bold",
    });
  }

  // 6. SPD Up row (Movement speed boost % like Celica S1)
  const spdUpProg = profile.progressions.find((p) => p.category === "move_speed");
  if (spdUpProg) {
    rows.push({
      code: "SPD Up",
      label: "เพิ่มความเร็ว (SPD Up)",
      values: spdUpProg.values,
      colorClass: "text-cyan-300 font-bold",
    });
  }

  // 7. ATK SPD row (Attack speed % like Erin S2)
  const atkSpdProg = profile.progressions.find((p) => p.category === "attack_speed");
  if (atkSpdProg) {
    rows.push({
      code: "ATK SPD",
      label: "เพิ่มความเร็วโจมตี (ATK SPD)",
      values: atkSpdProg.values,
      colorClass: "text-amber-300 font-bold",
    });
  }

  // 8. Shield row if not added yet
  const shieldProg = profile.progressions.find((p) => p.category === "shield");
  if (shieldProg && !rows.some((r) => r.code === "Shield")) {
    rows.push({
      code: "Shield",
      label: "โล่ป้องกัน (Shield)",
      values: shieldProg.values,
      colorClass: "text-sky-300 font-bold",
    });
  }

  // 9. Heal row if not added yet
  const healProg = profile.progressions.find((p) => p.category === "heal");
  if (healProg && !rows.some((r) => r.code === "Heal")) {
    rows.push({
      code: "Heal",
      label: "ฟื้นฟูเลือด (Heal)",
      values: healProg.values,
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

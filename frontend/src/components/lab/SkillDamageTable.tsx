import { type Translate, useLanguage } from "../../i18n/language";
import { StableButtonLabel } from "../StableButtonLabel";
import { ChevronDown, ChevronUp, Clock, Droplet, Heart, Shield, Sparkles, Swords, Target, Wind, Zap } from "lucide-react";
import { useState } from "react";
import { resolveScalingValue, type CombatBuild, type DuelSide, type ScalingValue, type SkillDamageRow } from "../../types/combat";
import { getFormBadge } from "../../utils/heroForms";
import { parseSkillEffects } from "../../utils/skillEffects";

interface SkillDamageTableProps {
  side: DuelSide;
  build: CombatBuild;
  enemyName: string;
  onChange: (patch: Partial<CombatBuild>) => void;
}

const TYPE_STYLE: Record<SkillDamageRow["damage_type"], string> = {
  physical: "text-[#ff9f43]",
  magic: "text-[#b07cff]",
  true: "text-ink",
  none: "text-dim",
};

const TYPE_LABELS: Record<SkillDamageRow["damage_type"], string> = {
  physical: "กายภาพ",
  magic: "เวท",
  true: "จริง",
  none: "สถานะ",
};

const COMPONENT_LABELS: Record<string, string> = {
  base: "พื้นฐาน",
  ad: "AD",
  bonus_ad: "Bonus AD",
  as_to_ad: "AS→AD",
  ap: "AP",
  own_hp: "HP ตัวเอง",
  armor: "เกราะ",
  target_hp: "HP เป้า",
  target_current_hp: "HP ปัจจุบันเป้า",
  target_lost_hp: "HP ที่หายเป้า",
  extra: "เพิ่มเติม",
};

function formatScalingFormula(t: Translate, scaling?: Record<string, ScalingValue>, skillLevel = 1): string {
  if (!scaling) return "";
  const v = (key: string) => resolveScalingValue(scaling[key], skillLevel);
  const parts: string[] = [];
  if (v("ad_pct")) parts.push(`+${v("ad_pct")}% AD`);
  if (v("bonus_ad_pct")) parts.push(`+${v("bonus_ad_pct")}% Bonus AD`);
  if (v("as_to_ad")) parts.push(`+${v("as_to_ad")} AD/1% Bonus AS`);
  if (v("ap_pct")) parts.push(`+${v("ap_pct")}% AP`);
  if (v("bonus_ap_pct")) parts.push(`+${v("bonus_ap_pct")}% Bonus AP`);
  if (v("bonus_dmg_hp_pct")) parts.push(t("+{0}% Max HP ตัวเอง", v("bonus_dmg_hp_pct")));
  else if (v("own_hp_pct")) parts.push(t("+{0}% HP ตัวเอง", v("own_hp_pct")));
  else if (v("hp_pct")) parts.push(`+${v("hp_pct")}% HP`);
  else if (v("max_hp_pct")) parts.push(`+${v("max_hp_pct")}% Max HP`);
  if (v("bonus_hp_pct") || v("bonus_max_hp_pct")) {
    parts.push(`+${v("bonus_hp_pct") + v("bonus_max_hp_pct")}% Bonus HP`);
  }
  if (v("burn_max_hp_pct")) parts.push(t("เผา +{0}% Max HP/วิ", v("burn_max_hp_pct")));
  if (v("bonus_armor_pct")) parts.push(`+${v("bonus_armor_pct")}% Bonus Armor`);
  if (v("armor_pct")) parts.push(t("+{0}% เกราะ", v("armor_pct")));
  if (v("magic_defense_pct")) parts.push(t("+{0}% ต้านเวท", v("magic_defense_pct")));
  const tgtHp = v("target_hp_pct") + v("target_max_hp_pct") + v("target_current_hp_pct");
  if (tgtHp) parts.push(t("+{0}% HP ศัตรู", tgtHp));
  if (v("target_hp_ap_pct")) parts.push(t("+{0}% HP ศัตรู/100 AP", v("target_hp_ap_pct")));
  const lostHp = v("target_lost_hp_pct") + v("lost_hp_pct");
  if (lostHp) parts.push(t("+{0}% HP ที่หายไปศัตรู", lostHp));
  if (v("lost_hp_ap_pct")) parts.push(t("+{0}% HP ที่หายไปศัตรู/100 AP", v("lost_hp_ap_pct")));
  if (v("lost_hp_bonus_ad_pct")) parts.push(t("+{0}% HP ที่หายไปศัตรู/100 Bonus AD", v("lost_hp_bonus_ad_pct")));
  if (v("target_hp_per_100_ad_pct")) parts.push(t("+{0}% HP ศัตรู/100 AD", v("target_hp_per_100_ad_pct")));
  if (v("target_hp_per_100_bonus_ad_pct")) {
    parts.push(t("+{0}% HP ศัตรู/100 Bonus AD", v("target_hp_per_100_bonus_ad_pct")));
  }
  if (v("target_hp_per_100_ap_pct")) parts.push(t("+{0}% HP ศัตรู/100 AP", v("target_hp_per_100_ap_pct")));
  if (v("level_scaling")) parts.push(`+${v("level_scaling")}/Lv`);
  return parts.join(" ");
}

export function SkillDamageTable({ side, build, enemyName, onChange }: SkillDamageTableProps) {
  const { language, t } = useLanguage();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [draftHits, setDraftHits] = useState<Record<string, string>>({});
  const [draftLevels, setDraftLevels] = useState<Record<string, string>>({});
  const [failedIcons, setFailedIcons] = useState<Record<string, boolean>>({});

  const setNum = (key: "skill_levels" | "skill_hits", slot: string, v: number) =>
    onChange({ [key]: { ...build[key], [slot]: v } });

  const toggleExpand = (slot: string) => {
    setExpanded((prev) => ({ ...prev, [slot]: !prev[slot] }));
  };

  const isAllExpanded = side.skills.length > 0 && side.skills.every((s) => expanded[s.slot]);

  const toggleAll = () => {
    if (isAllExpanded) {
      setExpanded({});
    } else {
      const all: Record<string, boolean> = {};
      for (const s of side.skills) all[s.slot] = true;
      setExpanded(all);
    }
  };

  const isDamagingSlot = (s: SkillDamageRow) =>
    s.damage_type !== "none" && (!s.slot.startsWith("Passive") || s.final_damage > 0 || s.raw_damage > 0);
  const allActiveSlots = side.skills.filter(isDamagingSlot).map((s) => s.slot);
  const defaultComboSlots = side.skills
    .filter((s) => s.damage_type !== "none" && !s.slot.startsWith("Passive"))
    .map((s) => s.slot);

  const isSlotInCombo = (slot: string) => {
    if (build.active_combo_slots != null) {
      return build.active_combo_slots.includes(slot);
    }
    return defaultComboSlots.includes(slot);
  };

  const toggleSlotInCombo = (slot: string) => {
    const currentSlots = build.active_combo_slots != null
      ? [...build.active_combo_slots]
      : defaultComboSlots;
    const next = currentSlots.includes(slot)
      ? currentSlots.filter((s) => s !== slot)
      : [...currentSlots, slot];
    onChange({ active_combo_slots: next });
  };

  const setCharge = (slot: string, ratio: number) => {
    onChange({ skill_charges: { ...build.skill_charges, [slot]: ratio } });
  };

  const setComboPreset = (slots: string[]) => {
    onChange({ active_combo_slots: slots });
  };

  const presets = (() => {
    if (build.hero === "Yena") {
      return [
        { label: "ดาบคู่ + Passive", slots: ["Skill 1", "Skill 2", "Ultimate", "Passive"] },
        { label: "ดาบคู่", slots: ["Skill 1", "Skill 2", "Ultimate"] },
        { label: "รวมดาบ", slots: ["Skill 3", "Skill 4", "Skill 5"] },
        { label: "2 ร่างเต็ม", slots: ["Skill 1", "Skill 2", "Ultimate", "Skill 3", "Skill 4", "Skill 5", "Passive"] },
        { label: "ล้าง", slots: [] },
      ];
    }
    if (build.hero === "Liliana") {
      return [
        { label: "ร่างมนุษย์", slots: ["Skill 1", "Skill 2", "Skill 3"] },
        { label: "ร่างจิ้งจอก", slots: ["Skill 4", "Skill 5", "Ultimate"] },
        { label: "2 ร่างเต็ม", slots: ["Skill 1", "Skill 2", "Skill 3", "Skill 4", "Skill 5", "Ultimate"] },
        { label: "ล้าง", slots: [] },
      ];
    }
    if (build.hero === "Edras") {
      return [
        { label: "Demolisher", slots: ["Skill 1", "Skill 2", "Ultimate"] },
        { label: "Berserker", slots: ["Skill 2 (Berserker Mode)", "Ultimate (Berserker Mode)", "Passive (Berserker Mode)"] },
        { label: "2 ร่างเต็ม", slots: allActiveSlots },
        { label: "ล้าง", slots: [] },
      ];
    }
    return [
      { label: "เลือกทั้งหมด", slots: allActiveSlots },
      { label: "ล้างทั้งหมด", slots: [] },
    ];
  })();

  const selectedCount = allActiveSlots.filter(isSlotInCombo).length;

  return (
    <div className="border border-line bg-panel p-3 rounded-lg">
      {/* Header */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1 border-b border-line/60 pb-2">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-xs font-bold tracking-wider text-ink">{t("ดาเมจสกิลใส่")} {enemyName}</h3>
          <span className="font-mono text-[10px] text-dim">
            {t("ตีปกติ")} {side.basic_attack.final_per_hit.toLocaleString()}{t("/ครั้ง · DPS")} {side.basic_attack.dps.toLocaleString()}
          </span>
        </div>

        <button
          type="button"
          onClick={toggleAll}
          className="flex items-center gap-1 rounded border border-line/60 bg-bg px-2 py-0.5 text-[10px] font-medium text-dim transition-colors hover:border-gold hover:text-gold"
        >
          {isAllExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          <StableButtonLabel
            message={isAllExpanded ? "ซ่อนคำอธิบายสกิล" : "อ่านรายละเอียดสกิล"}
            alternatives={["ซ่อนคำอธิบายสกิล", "อ่านรายละเอียดสกิล"]}
          />
        </button>
      </div>

      {/* Quick Combo Presets & Form Toggles */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-1.5 rounded border border-line/50 bg-bg/40 px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 text-[10px] text-muted">
          <Swords size={11} className="text-gold" />
          <span>{t("เซ็ตคอมโบ:")}</span>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {presets.map((p) => {
            const isMatch =
              p.slots.length === 0
                ? build.active_combo_slots != null && build.active_combo_slots.length === 0
                : p.slots.length === selectedCount && p.slots.every(isSlotInCombo);

            return (
              <button
                key={p.label}
                type="button"
                onClick={() => setComboPreset(p.slots)}
                className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                  isMatch
                    ? "border-gold bg-gold/20 font-bold text-gold ring-1 ring-gold/40"
                    : "border-line/60 bg-panel text-muted hover:border-line hover:text-ink"
                }`}
              >
                <StableButtonLabel message={p.label} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[490px] text-xs">
          <thead>
            <tr className="text-left text-[10px] text-dim border-b border-line/50">
              <th className="pb-1.5 font-normal text-center w-7" title={t("เลือกสกิลที่จะนับในคอมโบ")}>{t("คอมโบ")}</th>
              <th className="pb-1.5 font-normal">{t("สกิล")}</th>
              <th className="pb-1.5 font-normal text-center">Lv</th>
              <th className="pb-1.5 font-normal text-center">{t("โดน")}</th>
              <th className="pb-1.5 text-right font-normal">{t("ดิบ")}</th>
              <th className="pb-1.5 text-right font-normal">{t("เข้าจริง")}</th>
              <th className="pb-1.5 text-right font-normal">%HP</th>
              <th className="pb-1.5 text-right font-normal">CD</th>
            </tr>
          </thead>
          <tbody>
            {side.skills.map((s) => {
              const isExp = !!expanded[s.slot];
              const inCombo = isSlotInCombo(s.slot);
              const isPassive = s.slot.startsWith("Passive");
              const badge = getFormBadge(build.hero, s.slot);
              const skillProfile = parseSkillEffects(t, s, build.hero, build.level, s.skill_level);
              const drProg = skillProfile.progressions.find((p) => p.category === "damage_reduction");
              const shieldProg = skillProfile.progressions.find((p) => p.category === "shield");
              const healProg = skillProfile.progressions.find((p) => p.category === "heal");
              const isUnlearned = !isPassive && s.skill_level === 0;
              const currentDrVal =
                drProg && !isUnlearned
                  ? drProg.values[Math.min(Math.max(0, s.skill_level - 1), drProg.values.length - 1)]
                  : null;
              const currentShieldVal =
                shieldProg && !isUnlearned
                  ? shieldProg.values[Math.min(Math.max(0, s.skill_level - 1), shieldProg.values.length - 1)]
                  : null;
              const currentHealVal =
                healProg && !isUnlearned
                  ? healProg.values[Math.min(Math.max(0, s.skill_level - 1), healProg.values.length - 1)]
                  : null;
              const parts = Object.entries(s.components)
                .filter(([, v]) => v)
                .map(([k, v]) => `${t(COMPONENT_LABELS[k] ?? k)} ${v.toLocaleString()}`)
                .join(" + ");
              const scalingText = formatScalingFormula(t, s.scaling, Math.max(1, s.skill_level));

              return (
                <tr
                  key={s.slot}
                  className={`border-t border-line/50 align-top transition-colors ${
                    isDamagingSlot(s) && !inCombo ? "opacity-50 bg-bg/10" : ""
                  }`}
                >
                  <td colSpan={8} className="p-0">
                    <div className="flex items-center p-1.5 hover:bg-panel-2/40 transition-colors">
                      {/* Combo Checkbox */}
                      <div className="w-7 shrink-0 text-center">
                        {!isDamagingSlot(s) ? (
                          <span className="text-dim text-[10px]">—</span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={inCombo}
                            onChange={() => toggleSlotInCombo(s.slot)}
                            className="h-3.5 w-3.5 rounded border border-line bg-bg accent-gold cursor-pointer"
                            aria-label={t("นับ {0} ในคอมโบ", s.name)}
                            title={inCombo ? t("คลิกเพื่อนำออกจากคอมโบ") : t("คลิกเพื่อนับในคอมโบ")}
                          />
                        )}
                      </div>

                      {/* Skill icon & name */}
                      <div className="flex-1 min-w-0 pr-2">
                        <div className="flex items-center gap-2">
                          {s.icon_url && !failedIcons[s.icon_url] ? (
                            <img
                              key={s.icon_url}
                              src={s.icon_url}
                              alt={s.name}
                              className="h-8 w-8 shrink-0 rounded object-contain border border-line/70 bg-bg p-0.5"
                              onError={() => {
                                if (s.icon_url) {
                                  const iconUrl = s.icon_url;
                                  setFailedIcons((prev) => ({ ...prev, [iconUrl]: true }));
                                }
                              }}
                            />
                          ) : (
                            <div className="grid h-8 w-8 shrink-0 place-items-center rounded border border-line bg-bg text-[10px] font-bold text-dim">
                              {s.slot[0]}
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => toggleExpand(s.slot)}
                                className="group flex min-w-0 max-w-full items-center gap-1 text-left"
                              >
                                <span className={`min-w-0 truncate font-bold transition-colors group-hover:underline ${TYPE_STYLE[s.damage_type]}`}>
                                  {s.name}
                                </span>
                                {isExp ? (
                                  <ChevronUp size={12} className="shrink-0 text-gold" />
                                ) : (
                                  <ChevronDown size={12} className="shrink-0 text-dim group-hover:text-gold" />
                                )}
                              </button>
                              {badge && (
                                <span title={t(badge.label)} className={`min-w-0 truncate rounded border px-1 py-0.5 font-mono text-[9px] font-semibold ${badge.style}`}>
                                  {t(badge.label)}
                                </span>
                              )}
                              {skillProfile.summaryBadge && (
                                <span title={skillProfile.summaryBadge.text} className={`min-w-0 truncate rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold ${skillProfile.summaryBadge.badgeClass}`}>
                                  {skillProfile.summaryBadge.text}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-dim">
                              {s.slot} · {t(TYPE_LABELS[s.damage_type] ?? s.damage_type)}
                              {parts && ` · ${parts}`}
                              {s.mitigation_multiplier > 0 && s.mitigation_multiplier < 1 && ` · ×${s.mitigation_multiplier}`}
                            </div>
                            {s.has_charge && (
                              <div className="flex items-center gap-1.5 mt-1">
                                <span className="text-[10px] text-gold font-medium">{t("ชาร์จ:")}</span>
                                <input
                                  type="range"
                                  min={0}
                                  max={1}
                                  step={0.05}
                                  value={build.skill_charges?.[s.slot] ?? s.charge_ratio ?? 0}
                                  onChange={(e) => setCharge(s.slot, Number.parseFloat(e.target.value))}
                                  className="h-1.5 w-16 accent-gold cursor-pointer"
                                  title={t("ระยะเวลาชาร์จ {0}%", Math.round((build.skill_charges?.[s.slot] ?? s.charge_ratio ?? 0) * 100))}
                                />
                                <span className="font-mono text-[9px] text-gold">
                                  {Math.round((build.skill_charges?.[s.slot] ?? s.charge_ratio ?? 0) * 100)}%
                                </span>
                              </div>
                            )}
                            {s.warnings.map((w) => (
                              <div key={w} className="text-[10px] text-gold break-words">
                                {t(w)}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Inputs & Stats in aligned grid */}
                      <div className="flex items-center gap-2 shrink-0 font-mono text-xs">
                        {/* Level Input */}
                        <div className="w-10 text-center">
                          {isPassive ? (
                            <span className="text-dim">—</span>
                          ) : (
                            (() => {
                              const levelKey = s.level_slot || s.slot;
                              const isUlt = levelKey === "Ultimate" || s.base_damage?.length === 3;
                              const maxLv = isUlt ? 3 : 6;
                              return (
                                <input
                                  type="number"
                                  min={0}
                                  max={maxLv}
                                  value={draftLevels[levelKey] ?? String(s.skill_level)}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    setDraftLevels((prev) => ({ ...prev, [levelKey]: raw }));
                                    if (raw === "") return;
                                    const parsed = Number(raw);
                                    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= maxLv) {
                                      setNum("skill_levels", levelKey, parsed);
                                    }
                                  }}
                                  onBlur={() => {
                                    const raw = draftLevels[levelKey];
                                    setDraftLevels((prev) => {
                                      const next = { ...prev };
                                      delete next[levelKey];
                                      return next;
                                    });
                                    if (raw === undefined) return;
                                    const parsed = Math.round(Number(raw));
                                    if (Number.isFinite(parsed) && raw.trim() !== "") {
                                      const clamped = Math.max(0, Math.min(maxLv, parsed));
                                      if (clamped !== s.skill_level) setNum("skill_levels", levelKey, clamped);
                                    }
                                  }}
                                  className="w-10 rounded border border-line bg-bg px-1 py-0.5 text-center font-mono focus:border-gold outline-none"
                                  aria-label={t("เลเวล {0}", s.name)}
                                />
                              );
                            })()
                          )}
                        </div>

                        {/* Hits Input */}
                        <div className="w-10 text-center">
                          <input
                            type="number"
                            min={1}
                            max={50}
                            value={draftHits[s.slot] ?? String(s.hits)}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setDraftHits((prev) => ({ ...prev, [s.slot]: raw }));
                              if (raw === "") return;
                              const parsed = Number(raw);
                              if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 50) {
                                setNum("skill_hits", s.slot, parsed);
                              }
                            }}
                            onBlur={() => {
                              const raw = draftHits[s.slot];
                              setDraftHits((prev) => {
                                const next = { ...prev };
                                delete next[s.slot];
                                return next;
                              });
                              if (raw === undefined) return;
                              const parsed = Math.round(Number(raw));
                              if (Number.isFinite(parsed) && raw.trim() !== "") {
                                const clamped = Math.max(1, Math.min(50, parsed));
                                if (clamped !== s.hits) setNum("skill_hits", s.slot, clamped);
                              }
                            }}
                            className="w-10 rounded border border-line bg-bg px-1 py-0.5 text-center font-mono focus:border-gold outline-none"
                            aria-label={t("จำนวนครั้งที่โดน {0}", s.name)}
                          />
                        </div>

                        {/* Raw Damage */}
                        <div className="w-14 text-right text-muted tabular-nums">
                          {isUnlearned ? (
                            <span className="text-dim">—</span>
                          ) : s.raw_damage > 0 ? (
                            s.raw_damage.toLocaleString()
                          ) : currentDrVal ? (
                            <span className="text-emerald-400 font-semibold" title={t("ทน/ลดความเสียหาย")}>
                              {t("ลด")} {currentDrVal}
                            </span>
                          ) : currentShieldVal ? (
                            <span className="text-sky-400 font-semibold" title={t("โล่ป้องกัน")}>
                              {t("โล่")} {currentShieldVal}
                            </span>
                          ) : currentHealVal ? (
                            <span className="text-green-400 font-semibold" title={t("ฟื้นฟูเลือด")}>
                              {t("ฮีล")} {currentHealVal}
                            </span>
                          ) : (
                            "0"
                          )}
                        </div>

                        {/* Final Damage */}
                        <div className="w-16 text-right font-bold text-ink tabular-nums">
                          {isUnlearned ? (
                            <span className="text-dim">—</span>
                          ) : s.final_damage > 0 ? (
                            s.final_damage.toLocaleString()
                          ) : currentDrVal ? (
                            <span className="text-emerald-400 font-bold" title={t("ทน/ลดความเสียหาย")}>
                              {t("ลด")} {currentDrVal}
                            </span>
                          ) : currentShieldVal ? (
                            <span className="text-sky-400 font-bold" title={t("โล่ป้องกัน")}>
                              {t("โล่")} {currentShieldVal}
                            </span>
                          ) : currentHealVal ? (
                            <span className="text-green-400 font-bold" title={t("ฟื้นฟูเลือด")}>
                              {t("ฮีล")} {currentHealVal}
                            </span>
                          ) : (
                            "0"
                          )}
                        </div>

                        {/* % HP */}
                        <div className="w-12 text-right text-dim tabular-nums">
                          {isUnlearned ? (
                            <span className="text-dim">—</span>
                          ) : s.pct_target_hp > 0 ? (
                            `${s.pct_target_hp}%`
                          ) : currentDrVal ? (
                            <span className="text-emerald-400/80 font-mono text-[10px]">{t("บัฟทน")}</span>
                          ) : currentShieldVal ? (
                            <span className="text-sky-400/80 font-mono text-[10px]">{t("เกราะ")}</span>
                          ) : currentHealVal ? (
                            <span className="text-green-400/80 font-mono text-[10px]">{t("ฟื้นฟู")}</span>
                          ) : (
                            "0%"
                          )}
                        </div>

                        {/* Cooldown */}
                        <div className="w-12 text-right text-muted tabular-nums">
                          {s.cooldown || "—"}
                        </div>
                      </div>
                    </div>

                    {/* Expandable Skill Details Card */}
                    {isExp && (
                      <div className="border-t border-line/40 bg-panel-2/70 p-3 space-y-2 text-xs">
                        {/* Highlights Grid */}
                        {skillProfile.highlights.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {skillProfile.highlights.map((h, i) => (
                              <div key={i} className={`flex items-start gap-2 rounded-lg border p-2 text-xs ${h.badgeClass}`}>
                                <div className="mt-0.5 shrink-0">
                                  {h.icon === "shield" && <Shield size={13} />}
                                  {h.icon === "heart" && <Heart size={13} />}
                                  {h.icon === "speed" && <Wind size={13} />}
                                  {h.icon === "zap" && <Zap size={13} />}
                                  {h.icon === "swords" && <Swords size={13} />}
                                  {h.icon === "target" && <Target size={13} />}
                                  {h.icon === "clock" && <Clock size={13} />}
                                  {h.icon === "sparkles" && <Sparkles size={13} />}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-bold leading-tight">{h.title}</div>
                                  <div className="text-[11px] leading-tight opacity-90 mt-0.5">{h.detail}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/50 pb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] font-bold text-gold">{s.slot}</span>
                            {badge && (
                              <span className={`rounded border px-1 py-0.5 font-mono text-[9px] font-semibold ${badge.style}`}>
                                {t(badge.label)}
                              </span>
                            )}
                            <span className={`text-[10px] font-semibold ${TYPE_STYLE[s.damage_type]}`}>
                              {t("ความเสียหาย:")} {s.damage_type}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 font-mono text-[11px]">
                            {s.cooldown > 0 && (
                              <div className="flex items-center gap-1 text-dim" title={t("คูลดาวน์")}>
                                <Clock size={11} className="text-muted" />
                                <span>
                                  {t("คูลดาวน์:")} <strong className="text-ink">{s.cooldown}{t("วิ")}</strong>
                                  {s.base_cooldown && s.base_cooldown !== s.cooldown && (
                                    <span className="text-dim text-[10px]"> {t("(พื้นฐาน")} {s.base_cooldown}{t("วิ)")}</span>
                                  )}
                                </span>
                              </div>
                            )}

                            {s.mana_cost != null && s.mana_cost > 0 && (
                              <div className="flex items-center gap-1 text-blue" title={t("การใช้มานา")}>
                                <Droplet size={11} />
                                <span>{t("มานา:")} {s.mana_cost}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Skill description from the selected language, with the other as a fallback. */}
                        {(language === "th" ? s.desc_th : s.description || s.desc_th) && (
                          <div className="rounded border border-line/60 bg-bg/50 p-2 text-ink leading-relaxed">
                            <div className="flex items-center gap-1 mb-0.5 text-[10px] font-bold text-gold">
                              <Sparkles size={10} />
                              <span>{t("รายละเอียดสกิล:")}</span>
                            </div>
                            <p className="text-muted whitespace-pre-line">{language === "th" ? s.desc_th : s.description || s.desc_th}</p>
                          </div>
                        )}

                        {/* Charging Details if applicable */}
                        {s.has_charge && (
                          <div className="rounded border border-gold/40 bg-gold/10 p-2 text-gold font-mono text-[11px] space-y-1">
                            <div className="font-bold flex items-center gap-1">
                              <Sparkles size={11} />
                              <span>{t("ระบบชาร์จ / สเกลตามระยะ:")}</span>
                            </div>
                            {(() => {
                              const lvIdx = Math.max(0, s.skill_level - 1);
                              return (
                                <>
                                  <div className="text-[10px] text-ink">
                                    {t("ดาเมจต่ำสุด (0%):")}{" "}
                                    <span className="font-bold">
                                      {s.base_damage ? s.base_damage[lvIdx] ?? s.base_damage[0] : 0}
                                    </span>{" "}
                                    {scalingText}
                                  </div>
                                  {s.max_damage && (
                                    <div className="text-[10px] text-ink">
                                      {t("ดาเมจสูงสุด (100%):")}{" "}
                                      <span className="font-bold">
                                        {s.max_damage[lvIdx] ?? s.max_damage[0]}
                                      </span>{" "}
                                      {formatScalingFormula(t, s.max_scaling, Math.max(1, s.skill_level))}
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        )}

                        {/* Formulas & Components Breakdown */}
                        <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[11px]">
                          {scalingText && (
                            <span className="rounded bg-panel px-2 py-0.5 text-gold border border-gold/30">
                              {t("สูตรคำนวณ:")} {scalingText}
                            </span>
                          )}
                          {s.mitigation_multiplier > 0 && s.mitigation_multiplier < 1 && (
                            <span className="rounded bg-panel px-2 py-0.5 text-muted border border-line">
                              {t("เกราะศัตรูลดทอนเหลือ:")} {(s.mitigation_multiplier * 100).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Burst Combo Summary */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1 border-t border-line/60 pt-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted">{t("คอมโบสกิลที่เลือก")}</span>
          <span className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-gold border border-line/60">
            {selectedCount} {t("สกิล")}
          </span>
          {side.burst_per_1000_gold != null && (
            <span className="font-mono text-[10px] text-dim">
              ({side.burst_per_1000_gold.toLocaleString()} {t("ดาเมจ/1k ทอง)")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className={`font-mono font-bold ${side.combo_kills ? "text-good" : "text-ink"}`}>
            {side.burst_combo.toLocaleString()} ({side.burst_pct_enemy_hp}%)
          </span>
          {side.combo_kills && (
            <span className="rounded bg-good/20 px-1.5 py-0.5 text-[10px] font-bold text-good border border-good/40">
              {t("ปิดจบได้ในคอมโบเดียว")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

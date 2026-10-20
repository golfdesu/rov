import { ChevronDown, ChevronUp, Clock, Droplet, Sparkles, Swords } from "lucide-react";
import { useState } from "react";
import type { CombatBuild, DuelSide, SkillDamageRow } from "../../types/combat";

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

const COMPONENT_LABELS: Record<string, string> = {
  base: "พื้นฐาน",
  ad: "AD",
  bonus_ad: "Bonus AD",
  ap: "AP",
  own_hp: "HP ตัวเอง",
  armor: "เกราะ",
  target_hp: "HP เป้า",
};

function formatScalingFormula(scaling?: Record<string, number>): string {
  if (!scaling) return "";
  const parts: string[] = [];
  if (scaling.ad_pct) parts.push(`+${scaling.ad_pct}% AD`);
  if (scaling.bonus_ad_pct) parts.push(`+${scaling.bonus_ad_pct}% Bonus AD`);
  if (scaling.ap_pct) parts.push(`+${scaling.ap_pct}% AP`);
  if (scaling.bonus_ap_pct) parts.push(`+${scaling.bonus_ap_pct}% Bonus AP`);
  if (scaling.own_hp_pct) parts.push(`+${scaling.own_hp_pct}% HP ตัวเอง`);
  if (scaling.hp_pct) parts.push(`+${scaling.hp_pct}% HP`);
  if (scaling.max_hp_pct) parts.push(`+${scaling.max_hp_pct}% Max HP`);
  if (scaling.bonus_hp_pct || scaling.bonus_max_hp_pct) {
    parts.push(`+${(scaling.bonus_hp_pct ?? 0) + (scaling.bonus_max_hp_pct ?? 0)}% Bonus HP`);
  }
  if (scaling.bonus_armor_pct) parts.push(`+${scaling.bonus_armor_pct}% Bonus Armor`);
  const tgtHp =
    (scaling.target_hp_pct ?? 0) + (scaling.target_max_hp_pct ?? 0) + (scaling.target_current_hp_pct ?? 0);
  if (tgtHp) parts.push(`+${tgtHp}% HP ศัตรู`);
  if (scaling.target_hp_per_100_ad_pct) parts.push(`+${scaling.target_hp_per_100_ad_pct}% HP ศัตรู/100 AD`);
  if (scaling.target_hp_per_100_bonus_ad_pct) {
    parts.push(`+${scaling.target_hp_per_100_bonus_ad_pct}% HP ศัตรู/100 Bonus AD`);
  }
  if (scaling.target_hp_per_100_ap_pct) parts.push(`+${scaling.target_hp_per_100_ap_pct}% HP ศัตรู/100 AP`);
  return parts.join(" ");
}

function getFormBadge(hero: string, slot: string): { label: string; style: string } | null {
  if (hero === "Yena") {
    if (["Skill 1", "Skill 2", "Ultimate"].includes(slot)) {
      return { label: "ดาบคู่", style: "border-[#48dbfb]/40 bg-[#48dbfb]/10 text-[#48dbfb]" };
    }
    if (["Skill 3", "Skill 4", "Skill 5"].includes(slot)) {
      return { label: "รวมดาบ", style: "border-[#ff9f43]/40 bg-[#ff9f43]/10 text-[#ff9f43]" };
    }
    if (slot === "Passive 2") {
      return { label: "รวมดาบ", style: "border-[#ff9f43]/40 bg-[#ff9f43]/10 text-[#ff9f43]" };
    }
  }
  if (hero === "Liliana") {
    if (["Skill 1", "Skill 2"].includes(slot)) {
      return { label: "มนุษย์", style: "border-[#48dbfb]/40 bg-[#48dbfb]/10 text-[#48dbfb]" };
    }
    if (["Skill 4", "Skill 5"].includes(slot)) {
      return { label: "จิ้งจอก", style: "border-[#ff9f43]/40 bg-[#ff9f43]/10 text-[#ff9f43]" };
    }
    if (slot === "Ultimate" || slot === "Skill 3") {
      return { label: "สลับร่าง", style: "border-gold/40 bg-gold/10 text-gold" };
    }
  }
  if (hero === "Edras") {
    if (slot.includes("Berserker")) {
      return { label: "Berserker", style: "border-[#ff9f43]/40 bg-[#ff9f43]/10 text-[#ff9f43]" };
    }
    return { label: "Demolisher", style: "border-[#48dbfb]/40 bg-[#48dbfb]/10 text-[#48dbfb]" };
  }
  return null;
}

export function SkillDamageTable({ side, build, enemyName, onChange }: SkillDamageTableProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

  const isDamagingSlot = (s: SkillDamageRow) => !s.slot.startsWith("Passive") || s.final_damage > 0 || s.raw_damage > 0;
  const allActiveSlots = side.skills.filter(isDamagingSlot).map((s) => s.slot);

  const isSlotInCombo = (slot: string) => {
    if (build.active_combo_slots != null) {
      return build.active_combo_slots.includes(slot);
    }
    return !slot.startsWith("Passive");
  };

  const toggleSlotInCombo = (slot: string) => {
    const currentSlots = build.active_combo_slots != null
      ? [...build.active_combo_slots]
      : side.skills.filter((s) => !s.slot.startsWith("Passive")).map((s) => s.slot);
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
          <h3 className="font-display text-xs font-bold tracking-wider text-ink">ดาเมจสกิลใส่ {enemyName}</h3>
          <span className="font-mono text-[10px] text-dim">
            ตีปกติ {side.basic_attack.final_per_hit.toLocaleString()}/ครั้ง · DPS {side.basic_attack.dps.toLocaleString()}
          </span>
        </div>

        <button
          type="button"
          onClick={toggleAll}
          className="flex items-center gap-1 rounded border border-line/60 bg-bg px-2 py-0.5 text-[10px] font-medium text-dim transition-colors hover:border-gold hover:text-gold"
        >
          {isAllExpanded ? (
            <>
              <ChevronUp size={11} />
              <span>ซ่อนคำอธิบายสกิล</span>
            </>
          ) : (
            <>
              <ChevronDown size={11} />
              <span>อ่านรายละเอียดสกิล</span>
            </>
          )}
        </button>
      </div>

      {/* Quick Combo Presets & Form Toggles */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-1.5 rounded border border-line/50 bg-bg/40 px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 text-[10px] text-muted">
          <Swords size={11} className="text-gold" />
          <span>เซ็ตคอมโบ:</span>
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
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[490px] text-xs">
          <thead>
            <tr className="text-left text-[10px] text-dim border-b border-line/50">
              <th className="pb-1.5 font-normal text-center w-7" title="เลือกสกิลที่จะนับในคอมโบ">คอมโบ</th>
              <th className="pb-1.5 font-normal">สกิล</th>
              <th className="pb-1.5 font-normal text-center">Lv</th>
              <th className="pb-1.5 font-normal text-center">โดน</th>
              <th className="pb-1.5 text-right font-normal">ดิบ</th>
              <th className="pb-1.5 text-right font-normal">เข้าจริง</th>
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
              const parts = Object.entries(s.components)
                .filter(([, v]) => v)
                .map(([k, v]) => `${COMPONENT_LABELS[k] ?? k} ${v.toLocaleString()}`)
                .join(" + ");
              const scalingText = formatScalingFormula(s.scaling);

              return (
                <tr
                  key={s.slot}
                  className={`border-t border-line/50 align-top transition-colors ${
                    !isPassive && !inCombo ? "opacity-50 bg-bg/10" : ""
                  }`}
                >
                  <td colSpan={8} className="p-0">
                    <div className="flex items-center p-1.5 hover:bg-panel-2/40 transition-colors">
                      {/* Combo Checkbox */}
                      <div className="w-7 shrink-0 text-center">
                        {isPassive && !isDamagingSlot(s) ? (
                          <span className="text-dim text-[10px]">—</span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={inCombo}
                            onChange={() => toggleSlotInCombo(s.slot)}
                            className="h-3.5 w-3.5 rounded border border-line bg-bg accent-gold cursor-pointer"
                            aria-label={`นับ ${s.name} ในคอมโบ`}
                            title={inCombo ? "คลิกเพื่อนำออกจากคอมโบ" : "คลิกเพื่อนับในคอมโบ"}
                          />
                        )}
                      </div>

                      {/* Skill icon & name */}
                      <div className="flex-1 min-w-0 pr-2">
                        <div className="flex items-center gap-2">
                          {s.icon_url ? (
                            <img
                              src={s.icon_url}
                              alt={s.name}
                              className="h-8 w-8 shrink-0 rounded object-contain border border-line/70 bg-bg p-0.5"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
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
                                className="group flex items-center gap-1 text-left"
                              >
                                <span className={`font-bold transition-colors group-hover:underline ${TYPE_STYLE[s.damage_type]}`}>
                                  {s.name}
                                </span>
                                {isExp ? (
                                  <ChevronUp size={12} className="text-gold" />
                                ) : (
                                  <ChevronDown size={12} className="text-dim group-hover:text-gold" />
                                )}
                              </button>
                              {badge && (
                                <span className={`rounded border px-1 py-0.2 font-mono text-[9px] font-semibold ${badge.style}`}>
                                  {badge.label}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-dim">
                              {s.slot} · {s.damage_type}
                              {parts && ` · ${parts}`}
                              {s.mitigation_multiplier > 0 && s.mitigation_multiplier < 1 && ` · ×${s.mitigation_multiplier}`}
                            </div>
                            {s.has_charge && (
                              <div className="flex items-center gap-1.5 mt-1">
                                <span className="text-[10px] text-gold font-medium">ชาร์จ:</span>
                                <input
                                  type="range"
                                  min={0}
                                  max={1}
                                  step={0.05}
                                  value={build.skill_charges?.[s.slot] ?? s.charge_ratio ?? 0}
                                  onChange={(e) => setCharge(s.slot, Number.parseFloat(e.target.value))}
                                  className="h-1.5 w-16 accent-gold cursor-pointer"
                                  title={`ระยะเวลาชาร์จ ${Math.round((build.skill_charges?.[s.slot] ?? s.charge_ratio ?? 0) * 100)}%`}
                                />
                                <span className="font-mono text-[9px] text-gold">
                                  {Math.round((build.skill_charges?.[s.slot] ?? s.charge_ratio ?? 0) * 100)}%
                                </span>
                              </div>
                            )}
                            {s.warnings.map((w) => (
                              <div key={w} className="text-[10px] text-gold">
                                {w}
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
                            <input
                              type="number"
                              min={0}
                              max={s.slot === "Ultimate" || s.base_damage?.length === 3 ? 3 : 6}
                              value={s.skill_level}
                              onChange={(e) => setNum("skill_levels", s.slot, Number(e.target.value))}
                              className="w-10 rounded border border-line bg-bg px-1 py-0.5 text-center font-mono focus:border-gold outline-none"
                              aria-label={`เลเวล ${s.name}`}
                            />
                          )}
                        </div>

                        {/* Hits Input */}
                        <div className="w-10 text-center">
                          <input
                            type="number"
                            min={1}
                            max={30}
                            value={s.hits}
                            onChange={(e) => setNum("skill_hits", s.slot, Number(e.target.value))}
                            className="w-10 rounded border border-line bg-bg px-1 py-0.5 text-center font-mono focus:border-gold outline-none"
                            aria-label={`จำนวนครั้งที่โดน ${s.name}`}
                          />
                        </div>

                        {/* Raw Damage */}
                        <div className="w-14 text-right text-muted tabular-nums">
                          {s.raw_damage.toLocaleString()}
                        </div>

                        {/* Final Damage */}
                        <div className="w-16 text-right font-bold text-ink tabular-nums">
                          {s.final_damage.toLocaleString()}
                        </div>

                        {/* % HP */}
                        <div className="w-12 text-right text-dim tabular-nums">
                          {s.pct_target_hp}%
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
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/50 pb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] font-bold text-gold">{s.slot}</span>
                            {badge && (
                              <span className={`rounded border px-1 py-0.2 font-mono text-[9px] font-semibold ${badge.style}`}>
                                {badge.label}
                              </span>
                            )}
                            <span className={`text-[10px] font-semibold ${TYPE_STYLE[s.damage_type]}`}>
                              ความเสียหาย: {s.damage_type}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 font-mono text-[11px]">
                            {s.cooldown > 0 && (
                              <div className="flex items-center gap-1 text-dim" title="คูลดาวน์">
                                <Clock size={11} className="text-muted" />
                                <span>
                                  คูลดาวน์: <strong className="text-ink">{s.cooldown}วิ</strong>
                                  {s.base_cooldown && s.base_cooldown !== s.cooldown && (
                                    <span className="text-dim text-[10px]"> (พื้นฐาน {s.base_cooldown}วิ)</span>
                                  )}
                                </span>
                              </div>
                            )}

                            {s.mana_cost != null && s.mana_cost > 0 && (
                              <div className="flex items-center gap-1 text-blue" title="การใช้มานา">
                                <Droplet size={11} />
                                <span>มานา: {s.mana_cost}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Thai Description */}
                        {s.desc_th && (
                          <div className="rounded border border-line/60 bg-bg/50 p-2 text-ink leading-relaxed">
                            <div className="flex items-center gap-1 mb-0.5 text-[10px] font-bold text-gold">
                              <Sparkles size={10} />
                              <span>รายละเอียดสกิล:</span>
                            </div>
                            <p className="text-muted whitespace-pre-line">{s.desc_th}</p>
                          </div>
                        )}

                        {/* English Description Fallback */}
                        {s.description && s.description !== s.desc_th && (
                          <div className="rounded border border-line/30 bg-bg/20 p-2 text-dim leading-relaxed">
                            <div className="text-[10px] font-semibold text-dim mb-0.5">Description (EN):</div>
                            <p className="text-muted/80 whitespace-pre-line">{s.description}</p>
                          </div>
                        )}

                        {/* Charging Details if applicable */}
                        {s.has_charge && (
                          <div className="rounded border border-gold/40 bg-gold/10 p-2 text-gold font-mono text-[11px] space-y-1">
                            <div className="font-bold flex items-center gap-1">
                              <Sparkles size={11} />
                              <span>ระบบชาร์จสกิล / สเกลตามระยะทาง (Linear Interpolation):</span>
                            </div>
                            <div className="text-[10px] text-ink">
                              ดาเมจต่ำสุด (0%):{" "}
                              <span className="font-bold">
                                {s.base_damage ? s.base_damage[s.skill_level - 1] ?? s.base_damage[0] : 0}
                              </span>{" "}
                              {scalingText}
                            </div>
                            {s.max_damage && (
                              <div className="text-[10px] text-ink">
                                ดาเมจสูงสุด (100%):{" "}
                                <span className="font-bold">
                                  {s.max_damage[s.skill_level - 1] ?? s.max_damage[0]}
                                </span>{" "}
                                {formatScalingFormula(s.max_scaling)}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Formulas & Components Breakdown */}
                        <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[11px]">
                          {scalingText && (
                            <span className="rounded bg-panel px-2 py-0.5 text-gold border border-gold/30">
                              สูตรคำนวณ: {scalingText}
                            </span>
                          )}
                          {s.mitigation_multiplier > 0 && s.mitigation_multiplier < 1 && (
                            <span className="rounded bg-panel px-2 py-0.5 text-muted border border-line">
                              เกราะศัตรูลดทอนเหลือ: {(s.mitigation_multiplier * 100).toFixed(1)}%
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
          <span className="text-muted">คอมโบสกิลที่เลือก</span>
          <span className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-gold border border-line/60">
            {selectedCount} สกิล
          </span>
          {side.burst_per_1000_gold != null && (
            <span className="font-mono text-[10px] text-dim">
              ({side.burst_per_1000_gold.toLocaleString()} dmg/1k ทอง)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className={`font-mono font-bold ${side.combo_kills ? "text-good" : "text-ink"}`}>
            {side.burst_combo.toLocaleString()} ({side.burst_pct_enemy_hp}%)
          </span>
          {side.combo_kills && (
            <span className="rounded bg-good/20 px-1.5 py-0.5 text-[10px] font-bold text-good border border-good/40">
              ฆ่าได้ในคอมโบเดียว
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
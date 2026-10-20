import { ChevronRight, Clock, Droplet, Sparkles, Swords, X, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { BuildStats, CatalogHeroSkill, SkillDamageRow } from "../../types/combat";
import type { Hero } from "../../types/draft";
import { displayName } from "../../utils/heroNames";
import { HeroPortrait } from "../HeroPortrait";

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

function formatScaling(scaling?: Record<string, number>): string[] {
  if (!scaling) return [];
  const list: string[] = [];
  if (scaling.ad_pct) list.push(`+${scaling.ad_pct}% AD`);
  if (scaling.bonus_ad_pct) list.push(`+${scaling.bonus_ad_pct}% Bonus AD`);
  if (scaling.ap_pct) list.push(`+${scaling.ap_pct}% AP`);
  if (scaling.bonus_ap_pct) list.push(`+${scaling.bonus_ap_pct}% Bonus AP`);
  if (scaling.own_hp_pct) list.push(`+${scaling.own_hp_pct}% HP ตัวเอง`);
  if (scaling.hp_pct) list.push(`+${scaling.hp_pct}% HP`);
  if (scaling.max_hp_pct) list.push(`+${scaling.max_hp_pct}% Max HP`);
  if (scaling.bonus_hp_pct || scaling.bonus_max_hp_pct) {
    list.push(`+${(scaling.bonus_hp_pct ?? 0) + (scaling.bonus_max_hp_pct ?? 0)}% Bonus HP`);
  }
  if (scaling.bonus_armor_pct) list.push(`+${scaling.bonus_armor_pct}% Bonus Armor`);
  const tgtHp =
    (scaling.target_hp_pct ?? 0) + (scaling.target_max_hp_pct ?? 0) + (scaling.target_current_hp_pct ?? 0);
  if (tgtHp) list.push(`+${tgtHp}% HP ศัตรู`);
  if (scaling.target_hp_per_100_ad_pct) list.push(`+${scaling.target_hp_per_100_ad_pct}% HP ศัตรู/100 AD`);
  if (scaling.target_hp_per_100_bonus_ad_pct) {
    list.push(`+${scaling.target_hp_per_100_bonus_ad_pct}% HP ศัตรู/100 Bonus AD`);
  }
  if (scaling.target_hp_per_100_ap_pct) list.push(`+${scaling.target_hp_per_100_ap_pct}% HP ศัตรู/100 AP`);
  if (scaling.level_scaling) list.push(`+${scaling.level_scaling}/Lv`);
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
  const [selectedSlot, setSelectedSlot] = useState<string>(skills[0]?.slot ?? "Passive");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const sortedSkills = useMemo(() => {
    return [...skills].sort((a, b) => {
      const ia = SLOT_ORDER.indexOf(a.slot);
      const ib = SLOT_ORDER.indexOf(b.slot);
      if (ia !== -1 && ib !== -1) return ia - ib;
      return a.slot.localeCompare(b.slot);
    });
  }, [skills]);

  const activeSkill = sortedSkills.find((s) => s.slot === selectedSlot) ?? sortedSkills[0];
  const activeRow = skillRows?.find((r) => r.slot === activeSkill?.slot || r.name === activeSkill?.name);

  // Compute live bonus scaling from active hero buildStats
  const bonusScalingVal = useMemo(() => {
    if (!buildStats || !activeSkill?.scaling) return 0;
    const st = buildStats.stats;
    const baseLv = buildStats.sources.level;
    const sc = activeSkill.scaling;
    let b = 0;
    if (sc.ad_pct) b += (st.attack_damage * sc.ad_pct) / 100;
    if (sc.bonus_ad_pct) {
      const bonusAd = Math.max(0, st.attack_damage - (st.base_attack_damage ?? 0));
      b += (bonusAd * sc.bonus_ad_pct) / 100;
    }
    if (sc.ap_pct) b += (st.ability_power * sc.ap_pct) / 100;
    if (sc.bonus_ap_pct) b += (st.ability_power * sc.bonus_ap_pct) / 100;
    if (sc.own_hp_pct) b += (st.max_hp * sc.own_hp_pct) / 100;
    if (sc.hp_pct) b += (st.max_hp * sc.hp_pct) / 100;
    if (sc.max_hp_pct) b += (st.max_hp * sc.max_hp_pct) / 100;
    if (sc.bonus_hp_pct || sc.bonus_max_hp_pct) {
      const bonusHp = Math.max(0, st.max_hp - (baseLv.max_hp ?? 0));
      b += (bonusHp * ((sc.bonus_hp_pct ?? 0) + (sc.bonus_max_hp_pct ?? 0))) / 100;
    }
    if (sc.bonus_armor_pct) {
      const bonusArmor = Math.max(0, st.armor - (baseLv.armor ?? 0));
      b += (bonusArmor * sc.bonus_armor_pct) / 100;
    }
    if (sc.level_scaling) b += sc.level_scaling * buildStats.level;
    return Math.round(b);
  }, [buildStats, activeSkill]);

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
  const numRows = isPassive
    ? Math.max(1, activeSkill?.base_damage?.length ?? 0)
    : maxLevels;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-lg border border-line bg-panel shadow-2xl clip-chamfer"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-line px-4 py-3 bg-panel-2/60">
          <div className="flex items-center gap-3">
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded clip-chamfer ring-1 ring-gold">
              <HeroPortrait name={hero} hero={heroDraft} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-sm font-bold tracking-wider text-ink">{dName}</span>
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
              <p className="text-[11px] text-muted">รายละเอียดสกิล ตัวเลขการอัพเกรดเลเวล 1-6 และดาเมจคำนวณตามของจริง</p>
            </div>
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

        {/* Skill Slot Selector Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line/60 bg-bg/40 p-2.5">
          {sortedSkills.map((s) => {
            const isSelected = s.slot === activeSkill?.slot;
            const tCfg = TYPE_CONFIG[s.damage_type] || TYPE_CONFIG.none;
            const badge = getFormBadge(hero, s.slot);
            return (
              <button
                key={s.slot}
                type="button"
                onClick={() => setSelectedSlot(s.slot)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-all ${
                  isSelected
                    ? "border-gold bg-gold/15 font-bold text-gold shadow-sm ring-1 ring-gold"
                    : "border-line/60 bg-panel/70 text-muted hover:border-line hover:text-ink"
                }`}
              >
                {s.icon_url ? (
                  <img
                    src={s.icon_url}
                    alt={s.name}
                    className="h-6 w-6 rounded object-contain"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <div className="grid h-6 w-6 place-items-center rounded bg-line text-[9px] font-bold">
                    {s.slot[0]}
                  </div>
                )}
                <div className="text-left">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] leading-tight text-dim">{slotLabelTh(s.slot)}</span>
                    {badge && (
                      <span className={`rounded border px-1 py-0.2 font-mono text-[8px] font-semibold ${badge.style}`}>
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

        {/* Active Skill Content */}
        {activeSkill && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Skill Overview Card */}
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
                    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg border border-line bg-bg text-sm font-bold text-gold">
                      {activeSkill.slot}
                    </div>
                  )}

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] font-bold tracking-wider text-gold">
                        {slotLabelTh(activeSkill.slot)}
                      </span>
                      {getFormBadge(hero, activeSkill.slot) && (
                        <span
                          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold ${
                            getFormBadge(hero, activeSkill.slot)!.style
                          }`}
                        >
                          {getFormBadge(hero, activeSkill.slot)!.label}
                        </span>
                      )}
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

                {/* Cooldown & Mana Quick Pills */}
                <div className="flex flex-col items-end gap-1 shrink-0 text-xs font-mono">
                  {activeSkill.cooldown && activeSkill.cooldown.length > 0 && (
                    <div className="flex items-center gap-1 text-dim" title="คูลดาวน์พื้นฐาน">
                      <Clock size={12} className="text-muted" />
                      <span>{activeSkill.cooldown.join(" / ")} วิ</span>
                    </div>
                  )}
                  {activeSkill.mana_cost && activeSkill.mana_cost.length > 0 && activeSkill.mana_cost[0] > 0 && (
                    <div className="flex items-center gap-1 text-blue" title="การใช้มานา">
                      <Droplet size={12} />
                      <span>{activeSkill.mana_cost.join(" / ")}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Thai Description */}
              {activeSkill.desc_th && (
                <div className="rounded border border-line/60 bg-bg/50 p-3 text-xs leading-relaxed text-ink">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold text-gold">
                    <Sparkles size={11} />
                    <span>คำอธิบายสกิล (ไทย)</span>
                  </div>
                  <p className="whitespace-pre-line text-muted">{activeSkill.desc_th}</p>
                </div>
              )}

              {/* English Description */}
              {activeSkill.description && activeSkill.description !== activeSkill.desc_th && (
                <div className="rounded border border-line/40 bg-bg/20 p-3 text-xs leading-relaxed text-dim">
                  <div className="mb-1 text-[10px] font-semibold text-dim">คำอธิบายสกิล (English)</div>
                  <p className="whitespace-pre-line text-muted/90">{activeSkill.description}</p>
                </div>
              )}
            </div>

            {/* Level Progression Table */}
            <div className="rounded-lg border border-line bg-panel p-3">
              <div className="mb-2 flex items-center justify-between border-b border-line/50 pb-2">
                <div className="flex items-center gap-2">
                  <Zap size={14} className="text-gold" />
                  <h4 className="font-display text-xs font-bold tracking-wider text-ink">
                    ตารางสถิติตามเลเวลสกิล (Lv 1 - {maxLevels})
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
                      <th className="py-1.5 text-right font-normal">ดาเมจพื้นฐาน</th>
                      {bonusScalingVal > 0 && (
                        <th className="py-1.5 text-right font-normal">+โบนัสของ/รูน</th>
                      )}
                      <th className="py-1.5 text-right font-normal">รวมดาเมจดิบ</th>
                      {activeRow && activeRow.mitigation_multiplier > 0 && activeRow.mitigation_multiplier < 1 && (
                        <th className="py-1.5 text-right font-normal">เข้าจริง (ใส่ {enemyName ?? "ศัตรู"})</th>
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
                      const rawDmg = baseDmg + bonusScalingVal;
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
                          <td className="py-1.5 text-right tabular-nums text-ink">
                            {baseDmg > 0 ? baseDmg.toLocaleString() : "—"}
                          </td>
                          {bonusScalingVal > 0 && (
                            <td className="py-1.5 text-right tabular-nums text-gold">
                              +{bonusScalingVal.toLocaleString()}
                            </td>
                          )}
                          <td className="py-1.5 text-right tabular-nums font-bold text-ink">
                            {rawDmg > 0 ? rawDmg.toLocaleString() : "—"}
                          </td>
                          {activeRow && activeRow.mitigation_multiplier > 0 && activeRow.mitigation_multiplier < 1 && (
                            <td className="py-1.5 text-right tabular-nums font-bold text-good">
                              {finalDmg > 0 ? finalDmg.toLocaleString() : "—"}
                            </td>
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

            {/* Formulas & Component Scaling Pills */}
            {activeSkill.scaling && Object.keys(activeSkill.scaling).length > 0 && (
              <div className="rounded-lg border border-line bg-panel p-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-gold">
                  <Swords size={13} />
                  <span>สูตรการคูณพลังโจมตี (Scaling Ratios)</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {formatScaling(activeSkill.scaling).map((s, idx) => (
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
    </div>
  );
}

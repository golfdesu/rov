import { Check, Lock, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import type { CatalogEnchantment, CombatCatalog } from "../../types/combat";
import { FACTION_INFO, ROMAN } from "./enchantmentFactions";
import { SocketItem } from "./EnchantmentSocket";

interface EnchantmentBoardProps {
  catalog: CombatCatalog;
  primaryFaction: string | null;
  primaryEnchantments: string[];
  secondaryFaction: string | null;
  secondaryEnchantments: string[];
  onChange: (patch: {
    primary_faction?: string | null;
    primary_enchantments?: string[];
    secondary_faction?: string | null;
    secondary_enchantments?: string[];
  }) => void;
}

export function EnchantmentBoard({
  catalog,
  primaryFaction,
  primaryEnchantments,
  secondaryFaction: _secondaryFaction,
  secondaryEnchantments,
  onChange,
}: EnchantmentBoardProps) {
  const [activeTab, setActiveTab] = useState<"primary" | "secondary">("primary");
  const [hoveredEnch, setHoveredEnch] = useState<CatalogEnchantment | null>(null);

  const enchMap = useMemo(() => {
    const map = new Map<string, CatalogEnchantment>();
    for (const e of catalog.enchantments) {
      map.set(e.name, e);
      if (e.alias) map.set(e.alias, e);
    }
    return map;
  }, [catalog.enchantments]);

  const primaryT1 = primaryEnchantments.find((n) => enchMap.get(n)?.tier === 1);
  const primaryT2 = primaryEnchantments.find((n) => enchMap.get(n)?.tier === 2);
  const primaryT3 = primaryEnchantments.find((n) => enchMap.get(n)?.tier === 3);

  const secEnch1 = secondaryEnchantments[0] ? enchMap.get(secondaryEnchantments[0]) : undefined;
  const secEnch2 = secondaryEnchantments[1] ? enchMap.get(secondaryEnchantments[1]) : undefined;

  const secondaryAvailableFactions = useMemo(() => {
    return catalog.factions.filter((f) => f !== primaryFaction);
  }, [catalog.factions, primaryFaction]);

  const [selectedSecFaction, setSelectedSecFaction] = useState<string | null>(null);

  const effectiveSecFaction =
    selectedSecFaction && secondaryAvailableFactions.includes(selectedSecFaction)
      ? selectedSecFaction
      : secEnch1?.faction && secondaryAvailableFactions.includes(secEnch1.faction)
        ? secEnch1.faction
        : secondaryAvailableFactions[0] ?? null;

  const handlePickPrimary = (tier: number, name: string) => {
    const isAlreadyPicked = primaryEnchantments.includes(name);
    const others = primaryEnchantments.filter((n) => enchMap.get(n)?.tier !== tier);
    const next = isAlreadyPicked ? others : [...others, name];
    onChange({ primary_enchantments: next });
  };

  const handleSelectPrimaryFaction = (f: string | null) => {
    if (f === primaryFaction) return;
    const cleanSec = secondaryEnchantments.filter((n) => enchMap.get(n)?.faction !== f);
    const secFactions = cleanSec.map((n) => enchMap.get(n)?.faction).filter(Boolean);
    onChange({
      primary_faction: f,
      primary_enchantments: [],
      secondary_enchantments: cleanSec,
      secondary_faction: secFactions.length > 0 ? [...new Set(secFactions)].join(", ") : null,
    });
    setActiveTab("primary");
  };

  const handlePickSecondary = (tier: number, name: string, faction: string) => {
    const isAlreadyPicked = secondaryEnchantments.includes(name);
    if (isAlreadyPicked) {
      const next = secondaryEnchantments.filter((n) => n !== name);
      const secFactions = next.map((n) => enchMap.get(n)?.faction).filter(Boolean);
      onChange({
        secondary_enchantments: next,
        secondary_faction: secFactions.length > 0 ? [...new Set(secFactions)].join(", ") : null,
      });
      return;
    }

    const current = secondaryEnchantments.map((n) => enchMap.get(n)).filter(Boolean) as CatalogEnchantment[];

    if (current.length === 0) {
      onChange({
        secondary_enchantments: [name],
        secondary_faction: faction,
      });
      return;
    }

    if (current.length === 1) {
      const e1 = current[0];
      if (e1.faction === faction) {
        if (e1.tier === tier) {
          onChange({
            secondary_enchantments: [name],
            secondary_faction: faction,
          });
        } else {
          onChange({
            secondary_enchantments: [e1.name, name],
            secondary_faction: faction,
          });
        }
      } else {
        if (e1.tier === 1 && tier === 1) {
          onChange({
            secondary_enchantments: [e1.name, name],
            secondary_faction: `${e1.faction}, ${faction}`,
          });
        } else {
          onChange({
            secondary_enchantments: [name],
            secondary_faction: faction,
          });
        }
      }
      return;
    }

    const [e1] = current;
    const sameTierSameFaction = current.find((c) => c.faction === faction && c.tier === tier);
    if (sameTierSameFaction) {
      const others = current.filter((c) => c.name !== sameTierSameFaction.name);
      const next = [...others.map((c) => c.name), name];
      const secFactions = next.map((n) => enchMap.get(n)?.faction).filter(Boolean);
      onChange({
        secondary_enchantments: next,
        secondary_faction: [...new Set(secFactions)].join(", ") || null,
      });
      return;
    }

    if (tier === 1 && e1.tier === 1) {
      const next = [e1.name, name];
      const secFactions = next.map((n) => enchMap.get(n)?.faction).filter(Boolean);
      onChange({
        secondary_enchantments: next,
        secondary_faction: [...new Set(secFactions)].join(", ") || null,
      });
      return;
    }

    onChange({
      secondary_enchantments: [name],
      secondary_faction: faction,
    });
  };

  const handleClearSecondarySlot = (nameToRemove: string) => {
    const next = secondaryEnchantments.filter((n) => n !== nameToRemove);
    const secFactions = next.map((n) => enchMap.get(n)?.faction).filter(Boolean);
    onChange({
      secondary_enchantments: next,
      secondary_faction: secFactions.length > 0 ? [...new Set(secFactions)].join(", ") : null,
    });
  };

  const handleClearAll = () => {
    onChange({
      primary_faction: null,
      primary_enchantments: [],
      secondary_faction: null,
      secondary_enchantments: [],
    });
    setActiveTab("primary");
  };

  const isPrimary = activeTab === "primary";
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-3">
      {/* 5 In-Game Sockets Header */}
      <div className="rounded-lg border border-line/60 bg-panel-2/40 p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-gold" />
            <span className="font-display text-xs font-bold tracking-wider text-ink">
              ผังพลังแฝง 5 ช่อง (In-Game Sockets)
            </span>
          </div>
          <button
            type="button"
            onClick={handleClearAll}
            className="text-[10px] text-dim transition-colors hover:text-red"
          >
            ล้างทั้งหมด
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {/* Primary 3 Sockets */}
          <div
            onClick={() => setActiveTab("primary")}
            className={`cursor-pointer rounded-lg border p-2 transition-all ${
              isPrimary
                ? "border-gold bg-gold/10 ring-1 ring-gold shadow-md shadow-gold/10"
                : "border-line/60 bg-bg/40 hover:border-line hover:bg-bg/70"
            }`}
          >
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-display text-[11px] font-bold text-gold">สายหลัก (Primary)</span>
              <span className="text-[10px] font-medium text-muted">
                {primaryFaction ? FACTION_INFO[primaryFaction]?.nameTh ?? primaryFaction : "⚠️ ยังไม่เลือกฝ่าย"}
              </span>
            </div>

            <div className="flex items-center justify-around gap-1 pt-1">
              <SocketItem
                tier={1}
                name={primaryT1}
                ench={primaryT1 ? enchMap.get(primaryT1) : undefined}
                isMajor={false}
                factionColor={primaryFaction ? FACTION_INFO[primaryFaction]?.border : undefined}
                onClear={() => handlePickPrimary(1, primaryT1!)}
              />
              <div className="h-0.5 w-4 bg-line" />
              <SocketItem
                tier={2}
                name={primaryT2}
                ench={primaryT2 ? enchMap.get(primaryT2) : undefined}
                isMajor={false}
                factionColor={primaryFaction ? FACTION_INFO[primaryFaction]?.border : undefined}
                onClear={() => handlePickPrimary(2, primaryT2!)}
              />
              <div className="h-0.5 w-4 bg-line" />
              <SocketItem
                tier={3}
                name={primaryT3}
                ench={primaryT3 ? enchMap.get(primaryT3) : undefined}
                isMajor={true}
                factionColor={primaryFaction ? FACTION_INFO[primaryFaction]?.border : undefined}
                onClear={() => handlePickPrimary(3, primaryT3!)}
              />
            </div>
          </div>

          {/* Secondary 2 Sockets */}
          <div
            onClick={() => {
              if (primaryFaction) {
                setActiveTab("secondary");
              }
            }}
            className={`relative rounded-lg border p-2 transition-all ${
              !primaryFaction
                ? "cursor-not-allowed opacity-50 border-line/40 bg-bg/20"
                : !isPrimary
                  ? "cursor-pointer border-blue bg-blue/10 ring-1 ring-blue shadow-md shadow-blue/10"
                  : "cursor-pointer border-line/60 bg-bg/40 hover:border-line hover:bg-bg/70"
            }`}
          >
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="font-display text-[11px] font-bold text-blue">สายรอง (Secondary)</span>
                {!primaryFaction && <Lock size={11} className="text-muted" />}
              </div>
              <span className="text-[10px] font-medium text-muted">
                {!primaryFaction
                  ? "🔒 ต้องเลือกสายหลักก่อน"
                  : secondaryEnchantments.length > 0
                    ? `${secondaryEnchantments.length} / 2 ชิ้น`
                    : "ว่าง (แตะเพื่อเลือก)"}
              </span>
            </div>

            <div className="flex items-center justify-around gap-1 pt-1">
              <SocketItem
                tier={secEnch1 ? secEnch1.tier : 1}
                name={secEnch1?.name}
                ench={secEnch1}
                isMajor={false}
                factionColor={secEnch1 ? FACTION_INFO[secEnch1.faction]?.border : undefined}
                onClear={() => secEnch1 && handleClearSecondarySlot(secEnch1.name)}
              />
              <div className="h-0.5 w-8 bg-line" />
              <SocketItem
                tier={secEnch2 ? secEnch2.tier : 2}
                name={secEnch2?.name}
                ench={secEnch2}
                isMajor={false}
                factionColor={secEnch2 ? FACTION_INFO[secEnch2.faction]?.border : undefined}
                onClear={() => secEnch2 && handleClearSecondarySlot(secEnch2.name)}
              />
            </div>
          </div>
        </div>
      </div>
      {/* Main Configuration Area */}
      {!primaryFaction ? (
        /* STEP 1: Select Primary Faction First */
        <div className="flex flex-col gap-3 rounded-lg border border-gold/40 bg-gold/5 p-4">
          <div>
            <h4 className="font-display text-xs font-bold text-gold">ขั้นตอนที่ 1: เลือกฝ่ายพลังแฝงหลัก (Primary Faction)</h4>
            <p className="mt-0.5 text-[11px] text-muted">
              กรุณาเลือกฝ่ายหลักของฮีโร่ก่อน เพื่อเปิดใช้งานผังพลังแฝงหลัก Tier I, II, III และปลดล็อคสายรอง
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
            {catalog.factions.map((f) => {
              const info = FACTION_INFO[f];
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => handleSelectPrimaryFaction(f)}
                  className={`group flex flex-col items-start rounded-lg border p-3 text-left transition-all ${
                    info?.border || "border-line"
                  } bg-panel hover:scale-[1.02] hover:shadow-lg hover:shadow-gold/10`}
                >
                  <span className={`text-sm font-bold ${info?.color || "text-ink"}`}>{f}</span>
                  <span className="mt-1 text-xs text-muted font-medium">{info?.nameTh || ""}</span>
                  <span className="mt-2 text-[10px] text-gold underline underline-offset-2 opacity-80 group-hover:opacity-100">
                    เลือกฝ่ายนี้ →
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : isPrimary ? (
        /* PRIMARY FACTION TREE */
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between rounded-md border border-line bg-panel-2 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">ฝ่ายหลัก:</span>
              <span className={`text-xs font-bold ${FACTION_INFO[primaryFaction]?.color || "text-gold"}`}>
                {primaryFaction} ({FACTION_INFO[primaryFaction]?.nameTh || ""})
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleSelectPrimaryFaction(null)}
              className="text-[11px] text-gold underline underline-offset-2 hover:text-ink"
            >
              เปลี่ยนฝ่ายหลัก
            </button>
          </div>

          <div className="relative flex flex-col gap-3 rounded-lg border border-line/60 bg-bg/60 p-3">
            <div className="absolute left-[27px] top-6 bottom-6 w-0.5 bg-line/80 pointer-events-none" />

            {[1, 2, 3].map((tier) => {
              const options = catalog.enchantments.filter(
                (e) => e.faction === primaryFaction && e.tier === tier
              );
              const currentName = primaryEnchantments.find((n) => options.some((o) => o.name === n));
              const activeEnch = currentName ? enchMap.get(currentName) : null;

              return (
                <div key={tier} className="relative z-10 flex items-start gap-3">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold font-mono shadow ${
                      activeEnch
                        ? "border-gold bg-gold text-bg shadow-gold/30"
                        : "border-line bg-panel text-muted"
                    }`}
                  >
                    {ROMAN[tier]}
                  </div>

                  <div className="flex-1">
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="font-mono text-[10px] text-dim">
                        ขั้น {tier} {tier === 3 ? "(พลังแฝงแกนหลัก Core)" : ""}
                      </span>
                      {activeEnch && (
                        <span className="font-semibold text-ink">
                          {activeEnch.name}
                          {!activeEnch.modeled && (
                            <span className="ml-1 text-[9px] font-normal text-dim">
                              (ยังไม่คิดตัวเลข)
                            </span>
                          )}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {options.map((o) => {
                        const isPicked = o.name === currentName;
                        const isMajor = tier === 3;
                        return (
                          <div
                            key={o.name}
                            className="flex flex-col items-center"
                            onMouseEnter={() => setHoveredEnch(o)}
                            onMouseLeave={() => setHoveredEnch(null)}
                          >
                            <button
                              type="button"
                              onClick={() => handlePickPrimary(tier, o.name)}
                              className={`group relative flex flex-col items-center rounded-full p-0.5 transition-all ${
                                isPicked
                                  ? "ring-2 ring-gold shadow-lg shadow-gold/30 scale-105"
                                  : "opacity-75 hover:opacity-100 hover:scale-105"
                              }`}
                            >
                              {o.icon_url ? (
                                <img
                                  src={o.icon_url}
                                  alt={o.name}
                                  className={`rounded-full object-contain ${
                                    isMajor ? "h-14 w-14 sm:h-16 sm:w-16" : "h-11 w-11 sm:h-12 sm:w-12"
                                  }`}
                                  loading="lazy"
                                />
                              ) : (
                                <div
                                  className={`flex items-center justify-center rounded-full bg-line ${
                                    isMajor ? "h-14 w-14" : "h-11 w-11"
                                  } text-[10px] font-bold`}
                                >
                                  T{tier}
                                </div>
                              )}

                              {isPicked && (
                                <div className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-gold text-bg shadow">
                                  <Check size={10} strokeWidth={3} />
                                </div>
                              )}
                            </button>

                            <span
                              className={`mt-1 text-center text-[10px] ${
                                isPicked ? "font-bold text-gold" : "text-muted"
                              }`}
                            >
                              {o.category || o.name}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setActiveTab("secondary")}
              className="flex items-center gap-1.5 rounded border border-blue/40 bg-blue/10 px-3 py-1.5 text-xs font-bold text-blue hover:bg-blue/20"
            >
              <span>ไปตั้งค่าสายรอง (Secondary)</span>
              <span>→</span>
            </button>
          </div>
        </div>
      ) : (
        /* SECONDARY FACTION SELECTION */
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-blue/40 bg-blue/10 p-2.5 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-blue">
              <span>💡 กติกาสายรอง (Secondary Enchants):</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              สามารถเลือก <span className="font-semibold text-ink">ขั้น 1 + ขั้น 2 จากสายเดียวกัน</span> หรือ{" "}
              <span className="font-semibold text-ink">เลือกขั้น 1 จำนวน 2 ชิ้นจากคนละสายได้</span> (แตะสลับแท็บฝ่ายด้านล่างเพื่อเลือกขั้น 1 คนละสี)
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted">เลือกดูฝ่ายสำหรับสายรอง:</span>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              {secondaryAvailableFactions.map((f) => {
                const isSelected = effectiveSecFaction === f;
                const info = FACTION_INFO[f];
                const pickedCount = secondaryEnchantments.filter(
                  (n) => enchMap.get(n)?.faction === f
                ).length;

                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setSelectedSecFaction(f)}
                    className={`flex items-center justify-between rounded-md border p-2 text-left transition-all ${
                      isSelected
                        ? `${info?.border} ${info?.activeBg} ring-1 ${info?.border} font-bold`
                        : "border-line/60 bg-bg/50 hover:border-line hover:bg-panel-2"
                    }`}
                  >
                    <div>
                      <span className={`text-xs font-semibold ${info?.color || "text-ink"}`}>{f}</span>
                      <span className="block text-[9px] text-dim">{info?.nameTh}</span>
                    </div>
                    {pickedCount > 0 && (
                      <span className="rounded-full bg-gold px-1.5 py-0.5 text-[9px] font-bold text-bg">
                        เลือกแล้ว {pickedCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {effectiveSecFaction && (
            <div className="relative flex flex-col gap-3 rounded-lg border border-line/60 bg-bg/60 p-3">
              <div className="absolute left-[27px] top-6 bottom-6 w-0.5 bg-line/80 pointer-events-none" />

              {[1, 2].map((tier) => {
                const options = catalog.enchantments.filter(
                  (e) => e.faction === effectiveSecFaction && e.tier === tier
                );
                const currentName = secondaryEnchantments.find((n) => options.some((o) => o.name === n));
                const activeEnch = currentName ? enchMap.get(currentName) : null;

                return (
                  <div key={tier} className="relative z-10 flex items-start gap-3">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold font-mono shadow ${
                        activeEnch
                          ? "border-blue bg-blue text-bg shadow-blue/30"
                          : "border-line bg-panel text-muted"
                      }`}
                    >
                      {ROMAN[tier]}
                    </div>

                    <div className="flex-1">
                      <div className="mb-1 flex items-center justify-between text-[11px]">
                        <span className="font-mono text-[10px] text-dim">
                          ขั้น {tier} ({effectiveSecFaction})
                        </span>
                        {activeEnch && (
                          <span className="font-semibold text-ink">
                            {activeEnch.name}
                            {!activeEnch.modeled && (
                              <span className="ml-1 text-[9px] font-normal text-dim">
                                (ยังไม่คิดตัวเลข)
                              </span>
                            )}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        {options.map((o) => {
                          const isPicked = o.name === currentName;
                          return (
                            <div
                              key={o.name}
                              className="flex flex-col items-center"
                              onMouseEnter={() => setHoveredEnch(o)}
                              onMouseLeave={() => setHoveredEnch(null)}
                            >
                              <button
                                type="button"
                                onClick={() => handlePickSecondary(tier, o.name, effectiveSecFaction)}
                                className={`group relative flex flex-col items-center rounded-full p-0.5 transition-all ${
                                  isPicked
                                    ? "ring-2 ring-blue shadow-lg shadow-blue/30 scale-105"
                                    : "opacity-75 hover:opacity-100 hover:scale-105"
                                }`}
                              >
                                {o.icon_url ? (
                                  <img
                                    src={o.icon_url}
                                    alt={o.name}
                                    className="h-11 w-11 rounded-full object-contain sm:h-12 sm:w-12"
                                    loading="lazy"
                                  />
                                ) : (
                                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-line text-[10px] font-bold">
                                    T{tier}
                                  </div>
                                )}

                                {isPicked && (
                                  <div className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-blue text-bg shadow">
                                    <Check size={10} strokeWidth={3} />
                                  </div>
                                )}
                              </button>

                              <span
                                className={`mt-1 text-center text-[10px] ${
                                  isPicked ? "font-bold text-blue" : "text-muted"
                                }`}
                              >
                                {o.category || o.name}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex justify-start">
            <button
              type="button"
              onClick={() => setActiveTab("primary")}
              className="text-xs text-muted hover:text-ink underline underline-offset-2"
            >
              ← กลับไปดูสายหลัก (Primary)
            </button>
          </div>
        </div>
      )}

      {/* Description Card of Selected / Hovered Enchantment */}
      {hoveredEnch && (
        <div className="mt-1 rounded-lg border border-line bg-panel p-2.5 text-xs">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-bold text-ink">
              {hoveredEnch.name} {hoveredEnch.alias && `(${hoveredEnch.alias})`}
            </span>
            <span className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
              {hoveredEnch.faction} · ขั้น {hoveredEnch.tier} · {hoveredEnch.category || "พลังแฝง"}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-muted">{hoveredEnch.description}</p>
          {hoveredEnch.note && (
            <p className="mt-1 text-[11px] font-medium text-gold">⚡ {hoveredEnch.note}</p>
          )}
        </div>
      )}
    </div>
  );
}

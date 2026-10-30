import { BookOpen, Plus, Swords, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type { BuildStats, CatalogItem, CombatBuild, CombatCatalog, Side, SkillDamageRow } from "../../types/combat";
import type { Hero } from "../../types/draft";
import { displayName } from "../../utils/heroNames";
import { HeroPortrait } from "../HeroPortrait";
import { ArcanaBoard } from "./ArcanaBoard";
import { EnchantmentBoard } from "./EnchantmentBoard";
import { HeroPickerModal } from "./HeroPickerModal";
import { HeroSkillsModal } from "./HeroSkillsModal";

interface BuildPanelProps {
  side: Side;
  build: CombatBuild;
  catalog: CombatCatalog;
  heroMap: Map<string, Hero>;
  buildStats?: BuildStats;
  skillRows?: SkillDamageRow[];
  enemyName?: string;
  onChange: (patch: Partial<CombatBuild>) => void;
}

function formatStats(stats: Record<string, number>): string {
  return Object.entries(stats)
    .map(([k, v]) => `${k.replace(/_/g, " ")} +${v}`)
    .join(", ");
}

function ItemIcon({
  src,
  name,
  className = "h-7 w-7 shrink-0",
}: {
  src?: string | null;
  name: string;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    return (
      <div
        className={`flex items-center justify-center border border-line bg-panel-2 p-0.5 text-center font-mono text-[9px] font-bold text-muted ${className}`}
      >
        <span className="truncate">{name.slice(0, 3).toUpperCase()}</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      className={className}
      loading="lazy"
      onError={() => setFailedSrc(src)}
    />
  );
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-t border-line pt-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-display text-[11px] font-semibold tracking-[0.18em] text-muted">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function ItemPicker({
  items,
  onPick,
  onClose,
}: {
  items: CatalogItem[];
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const categories = useMemo(() => ["all", ...new Set(items.map((i) => i.category))], [items]);
  const q = query.toLowerCase();
  const shown = items
    .filter((i) => i.tier === 3 || (i.category === "movement" && i.tier === 2) || q)
    .filter((i) => category === "all" || i.category === category)
    .filter((i) => i.name.toLowerCase().includes(q));

  return (
    <div className="mt-2 border border-line-strong bg-panel-2 p-2">
      <div className="mb-2 flex gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาไอเทม (ไม่พิมพ์ = เฉพาะชิ้นสำเร็จ)"
          className="min-w-0 flex-1 border border-line bg-bg px-2 py-1 text-xs"
        />
        <button type="button" onClick={onClose} className="px-2 text-muted hover:text-ink" aria-label="ปิด">
          <X size={14} />
        </button>
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {categories.map((c) => (
          <button
            type="button"
            key={c}
            onClick={() => setCategory(c)}
            className={`px-2 py-0.5 text-[10px] uppercase ${category === c ? "bg-gold text-bg" : "bg-panel text-muted"}`}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
        {shown.map((i) => (
          <button
            type="button"
            key={i.name}
            onClick={() => onPick(i.name)}
            className="flex items-center gap-2 bg-panel p-1.5 text-left hover:bg-line"
            title={[formatStats(i.stats), ...i.passives].join("\n")}
          >
            <ItemIcon src={i.icon_url} name={i.name} className="h-7 w-7 shrink-0 object-cover" />
            <span className="min-w-0">
              <span className="block truncate text-xs">{i.name}</span>
              <span className="block truncate font-mono text-[10px] text-dim">
                {i.price ?? "?"}g · {formatStats(i.stats)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function BuildPanel({
  side,
  build,
  catalog,
  heroMap,
  buildStats,
  skillRows,
  enemyName,
  onChange,
}: BuildPanelProps) {
  const [picking, setPicking] = useState<number | null>(null);
  const [showHeroPicker, setShowHeroPicker] = useState(false);
  const [showSkillsModal, setShowSkillsModal] = useState(false);

  const accent = side === "a" ? "text-blue" : "text-red";
  const itemMap = useMemo(() => new Map(catalog.items.map((i) => [i.name, i])), [catalog.items]);
  const cost = build.items.reduce((sum, n) => sum + (itemMap.get(n)?.price ?? 0), 0);

  const currentHeroObj = catalog.heroes.find((h) => h.name === build.hero);
  const heroDisplay = displayName(build.hero);
  const currentSkills = catalog.skills?.[build.hero] ?? [];

  const setItem = (slot: number, name: string | null) => {
    const next = [...build.items];
    if (name === null) next.splice(slot, 1);
    else if (slot < next.length) next[slot] = name;
    else next.push(name);
    onChange({ items: next });
    setPicking(null);
  };

  return (
    <div className="flex flex-col gap-3 border border-line bg-panel p-3">
      {/* Hero Showcase Card */}
      <div
        className={`group relative flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border p-2.5 transition-all ${
          side === "a"
            ? "border-blue/40 bg-gradient-to-r from-blue/15 via-panel to-panel shadow-sm shadow-blue/5"
            : "border-red/40 bg-gradient-to-r from-red/15 via-panel to-panel shadow-sm shadow-red/5"
        }`}
      >
        {/* Left: Portrait & Names */}
        <div
          onClick={() => setShowHeroPicker(true)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
          title="แตะเพื่อเปลี่ยนฮีโร่"
        >
          {/* Large Chamfered Portrait */}
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded clip-chamfer ring-2 ring-line-strong transition-transform group-hover:scale-105 group-hover:ring-gold">
            <HeroPortrait name={build.hero} hero={heroMap.get(build.hero)} />
          </div>

          {/* Hero Details */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`font-display text-[10px] font-bold tracking-[0.2em] ${accent}`}>
                {side === "a" ? "🔵 ฝั่ง A" : "🔴 ฝั่ง B"}
              </span>
              {currentHeroObj?.role && (
                <span className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-muted">
                  {currentHeroObj.role} {currentHeroObj.ranged ? "· ระยะไกล" : "· ระยะใกล้"}
                </span>
              )}
            </div>

            <div className="mt-1 truncate font-display text-base font-bold text-ink transition-colors hover:text-gold">
              {heroDisplay}
              {heroDisplay !== build.hero && (
                <span className="ml-1.5 font-sans text-xs font-normal text-dim">({build.hero})</span>
              )}
            </div>
          </div>
        </div>

        {/* Right: Action Buttons */}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* View Skills Button */}
          <button
            type="button"
            onClick={() => setShowSkillsModal(true)}
            className="flex items-center gap-1.5 rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-xs font-semibold text-ink shadow-sm transition-all hover:border-gold hover:text-gold"
            title="ดูรายละเอียดสกิล คูลดาวน์ และสูตรการคำนวณ"
          >
            <BookOpen size={13} className="text-gold" />
            <span>ดูสกิล</span>
          </button>

          {/* Change Hero Button */}
          <button
            type="button"
            onClick={() => setShowHeroPicker(true)}
            className="flex items-center gap-1.5 rounded-md border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-bold text-gold shadow-sm transition-all hover:border-gold hover:bg-gold hover:text-bg"
          >
            <Swords size={13} />
            <span>เปลี่ยน</span>
          </button>
        </div>
      </div>

      {/* Hero Picker Modal */}
      {showHeroPicker && (
        <HeroPickerModal
          heroes={catalog.heroes}
          currentHero={build.hero}
          heroMap={heroMap}
          onSelect={(heroName) => {
            onChange({
              hero: heroName,
              skill_levels: {},
              skill_hits: {},
              skill_charges: {},
              active_combo_slots: undefined,
            });
          }}
          onClose={() => setShowHeroPicker(false)}
        />
      )}

      {/* Hero Skills Detail Modal */}
      {showSkillsModal && (
        <HeroSkillsModal
          hero={build.hero}
          skills={currentSkills}
          heroObj={currentHeroObj}
          heroDraft={heroMap.get(build.hero)}
          buildStats={buildStats}
          skillRows={skillRows}
          enemyName={enemyName}
          onClose={() => setShowSkillsModal(false)}
        />
      )}

      {/* Level Slider */}
      <label className="flex items-center gap-3 text-xs">
        <span className="w-14 text-muted">เลเวล</span>
        <input
          type="range"
          min={1}
          max={catalog.max_level}
          value={build.level}
          onChange={(e) => onChange({ level: Number(e.target.value), skill_levels: {} })}
          className="flex-1 accent-gold"
        />
        <span className="w-6 text-right font-mono text-sm font-bold tabular-nums">{build.level}</span>
      </label>

      {/* Items Section */}
      <Section title="ไอเทม" right={<span className="font-mono text-[10px] text-dim">{cost.toLocaleString()}g</span>}>
        <div className="grid grid-cols-6 gap-1.5">
          {Array.from({ length: 6 }, (_, i) => {
            const item = itemMap.get(build.items[i]);
            return (
              <div key={i} className="relative">
                <button
                  type="button"
                  onClick={() => setPicking(picking === i ? null : Math.min(i, build.items.length))}
                  title={item ? `${item.name}\n${formatStats(item.stats)}` : "เพิ่มไอเทม"}
                  className={`grid aspect-square w-full place-items-center border ${
                    picking === i ? "border-gold" : "border-line"
                  } bg-panel-2 hover:border-line-strong`}
                >
                  {item ? (
                    <ItemIcon src={item.icon_url} name={item.name} className="h-full w-full object-cover" />
                  ) : (
                    <Plus size={14} className="text-dim" />
                  )}
                </button>
                {item && (
                  <button
                    type="button"
                    aria-label={`ถอด ${item.name}`}
                    onClick={() => setItem(i, null)}
                    className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center bg-red text-bg"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {picking !== null && (
          <ItemPicker items={catalog.items} onPick={(n) => setItem(picking, n)} onClose={() => setPicking(null)} />
        )}
      </Section>

      {/* Arcana Board */}
      <Section title="รูน (Tier 3 Arcana)">
        <ArcanaBoard
          arcana={catalog.arcana}
          chosen={build.arcana}
          maxPerColor={catalog.arcana_slots_per_color}
          onChange={(arcana) => onChange({ arcana })}
        />
      </Section>

      {/* Enchantment Board */}
      <Section title="พลังแฝง">
        <EnchantmentBoard
          catalog={catalog}
          primaryFaction={build.primary_faction}
          primaryEnchantments={build.primary_enchantments}
          secondaryFaction={build.secondary_faction}
          secondaryEnchantments={build.secondary_enchantments}
          onChange={(patch) => onChange(patch)}
        />
      </Section>
    </div>
  );
}
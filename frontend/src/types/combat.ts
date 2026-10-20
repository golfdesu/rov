export interface CombatBuild {
  hero: string;
  level: number;
  items: string[];
  arcana: Record<string, number>;
  primary_faction: string | null;
  primary_enchantments: string[];
  secondary_faction: string | null;
  secondary_enchantments: string[];
  skill_levels: Record<string, number>;
  skill_hits: Record<string, number>;
  skill_charges?: Record<string, number>;
  active_combo_slots?: string[];
}

export interface CatalogItem {
  name: string;
  category: string;
  tier: number;
  price: number | null;
  stats: Record<string, number>;
  passives: string[];
  icon_url: string | null;
  pierce: Record<string, number>;
}

export interface CatalogArcana {
  name: string;
  name_th?: string;
  color: "Red" | "Purple" | "Green";
  stats: Record<string, number>;
  icon: string;
}

export interface CatalogEnchantment {
  name: string;
  alias?: string;
  faction: string;
  tier: number;
  category?: string;
  description: string;
  icon_url?: string;
  modeled: boolean;
  note: string | null;
}

export interface CatalogHeroSkill {
  name: string;
  slot: string;
  level_slot?: string;
  damage_type: "physical" | "magic" | "true" | "none";
  description: string;
  desc_th?: string;
  icon_url?: string;
  base_damage?: number[];
  cooldown?: number[];
  mana_cost?: number[];
  scaling?: Record<string, number>;
  has_charge?: boolean;
  max_damage?: number[];
  max_scaling?: Record<string, number>;
}

export interface CombatCatalog {
  heroes: { name: string; role: string | null; ranged: boolean }[];
  max_level: number;
  skills?: Record<string, CatalogHeroSkill[]>;
  items: CatalogItem[];
  arcana: CatalogArcana[];
  arcana_slots_per_color: number;
  factions: string[];
  enchantments: CatalogEnchantment[];
}

export type StatMap = Record<string, number>;

export interface BuildStats {
  hero: string;
  level: number;
  is_ranged: boolean;
  stats: StatMap;
  sources: {
    level: StatMap;
    items: StatMap;
    arcana: StatMap;
    enchantments: StatMap;
  };
  build_cost: number;
  items_missing_price: string[];
  enchantments_modeled: string[];
  enchantments_unmodeled: string[];
}

export interface SkillDamageRow {
  name: string;
  slot: string;
  level_slot?: string;
  damage_type: "physical" | "magic" | "true" | "none";
  skill_level: number;
  hits: number;
  has_charge?: boolean;
  charge_ratio?: number | null;
  max_damage?: number[];
  max_scaling?: Record<string, number>;
  components: Record<string, number>;
  raw_damage: number;
  mitigation_multiplier: number;
  final_damage: number;
  pct_target_hp: number;
  cooldown: number;
  base_cooldown?: number;
  mana_cost?: number | null;
  description: string;
  desc_th?: string;
  icon_url?: string;
  base_damage?: number[];
  scaling?: Record<string, number>;
  warnings: string[];
}

export interface DuelSide {
  build: BuildStats;
  skills: SkillDamageRow[];
  basic_attack: {
    raw_per_hit: number;
    final_per_hit: number;
    attacks_per_sec: number;
    dps: number;
  };
  burst_combo: number;
  burst_pct_enemy_hp: number;
  combo_kills: boolean;
  active_combo_slots?: string[];
  effective_hp_physical: number;
  effective_hp_magic: number;
  burst_per_1000_gold: number | null;
  level_sweep: { level: number; burst: number; pct_enemy_hp: number }[];
}

export interface SimSide {
  remaining_hp: number;
  remaining_hp_pct: number;
  damage_dealt: number;
  damage_breakdown: Record<string, number>;
}

export interface DuelResult {
  a: DuelSide;
  b: DuelSide;
  simulation: {
    winner: "a" | "b" | "draw" | "timeout";
    time_to_kill: number | null;
    a: SimSide;
    b: SimSide;
    timeline: { t: number; hp_a: number; hp_b: number }[];
  };
  assumptions: string[];
}

export type Side = "a" | "b";

export const STAT_LABELS: {
  key: string;
  label: string;
  pct?: boolean;
  digits?: number;
}[] = [
  { key: "max_hp", label: "HP" },
  { key: "attack_damage", label: "พลังโจมตี (AD)" },
  { key: "ability_power", label: "พลังเวท (AP)" },
  { key: "armor", label: "เกราะ" },
  { key: "magic_defense", label: "ต้านเวท" },
  { key: "attack_speed", label: "ความเร็วโจมตี", pct: true },
  { key: "critical_chance", label: "คริติคอล", pct: true },
  { key: "critical_damage", label: "ดาเมจคริ", pct: true },
  { key: "cooldown_reduction", label: "ลดคูลดาวน์", pct: true },
  { key: "movement_speed", label: "ความเร็ววิ่ง" },
  { key: "armor_pierce_flat", label: "เจาะเกราะ" },
  { key: "armor_pierce_pct", label: "เจาะเกราะ %", pct: true },
  { key: "magic_pierce_flat", label: "เจาะเวท" },
  { key: "magic_pierce_pct", label: "เจาะเวท %", pct: true },
  { key: "life_steal", label: "ดูดเลือด", pct: true },
  { key: "magic_life_steal", label: "ดูดเลือดเวท", pct: true },
  { key: "max_mana", label: "มานา" },
  { key: "hp_regen_5s", label: "ฟื้น HP/5วิ" },
];

export function emptyBuild(hero: string, level = 12): CombatBuild {
  return {
    hero,
    level,
    items: [],
    arcana: {},
    primary_faction: null,
    primary_enchantments: [],
    secondary_faction: null,
    secondary_enchantments: [],
    skill_levels: {},
    skill_hits: {},
    skill_charges: {},
  };
}

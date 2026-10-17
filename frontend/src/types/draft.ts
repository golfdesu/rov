export type RoleType = "Warrior" | "Assassin" | "Mage" | "Marksman" | "Support" | "Tank";

export interface Hero {
  id: number;
  name: string;
  role: RoleType;
  lane: string;
  tier: "S+" | "S" | "A" | "B" | "C";
  image_url?: string;
}

export interface DraftStep {
  step: number;
  phase: number;
  action: "ban" | "pick";
  side: "blue" | "red";
  label?: string;
}

export interface HeroRecommendation {
  rank: number;
  hero_name: string;
  probability_pct: number;
  predicted_win_rate_pct: number;
  lookahead_win_rate_pct?: number | null;
  primary_lane: string;
  primary_role: string;
  synergy_edge_pct: number;
  counter_edge_pct: number;
  capabilities: string[];
}

export interface DraftPredictionResponse {
  architecture: string;
  mode: "pick" | "ban";
  side: "blue" | "red";
  phase: number;
  missing_ally_lanes: string[];
  recommendations: HeroRecommendation[];
}

export interface DraftHistoryItem {
  stepIndex: number;
  bluePicks: string[];
  redPicks: string[];
  blueBans: string[];
  redBans: string[];
}

export const CANONICAL_LANES = [
  { key: "DS_Lane", nameEn: "Dark Slayer Lane", nameTh: "ออฟเลน", icon: "⚔️" },
  { key: "Jungle", nameEn: "Jungle", nameTh: "ป่า", icon: "🌲" },
  { key: "Mid", nameEn: "Mid Lane", nameTh: "เลนกลาง", icon: "🔮" },
  { key: "Dragon_Lane", nameEn: "Abyssal Dragon", nameTh: "แครี่", icon: "🏹" },
  { key: "Roam", nameEn: "Support / Roam", nameTh: "โรมมิ่ง", icon: "🛡️" },
] as const;

export const CANONICAL_DRAFT_STEPS: DraftStep[] = [
  { step: 0, phase: 1, action: "ban", side: "blue", label: "Blue Ban 1" },
  { step: 1, phase: 1, action: "ban", side: "red", label: "Red Ban 1" },
  { step: 2, phase: 1, action: "ban", side: "blue", label: "Blue Ban 2" },
  { step: 3, phase: 1, action: "ban", side: "red", label: "Red Ban 2" },
  { step: 4, phase: 1, action: "pick", side: "blue", label: "Blue Pick 1" },
  { step: 5, phase: 1, action: "pick", side: "red", label: "Red Pick 1" },
  { step: 6, phase: 1, action: "pick", side: "red", label: "Red Pick 2" },
  { step: 7, phase: 1, action: "pick", side: "blue", label: "Blue Pick 2" },
  { step: 8, phase: 1, action: "pick", side: "blue", label: "Blue Pick 3" },
  { step: 9, phase: 1, action: "pick", side: "red", label: "Red Pick 3" },
  { step: 10, phase: 2, action: "ban", side: "red", label: "Red Ban 3" },
  { step: 11, phase: 2, action: "ban", side: "blue", label: "Blue Ban 3" },
  { step: 12, phase: 2, action: "ban", side: "red", label: "Red Ban 4" },
  { step: 13, phase: 2, action: "ban", side: "blue", label: "Blue Ban 4" },
  { step: 14, phase: 2, action: "pick", side: "red", label: "Red Pick 4" },
  { step: 15, phase: 2, action: "pick", side: "blue", label: "Blue Pick 4" },
  { step: 16, phase: 2, action: "pick", side: "blue", label: "Blue Pick 5" },
  { step: 17, phase: 2, action: "pick", side: "red", label: "Red Pick 5" },
];

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
  triggered_by?: string[];
  trigger_reason?: "counter" | "combo" | "ban_unlock" | "protect" | null;
}

export interface DraftPredictionResponse {
  architecture: string;
  mode: "pick" | "ban";
  side: "blue" | "red";
  phase: number;
  missing_ally_lanes: string[];
  recommendations: HeroRecommendation[];
  blue_next_picks?: HeroRecommendation[];
  red_next_picks?: HeroRecommendation[];
  blue_next_bans?: HeroRecommendation[];
  red_next_bans?: HeroRecommendation[];
  ban_unlocked_heroes?: HeroRecommendation[];
}

export interface DraftHistoryItem {
  stepIndex: number;
  bluePicks: string[];
  redPicks: string[];
  blueBans: string[];
  redBans: string[];
}

export type TeamId = "A" | "B";

export interface GlobalBanState {
  seriesName?: string;
  teamAName: string;
  teamBName: string;
  teamAUsed: string[];
  teamBUsed: string[];
  universalBans: string[];
  blueSideTeam: TeamId;
  gameNumber: number;
}

export interface RecordedDraftGame {
  id: string;
  gameNumber: number;
  timestamp: string;
  seriesName?: string;
  blueTeamName: string;
  redTeamName: string;
  blueSideTeam: TeamId;
  blueBans: string[];
  redBans: string[];
  bluePicks: string[];
  redPicks: string[];
  blueWinRate: number;
}

export interface DraftSessionPayload {
  stepIndex: number;
  bluePicks: string[];
  redPicks: string[];
  blueBans: string[];
  redBans: string[];
  history: DraftHistoryItem[];
  winHistory: (number | null)[];
  blueWinRate: number;
  useLookahead: boolean;
  globalBans: GlobalBanState;
  seriesGames: RecordedDraftGame[];
  updatedAt: number;
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

export interface DamageProfile {
  physical_pct: number;
  magic_pct: number;
  true_pct: number;
  verdict: string;
}

export interface MechanicsScore {
  hard_cc_score: number;
  burst_score: number;
  sustain_score: number;
  mobility_score: number;
  frontline_score: number;
}

export interface PowerSpikeTimeline {
  early_game: number;
  mid_game: number;
  late_game: number;
  peak_phase: string;
}

export interface SynergyPair {
  hero_a: string;
  hero_b: string;
  synergy_type: string;
  description: string;
}

export interface CompAlert {
  type: "warning" | "danger" | "good";
  title: string;
  message: string;
}

export interface MechanicHeroRecommendation {
  hero_name: string;
  primary_lane: string;
  primary_role: string;
  mechanic_fit_score: number;
  reasons: string[];
  fixes_weakness: string[];
  combo_partners: string[];
}

export interface CompAnalysisResponse {
  ally_heroes: string[];
  enemy_heroes: string[];
  damage_profile: DamageProfile;
  mechanics_scores: MechanicsScore;
  power_spike: PowerSpikeTimeline;
  synergy_pairs: SynergyPair[];
  alerts: CompAlert[];
  missing_lanes: string[];
  recommendations: MechanicHeroRecommendation[];
}

export type CompArchetype =
  | "all"
  | "wombo_combo"
  | "dive_mobility"
  | "poke_siege"
  | "hyper_sustain";

export interface DiscoveredComp {
  title: string;
  archetype: string;
  heroes: string[];
  lane_assignments: Record<string, string>;
  mechanic_score: number;
  novelty_score: number;
  pro_games_together: number;
  damage_profile: DamageProfile;
  mechanic_highlights: string[];
  key_combos: string[];
  power_curve: string;
}

export interface CompDiscoveryResponse {
  archetype: string;
  anchor_hero: string | null;
  total_evaluated: number;
  comps: DiscoveredComp[];
}



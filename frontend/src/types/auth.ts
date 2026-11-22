export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  email?: string | null;
  auth_provider?: "password" | "google" | "discord";
  display_name_is_custom?: boolean;
  display_label?: string;
  display_name_changes_remaining?: number;
  display_name_next_change_at?: number | null;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  user: AuthUser | null;
  google_login_enabled?: boolean;
  discord_login_enabled?: boolean;
  pricing_survey_answered?: boolean;
  pricing_survey_choice?: PricingSurveyChoice | null;
  is_admin?: boolean;
}

export type PricingSurveyChoice = "willing" | "not_willing";

export interface PricingSurveyResponse {
  recorded: boolean;
  choice: PricingSurveyChoice;
}

export interface AdminStatsResponse {
  generated_at_th: string;
  users: {
    total: number;
    new_today: number;
    google: number;
    discord: number;
    password_only: number;
    saved_draft_states: number;
    active_sessions: number;
    active_session_users: number;
    signups_by_day: { date: string; count: number }[];
  };
  survey: {
    total: number;
    willing_total: number;
    willing_member: number;
    willing_guest: number;
    not_willing_total: number;
    not_willing_member: number;
    not_willing_guest: number;
    willing_pct: number;
    recent: {
      id: number;
      choice: PricingSurveyChoice;
      is_guest: boolean;
      username: string | null;
      display_name?: string | null;
      email?: string | null;
      updated_at_th: string;
    }[];
  };
  cloudflare?: {
    today_uniques: number;
    today_page_views: number;
    today_requests: number;
    today_rum_visits: number;
    today_rum_pageloads: number;
    total_uniques: number;
    total_page_views: number;
    total_requests: number;
    total_rum_visits: number;
    total_rum_pageloads: number;
    referers_today?: { source: string; visits: number }[];
    referers_7d?: { source: string; visits: number }[];
  } | null;
  retention?: {
    today_dau: number;
    today_new: number;
    today_returning: number;
    total_tracked_clients: number;
    returning_clients: number;
    returning_pct: number;
    d1_eligible: number;
    d1_retained: number;
    d1_pct: number;
    daily_breakdown: { date: string; new: number; returning: number; total: number }[];
  } | null;
}

export interface AdminUserActivityItem {
  id: number;
  username: string;
  display_name: string;
  email?: string | null;
  auth_provider: string;
  created_at_th: string;
  active_days: number;
  first_visit?: string | null;
  last_visit?: string | null;
  saved_series_games: number;
  draft_step_index: number;
  last_draft_save_th?: string | null;
  practice_games: number;
  last_practice_save_th?: string | null;
  predict_calls: number;
  draft_save_calls: number;
  active_sessions: number;
  survey_choice?: PricingSurveyChoice | null;
}

export interface AdminGuestClientItem {
  client_id: string;
  active_days: number;
  first_visit?: string | null;
  last_visit?: string | null;
  predict_calls: number;
  device_type?: string | null;
}

export interface AdminUsersResponse {
  generated_at_th: string;
  total_users: number;
  users: AdminUserActivityItem[];
  top_guest_clients: AdminGuestClientItem[];
}

export interface AdminWtpSegment {
  n: number;
  willing: number;
  empirical_pct: number;
  wilson_ci_95: [number, number];
  bayes_posterior_pct: number;
  bayes_sd_pct: number;
}

export interface AdminZTestResult {
  diff_pct: number;
  z_stat: number;
  p_value: number;
  significant_95: boolean;
}

export interface AdminAnalyticsResponse {
  generated_at_th: string;
  markov_retention: {
    transitions: {
      new_to_active_pct: number;
      new_sample: number;
      retained_to_active_pct: number;
      retained_sample: number;
      dormant_to_resurrect_pct: number;
      dormant_sample: number;
    };
    expected_active_streak_days: number;
    retention_half_life_days: number | null;
    survival_curve: { day: number; eligible: number; survived: number; pct: number }[];
  };
  bayesian_wtp: {
    prior: string;
    engaged: AdminWtpSegment;
    casual: AdminWtpSegment;
    all_members: AdminWtpSegment;
    guests: AdminWtpSegment;
    engaged_vs_casual_test: AdminZTestResult;
    willing_vs_not_willing_engaged_rate: AdminZTestResult & {
      willing_engaged_pct: number;
      not_willing_engaged_pct: number;
    };
    spearman_engagement_vs_wtp: { n: number; rho: number; p_value: number };
  };
  member_vs_guest_retention: {
    member: { n: number; returning: number; rate_pct: number; ci_95: [number, number] };
    guest: { n: number; returning: number; rate_pct: number; ci_95: [number, number] };
    relative_risk: number;
    rr_ci_95: [number, number];
    p_value: number;
    significant_95: boolean;
  };
  usage_distribution: {
    total_users: number;
    users_with_saved_games: number;
    mean_games_per_user: number;
    variance_games: number;
    dispersion_index: number;
    process_regime: string;
    gini_coefficient: number;
    top_10pct_share_pct: number;
    top_20pct_share_pct: number;
  };
  load_forecast: {
    dau_next_day: { observed_days: number; expected_next_day: number; ci_low: number; ci_high: number };
    predicts_next_day: { observed_days: number; expected_next_day: number; ci_low: number; ci_high: number } | null;
  };
  ai_trust: {
    total_logged_picks: number;
    top1_count: number;
    top2_5_count: number;
    top6_10_count: number;
    offmeta_count: number;
    top1_pct: number;
    top5_pct: number;
    top5_wilson_ci_95: [number, number];
    top5_bayes_posterior_pct: number;
    top10_pct: number;
    random_top5_baseline_pct: number;
    binomial_z_vs_random: number;
    p_value: number;
  };
  latency: {
    total_requests: number;
    mean_ms: number;
    p50_ms: number;
    p95_ms: number;
    lookahead_count: number;
    buckets: { lt_25ms: number; ms_25_100: number; ms_100_500: number; gt_500ms: number };
  };
  guest_vs_member_predicts: {
    member: number;
    guest: number;
    total: number;
    member_share_pct: number;
    guest_share_pct: number;
  };
  feature_usage: {
    draft_completed_18: number;
    practice_completed_18: number;
    devices: { mobile: number; desktop: number };
    leagues: Record<string, number>;
    practice_modes: Record<string, number>;
    tools: {
      timer_start: number;
      pick_lane: number;
      replace_hero: number;
      practice_hints_off: number;
    };
  };
}

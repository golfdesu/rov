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

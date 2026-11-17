export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  email?: string | null;
  auth_provider?: "password" | "google" | "discord";
}

export interface AuthStatusResponse {
  authenticated: boolean;
  user: AuthUser | null;
  google_login_enabled?: boolean;
  discord_login_enabled?: boolean;
}

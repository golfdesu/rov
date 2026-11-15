export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  user: AuthUser | null;
}

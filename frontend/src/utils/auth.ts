import type { AuthUser } from "../types/auth";

export function accountLabel(user: AuthUser): string {
  if (user.display_label) return user.display_label;
  const displayName = user.display_name.trim();
  if (user.display_name_is_custom && displayName) return displayName;

  if (user.auth_provider === "google") {
    const firstName = displayName.split(/\s+/, 1)[0];
    if (firstName && !firstName.includes("@")) return firstName;
  }

  return `@${user.username}`;
}

export function restorePreviewAccountStorage(user: AuthUser, prefixes: readonly string[]): void {
  if (!import.meta.env.DEV) return;
  const previewScope = `account:${user.id}`;
  const migrationKey = `minidraft_account_storage_migrated_v1:${previewScope}`;
  try {
    if (!localStorage.getItem(migrationKey)) return;
    for (const prefix of prefixes) {
      const preview = localStorage.getItem(`${prefix}:${previewScope}`);
      if (preview !== null) localStorage.setItem(`${prefix}:user:${user.username}`, preview);
    }
    localStorage.removeItem(migrationKey);
  } catch {
    // Retry on the next auth refresh if copying was blocked.
  }
}

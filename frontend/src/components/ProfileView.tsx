import { ArrowLeft, Check, Copy, Pencil, User } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { useLanguage } from "../i18n/language";
import type { AuthUser } from "../types/auth";
import { accountLabel } from "../utils/auth";
import { handleSpaLinkClick } from "../utils/navigation";
import { Alert } from "./Alert";
import { BillingSandbox } from "./BillingSandbox";
import { TeamSandbox } from "./TeamSandbox";
import { StableButtonLabel } from "./StableButtonLabel";

interface ProfileViewProps {
  user: AuthUser;
  onSaveDisplayName: (displayName: string) => Promise<void>;
}

const DISPLAY_NAME_HINT = "ใส่ชื่อที่แสดง 1–40 ตัวอักษร";
const BUTTON_CLASS = "inline-flex min-h-9 items-center justify-center gap-2 border px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-gold";

function displayNameError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่";
    if (error.status === 409) return "ข้อมูลบัญชีเปลี่ยนไป กรุณาโหลดหน้าใหม่";
    if (error.status === 422) return DISPLAY_NAME_HINT;
    if (error.status === 429) return "ยังไม่ถึงเวลาเปลี่ยนชื่อครั้งถัดไป";
  }
  return "บันทึกชื่อที่แสดงไม่สำเร็จ กรุณาลองใหม่";
}

export function ProfileView({ user, onSaveDisplayName }: ProfileViewProps) {
  const { language, t } = useLanguage();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const quotaRef = useRef<HTMLParagraphElement>(null);
  const returnToEditRef = useRef(false);
  const copyTimerRef = useRef<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copiedUsername, setCopiedUsername] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const accountName = accountLabel(user);
  const freeChanges = retryAt === null ? user.display_name_changes_remaining ?? 3 : 0;
  const unlockAt = Math.max(user.display_name_next_change_at ?? 0, retryAt ?? 0) * 1000;
  const coolingDown = unlockAt > now;
  const quotaMessage = coolingDown
    ? t("เปลี่ยนได้อีกครั้ง {0}", new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(unlockAt))
    : freeChanges > 0
      ? t("เปลี่ยนชื่อได้อีก {0} ครั้ง", freeChanges)
      : t("เปลี่ยนชื่อได้ (หลังบันทึกต้องรอ 14 วัน)");

  useEffect(() => titleRef.current?.focus(), []);
  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    },
    [],
  );
  useEffect(() => {
    if (!coolingDown) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, unlockAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [coolingDown, now, unlockAt]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    } else if (returnToEditRef.current) {
      if (editRef.current?.disabled) quotaRef.current?.focus();
      else editRef.current?.focus();
      returnToEditRef.current = false;
    }
  }, [editing]);

  function closeEditor() {
    returnToEditRef.current = true;
    setEditing(false);
    setError(null);
  }

  async function saveDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || coolingDown) return;
    const nextDisplayName = displayName.trim();
    if (!nextDisplayName || nextDisplayName.length > 40) {
      setError(DISPLAY_NAME_HINT);
      inputRef.current?.focus();
      return;
    }
    if (nextDisplayName === accountName) {
      closeEditor();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSaveDisplayName(nextDisplayName);
      closeEditor();
      setSaved(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        const detail = error.detail;
        if (detail && typeof detail === "object" && "available_at" in detail && typeof detail.available_at === "number") {
          setRetryAt(detail.available_at);
        }
      }
      setError(displayNameError(error));
    } finally {
      setSaving(false);
    }
  }

  function copyUsername() {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    void navigator.clipboard
      .writeText(`@${user.username}`)
      .then(() => {
        setCopiedUsername(true);
        if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
        copyTimerRef.current = window.setTimeout(() => {
          copyTimerRef.current = null;
          setCopiedUsername(false);
        }, 2000);
      })
      .catch(() => {});
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:py-8">
      <div className={`mx-auto space-y-4 ${user.stripe_sandbox_enabled ? "max-w-4xl" : "max-w-xl"}`}>
        <a
          href="/"
          onClick={(e) => handleSpaLinkClick(e, "/")}
          className="inline-flex min-h-9 items-center gap-2 text-sm text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-gold"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("กลับไปหน้าดราฟต์")}
        </a>
        <div className={user.stripe_sandbox_enabled ? "grid grid-cols-1 items-start gap-5 lg:grid-cols-12" : "space-y-4"}>
        <div className={user.stripe_sandbox_enabled ? "space-y-5 lg:col-span-5" : "space-y-4"}>
        <section className="border border-line bg-panel">
          <div className="flex items-center justify-between gap-3 border-b border-line bg-linear-to-r from-gold/10 to-transparent p-4 sm:p-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="clip-chamfer-sm grid size-10 shrink-0 place-items-center border border-gold/40 bg-gold/10 text-gold">
                <User className="size-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h1 ref={titleRef} tabIndex={-1} className="truncate font-display text-lg font-bold text-ink outline-none">
                  {accountName}
                </h1>
                <p className="truncate font-mono text-xs text-muted">@{user.username}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={copyUsername}
              aria-label={t("คัดลอกชื่อผู้ใช้ @{0}", user.username)}
              className="inline-flex min-h-8 shrink-0 items-center gap-1.5 border border-line-strong bg-panel-2 px-2.5 font-mono text-[11px] font-semibold text-ink transition-colors hover:border-gold/60 hover:text-gold"
            >
              {copiedUsername ? <Check className="size-3.5 text-good" aria-hidden="true" /> : <Copy className="size-3.5 text-muted" aria-hidden="true" />}
              <span>{copiedUsername ? t("คัดลอกแล้ว") : t("คัดลอก")}</span>
            </button>
          </div>
          <div className="space-y-3 p-4 sm:p-5">
            {editing ? (
              <form className="space-y-3" onSubmit={saveDisplayName} aria-busy={saving} noValidate>
                <label className="block space-y-1.5 text-sm font-semibold text-ink">
                  <span className="flex items-center justify-between gap-2">
                    <span>{t("ชื่อที่แสดง")}</span>
                    <span className="font-mono text-xs font-normal tabular-nums text-dim">{displayName.trim().length}/40</span>
                  </span>
                  <input
                    ref={inputRef}
                    type="text"
                    required
                    autoComplete="nickname"
                    maxLength={40}
                    value={displayName}
                    readOnly={saving}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "profile-display-name-error" : undefined}
                    onChange={(event) => { setDisplayName(event.target.value); setError(null); }}
                    className="min-h-10 w-full border border-line-strong bg-bg px-3 text-base text-ink focus:border-gold/60 focus-visible:outline-2 focus-visible:outline-gold"
                  />
                </label>
                {error && <div id="profile-display-name-error"><Alert>{t(error)}</Alert></div>}
                <div className="flex justify-end gap-2">
                  <button type="button" disabled={saving} onClick={closeEditor} className={`${BUTTON_CLASS} border-line-strong text-ink hover:bg-panel-2 disabled:opacity-50`}>
                    <StableButtonLabel message="ยกเลิก" />
                  </button>
                  <button type="submit" disabled={saving || coolingDown} className={`${BUTTON_CLASS} border-gold bg-gold text-bg hover:bg-gold/90 disabled:opacity-50`}>
                    <StableButtonLabel message={saving ? "กำลังบันทึก…" : "บันทึก"} alternatives={["บันทึก", "กำลังบันทึก…"]} />
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted">{t("ชื่อที่แสดง")}</p>
                  <p className="break-words text-sm font-semibold text-ink">{accountName}</p>
                </div>
                <button
                  ref={editRef}
                  type="button"
                  aria-label={t("แก้ไขชื่อที่แสดง")}
                  aria-describedby="profile-display-name-quota"
                  disabled={coolingDown}
                  onClick={() => {
                    setDisplayName(user.display_name_is_custom || accountName !== `@${user.username}` ? accountName : "");
                    setSaved(false);
                    setEditing(true);
                  }}
                  className={`${BUTTON_CLASS} shrink-0 border-line-strong text-ink enabled:hover:bg-panel-2 disabled:opacity-50`}
                >
                  <Pencil className="size-3.5" aria-hidden="true" />
                  <StableButtonLabel message="แก้ไข" />
                </button>
              </div>
            )}
            <p id="profile-display-name-quota" ref={quotaRef} role="status" tabIndex={-1} className="text-xs text-muted">
              {quotaMessage}
            </p>
            {saved && <p role="status" className="text-sm text-good">{t("บันทึกชื่อที่แสดงแล้ว")}</p>}
          </div>
        </section>
        </div>
        {user.stripe_sandbox_enabled && (
          <div className="space-y-5 lg:col-span-7">
            <BillingSandbox key={`billing-${user.id}`} username={user.username} livemode={Boolean(user.stripe_livemode)} />
            <TeamSandbox key={`team-${user.id}`} currentUsername={user.username} />
          </div>
        )}
        </div>
      </div>
    </main>
  );
}

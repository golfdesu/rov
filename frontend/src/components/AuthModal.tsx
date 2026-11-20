import { ArrowRight, Eye, EyeOff, Lock, LogIn, Sparkles, User, UserCheck, UserPlus, X } from "lucide-react";
import { type FormEvent, type RefObject, useRef, useState } from "react";
import { postJson } from "../api/client";
import type { AuthStatusResponse, AuthUser } from "../types/auth";
import { Alert } from "./Alert";
import { Modal } from "./Modal";
import { MiniDraftLogo } from "./MiniDraftLogo";

const SHOWCASE_BLUE = [
  { name: "Florentino", src: "/avatars/Florentino.jpg" },
  { name: "Aoi", src: "/avatars/Aoi.jpg" },
  { name: "Liliana", src: "/avatars/Liliana.jpg" },
  { name: "Hayate", src: "/avatars/Hayate.jpg" },
  { name: "Toro", src: "/avatars/Toro.jpg" },
] as const;

const SHOWCASE_RED = [
  { name: "Yena", src: "/avatars/Yena.jpg" },
  { name: "Keera", src: "/avatars/Keera.jpg" },
  { name: "Krixi", src: "/avatars/Krixi.jpg" },
  { name: "Capheny", src: "/avatars/Capheny.jpg" },
  { name: "Rouie", src: "/avatars/Rouie.jpg" },
] as const;

interface AuthFormProps {
  mode: "login" | "register";
  onModeChange: (next: "login" | "register") => void;
  onSuccess: (
    user: AuthUser,
    surveyAnswered?: boolean,
    surveyChoice?: "willing" | "not_willing" | null,
    isAdmin?: boolean,
  ) => void;
  usernameRef?: RefObject<HTMLInputElement | null>;
  secondaryLabel: string;
  secondaryHint?: string;
  onSecondaryAction: () => void;
  googleLoginEnabled?: boolean;
  discordLoginEnabled?: boolean;
  initialError?: string | null;
  showPrivacyLink?: boolean;
}

function DiscordIcon() {
  return (
    <svg className="h-4 w-4 shrink-0 fill-current" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.230 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function formatAuthError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes("403") || raw.toLowerCase().includes("reserved")) {
    return "ชื่อผู้ใช้นี้สงวนไว้สำหรับผู้ดูแลระบบ กรุณาใช้ชื่ออื่น";
  }
  if (raw.includes("409") || raw.toLowerCase().includes("already taken")) {
    return "ชื่อผู้ใช้นี้มีคนใช้แล้ว กรุณาเลือกชื่ออื่น";
  }
  if (raw.includes("401") || raw.toLowerCase().includes("invalid username")) {
    return "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
  }
  if (raw.includes("429")) {
    return "ลองบ่อยเกินไป กรุณารอสัก 1 นาทีแล้วลองใหม่";
  }
  if (raw.includes("422")) {
    return "ชื่อผู้ใช้ต้องเป็น a-z, 0-9, _, -, . (3–32 ตัว) และรหัสผ่านอย่างน้อย 6 ตัว";
  }
  return raw;
}

const INPUT_CLASS =
  "h-10 w-full rounded-md border border-line bg-bg pl-9 text-sm text-ink placeholder:text-dim transition-colors hover:border-line-strong focus:border-gold/80 focus:outline-none";

function AuthForm({
  mode,
  onModeChange,
  onSuccess,
  usernameRef,
  secondaryLabel,
  secondaryHint,
  onSecondaryAction,
  googleLoginEnabled = false,
  discordLoginEnabled = false,
  initialError = null,
  showPrivacyLink = true,
}: AuthFormProps) {
  const hasOAuth = googleLoginEnabled || discordLoginEnabled;
  const [showCredentials, setShowCredentials] = useState(!hasOAuth);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [prevInitialError, setPrevInitialError] = useState<string | null>(initialError);
  const [error, setError] = useState<string | null>(initialError);

  if (prevInitialError !== initialError) {
    setPrevInitialError(initialError);
    setError(initialError);
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmedUser = username.trim();
    if (!trimmedUser || !password) {
      setError("กรุณากรอกชื่อผู้ใช้และรหัสผ่าน");
      return;
    }

    setSubmitting(true);
    try {
      const endpoint = mode === "register" ? "/auth/register" : "/auth/login";
      const body =
        mode === "register"
          ? { username: trimmedUser, password, display_name: displayName.trim() || undefined }
          : { username: trimmedUser, password };
      const res = await postJson<AuthStatusResponse>(endpoint, body);
      if (res.authenticated && res.user) {
        onSuccess(
          res.user,
          Boolean(res.pricing_survey_answered),
          res.pricing_survey_choice ?? null,
          Boolean(res.is_admin),
        );
      } else {
        setError("ไม่สามารถยืนยันตัวตนได้ กรุณาลองใหม่");
      }
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const tabClass = (active: boolean) =>
    `-mb-px border-b-2 py-3 font-display text-sm font-semibold transition-colors lg:text-[15px] ${
      active ? "border-gold text-ink" : "border-transparent text-muted hover:text-ink"
    }`;

  return (
    <>
      <div className="px-6">
        <div role="tablist" className="grid grid-cols-2 border-b border-line">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            onClick={() => {
              onModeChange("login");
              setError(null);
            }}
            className={tabClass(mode === "login")}
          >
            เข้าสู่ระบบ
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            onClick={() => {
              onModeChange("register");
              setError(null);
            }}
            className={tabClass(mode === "register")}
          >
            สมัครสมาชิก
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 pt-5 pb-6">
        {error && <Alert>{error}</Alert>}

        <div className="flex flex-col gap-2">
          {googleLoginEnabled && (
            <button
              type="button"
              onClick={() => window.location.assign("/auth/google/login")}
              className="flex h-10 w-full items-center justify-center gap-2.5 rounded-md border border-white/80 bg-white px-4 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100 lg:h-11 lg:text-[15px]"
            >
              <GoogleIcon />
              <span>ดำเนินการต่อด้วย Google</span>
            </button>
          )}
          {discordLoginEnabled && (
            <button
              type="button"
              onClick={() => window.location.assign("/auth/discord/login")}
              className="flex h-10 w-full items-center justify-center gap-2.5 rounded-md border border-[#5865F2] bg-[#5865F2] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4752C4] lg:h-11 lg:text-[15px]"
            >
              <DiscordIcon />
              <span>ดำเนินการต่อด้วย Discord</span>
            </button>
          )}
          {!showCredentials && (
            <button
              type="button"
              onClick={() => {
                setShowCredentials(true);
                requestAnimationFrame(() => usernameRef?.current?.focus());
              }}
              className="flex h-10 w-full items-center justify-center gap-2.5 rounded-md border border-line-strong bg-bg px-4 text-sm font-semibold text-ink transition-colors hover:border-gold/70 hover:bg-panel-2 lg:h-11 lg:text-[15px]"
            >
              <User className="h-4 w-4 shrink-0 text-gold" />
              <span>{mode === "login" ? "เข้าสู่ระบบด้วย Username" : "สมัครสมาชิกด้วย Username"}</span>
            </button>
          )}
        </div>

        {showCredentials && (
          <div className="flex flex-col gap-3.5 rounded-md border border-line bg-bg/50 p-3.5">
            {hasOAuth && (
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-gold lg:text-[13px]">
                  <User className="h-3.5 w-3.5" />
                  <span>{mode === "login" ? "เข้าสู่ระบบด้วย Username" : "สมัครด้วย Username"}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setShowCredentials(false);
                    setError(null);
                  }}
                  className="inline-flex min-h-6 min-w-6 items-center justify-center px-1.5 text-xs text-dim underline underline-offset-2 hover:text-ink lg:text-[13px]"
                >
                  ซ่อน
                </button>
              </div>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="flex items-center justify-between text-xs font-medium text-ink/90 sm:text-sm">
                <span>ชื่อผู้ใช้</span>
                <span className="font-mono text-[11px] text-dim sm:text-xs">a-z 0-9 _ - .</span>
              </span>
              <div className="relative flex items-center">
                <User className="pointer-events-none absolute left-3 h-4 w-4 text-dim" />
                <input
                  ref={usernameRef}
                  type="text"
                  autoComplete="username"
                  required
                  minLength={3}
                  maxLength={32}
                  pattern="^[a-zA-Z0-9_.\-]+$"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="เช่น coach_pro"
                  className={`${INPUT_CLASS} pr-3 font-mono`}
                />
              </div>
            </label>

            {mode === "register" && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink/90 sm:text-sm">
                  ชื่อที่แสดง <span className="font-normal text-dim">(ไม่บังคับ)</span>
                </span>
                <div className="relative flex items-center">
                  <Sparkles className="pointer-events-none absolute left-3 h-4 w-4 text-dim" />
                  <input
                    type="text"
                    maxLength={40}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="เช่น Coach A"
                    className={`${INPUT_CLASS} pr-3`}
                  />
                </div>
              </label>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="flex items-center justify-between text-xs font-medium text-ink/90 sm:text-sm">
                <span>รหัสผ่าน</span>
                {mode === "register" && <span className="font-mono text-[11px] text-dim sm:text-xs">อย่างน้อย 6 ตัวอักษร</span>}
              </span>
              <div className="relative flex items-center">
                <Lock className="pointer-events-none absolute left-3 h-4 w-4 text-dim" />
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  required
                  minLength={mode === "register" ? 6 : 1}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={`${INPUT_CLASS} pr-10 font-mono`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                  className="absolute right-2 p-1.5 text-dim transition-colors hover:text-ink"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="mt-0.5 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-gold px-4 font-display text-sm font-bold text-bg transition-colors hover:bg-[#f8d27a] active:bg-[#e9b73f] disabled:opacity-50"
            >
              {mode === "login" ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
              <span>{submitting ? "กำลังดำเนินการ…" : mode === "login" ? "เข้าสู่ระบบ" : "สร้างบัญชีและเข้าใช้งาน"}</span>
            </button>
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-line" />
          <span className="text-xs text-dim lg:text-[13px]">หรือ</span>
          <div className="h-px flex-1 bg-line" />
        </div>

        <button
          type="button"
          onClick={onSecondaryAction}
          className="group flex w-full items-center justify-between gap-3 rounded-md border border-[#475569] bg-[#334155] px-3.5 py-2.5 text-left transition-colors hover:border-[#64748b] hover:bg-[#3e4f66]"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[#64748b]/60 bg-[#1e293b] text-slate-100">
              <UserCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="font-display text-sm font-semibold text-white lg:text-[15px]">{secondaryLabel}</div>
              {secondaryHint && <div className="truncate text-xs text-slate-300 lg:text-[13px]">{secondaryHint}</div>}
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-white" />
        </button>

        {showPrivacyLink && (
          <div className="text-center text-xs text-dim lg:text-[13px]">
            <a
              href="/privacy"
              className="inline-flex min-h-6 items-center underline decoration-line-strong underline-offset-2 hover:text-muted"
            >
              นโยบายความเป็นส่วนตัว (Privacy Policy)
            </a>
          </div>
        )}
      </form>
    </>
  );
}

interface ShowcaseTeamProps {
  side: "blue" | "red";
  heroes: ReadonlyArray<{ name: string; src: string }>;
}

/** One side of the broadcast-style draft preview (red side is mirrored, like the in-game draft). */
function ShowcaseTeam({ side, heroes }: ShowcaseTeamProps) {
  const isBlue = side === "blue";
  return (
    <div
      className={
        isBlue
          ? "border-l-2 border-l-blue px-4 py-3.5 sm:border-r sm:border-r-line"
          : "border-t border-l-2 border-t-line border-l-red px-4 py-3.5 sm:border-t-0 sm:border-l-0 sm:border-r-2 sm:border-r-red"
      }
    >
      <div className={`mb-2.5 flex items-baseline justify-between ${isBlue ? "" : "sm:flex-row-reverse"}`}>
        <span className={`font-display text-xs font-bold tracking-[0.18em] ${isBlue ? "text-blue" : "text-red"}`}>
          {isBlue ? "BLUE SIDE" : "RED SIDE"}
        </span>
        <span className="font-mono text-[10px] tracking-wider text-dim">{isBlue ? "FIRST PICK" : "SECOND PICK"}</span>
      </div>
      <div className="grid grid-cols-5 gap-1.5" dir={isBlue ? undefined : "rtl"}>
        {heroes.map((hero, i) => (
          <figure key={hero.name} className="m-0">
            <div
              className={`aspect-square overflow-hidden rounded-sm border bg-bg ${
                isBlue ? "border-blue/35" : "border-red/35"
              }`}
            >
              <img src={hero.src} alt={hero.name} className="h-full w-full object-cover" />
            </div>
            <figcaption className="mt-1 text-center font-mono text-[9.5px] text-dim">
              {isBlue ? "B" : "R"}
              {i + 1}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

interface AuthLandingProps {
  googleLoginEnabled?: boolean;
  discordLoginEnabled?: boolean;
  initialError?: string | null;
  onSuccess: (
    user: AuthUser,
    surveyAnswered?: boolean,
    surveyChoice?: "willing" | "not_willing" | null,
    isAdmin?: boolean,
  ) => void;
  onContinueGuest: () => void;
}

/** Formal broadcast-analytics landing portal with login/register and instant Guest access. */
export function AuthLanding({
  googleLoginEnabled = false,
  discordLoginEnabled = false,
  initialError = null,
  onSuccess,
  onContinueGuest,
}: AuthLandingProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const usernameRef = useRef<HTMLInputElement>(null);
  const loginCardRef = useRef<HTMLElement>(null);

  const stats = [
    { value: "130", label: "ฮีโร่ครบเมต้า 2026" },
    { value: "Bo1–Bo7", label: "รองรับทุกรูปแบบซีรีส์" },
    __DRAFT_ONLY__
      ? { value: "Global Ban", label: "กติกาการแข่งขันจริง" }
      : { value: "3,512", label: "เกมโปรลีกระดับโลก" },
  ];

  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-hidden overflow-y-auto bg-bg">
      {/* Static backdrop: soft top vignette + faint dot texture (no glows) */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_90%_55%_at_50%_-5%,var(--color-panel-2),transparent_70%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(var(--color-line)_1px,transparent_1px)] bg-[size:22px_22px] opacity-60 [mask-image:radial-gradient(ellipse_65%_55%_at_50%_35%,#000_25%,transparent_80%)]"
      />

      {/* Top bar */}
      <header className="relative z-10 border-b border-line bg-bg/80 backdrop-blur-sm">
        <div className="h-px w-full bg-gold/70" />
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <MiniDraftLogo className="h-7 w-7 shrink-0" />
            <span className="font-display text-sm font-bold tracking-[0.2em] text-ink">
              MINI<span className="text-gold">DRAFT</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded border border-gold/40 bg-gold/10 px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider text-gold sm:text-[11px]">
              ให้บริการฟรีถึง 30/11/2026
            </span>
            <span className="hidden rounded border border-line px-2.5 py-1 font-mono text-[10px] tracking-wider text-muted sm:inline-block">
              130 HEROES · 2026 META
            </span>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 items-center px-4 py-8 sm:px-6 lg:py-14">
        <div className="grid w-full grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-14">
          {/* Left column: product overview */}
          <section className="flex flex-col gap-7 lg:col-span-7">
            <div>
              <div className="flex items-center gap-3">
                <span className="h-px w-8 bg-gold" />
                <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">
                  RoV Pro Draft Intelligence
                </span>
              </div>
              <h1 className="mt-4 font-display text-[28px] font-bold leading-[1.2] tracking-tight text-ink sm:text-[40px]">
                วิเคราะห์และจำลอง <span className="text-gold">Ban / Pick</span>
                <span className="block text-ink/90">ระดับการแข่งขันอาชีพ</span>
              </h1>
              <p className="mt-3.5 max-w-xl text-sm leading-relaxed text-muted">
                ประเมินฮีโร่แก้ทาง ความเข้ากันของทีม และโอกาสชนะแบบเรียลไทม์ ตามกติกา Global Ban Pick
                สำหรับทีมแข่ง โค้ช และนักวิเคราะห์ ใช้งานได้ทั้งคอมพิวเตอร์ iPad และมือถือ
              </p>

              <dl className="mt-6 grid max-w-xl grid-cols-3 divide-x divide-line border-y border-line">
                {stats.map((s) => (
                  <div key={s.label} className="px-4 py-3 first:pl-0">
                    <dd className="font-mono text-base font-bold text-ink sm:text-lg">{s.value}</dd>
                    <dt className="mt-0.5 text-[11px] leading-snug text-muted">{s.label}</dt>
                  </div>
                ))}
              </dl>

              <div className="mt-6 flex flex-wrap items-center gap-2.5 sm:gap-3">
                <button
                  type="button"
                  onClick={onContinueGuest}
                  className="group inline-flex items-center gap-2 rounded-md border border-line-strong bg-panel px-4 py-2.5 font-display text-[13px] font-semibold text-ink transition-colors hover:border-blue/60 hover:bg-panel-2"
                >
                  <UserCheck className="h-4 w-4 shrink-0 text-blue" />
                  <span>เข้าใช้งานแบบ Guest ทันที</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted transition-all group-hover:translate-x-0.5 group-hover:text-blue" />
                </button>
                <button
                  type="button"
                  onClick={() => loginCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  className="inline-flex items-center gap-2 rounded-md border border-gold bg-gold px-4 py-2.5 font-display text-[13px] font-bold text-bg transition-colors hover:bg-[#f8d27a] lg:hidden"
                >
                  <LogIn className="h-4 w-4 shrink-0" />
                  <span>เข้าสู่ระบบ</span>
                </button>
              </div>
              <p className="mt-2 text-xs text-dim">
                ไม่ต้องสมัครสมาชิก · เปิดกระดานดราฟต์ได้ทันที หรือเข้าสู่ระบบด้วย Google / Discord / Username
              </p>
            </div>

            {/* Broadcast-style draft preview */}
            <div className="overflow-hidden rounded-lg border border-line bg-panel/90">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-dim">Draft Preview · Game 1</span>
                <span className="font-mono text-[10.5px] tracking-wider text-muted">GLOBAL BAN · BO5</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2">
                <ShowcaseTeam side="blue" heroes={SHOWCASE_BLUE} />
                <ShowcaseTeam side="red" heroes={SHOWCASE_RED} />
              </div>
              <div className="border-t border-line px-4 py-3">
                <div className="mb-2 flex items-center justify-between font-mono text-[11px]">
                  <span className="font-bold text-blue">52.4%</span>
                  <span className="tracking-[0.18em] text-dim">WIN PROBABILITY</span>
                  <span className="font-bold text-red">47.6%</span>
                </div>
                <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full">
                  <div className="h-full rounded-l-full bg-blue" style={{ width: "52.4%" }} />
                  <div className="h-full flex-1 rounded-r-full bg-red" />
                </div>
              </div>
            </div>
          </section>

          {/* Right column: sign-in card */}
          <section ref={loginCardRef} className="scroll-mt-4 lg:col-span-5">
            <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-[0_24px_60px_-24px_rgba(0,0,0,0.8)]">
              <div className="h-0.5 w-full bg-gold" />
              <div className="border-b border-line px-6 py-5">
                <h2 className="font-display text-base font-bold text-ink">
                  {mode === "login" ? "ลงชื่อเข้าใช้ MiniDraft" : "สร้างบัญชีผู้ใช้ใหม่"}
                </h2>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">
                  {__DRAFT_ONLY__
                    ? "บันทึกประวัติซีรีส์ Global Ban และซิงก์ข้ามอุปกรณ์อัตโนมัติ"
                    : "บันทึกซีรีส์ Global Ban และบิลด์ Combat Lab พร้อมซิงก์ข้ามอุปกรณ์"}
                </p>
              </div>

              <AuthForm
                mode={mode}
                onModeChange={setMode}
                onSuccess={onSuccess}
                usernameRef={usernameRef}
                secondaryLabel="เข้าใช้งานแบบ Guest"
                secondaryHint="ใช้งานได้ทันที ข้อมูลบันทึกในเบราว์เซอร์นี้"
                onSecondaryAction={onContinueGuest}
                googleLoginEnabled={googleLoginEnabled}
                discordLoginEnabled={discordLoginEnabled}
                initialError={initialError}
                showPrivacyLink={false}
              />
            </div>
          </section>
        </div>
      </main>

      <footer className="relative z-10 border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-[11px] text-dim sm:px-6">
          <span>© 2026 MiniDraft · อ้างอิงเมต้าโปรลีกระดับโลก</span>
          <a
            href="/privacy"
            className="inline-flex min-h-6 items-center py-1 underline decoration-line-strong underline-offset-2 hover:text-muted"
          >
            นโยบายความเป็นส่วนตัว (Privacy Policy)
          </a>
        </div>
      </footer>
    </div>
  );
}

interface AuthModalProps {
  initialMode?: "login" | "register";
  googleLoginEnabled?: boolean;
  discordLoginEnabled?: boolean;
  initialError?: string | null;
  onSuccess: (
    user: AuthUser,
    surveyAnswered?: boolean,
    surveyChoice?: "willing" | "not_willing" | null,
    isAdmin?: boolean,
  ) => void;
  onClose: () => void;
}

export function AuthModal({
  initialMode = "login",
  googleLoginEnabled = false,
  discordLoginEnabled = false,
  initialError = null,
  onSuccess,
  onClose,
}: AuthModalProps) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const usernameRef = useRef<HTMLInputElement>(null);

  return (
    <Modal
      labelledBy="auth-modal-title"
      initialFocusRef={usernameRef}
      onClose={onClose}
      className="max-w-md overflow-hidden [clip-path:none] lg:max-w-lg"
    >
      {(requestClose) => (
        <>
      <div className="h-0.5 w-full bg-gold" />
      <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <MiniDraftLogo className="h-8 w-8 shrink-0" />
          <div className="min-w-0">
            <h2 id="auth-modal-title" className="font-display text-sm font-bold text-ink sm:text-base">
              {mode === "login" ? "ลงชื่อเข้าใช้ MiniDraft" : "สร้างบัญชีผู้ใช้ใหม่"}
            </h2>
            <p className="truncate text-xs text-muted sm:text-[13px]">ซิงก์ประวัติซีรีส์ข้ามอุปกรณ์อัตโนมัติ</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => requestClose()}
          aria-label="ปิดหน้าต่างบัญชีผู้ใช้"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-dim transition-colors hover:bg-panel-2 hover:text-ink"
        >
          <X className="h-4.5 w-4.5" />
        </button>
      </div>

      <AuthForm
        mode={mode}
        onModeChange={setMode}
        onSuccess={onSuccess}
        usernameRef={usernameRef}
        secondaryLabel="ใช้งานต่อแบบ Guest"
        secondaryHint="บันทึกเฉพาะในเบราว์เซอร์นี้เท่านั้น"
        onSecondaryAction={() => requestClose()}
        googleLoginEnabled={googleLoginEnabled}
        discordLoginEnabled={discordLoginEnabled}
        initialError={initialError}
      />
        </>
      )}
    </Modal>
  );
}

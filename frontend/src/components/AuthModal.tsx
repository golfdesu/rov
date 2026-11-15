import { LogIn, UserPlus, X } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { postJson } from "../api/client";
import type { AuthStatusResponse, AuthUser } from "../types/auth";
import { Alert } from "./Alert";
import { Modal } from "./Modal";

interface AuthModalProps {
  initialMode?: "login" | "register";
  onSuccess: (user: AuthUser) => void;
  onClose: () => void;
}

export function AuthModal({ initialMode = "login", onSuccess, onClose }: AuthModalProps) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

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
        onSuccess(res.user);
      } else {
        setError("ไม่สามารถยืนยันตัวตนได้ กรุณาลองใหม่");
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (raw.includes("409") || raw.toLowerCase().includes("already taken")) {
        setError("ชื่อผู้ใช้นี้มีคนใช้แล้ว กรุณาเลือกชื่ออื่น");
      } else if (raw.includes("401") || raw.toLowerCase().includes("invalid username")) {
        setError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
      } else if (raw.includes("429")) {
        setError("ลองบ่อยเกินไป กรุณารอสัก 1 นาทีแล้วลองใหม่");
      } else if (raw.includes("422")) {
        setError("ชื่อผู้ใช้ต้องเป็น a-z, 0-9, _, -, . (3–32 ตัว) และรหัสผ่านอย่างน้อย 6 ตัว");
      } else {
        setError(raw);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal labelledBy="auth-modal-title" initialFocusRef={usernameRef} onClose={onClose} className="max-w-md">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          {mode === "login" ? <LogIn className="h-4 w-4 text-gold" /> : <UserPlus className="h-4 w-4 text-gold" />}
          <h2 id="auth-modal-title" className="font-display text-sm font-bold tracking-wider uppercase text-ink">
            {mode === "login" ? "เข้าสู่ระบบ (Sync ข้ามอุปกรณ์)" : "สมัครสมาชิกใหม่"}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิดหน้าต่างบัญชีผู้ใช้"
          className="p-1 text-dim transition-colors hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Mode Switch Tabs */}
      <div className="grid grid-cols-2 border-b border-line bg-bg/60">
        <button
          type="button"
          onClick={() => {
            setMode("login");
            setError(null);
          }}
          className={`border-b-2 py-2 font-display text-xs font-bold tracking-wide transition-colors ${
            mode === "login" ? "border-gold bg-panel text-gold" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          เข้าสู่ระบบ
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("register");
            setError(null);
          }}
          className={`border-b-2 py-2 font-display text-xs font-bold tracking-wide transition-colors ${
            mode === "register" ? "border-gold bg-panel text-gold" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          สมัครสมาชิก
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4">
        {error && <Alert>{error}</Alert>}

        <p className="text-xs leading-relaxed text-muted">
          {import.meta.env.VITE_DRAFT_ONLY === "true"
            ? "เมื่อเข้าสู่ระบบ ประวัติการดราฟต์และซีรีส์ Global Ban จะถูกแยกเก็บในฐานข้อมูลส่วนตัวของคุณ และซิงก์ข้าม PC / iPad / มือถือให้อัตโนมัติ (หากไม่ล็อกอิน ข้อมูลจะเก็บแยกเฉพาะในเครื่องนี้เท่านั้น)"
            : "เมื่อเข้าสู่ระบบ ประวัติการดราฟต์ ซีรีส์ Global Ban และชุดบิลด์ Combat Lab จะถูกแยกเก็บในฐานข้อมูลส่วนตัวของคุณ และซิงก์ข้าม PC / iPad / มือถือให้อัตโนมัติ (หากไม่ล็อกอิน ข้อมูลจะเก็บแยกเฉพาะในเครื่องนี้เท่านั้น)"}
        </p>

        <label className="flex flex-col gap-1">
          <span className="font-display text-xs font-semibold text-ink">
            ชื่อผู้ใช้ (Username) <span className="font-mono text-[10px] text-dim">a-z, 0-9, _ - .</span>
          </span>
          <input
            ref={usernameRef}
            type="text"
            autoComplete="username"
            required
            minLength={3}
            maxLength={32}
            pattern="^[a-zA-Z0-9_.-]+$"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="เช่น golf_rov"
            className="h-9 border border-line bg-bg px-3 font-mono text-sm text-ink placeholder:text-dim focus:border-gold/60 focus:outline-none"
          />
        </label>

        {mode === "register" && (
          <label className="flex flex-col gap-1">
            <span className="font-display text-xs font-semibold text-ink">
              ชื่อที่แสดง (ไม่บังคับ)
            </span>
            <input
              type="text"
              maxLength={40}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="เช่น โค้ชกอล์ฟ"
              className="h-9 border border-line bg-bg px-3 text-sm text-ink placeholder:text-dim focus:border-gold/60 focus:outline-none"
            />
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="font-display text-xs font-semibold text-ink">
            รหัสผ่าน {mode === "register" && <span className="font-mono text-[10px] text-dim">(อย่างน้อย 6 ตัวอักษร)</span>}
          </span>
          <input
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            required
            minLength={mode === "register" ? 6 : 1}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="h-9 border border-line bg-bg px-3 font-mono text-sm text-ink placeholder:text-dim focus:border-gold/60 focus:outline-none"
          />
        </label>

        <div className="mt-1 flex items-center justify-end gap-2 border-t border-line pt-3">
          <button
            type="button"
            onClick={onClose}
            className="h-8 border border-line px-3 font-display text-xs font-semibold text-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            ใช้งานต่อแบบไม่ล็อกอิน
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="h-8 border border-gold bg-gold px-4 font-display text-xs font-bold tracking-wider text-bg transition-colors hover:bg-gold/90 disabled:opacity-50"
          >
            {submitting ? "กำลังดำเนินการ…" : mode === "login" ? "เข้าสู่ระบบ" : "สร้างบัญชี & เข้าใช้งาน"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

import { Check, Mail, UserRound, UserRoundPlus, UsersRound } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { postJson } from "../api/client";
import { getTeam, groupName, teamErrorMessage, teamPath, type TeamOverview } from "../api/team";
import { type Message, translateMessage, useLanguage } from "../i18n/language";
import { Alert } from "./Alert";
import { ConfirmDialog } from "./ConfirmDialog";
import { StableButtonLabel } from "./StableButtonLabel";

const controlClass = "inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 border px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-50";
const primaryControl = `${controlClass} border-gold bg-gold text-bg enabled:hover:bg-gold/90`;
const secondaryControl = `${controlClass} border-line-strong text-muted enabled:hover:bg-panel-2 enabled:hover:text-ink`;
const removalControl = `${controlClass} border-transparent text-muted enabled:hover:border-red/40 enabled:hover:bg-red/10 enabled:hover:text-red`;

export function TeamSandbox({ currentUsername }: { currentUsername: string }) {
  const { t } = useLanguage();
  const titleId = useId();
  const [overview, setOverview] = useState<TeamOverview | null>(null);
  const [inviteUsername, setInviteUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [confirmation, setConfirmation] = useState<{ path: string; message: Message } | null>(null);
  const team = overview?.team;

  useEffect(() => {
    const controller = new AbortController();
    getTeam(controller.signal).then(setOverview).catch((error: unknown) => {
      if (!controller.signal.aborted) setError(teamErrorMessage(error));
    });
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("focus", refresh);
    window.addEventListener("activepasschange", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("activepasschange", refresh);
    };
  }, [revision]);

  async function update(path: string, body: unknown, success?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await postJson<void>(`${teamPath}/${path}`, body);
      if (path === "invite") setInviteUsername("");
      if (success) setNotice(success);
    } catch (error) {
      setError(teamErrorMessage(error));
    } finally {
      setRevision((value) => value + 1);
      window.dispatchEvent(new Event("billingchange"));
      setBusy(false);
    }
  }

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = inviteUsername.trim().replace(/^@/, "");
    if (target) void update("invite", { username: target }, "ส่งคำเชิญแล้ว");
  }

  const seatsUsed = (team?.members.length ?? 0) + (team?.sent.length ?? 0);
  const received = overview?.received ?? [];
  if (!team && !received.length && !error) return null;

  return (
    <section className="border border-line-strong bg-panel" aria-labelledby={titleId}>
      <header className="border-b border-line bg-linear-to-r from-blue/10 to-transparent p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="clip-chamfer-sm grid size-10 shrink-0 place-items-center border border-blue/35 bg-blue/10 text-blue">
              {team ? <UsersRound className="size-5" aria-hidden="true" /> : <Mail className="size-5" aria-hidden="true" />}
            </div>
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-lg leading-tight font-bold text-ink">
                {t(!team && received.length ? "คำเชิญเข้าทีม" : "จัดการทีม")}
              </h2>
              {team && <p className="mt-0.5 text-sm text-blue">{groupName[team.tier]}</p>}
            </div>
          </div>
          {team && (
            <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-ink">
              {t("{0}/{1} คน", team.members.length, team.capacity)}
            </span>
          )}
        </div>
        {team && (
          <>
            <div className="mt-4 flex gap-1.5" aria-hidden="true">
              {Array.from({ length: team.capacity }, (_, index) => (
                <span key={index} className={`h-1.5 flex-1 ${index < team.members.length
                  ? "bg-blue"
                  : index < seatsUsed ? "bg-gold/70" : "bg-line-strong"}`} />
              ))}
            </div>
            {team.is_owner && (
              <div className="mt-2 flex flex-wrap justify-between gap-x-2 text-xs text-muted">
                <span>{t("ว่าง {0} ที่นั่ง", Math.max(0, team.capacity - seatsUsed))}</span>
                {team.sent.length > 0 && <span className="text-gold">{t("รอตอบรับ {0} คน", team.sent.length)}</span>}
              </div>
            )}
          </>
        )}
      </header>

      <div className="space-y-4 p-4 sm:space-y-5 sm:p-5">
        {error && <Alert>{t(error)}</Alert>}
        {notice && (
          <p role="status" className="flex items-center gap-2 border border-good/25 bg-good/10 px-3 py-2 text-sm text-good">
            <Check className="size-4 shrink-0" aria-hidden="true" />{t(notice)}
          </p>
        )}
        {received.length > 0 && (
          <div className="space-y-2">
            {team && <h3 className="text-sm font-semibold text-ink">{t("คำเชิญเข้าทีม")}</h3>}
            <ul aria-label={t("คำเชิญเข้าทีม")} className="space-y-2">
              {received.map((invite) => (
                <li key={invite.owner_id} className="space-y-3 border border-gold/30 bg-gold/5 p-3 text-sm">
                  <p className="font-semibold break-words text-ink">{t("@{0} เชิญเข้า {1}", invite.owner_username, groupName[invite.tier])}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={primaryControl} disabled={busy || Boolean(team)} onClick={() => void update(`accept/${invite.owner_id}`, {}, "เข้าร่วมทีมแล้ว")}>
                      <StableButtonLabel message="รับคำเชิญ" />
                    </button>
                    <button type="button" className={secondaryControl} disabled={busy} onClick={() => void update(`decline/${invite.owner_id}`, {})}>
                      <StableButtonLabel message="ปฏิเสธ" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {team?.is_owner && seatsUsed < team.capacity && (
          <form className="flex flex-wrap items-end gap-2" onSubmit={invite}>
            <label className="min-w-36 flex-1 text-sm font-semibold text-ink">
              <span className="mb-1.5 block">{t("ชื่อผู้ใช้ที่จะเชิญ")}</span>
              <input
                className="min-h-10 w-full border border-line-strong bg-bg px-2.5 text-base font-normal text-ink focus:border-gold/60"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={33}
                autoComplete="off"
                value={inviteUsername}
                onChange={(event) => setInviteUsername(event.target.value)}
                required
              />
            </label>
            <button type="submit" className={primaryControl} disabled={busy || !inviteUsername.trim().replace(/^@/, "")}>
              <UserRoundPlus className="size-4 shrink-0" aria-hidden="true" />
              <StableButtonLabel message="เชิญสมาชิก" />
            </button>
          </form>
        )}
        {team && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">{t("สมาชิกทีม")}</h3>
            <ul aria-label={t("สมาชิกทีม")} className="divide-y divide-line border border-line bg-bg/55">
              {team.members.map((member) => (
                <li key={member.id} className="flex min-h-12 items-center justify-between gap-2 px-2.5 py-1.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center border border-line bg-panel-2 text-muted" aria-hidden="true">
                      <UserRound className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold break-all text-ink">@{member.username}</p>
                      <p className="text-xs text-muted">
                        {member.id === team.owner_id ? t("เจ้าของทีม") : t("สมาชิก")}
                        {member.username === currentUsername && ` · ${t("คุณ")}`}
                      </p>
                    </div>
                  </div>
                  {team.is_owner && member.id !== team.owner_id && (
                    <button type="button" className={removalControl} disabled={busy} onClick={() => setConfirmation({
                      path: `remove/${member.id}`,
                      message: ["เอา @{0} ออกจากทีมใช่ไหม", member.username],
                    })}>
                      <StableButtonLabel message="เอาออก" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!team.is_owner && (
              <button type="button" className={removalControl} disabled={busy} onClick={() => setConfirmation({
                path: `leave/${team.owner_id}`, message: "ออกจากทีมแล้วจะเข้าใช้ประวัติทีมไม่ได้",
              })}>
                <StableButtonLabel message="ออกจากทีม" />
              </button>
            )}
          </div>
        )}
        {team?.is_owner && team.sent.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">{t("คำเชิญที่ส่ง")}</h3>
            <ul aria-label={t("คำเชิญที่ส่ง")} className="divide-y divide-line border border-line bg-bg/55">
              {team.sent.map((invite) => (
                <li key={invite.id} className="flex min-h-12 flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 text-sm text-gold">
                  <span className="min-w-0 break-all">{t("รอ @{0} ตอบรับ", invite.username)}</span>
                  <button type="button" className={secondaryControl} disabled={busy} onClick={() => void update(`revoke/${invite.id}`, {})}>
                    <StableButtonLabel message="ยกเลิกคำเชิญ" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {confirmation && (
        <ConfirmDialog
          title={t("จัดการทีม")}
          message={translateMessage(t, confirmation.message)}
          confirmLabel="ยืนยัน"
          cancelLabel="ยกเลิก"
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            void update(confirmation.path, {});
            setConfirmation(null);
          }}
        />
      )}
    </section>
  );
}

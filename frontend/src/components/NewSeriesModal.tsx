import { StableButtonLabel } from "./StableButtonLabel";
import { useLanguage } from "../i18n/language";
import { ChevronDown, PlusCircle, Swords, Users, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { TournamentRef } from "../types/draft";
import { normalizeTournament } from "../utils/draft";
import { Modal } from "./Modal";
import { TournamentField } from "./TournamentField";

interface TeamPoolComboboxProps {
  id: string;
  label: string;
  dotClass: string;
  focusClass: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  savedPoolTeamNames: string[];
  matchedPool: string | undefined;
  t: (msg: string, ...args: (string | number)[]) => string;
}

function TeamPoolCombobox({
  id,
  label,
  dotClass,
  focusClass,
  value,
  onChange,
  placeholder,
  savedPoolTeamNames,
  matchedPool,
  t,
}: TeamPoolComboboxProps) {
  const [open, setOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const query = value.trim().toLowerCase();
  const filteredPools =
    !filtering || !query
      ? savedPoolTeamNames
      : savedPoolTeamNames.filter((name) => name.toLowerCase().includes(query));

  useEffect(() => {
    if (!open) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1.5">
      <label htmlFor={id} className={`flex items-center gap-1 font-display text-xs font-bold ${dotClass.includes("blue") ? "text-blue" : "text-red"}`}>
        <span className={`h-2 w-2 rounded-full ${dotClass}`} />
        <span>{label}</span>
        {matchedPool && (
          <span className="ml-auto border border-gold/50 bg-gold/15 px-1 py-0.5 font-mono text-[9px] font-bold text-gold">
            POOL
          </span>
        )}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          autoComplete="off"
          value={value}
          onFocus={() => {
            if (savedPoolTeamNames.length > 0) {
              setFiltering(false);
              setOpen(true);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            } else if (e.key === "Enter" && open && filtering && filteredPools.length > 0) {
              e.preventDefault();
              onChange(filteredPools[0].toUpperCase());
              setFiltering(false);
              setOpen(false);
            }
          }}
          onChange={(e) => {
            onChange(e.target.value.toUpperCase());
            setFiltering(true);
            if (savedPoolTeamNames.length > 0) setOpen(true);
          }}
          maxLength={32}
          placeholder={placeholder}
          required
          className={`h-9 w-full border border-line bg-bg pl-3 font-display text-sm font-bold text-ink focus:outline-none ${focusClass} ${
            savedPoolTeamNames.length > 0 ? "pr-8" : "pr-3"
          }`}
        />
        {savedPoolTeamNames.length > 0 && (
          <button
            type="button"
            tabIndex={-1}
            aria-expanded={open}
            aria-label={t("HERO POOLS · ซิงก์อัตโนมัติ ({0})", savedPoolTeamNames.length)}
            onClick={() => {
              setFiltering(false);
              setOpen((prev) => {
                const next = !prev;
                if (next) inputRef.current?.focus();
                return next;
              });
            }}
            className="absolute top-0 right-0 flex h-9 w-8 items-center justify-center text-gold hover:text-ink"
          >
            <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        )}
        {open && savedPoolTeamNames.length > 0 && (
          <div className="absolute top-full right-0 left-0 z-30 mt-1 border border-gold/50 bg-panel shadow-lg">
            <div className="border-b border-line bg-panel-2 px-2.5 py-1 font-mono text-[10px] font-bold text-gold">
              {t("HERO POOLS · ซิงก์อัตโนมัติ ({0})", filteredPools.length)}
            </div>
            <div className="max-h-44 overflow-y-auto p-1">
              {filteredPools.length === 0 ? (
                <p className="px-2 py-2 text-[11px] text-dim">
                  {t("ไม่พบทีมใน Pool — ใช้ชื่อใหม่นี้ได้เลย")}
                </p>
              ) : (
                filteredPools.map((poolTeam) => {
                  const isActive = value.trim().toLowerCase() === poolTeam.trim().toLowerCase();
                  return (
                    <button
                      key={`${id}-${poolTeam}`}
                      type="button"
                      onClick={() => {
                        onChange(poolTeam.toUpperCase());
                        setFiltering(false);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs transition-colors ${
                        isActive ? "bg-gold/15 font-bold text-gold" : "text-ink hover:bg-panel-2"
                      }`}
                    >
                      <span className="truncate font-display font-semibold">{poolTeam}</span>
                      <span className="shrink-0 border border-gold/40 bg-gold/10 px-1 py-0.5 font-mono text-[8px] font-bold text-gold">
                        POOL
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface NewSeriesModalProps {
  currentSeriesName?: string;
  existingSeriesNames?: string[];
  savedPoolTeamNames?: string[];
  defaultTeamA?: string;
  defaultTeamB?: string;
  tournaments?: TournamentRef[];
  initialTournament?: TournamentRef | null;
  hasCurrentActions: boolean;
  onConfirm: (teamA: string, teamB: string, seriesName?: string, tournament?: TournamentRef | null) => void;
  onClose: () => void;
}

function resolveUniqueSeriesName(base: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const name = base.slice(0, 64);
  if (!taken.has(name.trim().toLowerCase())) return name;
  for (let i = 2; i <= 99; i++) {
    const suffix = ` (${i})`;
    const candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base.slice(0, 58)} (${Date.now() % 1000})`;
}

export function NewSeriesModal({
  currentSeriesName,
  existingSeriesNames = [],
  savedPoolTeamNames = [],
  defaultTeamA = "BAC",
  defaultTeamB = "TLN",
  tournaments = [],
  initialTournament = null,
  hasCurrentActions,
  onConfirm,
  onClose,
}: NewSeriesModalProps) {
  const { t } = useLanguage();
  const titleId = useId();
  const [teamA, setTeamA] = useState(defaultTeamA || "BAC");
  const [teamB, setTeamB] = useState(defaultTeamB || "TLN");
  const [customSeries, setCustomSeries] = useState("");
  const [tournament, setTournament] = useState(initialTournament);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const tournamentOptions = initialTournament && !tournaments.some(({ id }) => id === initialTournament.id)
    ? [initialTournament, ...tournaments]
    : tournaments;

  const allExisting = currentSeriesName ? [...existingSeriesNames, currentSeriesName] : existingSeriesNames;
  const matchedPoolA = savedPoolTeamNames.find(
    (name) => name.trim().toLowerCase() === teamA.trim().toLowerCase(),
  );
  const matchedPoolB = savedPoolTeamNames.find(
    (name) => name.trim().toLowerCase() === teamB.trim().toLowerCase(),
  );
  const baseName = `${teamA.trim() || "TEAM A"} vs ${teamB.trim() || "TEAM B"}`;
  const currentPreview = customSeries.trim() || resolveUniqueSeriesName(baseName, allExisting);

  return (
    <Modal labelledBy={titleId} className="max-w-lg" onClose={onClose}>
      {(requestClose) => {
        const handleSubmit = (e: React.FormEvent) => {
          e.preventDefault();
          if (submitting) return;
          const selectedTournament = normalizeTournament(tournament);
          if (tournament && !selectedTournament) {
            setFormError(t("กรุณาระบุชื่อทัวร์นาเมนต์ให้ถูกต้อง"));
            return;
          }
          setFormError(null);
          setSubmitting(true);
          const finalA = teamA.trim() || "TEAM A";
          const finalB = teamB.trim() || "TEAM B";
          const resolvedBase = `${finalA} vs ${finalB}`;
          const finalSeries = customSeries.trim() || resolveUniqueSeriesName(resolvedBase, allExisting);
          onConfirm(finalA, finalB, finalSeries, selectedTournament);
          requestClose();
        };
        return (
          <>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <Swords className="h-4 w-4 text-gold" />
          <div>
            <h2 id={titleId} className="font-display text-sm font-bold tracking-wider text-ink">
              {t("เริ่มซีรีส์ / แมตช์ใหม่ (NEW SERIES)")}
            </h2>
            <p className="text-[11px] text-dim">
              {t("สร้างคู่แข่งขันใหม่ — เริ่ม Game 1 สะอาดเอี่ยม และแยกประวัติออกจากแมตช์เดิม")}
              {currentSeriesName && <span className="text-muted"> {t("(แมตช์ปัจจุบัน:")} {currentSeriesName})</span>}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => requestClose()}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-dim transition-colors hover:bg-panel-2 hover:text-ink"
          aria-label={t("ปิด")}
        >
          <X size={18} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
        <TournamentField
          options={tournamentOptions}
          value={tournament}
          onChange={(next) => {
            setTournament(next);
            setFormError(null);
          }}
        />
        {formError && (
          <div className="border border-red/50 bg-red/10 px-3 py-1.5 text-xs text-red">{formError}</div>
        )}

        {hasCurrentActions && (
          <div className="border border-gold/40 bg-gold/10 px-3 py-2 text-[11px] leading-relaxed text-gold">
            💡 <strong>{t("หมายเหตุ:")}</strong> {t("มีฮีโร่ที่ดราฟต์ค้างอยู่ในกระดานปัจจุบัน")}
            {currentSeriesName ? t(" ของ {0}", currentSeriesName) : ""} {t("ระบบจะ")}{" "}
            <strong>{t("บันทึกเก็บเข้าประวัติแมตช์เดิมให้อัตโนมัติ")}</strong> {t("ก่อนเริ่มแมตช์ใหม่")}
          </div>
        )}

        {/* Team Inputs */}
        <div className="grid grid-cols-2 gap-3">
          <TeamPoolCombobox
            id="new-series-team-a"
            label={t("ทีม A (เริ่มต้นฝั่ง BLUE)")}
            dotClass="bg-blue"
            focusClass="focus:border-blue"
            value={teamA}
            onChange={setTeamA}
            placeholder={t("เช่น BRU, BAC")}
            savedPoolTeamNames={savedPoolTeamNames}
            matchedPool={matchedPoolA}
            t={t}
          />
          <TeamPoolCombobox
            id="new-series-team-b"
            label={t("ทีม B (เริ่มต้นฝั่ง RED)")}
            dotClass="bg-red"
            focusClass="focus:border-red"
            value={teamB}
            onChange={setTeamB}
            placeholder={t("เช่น FS, TLN")}
            savedPoolTeamNames={savedPoolTeamNames}
            matchedPool={matchedPoolB}
            t={t}
          />
        </div>
        {savedPoolTeamNames.length > 0 && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="shrink-0 border border-gold/50 bg-gold/15 px-1 py-0.5 font-mono text-[9px] font-bold text-gold">
              POOL
            </span>
            <span>
              {t(
                "ซิงก์ Hero Pool อัตโนมัติเมื่อชื่อทีมตรงกัน — พิมพ์ค้นหาหรือกดลูกศรเพื่อเลือก ({0} ทีม)",
                savedPoolTeamNames.length,
              )}
            </span>
          </p>
        )}

        {/* Custom Series Name */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-series-name" className="flex items-center justify-between font-display text-xs font-medium text-muted">
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5 text-gold" />
              <span>{t("ชื่อกลุ่ม / ชื่อซีรีส์ (ไม่บังคับ)")}</span>
            </span>
            <span className="font-mono text-[10px] text-dim">
              {t("ค่าเริ่มต้น:")} {teamA.trim() || "A"} vs {teamB.trim() || "B"}
            </span>
          </label>
          <input
            id="new-series-name"
            type="text"
            value={customSeries}
            onChange={(e) => setCustomSeries(e.target.value)}
            placeholder={t("เช่น {0} vs {1} (Playoffs)", teamA || "TEAM A", teamB || "TEAM B")}
            maxLength={64}
            className="h-8 border border-line bg-bg px-3 font-display text-xs text-ink placeholder:text-dim focus:border-gold focus:outline-none"
          />
        </div>

        {/* Summary Card */}
        <div className="border border-line bg-panel-2/50 p-3">
          <div className="text-[11px] text-dim">{t("แมตช์ใหม่ที่จะเริ่ม:")}</div>
          <div className="mt-0.5 font-display text-sm font-bold text-gold">{currentPreview}</div>
          {tournament?.name.trim() && <p className="mt-0.5 break-words text-xs text-muted">{tournament.name.trim()}</p>}
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
            <span>{t("กระดาน: GAME 1")}</span>
            <span>•</span>
            <span>{t("สถิติ Global Ban: รีเซ็ตเป็น 0 ฮีโร่")}</span>
            <span>•</span>
            <span>{t("ประวัติแมตช์เดิม: ยังอยู่ครบ")}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={() => requestClose()}
            className="h-9 px-3.5 font-display text-xs font-semibold text-muted transition-colors hover:text-ink"
          >
            <StableButtonLabel message="ยกเลิก" />
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex h-9 items-center gap-1.5 border border-gold bg-gold px-4 font-display text-xs font-bold tracking-wider text-bg shadow-sm transition-colors hover:bg-gold/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PlusCircle className="h-4 w-4" />
            <span><StableButtonLabel message="สร้างแมตช์ใหม่ และเริ่มดราฟต์" /></span>
          </button>
        </div>
      </form>
          </>
        );
      }}
    </Modal>
  );
}

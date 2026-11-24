import { type FormEvent, useId, useState } from "react";
import { Pencil } from "lucide-react";
import { teamErrorMessage } from "../api/team";
import { useLanguage } from "../i18n/language";
import type { HistorySeriesEdit, SeriesTeamNames } from "../types/draft";
import { normalizeHistoryName } from "../utils/draft";
import { Alert } from "./Alert";
import { Modal } from "./Modal";
import { StableButtonLabel } from "./StableButtonLabel";

const editLabels = {
  tournament: "แก้ชื่อทัวร์นาเมนต์",
  series: "แก้ไขซีรีส์",
} as const;

export function RenameHistoryButton({ target, onClick, disabled }: {
  target: keyof typeof editLabels;
  onClick: () => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const label = t(editLabels[target]);
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick}
      className={`inline-flex h-8 shrink-0 items-center justify-center border border-line bg-bg text-muted hover:border-gold/50 hover:text-gold focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-50 ${target === "series" ? "w-8 gap-1.5 text-xs font-semibold lg:w-auto lg:px-2" : "w-8"}`}>
      <Pencil className="size-3.5 shrink-0" aria-hidden="true" />
      {target === "series" && <span className="hidden lg:inline"><StableButtonLabel message={editLabels.series} /></span>}
    </button>
  );
}

export type HistoryNameEditor = {
  target: "tournament";
  currentName: string;
  onSave: (name: string) => void | Promise<void>;
} | {
  target: "series";
  current: SeriesTeamNames & { seriesTitle: string; gameName: string | null };
  onSave: (changes: HistorySeriesEdit) => void | Promise<void>;
};

const seriesFields = [
  { key: "seriesTitle", label: "ชื่อซีรีส์" },
  { key: "teamAName", label: "ชื่อทีม A" },
  { key: "teamBName", label: "ชื่อทีม B" },
  { key: "gameName", label: "ชื่อเกมในซีรีส์" },
] as const;
const tournamentFields = [{ key: "seriesTitle", label: "ชื่อทัวร์นาเมนต์" }] as const;

export function RenameHistoryItemDialog(props: HistoryNameEditor & { onClose: () => void }) {
  const { target, onClose } = props;
  const { t } = useLanguage();
  const titleId = useId();
  const initial = props.target === "series"
    ? props.current
    : { seriesTitle: props.currentName, teamAName: "", teamBName: "", gameName: "" };
  const [values, setValues] = useState({ ...initial, gameName: initial.gameName ?? "" });
  const [gameNameEdited, setGameNameEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const title = values.seriesTitle.trim();
  const teamAName = normalizeHistoryName(values.teamAName);
  const teamBName = normalizeHistoryName(values.teamBName);
  const gameName = normalizeHistoryName(values.gameName);
  const titleChanged = title !== initial.seriesTitle.trim();
  const teamsChanged = teamAName !== initial.teamAName.trim() || teamBName !== initial.teamBName.trim();
  const gameNameChanged = gameNameEdited && (initial.gameName === null || (gameName ?? "") !== initial.gameName);
  const valid = (!titleChanged || normalizeHistoryName(title) !== null)
    && (target === "tournament" || (teamAName !== null && teamBName !== null))
    && (!gameNameChanged || gameName !== null || !values.gameName.trim());
  const changed = titleChanged || (target === "series" && (teamsChanged || gameNameChanged));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !valid || !changed) return;
    setBusy(true);
    setError("");
    try {
      if (props.target === "tournament") {
        await props.onSave(title);
      } else {
        const changes: HistorySeriesEdit = {};
        if (titleChanged) changes.seriesTitle = title;
        if (teamsChanged && teamAName !== null && teamBName !== null) changes.teams = { teamAName, teamBName };
        if (gameNameChanged) changes.gameName = gameName;
        await props.onSave(changes);
      }
      onClose();
    } catch (error) {
      setError(t(teamErrorMessage(error)));
      setBusy(false);
    }
  }

  return (
    <Modal labelledBy={titleId} className="max-w-sm" dismissDisabled={busy} onClose={onClose}>
      {(requestClose) => (
        <form className="space-y-3 p-4" onSubmit={save} aria-busy={busy}>
          <h2 id={titleId} className="font-display text-base font-bold text-ink">{t(editLabels[target])}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {(target === "series" ? seriesFields : tournamentFields).map(({ key, label }) => (
              <label key={key} className={`grid gap-1 text-xs text-muted ${key === "seriesTitle" || key === "gameName" ? "sm:col-span-2" : ""}`}>
                {t(label)}
                <input
                  type="text"
                  className="min-h-9 w-full min-w-0 border border-line-strong bg-bg px-2.5 text-base text-ink focus-visible:outline-2 focus-visible:outline-gold sm:text-sm"
                  value={values[key]}
                  onChange={(event) => {
                    const value = event.target.value;
                    setValues((previous) => ({ ...previous, [key]: value }));
                    if (key === "gameName") setGameNameEdited(true);
                  }}
                  maxLength={64}
                  required={key !== "gameName"}
                  disabled={busy}
                />
              </label>
            ))}
          </div>
          {target === "series" && <p className="text-xs text-muted">{t("ใช้ชื่อนี้กับทุกเกมในซีรีส์ เว้นว่างเพื่อแสดงแค่เลขเกม")}</p>}
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <button type="button" className="min-h-9 px-3 text-sm text-muted" disabled={busy} onClick={() => requestClose()}>
              <StableButtonLabel message="ยกเลิก" />
            </button>
            <button type="submit" disabled={busy || !valid || !changed} className="min-h-9 border border-gold bg-gold px-3 text-sm font-bold text-bg disabled:opacity-50">
              <StableButtonLabel message={busy ? "กำลังบันทึก…" : "บันทึกชื่อ"} alternatives={["กำลังบันทึก…", "บันทึกชื่อ"]} />
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

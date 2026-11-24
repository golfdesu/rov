import { type FormEvent, useId, useMemo, useState } from "react";
import { teamErrorMessage } from "../api/team";
import { useLanguage } from "../i18n/language";
import type { TournamentRef } from "../types/draft";
import { createDraftGroupId, normalizeTournament } from "../utils/draft";
import { Alert } from "./Alert";
import { Modal } from "./Modal";
import { StableButtonLabel } from "./StableButtonLabel";

interface SeriesChoice {
  key: string;
  name: string;
  count: number;
  latestTimestamp: string;
  tournament: TournamentRef | null;
}

export function CreateTournamentDialog({ series, onCreate, onClose }: {
  series: readonly SeriesChoice[];
  onCreate: (keys: ReadonlySet<string>, tournament: TournamentRef) => void | Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const titleId = useId();
  const [id] = useState(createDraftGroupId);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tournament = normalizeTournament({ id, name });
  const selected = useMemo(() => series.filter(({ key }) => checked.has(key)), [series, checked]);
  const selectedGames = useMemo(
    () => selected.reduce((count, entry) => count + entry.count, 0),
    [selected],
  );
  const search = query.trim().toLowerCase();
  const visibleSeries = useMemo(
    () =>
      search
        ? series.filter(
            (item) =>
              item.name.toLowerCase().includes(search) || item.tournament?.name.toLowerCase().includes(search),
          )
        : series,
    [series, search],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tournament || selected.length === 0 || busy) return;
    setBusy(true);
    setError("");
    try {
      await onCreate(new Set(selected.map(({ key }) => key)), tournament);
      onClose();
    } catch (error) {
      setError(t(teamErrorMessage(error)));
      setBusy(false);
    }
  }

  return (
    <Modal labelledBy={titleId} className="max-w-md overflow-hidden" dismissDisabled={busy} onClose={onClose}>
      {(requestClose) => (
        <form className="flex min-h-0 flex-col" onSubmit={submit} aria-busy={busy}>
          <div className="shrink-0 space-y-3 border-b border-line p-4">
            <h2 id={titleId} className="font-display text-base font-bold text-ink">{t("สร้างทัวร์นาเมนต์")}</h2>
            <label className="grid gap-1 text-xs text-muted">
              {t("ชื่อทัวร์นาเมนต์")}
              <input
                type="text"
                className="min-h-9 w-full min-w-0 border border-line-strong bg-bg px-2.5 text-base text-ink focus-visible:outline-2 focus-visible:outline-gold sm:text-sm"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={64}
                required
                disabled={busy}
              />
            </label>
            {series.length > 6 && (
              <input
                type="search"
                aria-label={t("ค้นหาซีรีส์")}
                placeholder={t("ค้นหาซีรีส์")}
                className="min-h-9 w-full min-w-0 border border-line-strong bg-bg px-2.5 text-base text-ink focus-visible:outline-2 focus-visible:outline-gold sm:text-sm"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                disabled={busy}
              />
            )}
          </div>
          <div className="min-h-0 overflow-y-auto px-4 py-3">
            <fieldset className="min-w-0 space-y-1.5" disabled={busy}>
              <legend className="mb-1 font-display text-xs font-semibold text-muted">{t("เลือกซีรีส์ที่จะเข้าทัวร์นาเมนต์")}</legend>
              {visibleSeries.map((item) => (
                <label key={item.key} className="flex min-h-10 cursor-pointer items-center gap-2 border border-line px-2.5 py-1.5 has-checked:border-gold/50 has-checked:bg-gold/10">
                  <input
                    type="checkbox"
                    checked={checked.has(item.key)}
                    className="size-4 shrink-0 accent-gold focus-visible:outline-2 focus-visible:outline-gold"
                    onChange={(event) => {
                      const checkedNow = event.target.checked;
                      setChecked((previous) => {
                        const next = new Set(previous);
                        if (checkedNow) next.add(item.key);
                        else next.delete(item.key);
                        return next;
                      });
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-semibold text-ink">{item.name}</span>
                    {(item.tournament || item.latestTimestamp) && (
                      <span className="block break-words text-xs text-muted">
                        {[item.tournament?.name, item.latestTimestamp].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{t("{0} เกม", item.count)}</span>
                </label>
              ))}
              {visibleSeries.length === 0 && <p className="text-sm text-muted">{t("ไม่พบเกมตามตัวกรอง")}</p>}
            </fieldset>
          </div>
          <div className="shrink-0 space-y-2 border-t border-line px-4 py-3">
            <p className="text-xs text-muted" aria-live="polite">{t("เลือกแล้ว {0} ซีรีส์ ({1} เกม)", selected.length, selectedGames)}</p>
            {selected.some((item) => item.tournament) && (
              <p className="text-xs text-gold">{t("ซีรีส์ที่มีทัวร์อยู่แล้วจะย้ายเข้าทัวร์นาเมนต์ใหม่")}</p>
            )}
            {error && <Alert>{error}</Alert>}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="min-h-9 px-3 text-sm text-muted" disabled={busy} onClick={() => requestClose()}>
                <StableButtonLabel message="ยกเลิก" />
              </button>
              <button type="submit" disabled={busy || !tournament || selected.length === 0} className="min-h-9 border border-gold bg-gold px-3 text-sm font-bold text-bg disabled:opacity-50">
                <StableButtonLabel message={busy ? "กำลังบันทึก…" : "สร้างทัวร์นาเมนต์"} alternatives={["กำลังบันทึก…", "สร้างทัวร์นาเมนต์"]} />
              </button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

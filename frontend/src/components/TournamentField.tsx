import { useLanguage } from "../i18n/language";
import type { TournamentRef } from "../types/draft";
import { createDraftGroupId } from "../utils/draft";

const NEW_TOURNAMENT = "+";
const fieldClass = "min-h-9 w-full min-w-0 border border-line-strong bg-bg px-2.5 text-base text-ink focus-visible:outline-2 focus-visible:outline-gold sm:text-sm";

export function TournamentField({
  options,
  value,
  onChange,
}: {
  options: TournamentRef[];
  value: TournamentRef | null;
  onChange: (value: TournamentRef | null) => void;
}) {
  const { t } = useLanguage();
  const creating = value !== null && !options.some((option) => option.id === value.id);
  return (
    <div className="grid gap-2">
      <label className="grid min-w-0 gap-1 text-xs text-muted">
        <span>{t("ทัวร์นาเมนต์")}</span>
        <select
          className={fieldClass}
          value={creating ? NEW_TOURNAMENT : value?.id ?? ""}
          onChange={(event) => {
            const id = event.target.value;
            onChange(id === NEW_TOURNAMENT ? { id: createDraftGroupId(), name: "" } : options.find((option) => option.id === id) ?? null);
          }}
        >
          <option value="">{t("ไม่สังกัดทัวร์นาเมนต์")}</option>
          {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          <option value={NEW_TOURNAMENT}>{t("สร้างทัวร์นาเมนต์ใหม่")}</option>
        </select>
      </label>
      {creating && (
        <label className="grid min-w-0 gap-1 text-xs text-muted">
          <span>{t("ชื่อทัวร์นาเมนต์")}</span>
          <input
            className={fieldClass}
            type="text"
            value={value.name}
            onChange={(event) => onChange({ ...value, name: event.target.value })}
            maxLength={64}
            required
          />
        </label>
      )}
    </div>
  );
}

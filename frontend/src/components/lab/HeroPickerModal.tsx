import { Search, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import type { Hero, RoleType } from "../../types/draft";
import { ROLES } from "../../utils/draft";
import { displayName, matchesHeroQuery } from "../../utils/heroNames";
import { HeroPortrait } from "../HeroPortrait";
import { Modal } from "../Modal";

interface HeroPickerModalProps {
  heroes: { name: string; role: string | null; ranged: boolean }[];
  currentHero: string;
  heroMap: Map<string, Hero>;
  onSelect: (name: string) => void;
  onClose: () => void;
}

const ROLE_LABELS: Record<RoleType, string> = {
  Tank: "แทงค์",
  Warrior: "ไฟต์เตอร์",
  Assassin: "แอสซาซิน",
  Mage: "เมจ",
  Marksman: "แครี่",
  Support: "ซัพพอร์ต",
};

export function HeroPickerModal({
  heroes,
  currentHero,
  heroMap,
  onSelect,
  onClose,
}: HeroPickerModalProps) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<RoleType | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const titleId = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return heroes
      .filter((h) => (!q || matchesHeroQuery(h.name, q)) && (!role || h.role === role))
      .sort((a, b) => displayName(a.name).localeCompare(displayName(b.name)));
  }, [heroes, query, role]);

  return (
    <Modal labelledBy={titleId} className="max-h-[88vh] max-w-3xl" initialFocusRef={searchInputRef} onClose={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span id={titleId} className="font-display text-sm font-bold tracking-wider text-ink">เลือกฮีโร่</span>
          <span className="font-mono text-xs text-dim">({filtered.length} / {heroes.length})</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-dim transition-colors hover:bg-panel-2 hover:text-ink"
          aria-label="ปิด"
        >
          <X size={18} />
        </button>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col gap-2.5 border-b border-line bg-panel-2/40 p-3">
        <div className="relative flex items-center">
          <Search size={16} className="pointer-events-none absolute left-3 text-dim" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาชื่อฮีโร่ (เช่น Valhein, มอร์ตอส, มูราด...)"
            className="w-full rounded border border-line bg-bg py-1.5 pl-9 pr-8 text-xs font-medium text-ink placeholder-dim outline-none transition-colors focus:border-gold"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2.5 text-dim hover:text-ink"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setRole(null)}
            className={`rounded px-2.5 py-1 text-[11px] font-medium transition-all ${
              role === null
                ? "border border-gold bg-gold/15 font-bold text-gold shadow-sm"
                : "border border-line/60 bg-bg/50 text-muted hover:border-line hover:text-ink"
            }`}
          >
            ทั้งหมด
          </button>
          {ROLES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(role === r ? null : r)}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition-all ${
                role === r
                  ? "border border-gold bg-gold/15 font-bold text-gold shadow-sm"
                  : "border border-line/60 bg-bg/50 text-muted hover:border-line hover:text-ink"
              }`}
            >
              {ROLE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {/* Hero Grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {filtered.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-center text-dim">
            <p className="text-sm">ไม่พบฮีโร่ที่ตรงกับการค้นหา</p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setRole(null);
              }}
              className="mt-2 text-xs text-gold underline underline-offset-2"
            >
              ล้างคำค้นหา
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
            {filtered.map((h) => {
              const isSelected = h.name === currentHero;
              const dName = displayName(h.name);
              return (
                <button
                  key={h.name}
                  type="button"
                  onClick={() => {
                    onSelect(h.name);
                    onClose();
                  }}
                  className={`group relative flex flex-col items-center rounded-lg border p-1.5 transition-all ${
                    isSelected
                      ? "border-gold bg-gold/15 ring-2 ring-gold shadow-md shadow-gold/20"
                      : "border-line/70 bg-bg/40 hover:border-gold/60 hover:bg-panel-2 hover:shadow"
                  }`}
                >
                  <div className="aspect-square w-full overflow-hidden rounded clip-chamfer-sm">
                    <HeroPortrait
                      name={h.name}
                      hero={heroMap.get(h.name)}
                      className="transition-transform group-hover:scale-105"
                    />
                  </div>
                  <span
                    className={`mt-1.5 w-full truncate text-center text-[11px] leading-tight ${
                      isSelected ? "font-bold text-gold" : "text-ink group-hover:text-gold"
                    }`}
                    title={dName}
                  >
                    {dName}
                  </span>
                  {h.role && (
                    <span className="text-[9px] text-dim">
                      {ROLE_LABELS[h.role as RoleType] || h.role}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

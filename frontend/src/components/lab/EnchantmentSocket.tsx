import { X } from "lucide-react";
import type { CatalogEnchantment } from "../../types/combat";
import { ROMAN } from "./enchantmentFactions";

/** One enchantment slot: empty tier placeholder, or the chosen icon with a hover clear button. */
export function SocketItem({
  tier,
  name,
  ench,
  isMajor,
  factionColor,
  onClear,
}: {
  tier: number;
  name?: string;
  ench?: CatalogEnchantment;
  isMajor: boolean;
  factionColor?: string;
  onClear: () => void;
}) {
  const sizeClass = isMajor ? "h-14 w-14" : "h-11 w-11";

  if (!ench || !name) {
    return (
      <div className="flex flex-col items-center">
        <div
          className={`flex ${sizeClass} items-center justify-center rounded-full border-2 border-dashed border-line bg-panel text-[11px] font-mono text-dim`}
        >
          {ROMAN[tier]}
        </div>
        <span className="mt-1 text-[9px] text-dim">ขั้น {tier}</span>
      </div>
    );
  }

  return (
    <div className="group relative flex flex-col items-center">
      <div
        className={`relative ${sizeClass} rounded-full ring-2 ${
          factionColor || (isMajor ? "ring-gold shadow-md shadow-gold/20" : "ring-line-strong")
        }`}
      >
        <img
          src={ench.icon_url}
          alt={name}
          className="h-full w-full rounded-full object-contain"
          loading="lazy"
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="absolute -right-1 -top-1 hidden h-4 w-4 place-items-center rounded-full bg-red text-bg shadow group-hover:grid"
          title={`ลบ ${name}`}
        >
          <X size={10} />
        </button>
      </div>
      <span className="mt-1 max-w-[65px] truncate text-center text-[10px] font-medium text-ink">
        {ench.category || name}
      </span>
    </div>
  );
}

import {
  ChevronLeft,
  ChevronRight,
  Coins,
  Filter,
  Image as ImageIcon,
  Shield,
  Sparkles,
  Swords,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { getJson } from "../../api/client";
import type { CatalogItem, ItemScreenshotsResponse } from "../../types/combat";
import { Modal } from "../Modal";

const CATEGORY_LABELS: Record<string, string> = {
  all: "ทั้งหมด",
  attack: "กายภาพ",
  magic: "เวท",
  defense: "ป้องกัน",
  movement: "ความเร็ว",
  jungling: "ฟาร์มป่า",
  support: "ซัพพอร์ต",
};

interface ItemCardModalProps {
  itemName: string;
  catalogItems: CatalogItem[];
  onClose: () => void;
  onPick?: (name: string) => void;
}

function ItemIcon({
  src,
  name,
  className = "h-8 w-8 shrink-0",
}: {
  src?: string | null;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center border border-line bg-panel-2 font-mono text-[10px] font-bold text-muted ${className}`}
      >
        <span>{name.slice(0, 3).toUpperCase()}</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function ItemCardModal({
  itemName,
  catalogItems,
  onClose,
  onPick,
}: ItemCardModalProps) {
  const titleId = useId();
  const [prevItem, setPrevItem] = useState(itemName);
  const [currentItem, setCurrentItem] = useState(itemName);
  const [pageIdx, setPageIdx] = useState(0);
  const [data, setData] = useState<ItemScreenshotsResponse | null>(null);
  const [fetchedItem, setFetchedItem] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [imageError, setImageError] = useState(false);

  // Sync prop changes during render without cascading effects
  if (prevItem !== itemName) {
    setPrevItem(itemName);
    setCurrentItem(itemName);
    setPageIdx(0);
  }

  // Fetch item screenshot and manifest data
  useEffect(() => {
    let cancelled = false;
    getJson<ItemScreenshotsResponse>(`/combat/item-screenshots/${encodeURIComponent(currentItem)}`)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setFetchedItem(currentItem);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
          setFetchedItem(currentItem);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentItem]);

  const loading = fetchedItem !== currentItem;

  // Current catalog item representation
  const catalogItem = useMemo(
    () => catalogItems.find((i) => i.name === currentItem),
    [catalogItems, currentItem]
  );

  // Category list
  const categories = useMemo(() => {
    const set = new Set(catalogItems.map((i) => i.category));
    return ["all", ...Array.from(set)];
  }, [catalogItems]);

  // Filtered browse list
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalogItems.filter((i) => {
      const matchCat = selectedCategory === "all" || i.category === selectedCategory;
      const matchQuery = !q || i.name.toLowerCase().includes(q);
      return matchCat && matchQuery;
    });
  }, [catalogItems, selectedCategory, search]);

  // Screenshots array
  const screenshots = data?.screenshots ?? [];
  const currentScreenshotUrl = screenshots[pageIdx] ?? screenshots[0];
  const pagesCount = screenshots.length;

  const currentDetails = useMemo(() => {
    if (!data?.pages_info || data.pages_info.length === 0) return data?.details;
    return data.pages_info[pageIdx] ?? data.details;
  }, [data, pageIdx]);

  // Switch page with boundary check
  const setPage = (next: number) => {
    if (pagesCount <= 0) return;
    const clamped = Math.max(0, Math.min(next, pagesCount - 1));
    setPageIdx(clamped);
    setImageError(false);
  };

  // Keyboard navigation for multi-page cards
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (pagesCount <= 1) return;
      if (e.key === "ArrowLeft") {
        setPageIdx((prev) => Math.max(0, prev - 1));
        setImageError(false);
      } else if (e.key === "ArrowRight") {
        setPageIdx((prev) => Math.min(pagesCount - 1, prev + 1));
        setImageError(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pagesCount]);

  return (
    <Modal labelledBy={titleId} onClose={onClose} className="w-full max-w-5xl">
      <div className="flex max-h-[92vh] flex-col overflow-hidden bg-bg text-ink">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line bg-panel px-4 py-3">
          <div className="flex items-center gap-3">
            <ItemIcon
              src={catalogItem?.icon_url}
              name={currentItem}
              className="h-10 w-10 shrink-0 rounded border border-line-strong object-cover shadow"
            />
            <div>
              <div className="flex items-center gap-2">
                <h2 id={titleId} className="font-display text-base font-bold text-ink">
                  {currentItem}
                </h2>
                {catalogItem?.tier && (
                  <span className="rounded bg-gold/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-gold">
                    Tier {catalogItem.tier}
                  </span>
                )}
                {catalogItem?.category && (
                  <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-muted">
                    {CATEGORY_LABELS[catalogItem.category] ?? catalogItem.category}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted">
                <span className="flex items-center gap-1 font-mono text-gold">
                  <Coins size={12} />
                  {catalogItem?.price?.toLocaleString() ?? "?"} Gold
                </span>
                <span className="text-dim">·</span>
                <span className="flex items-center gap-1 text-[11px]">
                  <ImageIcon size={12} className="text-blue" />
                  ภาพการ์ดไอเทมแท้จากในเกม (100% In-Game Screenshot)
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onPick && (
              <button
                type="button"
                onClick={() => {
                  onPick(currentItem);
                  onClose();
                }}
                className="flex items-center gap-1.5 rounded bg-gold px-3 py-1.5 font-display text-xs font-bold text-bg shadow hover:bg-gold-light active:scale-95"
              >
                <Swords size={13} />
                <span>ใส่ไอเทมนี้</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1.5 text-muted hover:bg-panel-2 hover:text-ink"
              aria-label="ปิด"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content Layout */}
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-12">
          {/* Left Column: Authentic Screenshot Card (7 cols) */}
          <div className="flex flex-col border-b border-line bg-panel-2/50 p-4 lg:col-span-7 lg:border-b-0 lg:border-r">
            {/* Pagination Tabs (For multi-page items) */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-muted">หน้าการ์ด:</span>
                {pagesCount > 1 ? (
                  <div className="flex gap-1">
                    {Array.from({ length: pagesCount }, (_, i) => (
                      <button
                        type="button"
                        key={i}
                        onClick={() => setPage(i)}
                        className={`rounded px-2.5 py-1 text-xs font-bold transition-colors ${
                          pageIdx === i
                            ? "bg-gold text-bg shadow-sm"
                            : "bg-panel text-muted hover:bg-line hover:text-ink"
                        }`}
                      >
                        หน้า {i + 1}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="rounded bg-panel px-2 py-0.5 text-xs text-dim">หน้าเดียว</span>
                )}
              </div>

              {pagesCount > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage(pageIdx - 1)}
                    disabled={pageIdx === 0}
                    className="rounded p-1 text-muted hover:bg-line hover:text-ink disabled:opacity-30"
                    title="หน้าก่อนหน้า (ลูกศรซ้าย)"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="font-mono text-xs text-dim">
                    {pageIdx + 1} / {pagesCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage(pageIdx + 1)}
                    disabled={pageIdx >= pagesCount - 1}
                    className="rounded p-1 text-muted hover:bg-line hover:text-ink disabled:opacity-30"
                    title="หน้าถัดไป (ลูกศรขวา)"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>

            {/* Screenshot Viewer Area */}
            <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-lg border border-line-strong bg-bg/80 p-2 shadow-inner">
              {loading ? (
                <div className="flex flex-col items-center gap-2 py-20 text-muted">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-gold border-t-transparent" />
                  <span className="text-xs">กำลังโหลดภาพการ์ดไอเทม...</span>
                </div>
              ) : currentScreenshotUrl && !imageError ? (
                <div className="relative max-h-[58vh] overflow-y-auto">
                  <img
                    src={currentScreenshotUrl}
                    alt={`${currentItem} page ${pageIdx + 1}`}
                    className="mx-auto block max-h-[56vh] w-auto rounded border border-line object-contain shadow-md"
                    onError={() => setImageError(true)}
                  />
                  <div className="mt-2 text-center">
                    <span className="inline-flex items-center gap-1 rounded bg-panel px-2 py-0.5 font-mono text-[10px] text-dim">
                      {currentScreenshotUrl.split("/").pop()}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-20 text-dim">
                  <ImageIcon size={32} className="opacity-40" />
                  <span className="text-xs">ยังไม่มีภาพการ์ดสำหรับไอเทมนี้ในระบบ</span>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Structured Data & Catalog Quick-Browse (5 cols) */}
          <div className="flex flex-col bg-panel p-4 lg:col-span-5">
            {/* Stats Breakdown */}
            <div className="mb-4">
              <h3 className="mb-2 flex items-center gap-1.5 font-display text-xs font-bold tracking-wide text-muted">
                <Shield size={13} className="text-blue" />
                <span>สเตตัสพื้นฐาน (Base Attributes)</span>
              </h3>
              {currentDetails?.stats_raw && currentDetails.stats_raw.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {currentDetails.stats_raw.map((statStr, i) => (
                    <span
                      key={i}
                      className="rounded border border-line-strong bg-panel-2 px-2.5 py-1 font-mono text-xs font-semibold text-ink shadow-sm"
                    >
                      {statStr}
                    </span>
                  ))}
                </div>
              ) : catalogItem?.stats && Object.keys(catalogItem.stats).length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(catalogItem.stats).map(([k, v]) => (
                    <span
                      key={k}
                      className="rounded border border-line bg-panel-2 px-2 py-1 font-mono text-xs text-ink"
                    >
                      {k.replace(/_/g, " ")} +{v}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-dim">ไม่มีสเตตัสพื้นฐาน</span>
              )}
            </div>

            {/* Passives & Description */}
            <div className="mb-5 flex-1">
              <h3 className="mb-2 flex items-center gap-1.5 font-display text-xs font-bold tracking-wide text-muted">
                <Sparkles size={13} className="text-gold" />
                <span>เอฟเฟกต์ & สกิลติดตัว (Passives & Description)</span>
              </h3>
              <div className="space-y-2 rounded-lg border border-line bg-panel-2 p-3 text-xs leading-relaxed text-ink/90">
                {currentDetails?.desc_th && currentDetails.desc_th.length > 0 ? (
                  currentDetails.desc_th.map((text, i) => (
                    <div key={i} className="whitespace-pre-line border-b border-line/40 pb-2 last:border-b-0 last:pb-0">
                      {text}
                    </div>
                  ))
                ) : catalogItem?.passives && catalogItem.passives.length > 0 ? (
                  catalogItem.passives.map((p, i) => (
                    <div key={i} className="whitespace-pre-line border-b border-line/40 pb-2 last:border-b-0 last:pb-0">
                      {p}
                    </div>
                  ))
                ) : (
                  <span className="text-dim">ไม่มีเอฟเฟกต์พิเศษหรือสกิลติดตัว</span>
                )}
              </div>
            </div>

            {/* Catalog Quick Browse */}
            <div className="border-t border-line pt-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="flex items-center gap-1 text-[11px] font-semibold text-muted">
                  <Filter size={11} />
                  <span>ดูไอเทมชิ้นอื่นในคลัง (114 ไอเทม)</span>
                </h4>
                <span className="font-mono text-[10px] text-dim">{filteredItems.length} ชิ้น</span>
              </div>

              {/* Category Pills */}
              <div className="mb-2 flex flex-wrap gap-1">
                {categories.map((c) => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => {
                      setSelectedCategory(c);
                      setPageIdx(0);
                    }}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                      selectedCategory === c
                        ? "bg-gold text-bg"
                        : "bg-panel-2 text-muted hover:bg-line hover:text-ink"
                    }`}
                  >
                    {CATEGORY_LABELS[c] ?? c}
                  </button>
                ))}
              </div>

              {/* Search Box */}
              <div className="mb-2">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ค้นหาชื่อไอเทม..."
                  className="w-full rounded border border-line bg-bg px-2 py-1 text-xs text-ink placeholder:text-dim"
                />
              </div>

              {/* Compact Item Grid */}
              <div className="grid max-h-32 grid-cols-6 gap-1 overflow-y-auto rounded border border-line bg-panel-2 p-1.5 sm:grid-cols-8">
                {filteredItems.map((item) => (
                  <button
                    type="button"
                    key={item.name}
                    onClick={() => {
                      setCurrentItem(item.name);
                      setPageIdx(0);
                    }}
                    title={`${item.name} (${item.price ?? "?"}g)`}
                    className={`group relative aspect-square rounded border p-0.5 transition-all ${
                      currentItem === item.name
                        ? "border-gold ring-1 ring-gold"
                        : "border-line bg-panel hover:border-gold/60"
                    }`}
                  >
                    <ItemIcon
                      src={item.icon_url}
                      name={item.name}
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

import { Check, Copy, Pencil, Plus, Search, Trash2, Users, X } from "lucide-react";
import { type FormEvent, useEffect, useId, useMemo, useState } from "react";
import { ApiError } from "../api/client";
import {
  deleteHeroPool,
  emptyPoolLanes,
  getHeroPools,
  heroPoolErrorMessage,
  type HeroPoolItem,
  type HeroPoolLanes,
  type HeroPoolOverview,
  type HeroPoolScope,
  POOL_LANES,
  saveHeroPool,
} from "../api/heroPools";
import { useLanguage } from "../i18n/language";
import type { Hero, LaneKey } from "../types/draft";
import { LANE_SHORT } from "../utils/draft";
import { displayName } from "../utils/heroNames";
import { Alert } from "./Alert";
import { ConfirmDialog } from "./ConfirmDialog";
import { HeroPortrait } from "./HeroPortrait";
import { LaneIcon } from "./LaneIcon";
import { Modal } from "./Modal";
import { StableButtonLabel } from "./StableButtonLabel";

interface HeroPoolsModalProps {
  heroes: Hero[];
  heroMap: Map<string, Hero>;
  initialTeamName?: string;
  onChanged: (overview: HeroPoolOverview) => void;
  onClose: () => void;
}

export function HeroPoolsModal({
  heroes,
  heroMap,
  initialTeamName = "",
  onChanged,
  onClose,
}: HeroPoolsModalProps) {
  const { t } = useLanguage();
  const titleId = useId();
  const [overview, setOverview] = useState<HeroPoolOverview | null>(null);
  const [scope, setScope] = useState<HeroPoolScope>("personal");
  const [selectedId, setSelectedId] = useState<number | "new">("new");
  const [teamName, setTeamName] = useState(initialTeamName.trim());
  const [lanes, setLanes] = useState<HeroPoolLanes>(emptyPoolLanes);
  const [activeLane, setActiveLane] = useState<LaneKey>("DS_Lane");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<HeroPoolItem | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    getHeroPools(ctrl.signal)
      .then((data) => {
        if (ctrl.signal.aborted) return;
        setError(null);
        setOverview(data);
        onChanged(data);
        const target = initialTeamName.trim().toLowerCase();
        const teamMatch = data.team.find((p) => p.team_name.trim().toLowerCase() === target);
        const personalMatch = data.personal.find((p) => p.team_name.trim().toLowerCase() === target);
        const initial = teamMatch ?? personalMatch ?? data.personal[0] ?? data.team[0];
        if (initial) {
          setScope(initial.scope);
          setSelectedId(initial.id);
          setTeamName(initial.team_name);
          setLanes({ ...emptyPoolLanes(), ...initial.lanes });
          setIsEditing(false);
        } else {
          setSelectedId("new");
          setIsEditing(true);
        }
      })
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) setError(heroPoolErrorMessage(err));
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load on mount or explicit retry
  }, [loadAttempt]);

  const currentList = useMemo(
    () => (scope === "team" ? overview?.team ?? [] : overview?.personal ?? []),
    [overview, scope],
  );
  const currentLimit = scope === "team" ? (overview?.team_limit ?? 0) : (overview?.personal_limit ?? 1);
  const atLimit = currentList.length >= currentLimit;

  const normalizedTeamName = teamName.trim().toLowerCase();
  const duplicatePool = useMemo(() => {
    if (!normalizedTeamName) return null;
    return (
      currentList.find(
        (p) =>
          p.team_name.trim().toLowerCase() === normalizedTeamName &&
          (selectedId === "new" || p.id !== selectedId),
      ) ?? null
    );
  }, [currentList, normalizedTeamName, selectedId]);
  const isDuplicateName = duplicatePool !== null;

  function loadPool(pool: HeroPoolItem, editing = false) {
    setScope(pool.scope);
    setSelectedId(pool.id);
    setTeamName(pool.team_name);
    setLanes({ ...emptyPoolLanes(), ...pool.lanes });
    setIsEditing(editing);
    setError(null);
    setNotice(null);
  }

  function startNew(nextScope: HeroPoolScope) {
    setScope(nextScope);
    setSelectedId("new");
    setTeamName("");
    setLanes(emptyPoolLanes());
    setIsEditing(true);
    setError(null);
    setNotice(null);
  }

  function handleCancelEdit() {
    if (typeof selectedId === "number") {
      const existing = currentList.find((p) => p.id === selectedId);
      if (existing) {
        loadPool(existing, false);
        return;
      }
    }
    const fallback = currentList[0];
    if (fallback) {
      loadPool(fallback, false);
    } else {
      startNew(scope);
    }
  }

  async function reloadOverview(selectPool?: HeroPoolItem) {
    const next = await getHeroPools();
    setOverview(next);
    onChanged(next);
    if (selectPool) {
      setScope(selectPool.scope);
      setSelectedId(selectPool.id);
      setTeamName(selectPool.team_name);
      setLanes({ ...emptyPoolLanes(), ...selectPool.lanes });
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = teamName.trim();
    if (!clean || isDuplicateName) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveHeroPool({
        scope,
        team_name: clean,
        lanes,
        create_only: selectedId === "new",
        pool_id: typeof selectedId === "number" ? selectedId : undefined,
      });
      await reloadOverview(saved);
      setIsEditing(false);
      setNotice("บันทึก Hero Pool แล้ว");
    } catch (err) {
      setError(heroPoolErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyToTeam() {
    const clean = teamName.trim();
    if (!clean || !overview?.team_tier) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await saveHeroPool({ scope: "team", team_name: clean, lanes, create_only: true });
      await reloadOverview();
      setNotice("คัดลอกเข้า Pool ร่วมทีมแล้ว");
    } catch (err) {
      if (err instanceof ApiError && err.detail === "duplicate_team_name") {
        setError("มีทีมนี้ใน Pool ร่วมทีมแล้ว");
      } else {
        setError(heroPoolErrorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(pool: HeroPoolItem) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await deleteHeroPool(pool.id);
      const next = await getHeroPools();
      setOverview(next);
      onChanged(next);
      const fallback = (scope === "team" ? next.team : next.personal)[0];
      if (fallback) {
        loadPool(fallback);
      } else {
        startNew(scope);
      }
      setNotice("ลบ Hero Pool แล้ว");
    } catch (err) {
      setError(heroPoolErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function toggleHero(heroName: string) {
    if (isDuplicateName) return;
    setLanes((prev) => {
      const current = prev[activeLane] ?? [];
      const exists = current.includes(heroName);
      return {
        ...prev,
        [activeLane]: exists ? current.filter((h) => h !== heroName) : [...current, heroName],
      };
    });
  }

  const activeLaneHeroes = lanes[activeLane] ?? [];
  const activeLaneHeroSet = useMemo(() => new Set(lanes[activeLane] ?? []), [lanes, activeLane]);

  const filteredHeroes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return heroes
      .filter((h) => {
        if (!q) return true;
        return h.name.toLowerCase().includes(q) || displayName(h.name).toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const aSel = activeLaneHeroSet.has(a.name) ? 0 : 1;
        const bSel = activeLaneHeroSet.has(b.name) ? 0 : 1;
        if (aSel !== bSel) return aSel - bSel;
        const aMain = (a.main_pro_lane || a.lane) === activeLane ? 0 : 1;
        const bMain = (b.main_pro_lane || b.lane) === activeLane ? 0 : 1;
        if (aMain !== bMain) return aMain - bMain;
        return displayName(a.name).localeCompare(displayName(b.name));
      });
  }, [heroes, search, activeLaneHeroSet, activeLane]);

  const totalHeroesCount = POOL_LANES.reduce((acc, l) => acc + (lanes[l]?.length ?? 0), 0);

  return (
    <Modal labelledBy={titleId} className="max-w-4xl overflow-hidden" onClose={onClose}>
      {(requestClose) => (
        <>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <Users className="h-4 w-4 shrink-0 text-gold" />
              <div className="min-w-0">
                <h2 id={titleId} className="font-display text-sm font-bold tracking-wider text-ink sm:text-base">
                  {t("HERO POOLS · ซิงก์ตามชื่อทีมอัตโนมัติ")}
                </h2>
                <p className="text-[11px] text-dim">
                  {t("ตั้งชื่อทีมให้ตรงกับกระดานดราฟต์เพื่อซิงก์ Hero Pool ทั้ง 5 เลนอัตโนมัติ")}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => requestClose()}
              aria-label={t("ปิด")}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-dim hover:bg-panel-2 hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-panel-2/60 px-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                aria-pressed={scope === "personal"}
                onClick={() => {
                  setScope("personal");
                  const first = overview?.personal[0];
                  if (first) loadPool(first);
                  else startNew("personal");
                }}
                className="min-h-8 border border-line-strong px-2.5 text-xs font-semibold text-muted disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-gold aria-pressed:bg-gold/10 aria-pressed:text-gold"
              >
                <StableButtonLabel message="Pool ส่วนตัว" /> ({overview?.personal.length ?? 0}/
                {overview?.personal_limit ?? 1})
              </button>
              {overview?.team_tier && (
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={scope === "team"}
                  onClick={() => {
                    setScope("team");
                    const first = overview.team[0];
                    if (first) loadPool(first);
                    else startNew("team");
                  }}
                  className="min-h-8 border border-line-strong px-2.5 text-xs font-semibold text-muted disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-blue aria-pressed:bg-blue/10 aria-pressed:text-blue"
                >
                  <StableButtonLabel message="Pool ร่วมทีม" /> ({overview.team.length}/{overview.team_limit})
                </button>
              )}
            </div>
            {overview && !overview.is_paid && (
              <a
                href="#plans"
                onClick={() => requestClose()}
                className="text-xs font-semibold text-gold underline hover:text-ink"
              >
                {t("Free เพิ่มได้ 1 ทีมตัวเอง · อัปเกรด Pro เพื่อเพิ่มทีมคู่แข่ง")}
              </a>
            )}
          </div>

          {error && <Alert className="mx-4 mt-3">{t(error)}</Alert>}
          {notice && (
            <p role="status" className="px-4 pt-2 text-xs font-semibold text-good">
              {t(notice)}
            </p>
          )}

          <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[220px_1fr]">
            {/* Saved teams list */}
            <aside className="border-b border-line bg-bg/50 p-3 md:border-r md:border-b-0">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] font-bold text-muted">{t("ทีมที่บันทึกไว้")}</span>
                <button
                  type="button"
                  disabled={busy || atLimit}
                  onClick={() => startNew(scope)}
                  className="inline-flex min-h-7 items-center gap-1 border border-gold/60 bg-gold/10 px-2 text-[11px] font-bold text-gold hover:bg-gold hover:text-bg disabled:opacity-40"
                >
                  <Plus className="size-3" />
                  <span>{t("เพิ่มทีม")}</span>
                </button>
              </div>
              {currentList.length === 0 ? (
                <p className="text-xs text-dim">{t("ยังไม่มี Hero Pool ในหมวดนี้")}</p>
              ) : (
                <ul className="space-y-1.5">
                  {currentList.map((pool) => {
                    const count = POOL_LANES.reduce((sum, lane) => sum + (pool.lanes[lane]?.length ?? 0), 0);
                    const active = selectedId === pool.id;
                    return (
                      <li key={pool.id}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => loadPool(pool)}
                          className={`flex w-full items-center justify-between gap-2 border px-2.5 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            active
                              ? "border-gold bg-gold/10 font-bold text-gold"
                              : "border-line bg-panel text-ink hover:border-line-strong"
                          }`}
                        >
                          <span className="truncate font-display">{pool.team_name}</span>
                          <span className="shrink-0 font-mono text-[10px] text-muted">{count}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>

            {/* View / Editor */}
            {overview === null && !error ? (
              <div className="flex min-h-[240px] items-center justify-center p-4 text-xs text-muted" role="status">
                {t("กำลังโหลด…")}
              </div>
            ) : overview === null && error ? (
              <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 p-4 text-center">
                <p className="text-xs text-muted">{t("โหลดข้อมูลไม่สำเร็จ")}</p>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setLoadAttempt((n) => n + 1);
                  }}
                  className="min-h-8 border border-gold bg-gold/10 px-3 text-xs font-bold text-gold hover:bg-gold hover:text-bg"
                >
                  {t("ลองอีกครั้ง")}
                </button>
              </div>
            ) : !isEditing && typeof selectedId === "number" ? (
              <div className="flex min-w-0 flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <h3 className="truncate font-display text-base font-bold text-ink">{teamName}</h3>
                    <span className="shrink-0 border border-line bg-bg px-2 py-0.5 font-mono text-[11px] text-muted">
                      {t("{0} ฮีโร่", totalHeroesCount)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {scope === "personal" && overview?.team_tier && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleCopyToTeam()}
                        title={t("คัดลอกเข้า Pool ร่วมทีม")}
                        aria-label={t("คัดลอกเข้า Pool ร่วมทีม")}
                        className="inline-flex min-h-9 items-center gap-1.5 border border-line bg-bg px-3 font-display text-xs font-semibold text-muted transition-colors enabled:hover:border-gold/50 enabled:hover:text-gold focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-50"
                      >
                        <Copy className="size-3.5" aria-hidden="true" />
                        <StableButtonLabel message="คัดลอกเข้าทีม" />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        setNotice(null);
                        setIsEditing(true);
                      }}
                      className="inline-flex min-h-9 items-center gap-1.5 border border-gold/60 bg-gold/15 px-3 font-display text-xs font-bold text-gold hover:bg-gold hover:text-bg disabled:opacity-50"
                    >
                      <Pencil className="size-3.5" />
                      <StableButtonLabel message="แก้ไข" />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const found = currentList.find((p) => p.id === selectedId);
                        if (found) setConfirmDelete(found);
                      }}
                      aria-label={t("ลบ Pool")}
                      className="inline-flex min-h-9 items-center gap-1 border border-red/40 bg-red/10 px-3 text-xs font-semibold text-red hover:bg-red hover:text-ink disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" />
                      <span>{t("ลบ")}</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {POOL_LANES.map((lane) => {
                    const laneHeroes = lanes[lane] ?? [];
                    return (
                      <div key={lane} className="border border-line bg-bg/50 p-2.5">
                        <div className="mb-1.5 flex items-center gap-1.5 font-mono text-xs font-bold text-ink">
                          <LaneIcon lane={lane} className="size-3.5 text-gold" />
                          <span>{LANE_SHORT[lane]?.en ?? lane}</span>
                          <span className="text-gold">({laneHeroes.length})</span>
                        </div>
                        {laneHeroes.length === 0 ? (
                          <p className="text-[11px] text-dim">{t("ยังไม่มีฮีโร่ในเลนนี้")}</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {laneHeroes.map((heroName) => (
                              <div
                                key={heroName}
                                className="inline-flex items-center gap-1.5 border border-line bg-panel px-1.5 py-1 text-[11px] font-semibold text-ink"
                              >
                                <div className="size-5 shrink-0 overflow-hidden border border-line">
                                  <HeroPortrait name={heroName} hero={heroMap.get(heroName)} />
                                </div>
                                <span>{displayName(heroName)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
            <form onSubmit={handleSave} className="flex min-w-0 flex-col gap-3 p-4">
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[180px] flex-1 text-xs text-muted">
                  <span className="mb-1 block font-semibold">{t("ชื่อทีม (ใช้ซิงก์อัตโนมัติ)")}</span>
                  <input
                    type="text"
                    required
                    maxLength={32}
                    value={teamName}
                    aria-invalid={isDuplicateName}
                    onChange={(e) => setTeamName(e.target.value)}
                    placeholder={t("เช่น BRU, FS, MY TEAM")}
                    className={`min-h-9 w-full border bg-bg px-2.5 font-display text-sm font-bold text-ink focus:outline-none ${
                      isDuplicateName ? "border-red focus:border-red" : "border-line-strong focus:border-gold"
                    }`}
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy || !teamName.trim() || isDuplicateName || (selectedId === "new" && atLimit)}
                  className="min-h-9 border border-gold bg-gold px-4 font-display text-xs font-bold text-bg hover:bg-gold/90 disabled:opacity-50"
                >
                  <StableButtonLabel message="บันทึก Pool" /> ({totalHeroesCount})
                </button>
                {(typeof selectedId === "number" || currentList.length > 0) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleCancelEdit}
                    className="inline-flex min-h-9 items-center border border-line-strong bg-panel px-3 font-display text-xs font-semibold text-muted hover:text-ink disabled:opacity-50"
                  >
                    <StableButtonLabel message="ยกเลิก" />
                  </button>
                )}
                {typeof selectedId === "number" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const found = currentList.find((p) => p.id === selectedId);
                      if (found) setConfirmDelete(found);
                    }}
                    aria-label={t("ลบ Pool")}
                    className="inline-flex min-h-9 items-center gap-1 border border-red/40 bg-red/10 px-3 text-xs font-semibold text-red hover:bg-red hover:text-ink disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" />
                    <span>{t("ลบ")}</span>
                  </button>
                )}
              </div>

              {duplicatePool && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center justify-between gap-2 border border-red/40 bg-red/10 px-3 py-2 text-xs text-red"
                >
                  <span>
                    {t('มีชื่อทีม "{0}" อยู่แล้วในหมวดนี้ กรุณาเปลี่ยนชื่อก่อนเพิ่มฮีโร่', duplicatePool.team_name)}
                  </span>
                  <button
                    type="button"
                    onClick={() => loadPool(duplicatePool, true)}
                    className="border border-red/50 bg-bg px-2 py-1 font-semibold text-red hover:bg-red hover:text-ink"
                  >
                    {t('เปิดแก้ไข "{0}"', duplicatePool.team_name)}
                  </button>
                </div>
              )}

              {/* Lane tabs */}
              <div className="flex flex-wrap gap-1.5 border-b border-line pb-2">
                {POOL_LANES.map((lane) => {
                  const isCurrent = activeLane === lane;
                  const count = lanes[lane]?.length ?? 0;
                  return (
                    <button
                      key={lane}
                      type="button"
                      onClick={() => setActiveLane(lane)}
                      className={`inline-flex min-h-8 items-center gap-1.5 border px-2.5 font-mono text-xs font-bold transition-colors ${
                        isCurrent
                          ? "border-gold bg-gold text-bg"
                          : "border-line bg-bg text-muted hover:border-line-strong hover:text-ink"
                      }`}
                    >
                      <LaneIcon lane={lane} className="size-3.5" />
                      <span>{LANE_SHORT[lane]?.en ?? lane}</span>
                      <span className={isCurrent ? "text-bg/80" : "text-gold"}>({count})</span>
                    </button>
                  );
                })}
              </div>

              {/* Search & selected chips */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="relative min-w-[180px] flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-dim" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.preventDefault();
                    }}
                    placeholder={t("ค้นหาฮีโร่ในเลนนี้…")}
                    className="min-h-8 w-full border border-line bg-bg pr-2.5 pl-8 text-xs text-ink focus:border-gold focus:outline-none"
                  />
                </div>
                {activeLaneHeroes.length > 0 && (
                  <button
                    type="button"
                    disabled={isDuplicateName}
                    onClick={() => setLanes((prev) => ({ ...prev, [activeLane]: [] }))}
                    className="min-h-8 border border-line px-2 text-[11px] text-muted enabled:hover:text-red disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("ล้างเลนนี้")}
                  </button>
                )}
              </div>

              {/* Hero grid */}
              <div className="grid max-h-[290px] grid-cols-4 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-6 lg:grid-cols-7">
                {filteredHeroes.map((hero) => {
                  const selected = activeLaneHeroSet.has(hero.name);
                  return (
                    <button
                      key={hero.name}
                      type="button"
                      disabled={isDuplicateName}
                      onClick={() => toggleHero(hero.name)}
                      className={`relative flex flex-col items-center gap-1 border p-1.5 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        selected
                          ? "border-gold bg-gold/15 text-gold"
                          : "border-line bg-bg text-muted enabled:hover:border-line-strong enabled:hover:text-ink"
                      }`}
                    >
                      <div className="relative size-9 overflow-hidden border border-line">
                        <HeroPortrait name={hero.name} hero={heroMap.get(hero.name)} />
                        {selected && (
                          <span className="absolute right-0 bottom-0 grid size-4 place-items-center bg-gold text-bg">
                            <Check className="size-3" strokeWidth={3} />
                          </span>
                        )}
                      </div>
                      <span className="w-full truncate text-[10px] font-semibold">{displayName(hero.name)}</span>
                    </button>
                  );
                })}
              </div>
            </form>
            )}
          </div>

          {confirmDelete && (
            <ConfirmDialog
              title={t("ลบ Hero Pool?")}
              message={t('ต้องการลบ Hero Pool ของทีม "{0}" หรือไม่?', confirmDelete.team_name)}
              confirmLabel="ลบ"
              cancelLabel="ยกเลิก"
              tone="danger"
              onCancel={() => setConfirmDelete(null)}
              onConfirm={() => {
                const target = confirmDelete;
                setConfirmDelete(null);
                void handleDelete(target);
              }}
            />
          )}
        </>
      )}
    </Modal>
  );
}

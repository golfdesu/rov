import { StableButtonLabel } from "./StableButtonLabel";
import { useLanguage } from "../i18n/language";
import {
  BookmarkPlus,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Download,
  FolderOpen,
  History,
  Layers,
  PlusCircle,
  RotateCcw,
  Search,
  Trash2,
  Trophy,
  Upload,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { type ChangeEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { deleteJson, getJson } from "../api/client";
import { assignTeamSeriesTournament, assignTeamSeriesTournaments, editTeamHistorySeries, getTeam, renameTeamHistoryTournament, shareTeamGame, shareTeamSeries, teamErrorMessage, teamPath, type Team, type TeamGame } from "../api/team";
import { MAX_SERIES_GAMES, parseImportedDraftGames } from "../hooks/useDraft";
import type { Hero, HistorySeriesEdit, RecordedDraftGame, TeamId, TournamentRef } from "../types/draft";
import { getGameSeriesGroup, getGameSeriesKey, getRecordedTeamNames, listTournaments, normalizeTournament } from "../utils/draft";
import { displayName } from "../utils/heroNames";
import { Alert } from "./Alert";
import { ConfirmDialog } from "./ConfirmDialog";
import { CreateTournamentDialog } from "./CreateTournamentDialog";
import { HeroPortrait } from "./HeroPortrait";
import { Modal } from "./Modal";
import { type HistoryNameEditor, RenameHistoryButton, RenameHistoryItemDialog } from "./RenameHistoryItemDialog";
import { TournamentField } from "./TournamentField";

const UNKNOWN_UPLOADER = "?";
const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;
const ALL_TOURNAMENTS = "*";

interface DraftHistoryModalProps {
  games: RecordedDraftGame[];
  heroMap: Map<string, Hero>;
  hasCurrentDraftActions: boolean;
  onSaveCurrentSnapshot: () => boolean;
  teamHistoryUsername?: string;
  currentDraftSnapshot?: () => RecordedDraftGame;
  personalHistoryLimit?: number;
  onOpenNewSeries?: (tournament: TournamentRef | null, options: TournamentRef[]) => void;
  onAssignTournament?: (seriesKeys: ReadonlySet<string>, tournament: TournamentRef | null) => void;
  onRenameTournament?: (key: string, name: string) => void;
  onEditSeries?: (key: string, edit: HistorySeriesEdit) => void;
  onSwitchSeries?: (groupName: string) => void;
  onLoadGame: (game: RecordedDraftGame, source: "personal" | "team") => void;
  onSetGameWinner?: (id: string, winner?: TeamId) => void;
  onImportGames?: (
    games: RecordedDraftGame[],
  ) => { imported: number; skipped: number; remaining?: number; error?: "history_full" };
  onDeleteGame: (id: string) => void;
  onDeleteGroup: (groupName: string) => void;
  onClearAllSeries: () => void;
  onClose: () => void;
}

function groupHistoryEntries<T>(entries: readonly T[], getGame: (entry: T) => RecordedDraftGame) {
  const groups = new Map<string, {
    key: string;
    name: string;
    commonGameName: string | null;
    tournament: TournamentRef | null;
    items: T[];
    count: number;
    aWins: number;
    bWins: number;
    latestTimestamp: string;
  }>();
  for (const entry of entries) {
    const game = getGame(entry);
    const key = getGameSeriesKey(game);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        name: getGameSeriesGroup(game),
        commonGameName: game.gameName ?? "",
        tournament: game.tournament ?? null,
        items: [],
        count: 0,
        aWins: 0,
        bWins: 0,
        latestTimestamp: game.timestamp,
      };
      groups.set(key, group);
    }
    group.items.push(entry);
    group.count += 1;
    if (game.winner === "A") group.aWins += 1;
    else if (game.winner === "B") group.bWins += 1;
    if (group.commonGameName !== (game.gameName ?? "")) group.commonGameName = null;
  }
  return [...groups.values()];
}

async function shareTeamSeriesInChunks(team: Team, gamesList: readonly RecordedDraftGame[]) {
  let totalCopied = 0;
  let totalSkipped = 0;
  for (let i = 0; i < gamesList.length; i += 50) {
    const chunk = gamesList.slice(i, i + 50);
    const res = await shareTeamSeries(
      team,
      chunk.map((item) => item.id),
      chunk,
    );
    totalCopied += res.copied;
    totalSkipped += res.skipped;
  }
  return { copied: totalCopied, skipped: totalSkipped };
}

function canEditTeamSeries(items: readonly TeamGame[], team: Team | null, username?: string) {
  return team?.is_owner || items.every(({ author }) => author === username);
}

function groupByTournament<T extends { tournament: TournamentRef | null; count?: number; items: readonly unknown[]; visibleItems?: readonly unknown[] }>(
  groups: readonly T[],
) {
  const buckets = new Map<string, {
    id: string;
    tournament: TournamentRef | null;
    groups: T[];
    gameCount: number;
  }>();
  for (const group of groups) {
    const id = group.tournament?.id ?? "";
    const gameCount = group.visibleItems ? group.visibleItems.length : (group.count ?? group.items.length);
    const existing = buckets.get(id);
    if (existing) {
      existing.groups.push(group);
      existing.gameCount += gameCount;
    } else {
      buckets.set(id, {
        id,
        tournament: group.tournament,
        groups: [group],
        gameCount,
      });
    }
  }
  return [...buckets.values()].sort((a, b) => {
    if (a.id === "" && b.id !== "") return 1;
    if (a.id !== "" && b.id === "") return -1;
    return (a.tournament?.name ?? "").localeCompare(b.tournament?.name ?? "");
  });
}

function AssignTournamentDialog({
  seriesName, tournament, options, onSave, onClose,
}: {
  seriesName: string;
  tournament: TournamentRef | null;
  options: TournamentRef[];
  onSave: (tournament: TournamentRef | null) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const titleId = useId();
  const [value, setValue] = useState(tournament);
  return (
    <Modal labelledBy={titleId} onClose={onClose} className="max-w-sm">
      {(requestClose) => (
        <form className="space-y-3 p-4" onSubmit={(event) => {
          event.preventDefault();
          const normalized = normalizeTournament(value);
          if (value && !normalized) return;
          onSave(normalized);
          requestClose();
        }}>
          <h2 id={titleId} className="font-display text-base font-bold text-ink">
            {t(tournament ? "ย้ายทัวร์นาเมนต์" : "จัดเข้าทัวร์นาเมนต์")}
          </h2>
          <p className="break-words text-sm text-muted">{seriesName}</p>
          <TournamentField options={options} value={value} onChange={setValue} />
          <div className="flex justify-end gap-2">
            <button type="button" className="min-h-9 px-3 text-sm text-muted" onClick={() => requestClose()}>
              <StableButtonLabel message="ยกเลิก" />
            </button>
            <button
              type="submit"
              disabled={value !== null && !normalizeTournament(value)}
              className="min-h-9 border border-gold bg-gold px-3 text-sm font-bold text-bg disabled:cursor-not-allowed disabled:opacity-45"
            >
              <StableButtonLabel message="บันทึกทัวร์นาเมนต์" />
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function AssignTournamentButton({
  inTournament,
  disabled,
  onClick,
}: {
  inTournament: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const { t } = useLanguage();
  const label = inTournament ? "ย้ายทัวร์นาเมนต์" : "จัดเข้าทัวร์นาเมนต์";
  return (
    <button
      type="button"
      disabled={disabled}
      title={t(label)}
      aria-label={t(label)}
      className="inline-flex h-8 w-8 items-center justify-center gap-1 border border-line bg-bg text-xs font-semibold text-muted hover:border-gold/50 hover:text-gold disabled:opacity-50 lg:w-auto lg:px-2"
      onClick={onClick}
    >
      <Trophy className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="hidden lg:inline">
        <StableButtonLabel message={label} alternatives={["จัดเข้าทัวร์นาเมนต์", "ย้ายทัวร์นาเมนต์"]} />
      </span>
    </button>
  );
}

function DraftHeroPreview({ game, heroMap }: { game: RecordedDraftGame; heroMap: Map<string, Hero> }) {
  const { t } = useLanguage();
  const sides = [
    { side: "BLUE", name: game.blueTeamName, picks: game.bluePicks, bans: game.blueBans },
    { side: "RED", name: game.redTeamName, picks: game.redPicks, bans: game.redBans },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {sides.map(({ side, name, picks, bans }) => {
        const isBlue = side === "BLUE";
        return (
          <div key={side} className={`flex min-w-0 flex-col gap-1.5 border-l-2 bg-bg/50 p-2 lg:p-2.5 ${isBlue ? "border-blue" : "border-red"}`}>
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
              <span className={`min-w-0 font-display text-[11px] font-bold break-words lg:text-[13px] ${isBlue ? "text-blue" : "text-red"}`}>
                {side} · {name}
              </span>
              <span className="font-mono text-[10px] text-dim lg:text-xs">
                PICKS ({picks.length}/5) · BANS ({bans.length}/4)
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-2.5">
              {picks.map((hero, index) => (
                <div
                  key={`${index}-${hero}`}
                  title={`Pick ${index + 1}: ${displayName(hero)}`}
                  className={`h-9 w-9 shrink-0 overflow-hidden border bg-panel sm:h-11 sm:w-11 lg:h-12 lg:w-12 ${isBlue ? "border-blue/50" : "border-red/50"}`}
                >
                  <HeroPortrait name={hero} hero={heroMap.get(hero)} />
                </div>
              ))}
              {picks.length === 0 && <span className="text-[11px] text-dim lg:text-xs">{t("ไม่มีตัวที่เลือก")}</span>}
            </div>
            {bans.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-1.5 pt-0.5">
                <span className="mr-0.5 font-mono text-[9px] font-bold text-red sm:text-[10px] lg:text-[11px]">BANS:</span>
                {bans.map((hero, index) => (
                  <div
                    key={`${index}-${hero}`}
                    title={`Ban ${index + 1}: ${displayName(hero)}`}
                    className="relative h-7 w-7 overflow-hidden border border-red/40 sm:h-8 sm:w-8 lg:h-9 lg:w-9"
                  >
                    <HeroPortrait name={hero} hero={heroMap.get(hero)} className="grayscale opacity-65" />
                    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,transparent_45%,var(--color-red)_47%,var(--color-red)_53%,transparent_55%)] opacity-80" />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TeamGlobalBanPreview({ game, heroMap }: { game: RecordedDraftGame; heroMap: Map<string, Hero> }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const lists = game.globalBans;
  const teamAIsBlue = game.blueSideTeam === "A";
  const groups = lists ? [
    { label: t("{0} เคยใช้", game.blueTeamName), heroes: teamAIsBlue ? lists.teamAUsed : lists.teamBUsed, color: "text-blue" },
    { label: t("{0} เคยใช้", game.redTeamName), heroes: teamAIsBlue ? lists.teamBUsed : lists.teamAUsed, color: "text-red" },
    { label: t("แบนร่วมทั้งซีรีส์"), heroes: lists.universalBans, color: "text-gold" },
  ] : [];

  return (
    <details className="group mt-2 border border-line bg-bg/50" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 px-2 font-display text-xs font-semibold text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-gold [&::-webkit-details-marker]:hidden">
        <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        Global Ban
      </summary>
      {expanded && (
        <div className="border-t border-line p-2">
          {!lists ? (
            <p className="text-xs text-muted">{t("เกมนี้ไม่ได้เก็บข้อมูล Global Ban ไว้")}</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {groups.map(({ label, heroes, color }) => (
                <div key={color} className="min-w-0 space-y-1.5">
                  <p className={`font-display text-xs font-semibold break-words ${color}`}>{label}</p>
                  {heroes.length === 0 ? (
                    <p className="text-xs text-muted">{t("ไม่มีฮีโร่")}</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1">
                      {heroes.map((name) => (
                        <li key={name} className="flex max-w-full items-center gap-1 border border-line bg-panel pr-1.5 text-[11px] font-semibold text-ink">
                          <div className="size-6 shrink-0 overflow-hidden">
                            <HeroPortrait name={name} hero={heroMap.get(name)} />
                          </div>
                          <span className="min-w-0 truncate">{displayName(name)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </details>
  );
}

export function DraftHistoryModal({
  games,
  heroMap,
  hasCurrentDraftActions,
  onSaveCurrentSnapshot,
  teamHistoryUsername,
  currentDraftSnapshot,
  personalHistoryLimit,
  onOpenNewSeries,
  onAssignTournament,
  onRenameTournament,
  onEditSeries,
  onLoadGame,
  onSetGameWinner,
  onImportGames,
  onDeleteGame,
  onDeleteGroup,
  onClearAllSeries,
  onClose,
}: DraftHistoryModalProps) {
  const { t } = useLanguage();
  const titleId = useId();
  const exportTitleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [selectedGroup, setSelectedGroup] = useState<string>("ALL");
  const [tournamentFilter, setTournamentFilter] = useState(ALL_TOURNAMENTS);
  const [createTournamentOpen, setCreateTournamentOpen] = useState(false);
  const [nameEdit, setNameEdit] = useState<HistoryNameEditor | null>(null);
  const [tournamentAssignment, setTournamentAssignment] = useState<
    { name: string; tournament: TournamentRef | null } &
    ({ scope: "personal"; key: string } | { scope: "team"; gameId: number }) | null
  >(null);
  const [historySearch, setHistorySearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [collapsedTournaments, setCollapsedTournaments] = useState<Record<string, boolean>>({});
  const [expandAllOverride, setExpandAllOverride] = useState<boolean | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [destination, setDestination] = useState<"personal" | "team">("personal");
  const [teamGames, setTeamGames] = useState<TeamGame[] | null>(null);
  const [selectedUploader, setSelectedUploader] = useState("");
  const [teamRevision, setTeamRevision] = useState(0);
  const [teamBusy, setTeamBusy] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamNotice, setTeamNotice] = useState<string | null>(null);
  const [exportPickerOpen, setExportPickerOpen] = useState(false);
  const [selectedExportGroups, setSelectedExportGroups] = useState<Set<string>>(() => new Set());
  const [exportSearch, setExportSearch] = useState("");
  const [toast, setToast] = useState<{ title: string; detail: string } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const teamSnapshot = useRef<RecordedDraftGame | null>(null);
  const teamBusyRef = useRef(false);
  const lastTeamFocusRefreshRef = useRef(0);
  const translateRef = useRef(t);
  translateRef.current = t;

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  function showToast(title: string, detail: string) {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast({ title, detail });
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, 4000);
  }
  const showTeamHistory = team !== null && destination === "team";
  const uploaders = useMemo(() => {
    const names = new Set(teamGames?.map(({ author }) => author));
    const sorted = [...names].filter((name): name is string => name !== null).sort();
    if (names.has(null)) sorted.push(UNKNOWN_UPLOADER);
    return sorted;
  }, [teamGames]);
  const activeUploader = uploaders.includes(selectedUploader) ? selectedUploader : "";
  const tournaments = useMemo(
    () => listTournaments(showTeamHistory ? teamGames?.map(({ game }) => game) ?? [] : games),
    [showTeamHistory, teamGames, games],
  );
  const selectedTournament = tournaments.find(({ id }) => id === tournamentFilter) ?? null;
  const activeTournament = selectedTournament?.id ?? (tournamentFilter === "" ? "" : ALL_TOURNAMENTS);
  const teamGroups = useMemo(() => groupHistoryEntries(teamGames ?? [], ({ game }) => game), [teamGames]);
  const personalGroups = useMemo(() => groupHistoryEntries(games, (game) => game), [games]);
  const editableTeamSeries = useMemo(
    () => teamGroups.filter(({ items }) => canEditTeamSeries(items, team, teamHistoryUsername)),
    [teamGroups, team, teamHistoryUsername],
  );
  const editableTeamSeriesKeys = useMemo(
    () => new Set(editableTeamSeries.map((g) => g.key)),
    [editableTeamSeries],
  );
  const tournamentChoices = showTeamHistory ? editableTeamSeries : onAssignTournament ? personalGroups : [];
  const restrictedTeamTournaments = useMemo(() => {
    const restricted = new Set<string>();
    if (!team?.is_owner) {
      for (const { author, game } of teamGames ?? []) {
        if (author !== teamHistoryUsername && game.tournament) restricted.add(game.tournament.id);
      }
    }
    return restricted;
  }, [team, teamGames, teamHistoryUsername]);
  const displayedTeamGroups = useMemo(() => teamGroups
    .filter((group) => activeTournament === ALL_TOURNAMENTS || (group.tournament?.id ?? "") === activeTournament)
    .map((group) => ({
      ...group,
      visibleItems: activeUploader
        ? group.items.filter(({ author }) => (author ?? UNKNOWN_UPLOADER) === activeUploader)
        : group.items,
    }))
    .filter(({ visibleItems }) => visibleItems.length > 0),
  [activeTournament, activeUploader, teamGroups]);
  const historyLimit = personalHistoryLimit ?? MAX_SERIES_GAMES;
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);

  useEffect(() => {
    if (!teamHistoryUsername) return;
    const ctrl = new AbortController();
    getTeam(ctrl.signal)
      .then(({ team }) => {
        if (!ctrl.signal.aborted) setTeam(team);
      })
      .catch(() => {
        // Keep previously loaded team state on transient network failure.
      });
    return () => ctrl.abort();
  }, [teamHistoryUsername]);

  useEffect(() => {
    if (!teamHistoryUsername) return;
    const refresh = () => {
      if (teamBusyRef.current) return;
      const now = Date.now();
      if (now - lastTeamFocusRefreshRef.current < 15_000) return;
      lastTeamFocusRefreshRef.current = now;
      setTeamRevision((value) => value + 1);
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [teamHistoryUsername]);

  useEffect(() => {
    if (!showTeamHistory) return;
    const ctrl = new AbortController();
    getJson<TeamGame[]>(`${teamPath}/history`, ctrl.signal).then(setTeamGames).catch((error: unknown) => {
      if (!ctrl.signal.aborted) {
        setTeamGames(null);
        setTeamError(translateRef.current(teamErrorMessage(error)));
      }
    });
    return () => ctrl.abort();
  }, [showTeamHistory, teamRevision]);

  async function updateTeamHistory<T = void>(
    operation: () => Promise<T>,
    success?: string | ((result: T) => string),
  ) {
    teamBusyRef.current = true;
    setTeamBusy(true);
    setTeamError(null);
    setTeamNotice(null);
    try {
      const result = await operation();
      if (success) {
        setTeamNotice(typeof success === "function" ? success(result) : success);
      }
    } catch (error) {
      setTeamError(t(teamErrorMessage(error)));
    } finally {
      teamBusyRef.current = false;
      setTeamRevision((value) => value + 1);
      setTeamBusy(false);
    }
  }

  async function createTournament(keys: ReadonlySet<string>, tournament: TournamentRef) {
    if (showTeamHistory) {
      const anchors = editableTeamSeries.filter(({ key }) => keys.has(key)).map(({ items }) => items[0].id);
      await assignTeamSeriesTournaments(anchors, tournament);
      setTeamGames((current) => current?.map((entry) => keys.has(getGameSeriesKey(entry.game))
        ? { ...entry, game: { ...entry.game, tournament } }
        : entry) ?? null);
      setTeamError(null);
      setTeamNotice(null);
      setTeamRevision((value) => value + 1);
      setSelectedUploader("");
    } else {
      onAssignTournament?.(keys, tournament);
    }
    setTournamentFilter(tournament.id);
    setSelectedGroup("ALL");
    setHistorySearch("");
  }

  async function saveTeamNames(action: () => Promise<void>) {
    await action();
    setTeamError(null);
    setTeamNotice(null);
    setTeamRevision((revision) => revision + 1);
  }

  function openSeriesEditor(
    seriesTitle: string, gameName: string | null, game: RecordedDraftGame, onSave: (edit: HistorySeriesEdit) => void | Promise<void>,
  ) {
    setNameEdit({
      target: "series",
      current: { seriesTitle, gameName, ...getRecordedTeamNames(game) },
      onSave,
    });
  }

  function saveSnapshot() {
    if (!showTeamHistory || !team || !currentDraftSnapshot) {
      setTeamError(onSaveCurrentSnapshot() ? null : t("ประวัติส่วนตัวเต็มแล้ว ลบเกมเดิมก่อนบันทึก"));
      return;
    }
    const game = teamSnapshot.current ?? currentDraftSnapshot();
    teamSnapshot.current = game;
    void updateTeamHistory(() => shareTeamGame(team, game.id, game), t("บันทึกลงประวัติทีมแล้ว"));
  }

  const teamExportGroups = useMemo(
    () => teamGroups.map((grp) => ({ ...grp, items: grp.items.map((entry) => entry.game) })),
    [teamGroups],
  );
  const exportGroups = showTeamHistory ? teamExportGroups : personalGroups;

  const filteredExportGroups = useMemo(() => {
    const q = exportSearch.trim().toLowerCase();
    if (!q) return exportGroups;
    return exportGroups.filter((grp) => {
      if (grp.name.toLowerCase().includes(q) || grp.tournament?.name.toLowerCase().includes(q)) return true;
      return grp.items.some((g) => {
        if (g.gameName?.toLowerCase().includes(q) || g.blueTeamName.toLowerCase().includes(q) || g.redTeamName.toLowerCase().includes(q)) {
          return true;
        }
        return (
          g.bluePicks.some((h) => h.toLowerCase().includes(q) || displayName(h).toLowerCase().includes(q)) ||
          g.redPicks.some((h) => h.toLowerCase().includes(q) || displayName(h).toLowerCase().includes(q)) ||
          g.blueBans.some((h) => h.toLowerCase().includes(q) || displayName(h).toLowerCase().includes(q)) ||
          g.redBans.some((h) => h.toLowerCase().includes(q) || displayName(h).toLowerCase().includes(q))
        );
      });
    });
  }, [exportGroups, exportSearch]);

  const selectedExportGroupList = useMemo(
    () => exportGroups.filter((grp) => selectedExportGroups.has(grp.key)),
    [exportGroups, selectedExportGroups],
  );
  const selectedExportGames = useMemo(
    () => selectedExportGroupList.flatMap((grp) => grp.items),
    [selectedExportGroupList],
  );

  function openExportPicker() {
    setExportSearch("");
    setSelectedExportGroups(
      exportGroups.length === 1 ? new Set([exportGroups[0].key]) : new Set(),
    );
    setExportPickerOpen(true);
  }

  function toggleExportGroup(groupName: string) {
    setSelectedExportGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) next.delete(groupName);
      else next.add(groupName);
      return next;
    });
  }

  function handleConfirmExport() {
    if (selectedExportGames.length === 0) return;
    const blob = new Blob([JSON.stringify(selectedExportGames, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateTag = new Date().toISOString().slice(0, 10);
    const scope = showTeamHistory ? "team" : "personal";
    const selectedNames = selectedExportGroupList.map((grp) => grp.name);
    const slug =
      selectedNames.length === 1
        ? selectedNames[0]
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
        : "";
    const filename = slug
      ? `minidraft-${scope}-${slug}-${dateTag}.json`
      : `minidraft-${scope}-history-${dateTag}.json`;
    const seriesCount = selectedExportGroupList.length;
    const gameCount = selectedExportGames.length;
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setExportPickerOpen(false);
    showToast(
      t("ส่งออก JSON สำเร็จ"),
      `${t("ส่งออกแล้ว {0} ซีรีส์ ({1} เกม)", seriesCount, gameCount)} · ${filename}`,
    );
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setTeamError(null);
    setTeamNotice(null);
    try {
      if (file.size > MAX_IMPORT_FILE_BYTES) {
        setTeamError(t("ไฟล์มีขนาดใหญ่เกินไป (สูงสุด 2 MB)"));
        return;
      }
      const text = await file.text();
      const parsedJson: unknown = JSON.parse(text);
      const validHeroNames = new Set(heroMap.keys());
      const parsedResult = parseImportedDraftGames(parsedJson, validHeroNames);
      if (!parsedResult.ok) {
        const msgMap = {
          too_many_games: "ไฟล์มีจำนวนเกมเกินกำหนด (สูงสุด 500 เกม)",
          invalid_hero: "พบชื่อฮีโร่ที่ไม่ถูกต้องในไฟล์ JSON",
          duplicate_hero: "พบฮีโร่ซ้ำกันภายในเกมเดียวกันในไฟล์ JSON",
          out_of_bounds: "จำนวนช่องเลือก/แบน หรือค่าตัวเลขในไฟล์เกินขอบเขตที่ระบบรองรับ",
          invalid_format: "ไฟล์ JSON ไม่ถูกต้องหรือไม่พบข้อมูลเกม",
        } as const;
        setTeamError(t(msgMap[parsedResult.error]));
        return;
      }
      const parsedGames = parsedResult.games;
      if (showTeamHistory && team) {
        await updateTeamHistory(() => shareTeamSeriesInChunks(team, parsedGames), ({ copied, skipped }) => {
          const msg =
            copied === 0
              ? t("เกมทั้งหมดในไฟล์มีอยู่ในประวัติทีมแล้ว")
              : skipped > 0
                ? t("นำเข้าประวัติทีมแล้ว {0} เกม (มีอยู่แล้ว {1} เกม)", copied, skipped)
                : t("นำเข้าประวัติทีมแล้ว {0} เกม", copied);
          showToast(t("นำเข้า JSON สำเร็จ"), msg);
          return msg;
        });
        return;
      }
      if (!onImportGames) return;
      const res = onImportGames(parsedGames);
      if (res.error === "history_full") {
        setTeamError(
          t(
            "โควตาประวัติส่วนตัวไม่พอ (เหลือ {0} เกม แต่ไฟล์มี {1} เกมใหม่)",
            res.remaining ?? 0,
            parsedGames.length - res.skipped,
          ),
        );
        return;
      }
      const msg =
        res.imported === 0
          ? t("เกมทั้งหมดในไฟล์มีอยู่ในประวัติส่วนตัวแล้ว")
          : res.skipped > 0
            ? t("นำเข้าประวัติส่วนตัวแล้ว {0} เกม (มีอยู่แล้ว {1} เกม)", res.imported, res.skipped)
            : t("นำเข้าประวัติส่วนตัวแล้ว {0} เกม", res.imported);
      setTeamNotice(msg);
      showToast(t("นำเข้า JSON สำเร็จ"), msg);
    } catch {
      setTeamError(t("ไฟล์ JSON ไม่ถูกต้องหรือไม่พบข้อมูลเกม"));
    } finally {
      event.target.value = "";
    }
  }

  const groups = useMemo(() => personalGroups
    .filter((group) => activeTournament === ALL_TOURNAMENTS || (group.tournament?.id ?? "") === activeTournament),
  [activeTournament, personalGroups]);

  // If currently selected group no longer exists (e.g. deleted), revert to "ALL"
  const activeGroup =
    selectedGroup === "ALL" || groups.some((grp) => grp.key === selectedGroup)
      ? selectedGroup
      : "ALL";

  const displayedGroups = useMemo(() => {
    const byGroup = activeGroup === "ALL" ? groups : groups.filter((grp) => grp.key === activeGroup);
    const q = historySearch.trim().toLowerCase();
    if (!q) return byGroup;
    return byGroup.filter((grp) => {
      if (grp.name.toLowerCase().includes(q) || grp.tournament?.name.toLowerCase().includes(q)) return true;
      return grp.items.some((g) => {
        if (g.gameName?.toLowerCase().includes(q) || g.blueTeamName.toLowerCase().includes(q) || g.redTeamName.toLowerCase().includes(q)) return true;
        return (
          g.bluePicks.some((h) => h.toLowerCase().includes(q) || displayName(h).toLowerCase().includes(q)) ||
          g.redPicks.some((h) => h.toLowerCase().includes(q) || displayName(h).toLowerCase().includes(q)) ||
          g.blueBans.some((h) => h.toLowerCase().includes(q) || displayName(h).toLowerCase().includes(q)) ||
          g.redBans.some((h) => h.toLowerCase().includes(q) || displayName(h).toLowerCase().includes(q))
        );
      });
    });
  }, [groups, activeGroup, historySearch]);

  const scopeGroupsCount = showTeamHistory ? teamGroups.length : personalGroups.length;
  const tournamentSummaries = useMemo(
    () => (showTeamHistory ? groupByTournament(teamGroups) : groupByTournament(personalGroups)),
    [showTeamHistory, teamGroups, personalGroups],
  );
  const personalTournamentBuckets = useMemo(() => groupByTournament(displayedGroups), [displayedGroups]);
  const teamTournamentBuckets = useMemo(() => groupByTournament(displayedTeamGroups), [displayedTeamGroups]);
  const firstVisibleSeriesKey = personalTournamentBuckets[0]?.groups[0]?.key ?? null;
  const totalPersonalGamesCount = useMemo(() => groups.reduce((sum, g) => sum + g.count, 0), [groups]);

  const isTournamentExpanded = (id: string, bucketCount: number): boolean => {
    if (activeTournament !== ALL_TOURNAMENTS || (!showTeamHistory && historySearch.trim() !== "") || bucketCount <= 1) return true;
    return !(collapsedTournaments[id] ?? false);
  };

  const isGroupExpanded = (groupName: string): boolean => {
    if (activeGroup !== "ALL" || historySearch.trim() !== "") return true;
    if (groupName in expandedGroups) return expandedGroups[groupName];
    if (expandAllOverride !== null) return expandAllOverride;
    return displayedGroups.length <= 3 || groupName === firstVisibleSeriesKey;
  };
  const hasAnyCollapsedPersonalGroup = useMemo(
    () => displayedGroups.some((grp) => !isGroupExpanded(grp.key)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirrors exact expand rules for displayedGroups
    [displayedGroups, activeGroup, historySearch, expandedGroups, expandAllOverride, firstVisibleSeriesKey],
  );

  return (
    <Modal
      labelledBy={titleId}
      className="max-w-4xl overflow-hidden lg:max-w-5xl"
      onClose={onClose}
    >
      {(requestClose) => (
        <>
      {/* Header */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-line px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <History className="h-4 w-4 shrink-0 text-gold lg:h-5 lg:w-5" />
            <div className="min-w-0">
              <h2 id={titleId} ref={titleRef} tabIndex={-1} className="flex flex-wrap items-center gap-1.5 font-display text-xs font-bold tracking-wider text-ink sm:gap-2 sm:text-sm lg:text-base">
                <span>
                  DRAFT HISTORY{!team && <span className="hidden sm:inline"> {t("& SERIES · ประวัติการดราฟต์แยกตามกลุ่มซีรีส์")}</span>}
                </span>
                <span className="border border-gold/60 bg-gold/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-gold sm:px-2 sm:text-xs lg:text-[13px]">
                  {showTeamHistory ? `${teamGames?.length ?? "—"}/500` : `${games.length}/${historyLimit}`}
                </span>
              </h2>
              {!showTeamHistory && personalHistoryLimit === undefined && <p className="hidden text-[11px] text-dim sm:block lg:text-xs">
                {t("ระบบจัดกลุ่มตามคู่แข่งขัน (เช่น BRU vs FS) อัตโนมัติ — บันทึกสูงสุด")} {MAX_SERIES_GAMES} {t("เกมล่าสุด (หากเกินจะลบเกมเก่าสุดอัตโนมัติ)")}
              </p>}
            </div>
          </div>

          <button
            type="button"
            onClick={() => requestClose()}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-dim transition-colors hover:bg-panel-2 hover:text-ink sm:hidden"
            aria-label={t("ปิด")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0 sm:gap-2">
          {onOpenNewSeries && (
            <button
              type="button"
              onClick={() => requestClose(() => onOpenNewSeries(selectedTournament, tournaments))}
              title={t("เริ่มแมตช์ / ซีรีส์ใหม่ (แยกประวัติออกจากแมตช์เดิม)")}
              className="flex h-7 items-center gap-1 border border-gold bg-gold px-2 font-display text-[10px] font-bold tracking-wide whitespace-nowrap text-bg transition-colors hover:bg-gold/90 sm:h-8 sm:gap-1.5 sm:px-2.5 sm:text-[11px] lg:px-3 lg:text-xs"
            >
              <PlusCircle className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              <span><StableButtonLabel message="+ แมตช์ใหม่" /></span>
            </button>
          )}
          {hasCurrentDraftActions && (
            <button
              type="button"
              onClick={() => {
                titleRef.current?.focus({ preventScroll: true });
                saveSnapshot();
              }}
              disabled={teamBusy}
              title={t("บันทึกกระดานดราฟต์ปัจจุบันเก็บเข้าประวัติโดยไม่ล้างกระดาน")}
              className="flex h-7 items-center gap-1 border border-gold/60 bg-gold/10 px-2 font-display text-[10px] font-bold tracking-wide whitespace-nowrap text-gold transition-colors hover:bg-gold hover:text-bg sm:h-8 sm:gap-1.5 sm:px-2.5 sm:text-[11px] lg:px-3 lg:text-xs"
            >
              <BookmarkPlus className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              {team ? (
                <StableButtonLabel
                  message={showTeamHistory ? "บันทึกเข้าทีม" : "บันทึกส่วนตัว"}
                  alternatives={["บันทึกเข้าทีม", "บันทึกส่วนตัว"]}
                />
              ) : (
                <>
                  <span className="sm:hidden"><StableButtonLabel message="บันทึกปัจจุบัน" /></span>
                  <span className="hidden sm:inline"><StableButtonLabel message="บันทึกกระดานปัจจุบัน" /></span>
                </>
              )}
            </button>
          )}
          {(onImportGames || showTeamHistory) && (
            <>
              <input
                ref={importInputRef}
                type="file"
                accept=".json,application/json"
                onChange={(e) => void handleImportFile(e)}
                className="hidden"
              />
              <button
                type="button"
                disabled={teamBusy}
                onClick={() => importInputRef.current?.click()}
                title={t("นำเข้าประวัติจากไฟล์ JSON")}
                className="flex h-7 items-center gap-1 border border-line-strong bg-panel px-2 font-display text-[10px] font-semibold whitespace-nowrap text-ink transition-colors hover:border-gold/60 hover:text-gold disabled:opacity-35 sm:h-8 sm:px-2.5 sm:text-[11px] lg:text-xs"
              >
                <Download className="h-3 w-3 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline"><StableButtonLabel message="นำเข้า JSON" /></span>
              </button>
            </>
          )}
          <button
            type="button"
            disabled={showTeamHistory ? !teamGames?.length : games.length === 0}
            onClick={openExportPicker}
            title={t("ส่งออกประวัติเป็นไฟล์ JSON")}
            className="flex h-7 items-center gap-1 border border-line-strong bg-panel px-2 font-display text-[10px] font-semibold whitespace-nowrap text-ink transition-colors hover:border-gold/60 hover:text-gold disabled:opacity-35 sm:h-8 sm:px-2.5 sm:text-[11px] lg:text-xs"
          >
            <Upload className="h-3 w-3 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline"><StableButtonLabel message="ส่งออก JSON" /></span>
          </button>
          {!showTeamHistory && <button
            type="button"
            disabled={games.length === 0}
            onClick={() =>
              setConfirmState({
                title: t("รีเซ็ตประวัติทั้งซีรีส์?"),
                message: t("ล้างประวัติซีรีส์, Global Ban และกระดานปัจจุบันทั้งหมดเพื่อเริ่มซีรีส์ใหม่? (ไม่สามารถย้อนกลับได้)"),
                confirmLabel: "ล้างทั้งหมด",
                onConfirm: () => {
                  setConfirmState(null);
                  onClearAllSeries();
                  requestClose();
                },
              })
            }
            className="flex h-7 items-center gap-1 border border-red/40 bg-red/10 px-2 font-display text-[11px] font-semibold tracking-wide whitespace-nowrap text-red transition-colors hover:bg-red hover:text-ink disabled:pointer-events-none disabled:opacity-35 sm:h-8 sm:gap-1.5 sm:px-2.5 lg:px-3 lg:text-xs"
          >
            <RotateCcw className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            <span className="sm:hidden"><StableButtonLabel message="รีเซ็ตทั้งหมด" /></span>
            <span className="hidden sm:inline"><StableButtonLabel message="รีเซ็ตทั้งซีรีส์" /></span>
          </button>}
          <button
            type="button"
            onClick={() => requestClose()}
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded text-dim transition-colors hover:bg-panel-2 hover:text-ink sm:inline-flex"
            aria-label={t("ปิด")}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {(team || tournaments.length > 0 || tournamentChoices.length > 0) && (
        <div className="flex shrink-0 flex-col gap-2 border-b border-line bg-panel/70 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 sm:flex-1 sm:justify-start">
            {team && (
              <div className="grid grid-cols-2 gap-0.5 border border-line bg-bg p-0.5">
                {(["personal", "team"] as const).map((option) => {
                  const Icon = option === "team" ? UsersRound : UserRound;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={destination === option}
                      onClick={() => {
                        if (destination === option) return;
                        setDestination(option);
                        setTournamentFilter(ALL_TOURNAMENTS);
                        setSelectedGroup("ALL");
                        if (option === "team") setHistorySearch("");
                      }}
                      className="inline-flex min-h-8 items-center justify-center gap-1.5 border border-transparent px-2.5 font-display text-xs font-semibold text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-gold aria-pressed:border-gold/40 aria-pressed:bg-gold/10 aria-pressed:text-gold"
                    >
                      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                      <StableButtonLabel message={option === "team" ? "ประวัติทีม" : "ประวัติส่วนตัว"} />
                    </button>
                  );
                })}
              </div>
            )}

            {tournamentChoices.length > 0 && (
              <button
                type="button"
                disabled={showTeamHistory && teamBusy}
                onClick={() => setCreateTournamentOpen(true)}
                className="inline-flex min-h-8 shrink-0 items-center gap-1.5 border border-gold/50 bg-gold/10 px-2.5 font-display text-xs font-semibold text-gold hover:bg-gold hover:text-bg focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-50 sm:hidden"
              >
                <Trophy className="size-3.5 shrink-0" aria-hidden="true" />
                <StableButtonLabel message="สร้างทัวร์นาเมนต์" />
              </button>
            )}

            {tournaments.length > 0 && (
              tournamentSummaries.length <= 5 ? (
                <div role="group" aria-label={t("ทัวร์นาเมนต์")} className="flex w-full min-w-0 items-center gap-1 overflow-x-auto pb-0.5 sm:w-auto sm:flex-wrap sm:overflow-visible sm:pb-0">
                  <button
                    type="button"
                    aria-pressed={activeTournament === ALL_TOURNAMENTS}
                    onClick={() => {
                      setTournamentFilter(ALL_TOURNAMENTS);
                      setSelectedGroup("ALL");
                    }}
                    className="inline-flex min-h-8 shrink-0 items-center gap-1.5 border border-line bg-bg px-2.5 font-display text-xs font-semibold whitespace-nowrap text-muted transition-colors hover:border-line-strong hover:text-ink aria-pressed:border-gold aria-pressed:bg-gold/15 aria-pressed:text-gold"
                  >
                    <span>{t("ทั้งหมด")}</span>
                    <span className="font-mono text-[10px] opacity-80">{scopeGroupsCount}</span>
                  </button>
                  {tournamentSummaries.map((bucket) => {
                    const isActive = activeTournament === bucket.id;
                    const isNamed = bucket.tournament !== null;
                    return (
                      <button
                        key={bucket.id || "__none"}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => {
                          setTournamentFilter(bucket.id);
                          setSelectedGroup("ALL");
                        }}
                        className="inline-flex min-h-8 max-w-[200px] shrink-0 items-center gap-1.5 border border-line bg-bg px-2.5 font-display text-xs font-semibold whitespace-nowrap text-muted transition-colors hover:border-line-strong hover:text-ink aria-pressed:border-gold aria-pressed:bg-gold/15 aria-pressed:text-gold"
                      >
                        {isNamed && <Trophy className="size-3 shrink-0 text-gold" aria-hidden="true" />}
                        <span className="truncate">{bucket.tournament?.name ?? t("ไม่สังกัดทัวร์นาเมนต์")}</span>
                        <span className="shrink-0 font-mono text-[10px] opacity-80">{bucket.groups.length}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <label className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                  <Trophy className="size-3.5 shrink-0 text-gold" aria-hidden="true" />
                  <select
                    aria-label={t("ทัวร์นาเมนต์")}
                    className="h-8 min-w-0 max-w-xs border border-line-strong bg-bg px-2 font-display text-xs font-semibold text-ink focus:border-gold focus:outline-none"
                    value={activeTournament}
                    onChange={(event) => {
                      setTournamentFilter(event.target.value);
                      setSelectedGroup("ALL");
                    }}
                  >
                    <option value={ALL_TOURNAMENTS}>{t("ทุกทัวร์นาเมนต์")}</option>
                    <option value="">{t("ไม่สังกัดทัวร์นาเมนต์")}</option>
                    {tournaments.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                  </select>
                </label>
              )
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {showTeamHistory && uploaders.length > 0 && (
              <label className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                <span className="hidden shrink-0 sm:inline">{t("กรองตามผู้บันทึก")}</span>
                <select
                  aria-label={t("กรองตามผู้บันทึก")}
                  className="min-h-8 min-w-0 border border-line-strong bg-bg px-2 text-xs text-ink focus-visible:outline-2 focus-visible:outline-gold"
                  value={activeUploader}
                  onChange={(event) => setSelectedUploader(event.target.value)}
                >
                  <option value="">{t("ผู้บันทึกทุกคน")}</option>
                  {uploaders.map((name) => (
                    <option key={name} value={name}>
                      {name === UNKNOWN_UPLOADER ? t("ไม่ทราบผู้บันทึก") : `@${name}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {tournamentChoices.length > 0 && (
              <button
                type="button"
                disabled={showTeamHistory && teamBusy}
                onClick={() => setCreateTournamentOpen(true)}
                className="hidden min-h-8 items-center gap-1.5 border border-gold/50 bg-gold/10 px-2.5 font-display text-xs font-semibold text-gold hover:bg-gold hover:text-bg focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-50 sm:inline-flex"
              >
                <Trophy className="size-3.5 shrink-0" aria-hidden="true" />
                <StableButtonLabel message="สร้างทัวร์นาเมนต์" />
              </button>
            )}
          </div>
        </div>
      )}
      {teamError && <Alert className="m-2">{teamError}</Alert>}
      {teamNotice && <p role="status" className="px-3 py-2 text-sm text-good">{teamNotice}</p>}
      {showTeamHistory ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          {teamGames === null && !teamError && <p role="status">{t("กำลังโหลด…")}</p>}
          {teamGames?.length === 0 && (
            <div className="flex flex-col items-center gap-2 border border-dashed border-line px-4 py-8 text-center">
              <UsersRound className="size-5 text-muted" aria-hidden="true" />
              <p className="text-sm font-semibold text-ink">{t("ยังไม่มีเกมในประวัติทีม")}</p>
              <p className="text-xs text-muted">{t("บันทึกกระดานปัจจุบัน หรือคัดลอกซีรีส์จากประวัติส่วนตัว")}</p>
            </div>
          )}
          {teamGames && teamGames.length > 0 && displayedTeamGroups.length === 0 && (
            <p className="border border-dashed border-line p-4 text-center text-xs text-muted">{t("ไม่พบเกมตามตัวกรอง")}</p>
          )}
          <div className="space-y-3.5">
            {teamTournamentBuckets.map((bucket) => {
              const tKey = `team:${bucket.id || "__none"}`;
              const tExpanded = isTournamentExpanded(tKey, teamTournamentBuckets.length);
              const isNamed = bucket.tournament !== null;
              return (
                <section
                  key={tKey}
                  className={isNamed
                    ? "border border-gold/35 border-l-2 border-l-gold bg-panel/40"
                    : "border border-line bg-panel/25"}
                >
                  <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${isNamed ? "border-b border-gold/25 bg-gradient-to-r from-gold/12 via-gold/5 to-transparent" : "border-b border-line bg-panel-2/40"}`}>
                    <button
                      type="button"
                      aria-expanded={tExpanded}
                      onClick={() => setCollapsedTournaments((prev) => ({ ...prev, [tKey]: tExpanded }))}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <ChevronDown
                        className={`size-4 shrink-0 transition-transform ${isNamed ? "text-gold" : "text-muted"} ${tExpanded ? "rotate-0" : "-rotate-90"}`}
                        aria-hidden="true"
                      />
                      {isNamed
                        ? <Trophy className="size-4 shrink-0 text-gold" aria-hidden="true" />
                        : <Layers className="size-3.5 shrink-0 text-muted" aria-hidden="true" />}
                      <h3 className={`min-w-0 truncate font-display text-xs font-extrabold tracking-wide sm:text-sm ${isNamed ? "text-gold" : "text-muted"}`}>
                        {bucket.tournament?.name ?? t("ไม่สังกัดทัวร์นาเมนต์")}
                      </h3>
                      <span className="shrink-0 border border-line bg-bg/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink sm:px-2">
                        <span className="sm:hidden">{bucket.groups.length}s·{bucket.gameCount}g</span>
                        <span className="hidden sm:inline">{t("{0} ซีรีส์ · {1} เกม", bucket.groups.length, bucket.gameCount)}</span>
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      {bucket.tournament && !restrictedTeamTournaments.has(bucket.tournament.id) && (
                        <RenameHistoryButton target="tournament" disabled={teamBusy}
                          onClick={() => {
                            const tournament = bucket.tournament;
                            if (!tournament) return;
                            const firstGame = bucket.groups[0]?.items[0];
                            if (!firstGame) return;
                            setNameEdit({
                              target: "tournament",
                              currentName: tournament.name,
                              onSave: (name) => saveTeamNames(() => renameTeamHistoryTournament(firstGame.id, name)),
                            });
                          }} />
                      )}
                    </div>
                  </div>
                  {tExpanded && (
                    <div className="space-y-2.5 p-2.5 sm:p-3">
                      {bucket.groups.map((group) => (
                        <section key={group.key} className="space-y-2 border border-line bg-panel/70 p-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0 break-words">
                              <h4 className="font-display text-sm font-bold text-ink">{group.name}</h4>
                            </div>
                            {editableTeamSeriesKeys.has(group.key) && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <RenameHistoryButton target="series" disabled={teamBusy}
                                  onClick={() => {
                                    const anchor = group.items[0];
                                    openSeriesEditor(group.name, group.commonGameName, anchor.game, (edit) =>
                                      saveTeamNames(() => editTeamHistorySeries(anchor.id, edit)));
                                  }} />
                                <AssignTournamentButton
                                  inTournament={group.tournament !== null}
                                  disabled={teamBusy}
                                  onClick={() => setTournamentAssignment({ scope: "team", gameId: group.items[0].id, name: group.name, tournament: group.tournament })}
                                />
                              </div>
                            )}
                          </div>
                          <ul className="space-y-2">
                            {group.visibleItems.map(({ id, game, author }) => (
                              <li key={id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border border-line bg-panel p-2.5 text-sm">
                                <div className="flex min-w-0 flex-1 basis-40 items-center gap-2.5 break-words">
                                  <span className="shrink-0 border border-blue/30 bg-blue/10 px-2 py-1 font-mono text-xs font-bold text-blue">G{game.gameNumber}</span>
                                  <div className="min-w-0">
                                    {game.gameName && <p className="font-semibold break-words text-ink">{game.gameName}</p>}
                                    <p className="text-xs text-muted">{game.blueTeamName} vs {game.redTeamName} · {author ? `@${author}` : t("ไม่ทราบผู้บันทึก")}</p>
                                  </div>
                                </div>
                                <div className="ml-auto flex shrink-0 gap-1.5">
                                  <button type="button" className="inline-flex min-h-8 items-center gap-1.5 border border-gold/50 bg-gold/10 px-2 font-display text-xs font-bold text-gold hover:bg-gold/20 focus-visible:outline-2 focus-visible:outline-gold" onClick={() => {
                                    onLoadGame(game, "team");
                                    requestClose();
                                  }}>
                                    <FolderOpen className="size-3.5" aria-hidden="true" />
                                    <StableButtonLabel message="เปิดเกม" />
                                  </button>
                                  {(team?.is_owner || author === teamHistoryUsername) && (
                                    <button type="button" disabled={teamBusy} className="inline-flex min-h-8 items-center gap-1.5 border border-line px-2 font-display text-xs text-muted enabled:hover:border-red/40 enabled:hover:text-red focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-50" onClick={() => setConfirmState({
                                      title: t("ลบเกมนี้"),
                                      message: t("ลบเกมออกจากประวัติทีมใช่ไหม"),
                                      confirmLabel: "ลบเกมนี้",
                                      onConfirm: () => {
                                        setConfirmState(null);
                                        void updateTeamHistory(() => deleteJson<void>(`${teamPath}/history/${id}`));
                                      },
                                    })}>
                                      <Trash2 className="size-3.5" aria-hidden="true" />
                                      <StableButtonLabel message="ลบเกมนี้" />
                                    </button>
                                  )}
                                </div>
                                <div className="min-w-0 basis-full">
                                  <DraftHeroPreview game={game} heroMap={heroMap} />
                                  <TeamGlobalBanPreview game={game} heroMap={heroMap} />
                                </div>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <>
      {/* Series Filter & Search Bar */}
      {groups.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel-2/60 px-3 py-1.5 sm:px-4 sm:py-2">
          <div className="relative min-w-[160px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-dim" aria-hidden="true" />
            <input
              type="text"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder={t("ค้นหาแมตช์ / ทีม / ฮีโร่…")}
              aria-label={t("ค้นหาแมตช์ / ทีม / ฮีโร่…")}
              className="h-8 w-full border border-line-strong bg-bg pr-7 pl-8 text-xs text-ink placeholder:text-dim focus:border-gold focus:outline-none"
            />
            {historySearch && (
              <button
                type="button"
                onClick={() => setHistorySearch("")}
                aria-label={t("ปิด")}
                className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-dim hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <label className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
            <Layers className="size-3.5 shrink-0 text-gold" aria-hidden="true" />
            <select
              value={activeGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              aria-label={t("GROUP / แมตช์:")}
              className="h-8 max-w-[210px] border border-line-strong bg-bg px-2 font-display text-xs font-semibold text-ink focus:border-gold focus:outline-none sm:max-w-[260px]"
            >
              <option value="ALL">{t("ทั้งหมด ({0} เกม · {1} ซีรีส์)", totalPersonalGamesCount, groups.length)}</option>
              {groups.map((grp) => (
                <option key={grp.key} value={grp.key}>
                  {grp.name} ({grp.count})
                </option>
              ))}
            </select>
          </label>

          {activeGroup === "ALL" && historySearch.trim() === "" && displayedGroups.length > 1 && (
            <button
              type="button"
              onClick={() => {
                setExpandedGroups({});
                setExpandAllOverride(hasAnyCollapsedPersonalGroup);
              }}
              className="h-8 shrink-0 border border-line-strong bg-panel px-2.5 font-display text-[11px] font-semibold text-muted transition-colors hover:border-gold/60 hover:text-gold"
            >
              <StableButtonLabel
                message={hasAnyCollapsedPersonalGroup ? "ขยายทั้งหมด" : "ยุบทั้งหมด"}
                alternatives={["ขยายทั้งหมด", "ยุบทั้งหมด"]}
              />
            </button>
          )}
        </div>
      )}

      {/* Saved Games List Grouped by Tournament -> Series */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5 sm:p-4">
        {games.length === 0 ? (
          <div className="flex h-52 flex-col items-center justify-center gap-2 border border-dashed border-line bg-bg/40 p-6 text-center text-dim">
            <History className="h-7 w-7 text-muted/60 lg:h-8 lg:w-8" />
            <p className="font-display text-sm font-semibold text-muted lg:text-base">{t("ยังไม่มีประวัติเกมที่บันทึกไว้ในระบบ")}</p>
            <p className="max-w-md text-xs text-dim lg:max-w-lg lg:text-sm">
              {t("เมื่อกดปุ่ม “จบเกมนี้ → บันทึก Global Ban” หรือกด “บันทึกกระดานปัจจุบัน” รายละเอียดการแบนและเลือกฮีโร่จะถูกจัดกลุ่มตามคู่แข่งขัน (เช่น BRU vs FS) และเก็บรักษาไว้อย่างถาวร")}
            </p>
          </div>
        ) : displayedGroups.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 border border-dashed border-line bg-bg/40 p-6 text-center text-muted">
            <Search className="size-6 text-dim" />
            <p className="text-xs sm:text-sm">{t("ไม่พบแมตช์หรือฮีโร่ที่ตรงกับคำค้นหา")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            {personalTournamentBuckets.map((bucket) => {
                const tKey = `personal:${bucket.id || "__none"}`;
                const tExpanded = isTournamentExpanded(tKey, personalTournamentBuckets.length);
                const isNamed = bucket.tournament !== null;
                return (
                  <section
                    key={tKey}
                    className={isNamed
                      ? "border border-gold/35 border-l-2 border-l-gold bg-panel/40"
                      : "border border-line bg-panel/25"}
                  >
                    <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${isNamed ? "border-b border-gold/25 bg-gradient-to-r from-gold/12 via-gold/5 to-transparent" : "border-b border-line bg-panel-2/40"}`}>
                      <button
                        type="button"
                        aria-expanded={tExpanded}
                        onClick={() => setCollapsedTournaments((prev) => ({ ...prev, [tKey]: tExpanded }))}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <ChevronDown
                          className={`size-4 shrink-0 transition-transform ${isNamed ? "text-gold" : "text-muted"} ${tExpanded ? "rotate-0" : "-rotate-90"}`}
                          aria-hidden="true"
                        />
                        {isNamed
                          ? <Trophy className="size-4 shrink-0 text-gold" aria-hidden="true" />
                          : <Layers className="size-3.5 shrink-0 text-muted" aria-hidden="true" />}
                        <h3 className={`min-w-0 truncate font-display text-xs font-extrabold tracking-wide sm:text-sm ${isNamed ? "text-gold" : "text-muted"}`}>
                          {bucket.tournament?.name ?? t("ไม่สังกัดทัวร์นาเมนต์")}
                        </h3>
                        <span className="shrink-0 border border-line bg-bg/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink sm:px-2">
                          <span className="sm:hidden">{bucket.groups.length}s·{bucket.gameCount}g</span>
                          <span className="hidden sm:inline">{t("{0} ซีรีส์ · {1} เกม", bucket.groups.length, bucket.gameCount)}</span>
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        {onRenameTournament && bucket.tournament && (
                          <RenameHistoryButton target="tournament"
                            onClick={() => {
                              const tournament = bucket.tournament;
                              if (!tournament) return;
                              setNameEdit({
                                target: "tournament",
                                currentName: tournament.name,
                                onSave: (name) => onRenameTournament(tournament.id, name),
                              });
                            }} />
                        )}
                        {onOpenNewSeries && bucket.tournament && (
                          <button
                            type="button"
                            onClick={() => requestClose(() => onOpenNewSeries(bucket.tournament, tournaments))}
                            title={t("เริ่มแมตช์ใหม่ในทัวร์นาเมนต์นี้")}
                            aria-label={t("เริ่มแมตช์ใหม่ในทัวร์นาเมนต์นี้")}
                            className="inline-flex h-8 items-center gap-1 border border-gold/50 bg-gold/10 px-2 font-display text-[11px] font-bold text-gold hover:bg-gold hover:text-bg"
                          >
                            <PlusCircle className="size-3.5" aria-hidden="true" />
                            <span className="hidden sm:inline">{t("+ แมตช์ใหม่")}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {tExpanded && (
                      <div className="flex flex-col gap-2.5 p-2.5 sm:p-3">
                        {bucket.groups.map((grp) => {
                          const expanded = isGroupExpanded(grp.key);
                          const { aWins, bWins } = grp;
                          return (
                            <div key={grp.key} className="flex flex-col gap-2.5 border border-line bg-panel/75 p-2.5 sm:p-3">
                              {/* Group Section Header */}
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <button
                                  type="button"
                                  aria-expanded={expanded}
                                  onClick={() =>
                                    setExpandedGroups((prev) => ({
                                      ...prev,
                                      [grp.key]: !expanded,
                                    }))
                                  }
                                  className="flex min-w-0 flex-1 basis-40 items-center gap-2 text-left"
                                >
                                  <ChevronDown
                                    className={`size-4 shrink-0 text-gold transition-transform ${expanded ? "rotate-0" : "-rotate-90"}`}
                                    aria-hidden="true"
                                  />
                                  <span className="truncate border border-gold/60 bg-gold/15 px-2 py-0.5 font-display text-xs font-bold text-gold lg:text-sm">
                                    {grp.name}
                                  </span>
                                  <span className="shrink-0 font-mono text-xs text-muted">
                                    ({grp.count})
                                  </span>
                                  {aWins + bWins > 0 && (
                                    <span className="shrink-0 border border-line bg-bg px-1.5 py-0.5 font-mono text-[11px] font-bold text-ink">
                                      {aWins}-{bWins}
                                    </span>
                                  )}
                                  {grp.latestTimestamp && (
                                    <span className="hidden shrink-0 items-center gap-1 whitespace-nowrap font-mono text-[11px] text-dim md:flex">
                                      <Clock className="h-3 w-3" />
                                      {grp.latestTimestamp}
                                    </span>
                                  )}
                                </button>

                                <div className="flex flex-wrap items-center gap-1">
                                  {onEditSeries && (
                                    <RenameHistoryButton target="series"
                                      onClick={() => openSeriesEditor(grp.name, grp.commonGameName, grp.items[0], (edit) => onEditSeries(grp.key, edit))} />
                                  )}
                                  {onAssignTournament && (
                                    <AssignTournamentButton
                                      inTournament={grp.tournament !== null}
                                      onClick={() => setTournamentAssignment({ scope: "personal", key: grp.key, name: grp.name, tournament: grp.tournament })}
                                    />
                                  )}
                                  {team && (
                                    <button
                                      type="button"
                                      disabled={teamBusy}
                                      onClick={() => {
                                        const orderedGames = [...grp.items].sort((a, b) => a.gameNumber - b.gameNumber);
                                        void updateTeamHistory(
                                          () => shareTeamSeriesInChunks(team, orderedGames),
                                          ({ copied, skipped }) =>
                                            copied === 0
                                              ? t("ซีรีส์นี้ถูกคัดลอกเข้าประวัติทีมครบแล้ว")
                                              : skipped > 0
                                                ? t("คัดลอกเข้าประวัติทีมแล้ว {0} เกม (มีอยู่แล้ว {1} เกม)", copied, skipped)
                                                : t("คัดลอกซีรีส์เข้าประวัติทีมแล้ว ({0} เกม)", copied),
                                        );
                                      }}
                                      title={t("คัดลอกซีรีส์ \"{0}\" ({1} เกม) เข้าประวัติทีม", grp.name, grp.count)}
                                      aria-label={t("คัดลอกซีรีส์ \"{0}\" ({1} เกม) เข้าประวัติทีม", grp.name, grp.count)}
                                      className="inline-flex h-8 w-8 items-center justify-center gap-1 border border-line bg-bg font-display text-xs font-semibold text-muted transition-colors enabled:hover:border-gold/50 enabled:hover:text-gold focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-50 lg:w-auto lg:px-2"
                                    >
                                      <Copy className="size-3.5 shrink-0" aria-hidden="true" />
                                      <span className="hidden lg:inline"><StableButtonLabel message="คัดลอกเข้าทีม" /></span>
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setConfirmState({
                                        title: t("ลบประวัติกลุ่ม \"{0}\"?", grp.name),
                                        message: t("ต้องการลบประวัติทั้งหมดของกลุ่ม \"{0}\" ({1} เกม) ออกจากระบบหรือไม่?", grp.name, grp.count),
                                        confirmLabel: "ลบกลุ่มนี้",
                                        onConfirm: () => {
                                          setConfirmState(null);
                                          onDeleteGroup(grp.key);
                                        },
                                      })
                                    }
                                    title={t("ลบประวัติเฉพาะกลุ่ม {0}", grp.name)}
                                    aria-label={t("ลบประวัติเฉพาะกลุ่ม {0}", grp.name)}
                                    className="inline-flex h-8 w-8 items-center justify-center gap-1 border border-red/40 bg-bg font-display text-xs font-semibold text-red transition-colors hover:bg-red hover:text-ink xl:w-auto xl:px-2"
                                  >
                                    <Trash2 className="size-3.5 shrink-0" aria-hidden="true" />
                                    <span className="hidden xl:inline"><StableButtonLabel message="ลบเฉพาะกลุ่มนี้" /></span>
                                  </button>
                                </div>
                              </div>

                              {/* Games in this Group */}
                              {expanded && <div className="flex flex-col gap-2.5 border-t border-line pt-2.5">
                                {grp.items.map((g) => {
                                  const blueTeamId: TeamId = g.blueSideTeam;
                                  const redTeamId: TeamId = g.blueSideTeam === "A" ? "B" : "A";
                                  return (
                                    <div
                                      key={g.id}
                                      className="flex flex-col gap-2.5 border border-line bg-panel-2/60 p-3 transition-colors hover:border-line-strong"
                                    >
                                      {/* Top Bar: Game Number, Teams, Winner, Actions */}
                                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="border border-gold/60 bg-gold/15 px-2 py-0.5 font-mono text-xs font-bold text-gold lg:text-sm">
                                            GAME {g.gameNumber}
                                          </span>
                                          {g.gameName && <span className="min-w-0 font-display text-xs font-bold break-words text-ink lg:text-sm">{g.gameName}</span>}
                                          <span className="font-display text-xs font-bold text-blue lg:text-sm">{g.blueTeamName} (BLUE)</span>
                                          <span className="font-mono text-[11px] text-dim lg:text-xs">vs</span>
                                          <span className="font-display text-xs font-bold text-red lg:text-sm">{g.redTeamName} (RED)</span>
                                          <span className="flex items-center gap-1 font-mono text-[11px] text-dim lg:text-xs">
                                            <Clock className="h-3 w-3 lg:h-3.5 lg:w-3.5" />
                                            {g.timestamp}
                                          </span>
                                          {onSetGameWinner && (
                                            <div title="WINNER" className="inline-flex items-center gap-1 border border-line bg-bg px-1.5 py-0.5 lg:px-2">
                                              <Trophy className="h-3 w-3 text-gold lg:h-3.5 lg:w-3.5" aria-hidden="true" />
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  onSetGameWinner(g.id, g.winner === blueTeamId ? undefined : blueTeamId)
                                                }
                                                className={`inline-flex min-h-6 min-w-7 items-center justify-center px-1.5 py-0.5 font-display text-[10px] font-bold transition-colors lg:px-2 lg:text-xs ${
                                                  g.winner === blueTeamId
                                                    ? "bg-blue text-bg"
                                                    : "text-blue hover:bg-blue/15"
                                                }`}
                                              >
                                                {g.blueTeamName}
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  onSetGameWinner(g.id, g.winner === redTeamId ? undefined : redTeamId)
                                                }
                                                className={`inline-flex min-h-6 min-w-7 items-center justify-center px-1.5 py-0.5 font-display text-[10px] font-bold transition-colors lg:px-2 lg:text-xs ${
                                                  g.winner === redTeamId
                                                    ? "bg-red text-bg"
                                                    : "text-red hover:bg-red/15"
                                                }`}
                                              >
                                                {g.redTeamName}
                                              </button>
                                            </div>
                                          )}
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              onLoadGame(g, "personal");
                                              requestClose();
                                            }}
                                            className="flex h-7 items-center gap-1 border border-gold/60 bg-gold/15 px-2.5 font-display text-[11px] font-bold text-gold transition-colors hover:bg-gold hover:text-bg lg:h-8 lg:px-3 lg:text-xs"
                                          >
                                            <Download className="h-3 w-3 lg:h-3.5 lg:w-3.5" aria-hidden="true" />
                                            <span><StableButtonLabel message="โหลดขึ้นกระดาน" /></span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setConfirmState({
                                                title: t("ลบเกมที่ {0}?", g.gameNumber),
                                                message: t(
                                                  'ต้องการลบ GAME {0} ({1} vs {2}) ออกจากกลุ่ม "{3}" หรือไม่?',
                                                  g.gameNumber,
                                                  g.blueTeamName,
                                                  g.redTeamName,
                                                  grp.name,
                                                ),
                                                confirmLabel: "ลบเกมนี้",
                                                onConfirm: () => {
                                                  setConfirmState(null);
                                                  onDeleteGame(g.id);
                                                },
                                              })
                                            }
                                            title={t("ลบเกมนี้")}
                                            aria-label={t("ลบเกมที่ {0}", g.gameNumber)}
                                            className="flex h-7 w-7 items-center justify-center border border-line bg-bg text-dim transition-colors hover:border-red/50 hover:text-red lg:h-8 lg:w-8"
                                          >
                                            <Trash2 className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
                                          </button>
                                        </div>
                                      </div>

                                      <DraftHeroPreview game={g} heroMap={heroMap} />
                                    </div>
                                  );
                                })}
                              </div>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
          </div>
        )}
      </div>
        </>
      )}

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line bg-bg px-3 py-2 sm:px-4 sm:py-2.5">
        <span className="min-w-0 truncate font-mono text-[11px] text-muted sm:text-xs">
          {showTeamHistory ? (
            <>
              {t("ประวัติทีม")} · <strong className="text-ink">{teamGames?.length ?? 0}/500</strong>
            </>
          ) : personalHistoryLimit !== undefined ? (
            `${games.length}/${historyLimit}`
          ) : (
            <>
              <span className="sm:hidden">{t("บันทึกอัตโนมัติ ·")} </span>
              <span className="hidden sm:inline">{t("บันทึกอัตโนมัติ (สูงสุด")} {MAX_SERIES_GAMES} {t("เกมล่าสุด · ปัจจุบัน")} </span>
              <strong className={games.length >= MAX_SERIES_GAMES - 10 ? "text-gold" : "text-ink"}>
                {games.length}/{MAX_SERIES_GAMES}
              </strong>
              <span className="hidden sm:inline">
                {games.length >= MAX_SERIES_GAMES ? t(" — ครบโควตาแล้ว เกมใหม่จะทับรายการเก่าสุด") : ""})
              </span>
            </>
          )}
        </span>
        <button
          type="button"
          onClick={() => requestClose()}
          className={`ml-auto shrink-0 border px-3 py-1.5 font-display text-xs font-bold tracking-wider whitespace-nowrap transition-colors sm:px-4 lg:text-sm ${team
            ? "border-line-strong text-muted hover:bg-panel-2 hover:text-ink"
            : "border-gold bg-gold text-bg hover:bg-gold/90"}`}
        >
          <StableButtonLabel message="ปิดหน้าต่าง" />
        </button>
      </div>

      {confirmState && (
        <ConfirmDialog
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          cancelLabel="ยกเลิก"
          tone="danger"
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
      {tournamentAssignment && createPortal(
        <AssignTournamentDialog
          seriesName={tournamentAssignment.name}
          tournament={tournamentAssignment.tournament}
          options={tournaments}
          onSave={(tournament) => {
            if (tournamentAssignment.scope === "personal") onAssignTournament?.(new Set([tournamentAssignment.key]), tournament);
            else void updateTeamHistory(() => assignTeamSeriesTournament(tournamentAssignment.gameId, tournament), t("บันทึกทัวร์นาเมนต์แล้ว"));
          }}
          onClose={() => setTournamentAssignment(null)}
        />,
        document.body,
      )}
      {createTournamentOpen && createPortal(
        <CreateTournamentDialog series={tournamentChoices} onCreate={createTournament} onClose={() => setCreateTournamentOpen(false)} />,
        document.body,
      )}
      {nameEdit && createPortal(
        <RenameHistoryItemDialog {...nameEdit} onClose={() => setNameEdit(null)} />,
        document.body,
      )}
      {exportPickerOpen &&
        createPortal(
          <Modal
            labelledBy={exportTitleId}
            className="max-w-md overflow-hidden"
            onClose={() => setExportPickerOpen(false)}
          >
            {(closePicker) => {
              const allVisibleSelected =
                filteredExportGroups.length > 0 &&
                filteredExportGroups.every((grp) => selectedExportGroups.has(grp.key));
              return (
                <>
                  <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Upload className="size-4 text-gold" aria-hidden="true" />
                      <h3 id={exportTitleId} className="font-display text-sm font-bold text-ink">
                        {t("เลือกซีรีส์ที่ต้องการส่งออก")}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => closePicker()}
                      aria-label={t("ปิด")}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-dim hover:bg-panel-2 hover:text-ink"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-panel-2/60 px-4 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedExportGroups((prev) => {
                          const next = new Set(prev);
                          if (allVisibleSelected) {
                            for (const grp of filteredExportGroups) next.delete(grp.key);
                          } else {
                            for (const grp of filteredExportGroups) next.add(grp.key);
                          }
                          return next;
                        });
                      }}
                      className="min-h-8 border border-gold/60 bg-gold/10 px-2.5 font-display text-xs font-bold text-gold transition-colors hover:bg-gold hover:text-bg"
                    >
                      <StableButtonLabel
                        message={allVisibleSelected ? "ล้างการเลือก" : "เลือกทั้งหมด"}
                        alternatives={["ล้างการเลือก", "เลือกทั้งหมด"]}
                      />
                    </button>
                    <span className="font-mono text-xs text-muted">
                      {t(
                        "เลือกแล้ว {0} ซีรีส์ ({1} เกม)",
                        selectedExportGroupList.length,
                        selectedExportGames.length,
                      )}
                    </span>
                  </div>

                  {exportGroups.length > 6 && (
                    <div className="border-b border-line px-4 py-2">
                      <div className="relative">
                        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-dim" />
                        <input
                          type="text"
                          value={exportSearch}
                          onChange={(e) => setExportSearch(e.target.value)}
                          placeholder={t("ค้นหาแมตช์ / ทีม / ฮีโร่…")}
                          className="h-8 w-full border border-line-strong bg-bg pr-3 pl-8 text-xs text-ink focus:border-gold focus:outline-none"
                        />
                      </div>
                    </div>
                  )}

                  <div className="max-h-[48vh] min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
                    {filteredExportGroups.length === 0 ? (
                      <p className="py-6 text-center text-xs text-muted">
                        {t("ไม่พบแมตช์หรือฮีโร่ที่ตรงกับคำค้นหา")}
                      </p>
                    ) : (
                      filteredExportGroups.map((grp) => {
                        const checked = selectedExportGroups.has(grp.key);
                        return (
                          <label
                            key={grp.key}
                            className={`flex min-h-10 cursor-pointer items-center justify-between gap-2 border px-3 py-2 text-xs transition-colors ${
                              checked
                                ? "border-gold bg-gold/10 text-ink"
                                : "border-line bg-bg/60 text-muted hover:border-line-strong hover:text-ink"
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-2.5">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleExportGroup(grp.key)}
                                className="size-4 accent-gold"
                              />
                              <span className="truncate font-display font-bold text-ink">
                                {grp.name}
                                {grp.tournament && <span className="ml-1.5 font-normal text-muted">· {grp.tournament.name}</span>}
                              </span>
                            </span>
                            <span className="shrink-0 font-mono text-[11px] text-dim">
                              {t("{0} เกม", grp.count)}
                              {grp.latestTimestamp ? ` · ${grp.latestTimestamp}` : ""}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>

                  <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-bg px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => closePicker()}
                      className="min-h-8 border border-line-strong bg-panel px-3 font-display text-xs font-semibold text-muted hover:text-ink"
                    >
                      <StableButtonLabel message="ยกเลิก" />
                    </button>
                    <button
                      type="button"
                      disabled={selectedExportGames.length === 0}
                      onClick={handleConfirmExport}
                      className="inline-flex min-h-8 items-center gap-1.5 border border-gold bg-gold px-3.5 font-display text-xs font-bold text-bg hover:bg-gold/90 disabled:opacity-40"
                    >
                      <Upload className="size-3.5" aria-hidden="true" />
                      <span>
                        {t("ส่งออก JSON")} ({selectedExportGames.length})
                      </span>
                    </button>
                  </div>
                </>
              );
            }}
          </Modal>,
          document.body,
        )}
      {toast &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            className="fixed right-4 bottom-4 left-4 z-[60] flex items-start gap-3 border border-good/60 bg-panel px-4 py-3 shadow-2xl sm:left-auto sm:w-96"
          >
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-good" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-xs font-bold text-good sm:text-sm">{toast.title}</p>
              <p className="mt-0.5 break-words text-xs text-ink">{toast.detail}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (toastTimerRef.current !== null) {
                  window.clearTimeout(toastTimerRef.current);
                  toastTimerRef.current = null;
                }
                setToast(null);
              }}
              aria-label={t("ปิด")}
              className="inline-flex min-h-7 min-w-7 shrink-0 items-center justify-center rounded text-dim hover:bg-panel-2 hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </div>,
          document.body,
        )}
        </>
      )}
    </Modal>
  );
}

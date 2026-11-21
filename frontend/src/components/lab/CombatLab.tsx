import { StableButtonLabel } from "../StableButtonLabel";
import { translateMessage, useLanguage } from "../../i18n/language";
import { useCombatLab } from "../../hooks/useCombatLab";
import { Alert } from "../Alert";
import type { Side } from "../../types/combat";
import type { Hero } from "../../types/draft";
import { displayName } from "../../utils/heroNames";
import { BuildPanel } from "./BuildPanel";
import { DuelSummary } from "./DuelSummary";
import { LevelSweep } from "./LevelSweep";
import { SkillDamageTable } from "./SkillDamageTable";
import { StatSheet } from "./StatSheet";

export function CombatLab({
  heroMap,
  storageKey,
  persistRemote = false,
}: {
  heroMap: Map<string, Hero>;
  storageKey?: string;
  persistRemote?: boolean;
}) {
  const { t } = useLanguage();
  const {
    catalog,
    builds,
    result,
    error,
    isLoading,
    updateBuild,
    swap,
    mirror,
    enableKiting,
    setEnableKiting,
    enableActives,
    setEnableActives,
    retryCatalog,
    resetBuilds,
  } = useCombatLab({ storageKey, persistRemote });

  if (!catalog) {
    return (
      <div className="flex flex-wrap items-center gap-3 p-6 text-sm text-muted">
        <span>{error ? translateMessage(t, error) : t("กำลังโหลดข้อมูลฮีโร่ ไอเทม รูน และพลังแฝง…")}</span>
        {error && (
          <button
            type="button"
            onClick={retryCatalog}
            className="border border-gold bg-gold/10 px-2.5 py-1 text-xs font-bold text-gold hover:bg-gold hover:text-bg"
          >
            <StableButtonLabel message="โหลดใหม่" />
          </button>
        )}
      </div>
    );
  }

  const column = (side: Side) => {
    const other: Side = side === "a" ? "b" : "a";
    const data = result?.[side];
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <BuildPanel
          side={side}
          build={builds[side]}
          catalog={catalog}
          heroMap={heroMap}
          buildStats={data?.build}
          skillRows={data?.skills}
          enemyName={displayName(builds[other].hero)}
          onChange={(p) => updateBuild(side, p)}
        />
        {data && (
          <>
            <StatSheet
              stats={data.build}
              effectiveHp={{
                physical: data.effective_hp_physical,
                magic: data.effective_hp_magic,
              }}
            />
            <SkillDamageTable
              side={data}
              build={builds[side]}
              enemyName={displayName(builds[other].hero)}
              onChange={(p) => updateBuild(side, p)}
            />
            <LevelSweep
              sweep={data.level_sweep}
              currentLevel={builds[side].level}
              color={side === "a" ? "bg-blue" : "bg-red"}
            />
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{translateMessage(t, error)}</span>
            <button
              type="button"
              onClick={resetBuilds}
              className="border border-line-strong bg-panel px-2 py-0.5 text-xs font-semibold text-ink hover:border-gold hover:text-gold"
            >
              <StableButtonLabel message="รีเซ็ตบิลด์" />
            </button>
          </div>
        </Alert>
      )}
      {result && (
        <DuelSummary
          result={result}
          heroA={builds.a.hero}
          heroB={builds.b.hero}
          isLoading={isLoading}
          onSwap={swap}
          onMirror={mirror}
          enableKiting={enableKiting}
          onToggleKiting={() => setEnableKiting((v) => !v)}
          enableActives={enableActives}
          onToggleActives={() => setEnableActives((v) => !v)}
          onReset={resetBuilds}
        />
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {column("a")}
        {column("b")}
      </div>
    </div>
  );
}

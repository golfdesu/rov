import { useCombatLab } from "../../hooks/useCombatLab";
import type { Side } from "../../types/combat";
import type { Hero } from "../../types/draft";
import { displayName } from "../../utils/heroNames";
import { BuildPanel } from "./BuildPanel";
import { DuelSummary } from "./DuelSummary";
import { LevelSweep } from "./LevelSweep";
import { SkillDamageTable } from "./SkillDamageTable";
import { StatSheet } from "./StatSheet";

export function CombatLab({ heroMap }: { heroMap: Map<string, Hero> }) {
  const { catalog, builds, result, error, isLoading, updateBuild, swap, mirror } = useCombatLab();

  if (!catalog) {
    return <div className="p-6 text-sm text-muted">{error ?? "กำลังโหลดข้อมูลฮีโร่ ไอเทม รูน และพลังแฝง…"}</div>;
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
        <div role="alert" className="border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
          {error}
        </div>
      )}
      {result && (
        <DuelSummary
          result={result}
          heroA={builds.a.hero}
          heroB={builds.b.hero}
          isLoading={isLoading}
          onSwap={swap}
          onMirror={mirror}
        />
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {column("a")}
        {column("b")}
      </div>
    </div>
  );
}

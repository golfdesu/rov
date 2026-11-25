# Meta Tier List, MetaLab & Combat Lab Backup

Archived on **2026-11-25** to keep the active frontend focused on Draft Board, Draft vs AI, Scrim Analytics, Teams/Hero Pools, Plans, and Admin while deferring the Meta Tier List, MetaLab, and Combat Lab UI tabs for future development.

Shared `frontend/src/components/lab/HeroPickerModal.tsx` (used by `DraftBoardView.tsx` on mobile) and backend `src/combat_calculator.py` / `/combat/*` remain active in place.

## Archived Files

- **[meta_and_combat_labs.patch](file:///C:/Users/chaya/Documents/Program/Project/ROV/docs/archive/meta_and_combat_labs/meta_and_combat_labs.patch)** — Clean unified diff restoring `App.tsx` tabs/routes and all `17` component/hook/type/util files.

## What Was Archived

1. **App Router & Tabs (`frontend/src/App.tsx`):**
   - Lazy imports for `TierListView`, `MetaLab`, and `CombatLab`
   - `TABS`, `initialTab()` hashes (`#tierlist`, `#metalab`, `#lab`), render branches, `DRAFT_ONLY` gate, and `COMBAT_STORAGE_PREFIX`
2. **Views & Components (`frontend/src/components/`):**
   - `tierlist/TierListView.tsx`
   - `meta_lab/MetaLab.tsx`
   - `lab/`: `CombatLab.tsx`, `ArcanaBoard.tsx`, `BuildPanel.tsx`, `DuelSummary.tsx`, `EnchantmentBoard.tsx`, `EnchantmentSocket.tsx`, `HeroSkillsModal.tsx`, `ItemCardModal.tsx`, `LevelSweep.tsx`, `SkillDamageTable.tsx`, `StatSheet.tsx`, `enchantmentFactions.ts`
3. **Hooks, Types & Utilities (`frontend/src/`):**
   - `hooks/useCombatLab.ts`, `types/combat.ts`, `utils/skillEffects.ts`

## How to Restore

```bash
git apply --ignore-whitespace --check docs/archive/meta_and_combat_labs/meta_and_combat_labs.patch
git apply --ignore-whitespace docs/archive/meta_and_combat_labs/meta_and_combat_labs.patch
```

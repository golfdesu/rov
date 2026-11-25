# Screenshot Draft Import Backup (`ScreenshotImportModal`)

Archived on **2026-11-25** to remove the unfinished Screenshot Draft Import UI from active navigation and bundles until automated recognition is developed in a future release.

## Archived Files

- **[screenshot_draft_import.patch](file:///C:/Users/chaya/Documents/Program/Project/ROV/docs/archive/screenshot_draft_import/screenshot_draft_import.patch)** — Clean unified diff restoring the `ScreenshotImportModal` component and its navigation/DraftBoard wiring.

## What Was Archived

1. **Frontend (`frontend/src/`):**
   - `components/ScreenshotImportModal.tsx` (image preview upload, 18-slot manual/assisted draft assignment, prefix gap validation, and `onLoadImportedDraft` callback)
   - `components/MobileNavDrawer.tsx` (`Camera` icon, `onOpenScreenshotImport` prop, and drawer button)
   - `components/DraftBoardView.tsx` (lazy `ScreenshotImportModal` import, `activeDraftTool: "pools" | "import" | null`, `isImportModalOpen`, and modal render)
   - `App.tsx` (`DraftToolModal = "pools" | "import"` and `onOpenScreenshotImport={() => openDraftTool("import")}`)

## How to Restore

```bash
git apply --ignore-whitespace --check docs/archive/screenshot_draft_import/screenshot_draft_import.patch
git apply --ignore-whitespace docs/archive/screenshot_draft_import/screenshot_draft_import.patch
```

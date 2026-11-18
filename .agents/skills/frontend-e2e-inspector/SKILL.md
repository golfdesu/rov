---
name: frontend-e2e-inspector
description: >-
  Automated browser-based E2E inspection, UX/UI accessibility audit, and visual verification for the
  RoV React draft board and Combat Lab UI. Verifies hero portraits, skills/status modals, item card
  page pagination, WCAG 2.2 AA touch targets (>= 24px), mobile ergonomics, portal confirm dialogs,
  explicit side-control invariants, and zero console/render errors across mobile and desktop breakpoints.
---

# RoV Frontend E2E, UX/UI & Visual Inspector Skill

Use this skill to autonomously test, verify, and audit the React 19 + Tailwind CSS 4 web interface served by FastAPI from `frontend/dist/` (or `frontend/dist-prod/` when `ROV_ENV=production`), enforcing all rules in [`DESIGN.md`](file:///C:/Users/chaya/Documents/Program/Project/ROV/DESIGN.md).

---

## 1. Quick Programmatic Verification

```bash
# 1. Lint & build production bundle
cd frontend && npm run lint && npm run build && cd ..

# 2. Run fast E2E asset & static endpoint health audit
python .agents/skills/frontend-e2e-inspector/scripts/inspect_frontend_e2e.py

# 3. Run full Playwright UX/UI, mobile ergonomics & side-lock gate
python .agents/skills/frontend-e2e-inspector/scripts/audit_ux_ui.py
```

What each script verifies:
- `inspect_frontend_e2e.py`:
  - **Bundle Integrity**: Confirms `index.html` and compiled CSS/JS chunks exist and serve via FastAPI.
  - **Avatar Catalog**: Verifies all 130 hero square icons in `frontend/public/avatars/`.
  - **In-Game Media (dev mode)**: Validates hero skill/status and 114 item card screenshot endpoints.
- `audit_ux_ui.py`:
  - **Responsive Breakpoints & Overflow**: Zero horizontal scroll (`scrollWidth <= clientWidth`) across `375x667` (iPhone SE), `390x844` (iPhone), `768x1024` (iPad), and `1280x800` (Desktop).
  - **Touch Target Floor (WCAG 2.2 AA)**: Every visible button, link, and `<select>` maintains height/width `>= 24px`.
  - **Mobile Modal Ergonomics**: Opening `GlobalBanModal` on `375x667` never auto-focuses search inputs (`activeElement.tagName !== "INPUT"`) and keeps footer actions inside the viewport.
  - **Portal Confirmations**: Rejects native `window.confirm()`/`alert()` dialogs and confirms `ConfirmDialog` (`createPortal(..., document.body)`) is clickable above blurred headers and chamfered modals.
  - **Explicit Side Control**: Finishing a completed 10-pick game with a winner advances `gameNumber` without auto-swapping `blueSideTeam`.

---

## 2. Interactive Browser Testing Protocol (Playwright MCP)

When conducting live UI walkthroughs or checking layout regressions, use the **Playwright MCP tools**:

1. **Launch Server**:
   Ensure FastAPI is running on `http://127.0.0.1:8000`.
2. **Navigate & Snapshot**:
   Call `playwright_navigate("http://127.0.0.1:8000")`.
   Take a screenshot with `playwright_screenshot()`.
3. **Draft Board Verification**:
   - Verify Blue Side (left) and Red Side (right) team columns render with chamfered slots.
   - Verify hero search input filters the 130-hero grid responsively.
   - Click a hero card to lock a ban/pick and observe turn state progression.
4. **Combat Lab Modal Walkthrough**:
   - Navigate to the Combat Lab view.
   - Click "ดูสกิล" (HeroSkillsModal):
     - Click slot tabs (`สกิลติดตัว`, `สกิล 1`, `สกิล 2`, `อัลติเมท`).
     - Click status buttons (`สเตตัส Lv 1`, `สเตตัส Lv 15`).
     - For multi-form heroes (`Liliana`, `Yena`), verify stance tabs switch screenshots seamlessly.
   - Click "การ์ดไอเทม" (ItemCardModal):
     - Test single-card items (`Fenrir's Tooth`).
     - Test multi-card support/jungle items (`Aquaflame - Accelerate`) by clicking `หน้า 1`, `หน้า 2`, `หน้า 3`, `หน้า 4` or pressing arrow keys.
     - Click "ใส่ไอเทมนี้" (Equip Item) to verify state updates in the build panel.
5. **Console Log & Viewport Audit**:
   - Call `playwright_console_logs()` to verify 0 unhandled exceptions or React render warnings.
   - Call `playwright_resize(width=390, height=844)` to verify mobile layout responsiveness.

---

## 3. Critical UI & UX Invariants (NON-NEGOTIABLE)

1. **Deterministic Slot Identification**: Never rely on array index order when displaying hero skill screenshots. Canonical tokens (`passive`, `skill1`, `skill2`, `ultimate`) must bind directly to their matching slot.
2. **Item Card Page Ordering**: Multi-page items (Jungle/Support) must always start at Page 1 (`item_card_1.jpg`) as the top card view.
3. **Hero Name Localization**: Thai canonical server names (`Mortos`, `Celica`, `Riktor`) are the display default.
4. **WCAG 2.2 AA Contrast & Target Size**: Maintain `--color-dim: #7383a5` (`>= 4.5:1` on `panel-2`, `panel`, `bg`) and `--color-muted: #94a3c4`. Interactive buttons, links, and selects MUST be `>= 24x24px`.
5. **No Native Dialogs & Portal Layering**: Never call `window.confirm()`, `window.alert()`, or `window.prompt()`. Use [`ConfirmDialog`](file:///C:/Users/chaya/Documents/Program/Project/ROV/frontend/src/components/ConfirmDialog.tsx) via `createPortal(..., document.body)` so blurred headers or chamfered modals never trap pointer events.
6. **Mobile Modal & Compact Card Discipline**: Never auto-focus text inputs on touch open; use unified scroll bodies on `< sm` (`max-h-[92dvh]`) so footers stay on screen; keep `< sm` `variant="compact"` hero slots portrait-only (`hidden sm:block` on text/gradient overlays).
7. **Manual-Only Side Switching**: Never auto-swap `blueSideTeam` when recording winners, deleting games, switching series, or changing game numbers (`G1..G7`). Side swaps occur strictly via explicit user click on Swap Sides or when loading an existing historical game snapshot.

---

## 4. Related Skills

- [`rov-draft-serving`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/rov-draft-serving/SKILL.md): Serve FastAPI backend and web UI, execute builds, and run CLI scenarios.
- [`regression-guard`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/regression-guard/SKILL.md): Regression testing for 72 golden draft states and 3 combat duel simulations backing the UI.
- [`security-audit`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/security-audit/SKILL.md): Verifies static media containment, path traversal immunity, and input bounds.

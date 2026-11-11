---
name: frontend-e2e-inspector
description: >-
  Automated browser-based E2E inspection and visual verification for the RoV React draft board
  and Combat Lab UI. Verifies hero portraits, skills/status modals, item card page pagination,
  and zero console/render errors across desktop and mobile viewport breakpoints.
---

# RoV Frontend E2E & Visual Inspector Skill

Use this skill to autonomously test, verify, and audit the React 19 + Tailwind CSS 4 web interface served by FastAPI from `frontend/dist/`.

---

## 1. Quick Programmatic Verification

```bash
# 1. Build production bundle
cd frontend && npm run build && cd ..

# 2. Run automated E2E asset & bundle health audit
python .agents/skills/frontend-e2e-inspector/scripts/inspect_frontend_e2e.py
```

It audits:
- **Bundle Integrity**: Confirms `frontend/dist/index.html` and bundled CSS/JS chunks exist and load without missing asset hashes.
- **Avatar Catalog**: Verifies all 130 hero square icons in `frontend/public/avatars/` and `frontend/dist/avatars/`.
- **In-Game Item Media**: Validates all 159 item card screenshots across 114 item directories.
- **API Static Routing**: Verifies FastAPI serves frontend assets without route shadowing or broken media links.

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

## 3. Critical UI Invariants (NON-NEGOTIABLE)

1. **Deterministic Slot Identification**: Never rely on array index order when displaying hero skill screenshots. Canonical tokens (`passive`, `skill1`, `skill2`, `ultimate`) must bind directly to their matching slot.
2. **Item Card Page Ordering**: Multi-page items (Jungle/Support) must always start at Page 1 (`item_card_1.jpg`) as the top card view.
3. **Hero Name Localization**: Thai canonical server names (`Mortos`, `Celica`, `Riktor`) are the display default.

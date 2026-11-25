# Frontend UI Copy, i18n & Overflow Rules

1. **RoV Player & Coach Tone (No AI Slop)**:
   - Write concise Thai UI copy that real RoV players/coaches use. Avoid statistical jargon (`Wilson`, `Bayes`, `Bradley-Terry`, `Shannon Entropy`, `Linear Interpolation`) and hype filler (`ระดับโลก`, `วิเคราะห์เชิงลึก`, `100%`, `GOD TIER`) inside visible labels/subtitles.
   - Keep **1 language per UI label**: omit mixed `ไทย (English)` pairs (`พร้อมจ่าย (Willing)`, `สายหลัก (Primary)`). Keep only natural esports/RoV terms (`Global Ban`, `Hero Pool`, `Phase 1`, `Win Rate`, `Flex`, `Kiting`, `CDR`, `DPS`).
   - Never repeat the parent heading/button text as filler subtitles, and never expose internal paths (`heroes/.../skill/`, filenames) or dev TODOs.
2. **Complete i18n Synchronization**:
   - Every `t(...)`, `<StableButtonLabel message="..." />`, and localized dictionary entry must have a matching entry in `src/i18n/englishMessages.ts`.
   - Never split `<StableButtonLabel>` mid-sentence (e.g., `<StableButtonLabel message="รูปแคปจริง (" />{n})`) or wrap it inside a parent `truncate` container; use `{t("Label ({0})", count)}` or `{t("Label")} ({count})`.
3. **Zero Clipping & Overflow Invariants**:
   - Menus/dropdowns (`role="menu"`, `absolute ... top-full`) placed inside `whitespace-nowrap` toolbars MUST declare `whitespace-normal` and mobile-safe horizontal anchoring (`left-1/2 -translate-x-1/2 sm:left-auto sm:right-0 sm:translate-x-0`).
   - Grid items hosting horizontal strips/tables MUST include `min-w-0`. Never clamp multi-attribute cards with `line-clamp-1`.
4. **Verification Gate**: Before finishing frontend changes, run `npm --prefix frontend run lint && npm --prefix frontend run build`, `python .agents/skills/frontend-e2e-inspector/scripts/audit_copy_i18n.py`, `inspect_frontend_e2e.py`, and `audit_ux_ui.py`.

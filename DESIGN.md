# RoV Draft UI — Design System

Dark esports broadcast style for the draft board in `frontend/`. Tokens live in `frontend/src/index.css` (`@theme`), so every Tailwind class like `bg-panel` or `text-gold` resolves to them.

## Principles

- **Broadcast, not dashboard.** Near-black stage, team colors carry identity, and the on-the-clock slot is the only gold element on screen.
- **Blue left, red right.** Blue side content is left-aligned and red side is mirrored, like the in-game draft.
- **Numbers are mono.** Win rates, pick probabilities and edges use JetBrains Mono with tabular figures, so values don't jump as they update.
- **Square portraits.** Every hero image is a 1:1 icon (160x160 source), in the grid, team slots, timeline, bans and AI panel.

## Color tokens

| Token | Value | Use |
| :--- | :--- | :--- |
| `bg` | `#070b14` | Page background (with faint blue/red corner glows) |
| `panel` / `panel-2` | `#0c1322` / `#111a2e` | Cards, slots / bars, chips |
| `line` / `line-strong` | `#1c2740` / `#2a3858` | Borders, dividers |
| `ink` / `muted` / `dim` | `#e8edf7` / `#94a3c4` / `#7383a5` | Primary, secondary, tertiary text (WCAG AA `>= 4.5:1`) |
| `blue` / `blue-deep` | `#3b9eff` / `#0b3a73` | Blue side |
| `red` / `red-deep` | `#ff4d5e` / `#6e1622` | Red side, ban strike, negative edges |
| `gold` | `#f5c451` | Active step, AI #1 pick, focus ring |
| `good` | `#34d399` | Win rate >= 50%, positive synergy/counter edge |

## Typography

| Role | Family | Notes |
| :--- | :--- | :--- |
| Display (team names, hero names, labels) | Chakra Petch 500–700 | Uppercase with wide tracking for labels |
| Body (Thai + Latin) | IBM Plex Sans Thai 400–600 | Thai UI copy such as "Missing lanes" |
| Numbers | JetBrains Mono 500–700 | Tabular figures |

## Shape and motion

- Chamfered corners (`clip-chamfer`, `clip-chamfer-sm`) on panels and slots instead of border radius.
- `animate-slot-pulse`: gold glow on the slot or step currently being drafted.
- `animate-lock-in`: brief flash and scale when a hero locks into a slot.
- Bans are grayscale with a diagonal red strike.
- All motion is disabled under `prefers-reduced-motion`.

## Responsive

- `xl` and up: three columns (blue | AI panel + hero grid | red).
- Below `xl`: both teams side by side on top, AI panel and hero grid full width below.
- Hero grid: 4–5 columns on phones up to 7–8 on tablet/desktop, with no horizontal page scroll at 390px.

### Verified Device Viewport & Screenshot Reference

| Device / Orientation | Captured Resolution | Aspect Ratio | Observed Layout Mode |
| :--- | :--- | :--- | :--- |
| **iPad (Safari Landscape)** | `2048 x 1423` px | `~1.44 : 1` | Full 3-column `xl` broadcast layout (`Blue` \| `AI + 7-col Grid` \| `Red`) |
| **iPhone (Safari Portrait)** | `942 x 2048` px | `~0.46 : 1` (`1 : 2.17`) | Compact mobile layout (side-by-side mini team boards, compact AI strip, 5-col grid, bottom quick-action bar) |

## UX, Accessibility & Safety Guardrails

- **WCAG 2.2 AA Contrast & Target Size:** Keep `--color-dim: #7383a5` (`>= 4.5:1` on `panel-2`, `panel`, `bg`) and `--color-muted: #94a3c4`. Visible interactive controls (`button`, `a`, `select`) MUST maintain rendered height `>= 24px` (use `h-8` / `min-h-6` on compact controls, never unpadded `text-[10px]` links).
- **Portal Confirmations (No Native Dialogs):** Never call `window.confirm()`, `window.alert()`, or `window.prompt()`. Use [`ConfirmDialog`](file:///C:/Users/chaya/Documents/Program/Project/ROV/frontend/src/components/ConfirmDialog.tsx) rendered via `createPortal(..., document.body)` so confirmation overlays escape `<header backdrop-blur-md>` and `Modal clip-chamfer` containing blocks cleanly.
- **Mobile Modal Ergonomics:** Never auto-focus text inputs (`initialFocusRef` on search) when opening modals on touch devices; pin the `X` close button top-right on `< sm`; use a unified vertical scroll body on `< sm` (`max-h-[92dvh]`) so mobile toolbars never crush lists (`>= 200px`) or push footer actions off-screen.
- **Compact Cards & Zero Horizontal Overflow:** On `< sm` (`375px–639px`), hide picked/ghost hero text overlays inside `variant="compact"` slots (`hidden sm:block`) to preserve square portraits and lane badges, and keep `scrollWidth <= clientWidth` across `375x667`, `390x844`, `768x1024`, and `1280x800`.
- **Explicit Side Control:** Side switching (`blueSideTeam`) is strictly manual via the Swap Sides action (or loading an existing historical game recorded on the opposite side). Recording a game winner or advancing/switching games (`G1..G7`) MUST NEVER auto-swap sides behind the user's back.

## UI Copy, i18n & Text-Wrapping Standards

- **One-Language Natural Labels:** Default UI strings use idiomatic Thai without parenthetical English glosses (`ไทย (English)`), hype modifiers, academic stat labels, or internal asset paths; `src/i18n/englishMessages.ts` must cover 100% of active `t(...)` and `StableButtonLabel` keys (`0` missing keys).
- **Dropdown & Popover Wrapping (`whitespace-nowrap` Trap):** Any popover or `role="menu"` rendered inside a `whitespace-nowrap` toolbar must reset wrapping with `whitespace-normal`, constrain inner text with `max-w-full break-words`, and stay inside mobile (`375px`) bounds.
- **No Metric Truncation:** Use `min-w-0` on responsive grid/flex tracks hosting scrolling strips (`G1–G7`, hero tables) and wrap multi-stat cards (Arcana stats, duel assumptions) cleanly instead of `line-clamp-1`.

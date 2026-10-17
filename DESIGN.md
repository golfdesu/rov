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
| `ink` / `muted` / `dim` | `#e8edf7` / `#8190b0` / `#4b5878` | Primary, secondary, tertiary text |
| `blue` / `blue-deep` | `#3b9eff` / `#0b3a73` | Blue side |
| `red` / `red-deep` | `#ff4d5e` / `#6e1622` | Red side, ban strike, negative edges |
| `gold` | `#f5c451` | Active step, AI #1 pick, focus ring |
| `good` | `#34d399` | Win rate >= 50%, positive synergy/counter edge |

## Typography

| Role | Family | Notes |
| :--- | :--- | :--- |
| Display (team names, hero names, labels) | Chakra Petch 500–700 | Uppercase with wide tracking for labels |
| Body (Thai + Latin) | IBM Plex Sans Thai 400–600 | Thai UI copy such as "ยังขาดเลน" |
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
- Hero grid: 4 columns on phones up to 8 on desktop, with no horizontal page scroll at 390px.

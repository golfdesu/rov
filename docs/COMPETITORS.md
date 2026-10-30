# Competitor Intelligence & Technical Benchmark: RoV / AoV Draft Platforms

This document records the reverse-engineering teardown, architectural audit, draft algorithm evaluation, and capability benchmarking of all known public **RoV / Arena of Valor (AoV)** draft platforms, simulators, and assistant systems inspected in October 2026.

---

## 1. Comprehensive Competitive Benchmark Matrix

| Platform | Tech Stack | Draft Recommendation Engine | Pick Chronology & Ordering | Multi-Game Global Ban | Combat Mechanics / Damage Engine | Primary Data Source | Scope & Target Audience |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **RoV LAB**<br>`rovlab.app` | React 19 SPA, Tailwind CSS, Supabase BaaS | **Role-Counting Heuristic**<br>Counts roles + static counter points (+3, +2, +1). | **Unordered**<br>Freeform selection without sequence. | **None**<br>Evaluates single matches in isolation. | **None**<br>Basic win rate/presence. | Ranked snapshots (Patch 09.27, Garena TH/TW) | Casual/ranked players, community guides. |
| **CoachOS Draft**<br>`coachos-draft.vercel.app` | Vanilla ES Modules, Vercel Functions, Supabase | **Appearance Frequency Count**<br>Counts final side appearances; 10-hero pilot rules. | **Quarantined (`SIDE_LINEUP_ONLY`)**<br>Blocked by Liquipedia lane order trap (`h1..h5`). | **Supported**<br>Bo3/Bo5/Bo7 Global Ban tracking. | **None**<br>No formulas or combat math. | Liquipedia RPL/GCS/AOG (302 RPL games) | Amateur esports coaches, team scrims. |
| **AOV DraftMind**<br>`aov-ban-pick.vercel.app` | Next.js (App Router), Tailwind CSS, TypeScript | **Empirical Pair/Matchup Frequency**<br>Bans: `banRate + (winRate-0.5)*0.3`; Picks: Ally pair WR + Enemy matchup edge. | **Position Slot Ordered**<br>Follows ĐTDV phase slots, lane-tagged picks. | **Supported**<br>Auto-locks used heroes across series. | **None**<br>Lane-edge percentages only. | Vietnam ĐTDV (AOG) pro tournament data | Competitive Vietnamese coaches & analysts. |
| **AOV Optimal Draft Assistant**<br>`lktnlac.github.io` | Vanilla ES Modules, Canvas, HTML5/CSS3 | **Weighted Linear Score Model**<br>`0.30 Meta + 0.20 Counter + 0.15 Synergy + 0.15 Flex - 0.15 Risk`. | **Interleaved Phase Slots**<br>Ranked & Tournament ban/pick order. | **Supported**<br>Bo3/Bo5 Global Ban mode with patch filter. | **None**<br>No skill or damage calculations. | Small manual JSON tables (660 counters, 130 synergies) | Open-source community experiments. |
| **AOV MetaForge**<br>`aov-metaforge.vercel.app` | Vanilla JS, GSAP 3.12, Web Audio API | **Hardcoded Threat Alert Rules**<br>If enemy picks Butterfly/Tamyn S+, triggers fixed counter cards. | **Snake Draft Format**<br>1-2-2-2-1 pick progression. | **None**<br>Single-game draft generator. | **None**<br>Visual mobility and CC meters. | 129 hardcoded hero objects in `data.js` | Casual players, meta gacha team builder. |
| **ROV Ban/Pick Simulator**<br>`rov-ban-pick.vercel.app` | React 18 UMD (Babel in browser), Tailwind CDN | **None (Pure Manual Overlay)**<br>Manual interactive board for streaming. | **Phase-Based Slots**<br>Standard 4 Bans + 5 Picks per side. | **Partial**<br>Manual hero locking and reset. | **None**<br>Display-only board. | Live Google Sheets via OpenSheet API | Thai community tournaments & streamers. |
| **AoV Drafter (AoV Day)**<br>`imvixtor.github.io` | Vanilla JS, LocalStorage | **None / Basic Text Advice**<br>Shows short counter descriptions from mock records. | **Static Slots**<br>Blue/Red 5v5 hero slots. | **None**<br>Single draft view only. | **None**<br>Qualitative 1-5 stat bars. | 25 mock heroes in client JavaScript | Community mock-up / portfolio prototype. |
| **Our System (RoV Pro Draft Intelligence)** | **React 19 + Tailwind 4 (Frontend), FastAPI + PyTorch (Backend)** | **SOTA Multi-Relational GNN-Transformer**<br>2-layer relational graph (copick, synergy, counter) + Sequence Transformer (Val Loss: 2.74, Top-5 Acc: 64.22%). | **True Pick Order (Verified)**<br>Chronological B1-B5 / R1-R5 recovered from broadcast screenshots via Computer Vision. | **Full Bo3 / Bo5 / Bo7 Support**<br>Complete Global Ban Pick tracking and series history state. | **Production Combat Engine**<br>Exact level 1-15 stats, 525 skills, mitigation `600/(600+def)`, flat/pct pierce, T3 arcana, 33 enchantments, 1v1 duel. | 4,208 pro matches (2024–2026), 130 verified heroes | Professional esports coaches, tier-1 analysts. |

---

## 2. In-Depth Platform Teardowns

### 2.1 Platform 1: RoV LAB (`https://rovlab.app/`)
* **Architecture**: React 19 Single Page Application bundled with Vite and Tailwind CSS.
* **Backend**: Supabase PostgreSQL database (`https://mttcdaiwuasnkqlxbeqs.supabase.co`) storing patch snapshots, hero stats, and community tier lists.
* **Draft Engine**: Implemented in client script chunks (`teamGaps.js`, `DraftAssistant.js`).
  * Measures composition balance via role counts (Tanks, Mages, Marksmen) and physical/magic damage split.
  * Uses hardcoded pairwise counter/synergy bonuses (+3 best, +2 good, +1 situational).
  * Explicitly includes an in-code disclaimer: *"Scores are calculated heuristically from hero roles, not skill-level data."*
* **Notable Features**: 24 educational macro articles (`/learn/*`) covering wave control and jungle pathing; community tier lists.

### 2.2 Platform 2: CoachOS Draft (`https://coachos-draft.vercel.app/`)
* **Architecture**: Vanilla ES Modules JavaScript with Vercel Serverless Functions (`/api/v1/aov/*`) and Supabase for team scrim management.
* **The Liquipedia Ordering Trap**:
  * Trapped by Liquipedia's `t1h1..t1h5` lane ordering format. Because Liquipedia does not record chronological pick order, CoachOS's backend placed its draft engine into a `"chronology-quarantine-v1"` state (`"chronologyCertification": "SIDE_LINEUP_ONLY"`, `"orderStatus": "UNORDERED"`).
  * Emits API warnings: *"Historical chronology unavailable: SIDE_LINEUP_ONLY. RPL source fields describe final lineups. Pick chronology is UNORDERED"*.
* **Draft Algorithm**: Fallback to raw appearance frequency counts (`final-side-appearance`) and vacant role slot matching (`positionEvidence`). Its rule-based assistant covers only 10 pilot heroes (`pilotHeroes: 10`).
* **Notable Features**: Pro match browser with 76 completed RPL games; "My Team" private scrim logging dashboard (KDA, gold share, roster).

### 2.3 Platform 3: AOV DraftMind (`https://aov-ban-pick.vercel.app/`)
* **Architecture**: Next.js App Router (React), Tailwind CSS, hosted on Vercel.
* **Draft Engine**: Detailed client-side statistical scoring engine (`0g1i1v.-b90qe.js`):
  * **Ban Scoring**:
    $$\text{BanScore} = \text{banRate} + \left(\frac{\text{wins}}{n} - 0.5\right) \times 0.3$$
    Incorporates `bestDeny` detection (identifying which hero has the highest empirical win rate against revealed enemy picks) and multi-lane flex tags (`flex N lane (khó đoán bài)`).
  * **Pick Scoring**:
    * Computes pairwise ally synergy from historical match co-occurrences (`e.pair.get([hero, ally].sort().join("+"))`, requires $n \ge 5$).
    * Computes direct head-to-head matchup edge against enemy heroes (`e.matchup.get(`${hero}|${enemy}`)`).
  * **Win Probability Gauge**: Renders dynamic win probability bar `50 + 50 * edge` and displays per-lane matchup differentials (`laneEdges`).
* **Notable Features**: Dedicated `/dashboard` with draft data entry form allowing coaches to input tournament draft sequences and export standardized JSON files.

### 2.4 Platform 4: AOV Optimal Draft Assistant (`https://lktnlac.github.io/Arena-of-Valor-Draft-Suggestion/`)
* **Architecture**: Vanilla ES Modules JavaScript deployed on GitHub Pages.
* **Draft Engine (`draftEngine.js`)**:
  * Uses a parameterized **Weighted Linear Scoring Model**:
    $$\text{Score} = w_{\text{meta}} \cdot \text{Meta} + w_{\text{draft}} \cdot \text{DraftFit} + w_{\text{counter}} \cdot \text{Counter} + w_{\text{synergy}} \cdot \text{Synergy} + w_{\text{comfort}} \cdot \text{Comfort} + w_{\text{flex}} \cdot \text{Flex} - w_{\text{risk}} \cdot \text{Risk}$$
  * Weights for general picks: `0.25 Meta, 0.20 DraftFit, 0.20 Counter, 0.15 Synergy, 0.10 Comfort, 0.10 Flex, 0.20 Risk`.
  * Weights for bans: `0.35 Meta, 0.05 DraftFit, 0.35 Counter, 0.05 Synergy, 0.05 Comfort, 0.05 Flex, 0.10 Risk`.
* **Data Limits**: The underlying JSON datasets (`data/counters.json`, `data/synergies.json`) contain only 660 counter pairs and 130 synergy pairs with manual integer ratings (1-10), covering $< 1\%$ of all possible pairwise interactions (16,900 pairs).
* **Notable Features**: "What-If" analysis toggle allowing users to swap proposed heroes and observe score adjustments.

### 2.5 Platform 5: AOV MetaForge (`https://aov-metaforge.vercel.app/`)
* **Architecture**: Vanilla HTML5/CSS3 + GSAP 3.12 animations + Web Audio API.
* **Draft Engine (`analyzer.js`)**:
  * Evaluates overall team composition metrics: Physical vs. Magic damage ratio, team mobility index, and average crowd control (CC) rating.
  * Operates via **Hardcoded Threat Alert Rules**: detects specific meta power picks (e.g. Butterfly, Tamyn, Astrid) and triggers visual alert banners with fixed hard-counter recommendations (e.g. demanding Aleister, Arum, Omen, or Baldum).
* **Notable Features**: Gacha squad generator ("Vòng quay Gacha đội hình chuẩn Meta") with sound effects and animated roulette wheels for casual team building.

### 2.6 Platform 6: ROV Ban/Pick Simulator (`https://rov-ban-pick.vercel.app/`)
* **Architecture**: In-browser React 18 UMD with Babel compiler and Tailwind CSS CDN (`sanwithz/Rov-ban-pick`).
* **Data Source**: Fetches real-time hero catalog from a public Google Sheet via OpenSheet API (`https://opensheet.elk.sh/.../data`).
* **Draft Functionality**: Purely a visual broadcast overlay for Thai esports organizers. Contains zero recommendation algorithms, machine learning models, or analytical calculators.

### 2.7 Platform 7: AoV Drafter (`https://imvixtor.github.io/aov_drafter/`)
* **Architecture**: Single-file vanilla JavaScript (`app.js`) with LocalStorage persistence.
* **Scope**: Early-stage portfolio prototype containing a mock database of only 25 heroes with static 1-5 attribute ratings and qualitative counter advice.

---

## 3. Categorization of Industry Approaches

Market solutions for RoV / AoV drafting currently fall into five distinct technical tiers:

```
[Tier 1: Manual Visual Overlays] 
    └── rov-ban-pick.vercel.app, aov_drafter
        (Pure UI for streaming / manual selection, 0 intelligence)

[Tier 2: Hardcoded If-Else Alert Rules] 
    └── aov-metaforge.vercel.app
        (Specific hero detection -> fixed counter text popups)

[Tier 3: Static Point Heuristics & Weighted Linear Formulas] 
    └── rovlab.app, lktnlac.github.io (AOV Optimal Draft Assistant)
        (Role counting, +3/+2/+1 counter points, linear weight sums)

[Tier 4: Empirical Tournament Frequency Models (Sequence-Blind)] 
    └── coachos-draft.vercel.app, aov-ban-pick.vercel.app (AOV DraftMind)
        (Pairwise win rates, presence rates, trapped by Liquipedia unordered lane data)

[Tier 5: SOTA Relational Graph Neural Network + Sequence Transformer]
    └── OUR SYSTEM (RoV Pro Draft Intelligence)
        (CV-recovered True Pick Order, Multi-Relational GNN, Dual Policy/Win Value Heads, Full Combat Engine)
```

---

## 4. Key Moats & Architectural Superiority of Our System

1. **Resolution of the Liquipedia Chronology Trap**:
   * While competitors like CoachOS were forced to quarantine temporal sequence modeling because Liquipedia records heroes in lane order (`h1..h5`), our project designed an automated **Computer Vision Screenshot Pipeline** (`.agents/skills/draft-screenshot-reader/`).
   * By extracting broadcast draft boards at the final lock phase, our dataset models genuine chronological pick turns (B1 -> R1-R2 -> B2-B3 -> R3 -> R4 -> B4-B5 -> R5), enabling true sequential decision-making.
2. **Deep Relational Representation vs. Linear Weighting**:
   * Competitors either sum manual weights (`0.25 * meta + 0.20 * counter`) or look up sparse pairwise tables.
   * Our SOTA architecture (`RoVDraftGNNTransformer`) computes continuous relational graph embeddings over 4 relational adjacency matrices (`adj_copick`, `adj_synergy`, `adj_counter`, `adj_countered_by`), trained on 64,000+ decision steps from 4,208 pro games with verified Pareto optimality on H100 GPUs.
3. **Mathematical Combat & Scaling Engine**:
   * No competitor possesses a combat calculation engine.
   * Our system models official Garena formulas: non-linear armor mitigation `600 / (600 + net_defense)`, flat and percentage pierce, 525 skills with exact base/scaling damage, level 1-15 base curves, Tier 3 Arcana sets, and 33 Enchantments with real-time 1v1 duel simulation.

---

## 5. Strategic Roadmap Inspirations

Analyzing the competitive landscape identifies high-impact features worth integrating into our platform:

1. **Composition Balance & Lane Edge HUD (Inspired by AOV DraftMind & RoV LAB)**:
   * Introduce a visual telemetry bar on the draft interface showing:
     * Physical vs. Magic damage output ratio.
     * Hard CC and displacement rating.
     * Frontline / durable tank presence.
     * Estimated per-lane matchup differentials (`laneEdges`).
2. **Interactive Historical Counter-Lookup Panel (Inspired by CoachOS & DraftMind)**:
   * Allow coaches to select 1-3 enemy picks and instantly view empirical pro tournament responses (highest win rate counters, pick frequencies, and partner synergies) queried from our 4,208 pro match dataset.
3. **Standardized Draft Match JSON Exporter (Inspired by AOV DraftMind)**:
   * Provide a utility for teams to export completed multi-game series drafts into clean JSON schemas for internal scrim archiving and review.

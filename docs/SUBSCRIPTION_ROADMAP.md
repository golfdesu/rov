# MiniDraft Future Monetization & Subscription Roadmap

> [!NOTE]
> **Status:** `minidraft.app` remains in its free launch. Development supports Stripe Sandbox purchases of Pro, Duo, and Business (`team_pro`), group invitations, and Draft Board history limits. The Sandbox uses the proposed Duo prices.

This roadmap records the freemium design from the 2026-11-16 review and subsequent product decisions.

---

## 1. Tier Matrix & Feature Packaging

Production remains focused on the **Draft Board** (`VITE_DRAFT_ONLY=true`; Meta Tier List, MetaLab, and Combat Lab stay dev-only unless explicitly opened later).

| Capability | Guest (Not Logged In) | Free (Registered) | Pro | Duo | Business (`team_pro`) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Manual Draft Board (Single Game)** | Allowed | Allowed | Allowed | Allowed | Allowed |
| **Assistant Predictions (`/predict`)** | Allowed | Allowed | Allowed | Allowed per member | Allowed per member |
| **Interactive Draft Comparison (Planned)** | — | — | Included | Included per member | Included per member |
| **Hero Pools (Auto-Sync by Team Name)** | — | **2 personal/team pools** | **50 personal pools** | **50 personal pools per member** | **50 personal + 50 shared team pools** |
| **Scrim Analytics (Planned)** | — | — | Personal (500 games) | Personal (500 games per member) | Personal + Team (500 games) |
| **Screenshot Draft Import (Planned)** | — | — | Included | Included per member | Included per member |
| **Global Ban (Bo3 / Bo5 / Bo7)** | Allowed | Allowed | Allowed | Allowed per member | Allowed per member |
| **Saved Draft History** | **3 games per browser** | **21 games per account** | **500 games per account** | **500 personal games per member** | **500 personal games per member + 500 shared games per team** |
| **Cloud Sync (`/draft/session`)** | Browser storage only | Synced across devices | Synced across devices | Synced across devices | Synced across devices |
| **Team Membership** | — | — | — | **Up to 2 accounts, including the owner** | **Up to 5 accounts, including the owner** |
| **Signed-In Sessions** | — | 2 per account | Multiple devices | Multiple devices per member | Multiple devices per member |
| **Simultaneous Pro Use** | — | — | **2 active sessions per account** | **2 active sessions per member account** | **2 active sessions per member account** |

### Prepaid Pass Pricing

| Tier | 30-day pass | 90-day pass | Savings versus three 30-day passes | Price status |
| :--- | ---: | ---: | ---: | :--- |
| **Pro** | 59 THB | 139 THB | 38 THB (21.5%) | Confirmed |
| **Duo** | 109 THB | 259 THB | 68 THB (20.8%) | Sandbox proposal |
| **Business (`team_pro`)** | 239 THB | 569 THB | 148 THB (20.6%) | Confirmed |

The 90-day passes target about 20% savings and use prices ending in 9. Both durations include the same tier benefits. After the pass expires, the user can renew with another one-time payment.

The 30-day Team Pro price is designed for four or five active members. Four individual Pro passes cost 236 THB. Team Pro includes shared history at 239 THB, and with all five seats filled it costs 47.80 THB per member.

---

## 2. Upgrade, Renewal & Edge-Case Rules

1. **Same-Tier Renewal:** The profile offers another pass once the current pass expires. The server blocks both 30- and 90-day purchases of the current tier while it is active. The next term starts when payment is confirmed.
2. **Pro -> Team Pro Upgrade:** Converts remaining full Pro days at a 1/3 ratio (`remaining_days // 3`) and adds the purchased Team Pro duration (30 or 90 days) from `now` as `team_pro`.
3. **Team Pro -> Pro Downgrade Guard:** Blocks purchases of 30- and 90-day Pro passes while `team_pro` is active so the owner retains team access through the end of the paid term.
4. The **Draft History Capacity** applies across all series within each history. When a history is full, users can keep drafting with the Assistant and can save another game after deleting an entry from that history. Preserve existing history if a plan change puts an account over its limit.
5. **Guest history** stays in the current browser (up to 3 games — enough for one full Bo3 series). **Free and paid accounts** sync their personal history across devices via `/draft/session` (up to 7 games for Free, 500 games for paid plans).

During Sandbox testing, accounts can buy Duo after their current paid pass expires. Duo owners can choose a different paid plan after expiry. Confirm early transition and credit rules before offering such transitions. Active group members receive paid access through the owner, and their existing personal pass continues on its original schedule.

---

## 3. Duo and Team Pro Membership & Shared History

1. The owner pays once for the group and occupies one member slot. Duo owners can invite one other account so both receive full personal Pro entitlements (500 personal games, 50 personal Hero Pools, personal Scrim Analytics). Team Pro owners can invite up to four other accounts and unlock shared Team History + shared Team Hero Pools. Owners invite by username and manage removals. Each invitee accepts from their own account.
2. Personal History is private to each account and holds up to 500 games per member. Team Pro additionally includes Shared Team History (500 games total for the group, visible to active members).
3. A Team Pro member can use **Copy to Team History** on a saved personal game. A successful copy uses one slot in Team History and leaves the original in Personal History. If Team History is full, the copy is blocked and the original remains available.
4. If a member leaves or is removed, access to Team History (Team Pro) and group-granted Pro entitlements ends. Their personal drafts remain available under the account's current plan, including the originals of games they copied to the team.

---

## 4. Simultaneous Pro Use

1. Pro subscribers and members of Duo or Team Pro can stay signed in on multiple devices. A session occupies one of the account's two slots while it is actively using paid drafting features. Tabs that share the same signed-in session share a slot. Only user-initiated paid drafting activity renews the slot.
2. When both slots are occupied, a third session can sign in and receives a message when it tries to use a paid drafting feature. The two active sessions continue their drafts. The third session can retry once a slot is available.
3. A slot becomes available when the user stops active use on another device or when that session's inactivity timeout expires. The device can stay signed in. Five minutes is the initial timeout proposed for testing.

---

## 5. Payment via Stripe PromptPay (Thailand Market)

1. **One-Time Checkout:** A signed-in user selects an eligible tier and a 30- or 90-day prepaid term. MiniDraft creates an order tied to the account and the server-side package price in THB. Hosted Stripe Checkout displays the order's PromptPay QR. [Stripe PromptPay](https://docs.stripe.com/payments/promptpay)
2. **Automatic Activation:** MiniDraft verifies the Stripe webhook signature and confirms the payment status, amount, currency, and order before granting access. Record the Stripe payment ID and extend access in the same database transaction. A unique payment ID prevents duplicate extensions when confirmation is delivered again. Activation works even if the customer closes Checkout after paying. [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment)
3. **Payment Status & Support:** Show order status and the new expiration date in MiniDraft. Handle exceptions in admin support. The planned `scripts/manage_subscription.py` CLI can inspect orders and manage access for support cases.

### Local Stripe Sandbox

The profile page shows test Checkout in development when `STRIPE_SECRET_KEY` contains a Stripe Sandbox key and `STRIPE_WEBHOOK_SECRET` contains the local Stripe CLI signing secret. Keep both values in the ignored server-side `.env`. Production continues to offer open access.

With the local API running on port 8000, forward Sandbox events to it with the Stripe CLI. Use the same sandbox as the API key and restart FastAPI after setting the signing secret.

```powershell
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired --forward-to http://127.0.0.1:8000/billing/webhook
```

Sign in and open **Profile → Plan and payments → View plans** to open `#plans`. The page shows eligible Pro, Duo, and Team Pro cards with a shared 30-day or 90-day selector, the one-time total in THB, and the savings for a 90-day pass. After simulating payment in Stripe Checkout, return to Profile to check the current pass, expiry, and recent orders. An active Pro pass offers the Team Pro upgrade. Active Duo and Team Pro passes offer another purchase after expiry.

The Sandbox stores orders in `billing_orders` and test entitlements in `billing_passes`. Duo and Team Pro owners can invite accounts from **Profile → Manage team**. Invitees accept in their own Profile. Group members select **Team History** in Draft Board History to save a new draft or browse the team's games, and can copy existing games from **Personal History**. The current Sandbox still uses a 10-game Guest browser limit, a synced 50-game Free history, and separate 500-game limits for paid personal and group histories. The 3-game Guest browser limit and synced 7-game Free limit are planned, along with concurrent active-use limits.

---

## 6. Planned Implementation Touchpoints

1. **`src/config.py`** will expose `ROV_MAX_USERS` for the account limit and reuse the existing Stripe environment settings for Sandbox testing.
2. **`src/db.py`**:
   - Build feature entitlements on the existing `billing_passes` and `billing_orders` records.
   - Preserve the existing exclusion for users with billing history during stale-account pruning.
   - Reuse the Sandbox `team_invites`, `team_memberships`, and `team_history` tables. Enforce the two-account Duo and five-account Team Pro limits when invitations are accepted.
   - Keep the Free sign-in session limit. Track active Pro usage separately from sign-in sessions and acquire usage slots atomically per account.
   - Enforce history capacity and purchase updates atomically.
   - Store per-account and shared-group Hero Pools keyed by normalized team name and the 5 RoV lanes.
3. **`src/billing.py`**: Confirm Duo prices and any early plan transition rules before live rollout.
4. **`src/schemas.py` & `src/api.py`**:
   - Extend `AuthUserSchema` with plan and expiry fields.
   - Keep `/draft/session` available to every signed-in tier and enforce per-tier personal history limits on synced saves (7 games for Free, 500 games for paid plans).
   - Check plan access for paid features such as team membership, Team History, and planned draft comparison. Require current membership for every Team History request and enforce shared capacity on saves and copies.
   - Require an available active-use slot when a paid drafting feature is used. Return a distinct response when both slots are occupied so the client can prompt the user to retry.
   - Reuse the Sandbox endpoints for invitations, memberships, shared history, Checkout, order status, and signed Stripe webhooks.
   - Add Hero Pool CRUD endpoints (personal and shared team pools) and accept optional ally/enemy pool hero hints in `/predict`.
   - Add a bounded, in-memory Screenshot Draft Import endpoint (size/type validated, no image persistence) and Scrim Analytics aggregation over Personal / Team History.
5. **`frontend/src/`**:
   - Show the plan and saved game usage. Use the existing plans page for price selection and Profile for payment status and expiry.
   - Keep Global Ban drafting available to all tiers, bounded by each tier's saved draft history capacity (3 browser games for Guest — enough for one full Bo3 series, and 7 synced games for Free — enough for one full Bo7 series).
   - Store up to 3 Guest games in the current browser and sync up to 7 Free games per account across devices. Show history usage and block new saves at capacity so users can choose which games to delete.
   - Reuse the Sandbox team controls, save destination selector, copy action, and history usage totals. Add the message for a third active session during the active-use rollout.
   - Use the Assistant toggle described in Section 8. At the Guest history limit, offer sign-in to unlock the Free 7-game limit and cross-device sync.
   - Add Hero Pool management (5 lanes per team), team-name autocomplete, automatic pool sync when Team A / Team B names match a saved team (following side swaps), AI filter/highlight integration, and remaining-pool counters during Global Ban series.
   - Add a Scrim Analytics view (overall/side/game-number win rates, hero pick/ban/win stats, opponent breakdown) and a Screenshot Draft Import review modal with confidence highlights and 1-click Top-3 slot correction.
6. **Tests & Rollout**:
   - Verify the 3-game Guest browser limit, synced 7-game Free and 500-game paid limits, and cross-device sync for signed-in accounts. Verify that new saves at capacity are blocked and existing games are preserved.
   - Verify that Guest and Free can continue drafting with the Assistant when their histories are full.
   - In Stripe test mode, verify the exact price and currency, duplicate webhook delivery, payment with the return page closed, blocking a repeat purchase while the same tier is active, purchases after expiry, and Pro-to-Team Pro day conversion.
   - Verify Duo and Team Pro invitations and member limits, independent history quotas, copy behavior at capacity, and loss of shared access when a member leaves or is removed.
   - Verify that idle sign-ins leave Pro usage slots available, a third active session leaves the first two running, and an expired slot allows a retry.
   - Verify that Assistant starts on for every tier. Turning it off should hide suggestions and estimates and leave manual drafting available.
   - Verify team-name auto-sync (case-insensitive), pool transfer on side swaps, Global Ban remaining-pool counts, and shared-pool access revocation when a group member leaves or is removed.
   - Verify Scrim Analytics calculations on Personal and Team History, Screenshot Draft Import file/size bounds and in-memory cleanup, and multi-aspect-ratio (iPhone/Android/iPad) ban/pick slot detection accuracy.

---

## 7. Future Draft History Export

Add an **Export** button to Draft History so users can download their saved games as a `.json` file before deleting entries to free up space.

---

## 8. Draft Board Assistant

Replace the standalone Lookahead button on the Draft Board with the **Assistant** toggle from Draft vs AI. Reuse its localized label and toggle design.

- Start with Assistant on for every tier. Assistant use has no turn allowance. History capacity applies to saved games.
- When Assistant is on, show ranked Pick/Ban suggestions, lane highlights, and the live estimated win chance.
- When Assistant is off, show draft progress, hide its recommendations and estimates, and skip background `/predict` calls for Assistant.

---

## 9. Interactive Draft Comparison

Free, Pro, Duo, and Team Pro use the same draft recommendation model. Pro, Duo, and Team Pro are planned to get a separate, on-demand tool for comparing two candidate picks side by side.

### First Release

1. Let the player select two legal picks from the current draft and evaluate the possible responses to each on demand.
2. Follow the actual draft order through the opponent's next pick turn and the player's reply. For example, after a candidate blue first pick (B1), evaluate both red picks (R1–R2) and both blue replies (B2–B3).
3. For each candidate, show a likely opponent response, the most threatening response among the branches searched, and a legal reply the player can use. Explain the practical difference between the candidates, such as whether the opponent can take the preferred initiator and which roam pick remains available.

### Follow-up Improvements

- Let the player replace the predicted opponent picks with legal picks to check a known opponent preference.
- For Global Ban series such as Bo5, show which heroes remain available to the player's team in the next game if they commit to either candidate.

---

## 10. Hero Pools & Team-Name Auto-Sync

Pro, Duo, and Team Pro share the same Hero Pool capabilities so solo coaches, duo partners, and full rosters get identical drafting depth.

1. **Team-Name Binding & Auto-Sync:** Users create and save Hero Pools by team name, organized across the 5 RoV lanes (`DS`, `Jungle`, `Mid`, `Dragon`, `Roam`). When entering or editing Team A or Team B names in `+ New Series` or on the Draft Board, an exact case-insensitive match automatically syncs that team's saved Hero Pool to that side (with autocomplete suggestions for saved teams). Swapping sides (`Blue <-> Red`) automatically transfers each team's Hero Pool along with its team name, matching Global Ban behavior.
2. **AI & Global Ban Integration:**
   - **Ally Pool (Pick Turns):** Supports **Filter mode** (restricting AI recommendations to heroes in the team's pool for remaining open lanes) and **Highlight mode** (showing standard meta recommendations with `POOL` badges so coaches can compare meta picks against comfort picks).
   - **Enemy Pool (Ban Turns & Scouting):** Syncing an opponent's saved team pool flags high-priority opponent signature picks during Ban phases and informs planned Interactive Draft Comparison.
   - **Global Ban Pool Tracker:** Displays the number of remaining unbanned pool heroes per lane across Bo3 / Bo5 / Bo7 games so teams can spot shallow lanes before pool exhaustion.
3. **Personal vs. Shared Team Pools:** Pro, Duo, and Team Pro can store up to **50 personal/opponent team pools** per account. Team Pro additionally supports up to **50 Shared Team Pools** visible and editable by active group members (following the same membership and access-revocation rules as Team History). Free accounts are limited to **1 own-team pool** (no opponent scouting pools).

---

## 11. Scrim Analytics

1. **Zero-Friction Calculation:** Computes actionable team and individual analytics directly from saved draft records (`bluePicks`, `redPicks`, `blueBans`, `redBans`, `winner`, `pickLanes`, `gameNumber`, `seriesName`) with no external game-client integration required.
2. **Core Metrics & Filters:** Overall win rate, Blue vs. Red side win rate, Game 1–7 performance, most-picked heroes and per-lane win rates, most-banned heroes (by and against the team), lowest-win-rate enemy matchups, and opponent/series filters.
3. **Tier Scope:** Pro and Duo analyze Personal History (up to 500 games per member). Team Pro analyzes both Personal History and Shared Team History (up to 500 games). Live multi-user scrim rooms are intentionally excluded because RoV drafts occur inside the mobile game client.

---

## 12. Screenshot Draft Import

1. **Automated Extraction at Zero Marginal Cost:** Lets coaches and players upload an in-game RoV Ban/Pick draft screenshot after a match so the server extracts all 8 Bans and 10 Picks in 1–2 seconds using local CPU computer vision matched against the 130 canonical hero icons (`frontend/public/avatars/`).
2. **Target Screen & Aspect-Ratio Tolerance:** Targets the in-game Ban/Pick screen (which renders default non-skin hero portraits and includes all 8 Bans + 10 Picks) rather than the skin-heavy Loading screen, using dynamic frame localization across Android, iPhone, and iPad aspect ratios.
3. **Human-in-the-Loop Review & Privacy:** Displays detected slots with confidence scores, highlights low-confidence slots with 1-click Top-3 candidate swaps before saving to Personal/Team History or Global Ban, enforces strict file-size/type limits, and discards uploaded images immediately in memory without persisting them to disk. (An optional 1–2 trial imports for Free may be tested at launch.)

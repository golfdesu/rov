# MiniDraft Future Monetization & Subscription Roadmap

> [!NOTE]
> **Status:** Planned for future release (after the initial free open-access phase).
> Currently, `minidraft.app` remains free for all users to test and build traction.

This roadmap records the freemium design from the 2026-11-16 review and subsequent product decisions.

---

## 1. Tier Matrix & Feature Packaging

Production remains focused on the **Draft Board** (`VITE_DRAFT_ONLY=true`; Meta Tier List, MetaLab, and Combat Lab stay dev-only unless explicitly opened later).

| Capability | Guest (Not Logged In) | Free (Registered) | Pro (50 THB / 30d) | Team Pro (149 THB / 30d) |
| :--- | :--- | :--- | :--- | :--- |
| **Manual Draft Board (Single Game)** | Allowed | Allowed | Allowed | Allowed |
| **AI Predictions (`/predict`)** | Blocked (Prompt to Login) | **36 calls / day** (Full Top-K & Lookahead, resets 00:00 UTC+7) | **Unlimited** | **Unlimited** |
| **Global Ban (Bo3 / Bo5 / Bo7)** | Locked | Locked | Unlocked | Unlocked |
| **Saved Draft History** | **10 games per browser** | **50 games per account** | **500 games per account** | **500 personal games per member + 500 shared games per team** |
| **Cloud Sync (`/draft/session`)** | Browser storage only | Synced across devices | Synced across devices | Synced across devices |
| **Team Membership** | — | — | — | **Up to 5 accounts, including the team owner** |
| **Signed-In Sessions** | — | 2 per account | Multiple devices | Multiple devices per member |
| **Simultaneous Pro Use** | — | — | **2 active sessions per account** | **2 active sessions per member account** |

---

## 2. Upgrade, Renewal & Edge-Case Rules

1. **Same-Tier Early Renewal:** Extends `plan_expires_at` by +30 days from `max(now, current_expires_at)`.
2. **Pro -> Team Pro Upgrade:** Converts remaining full Pro days at a 1/3 ratio (`remaining_days // 3`) and adds +30 days on top of `now` as `team_pro`.
3. **Team Pro -> Pro Downgrade Guard:** Rejects 50 THB Pro top-ups while `team_pro` is still active so the owner can retain the team's access through the end of the paid term.
4. **Quota Reset Clock:** Free daily `/predict` quota (36 calls/day = 2 full 18-step drafts) resets at **00:00 Asia/Bangkok (UTC+7)**, tracked per `user_id` + `day_key` in SQLite.
5. **Draft History Capacity:** Count saved games across all series within each history. At capacity, block new saves to that history until the user frees a slot by deleting games. Preserve existing history if a plan change puts an account over its limit.

---

## 3. Team Pro Membership & Shared History

1. The team owner occupies one of the five member slots and can invite up to four other users by username. Invitees accept using their own accounts. The team owner manages membership and can remove members.
2. When saving a new draft, members choose **Personal History** or **Team History**. Personal History is private to the account and holds up to 500 games per member. Team History holds 500 games total and is visible to all team members.
3. A member can use **Copy to Team History** on a saved personal game. A successful copy uses one slot in Team History and leaves the original in Personal History. If Team History is full, the copy is blocked and the original remains available.
4. If a member leaves or is removed, access to Team History ends. Their personal drafts remain available under the account's current plan, including the originals of games they copied to the team.

---

## 4. Simultaneous Pro Use

1. Pro subscribers and Team Pro members can stay signed in on multiple devices. A session occupies one of the account's two slots while it is actively using paid drafting features. Tabs that share the same signed-in session share a slot. Only user-initiated paid drafting activity renews the slot.
2. When both slots are occupied, a third session can sign in and receives a message when it tries to use a paid drafting feature. The two active sessions continue their drafts. The third session can retry once a slot is available.
3. A slot becomes available when the user stops active use on another device or when that session's inactivity timeout expires. The device can stay signed in. Five minutes is the initial timeout proposed for testing.

---

## 5. Payment & Slip Verification Architecture (Thailand Market)

1. **Prepaid 30-Day Pass via Dynamic PromptPay QR:**
   - Generate EMVCo PromptPay QR strings locked to exact package amounts (`50.00` or `149.00` THB) with CRC-16/CCITT-FALSE checksums.
   - Render QR matrices directly as crisp inline `<svg>` in React (no third-party QR dependencies required).
2. **Slip Verification Provider Adapter (`EasySlip` & `SlipOK`):**
   - Selectable via environment variables:
     - `ROV_SLIP_PROVIDER` (`easyslip` | `slipok`)
     - `ROV_SLIP_API_KEY`, `ROV_SLIPOK_BRANCH_ID`
     - `ROV_PROMPTPAY_ID`, `ROV_RECEIVER_NAME`, `ROV_RECEIVER_ACCOUNT`
   - Frontend resizes/compresses slip screenshots on `<canvas>` (max 1280px JPEG) before sending base64 JSON to `POST /billing/verify-slip`.
   - Backend validates image headers via Pillow, allows up to 3 MB on `/billing/verify-slip` in `_MaxBodySizeMiddleware`, enforces rate limits, checks exact amount + receiver match, and enforces a `UNIQUE` index on `trans_ref` in `payment_transactions` to prevent slip replay.
3. **Admin Operations CLI:**
   - Companion CLI script (`scripts/manage_subscription.py`) to inspect user status/transactions and manually grant, extend, or revoke plans in SQLite during API downtime or support requests.

---

## 6. Planned Implementation Touchpoints

1. **`src/config.py`**: Add `ROV_MAX_USERS`, `ROV_FREE_DAILY_PREDICT_LIMIT`, and `ROV_SLIP_*` / `ROV_PROMPTPAY_ID` / `ROV_RECEIVER_*` settings.
2. **`src/db.py`**:
   - Add `plan` and `plan_expires_at` columns to `users` (with safe `ALTER TABLE` migration).
   - Add `daily_predict_usage` and `payment_transactions` tables.
   - Exclude users with billing history or paid plans from stale-account pruning at `max_users`.
   - Store team invitations, memberships, and shared draft history. Enforce the five-member limit when invitations are accepted.
   - Keep the Free sign-in session limit. Track active Pro usage separately from sign-in sessions and acquire usage slots atomically per account.
   - Enforce atomic quota and purchase updates.
3. **`src/billing.py`**: EMVCo PromptPay payload builder, pure-Python ISO 18004 QR encoder, Pillow image validator, and EasySlip/SlipOK adapter.
4. **`src/schemas.py` & `src/api.py`**:
   - Extend `AuthUserSchema` with plan, expiry, and daily quota fields.
   - Gate production `/predict` (login required + 36/day Free quota + Global Ban check).
   - Keep `/draft/session` available to every signed-in tier and enforce the personal history limit on account saves. Require current membership for every Team History request and enforce shared capacity on saves and copies.
   - Require an available active-use slot when a paid drafting feature is used. Return a distinct response when both slots are occupied so the client can prompt the user to retry.
   - Add `GET /billing/plans`, `GET /billing/qr`, `POST /billing/verify-slip`, and `GET /billing/transactions`.
5. **`frontend/src/`**:
   - Navbar plan & remaining-quota badge + `BillingModal` (QR display & slip upload).
   - Keep multi-game Global Ban drafting behind the paid upgrade. Allow Guest and Free users to save and view single-game drafts.
   - Store Guest draft history in the current browser. Show history usage and block new saves at capacity so users can choose which games to delete.
   - Add team invitation and membership controls, a save destination picker, and a copy action in Personal History. Show the usage of each history and the message for a third active session.
   - Prompt Guest users to log in before AI `/predict`.
6. **Tests & Rollout**:
   - Add unit/integration tests for UTC+7 quota reset, slip `trans_ref` replay protection, and Pro-to-Team Pro day conversion before deploying to `minidraft.app`.
   - Verify the Guest browser limit, Free and Pro cross-device sync, and that saving at capacity preserves existing games.
   - Verify team invitations and member limits, independent history quotas, copy behavior at capacity, and loss of shared access when a member leaves or is removed.
   - Verify that idle sign-ins leave Pro usage slots available, a third active session leaves the first two running, and an expired slot allows a retry.

---

## 7. Future Draft History Export

Add an **Export** button to Draft History so users can download their saved games as a `.json` file before deleting entries to free up space.

# Implementation plan — Households (issue #1)

**Issue:** https://github.com/nbarnwell/Spesa/issues/1
**Status:** ready to implement
**Audience:** an engineer or agent picking this up cold

---

## 0. Start here

Read in this order before writing code:

1. `server/db/index.ts` — the schema, and the `migrate()` function you are about to make do real work.
2. `server/services/sync.ts` — every function takes `userSub`; all of them become `householdId`.
3. `server/auth/middleware.ts` — 25 lines, and the place the entire security boundary of this feature lands.
4. `src/db/database.ts` + `src/db/operations.ts` — the local store, currently with no concept of an owner.

**Running it:** `npm run dev` serves client and BFF together on `http://localhost:5174`. `npm run build` type-checks both (`tsc -b` for the client, `tsc -p tsconfig.server.json` for the server) — run it after every phase. `npm run lint` is ESLint. The SQLite file lives at `data/spesa.db` (override with `DB_PATH`).

**There are currently no tests and no test runner.** Phase 0 adds one. Do not skip it: this work includes a destructive SQLite migration and an authorization boundary, and both need to be verifiable without a browser and two Google accounts.

**Non-goals for this issue:** a global/shared product catalogue across households, real-time push (SSE/WebSocket), email delivery of invitations (invites are pulled in-app, not emailed), and any change to the last-write-wins merge rule.

---

## 1. The decisions this plan implements

Settled with the repo owner before the issue was filed. Do not relitigate them; if one turns out to be unworkable, stop and raise it rather than substituting a different model.

| # | Decision |
|---|----------|
| 1 | **Every user is always in exactly one or more households.** A personal household is auto-created on first sign-in. `householdId` replaces `user_sub` as the owner of all data — there is no "personal vs shared" duality and no nullable owner. |
| 2 | **Invites require acceptance.** Adding an email creates a *pending invite*, not a membership. Matched to the invitee on their next sign-in by verified email. |
| 3 | **Migration is the user's choice**, prompted at the moment of creating or joining. |
| 4 | **Owner + promotable admins.** Creator is owner; owner promotes members to admin; owner and admins invite and remove. All members are equal on list/stock/favourites data. |
| 5 | **All households cached locally**, so switching works offline. |
| 6 | **Poll while the app is open**, in addition to the existing on-change sync. |

---

## 2. Two problems in the existing code you must fix on the way

These are pre-existing and are not optional here — the feature is unsafe without them.

### 2.1 `email` is never verified and may be the empty string

`server/auth/google.ts:29` does `email: typeof payload.email === 'string' ? payload.email : ''`, and the userinfo path (`:56`) does the same. Nothing checks Google's `email_verified` claim.

Invite matching is keyed on email. If an unverified or empty email reaches the matching logic, a user can claim invitations addressed to someone else, or every user with `email === ''` matches every invite sent to `''`. Before Phase 3:

- Surface `email_verified` from both the ID-token and userinfo paths onto `UserProfile`.
- Reject invite creation for an empty/malformed email.
- Match a pending invite to a user **only** when their email is non-empty and verified.

### 2.2 Token validation hits Google on every single request

`authenticateBearerToken` falls through to `fetchGoogleUserInfo` for opaque access tokens — an outbound HTTPS round trip per API call. Decision 6 adds polling, which multiplies request volume by every open tab. Add a short-lived in-memory cache keyed on the token (TTL ~5 min, bounded size) in `server/auth/google.ts` before Phase 5, or the polling change will make the app slower rather than fresher.

---

## 3. Phases

Each phase is one commit, builds clean, and leaves the app working. Phases 1–3 ship no visible change — that deliberately separates the risky migration from the new UI.

### Phase 0 — Test harness

Add `vitest` as a dev dependency and a `"test": "vitest run"` script.

Cover, at minimum:

- **Migration** (Phase 1): seed a temp DB in the old shape with two users' data, run `migrate()`, assert each user has exactly one owned household containing exactly their own rows, and that re-running `migrate()` is a no-op.
- **Authorization** (Phase 2): a member of household A requesting household B's data gets 403.

`getDb()` memoises a module-level singleton, so tests need `config.dbPath` pointed at a temp file per test. Either export a `closeDb()`/reset helper or make `getDb()` accept an explicit path — the former is less invasive.

**Done when:** `npm test` runs and passes.

---

### Phase 1 — Server schema and migration

**Files:** `server/db/index.ts`, `server/types.ts`

New tables:

```sql
CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(sub),
  created_at TEXT NOT NULL
);

CREATE TABLE household_members (
  household_id TEXT NOT NULL REFERENCES households(id),
  user_sub TEXT NOT NULL REFERENCES users(sub),
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (household_id, user_sub)
);

CREATE TABLE household_invites (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  email TEXT NOT NULL,               -- always stored lowercased
  invited_by TEXT NOT NULL REFERENCES users(sub),
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','declined','revoked')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE UNIQUE INDEX idx_invites_pending
  ON household_invites(household_id, email) WHERE status = 'pending';
CREATE INDEX idx_invites_email ON household_invites(email, status);
```

The four data tables change their primary key from `(id, user_sub)` to `(id, household_id)`, and the four `idx_*_user_updated` indexes become `idx_*_household_updated` on `(household_id, updated_at)`.

**The migration itself.** `migrate()` today is only `CREATE TABLE IF NOT EXISTS`, so it is safe to re-run and does nothing on an existing DB. It now needs versioning and a real data move. Use `PRAGMA user_version` (no extra table needed):

1. Read `PRAGMA user_version`. If `>= 1`, only run the idempotent `CREATE TABLE IF NOT EXISTS` block and return.
2. Otherwise, in a single transaction:
   - Create the three new tables.
   - For each row in `users`: create a household (`name`: the user's `name`, or the local-part of their email, or `"My household"`), and an `owner` row in `household_members`.
   - For each of `products`, `favourites`, `shopping_list`, `stock`: create `<table>_new` with the new shape, `INSERT INTO <table>_new SELECT ... FROM <table> JOIN household_members hm ON hm.user_sub = <table>.user_sub`, `DROP TABLE <table>`, `ALTER TABLE <table>_new RENAME TO <table>`, recreate indexes.
   - Set `PRAGMA user_version = 1`.

SQLite cannot drop a column that is part of a primary key in place, hence the rebuild. Note that `PRAGMA foreign_keys = ON` is set in `getDb()` — either defer the pragma until after migration or use `PRAGMA legacy_alter_table`, or the drop/rename will trip the foreign keys pointing at these tables. Verify which applies with a test against a seeded DB rather than reasoning about it.

Also add `ensureUserHousehold(sub, name, email)` — creates a personal household + owner membership if the user has none. Called from `upsertUser`, so it covers new sign-ups after the migration has already run.

**Done when:** the Phase 0 migration test passes, and an existing `data/spesa.db` opens with all data intact and reachable through the new column. **Back up `data/spesa.db` before first running this.**

---

### Phase 2 — Membership enforcement in the request pipeline

**Files:** `server/auth/middleware.ts`, `server/types.ts`, `server/routes/api.ts`, `server/services/sync.ts`

This is the security boundary. Once the client names the household it wants, the server must prove the caller belongs to it — otherwise any signed-in user reads any household by guessing an id.

In `requireAuth`, after `upsertUser`:

1. Read the requested household from the `X-Household-Id` header.
2. If absent, default to the caller's first membership (ordered by `joined_at`) — this is what keeps existing single-household clients working unchanged.
3. Look up `household_members` for `(householdId, req.user.sub)`. **No row → respond 403 and stop.** Do not fall back to the default household on a mismatch; that would silently serve the wrong data.
4. Set `req.householdId` and `req.householdRole` (declare both on the Express `Request` interface in `server/types.ts` alongside the existing `user?: UserProfile`).

Add a small `requireRole('owner' | 'admin')` middleware for the management routes in Phase 3.

Then the mechanical sweep: every `req.user!.sub` in `server/routes/api.ts` becomes `req.householdId!`, and every `userSub` parameter in `server/services/sync.ts` becomes `householdId`. `pullSync`, `pushSync`, `softDelete`, `receiveDelivery`, and all four `merge*` functions are affected. The merge and tombstone logic is otherwise unchanged.

Watch `server/routes/api.ts:71` — the favourites join is `ON p.id = f.product_id AND p.user_sub = f.user_sub`, which becomes `p.household_id = f.household_id`.

**Done when:** the 403 test passes; every occurrence of `user_sub` in a data-table query is gone (`rg "user_sub" server/` should only hit `users`, `household_members` and `household_invites`).

---

### Phase 3 — Household, member and invite endpoints

**Files:** `server/routes/households.ts` (new), `server/app.ts`, `server/services/households.ts` (new)

```
GET    /api/households                       my households + my role in each
POST   /api/households                       { name, migrateExistingData } → caller becomes owner
PATCH  /api/households/:id                   { name }                       (owner/admin)
DELETE /api/households/:id                   (owner; refuse if it is their last)

GET    /api/households/:id/members            list members
PATCH  /api/households/:id/members/:userSub   { role }   (owner only)
DELETE /api/households/:id/members/:userSub   remove     (owner/admin; owner not removable)

GET    /api/households/:id/invites             pending invites   (owner/admin)
POST   /api/households/:id/invites             { email }         (owner/admin)
DELETE /api/invites/:inviteId                  revoke (owner/admin) or decline (invitee)

GET    /api/invites                            invites pending for my verified email
POST   /api/invites/:inviteId/accept           { migrateExistingData: boolean }
```

Rules to encode:

- **Owner cannot be removed or demoted** while other members exist; transferring ownership is an explicit `PATCH` to another member's role.
- **A user's last household cannot be left or deleted** — decision 1 says everyone is always in a household. Leaving the last one is a 409, not a silent no-op.
- **Last member out deletes the household and its data.** This is irreversible; it is flagged as an open question on the issue. If unresolved when you reach it, implement the safe half (block the last member from leaving) and leave a TODO rather than writing a delete you cannot undo.
- **`migrateExistingData`** on create/accept moves the caller's rows from their current active household into the new one — a straight `UPDATE <table> SET household_id = ? WHERE household_id = ?` per table, plus product de-duplication by lowercased name against the destination household so joining doesn't produce two "Milk" products. When false, nothing moves.
- **Do not leak account existence.** The response to creating an invite must be identical whether or not that email belongs to a Spesa user.

Extend `GET /api/me` to return the user's households and active household id, so the client can render the switcher on first paint without a second round trip.

**Done when:** the endpoints are exercisable with `curl` and a real token; role rules have tests.

---

### Phase 4 — Client: household-aware local store

**Files:** `src/types/index.ts`, `src/db/database.ts`, `src/db/operations.ts`, `src/api/client.ts`, `src/api/contract.ts`, `src/api/sync.ts`, `src/household/HouseholdProvider.tsx` (new)

Add `householdId: string` to `Product`, `Favourite`, `ShoppingListItem` and `StockItem` in `src/types/index.ts`.

**Dexie version 2** in `src/db/database.ts`: add a `households` table (caching metadata and roles so the switcher renders offline) and compound indexes so every query filters by household — `products: 'id, householdId, [householdId+name]'`, `favourites: 'id, householdId, [householdId+sortOrder]'`, `shoppingList: 'id, householdId, [householdId+productId]'`, `stock: 'id, householdId, [householdId+productId], [householdId+status]'`.

The `upgrade` callback runs offline, where the real household id is unknown. Stamp existing rows with the sentinel `'__local__'`, and reconcile after the first authenticated sync by rewriting `'__local__'` rows to the user's personal household id. A signed-out user continues to work entirely against `'__local__'`, exactly as the app behaves today.

**`src/db/operations.ts` — every function needs the active household threaded through.** Three specific traps:

- `findProductByName` (`:11-15`) loads `db.products.toArray()` and scans it. Unscoped, it will match another household's product and silently attach a new list item to it. Must filter by household.
- `addFavourite` (`:53`), `addToShoppingList` (`:89`), `addToStock` (`:153`), `isFavourite`, `isOnShoppingList`, `isInStock` all do `.where('productId').equals(...)` — each one can match a different household's row. All must use the compound index.
- Every create path must stamp `householdId`.

**`src/api/sync.ts` — `gatherLocalSyncPayload` (`:6-21`) currently gathers `db.products.toArray()` and friends unfiltered.** Left as-is, the first sync after this change pushes every household's rows into whichever household is active — a cross-household data leak that the server will happily accept, because the rows arrive with valid ids. Filter by active household. This is the single highest-risk line in the client work.

**`applyPullToLocal` in `src/api/client.ts` (`:75-95`)** must stamp `householdId` on everything it puts, since the server DTOs don't carry it.

**`fetchWithAuth` (`:21-32`)** sets the `X-Household-Id` header from the active household.

New `HouseholdProvider` wrapping `AppShell` inside `AuthProvider` in `src/App.tsx`: holds the active household id, persists it to `localStorage` (keyed per user `sub`, so two accounts on one device don't collide), exposes `switchHousehold()`, and refuses to hand out an id the current user isn't a member of.

**Done when:** signed out, the app behaves exactly as before; signed in, data round-trips and `X-Household-Id` appears on every request.

---

### Phase 5 — Polling sync

**Files:** `src/auth/AuthProvider.tsx`

The existing effect (`:87-103`) debounces a `fullSync` 1.5s after a local change. Add alongside it: an interval of 15–30s, and a `visibilitychange` handler that syncs on tab focus. Both should skip when `document.hidden`, when offline (`navigator.onLine`), or when a sync is already in flight — otherwise a backgrounded PWA burns battery and hammers Google's userinfo endpoint (see §2.2).

Note the stale-closure risk: the effect depends on `[user]`, and `user.access_token` is captured. An interval must read the current token at fire time, not the one captured when the effect ran.

Consider — but do not necessarily fix here — that last-write-wins now applies to genuinely concurrent edits. Ticking an item off is idempotent so it is fine; two people editing a quantity at once will silently lose one side. Worth a note in the docs rather than a CRDT.

**Done when:** two browsers signed into the same household see each other's changes within the poll interval.

---

### Phase 6 — UI

**Files:** `src/components/Header.tsx`, `src/components/HouseholdSwitcher.tsx` (new), `src/pages/HouseholdSettingsPage.tsx` (new), `src/components/InvitePrompt.tsx` (new), `src/App.tsx`, `src/app.css`

- **Switcher** in the header, next to the existing sign-in/sign-out button. Only render it when the user has more than one household.
- **Settings screen**: rename, member list with roles, promote/demote, remove, invite by email, pending invites with revoke. Reachable from the switcher rather than a new bottom tab — `TabNav` has three tabs and this is not a peer of them.
- **Invite prompt** on sign-in: "Alex invited you to *The Barnwells*", accept/decline, with the migrate-my-data choice on accept.
- **Create household** flow, same migrate prompt.
- Switching household calls `notifyDataChanged()` from `src/hooks/useAsyncData.ts` so the pages reload.

---

### Phase 7 — Docs

`docs/BFF-API.md` line 16 says "household membership can be added later" and line 38 says entities are "scoped to the authenticated user (or household, if you add sharing later)". Both are now wrong. Document the household endpoints, the `X-Household-Id` header, the 403 semantics, and the invite lifecycle. `README.md`'s "How sync works" section needs the same treatment.

---

## 4. Risks

| Risk | Mitigation |
|---|---|
| The SQLite table rebuild is destructive and runs on first server start after deploy | Back up `data/spesa.db`; Phase 0 test seeds a realistic old-shape DB; make the migration transactional so a failure rolls back |
| `gatherLocalSyncPayload` pushing cross-household data | Called out explicitly in Phase 4; worth a test |
| A removed member's IndexedDB still holds the household's data | Client drops a household's local rows when a sync returns 403. Best-effort cleanup, **not** a security control — the data was already on their device |
| Invite matching on unverified/empty email | §2.1, must land before Phase 3 |
| Polling multiplying Google userinfo calls | §2.2, must land before Phase 5 |
| Products are per-household, so the same item exists separately in two households | Accepted; a shared catalogue is out of scope |

## 5. Sequencing summary

```
0. Test harness            no behaviour change
1. Schema + migration      no behaviour change
2. Membership enforcement  no behaviour change  ← security boundary
3. Household endpoints     new API, no UI
4. Client household store  no visible change
5. Polling sync            visible: freshness
6. UI                      visible: the feature
7. Docs
```

Phases 0–4 are shippable without any visible change, which is the point: the migration and the authorization boundary get to production and settle before anyone can create a second household.

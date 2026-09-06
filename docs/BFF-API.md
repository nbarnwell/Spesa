# Spesa BFF API

Backend-for-frontend contract for the Spesa PWA. The client works fully offline in IndexedDB; when the user is signed in and online, it syncs with this API.

## Authentication

- **Provider:** Google OpenID Connect
- **Client:** SPA uses authorization code + PKCE (`oidc-client-ts`)
- **BFF responsibility:** Validate the `Authorization: Bearer <token>` header on every request

Recommended approach:

1. Accept Google **access token** or **ID token** from the SPA
2. Verify signature, `aud`, `iss`, and expiry
3. Map `sub` to an internal user id, then resolve household membership (see below)

### `GET /api/me`

Returns the authenticated user, their households, and which one is active for this request.

**Response 200**

```json
{
  "sub": "google-oauth-sub",
  "email": "you@example.com",
  "emailVerified": true,
  "name": "Alex",
  "picture": "https://...",
  "households": [
    { "id": "...", "name": "The Barnwells", "role": "owner", "createdBy": "...", "createdAt": "..." }
  ],
  "activeHouseholdId": "..."
}
```

**Response 401** — missing or invalid token

---

## Households

Every user is always a member of at least one household — a personal household is created automatically on first sign-in. All data (products, favourites, shopping list, stock) is scoped to a household, not to an individual user.

### Selecting a household

Every authenticated request may include:

```
X-Household-Id: <household id>
```

If omitted, the server defaults to the caller's first household membership (ordered by join date) — this is what keeps a client that has never heard of households working unchanged. If the header names a household the caller is not a member of, the server responds **403** and does not fall back to any other household.

### Household endpoints

| Method | Path | Body | Notes |
|--------|------|------|-------|
| GET | `/api/households` | — | List my households and my role in each |
| POST | `/api/households` | `{ name, migrateExistingData }` | Create a household; caller becomes owner. `migrateExistingData` moves the caller's rows from their active household into the new one, de-duplicating products by name |
| PATCH | `/api/households/:id` | `{ name }` | Rename (owner/admin) |
| DELETE | `/api/households/:id` | — | Delete (owner only); refused (409) if other members remain or it is the caller's last household |
| GET | `/api/households/:id/members` | — | List members and roles |
| PATCH | `/api/households/:id/members/:userSub` | `{ role }` | Change a member's role (owner only). Setting a member's role to `owner` transfers ownership — the caller steps down to `admin` |
| DELETE | `/api/households/:id/members/:userSub` | — | Remove a member (owner/admin), or leave (self). The owner can never be removed this way, and a member can't leave their last household (409) |
| GET | `/api/households/:id/invites` | — | List pending invites (owner/admin) |
| POST | `/api/households/:id/invites` | `{ email }` | Invite by email (owner/admin). Response is identical whether or not the email belongs to a Spesa user |
| DELETE | `/api/invites/:inviteId` | — | Revoke (owner/admin) or decline (invitee) |
| GET | `/api/invites` | — | Invites pending for my verified email |
| POST | `/api/invites/:inviteId/accept` | `{ migrateExistingData }` | Accept an invite and join the household |

### Invite lifecycle

Invites require acceptance — adding an email creates a *pending* invite, not a membership. An invite is matched to a user only once they sign in with that **verified** email (`email_verified` on the Google token); an unverified or empty email can never match. Invites are pulled in-app via `GET /api/invites`, not emailed.

**Response 403** on any household-management route means the caller isn't a member of the household in `:id` (not necessarily their *active* household — these routes check membership on the target household directly).

---

## Data model

All entities are scoped to a household.

| Entity | Purpose |
|--------|---------|
| `Product` | Canonical grocery item (`id`, `name`, optional `category`) |
| `Favourite` | Household's saved regular items (`productId`, `sortOrder`) |
| `ShoppingListItem` | Current list (`productId`, optional `quantity`, `checked`) |
| `StockItem` | Pantry inventory (`productId`, optional `quantity`, `status`: `in_stock` \| `depleted`) |

Every record includes `updatedAt` (ISO 8601). The client uses **last-write-wins** merge on sync — note this now applies across everyone in a household, so two members editing the same item's quantity at the same time will silently lose one side.

---

## Sync (recommended primary integration)

Rather than wiring every CRUD call individually, implement sync endpoints. The SPA already calls these after sign-in. Like all data routes, sync respects `X-Household-Id` (see Households above).

### `GET /api/sync?since=<iso8601>`

Returns all entities changed since `since`, plus tombstones for deletions.

**Response 200**

```json
{
  "serverTime": "2026-06-16T12:00:00.000Z",
  "products": [{ "id": "...", "name": "Milk", "updatedAt": "..." }],
  "favourites": [{ "id": "...", "productId": "...", "sortOrder": 0, "updatedAt": "..." }],
  "shoppingList": [{ "id": "...", "productId": "...", "checked": false, "updatedAt": "..." }],
  "stock": [{ "id": "...", "productId": "...", "status": "in_stock", "updatedAt": "..." }],
  "deleted": {
    "products": [],
    "favourites": [],
    "shoppingList": [],
    "stock": []
  }
}
```

Omit `since` on first sync to return the full dataset.

### `POST /api/sync`

Accepts a batch of local changes from the client.

**Request body**

```json
{
  "clientTime": "2026-06-16T12:00:00.000Z",
  "products": [],
  "favourites": [],
  "shoppingList": [],
  "stock": []
}
```

**Response 200**

```json
{
  "serverTime": "2026-06-16T12:00:00.000Z",
  "conflicts": []
}
```

Merge rule: if both client and server have the same `id`, keep whichever has the later `updatedAt`. Return conflicts optionally for debugging.

---

## Optional REST shortcuts

Useful for admin tools or if you prefer REST over batch sync.

| Method | Path | Body | Notes |
|--------|------|------|-------|
| GET | `/api/products` | — | List products |
| POST | `/api/products` | `{ name, category? }` | Create |
| GET | `/api/favourites` | — | List with embedded product |
| POST | `/api/favourites` | `{ productId }` | Add favourite |
| DELETE | `/api/favourites/:id` | — | Remove |
| GET | `/api/shopping-list` | — | List |
| POST | `/api/shopping-list` | `{ productId, quantity? }` | Add item |
| PATCH | `/api/shopping-list/:id` | `{ checked?, quantity? }` | Update |
| DELETE | `/api/shopping-list/:id` | — | Remove |
| POST | `/api/shopping-list/receive-delivery` | `{ onlyChecked: boolean }` | Move list → stock |
| GET | `/api/stock` | — | List in-stock items |
| POST | `/api/stock` | `{ productId, quantity? }` | Add to pantry |
| PATCH | `/api/stock/:id` | `{ status, quantity? }` | Mark depleted, etc. |
| DELETE | `/api/stock/:id` | — | Remove |

### Delivery receive (server-side mirror)

`POST /api/shopping-list/receive-delivery`

```json
{ "onlyChecked": true }
```

For each matching shopping list item:

1. Upsert a stock item (`status: in_stock`)
2. Delete the shopping list item

Returns `{ "moved": 3 }`.

---

## Client flows mapped to API

| User action | Local (offline) | When online + signed in |
|-------------|-----------------|-------------------------|
| Add to shopping list | IndexedDB | Queued → sync push |
| Check off items | IndexedDB | Sync |
| Delivery arrived | Move list → stock locally | `receive-delivery` or sync |
| Mark stock finished | Set `depleted` | Sync; prompt adds to list locally |
| Manage favourites | IndexedDB | Sync (requires sign-in in UI) |

---

## Suggested stack for the BFF

Any HTTP framework works. Minimum requirements:

- OIDC token validation (Google JWKS)
- Persistent store (Postgres, SQLite, etc.)
- CORS allowing the PWA origin
- HTTPS in production (required for service workers on non-localhost)

## Environment (SPA)

Copy `.env.example` to `.env`:

```
VITE_OIDC_CLIENT_ID=...
VITE_OIDC_REDIRECT_URI=http://localhost:5173/auth/callback
PORT=5173
```

When the BFF is served from the same origin as the PWA (default Spesa setup), leave `VITE_BFF_BASE_URL` unset — the client calls `/api/*` as relative paths.

Google Cloud Console: create an OAuth 2.0 **Web application** client, add authorized JavaScript origins and redirect URI.

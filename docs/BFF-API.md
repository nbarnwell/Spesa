# Spesa BFF API

Backend-for-frontend contract for the Spesa PWA. The client works fully offline in IndexedDB; when the user is signed in and online, it syncs with this API.

## Authentication

- **Provider:** Google OpenID Connect
- **Client:** SPA uses authorization code + PKCE (`oidc-client-ts`)
- **BFF responsibility:** Validate the `Authorization: Bearer <token>` header on every request

Recommended approach:

1. Accept Google **access token** or **ID token** from the SPA
2. Verify signature, `aud`, `iss`, and expiry
3. Map `sub` to an internal user id (household membership can be added later)

### `GET /api/me`

Returns the authenticated user.

**Response 200**

```json
{
  "sub": "google-oauth-sub",
  "email": "you@example.com",
  "name": "Alex",
  "picture": "https://..."
}
```

**Response 401** — missing or invalid token

---

## Data model

All entities are scoped to the authenticated user (or household, if you add sharing later).

| Entity | Purpose |
|--------|---------|
| `Product` | Canonical grocery item (`id`, `name`, optional `category`) |
| `Favourite` | User's saved regular items (`productId`, `sortOrder`) |
| `ShoppingListItem` | Current list (`productId`, optional `quantity`, `checked`) |
| `StockItem` | Pantry inventory (`productId`, optional `quantity`, `status`: `in_stock` \| `depleted`) |

Every record includes `updatedAt` (ISO 8601). The client uses **last-write-wins** merge on sync.

---

## Sync (recommended primary integration)

Rather than wiring every CRUD call individually, implement sync endpoints. The SPA already calls these after sign-in.

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

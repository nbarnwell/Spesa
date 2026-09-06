# Spesa

An offline-first grocery shopping PWA. Manage a shopping list, track pantry stock, and keep a set of favourite items — all usable offline, syncing to a server when you're signed in.

## Features

- **Shopping list** — add items, check them off as you shop
- **Stock** — track what's in the pantry; mark items depleted when they run out
- **Favourites** — save regular items for quick re-adding
- **Offline-first** — the client works entirely from IndexedDB (via Dexie); sign in with Google to sync across devices
- **PWA** — installable, works offline via service worker

## Tech stack

- **Client:** React 19, Vite, TypeScript, Dexie (IndexedDB), `vite-plugin-pwa`
- **Auth:** Google OAuth 2.0 / OpenID Connect (`oidc-client-ts`), authorization code + PKCE
- **Server (BFF):** Express, better-sqlite3, `jose` for token validation

## Getting started

### Prerequisites

- Node.js
- A Google OAuth 2.0 **Web application** client (Google Cloud Console) with an authorized JavaScript origin and redirect URI for local dev

### Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

```
VITE_OIDC_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
VITE_OIDC_REDIRECT_URI=http://localhost:5174/auth/callback
PORT=5174
```

### Development

```bash
npm run dev
```

Runs the BFF server (`server/index.ts` via `tsx watch`), which also serves the Vite dev experience, at `http://localhost:5174`.

### Build & run for production

```bash
npm run build
npm start
```

`build` type-checks and compiles the client (Vite) and server (`tsc`) separately; `start` runs the compiled server from `server-dist/`.

### Lint

```bash
npm run lint
```

### Test

```bash
npm test
```

Runs the server-side test suite (`vitest`): the household migration, the request-pipeline authorization boundary, and the household/invite endpoints.

## Project structure

```
src/            React client (pages, components, auth, IndexedDB layer, API client)
server/         Express BFF (routes, auth/token validation, db access)
docs/           API and architecture docs
public/         Static assets (icons, favicon)
```

See [`docs/BFF-API.md`](docs/BFF-API.md) for the full API contract, sync protocol, and data model.

## Households

Every user always belongs to at least one household — a personal one is created automatically on first sign-in. All data (shopping list, stock, favourites, products) is scoped to the active household, not to an individual user, so a household can be shared with other people: invite by email, they accept next time they sign in, and everyone in the household sees the same list.

- **Invites require acceptance** — adding an email creates a pending invite, matched to that person on their next sign-in by verified email. Invites are pulled in-app, not emailed.
- **Roles:** the creator is the owner; the owner can promote members to admin. Owners and admins can invite and remove members. All members have equal access to list/stock/favourites data.
- **Switching households** works offline — all of a signed-in user's households are cached locally.
- Reachable from the household switcher in the header once signed in.

## How sync works

The client is fully functional offline against its local IndexedDB store. When signed in and online, it syncs with the BFF using a last-write-wins merge on `updatedAt`, scoped to the active household (sent as an `X-Household-Id` header): `GET /api/sync?since=<iso8601>` pulls remote changes, `POST /api/sync` pushes local changes. The client also polls periodically and re-syncs when the tab regains focus, so changes from other household members show up without a manual refresh. See the docs for the full protocol, the household/invite endpoints, and the entity model (`Product`, `Favourite`, `ShoppingListItem`, `StockItem`).

Last-write-wins now applies across everyone in a household: ticking an item off is idempotent so concurrent taps are safe, but two people editing the same item's quantity at the same moment will silently lose one side.

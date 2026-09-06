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
VITE_OIDC_REDIRECT_URI=http://localhost:5173/auth/callback
PORT=5173
```

### Development

```bash
npm run dev
```

Runs the BFF server (`server/index.ts` via `tsx watch`), which also serves the Vite dev experience, at `http://localhost:5173`.

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

## Project structure

```
src/            React client (pages, components, auth, IndexedDB layer, API client)
server/         Express BFF (routes, auth/token validation, db access)
docs/           API and architecture docs
public/         Static assets (icons, favicon)
```

See [`docs/BFF-API.md`](docs/BFF-API.md) for the full API contract, sync protocol, and data model.

## How sync works

The client is fully functional offline against its local IndexedDB store. When signed in and online, it syncs with the BFF using a last-write-wins merge on `updatedAt`: `GET /api/sync?since=<iso8601>` pulls remote changes, `POST /api/sync` pushes local changes. See the docs for the full protocol and entity model (`Product`, `Favourite`, `ShoppingListItem`, `StockItem`).

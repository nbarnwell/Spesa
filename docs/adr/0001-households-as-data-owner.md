# 1. Households, not individual users, own data

## Status

Accepted

## Context

All grocery data (products, favourites, shopping list, stock) was keyed directly to the signed-in user's `sub`. There was no way for two people — a couple, a household — to share a single list; each account was an island. Retrofitting sharing later, once client and server code assumed a 1:1 user-to-data relationship throughout, would touch the same surface area as building it in now, but with production data already shaped around the old model.

## Decision

Introduce `households` as the unit of data ownership. Every user is always a member of at least one household — a personal one, created automatically on first sign-in — so there is no nullable "no household yet" state to special-case anywhere. `household_id` replaces `user_sub` as the foreign key on every data table, both server-side (SQLite) and client-side (IndexedDB).

Membership is `owner` / `admin` / `member`: the creator is the owner, the owner can promote members to admin, and owner/admin can invite and remove members. Invites require acceptance — adding an email creates a pending invite, matched to a user only by their *verified* email on next sign-in, never emailed out-of-band. The client resolves which household is active per request via an `X-Household-Id` header, defaulting to the caller's first membership when omitted, and the server treats membership as the authorization boundary: no row in `household_members` for the requested household is a 403, with no fallback to any other household.

## Consequences

- A one-time, irreversible SQLite table rebuild moves existing per-user rows into a personal household for that user. It runs automatically on first server start after deploy and is versioned via `PRAGMA user_version` so it never re-runs.
- Every existing data-access code path (sync, REST shortcuts, IndexedDB queries) now takes a household id instead of a user id — a broad but mechanical change, not a design compromise.
- Products are scoped per household, so the same grocery item can exist as separate rows in two households; there is no shared/global product catalogue. Joining two households' data (`migrateExistingData`) de-duplicates products by lowercased name, but only at the moment of migration.
- Last-write-wins conflict resolution, previously only ever contended by one person's own devices, now applies across everyone in a household. Two members editing the same item concurrently can silently lose one side.

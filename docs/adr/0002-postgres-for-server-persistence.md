# 2. Postgres for server persistence

## Status

Accepted. Supersedes the storage and migration-mechanism details in the Consequences of [ADR 1](0001-households-as-data-owner.md) (SQLite, `PRAGMA user_version`); the decision in that record — households own data — is unchanged.

## Context

The server stored everything in a local `better-sqlite3` file. That ties the app to one instance's disk and, because every call was synchronous, gave every request implicit serialisation. Real concurrent traffic from several households — and running more than one app instance — needs a networked database, and several read-then-write code paths (first-sign-in household creation, last-write-wins sync merge, invite creation, delivery receipt) were only correct because nothing could interleave. Issue #5.

## Decision

- **Postgres via `pg`**, hand-written SQL, no ORM. A managed Postgres service in production, Docker Postgres locally and in tests. The existing code was already raw SQL, so an ORM would be a much larger rewrite than the change needs.
- **Forward-only migration runner** in `server/db/migrations.ts`, tracked in a `schema_migrations` table and run at server startup under `pg_advisory_xact_lock`, so instances booting together serialise safely. Migrations are TypeScript string constants because `tsc` does not copy `.sql` files into `server-dist/`. The transaction-scoped lock (not the session-level one) is used because it stays correct behind a transaction-pooling proxy such as PgBouncer.
- **No port of the legacy `user_sub` → household migration and no SQLite import.** Nothing had been deployed, so Postgres starts from the household-shaped schema as migration 1.
- **`TIMESTAMPTZ` columns**, returned to JavaScript as ISO-8601 strings by a global type parser so API shapes are unchanged. Text timestamps would compare using the database collation, and client-supplied strings are not guaranteed to be normalised. Genuine booleans use `BOOLEAN` (`shopping_list.checked`).
- **Last-write-wins is a single atomic `INSERT … ON CONFLICT DO UPDATE … WHERE EXCLUDED.updated_at > t.updated_at`.** A select-then-upsert under READ COMMITTED lets two concurrent pushes both pass the check so the later commit wins regardless of `updatedAt`; SERIALIZABLE plus retries would be far more machinery for the same result.

## Consequences

- Docker is needed for development and for `npm test`. Tests use a real Postgres with a fresh schema per test, because in-memory substitutes do not faithfully exercise row locking or `ON CONFLICT` concurrency.
- Concurrency is handled by atomic statements, row locks (`FOR UPDATE` on delivery), a fixed row order within a push (to avoid deadlocks) and short transactions, rather than by a single writer.
- Every service function is async and takes an optional `db` argument so it can join a caller's transaction.
- A push with an unparseable `updatedAt` is now rejected with 400 instead of being stored as-is.
- Schema changes are made only by appending a new migration; shipped entries are never edited.

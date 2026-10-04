export interface Migration {
  version: number
  name: string
  sql: string
}

/**
 * Forward-only. Never edit an entry once it has shipped — add a new version instead.
 * Embedded as strings (not .sql files) because `tsc` does not copy non-TS files to server-dist.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
CREATE TABLE users (
  sub TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  picture TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(sub),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE household_members (
  household_id TEXT NOT NULL REFERENCES households(id),
  user_sub TEXT NOT NULL REFERENCES users(sub),
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (household_id, user_sub)
);
CREATE INDEX idx_members_user ON household_members(user_sub, joined_at);

CREATE TABLE household_invites (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  email TEXT NOT NULL,
  invited_by TEXT NOT NULL REFERENCES users(sub),
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','declined','revoked')),
  created_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_invites_pending ON household_invites(household_id, email) WHERE status = 'pending';
CREATE INDEX idx_invites_email ON household_invites(email, status);

CREATE TABLE products (
  id TEXT NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  category TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (id, household_id)
);

CREATE TABLE favourites (
  id TEXT NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id),
  product_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (id, household_id)
);

CREATE TABLE shopping_list (
  id TEXT NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id),
  product_id TEXT NOT NULL,
  quantity TEXT,
  checked BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (id, household_id)
);

CREATE TABLE stock (
  id TEXT NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id),
  product_id TEXT NOT NULL,
  quantity TEXT,
  status TEXT NOT NULL CHECK (status IN ('in_stock', 'depleted')),
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (id, household_id)
);

CREATE INDEX idx_products_household_updated ON products(household_id, updated_at);
CREATE INDEX idx_favourites_household_updated ON favourites(household_id, updated_at);
CREATE INDEX idx_shopping_household_updated ON shopping_list(household_id, updated_at);
CREATE INDEX idx_stock_household_updated ON stock(household_id, updated_at);
`,
  },
]

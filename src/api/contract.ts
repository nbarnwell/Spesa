/**
 * BFF API contract — implement these endpoints on your backend.
 * All authenticated routes expect: Authorization: Bearer <access_token>
 * (the Google OAuth access token obtained via the code exchange at /auth/token).
 * Data routes also expect: X-Household-Id: <household id> (defaults to the
 * caller's first household membership when omitted).
 */

export type HouseholdRole = 'owner' | 'admin' | 'member'

export interface HouseholdSummary {
  id: string
  name: string
  role: HouseholdRole
  createdBy: string
  createdAt: string
}

export interface UserProfile {
  sub: string
  email: string
  emailVerified: boolean
  name?: string
  picture?: string
  households: HouseholdSummary[]
  activeHouseholdId: string
}

export interface MemberSummary {
  userSub: string
  role: HouseholdRole
  joinedAt: string
  email: string
  name: string | null
}

export interface InviteSummary {
  id: string
  householdId: string
  householdName: string
  email: string
  invitedBy: string
  status: 'pending' | 'accepted' | 'declined' | 'revoked'
  createdAt: string
  resolvedAt: string | null
}

export interface ProductDto {
  id: string
  name: string
  category?: string
  updatedAt: string
}

export interface FavouriteDto {
  id: string
  productId: string
  sortOrder: number
  updatedAt: string
}

export interface ShoppingListItemDto {
  id: string
  productId: string
  quantity?: string
  checked: boolean
  updatedAt: string
}

export interface StockItemDto {
  id: string
  productId: string
  quantity?: string
  status: 'in_stock' | 'depleted'
  updatedAt: string
}

export interface SyncPullResponse {
  serverTime: string
  products: ProductDto[]
  favourites: FavouriteDto[]
  shoppingList: ShoppingListItemDto[]
  stock: StockItemDto[]
  deleted: {
    products: string[]
    favourites: string[]
    shoppingList: string[]
    stock: string[]
  }
}

export interface SyncPushRequest {
  clientTime: string
  products: ProductDto[]
  favourites: FavouriteDto[]
  shoppingList: ShoppingListItemDto[]
  stock: StockItemDto[]
}

export interface SyncPushResponse {
  serverTime: string
  conflicts: Array<{
    entity: 'product' | 'favourite' | 'shoppingList' | 'stock'
    id: string
    serverVersion: unknown
  }>
}

/** Route map for the BFF */
export const BFF_ROUTES = {
  /** GET — returns UserProfile (with households + activeHouseholdId) from validated OIDC token */
  me: '/api/me',

  /** POST form-encoded — OAuth token proxy (authorization_code, refresh_token); unauthenticated */
  authToken: '/auth/token',

  /** GET ?since=<iso> — incremental sync pull */
  syncPull: '/api/sync',

  /** POST — push local changes; server merges by updatedAt (last-write-wins) */
  syncPush: '/api/sync',

  /** CRUD shortcuts (optional if using sync-only; useful for debugging) */
  products: '/api/products',
  favourites: '/api/favourites',
  shoppingList: '/api/shopping-list',
  stock: '/api/stock',

  /** POST body: { onlyChecked: boolean } — server-side delivery receive */
  receiveDelivery: '/api/shopping-list/receive-delivery',

  /** GET my households; POST { name, migrateExistingData } to create one */
  households: '/api/households',
  household: (id: string) => `/api/households/${id}`,
  householdMembers: (id: string) => `/api/households/${id}/members`,
  householdMember: (id: string, userSub: string) => `/api/households/${id}/members/${userSub}`,
  householdInvites: (id: string) => `/api/households/${id}/invites`,

  /** GET invites pending for my verified email */
  myInvites: '/api/invites',
  invite: (inviteId: string) => `/api/invites/${inviteId}`,
  acceptInvite: (inviteId: string) => `/api/invites/${inviteId}/accept`,
} as const

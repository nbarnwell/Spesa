/**
 * BFF API contract — implement these endpoints on your backend.
 * All authenticated routes expect: Authorization: Bearer <access_token>
 * (Google OIDC access token or a BFF-issued JWT after token exchange).
 */

export interface UserProfile {
  sub: string
  email: string
  name?: string
  picture?: string
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
  /** GET — returns UserProfile from validated OIDC token */
  me: '/api/me',

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
} as const

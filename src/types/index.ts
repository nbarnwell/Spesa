export type SyncStatus = 'local' | 'pending' | 'synced'

export interface Product {
  id: string
  householdId: string
  name: string
  category?: string
  updatedAt: string
  syncStatus: SyncStatus
}

export interface Favourite {
  id: string
  householdId: string
  productId: string
  sortOrder: number
  updatedAt: string
  syncStatus: SyncStatus
}

export interface ShoppingListItem {
  id: string
  householdId: string
  productId: string
  quantity?: string
  checked: boolean
  updatedAt: string
  syncStatus: SyncStatus
}

export interface StockItem {
  id: string
  householdId: string
  productId: string
  quantity?: string
  status: 'in_stock' | 'depleted'
  updatedAt: string
  syncStatus: SyncStatus
}

export type HouseholdRole = 'owner' | 'admin' | 'member'

export interface HouseholdRecord {
  id: string
  name: string
  role: HouseholdRole
}

export type TabId = 'shop' | 'stock' | 'favourites'

export interface PendingSyncOp {
  id: string
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
  createdAt: string
}

/** Sentinel household id used for local data before the first authenticated sync. */
export const LOCAL_HOUSEHOLD_ID = '__local__'

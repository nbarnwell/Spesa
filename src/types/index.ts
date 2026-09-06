export type SyncStatus = 'local' | 'pending' | 'synced'

export interface Product {
  id: string
  name: string
  category?: string
  updatedAt: string
  syncStatus: SyncStatus
}

export interface Favourite {
  id: string
  productId: string
  sortOrder: number
  updatedAt: string
  syncStatus: SyncStatus
}

export interface ShoppingListItem {
  id: string
  productId: string
  quantity?: string
  checked: boolean
  updatedAt: string
  syncStatus: SyncStatus
}

export interface StockItem {
  id: string
  productId: string
  quantity?: string
  status: 'in_stock' | 'depleted'
  updatedAt: string
  syncStatus: SyncStatus
}

export type TabId = 'shop' | 'stock' | 'favourites'

export interface PendingSyncOp {
  id: string
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
  createdAt: string
}

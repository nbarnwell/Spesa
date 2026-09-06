export interface UserProfile {
  sub: string
  email: string
  name?: string
  picture?: string
}

export interface ProductRow {
  id: string
  userSub: string
  name: string
  category: string | null
  updatedAt: string
  deletedAt: string | null
}

export interface FavouriteRow {
  id: string
  userSub: string
  productId: string
  sortOrder: number
  updatedAt: string
  deletedAt: string | null
}

export interface ShoppingListRow {
  id: string
  userSub: string
  productId: string
  quantity: string | null
  checked: number
  updatedAt: string
  deletedAt: string | null
}

export interface StockRow {
  id: string
  userSub: string
  productId: string
  quantity: string | null
  status: 'in_stock' | 'depleted'
  updatedAt: string
  deletedAt: string | null
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

declare global {
  namespace Express {
    interface Request {
      user?: UserProfile
    }
  }
}

export {}

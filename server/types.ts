export interface UserProfile {
  sub: string
  email: string
  emailVerified: boolean
  name?: string
  picture?: string
}

export type HouseholdRole = 'owner' | 'admin' | 'member'

export interface Household {
  id: string
  name: string
  createdBy: string
  createdAt: string
}

export interface HouseholdMember {
  householdId: string
  userSub: string
  role: HouseholdRole
  joinedAt: string
}

export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked'

export interface HouseholdInvite {
  id: string
  householdId: string
  email: string
  invitedBy: string
  status: InviteStatus
  createdAt: string
  resolvedAt: string | null
}

export interface ProductRow {
  id: string
  householdId: string
  name: string
  category: string | null
  updatedAt: string
  deletedAt: string | null
}

export interface FavouriteRow {
  id: string
  householdId: string
  productId: string
  sortOrder: number
  updatedAt: string
  deletedAt: string | null
}

export interface ShoppingListRow {
  id: string
  householdId: string
  productId: string
  quantity: string | null
  checked: boolean
  updatedAt: string
  deletedAt: string | null
}

export interface StockRow {
  id: string
  householdId: string
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
  // Declaration merging with Express's Request type can only be done via a namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserProfile
      householdId?: string
      householdRole?: HouseholdRole
    }
  }
}

export {}

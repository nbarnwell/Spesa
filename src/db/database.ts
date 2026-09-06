import Dexie, { type EntityTable } from 'dexie'
import type {
  Favourite,
  PendingSyncOp,
  Product,
  ShoppingListItem,
  StockItem,
} from '../types'

class SpesaDatabase extends Dexie {
  products!: EntityTable<Product, 'id'>
  favourites!: EntityTable<Favourite, 'id'>
  shoppingList!: EntityTable<ShoppingListItem, 'id'>
  stock!: EntityTable<StockItem, 'id'>
  syncQueue!: EntityTable<PendingSyncOp, 'id'>

  constructor() {
    super('spesa')
    this.version(1).stores({
      products: 'id, name, updatedAt',
      favourites: 'id, productId, sortOrder, updatedAt',
      shoppingList: 'id, productId, checked, updatedAt',
      stock: 'id, productId, status, updatedAt',
      syncQueue: 'id, createdAt',
    })
  }
}

export const db = new SpesaDatabase()

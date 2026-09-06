import Dexie, { type EntityTable } from 'dexie'
import type {
  Favourite,
  HouseholdRecord,
  PendingSyncOp,
  Product,
  ShoppingListItem,
  StockItem,
} from '../types'
import { LOCAL_HOUSEHOLD_ID } from '../types'

class SpesaDatabase extends Dexie {
  products!: EntityTable<Product, 'id'>
  favourites!: EntityTable<Favourite, 'id'>
  shoppingList!: EntityTable<ShoppingListItem, 'id'>
  stock!: EntityTable<StockItem, 'id'>
  syncQueue!: EntityTable<PendingSyncOp, 'id'>
  households!: EntityTable<HouseholdRecord, 'id'>

  constructor() {
    super('spesa')

    this.version(1).stores({
      products: 'id, name, updatedAt',
      favourites: 'id, productId, sortOrder, updatedAt',
      shoppingList: 'id, productId, checked, updatedAt',
      stock: 'id, productId, status, updatedAt',
      syncQueue: 'id, createdAt',
    })

    this.version(2)
      .stores({
        products: 'id, householdId, [householdId+name]',
        favourites: 'id, householdId, [householdId+sortOrder]',
        shoppingList: 'id, householdId, [householdId+productId]',
        stock: 'id, householdId, [householdId+productId], [householdId+status]',
        syncQueue: 'id, createdAt',
        households: 'id',
      })
      .upgrade(async (tx) => {
        // The real household id is unknown while offline — stamp existing rows with a
        // sentinel and reconcile once we learn the signed-in user's household (see
        // reconcileLocalHousehold). A signed-out user just keeps using the sentinel.
        for (const table of ['products', 'favourites', 'shoppingList', 'stock'] as const) {
          await tx
            .table(table)
            .toCollection()
            .modify((row: { householdId?: string }) => {
              row.householdId = LOCAL_HOUSEHOLD_ID
            })
        }
      })
  }
}

export const db = new SpesaDatabase()

/** Rewrites sentinel-owned rows to the real household id after the first authenticated sync. */
export async function reconcileLocalHousehold(householdId: string): Promise<void> {
  if (householdId === LOCAL_HOUSEHOLD_ID) return

  await db.transaction('rw', db.products, db.favourites, db.shoppingList, db.stock, async () => {
    await db.products.where('householdId').equals(LOCAL_HOUSEHOLD_ID).modify({ householdId })
    await db.favourites.where('householdId').equals(LOCAL_HOUSEHOLD_ID).modify({ householdId })
    await db.shoppingList.where('householdId').equals(LOCAL_HOUSEHOLD_ID).modify({ householdId })
    await db.stock.where('householdId').equals(LOCAL_HOUSEHOLD_ID).modify({ householdId })
  })
}

/**
 * Best-effort local cleanup for a household the server no longer lets us sync
 * (e.g. after removal) — not a security control, since the data was already on
 * this device.
 */
export async function dropHouseholdData(householdId: string): Promise<void> {
  if (householdId === LOCAL_HOUSEHOLD_ID) return

  await db.transaction(
    'rw',
    db.products,
    db.favourites,
    db.shoppingList,
    db.stock,
    db.households,
    async () => {
      await db.products.where('householdId').equals(householdId).delete()
      await db.favourites.where('householdId').equals(householdId).delete()
      await db.shoppingList.where('householdId').equals(householdId).delete()
      await db.stock.where('householdId').equals(householdId).delete()
      await db.households.delete(householdId)
    },
  )
}

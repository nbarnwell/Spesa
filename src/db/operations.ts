import { db } from './database'
import type { Product, Favourite, ShoppingListItem, StockItem } from '../types'
import { newId, normalizeProductName, nowIso } from '../lib/ids'
import { getActiveHouseholdId } from '../household/activeHousehold'

export type ProductWithRefs = Product & {
  favourite?: Favourite
  shopping?: ShoppingListItem
  stock?: StockItem
}

async function findProductByName(name: string): Promise<Product | undefined> {
  const normalized = normalizeProductName(name).toLowerCase()
  const all = await db.products.where('householdId').equals(getActiveHouseholdId()).toArray()
  return all.find((p) => p.name.toLowerCase() === normalized)
}

export async function getOrCreateProduct(name: string, category?: string): Promise<Product> {
  const trimmed = normalizeProductName(name)
  if (!trimmed) throw new Error('Product name is required')

  const existing = await findProductByName(trimmed)
  if (existing) return existing

  const product: Product = {
    id: newId(),
    householdId: getActiveHouseholdId(),
    name: trimmed,
    category,
    updatedAt: nowIso(),
    syncStatus: 'local',
  }
  await db.products.add(product)
  return product
}

export async function listProducts(): Promise<Product[]> {
  return db.products.where('householdId').equals(getActiveHouseholdId()).sortBy('name')
}

export async function listFavourites(): Promise<Array<Favourite & { product: Product }>> {
  const householdId = getActiveHouseholdId()
  const favourites = await db.favourites
    .where('householdId')
    .equals(householdId)
    .sortBy('sortOrder')
  const products = await db.products.where('householdId').equals(householdId).toArray()
  const byId = new Map(products.map((p) => [p.id, p]))

  return favourites
    .map((f) => {
      const product = byId.get(f.productId)
      return product ? { ...f, product } : null
    })
    .filter((x): x is Favourite & { product: Product } => x !== null)
}

export async function addFavourite(productId: string): Promise<Favourite> {
  const householdId = getActiveHouseholdId()
  const existing = await db.favourites
    .where('householdId')
    .equals(householdId)
    .filter((f) => f.productId === productId)
    .first()
  if (existing) return existing

  const householdFavourites = await db.favourites
    .where('householdId')
    .equals(householdId)
    .sortBy('sortOrder')
  const maxOrder = householdFavourites.at(-1)?.sortOrder ?? -1

  const favourite: Favourite = {
    id: newId(),
    householdId,
    productId,
    sortOrder: maxOrder + 1,
    updatedAt: nowIso(),
    syncStatus: 'local',
  }
  await db.favourites.add(favourite)
  return favourite
}

export async function removeFavourite(favouriteId: string): Promise<void> {
  await db.favourites.delete(favouriteId)
}

export async function listShoppingItems(): Promise<Array<ShoppingListItem & { product: Product }>> {
  const householdId = getActiveHouseholdId()
  const items = (
    await db.shoppingList.where('householdId').equals(householdId).sortBy('updatedAt')
  ).reverse()
  const products = await db.products.where('householdId').equals(householdId).toArray()
  const byId = new Map(products.map((p) => [p.id, p]))

  return items
    .map((item) => {
      const product = byId.get(item.productId)
      return product ? { ...item, product } : null
    })
    .filter((x): x is ShoppingListItem & { product: Product } => x !== null)
}

export async function addToShoppingList(
  productId: string,
  quantity?: string,
): Promise<ShoppingListItem> {
  const householdId = getActiveHouseholdId()
  const existing = await db.shoppingList
    .where('[householdId+productId]')
    .equals([householdId, productId])
    .first()

  if (existing) {
    const updated: ShoppingListItem = {
      ...existing,
      quantity: quantity ?? existing.quantity,
      checked: false,
      updatedAt: nowIso(),
      syncStatus: existing.syncStatus === 'synced' ? 'pending' : existing.syncStatus,
    }
    await db.shoppingList.put(updated)
    return updated
  }

  const item: ShoppingListItem = {
    id: newId(),
    householdId,
    productId,
    quantity,
    checked: false,
    updatedAt: nowIso(),
    syncStatus: 'local',
  }
  await db.shoppingList.add(item)
  return item
}

export async function toggleShoppingChecked(itemId: string, checked: boolean): Promise<void> {
  const item = await db.shoppingList.get(itemId)
  if (!item) return
  await db.shoppingList.put({
    ...item,
    checked,
    updatedAt: nowIso(),
    syncStatus: item.syncStatus === 'synced' ? 'pending' : item.syncStatus,
  })
}

export async function removeShoppingItem(itemId: string): Promise<void> {
  await db.shoppingList.delete(itemId)
}

export async function clearCheckedShoppingItems(): Promise<void> {
  const householdId = getActiveHouseholdId()
  const checked = await db.shoppingList
    .where('householdId')
    .equals(householdId)
    .filter((i) => i.checked)
    .toArray()
  await db.shoppingList.bulkDelete(checked.map((i) => i.id))
}

export async function listStock(): Promise<Array<StockItem & { product: Product }>> {
  const householdId = getActiveHouseholdId()
  const items = await db.stock.where('householdId').equals(householdId).toArray()
  const products = await db.products.where('householdId').equals(householdId).toArray()
  const byId = new Map(products.map((p) => [p.id, p]))

  return items
    .filter((i) => i.status === 'in_stock')
    .map((item) => {
      const product = byId.get(item.productId)
      return product ? { ...item, product } : null
    })
    .filter((x): x is StockItem & { product: Product } => x !== null)
    .sort((a, b) => a.product.name.localeCompare(b.product.name))
}

export async function addToStock(
  productId: string,
  quantity?: string,
): Promise<StockItem> {
  const householdId = getActiveHouseholdId()
  const existing = await db.stock
    .where('[householdId+productId]')
    .equals([householdId, productId])
    .filter((s) => s.status === 'in_stock')
    .first()

  if (existing) {
    const updated: StockItem = {
      ...existing,
      quantity: quantity ?? existing.quantity,
      updatedAt: nowIso(),
      syncStatus: existing.syncStatus === 'synced' ? 'pending' : existing.syncStatus,
    }
    await db.stock.put(updated)
    return updated
  }

  const item: StockItem = {
    id: newId(),
    householdId,
    productId,
    quantity,
    status: 'in_stock',
    updatedAt: nowIso(),
    syncStatus: 'local',
  }
  await db.stock.add(item)
  return item
}

/** Move shopping list items (checked only, or all) into stock and remove from list. */
export async function receiveDelivery(options: { onlyChecked: boolean }): Promise<number> {
  const householdId = getActiveHouseholdId()
  const items = await db.shoppingList.where('householdId').equals(householdId).toArray()
  const toReceive = options.onlyChecked ? items.filter((i) => i.checked) : items
  if (toReceive.length === 0) return 0

  for (const item of toReceive) {
    await addToStock(item.productId, item.quantity)
    await db.shoppingList.delete(item.id)
  }
  return toReceive.length
}

export async function markStockDepleted(stockId: string): Promise<StockItem | undefined> {
  const item = await db.stock.get(stockId)
  if (!item) return undefined

  const updated: StockItem = {
    ...item,
    status: 'depleted',
    updatedAt: nowIso(),
    syncStatus: item.syncStatus === 'synced' ? 'pending' : item.syncStatus,
  }
  await db.stock.put(updated)
  return updated
}

export async function isFavourite(productId: string): Promise<boolean> {
  const householdId = getActiveHouseholdId()
  const fav = await db.favourites
    .where('householdId')
    .equals(householdId)
    .filter((f) => f.productId === productId)
    .first()
  return !!fav
}

export async function isOnShoppingList(productId: string): Promise<boolean> {
  const householdId = getActiveHouseholdId()
  const item = await db.shoppingList
    .where('[householdId+productId]')
    .equals([householdId, productId])
    .first()
  return !!item
}

export async function isInStock(productId: string): Promise<boolean> {
  const householdId = getActiveHouseholdId()
  const item = await db.stock
    .where('[householdId+productId]')
    .equals([householdId, productId])
    .filter((s) => s.status === 'in_stock')
    .first()
  return !!item
}

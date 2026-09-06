import { db } from './database'
import type { Product, Favourite, ShoppingListItem, StockItem } from '../types'
import { newId, normalizeProductName, nowIso } from '../lib/ids'

export type ProductWithRefs = Product & {
  favourite?: Favourite
  shopping?: ShoppingListItem
  stock?: StockItem
}

async function findProductByName(name: string): Promise<Product | undefined> {
  const normalized = normalizeProductName(name).toLowerCase()
  const all = await db.products.toArray()
  return all.find((p) => p.name.toLowerCase() === normalized)
}

export async function getOrCreateProduct(name: string, category?: string): Promise<Product> {
  const trimmed = normalizeProductName(name)
  if (!trimmed) throw new Error('Product name is required')

  const existing = await findProductByName(trimmed)
  if (existing) return existing

  const product: Product = {
    id: newId(),
    name: trimmed,
    category,
    updatedAt: nowIso(),
    syncStatus: 'local',
  }
  await db.products.add(product)
  return product
}

export async function listProducts(): Promise<Product[]> {
  return db.products.orderBy('name').toArray()
}

export async function listFavourites(): Promise<Array<Favourite & { product: Product }>> {
  const favourites = await db.favourites.orderBy('sortOrder').toArray()
  const products = await db.products.toArray()
  const byId = new Map(products.map((p) => [p.id, p]))

  return favourites
    .map((f) => {
      const product = byId.get(f.productId)
      return product ? { ...f, product } : null
    })
    .filter((x): x is Favourite & { product: Product } => x !== null)
}

export async function addFavourite(productId: string): Promise<Favourite> {
  const existing = await db.favourites.where('productId').equals(productId).first()
  if (existing) return existing

  const maxOrder = (await db.favourites.orderBy('sortOrder').last())?.sortOrder ?? -1
  const favourite: Favourite = {
    id: newId(),
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
  const items = await db.shoppingList.orderBy('updatedAt').reverse().toArray()
  const products = await db.products.toArray()
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
  const existing = await db.shoppingList.where('productId').equals(productId).first()
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
  const checked = await db.shoppingList.filter((i) => i.checked).toArray()
  await db.shoppingList.bulkDelete(checked.map((i) => i.id))
}

export async function listStock(): Promise<Array<StockItem & { product: Product }>> {
  const items = await db.stock.toArray()
  const products = await db.products.toArray()
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
  const existing = await db.stock
    .where('productId')
    .equals(productId)
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
  const items = await db.shoppingList.toArray()
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
  const fav = await db.favourites.where('productId').equals(productId).first()
  return !!fav
}

export async function isOnShoppingList(productId: string): Promise<boolean> {
  const item = await db.shoppingList.where('productId').equals(productId).first()
  return !!item
}

export async function isInStock(productId: string): Promise<boolean> {
  const item = await db.stock
    .where('productId')
    .equals(productId)
    .filter((s) => s.status === 'in_stock')
    .first()
  return !!item
}

import { getDb, nowIso } from '../db/index.js'
import type {
  FavouriteDto,
  ProductDto,
  ShoppingListItemDto,
  StockItemDto,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
} from '../types.js'

function isAfter(a: string, b: string): boolean {
  return Date.parse(a) > Date.parse(b)
}

function sinceFilter(since: string | undefined): string {
  return since ?? '1970-01-01T00:00:00.000Z'
}

export function pullSync(householdId: string, since?: string): SyncPullResponse {
  const database = getDb()
  const cutoff = sinceFilter(since)
  const serverTime = nowIso()

  const products = database
    .prepare(
      `SELECT id, name, category, updated_at AS updatedAt, deleted_at AS deletedAt
       FROM products
       WHERE household_id = ? AND updated_at > ? AND deleted_at IS NULL`,
    )
    .all(householdId, cutoff) as Array<ProductDto & { deletedAt: string | null }>

  const favourites = database
    .prepare(
      `SELECT id, product_id AS productId, sort_order AS sortOrder, updated_at AS updatedAt, deleted_at AS deletedAt
       FROM favourites
       WHERE household_id = ? AND updated_at > ? AND deleted_at IS NULL`,
    )
    .all(householdId, cutoff) as Array<FavouriteDto & { deletedAt: string | null }>

  const shoppingList = database
    .prepare(
      `SELECT id, product_id AS productId, quantity, checked, updated_at AS updatedAt, deleted_at AS deletedAt
       FROM shopping_list
       WHERE household_id = ? AND updated_at > ? AND deleted_at IS NULL`,
    )
    .all(householdId, cutoff) as Array<{
      id: string
      productId: string
      quantity: string | null
      checked: number
      updatedAt: string
      deletedAt: string | null
    }>

  const stock = database
    .prepare(
      `SELECT id, product_id AS productId, quantity, status, updated_at AS updatedAt, deleted_at AS deletedAt
       FROM stock
       WHERE household_id = ? AND updated_at > ? AND deleted_at IS NULL`,
    )
    .all(householdId, cutoff) as Array<StockItemDto & { deletedAt: string | null }>

  const deletedProducts = database
    .prepare(
      `SELECT id FROM products WHERE household_id = ? AND deleted_at IS NOT NULL AND deleted_at > ?`,
    )
    .all(householdId, cutoff) as Array<{ id: string }>

  const deletedFavourites = database
    .prepare(
      `SELECT id FROM favourites WHERE household_id = ? AND deleted_at IS NOT NULL AND deleted_at > ?`,
    )
    .all(householdId, cutoff) as Array<{ id: string }>

  const deletedShopping = database
    .prepare(
      `SELECT id FROM shopping_list WHERE household_id = ? AND deleted_at IS NOT NULL AND deleted_at > ?`,
    )
    .all(householdId, cutoff) as Array<{ id: string }>

  const deletedStock = database
    .prepare(
      `SELECT id FROM stock WHERE household_id = ? AND deleted_at IS NOT NULL AND deleted_at > ?`,
    )
    .all(householdId, cutoff) as Array<{ id: string }>

  return {
    serverTime,
    products: products.map(({ category, ...rest }) => ({
      ...rest,
      category: category ?? undefined,
    })),
    favourites,
    shoppingList: shoppingList.map((row) => ({
      id: row.id,
      productId: row.productId,
      quantity: row.quantity ?? undefined,
      checked: Boolean(row.checked),
      updatedAt: row.updatedAt,
    })),
    stock: stock.map((row) => ({
      id: row.id,
      productId: row.productId,
      quantity: row.quantity ?? undefined,
      status: row.status,
      updatedAt: row.updatedAt,
    })),
    deleted: {
      products: deletedProducts.map((r) => r.id),
      favourites: deletedFavourites.map((r) => r.id),
      shoppingList: deletedShopping.map((r) => r.id),
      stock: deletedStock.map((r) => r.id),
    },
  }
}

function mergeProduct(householdId: string, dto: ProductDto): boolean {
  const database = getDb()
  const existing = database
    .prepare(`SELECT updated_at AS updatedAt FROM products WHERE id = ? AND household_id = ?`)
    .get(dto.id, householdId) as { updatedAt: string } | undefined

  if (existing && !isAfter(dto.updatedAt, existing.updatedAt)) return false

  database
    .prepare(
      `INSERT INTO products (id, household_id, name, category, updated_at, deleted_at)
       VALUES (@id, @householdId, @name, @category, @updatedAt, NULL)
       ON CONFLICT(id, household_id) DO UPDATE SET
         name = excluded.name,
         category = excluded.category,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
    )
    .run({
      id: dto.id,
      householdId,
      name: dto.name,
      category: dto.category ?? null,
      updatedAt: dto.updatedAt,
    })
  return true
}

function mergeFavourite(householdId: string, dto: FavouriteDto): boolean {
  const database = getDb()
  const existing = database
    .prepare(`SELECT updated_at AS updatedAt FROM favourites WHERE id = ? AND household_id = ?`)
    .get(dto.id, householdId) as { updatedAt: string } | undefined

  if (existing && !isAfter(dto.updatedAt, existing.updatedAt)) return false

  database
    .prepare(
      `INSERT INTO favourites (id, household_id, product_id, sort_order, updated_at, deleted_at)
       VALUES (@id, @householdId, @productId, @sortOrder, @updatedAt, NULL)
       ON CONFLICT(id, household_id) DO UPDATE SET
         product_id = excluded.product_id,
         sort_order = excluded.sort_order,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
    )
    .run({
      id: dto.id,
      householdId,
      productId: dto.productId,
      sortOrder: dto.sortOrder,
      updatedAt: dto.updatedAt,
    })
  return true
}

function mergeShopping(householdId: string, dto: ShoppingListItemDto): boolean {
  const database = getDb()
  const existing = database
    .prepare(`SELECT updated_at AS updatedAt FROM shopping_list WHERE id = ? AND household_id = ?`)
    .get(dto.id, householdId) as { updatedAt: string } | undefined

  if (existing && !isAfter(dto.updatedAt, existing.updatedAt)) return false

  database
    .prepare(
      `INSERT INTO shopping_list (id, household_id, product_id, quantity, checked, updated_at, deleted_at)
       VALUES (@id, @householdId, @productId, @quantity, @checked, @updatedAt, NULL)
       ON CONFLICT(id, household_id) DO UPDATE SET
         product_id = excluded.product_id,
         quantity = excluded.quantity,
         checked = excluded.checked,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
    )
    .run({
      id: dto.id,
      householdId,
      productId: dto.productId,
      quantity: dto.quantity ?? null,
      checked: dto.checked ? 1 : 0,
      updatedAt: dto.updatedAt,
    })
  return true
}

function mergeStock(householdId: string, dto: StockItemDto): boolean {
  const database = getDb()
  const existing = database
    .prepare(`SELECT updated_at AS updatedAt FROM stock WHERE id = ? AND household_id = ?`)
    .get(dto.id, householdId) as { updatedAt: string } | undefined

  if (existing && !isAfter(dto.updatedAt, existing.updatedAt)) return false

  database
    .prepare(
      `INSERT INTO stock (id, household_id, product_id, quantity, status, updated_at, deleted_at)
       VALUES (@id, @householdId, @productId, @quantity, @status, @updatedAt, NULL)
       ON CONFLICT(id, household_id) DO UPDATE SET
         product_id = excluded.product_id,
         quantity = excluded.quantity,
         status = excluded.status,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
    )
    .run({
      id: dto.id,
      householdId,
      productId: dto.productId,
      quantity: dto.quantity ?? null,
      status: dto.status,
      updatedAt: dto.updatedAt,
    })
  return true
}

export function pushSync(householdId: string, body: SyncPushRequest): SyncPushResponse {
  const conflicts: SyncPushResponse['conflicts'] = []
  const database = getDb()

  const run = database.transaction(() => {
    for (const product of body.products) {
      if (!mergeProduct(householdId, product)) {
        const server = database
          .prepare(
            `SELECT id, name, category, updated_at AS updatedAt FROM products WHERE id = ? AND household_id = ?`,
          )
          .get(product.id, householdId)
        conflicts.push({ entity: 'product', id: product.id, serverVersion: server })
      }
    }
    for (const favourite of body.favourites) {
      if (!mergeFavourite(householdId, favourite)) {
        const server = database
          .prepare(
            `SELECT id, product_id AS productId, sort_order AS sortOrder, updated_at AS updatedAt
             FROM favourites WHERE id = ? AND household_id = ?`,
          )
          .get(favourite.id, householdId)
        conflicts.push({ entity: 'favourite', id: favourite.id, serverVersion: server })
      }
    }
    for (const item of body.shoppingList) {
      if (!mergeShopping(householdId, item)) {
        const server = database
          .prepare(
            `SELECT id, product_id AS productId, quantity, checked, updated_at AS updatedAt
             FROM shopping_list WHERE id = ? AND household_id = ?`,
          )
          .get(item.id, householdId)
        conflicts.push({ entity: 'shoppingList', id: item.id, serverVersion: server })
      }
    }
    for (const item of body.stock) {
      if (!mergeStock(householdId, item)) {
        const server = database
          .prepare(
            `SELECT id, product_id AS productId, quantity, status, updated_at AS updatedAt
             FROM stock WHERE id = ? AND household_id = ?`,
          )
          .get(item.id, householdId)
        conflicts.push({ entity: 'stock', id: item.id, serverVersion: server })
      }
    }
  })

  run()

  return { serverTime: nowIso(), conflicts }
}

export function softDelete(
  table: 'products' | 'favourites' | 'shopping_list' | 'stock',
  householdId: string,
  id: string,
): boolean {
  const database = getDb()
  const ts = nowIso()
  const result = database
    .prepare(
      `UPDATE ${table}
       SET deleted_at = @ts, updated_at = @ts
       WHERE id = @id AND household_id = @householdId AND deleted_at IS NULL`,
    )
    .run({ id, householdId, ts })
  return result.changes > 0
}

export function receiveDelivery(
  householdId: string,
  onlyChecked: boolean,
): number {
  const database = getDb()
  const ts = nowIso()
  let moved = 0

  const run = database.transaction(() => {
    const items = database
      .prepare(
        `SELECT id, product_id AS productId, quantity
         FROM shopping_list
         WHERE household_id = ? AND deleted_at IS NULL ${onlyChecked ? 'AND checked = 1' : ''}`,
      )
      .all(householdId) as Array<{ id: string; productId: string; quantity: string | null }>

    for (const item of items) {
      const existingStock = database
        .prepare(
          `SELECT id FROM stock
           WHERE household_id = ? AND product_id = ? AND status = 'in_stock' AND deleted_at IS NULL`,
        )
        .get(householdId, item.productId) as { id: string } | undefined

      if (existingStock) {
        database
          .prepare(
            `UPDATE stock SET quantity = @quantity, updated_at = @ts WHERE id = @id AND household_id = @householdId`,
          )
          .run({
            id: existingStock.id,
            householdId,
            quantity: item.quantity,
            ts,
          })
      } else {
        database
          .prepare(
            `INSERT INTO stock (id, household_id, product_id, quantity, status, updated_at, deleted_at)
             VALUES (@id, @householdId, @productId, @quantity, 'in_stock', @ts, NULL)`,
          )
          .run({
            id: crypto.randomUUID(),
            householdId,
            productId: item.productId,
            quantity: item.quantity,
            ts,
          })
      }

      database
        .prepare(
          `UPDATE shopping_list SET deleted_at = @ts, updated_at = @ts WHERE id = @id AND household_id = @householdId`,
        )
        .run({ id: item.id, householdId, ts })
      moved += 1
    }
  })

  run()
  return moved
}

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

export function pullSync(userSub: string, since?: string): SyncPullResponse {
  const database = getDb()
  const cutoff = sinceFilter(since)
  const serverTime = nowIso()

  const products = database
    .prepare(
      `SELECT id, name, category, updated_at AS updatedAt, deleted_at AS deletedAt
       FROM products
       WHERE user_sub = ? AND updated_at > ? AND deleted_at IS NULL`,
    )
    .all(userSub, cutoff) as Array<ProductDto & { deletedAt: string | null }>

  const favourites = database
    .prepare(
      `SELECT id, product_id AS productId, sort_order AS sortOrder, updated_at AS updatedAt, deleted_at AS deletedAt
       FROM favourites
       WHERE user_sub = ? AND updated_at > ? AND deleted_at IS NULL`,
    )
    .all(userSub, cutoff) as Array<FavouriteDto & { deletedAt: string | null }>

  const shoppingList = database
    .prepare(
      `SELECT id, product_id AS productId, quantity, checked, updated_at AS updatedAt, deleted_at AS deletedAt
       FROM shopping_list
       WHERE user_sub = ? AND updated_at > ? AND deleted_at IS NULL`,
    )
    .all(userSub, cutoff) as Array<{
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
       WHERE user_sub = ? AND updated_at > ? AND deleted_at IS NULL`,
    )
    .all(userSub, cutoff) as Array<StockItemDto & { deletedAt: string | null }>

  const deletedProducts = database
    .prepare(
      `SELECT id FROM products WHERE user_sub = ? AND deleted_at IS NOT NULL AND deleted_at > ?`,
    )
    .all(userSub, cutoff) as Array<{ id: string }>

  const deletedFavourites = database
    .prepare(
      `SELECT id FROM favourites WHERE user_sub = ? AND deleted_at IS NOT NULL AND deleted_at > ?`,
    )
    .all(userSub, cutoff) as Array<{ id: string }>

  const deletedShopping = database
    .prepare(
      `SELECT id FROM shopping_list WHERE user_sub = ? AND deleted_at IS NOT NULL AND deleted_at > ?`,
    )
    .all(userSub, cutoff) as Array<{ id: string }>

  const deletedStock = database
    .prepare(
      `SELECT id FROM stock WHERE user_sub = ? AND deleted_at IS NOT NULL AND deleted_at > ?`,
    )
    .all(userSub, cutoff) as Array<{ id: string }>

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

function mergeProduct(userSub: string, dto: ProductDto): boolean {
  const database = getDb()
  const existing = database
    .prepare(`SELECT updated_at AS updatedAt FROM products WHERE id = ? AND user_sub = ?`)
    .get(dto.id, userSub) as { updatedAt: string } | undefined

  if (existing && !isAfter(dto.updatedAt, existing.updatedAt)) return false

  database
    .prepare(
      `INSERT INTO products (id, user_sub, name, category, updated_at, deleted_at)
       VALUES (@id, @userSub, @name, @category, @updatedAt, NULL)
       ON CONFLICT(id, user_sub) DO UPDATE SET
         name = excluded.name,
         category = excluded.category,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
    )
    .run({
      id: dto.id,
      userSub,
      name: dto.name,
      category: dto.category ?? null,
      updatedAt: dto.updatedAt,
    })
  return true
}

function mergeFavourite(userSub: string, dto: FavouriteDto): boolean {
  const database = getDb()
  const existing = database
    .prepare(`SELECT updated_at AS updatedAt FROM favourites WHERE id = ? AND user_sub = ?`)
    .get(dto.id, userSub) as { updatedAt: string } | undefined

  if (existing && !isAfter(dto.updatedAt, existing.updatedAt)) return false

  database
    .prepare(
      `INSERT INTO favourites (id, user_sub, product_id, sort_order, updated_at, deleted_at)
       VALUES (@id, @userSub, @productId, @sortOrder, @updatedAt, NULL)
       ON CONFLICT(id, user_sub) DO UPDATE SET
         product_id = excluded.product_id,
         sort_order = excluded.sort_order,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
    )
    .run({
      id: dto.id,
      userSub,
      productId: dto.productId,
      sortOrder: dto.sortOrder,
      updatedAt: dto.updatedAt,
    })
  return true
}

function mergeShopping(userSub: string, dto: ShoppingListItemDto): boolean {
  const database = getDb()
  const existing = database
    .prepare(`SELECT updated_at AS updatedAt FROM shopping_list WHERE id = ? AND user_sub = ?`)
    .get(dto.id, userSub) as { updatedAt: string } | undefined

  if (existing && !isAfter(dto.updatedAt, existing.updatedAt)) return false

  database
    .prepare(
      `INSERT INTO shopping_list (id, user_sub, product_id, quantity, checked, updated_at, deleted_at)
       VALUES (@id, @userSub, @productId, @quantity, @checked, @updatedAt, NULL)
       ON CONFLICT(id, user_sub) DO UPDATE SET
         product_id = excluded.product_id,
         quantity = excluded.quantity,
         checked = excluded.checked,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
    )
    .run({
      id: dto.id,
      userSub,
      productId: dto.productId,
      quantity: dto.quantity ?? null,
      checked: dto.checked ? 1 : 0,
      updatedAt: dto.updatedAt,
    })
  return true
}

function mergeStock(userSub: string, dto: StockItemDto): boolean {
  const database = getDb()
  const existing = database
    .prepare(`SELECT updated_at AS updatedAt FROM stock WHERE id = ? AND user_sub = ?`)
    .get(dto.id, userSub) as { updatedAt: string } | undefined

  if (existing && !isAfter(dto.updatedAt, existing.updatedAt)) return false

  database
    .prepare(
      `INSERT INTO stock (id, user_sub, product_id, quantity, status, updated_at, deleted_at)
       VALUES (@id, @userSub, @productId, @quantity, @status, @updatedAt, NULL)
       ON CONFLICT(id, user_sub) DO UPDATE SET
         product_id = excluded.product_id,
         quantity = excluded.quantity,
         status = excluded.status,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
    )
    .run({
      id: dto.id,
      userSub,
      productId: dto.productId,
      quantity: dto.quantity ?? null,
      status: dto.status,
      updatedAt: dto.updatedAt,
    })
  return true
}

export function pushSync(userSub: string, body: SyncPushRequest): SyncPushResponse {
  const conflicts: SyncPushResponse['conflicts'] = []
  const database = getDb()

  const run = database.transaction(() => {
    for (const product of body.products) {
      if (!mergeProduct(userSub, product)) {
        const server = database
          .prepare(
            `SELECT id, name, category, updated_at AS updatedAt FROM products WHERE id = ? AND user_sub = ?`,
          )
          .get(product.id, userSub)
        conflicts.push({ entity: 'product', id: product.id, serverVersion: server })
      }
    }
    for (const favourite of body.favourites) {
      if (!mergeFavourite(userSub, favourite)) {
        const server = database
          .prepare(
            `SELECT id, product_id AS productId, sort_order AS sortOrder, updated_at AS updatedAt
             FROM favourites WHERE id = ? AND user_sub = ?`,
          )
          .get(favourite.id, userSub)
        conflicts.push({ entity: 'favourite', id: favourite.id, serverVersion: server })
      }
    }
    for (const item of body.shoppingList) {
      if (!mergeShopping(userSub, item)) {
        const server = database
          .prepare(
            `SELECT id, product_id AS productId, quantity, checked, updated_at AS updatedAt
             FROM shopping_list WHERE id = ? AND user_sub = ?`,
          )
          .get(item.id, userSub)
        conflicts.push({ entity: 'shoppingList', id: item.id, serverVersion: server })
      }
    }
    for (const item of body.stock) {
      if (!mergeStock(userSub, item)) {
        const server = database
          .prepare(
            `SELECT id, product_id AS productId, quantity, status, updated_at AS updatedAt
             FROM stock WHERE id = ? AND user_sub = ?`,
          )
          .get(item.id, userSub)
        conflicts.push({ entity: 'stock', id: item.id, serverVersion: server })
      }
    }
  })

  run()

  return { serverTime: nowIso(), conflicts }
}

export function softDelete(
  table: 'products' | 'favourites' | 'shopping_list' | 'stock',
  userSub: string,
  id: string,
): boolean {
  const database = getDb()
  const ts = nowIso()
  const result = database
    .prepare(
      `UPDATE ${table}
       SET deleted_at = @ts, updated_at = @ts
       WHERE id = @id AND user_sub = @userSub AND deleted_at IS NULL`,
    )
    .run({ id, userSub, ts })
  return result.changes > 0
}

export function receiveDelivery(
  userSub: string,
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
         WHERE user_sub = ? AND deleted_at IS NULL ${onlyChecked ? 'AND checked = 1' : ''}`,
      )
      .all(userSub) as Array<{ id: string; productId: string; quantity: string | null }>

    for (const item of items) {
      const existingStock = database
        .prepare(
          `SELECT id FROM stock
           WHERE user_sub = ? AND product_id = ? AND status = 'in_stock' AND deleted_at IS NULL`,
        )
        .get(userSub, item.productId) as { id: string } | undefined

      if (existingStock) {
        database
          .prepare(
            `UPDATE stock SET quantity = @quantity, updated_at = @ts WHERE id = @id AND user_sub = @userSub`,
          )
          .run({
            id: existingStock.id,
            userSub,
            quantity: item.quantity,
            ts,
          })
      } else {
        database
          .prepare(
            `INSERT INTO stock (id, user_sub, product_id, quantity, status, updated_at, deleted_at)
             VALUES (@id, @userSub, @productId, @quantity, 'in_stock', @ts, NULL)`,
          )
          .run({
            id: crypto.randomUUID(),
            userSub,
            productId: item.productId,
            quantity: item.quantity,
            ts,
          })
      }

      database
        .prepare(
          `UPDATE shopping_list SET deleted_at = @ts, updated_at = @ts WHERE id = @id AND user_sub = @userSub`,
        )
        .run({ id: item.id, userSub, ts })
      moved += 1
    }
  })

  run()
  return moved
}

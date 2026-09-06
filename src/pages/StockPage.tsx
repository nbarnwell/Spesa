import { useCallback, useState } from 'react'
import { AddProductForm } from '../components/AddProductForm'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState } from '../components/EmptyState'
import { useAsyncData, useDataVersion, notifyDataChanged } from '../hooks/useAsyncData'
import {
  addToShoppingList,
  addToStock,
  getOrCreateProduct,
  listStock,
  markStockDepleted,
} from '../db/operations'
import type { Product, StockItem } from '../types'

type StockRow = StockItem & { product: Product }

export function StockPage() {
  const version = useDataVersion()
  const loader = useCallback(() => listStock(), [])
  const { data: items } = useAsyncData(loader, version)

  const [depletedItem, setDepletedItem] = useState<StockRow | null>(null)

  async function handleAdd(name: string) {
    const product = await getOrCreateProduct(name)
    await addToStock(product.id)
    notifyDataChanged()
  }

  async function handleMarkGone(item: StockRow) {
    await markStockDepleted(item.id)
    notifyDataChanged()
    setDepletedItem(item)
  }

  async function handleReplenish() {
    if (!depletedItem) return
    await addToShoppingList(depletedItem.productId)
    notifyDataChanged()
    setDepletedItem(null)
  }

  return (
    <section className="page">
      <div className="page__intro">
        <h2 className="page__heading">In stock</h2>
        <p className="page__sub">What you have at home right now.</p>
      </div>

      <AddProductForm onAdd={handleAdd} placeholder="Add to pantry…" submitLabel="Stock" />

      {!items ? (
        <p className="loading">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon="🏠"
          title="Pantry is empty"
          hint="When delivery arrives, move items from your shopping list here."
        />
      ) : (
        <ul className="item-list">
          {items.map((item) => (
            <li key={item.id} className="item-row">
              <span className="item-row__name">{item.product.name}</span>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => void handleMarkGone(item)}
              >
                Finished
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={depletedItem !== null}
        title="Add to shopping list?"
        message={
          depletedItem
            ? `${depletedItem.product.name} is gone. Add it to your shopping list?`
            : ''
        }
        confirmLabel="Add to list"
        onConfirm={() => void handleReplenish()}
        onCancel={() => setDepletedItem(null)}
      />
    </section>
  )
}

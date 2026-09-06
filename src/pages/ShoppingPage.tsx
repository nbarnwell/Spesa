import { useCallback } from 'react'
import { AddProductForm } from '../components/AddProductForm'
import { EmptyState } from '../components/EmptyState'
import { useAsyncData, useDataVersion, notifyDataChanged } from '../hooks/useAsyncData'
import {
  addToShoppingList,
  getOrCreateProduct,
  listShoppingItems,
  receiveDelivery,
  removeShoppingItem,
  toggleShoppingChecked,
} from '../db/operations'

export function ShoppingPage() {
  const version = useDataVersion()
  const loader = useCallback(() => listShoppingItems(), [])
  const { data: items } = useAsyncData(loader, version)

  const checkedCount = items?.filter((i) => i.checked).length ?? 0
  const totalCount = items?.length ?? 0

  async function handleAdd(name: string) {
    const product = await getOrCreateProduct(name)
    await addToShoppingList(product.id)
    notifyDataChanged()
  }

  async function handleToggle(id: string, checked: boolean) {
    await toggleShoppingChecked(id, checked)
    notifyDataChanged()
  }

  async function handleRemove(id: string) {
    await removeShoppingItem(id)
    notifyDataChanged()
  }

  async function handleDelivery(onlyChecked: boolean) {
    const count = await receiveDelivery({ onlyChecked })
    if (count > 0) notifyDataChanged()
  }

  return (
    <section className="page">
      <div className="page__intro">
        <h2 className="page__heading">Shopping list</h2>
        <p className="page__sub">Things to buy on your next shop or delivery.</p>
      </div>

      <AddProductForm onAdd={handleAdd} placeholder="Milk, bread, eggs…" />

      {totalCount > 0 && (
        <div className="action-bar">
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => void handleDelivery(false)}
          >
            Delivery arrived — add all to stock
          </button>
          {checkedCount > 0 && (
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => void handleDelivery(true)}
            >
              Add {checkedCount} checked to stock
            </button>
          )}
        </div>
      )}

      {!items ? (
        <p className="loading">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon="🛒"
          title="Your list is empty"
          hint="Add items above or pick from favourites."
        />
      ) : (
        <ul className="item-list">
          {items.map((item) => (
            <li key={item.id} className={`item-row ${item.checked ? 'item-row--checked' : ''}`}>
              <label className="item-row__check">
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={(e) => void handleToggle(item.id, e.target.checked)}
                />
                <span className="item-row__name">{item.product.name}</span>
              </label>
              <button
                type="button"
                className="btn btn--icon"
                aria-label={`Remove ${item.product.name}`}
                onClick={() => void handleRemove(item.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

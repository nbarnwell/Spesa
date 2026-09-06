import { useCallback } from 'react'
import { AddProductForm } from '../components/AddProductForm'
import { EmptyState } from '../components/EmptyState'
import { useAuth } from '../auth/AuthProvider'
import { useAsyncData, useDataVersion, notifyDataChanged } from '../hooks/useAsyncData'
import {
  addFavourite,
  addToShoppingList,
  getOrCreateProduct,
  listFavourites,
  removeFavourite,
} from '../db/operations'

export function FavouritesPage() {
  const { user, signIn, isConfigured } = useAuth()
  const version = useDataVersion()
  const loader = useCallback(() => listFavourites(), [])
  const { data: favourites } = useAsyncData(loader, version)

  async function handleAdd(name: string) {
    const product = await getOrCreateProduct(name)
    await addFavourite(product.id)
    notifyDataChanged()
  }

  async function handleAddToList(productId: string) {
    await addToShoppingList(productId)
    notifyDataChanged()
  }

  async function handleRemove(favouriteId: string) {
    await removeFavourite(favouriteId)
    notifyDataChanged()
  }

  if (isConfigured && !user) {
    return (
      <section className="page">
        <div className="sign-in-card">
          <h2 className="page__heading">Favourites</h2>
          <p className="page__sub">
            Sign in to save your usual groceries. The app works offline either way — favourites
            sync when you are online and signed in.
          </p>
          <button type="button" className="btn btn--primary btn--block" onClick={() => void signIn()}>
            Sign in with Google
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="page">
      <div className="page__intro">
        <h2 className="page__heading">Favourites</h2>
        <p className="page__sub">Tap to add to your shopping list. Quick restock from here.</p>
      </div>

      <AddProductForm onAdd={handleAdd} placeholder="Save a regular item…" submitLabel="Save" />

      {!favourites ? (
        <p className="loading">Loading…</p>
      ) : favourites.length === 0 ? (
        <EmptyState
          icon="⭐"
          title="No favourites yet"
          hint="Add products you buy often for one-tap shopping."
        />
      ) : (
        <ul className="item-list">
          {favourites.map((fav) => (
            <li key={fav.id} className="item-row item-row--fav">
              <button
                type="button"
                className="item-row__tap"
                onClick={() => void handleAddToList(fav.productId)}
              >
                <span className="item-row__name">{fav.product.name}</span>
                <span className="item-row__action">+ list</span>
              </button>
              <button
                type="button"
                className="btn btn--icon"
                aria-label={`Remove ${fav.product.name} from favourites`}
                onClick={() => void handleRemove(fav.id)}
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

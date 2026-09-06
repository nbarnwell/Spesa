import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useHousehold } from '../household/HouseholdProvider'
import { createHousehold } from '../api/client'

interface HouseholdSwitcherProps {
  onManage: () => void
}

export function HouseholdSwitcher({ onManage }: HouseholdSwitcherProps) {
  const { accessToken } = useAuth()
  const { activeHouseholdId, households, switchHousehold, refreshHouseholds } = useHousehold()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [migrateData, setMigrateData] = useState(true)
  const [busy, setBusy] = useState(false)

  if (households.length === 0) return null

  const active = households.find((h) => h.id === activeHouseholdId)

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!accessToken || !newName.trim()) return
    setBusy(true)
    try {
      const household = await createHousehold(accessToken, newName.trim(), migrateData)
      await refreshHouseholds()
      switchHousehold(household.id)
      setCreating(false)
      setNewName('')
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="household-switcher">
      <button
        type="button"
        className="household-switcher__trigger"
        onClick={() => setOpen((o) => !o)}
      >
        {active?.name ?? 'Household'} ▾
      </button>

      {open && (
        <div className="household-switcher__menu" role="menu">
          {households.length > 1 &&
            households.map((h) => (
              <button
                key={h.id}
                type="button"
                role="menuitem"
                className={`household-switcher__item ${
                  h.id === activeHouseholdId ? 'household-switcher__item--active' : ''
                }`}
                onClick={() => {
                  switchHousehold(h.id)
                  setOpen(false)
                }}
              >
                {h.name}
              </button>
            ))}
          {households.length > 1 && <div className="household-switcher__divider" />}
          <button
            type="button"
            role="menuitem"
            className="household-switcher__item"
            onClick={() => {
              onManage()
              setOpen(false)
            }}
          >
            Manage household
          </button>
          <button
            type="button"
            role="menuitem"
            className="household-switcher__item"
            onClick={() => setCreating(true)}
          >
            + Create household
          </button>
        </div>
      )}

      {creating && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setCreating(false)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-household-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="create-household-title" className="dialog__title">
              Create household
            </h2>
            <form onSubmit={(e) => void handleCreate(e)}>
              <input
                className="add-form__input"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Household name"
                autoFocus
              />
              <label className="invite-prompt__checkbox">
                <input
                  type="checkbox"
                  checked={migrateData}
                  onChange={(e) => setMigrateData(e.target.checked)}
                />
                Move my current list, stock and favourites into it
              </label>
              <div className="dialog__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={busy || !newName.trim()}
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

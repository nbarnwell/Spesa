import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useHousehold } from '../household/HouseholdProvider'
import { acceptInvite, listMyInvites, revokeOrDeclineInvite } from '../api/client'
import type { InviteSummary } from '../api/contract'
import { notifyDataChanged } from '../hooks/useAsyncData'

export function InvitePrompt() {
  const { accessToken } = useAuth()
  const { refreshHouseholds, switchHousehold } = useHousehold()
  const [invites, setInvites] = useState<InviteSummary[]>([])
  const [migrateChoice, setMigrateChoice] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    void listMyInvites(accessToken)
      .then((list) => {
        if (!cancelled) setInvites(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [accessToken])

  const current = invites[0]
  if (!accessToken || !current) return null

  async function handleAccept() {
    if (!accessToken || !current) return
    setBusy(true)
    try {
      const { householdId } = await acceptInvite(accessToken, current.id, migrateChoice)
      await refreshHouseholds()
      switchHousehold(householdId)
      notifyDataChanged()
      setInvites((prev) => prev.slice(1))
      setMigrateChoice(false)
    } finally {
      setBusy(false)
    }
  }

  async function handleDecline() {
    if (!accessToken || !current) return
    setBusy(true)
    try {
      await revokeOrDeclineInvite(accessToken, current.id)
      setInvites((prev) => prev.slice(1))
      setMigrateChoice(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="invite-title">
        <h2 id="invite-title" className="dialog__title">
          Join {current.householdName}?
        </h2>
        <p className="dialog__message">You've been invited to join &ldquo;{current.householdName}&rdquo;.</p>
        <label className="invite-prompt__checkbox">
          <input
            type="checkbox"
            checked={migrateChoice}
            onChange={(e) => setMigrateChoice(e.target.checked)}
          />
          Move my existing list, stock and favourites into this household
        </label>
        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => void handleDecline()}
          >
            Decline
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => void handleAccept()}
          >
            Join
          </button>
        </div>
      </div>
    </div>
  )
}

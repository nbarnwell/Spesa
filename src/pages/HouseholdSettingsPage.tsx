import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useHousehold } from '../household/HouseholdProvider'
import {
  createInvite,
  listHouseholdInvites,
  listMembers,
  removeMember,
  renameHousehold,
  revokeOrDeclineInvite,
  setMemberRole,
} from '../api/client'
import type { HouseholdRole, InviteSummary, MemberSummary } from '../api/contract'
import { notifyDataChanged } from '../hooks/useAsyncData'
import type { HouseholdRecord } from '../types'

interface HouseholdSettingsPageProps {
  onClose: () => void
}

export function HouseholdSettingsPage({ onClose }: HouseholdSettingsPageProps) {
  const { households, activeHouseholdId } = useHousehold()
  const household = households.find((h) => h.id === activeHouseholdId)

  return (
    <section className="page">
      <div className="page__intro">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
          ← Back
        </button>
        <h2 className="page__heading">Household settings</h2>
      </div>

      {household ? (
        <HouseholdSettingsContent key={household.id} household={household} />
      ) : (
        <p className="loading">Loading…</p>
      )}
    </section>
  )
}

function HouseholdSettingsContent({ household }: { household: HouseholdRecord }) {
  const { user, accessToken } = useAuth()
  const { refreshHouseholds } = useHousehold()

  const [members, setMembers] = useState<MemberSummary[]>([])
  const [invites, setInvites] = useState<InviteSummary[]>([])
  const [name, setName] = useState(household.name)
  const [inviteEmail, setInviteEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canManage = household.role === 'owner' || household.role === 'admin'
  const isOwner = household.role === 'owner'

  const reload = useCallback(async () => {
    if (!accessToken) return
    const [memberList, inviteList] = await Promise.all([
      listMembers(accessToken, household.id),
      canManage ? listHouseholdInvites(accessToken, household.id) : Promise.resolve([]),
    ])
    setMembers(memberList)
    setInvites(inviteList)
  }, [accessToken, household.id, canManage])

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false

    Promise.all([
      listMembers(accessToken, household.id),
      canManage ? listHouseholdInvites(accessToken, household.id) : Promise.resolve([]),
    ])
      .then(([memberList, inviteList]) => {
        if (cancelled) return
        setMembers(memberList)
        setInvites(inviteList)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [accessToken, household.id, canManage])

  async function handleRename(e: FormEvent) {
    e.preventDefault()
    if (!accessToken || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      await renameHousehold(accessToken, household.id, name.trim())
      await refreshHouseholds()
    } catch {
      setError('Could not rename household')
    } finally {
      setBusy(false)
    }
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    if (!accessToken || !inviteEmail.trim()) return
    setBusy(true)
    setError(null)
    try {
      await createInvite(accessToken, household.id, inviteEmail.trim())
      setInviteEmail('')
      await reload()
    } catch {
      setError('Could not send invite')
    } finally {
      setBusy(false)
    }
  }

  async function handleRoleChange(userSub: string, nextRole: HouseholdRole) {
    if (!accessToken) return
    setBusy(true)
    setError(null)
    try {
      await setMemberRole(accessToken, household.id, userSub, nextRole)
      await reload()
    } catch {
      setError('Could not change role')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoveMember(userSub: string) {
    if (!accessToken) return
    setBusy(true)
    setError(null)
    try {
      await removeMember(accessToken, household.id, userSub)
      await reload()
      notifyDataChanged()
    } catch {
      setError('Could not remove member')
    } finally {
      setBusy(false)
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    if (!accessToken) return
    setBusy(true)
    setError(null)
    try {
      await revokeOrDeclineInvite(accessToken, inviteId)
      await reload()
    } catch {
      setError('Could not revoke invite')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {error && <p className="page__sub">{error}</p>}

      <form className="add-form" onSubmit={(e) => void handleRename(e)}>
        <input
          className="add-form__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canManage || busy}
        />
        {canManage && (
          <button type="submit" className="btn btn--primary" disabled={busy || !name.trim()}>
            Rename
          </button>
        )}
      </form>

      <h3 className="page__heading">Members</h3>
      <ul className="item-list">
        {members.map((m) => {
          const isSelf = m.userSub === user?.profile.sub
          return (
            <li key={m.userSub} className="item-row">
              <span className="item-row__name">
                {m.name ?? m.email} <span className="header__muted">({m.role})</span>
              </span>
              <div className="item-row__actions">
                {isOwner && !isSelf && m.role !== 'owner' && (
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    disabled={busy}
                    onClick={() =>
                      void handleRoleChange(m.userSub, m.role === 'member' ? 'admin' : 'member')
                    }
                  >
                    {m.role === 'member' ? 'Make admin' : 'Make member'}
                  </button>
                )}
                {canManage && !isSelf && m.role !== 'owner' && (
                  <button
                    type="button"
                    className="btn btn--icon"
                    aria-label={`Remove ${m.email}`}
                    disabled={busy}
                    onClick={() => void handleRemoveMember(m.userSub)}
                  >
                    ×
                  </button>
                )}
                {isSelf && m.role !== 'owner' && (
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    disabled={busy}
                    onClick={() => void handleRemoveMember(m.userSub)}
                  >
                    Leave
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {canManage && (
        <>
          <h3 className="page__heading">Invite someone</h3>
          <form className="add-form" onSubmit={(e) => void handleInvite(e)}>
            <input
              className="add-form__input"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="email@example.com"
              disabled={busy}
            />
            <button type="submit" className="btn btn--primary" disabled={busy || !inviteEmail.trim()}>
              Invite
            </button>
          </form>

          {invites.length > 0 && (
            <>
              <h3 className="page__heading">Pending invites</h3>
              <ul className="item-list">
                {invites.map((invite) => (
                  <li key={invite.id} className="item-row">
                    <span className="item-row__name">{invite.email}</span>
                    <button
                      type="button"
                      className="btn btn--icon"
                      aria-label={`Revoke invite to ${invite.email}`}
                      disabled={busy}
                      onClick={() => void handleRevokeInvite(invite.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </>
  )
}

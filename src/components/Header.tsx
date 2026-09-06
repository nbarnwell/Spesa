import { useAuth } from '../auth/AuthProvider'
import { HouseholdSwitcher } from './HouseholdSwitcher'

interface HeaderProps {
  onManageHousehold: () => void
}

export function Header({ onManageHousehold }: HeaderProps) {
  const { user, isConfigured, signIn, signOut, isLoading } = useAuth()

  return (
    <header className="header">
      <div className="header__brand">
        <span className="header__logo" aria-hidden>
          🥬
        </span>
        <h1 className="header__title">Spesa</h1>
      </div>
      <div className="header__auth">
        {isLoading ? (
          <span className="header__muted">…</span>
        ) : user ? (
          <>
            <HouseholdSwitcher onManage={onManageHousehold} />
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void signOut()}>
              Sign out
            </button>
          </>
        ) : isConfigured ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void signIn()}>
            Sign in
          </button>
        ) : (
          <span className="header__muted" title="Set VITE_OIDC_CLIENT_ID in .env">
            Offline
          </span>
        )}
      </div>
    </header>
  )
}

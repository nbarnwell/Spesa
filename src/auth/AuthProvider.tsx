import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { User } from 'oidc-client-ts'
import { completeSignIn, isOidcConfigured, signIn, signOut, userManager } from './oidc'
import { fullSync } from '../api/sync'
import { subscribeDataChanged } from '../hooks/useAsyncData'

const POLL_INTERVAL_MS = 20_000
const DEBOUNCE_MS = 1_500

interface AuthContextValue {
  user: User | null
  isLoading: boolean
  isConfigured: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  accessToken: string | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const configured = isOidcConfigured()
  const userRef = useRef<User | null>(null)
  const syncInFlightRef = useRef(false)

  useEffect(() => {
    userRef.current = user
  }, [user])

  const syncAfterLogin = useCallback(async (u: User) => {
    if (!u.access_token) return
    try {
      await fullSync(u.access_token)
    } catch {
      // Offline or BFF unavailable — local data remains source of truth
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function init() {
      if (!configured) {
        setIsLoading(false)
        return
      }

      const path = window.location.pathname
      if (path === '/auth/callback') {
        try {
          await completeSignIn()
          window.history.replaceState({}, '', '/')
        } catch (err) {
          console.error('Sign-in callback failed', err)
          window.history.replaceState({}, '', '/')
        }
      }

      const current = await userManager.getUser()
      if (!cancelled) {
        setUser(current)
        setIsLoading(false)
        if (current && !current.expired) {
          void syncAfterLogin(current)
        }
      }
    }

    void init()

    const onLoaded = (u: User) => {
      setUser(u)
      void syncAfterLogin(u)
    }
    const onUnloaded = () => setUser(null)

    userManager.events.addUserLoaded(onLoaded)
    userManager.events.addUserUnloaded(onUnloaded)

    return () => {
      cancelled = true
      userManager.events.removeUserLoaded(onLoaded)
      userManager.events.removeUserUnloaded(onUnloaded)
    }
  }, [configured, syncAfterLogin])

  useEffect(() => {
    if (!user?.access_token || user.expired) return

    const runSync = () => {
      // Read the ref, not the closed-over `user`, so a token refreshed via
      // automaticSilentRenew doesn't leave the interval/visibility handlers
      // syncing with a stale (possibly expired) access token.
      const current = userRef.current
      if (!current?.access_token || current.expired) return
      if (document.hidden || !navigator.onLine) return
      if (syncInFlightRef.current) return

      syncInFlightRef.current = true
      void fullSync(current.access_token)
        .catch(() => {})
        .finally(() => {
          syncInFlightRef.current = false
        })
    }

    let debounceTimer: ReturnType<typeof setTimeout> | undefined
    const scheduleSync = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(runSync, DEBOUNCE_MS)
    }

    const unsubscribe = subscribeDataChanged(scheduleSync)
    const pollInterval = setInterval(runSync, POLL_INTERVAL_MS)

    const onVisibilityChange = () => {
      if (!document.hidden) runSync()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      unsubscribe()
      if (debounceTimer) clearTimeout(debounceTimer)
      clearInterval(pollInterval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [user])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isConfigured: configured,
      signIn: async () => {
        if (!configured) return
        await signIn()
      },
      signOut: async () => {
        await signOut()
        setUser(null)
      },
      accessToken: user && !user.expired ? user.access_token : null,
    }),
    [user, isLoading, configured],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// Hook intentionally colocated with its provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

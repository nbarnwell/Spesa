import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { User } from 'oidc-client-ts'
import { completeSignIn, isOidcConfigured, signIn, signOut, userManager } from './oidc'
import { fullSync } from '../api/sync'
import { subscribeDataChanged } from '../hooks/useAsyncData'

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
        } catch {
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

    let timer: ReturnType<typeof setTimeout> | undefined
    const scheduleSync = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void fullSync(user.access_token).catch(() => {})
      }, 1500)
    }

    const unsubscribe = subscribeDataChanged(scheduleSync)
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
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

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

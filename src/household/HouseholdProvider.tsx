import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '../auth/AuthProvider'
import { getMe } from '../api/client'
import { db, reconcileLocalHousehold } from '../db/database'
import { notifyDataChanged } from '../hooks/useAsyncData'
import { LOCAL_HOUSEHOLD_ID, type HouseholdRecord } from '../types'
import { getActiveHouseholdId, setActiveHouseholdId, subscribeActiveHousehold } from './activeHousehold'

interface HouseholdContextValue {
  activeHouseholdId: string
  households: HouseholdRecord[]
  switchHousehold: (id: string) => void
  refreshHouseholds: () => Promise<void>
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null)

function storageKey(userSub: string): string {
  return `spesa:activeHousehold:${userSub}`
}

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { user, accessToken } = useAuth()
  const [activeId, setActiveId] = useState(getActiveHouseholdId())
  const [households, setHouseholds] = useState<HouseholdRecord[]>([])

  useEffect(() => subscribeActiveHousehold(setActiveId), [])

  useEffect(() => {
    void db.households.toArray().then(setHouseholds)
  }, [])

  const applyHouseholds = useCallback(
    async (list: HouseholdRecord[], preferredId?: string): Promise<void> => {
      setHouseholds(list)
      await db.households.clear()
      await db.households.bulkPut(list)

      const sub = user?.profile.sub
      const storedId = sub ? window.localStorage.getItem(storageKey(sub)) : null
      const candidate = preferredId ?? storedId ?? list[0]?.id
      const validId = candidate && list.some((h) => h.id === candidate) ? candidate : list[0]?.id

      if (validId) {
        setActiveHouseholdId(validId)
        if (sub) window.localStorage.setItem(storageKey(sub), validId)
      }
    },
    [user],
  )

  useEffect(() => {
    if (!accessToken) return

    void (async () => {
      try {
        const profile = await getMe(accessToken)
        const records: HouseholdRecord[] = profile.households.map((h) => ({
          id: h.id,
          name: h.name,
          role: h.role,
        }))
        const wasLocal = getActiveHouseholdId() === LOCAL_HOUSEHOLD_ID
        await applyHouseholds(records, profile.activeHouseholdId)
        if (wasLocal) {
          await reconcileLocalHousehold(getActiveHouseholdId())
          notifyDataChanged()
        }
      } catch {
        // Offline or BFF unavailable — keep working from whatever is cached locally.
      }
    })()
  }, [accessToken, applyHouseholds])

  const switchHousehold = useCallback(
    (id: string) => {
      if (!households.some((h) => h.id === id)) return
      setActiveHouseholdId(id)
      const sub = user?.profile.sub
      if (sub) window.localStorage.setItem(storageKey(sub), id)
      notifyDataChanged()
    },
    [households, user],
  )

  const refreshHouseholds = useCallback(async () => {
    if (!accessToken) return
    const profile = await getMe(accessToken)
    await applyHouseholds(
      profile.households.map((h) => ({ id: h.id, name: h.name, role: h.role })),
      getActiveHouseholdId(),
    )
  }, [accessToken, applyHouseholds])

  const value = useMemo<HouseholdContextValue>(
    () => ({ activeHouseholdId: activeId, households, switchHousehold, refreshHouseholds }),
    [activeId, households, switchHousehold, refreshHouseholds],
  )

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>
}

// Hook intentionally colocated with its provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useHousehold(): HouseholdContextValue {
  const ctx = useContext(HouseholdContext)
  if (!ctx) throw new Error('useHousehold must be used within HouseholdProvider')
  return ctx
}

import { LOCAL_HOUSEHOLD_ID } from '../types'

let activeHouseholdId: string = LOCAL_HOUSEHOLD_ID
const listeners = new Set<(id: string) => void>()

/** Read outside React (e.g. from src/db/operations.ts) without a context dependency. */
export function getActiveHouseholdId(): string {
  return activeHouseholdId
}

export function setActiveHouseholdId(id: string): void {
  if (id === activeHouseholdId) return
  activeHouseholdId = id
  listeners.forEach((listener) => listener(id))
}

export function subscribeActiveHousehold(listener: (id: string) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

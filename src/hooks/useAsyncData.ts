import { useCallback, useEffect, useState } from 'react'

let refreshCounter = 0
const listeners = new Set<() => void>()

export function notifyDataChanged(): void {
  refreshCounter += 1
  listeners.forEach((l) => l())
}

export function subscribeDataChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useDataVersion(): number {
  const [version, setVersion] = useState(refreshCounter)

  useEffect(() => {
    const bump = () => setVersion(refreshCounter)
    listeners.add(bump)
    return () => {
      listeners.delete(bump)
    }
  }, [])

  return version
}

export function useAsyncData<T>(loader: () => Promise<T>, version: number): {
  data: T | undefined
  reload: () => void
} {
  const [data, setData] = useState<T>()

  const reload = useCallback(() => {
    notifyDataChanged()
  }, [])

  useEffect(() => {
    let cancelled = false
    void loader().then((result) => {
      if (!cancelled) setData(result)
    })
    return () => {
      cancelled = true
    }
  }, [loader, version])

  return { data, reload }
}

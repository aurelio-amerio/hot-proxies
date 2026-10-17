import { useCallback, useState } from 'react'
import type { Store } from '../core/art/preference'

export type Mode = 'card' | 'deck' | 'tokens'
export const MODES: readonly Mode[] = ['card', 'deck', 'tokens']
export const MODE_KEY = 'hot-proxies.mode.v1'

function load(store: Store): Mode {
  try {
    const v: unknown = JSON.parse(store.getItem(MODE_KEY) ?? 'null')
    return (MODES as readonly unknown[]).includes(v) ? (v as Mode) : 'card'
  } catch { return 'card' }
}

/** Which panel is shown: single card, deck or tokens. Persisted so a reload lands where the user was. */
export function useMode(store: Store): [Mode, (m: Mode) => void] {
  const [mode, setModeState] = useState<Mode>(() => load(store))
  const setMode = useCallback((m: Mode) => {
    setModeState(m)
    try { store.setItem(MODE_KEY, JSON.stringify(m)) } catch { /* storage full or disabled: keep in memory */ }
  }, [store])
  return [mode, setMode]
}

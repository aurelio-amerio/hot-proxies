import { useCallback, useState } from 'react'

export type Mode = 'card' | 'deck'
export const MODE_KEY = 'hot-proxies.mode.v1'
type Store = Pick<Storage, 'getItem' | 'setItem'>

function load(store: Store): Mode {
  try { return JSON.parse(store.getItem(MODE_KEY) ?? 'null') === 'deck' ? 'deck' : 'card' } catch { return 'card' }
}

/** Which panel is shown: single card or deck. Persisted so a reload lands where the user was. */
export function useMode(store: Store): [Mode, (m: Mode) => void] {
  const [mode, setModeState] = useState<Mode>(() => load(store))
  const setMode = useCallback((m: Mode) => {
    setModeState(m)
    try { store.setItem(MODE_KEY, JSON.stringify(m)) } catch { /* storage full or disabled: keep in memory */ }
  }, [store])
  return [mode, setMode]
}

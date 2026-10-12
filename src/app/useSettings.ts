import { useCallback, useState } from 'react'
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../core/settings'

export const SETTINGS_KEY = 'hot-proxies.settings.v1'
type Store = Pick<Storage, 'getItem' | 'setItem'>

function load(store: Store): Settings {
  try { return normalizeSettings(JSON.parse(store.getItem(SETTINGS_KEY) ?? 'null')) } catch { return DEFAULT_SETTINGS }
}

export function useSettings(store: Store): [Settings, (patch: Partial<Settings>) => void, () => void] {
  const [settings, setSettings] = useState<Settings>(() => load(store))
  const save = useCallback((next: Settings) => { setSettings(next); try { store.setItem(SETTINGS_KEY, JSON.stringify(next)) } catch { /* storage full or disabled: keep in memory */ } }, [store])
  const update = useCallback((patch: Partial<Settings>) => save(normalizeSettings({ ...settings, ...patch })), [settings, save])
  const reset = useCallback(() => save(DEFAULT_SETTINGS), [save])
  return [settings, update, reset]
}

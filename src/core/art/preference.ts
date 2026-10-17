/** Which printing's art a card name should use, remembered across Card and Deck mode. */
export const ART_PREF_KEY = 'hot-proxies.art.v1'

/** Structural subset of Web Storage, so core never depends on the DOM Storage type. */
export interface Store {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function read(store: Store): Record<string, string> {
  try {
    const v: unknown = JSON.parse(store.getItem(ART_PREF_KEY) ?? 'null')
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: Record<string, string> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === 'string') out[k] = val
    return out
  } catch { return {} }
}

export function getPreferredArt(store: Store, name: string): string | null {
  const all = read(store)
  return Object.prototype.hasOwnProperty.call(all, name) ? all[name] : null
}

export function setPreferredArt(store: Store, name: string, ref: string | null): void {
  const all = read(store)
  if (ref) all[name] = ref; else delete all[name]
  try { store.setItem(ART_PREF_KEY, JSON.stringify(all)) } catch { /* storage full or disabled */ }
}

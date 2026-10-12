let cached: Promise<string[]> | undefined

/** Lazily fetch public/names.json once. */
export function loadNameIndex(fetchFn: typeof fetch = fetch): Promise<string[]> {
  if (!cached) {
    cached = fetchFn(`${import.meta.env.BASE_URL}names.json`).then((r) => {
      if (!r.ok) throw new Error(`names.json: HTTP ${r.status}`)
      return r.json() as Promise<string[]>
    })
    cached.catch(() => { cached = undefined })
  }
  return cached
}

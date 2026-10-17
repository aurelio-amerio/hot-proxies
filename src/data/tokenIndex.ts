import type { TokenIndex, TokenEntry } from '../core/token/index'

let cached: Promise<TokenIndex> | undefined

/** Lazily fetch public/tokens.json once; a failure clears the cache so the next call retries. */
export function loadTokenIndex(fetchFn: typeof fetch = fetch): Promise<TokenIndex> {
  if (!cached) {
    cached = fetchFn(`${import.meta.env.BASE_URL}tokens.json`).then(async (r) => {
      if (!r.ok) throw new Error(`tokens.json: HTTP ${r.status}`)
      const j = (await r.json()) as Partial<TokenIndex> | null
      if (!j || j.version !== 1 || !Array.isArray(j.tokens)) throw new Error('tokens.json: unexpected format')
      return j as TokenIndex
    })
    cached.catch(() => { cached = undefined })
  }
  return cached
}

export const tokenNames = (index: TokenIndex): string[] => index.tokens.map((t) => t.name)

export function variantsOf(index: TokenIndex, name: string): TokenEntry | undefined {
  return index.tokens.find((t) => t.name === name)
}

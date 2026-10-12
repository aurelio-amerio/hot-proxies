import { ArtUnavailable, CardNotFound, NetworkError } from '../core/errors'

export interface KeyValue {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
}

export function memoryKeyValue(): KeyValue {
  const m = new Map<string, unknown>()
  return { async get<T>(k: string) { return m.get(k) as T | undefined }, async set(k, v) { m.set(k, v) } }
}

export interface ScryfallClient {
  fetchCard(exactName: string): Promise<unknown>
  fetchArtBlob(url: string): Promise<Blob>
}

export interface ScryfallOptions {
  fetchFn?: typeof fetch
  cache: KeyValue
  minIntervalMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const API = 'https://api.scryfall.com'

export function createScryfallClient(o: ScryfallOptions): ScryfallClient {
  const fetchFn = o.fetchFn ?? fetch
  const minInterval = o.minIntervalMs ?? 100
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = o.now ?? (() => Date.now())
  let last = -Infinity
  let queue: Promise<void> = Promise.resolve()

  /** Serialise requests and keep at least minInterval between them. */
  const throttled = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      const wait = last + minInterval - now()
      if (wait > 0) await sleep(wait)
      last = now()
      return fn()
    })
    queue = run.then(() => undefined, () => undefined)
    return run
  }

  const get = async (url: string, init?: RequestInit): Promise<Response> => {
    try { return await fetchFn(url, init) } catch { throw new NetworkError() }
  }

  return {
    async fetchCard(exactName) {
      const key = `card:${exactName}`
      const hit = await o.cache.get<unknown>(key)
      if (hit) return hit
      const url = `${API}/cards/named?exact=${encodeURIComponent(exactName)}`
      const init = { headers: { Accept: 'application/json' } }
      let res = await throttled(() => get(url, init))
      if (res.status === 429) { await sleep(1000); res = await throttled(() => get(url, init)) }
      if (res.status === 404) throw new CardNotFound(exactName)
      if (!res.ok) throw new NetworkError(`Scryfall responded with HTTP ${res.status}.`)
      const card: unknown = await res.json()
      await o.cache.set(key, card)
      return card
    },
    async fetchArtBlob(url) {
      const key = `art:${url}`
      const hit = await o.cache.get<Blob>(key)
      if (hit) return hit
      let res: Response
      try { res = await throttled(() => fetchFn(url)) } catch { throw new ArtUnavailable() }
      if (!res.ok) throw new ArtUnavailable()
      const blob = await res.blob()
      await o.cache.set(key, blob)
      return blob
    },
  }
}

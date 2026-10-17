import { ArtUnavailable, CardNotFound, NetworkError } from '../core/errors'
import { artRef } from '../core/token/index'
import { parseArtRef, artCropUrl } from './artRef'

export interface KeyValue {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
}

export function memoryKeyValue(): KeyValue {
  const m = new Map<string, unknown>()
  return { async get<T>(k: string) { return m.get(k) as T | undefined }, async set(k, v) { m.set(k, v) } }
}

export interface Printing { ref: string; artUrl: string; set: string; released: string }
/** fetchPrints follows at most this many pages (175 printings each). */
export const PRINTS_PAGE_CAP = 5

export interface ScryfallClient {
  fetchCard(exactName: string): Promise<unknown>
  fetchArtBlob(url: string): Promise<Blob>
  /** Every printing of an exact card name that has a front art crop, newest first. 404 means none. */
  fetchPrints(name: string): Promise<Printing[]>
  /** Art crop for an art ref (see data/artRef.ts): direct CDN url first, card JSON as fallback. */
  fetchArtById(ref: string): Promise<Blob>
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

  type Raw = Record<string, unknown>
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  const init = { headers: { Accept: 'application/json' } }
  /** Throttled GET with one retry after 1 s on 429. */
  const request = async (url: string): Promise<Response> => {
    let res = await throttled(() => get(url, init))
    if (res.status === 429) { await sleep(1000); res = await throttled(() => get(url, init)) }
    return res
  }
  const printingOf = (c: Raw): Printing | null => {
    const faces = Array.isArray(c.card_faces) ? (c.card_faces as Raw[]) : undefined
    const uris = (c.image_uris ?? faces?.[0]?.image_uris) as Raw | undefined
    const id = str(c.id), art = str(uris?.art_crop)
    if (!id || !art) return null
    return { ref: artRef(id, 0), artUrl: art, set: str(c.set) ?? '', released: str(c.released_at) ?? '' }
  }
  /** fetch that maps any failure to ArtUnavailable (images, and the JSON fallback that serves them). */
  const fetchForArt = async (url: string, reqInit?: RequestInit): Promise<Response> => {
    try { return await throttled(() => fetchFn(url, reqInit)) } catch { throw new ArtUnavailable() }
  }

  return {
    async fetchCard(exactName) {
      const key = `card:${exactName}`
      const hit = await o.cache.get<unknown>(key)
      if (hit) return hit
      const res = await request(`${API}/cards/named?exact=${encodeURIComponent(exactName)}`)
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
      const res = await fetchForArt(url)
      if (!res.ok) throw new ArtUnavailable()
      const blob = await res.blob()
      await o.cache.set(key, blob)
      return blob
    },
    async fetchPrints(name) {
      const key = `prints:${name}`
      const hit = await o.cache.get<Printing[]>(key)
      if (hit) return hit
      const out: Printing[] = []
      let url: string | undefined = `${API}/cards/search?q=${encodeURIComponent(`!"${name}"`)}&unique=prints&order=released&dir=desc`
      for (let page = 0; url && page < PRINTS_PAGE_CAP; page++) {
        const res = await request(url)
        if (res.status === 404) break
        if (!res.ok) throw new NetworkError(`Scryfall responded with HTTP ${res.status}.`)
        const body = (await res.json()) as { data?: Raw[]; has_more?: boolean; next_page?: string }
        for (const c of body.data ?? []) { const p = printingOf(c); if (p) out.push(p) }
        url = body.has_more && body.next_page ? body.next_page : undefined
      }
      await o.cache.set(key, out)
      return out
    },
    async fetchArtById(ref) {
      const key = `art:${ref}`
      const hit = await o.cache.get<Blob>(key)
      if (hit) return hit
      const parsed = parseArtRef(ref), direct = artCropUrl(ref)
      if (!parsed || !direct) throw new ArtUnavailable()
      let res = await fetchForArt(direct)
      if (res.status === 404) {
        const cardRes = await fetchForArt(`${API}/cards/${parsed.uuid}`, init)
        if (!cardRes.ok) throw new ArtUnavailable()
        const raw = (await cardRes.json()) as Raw
        const faces = Array.isArray(raw.card_faces) ? (raw.card_faces as Raw[]) : undefined
        const uris = (parsed.face === 1 ? faces?.[1]?.image_uris : raw.image_uris ?? faces?.[0]?.image_uris) as Raw | undefined
        const url = str(uris?.art_crop)
        if (!url) throw new ArtUnavailable()
        res = await fetchForArt(url)
      }
      if (!res.ok) throw new ArtUnavailable()
      const blob = await res.blob()
      await o.cache.set(key, blob)
      return blob
    },
  }
}

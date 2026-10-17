/** Scryfall search -> public/tokens.json (names, rule variants, art refs of every token and emblem printing).
 *  Run: npm run build:tokens */
import { writeFileSync } from 'node:fs'
import { tokenIndexFromCards, type TokenIndex } from '../src/core/token/index'

export const TOKEN_QUERY = '(st:token or layout:emblem) -st:memorabilia -is:playtest'
const FIRST_PAGE = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(TOKEN_QUERY)}&unique=prints`
const MIN_INTERVAL_MS = 100

export interface FetchOptions { fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void>; log?: (line: string) => void }

/** Every raw card the query matches, following next_page with at least 100 ms between requests. */
export async function fetchTokenCards(o: FetchOptions = {}): Promise<unknown[]> {
  const fetchFn = o.fetchFn ?? fetch
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
  const out: unknown[] = []
  let url: string | undefined = FIRST_PAGE
  let page = 0
  while (url) {
    if (page > 0) await sleep(MIN_INTERVAL_MS)
    const res = await fetchFn(url, { headers: { Accept: 'application/json', 'User-Agent': 'hot-proxies/0.1 (token index build)' } })
    if (res.status === 404) break
    if (!res.ok) throw new Error(`Scryfall responded with HTTP ${res.status} for ${url}`)
    const body = (await res.json()) as { data?: unknown[]; has_more?: boolean; next_page?: string }
    out.push(...(body.data ?? []))
    page++
    o.log?.(`page ${page}: ${out.length} cards`)
    url = body.has_more && body.next_page ? body.next_page : undefined
  }
  return out
}

export async function buildTokenIndex(outputPath: string, o: FetchOptions = {}): Promise<TokenIndex> {
  const index = tokenIndexFromCards(await fetchTokenCards(o))
  writeFileSync(outputPath, JSON.stringify(index))
  return index
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[\\/]/, ''))
if (isMain) {
  buildTokenIndex('public/tokens.json', { log: console.log }).then((i) => {
    const variants = i.tokens.reduce((a, t) => a + t.variants.length, 0)
    const prints = i.tokens.reduce((a, t) => a + t.variants.reduce((b, v) => b + v.prints.length, 0), 0)
    console.log(`wrote ${i.tokens.length} names, ${variants} variants, ${prints} printings to public/tokens.json`)
  }).catch((e) => { console.error(e); process.exit(1) })
}

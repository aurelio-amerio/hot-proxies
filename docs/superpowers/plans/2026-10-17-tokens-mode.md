# Tokens Mode and Art Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Tokens mode (token index, editable token draft, hotspot editing on the preview, copies printing) and an art picker shared with Card mode whose choice Deck mode honours.

**Architecture:** A build script turns Scryfall search results into `public/tokens.json`; pure core modules (`core/token/*`, `core/art/preference.ts`) hold the index shape, the editable draft and the hotspot rects; the Scryfall client gains `fetchPrints` and `fetchArtById`; React gets `useTokens`, `TokensPanel`, `EditablePreview`, `FieldDialog` and `ArtPickerDialog`, all wired through `Services`. Rendering (`renderProxy`, fit, paint) is untouched.

**Tech Stack:** TypeScript, React 19, MUI 9, Vite, Vitest (node + jsdom), `@napi-rs/canvas` in tests, `tsx` for scripts.

**Spec:** `docs/superpowers/specs/2026-10-17-tokens-mode-design.md`

## Global Constraints

- `src/core/` is framework-free TypeScript and never touches the DOM; drawing goes through `Ctx2D` from `core/env.ts`.
- Everything external enters the UI through the `Services` object (`src/app/services.ts`); tests pass fakes (`tests/fakeServices.ts`, `tests/fakePrinter.ts`). Scryfall is never hit in tests.
- `renderProxy(card, art, settings, env)` is the only renderer entry point; no change to `fit`, `paint` or the fit candidates.
- Printing: one `escposInit()` per job, `escposFeed(FEED_LINES_BETWEEN_CARDS)` between cards, `escposFeed(FEED_LINES_AFTER)` after the last; never `ESC @` between cards (it clears the print buffer). All printer writes go through `printJob`.
- Copies range is 1 to 99, default 1.
- Storage keys: `hot-proxies.mode.v1`, `hot-proxies.token.v1`, `hot-proxies.art.v1`. Every storage read is wrapped so corrupt or disabled storage degrades to defaults.
- No hand-written rules text: tokens, emblems and helper cards come from Scryfall data.
- Art refs are the Scryfall id without hyphens (32 hex chars), with a `:1` suffix for a back face.
- Vitest globals are off; UI tests start with `// @vitest-environment jsdom`; tests import from `vitest` explicitly.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A restored draft whose `base.variant` index no longer exists after `tokens.json` was rebuilt must not crash the panel; it should fall back to the first variant for chips and art options. Test in Task 15.
2. Rules text pasted with Windows line endings or trailing blank lines must render as normal paragraphs. Test in Task 3 (`editDraft` normalises `\r\n` and trims).
3. The copies field typed empty or with a huge number must clamp to 1 or 99, never render `NaN` or send zero copies. Test in Task 3.
4. Tapping the bottom-right corner of the rules box must open the stat dialog, not the rules dialog: the stat button must come after the rules button in DOM order so it sits on top. Test in Task 9.
5. A card name containing an apostrophe (Smuggler's Copter) must reach `fetchPrints` URL-encoded intact, or the picker silently shows no printings. Test in Task 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/core/token/index.ts` | `TokenIndex` types, `artRef`, `tokenName`, `faceRecords`, `tokenIndexFromCards`, `variantLabel` (pure) |
| `src/core/token/draft.ts` | `TokenDraft`, patches, `draftFromVariant`, `blankDraft`, `editDraft`, `normalizeDraft` |
| `src/core/token/hotspots.ts` | `hotspotsFor(geometry)` and labels |
| `src/core/art/preference.ts` | art preference per card name over a `Store` |
| `src/data/artRef.ts` | `parseArtRef`, `artCropUrl` |
| `src/data/scryfall.ts` | + `fetchPrints`, `fetchArtById`, shared 429 retry |
| `src/data/tokenIndex.ts` | lazy `loadTokenIndex`, `tokenNames`, `variantsOf` |
| `scripts/build-token-index.ts` | paging fetch + write `public/tokens.json` |
| `src/app/resolveArt.ts` | preferred art first, then the card's own crop (shared by Card and Deck) |
| `src/app/Preview.tsx` | + `overlay` prop |
| `src/app/EditablePreview.tsx` | hotspot buttons over the preview |
| `src/app/FieldDialog.tsx` | name / type / rules / stat dialogs |
| `src/app/ArtPickerDialog.tsx` | scroller of printings |
| `src/app/useTokens.ts` | draft state, persistence, art, render, copies printing |
| `src/app/TokensPanel.tsx` | the Tokens mode view |
| `src/app/useMode.ts`, `ModeSwitch.tsx`, `App.tsx` | third mode, wiring, Card mode art hotspot |
| `src/app/useProxy.ts`, `useDeck.ts` | art preference |
| `tests/fixtures/tokens/raw.json`, `tests/fixtures/tokens/index.json` | script input fixture, hand-written index fixture |

---

### Task 1: Token index core (types, face split, grouping)

**Files:**
- Create: `src/core/token/index.ts`
- Create: `src/core/token/index.test.ts`
- Create: `tests/fixtures/tokens/raw.json`

**Interfaces:**
- Produces:
  - `interface TokenVariant { typeLine: string; oracleText: string; power?: string; toughness?: string; prints: string[] }`
  - `interface TokenEntry { name: string; variants: TokenVariant[] }`
  - `interface TokenIndex { version: 1; tokens: TokenEntry[] }`
  - `artRef(id: string, face: 0 | 1): string`
  - `tokenName(name: string): string`
  - `faceRecords(json: unknown): FaceRecord[]`
  - `tokenIndexFromCards(cards: unknown[]): TokenIndex`
  - `variantLabel(v: TokenVariant): string`

- [ ] **Step 1: Write the raw fixture**

Create `tests/fixtures/tokens/raw.json`:

```json
[
  {"id":"aaaaaaaa-0000-4000-8000-000000000001","name":"Goblin","layout":"token","set_type":"token","released_at":"2023-01-01","type_line":"Token Creature — Goblin","oracle_text":"Haste","power":"1","toughness":"1"},
  {"id":"aaaaaaaa-0000-4000-8000-000000000002","name":"Goblin","layout":"token","set_type":"token","released_at":"2024-06-01","type_line":"Token Creature — Goblin","oracle_text":"Haste","power":"1","toughness":"1"},
  {"id":"aaaaaaaa-0000-4000-8000-000000000003","name":"Goblin","layout":"token","set_type":"token","released_at":"2020-01-01","type_line":"Token Creature — Goblin","power":"1","toughness":"1"},
  {"id":"aaaaaaaa-0000-4000-8000-000000000004","name":"Goblin // Soldier","layout":"double_faced_token","set_type":"token","released_at":"2022-01-01","card_faces":[
    {"name":"Goblin","type_line":"Token Creature — Goblin","power":"1","toughness":"1"},
    {"name":"Soldier","type_line":"Token Creature — Soldier","power":"1","toughness":"1"}]},
  {"id":"aaaaaaaa-0000-4000-8000-000000000005","name":"The Monarch","layout":"token","set_type":"token","released_at":"2016-11-11","type_line":"Card","oracle_text":"At the beginning of your end step, draw a card.\nWhenever a creature deals combat damage to you, its controller becomes the monarch."},
  {"id":"aaaaaaaa-0000-4000-8000-000000000006","name":"Emblem — Ajani, Adversary of Tyrants","layout":"emblem","set_type":"token","released_at":"2018-07-13","type_line":"Emblem — Ajani","oracle_text":"At the beginning of your end step, create a 1/1 white Cat creature token with lifelink."},
  {"id":"aaaaaaaa-0000-4000-8000-000000000007","name":"Goblin // Goblin","layout":"art_series","set_type":"memorabilia","released_at":"2021-01-01","type_line":"Card // Card"},
  {"id":"aaaaaaaa-0000-4000-8000-000000000008","name":"Poison Counter","layout":"token","set_type":"token","released_at":"2023-02-03","type_line":"Card","oracle_text":""},
  {"id":"aaaaaaaa-0000-4000-8000-000000000009","name":"Treasure","layout":"token","set_type":"token","released_at":"2023-09-08","type_line":"Token Artifact — Treasure","oracle_text":"{T}, Sacrifice this artifact: Add one mana of any color."}
]
```

- [ ] **Step 2: Write the failing tests**

Create `src/core/token/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { artRef, tokenName, faceRecords, tokenIndexFromCards, variantLabel } from './index'

const raw = JSON.parse(readFileSync('tests/fixtures/tokens/raw.json', 'utf8')) as unknown[]
const ID = (n: string) => `aaaaaaaa00004000800000000000000${n}`

describe('artRef', () => {
  it('drops hyphens and marks the back face', () => {
    expect(artRef('aaaaaaaa-0000-4000-8000-000000000004', 0)).toBe(ID('4'))
    expect(artRef('aaaaaaaa-0000-4000-8000-000000000004', 1)).toBe(`${ID('4')}:1`)
  })
})

describe('tokenName', () => {
  it('turns "Emblem — X" into "X Emblem" and leaves other names alone', () => {
    expect(tokenName('Emblem — Ajani, Adversary of Tyrants')).toBe('Ajani, Adversary of Tyrants Emblem')
    expect(tokenName('Ajani Resolute Emblem')).toBe('Ajani Resolute Emblem')
    expect(tokenName('Goblin')).toBe('Goblin')
  })
})

describe('faceRecords', () => {
  it('splits a double-faced token into two records with front and back refs', () => {
    const recs = faceRecords(raw[3])
    expect(recs.map((r) => [r.name, r.ref])).toEqual([['Goblin', ID('4')], ['Soldier', `${ID('4')}:1`]])
    expect(recs[0]).toMatchObject({ typeLine: 'Token Creature — Goblin', oracleText: '', power: '1', toughness: '1', released: '2022-01-01' })
  })
  it('skips art series, memorabilia and blank helper cards', () => {
    expect(faceRecords(raw[6])).toEqual([])
    expect(faceRecords(raw[7])).toEqual([])
    expect(faceRecords({ id: 'x', layout: 'token', set_type: 'memorabilia', type_line: 'Card', oracle_text: 'text', name: 'Gift' })).toEqual([])
    expect(faceRecords(null)).toEqual([])
  })
})

describe('tokenIndexFromCards', () => {
  const index = tokenIndexFromCards(raw)
  it('has version 1 and sorted unique names', () => {
    expect(index.version).toBe(1)
    expect(index.tokens.map((t) => t.name)).toEqual(['Ajani, Adversary of Tyrants Emblem', 'Goblin', 'Soldier', 'The Monarch', 'Treasure'])
  })
  it('groups Goblin into two variants, most printed then newest first, prints newest first', () => {
    const goblin = index.tokens.find((t) => t.name === 'Goblin')!
    expect(goblin.variants).toEqual([
      { typeLine: 'Token Creature — Goblin', oracleText: 'Haste', power: '1', toughness: '1', prints: [ID('2'), ID('1')] },
      { typeLine: 'Token Creature — Goblin', oracleText: '', power: '1', toughness: '1', prints: [ID('4'), ID('3')] },
    ])
  })
  it('keeps the back-face ref for Soldier and omits power/toughness for noncreatures', () => {
    expect(index.tokens.find((t) => t.name === 'Soldier')!.variants[0].prints).toEqual([`${ID('4')}:1`])
    const treasure = index.tokens.find((t) => t.name === 'Treasure')!.variants[0]
    expect(treasure).not.toHaveProperty('power')
    expect(treasure.oracleText).toBe('{T}, Sacrifice this artifact: Add one mana of any color.')
  })
})

describe('variantLabel', () => {
  it('shows P/T and the first rules line, cut at 24 characters', () => {
    expect(variantLabel({ typeLine: 'Token Creature — Goblin', oracleText: 'Haste', power: '1', toughness: '1', prints: [] })).toBe('1/1 · Haste')
    expect(variantLabel({ typeLine: 'Token Creature — Goblin', oracleText: '', power: '1', toughness: '1', prints: [] })).toBe('1/1')
    expect(variantLabel({ typeLine: 'Token Artifact — Treasure', oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.', prints: [] })).toBe('{T}, Sacrifice this arti…')
    expect(variantLabel({ typeLine: 'Card', oracleText: '', prints: [] })).toBe('Card')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/core/token/index.test.ts`
Expected: FAIL, cannot resolve `./index`.

- [ ] **Step 4: Implement `src/core/token/index.ts`**

```ts
/** Shape of public/tokens.json and the pure grouping that builds it. */
export interface TokenVariant { typeLine: string; oracleText: string; power?: string; toughness?: string; prints: string[] }
export interface TokenEntry { name: string; variants: TokenVariant[] }
export interface TokenIndex { version: 1; tokens: TokenEntry[] }

/** One face of a raw Scryfall card, as the index sees it. */
export interface FaceRecord { name: string; typeLine: string; oracleText: string; power?: string; toughness?: string; ref: string; released: string }

type Raw = Record<string, unknown>
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** Art ref: the Scryfall id without hyphens, ":1" for the back face. */
export function artRef(id: string, face: 0 | 1): string {
  const hex = id.replace(/-/g, '')
  return face ? `${hex}:1` : hex
}

/** Scryfall mostly names emblems "<planeswalker> Emblem"; fold the "Emblem — X" form into the same shape. */
export function tokenName(name: string): string {
  const m = /^Emblem\s+[—-]\s+(.+)$/.exec(name)
  return m ? `${m[1]} Emblem` : name
}

const SKIP_LAYOUTS = new Set(['art_series'])

/** The faces of one raw card that belong in the index: 0, 1 or 2 records. */
export function faceRecords(json: unknown): FaceRecord[] {
  const raw = (json ?? {}) as Raw
  const id = str(raw.id)
  if (!id || SKIP_LAYOUTS.has(str(raw.layout) ?? '') || str(raw.set_type) === 'memorabilia') return []
  const released = str(raw.released_at) ?? '0000-00-00'
  const faces = Array.isArray(raw.card_faces) && raw.card_faces.length ? (raw.card_faces as Raw[]) : [raw]
  const out: FaceRecord[] = []
  faces.slice(0, 2).forEach((f, i) => {
    const name = str(f.name), typeLine = str(f.type_line)
    if (!name || !typeLine) return
    const oracleText = str(f.oracle_text) ?? ''
    if (typeLine === 'Card' && oracleText === '') return   // punch-out counters and other blanks
    const rec: FaceRecord = { name: tokenName(name), typeLine, oracleText, ref: artRef(id, i as 0 | 1), released }
    const power = str(f.power), toughness = str(f.toughness)
    if (power !== undefined && toughness !== undefined) { rec.power = power; rec.toughness = toughness }
    out.push(rec)
  })
  return out
}

const variantKey = (r: Pick<FaceRecord, 'typeLine' | 'oracleText' | 'power' | 'toughness'>) =>
  [r.typeLine, r.oracleText, r.power ?? '', r.toughness ?? ''].join('\u0000')

/** Group raw cards by name, then by distinct rules. Variants: most printed first, then newest. Prints: newest first. */
export function tokenIndexFromCards(cards: unknown[]): TokenIndex {
  const byName = new Map<string, Map<string, FaceRecord[]>>()
  for (const c of cards) for (const r of faceRecords(c)) {
    let variants = byName.get(r.name)
    if (!variants) { variants = new Map(); byName.set(r.name, variants) }
    const k = variantKey(r)
    const list = variants.get(k)
    if (list) list.push(r); else variants.set(k, [r])
  }
  const tokens: TokenEntry[] = [...byName.entries()].map(([name, variants]) => {
    const built = [...variants.values()].map((recs) => {
      recs.sort((a, b) => b.released.localeCompare(a.released) || a.ref.localeCompare(b.ref))
      const seen = new Set<string>()
      const prints = recs.map((r) => r.ref).filter((ref) => !seen.has(ref) && !!seen.add(ref))
      const first = recs[0]
      const v: TokenVariant = { typeLine: first.typeLine, oracleText: first.oracleText, prints }
      if (first.power !== undefined && first.toughness !== undefined) { v.power = first.power; v.toughness = first.toughness }
      return { v, newest: first.released }
    })
    built.sort((a, b) => b.v.prints.length - a.v.prints.length || b.newest.localeCompare(a.newest) || a.v.typeLine.localeCompare(b.v.typeLine))
    return { name, variants: built.map((b) => b.v) }
  })
  tokens.sort((a, b) => a.name.localeCompare(b.name))
  return { version: 1, tokens }
}

/** Short chip label: "1/1 · Haste", "0/1 · Defender", "1/1"; noncreatures show the first rules line; blanks the type line. */
export function variantLabel(v: TokenVariant): string {
  const pt = v.power !== undefined && v.toughness !== undefined ? `${v.power}/${v.toughness}` : ''
  const first = v.oracleText.split('\n')[0] ?? ''
  const text = first.length > 24 ? `${first.slice(0, 24).trimEnd()}…` : first
  return [pt, text].filter(Boolean).join(' · ') || v.typeLine
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/core/token/index.test.ts`
Expected: PASS (if the Treasure label assertion is off by one character, adjust the expected string to what `slice(0, 24).trimEnd()` yields: `'{T}, Sacrifice this arti…'`).

- [ ] **Step 6: Commit**

```bash
git add src/core/token/index.ts src/core/token/index.test.ts tests/fixtures/tokens/raw.json
git commit -m "feat(core): token index types and grouping from raw Scryfall cards

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Token index build script and `public/tokens.json`

**Files:**
- Create: `scripts/build-token-index.ts`
- Create: `scripts/build-token-index.test.ts`
- Modify: `package.json` (scripts)
- Modify: `vite.config.ts` (`includeAssets`)
- Create (generated): `public/tokens.json`

**Interfaces:**
- Consumes: `tokenIndexFromCards`, `TokenIndex` from `src/core/token/index.ts`
- Produces: `TOKEN_QUERY`, `fetchTokenCards(o?: FetchOptions): Promise<unknown[]>`, `buildTokenIndex(outputPath: string, o?: FetchOptions): Promise<TokenIndex>`

- [ ] **Step 1: Write the failing test**

Create `scripts/build-token-index.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { buildTokenIndex, fetchTokenCards, TOKEN_QUERY } from './build-token-index'
import type { TokenIndex } from '../src/core/token/index'

const raw = JSON.parse(readFileSync('tests/fixtures/tokens/raw.json', 'utf8')) as unknown[]
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('fetchTokenCards', () => {
  it('follows next_page with a pause between requests and concatenates the data', async () => {
    const calls: string[] = []
    const fetchFn = vi.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url))
      return calls.length === 1
        ? json({ data: raw.slice(0, 4), has_more: true, next_page: 'https://api.scryfall.com/cards/search?page=2' })
        : json({ data: raw.slice(4), has_more: false })
    }) as unknown as typeof fetch
    const sleeps: number[] = []
    const cards = await fetchTokenCards({ fetchFn, sleep: async (ms) => { sleeps.push(ms) } })
    expect(cards).toHaveLength(raw.length)
    expect(calls[0]).toBe(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(TOKEN_QUERY)}&unique=prints`)
    expect(calls[1]).toBe('https://api.scryfall.com/cards/search?page=2')
    expect(sleeps).toEqual([100])
  })
  it('treats 404 (no matches) as empty and throws on other errors', async () => {
    const notFound = (async () => json({ object: 'error' }, 404)) as unknown as typeof fetch
    expect(await fetchTokenCards({ fetchFn: notFound, sleep: async () => {} })).toEqual([])
    const broken = (async () => json({}, 500)) as unknown as typeof fetch
    await expect(fetchTokenCards({ fetchFn: broken, sleep: async () => {} })).rejects.toThrow(/HTTP 500/)
  })
})

describe('buildTokenIndex', () => {
  it('writes the grouped index to disk', async () => {
    const out = `${process.env.TMPDIR ?? process.env.TEMP ?? '/tmp'}/tokens-test.json`
    const fetchFn = (async () => json({ data: raw, has_more: false })) as unknown as typeof fetch
    const index = await buildTokenIndex(out, { fetchFn, sleep: async () => {} })
    const onDisk = JSON.parse(readFileSync(out, 'utf8')) as TokenIndex
    rmSync(out)
    expect(onDisk).toEqual(index)
    expect(onDisk.tokens.map((t) => t.name)).toContain('The Monarch')
  })
})

describe('public/tokens.json', () => {
  it('exists, is a version-1 index with hundreds of names, and stays under 2 MB', () => {
    expect(existsSync('public/tokens.json')).toBe(true)
    expect(statSync('public/tokens.json').size).toBeLessThan(2 * 1024 * 1024)
    const index = JSON.parse(readFileSync('public/tokens.json', 'utf8')) as TokenIndex
    expect(index.version).toBe(1)
    expect(index.tokens.length).toBeGreaterThan(500)
    expect(index.tokens.find((t) => t.name === 'Treasure')).toBeDefined()
    expect(index.tokens.find((t) => t.name === 'The Monarch')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run scripts/build-token-index.test.ts`
Expected: FAIL, cannot resolve `./build-token-index`.

- [ ] **Step 3: Implement `scripts/build-token-index.ts`**

```ts
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
    const res = await fetchFn(url, { headers: { Accept: 'application/json' } })
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
  })
}
```

- [ ] **Step 4: Add the npm script and precache the file**

In `package.json` scripts, after `"build:names"`, add:

```json
"build:tokens": "tsx scripts/build-token-index.ts",
```

In `vite.config.ts`, change `includeAssets: ['names.json', 'icons/*.png']` to `includeAssets: ['names.json', 'tokens.json', 'icons/*.png']`.

- [ ] **Step 5: Generate the real index**

Run: `npm run build:tokens`
Expected: about 18 pages logged, then a line like `wrote 9xx names, 1xxx variants, 30xx printings to public/tokens.json`. Check `ls -la public/tokens.json` is well under 2 MB.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run scripts/build-token-index.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-token-index.ts scripts/build-token-index.test.ts package.json vite.config.ts public/tokens.json
git commit -m "feat(scripts): build public/tokens.json from Scryfall token and emblem printings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Token draft (core)

**Files:**
- Create: `src/core/token/draft.ts`
- Create: `src/core/token/draft.test.ts`
- Create: `tests/fixtures/tokens/index.json`

**Interfaces:**
- Consumes: `TokenEntry` from `src/core/token/index.ts`, `CardData` from `src/core/card/types.ts`
- Produces:
  - `COPIES_MIN = 1`, `COPIES_MAX = 99`
  - `interface TokenDraft { base: { name: string; variant: number } | null; card: CardData; artRef: string | null; copies: number }`
  - `type StatPatch = { kind: 'pt'; power: string; toughness: string } | { kind: 'loyalty'; value: string } | { kind: 'none' }`
  - `type DraftPatch = { name: string } | { typeLine: string } | { oracleText: string } | { stat: StatPatch } | { artRef: string | null } | { copies: number }`
  - `draftFromVariant(entry: TokenEntry, variant: number): TokenDraft`
  - `blankDraft(): TokenDraft`
  - `editDraft(d: TokenDraft, p: DraftPatch): TokenDraft`
  - `normalizeDraft(input: unknown): TokenDraft | null`

- [ ] **Step 1: Write the hand-written index fixture**

Create `tests/fixtures/tokens/index.json` (used by every later UI test):

```json
{"version":1,"tokens":[
 {"name":"Goblin","variants":[
  {"typeLine":"Token Creature — Goblin","oracleText":"Haste","power":"1","toughness":"1","prints":["aaaaaaaa000040008000000000000002","aaaaaaaa000040008000000000000001"]},
  {"typeLine":"Token Creature — Goblin","oracleText":"","power":"1","toughness":"1","prints":["aaaaaaaa000040008000000000000004","aaaaaaaa000040008000000000000003"]}]},
 {"name":"Soldier","variants":[
  {"typeLine":"Token Creature — Soldier","oracleText":"","power":"1","toughness":"1","prints":["aaaaaaaa000040008000000000000004:1"]}]},
 {"name":"The Monarch","variants":[
  {"typeLine":"Card","oracleText":"At the beginning of your end step, draw a card.\nWhenever a creature deals combat damage to you, its controller becomes the monarch.","prints":["aaaaaaaa000040008000000000000005"]}]},
 {"name":"Treasure","variants":[
  {"typeLine":"Token Artifact — Treasure","oracleText":"{T}, Sacrifice this artifact: Add one mana of any color.","prints":["aaaaaaaa000040008000000000000009"]}]}
]}
```

- [ ] **Step 2: Write the failing tests**

Create `src/core/token/draft.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import type { TokenIndex } from './index'
import { draftFromVariant, blankDraft, editDraft, normalizeDraft, COPIES_MAX } from './draft'

const index = JSON.parse(readFileSync('tests/fixtures/tokens/index.json', 'utf8')) as TokenIndex
const entry = (n: string) => index.tokens.find((t) => t.name === n)!

describe('draftFromVariant', () => {
  it('fills the card from the variant, no mana cost, first printing as art', () => {
    const d = draftFromVariant(entry('Goblin'), 1)
    expect(d.base).toEqual({ name: 'Goblin', variant: 1 })
    expect(d.card).toEqual({ name: 'Goblin', manaCost: '', typeLine: 'Token Creature — Goblin', oracleText: '', stat: { kind: 'pt', power: '1', toughness: '1' } })
    expect(d.artRef).toBe('aaaaaaaa000040008000000000000004')
    expect(d.copies).toBe(1)
  })
  it('omits the stat for noncreatures and falls back to variant 0 when out of range', () => {
    const d = draftFromVariant(entry('Treasure'), 5)
    expect(d.base).toEqual({ name: 'Treasure', variant: 0 })
    expect(d.card.stat).toBeUndefined()
  })
})

describe('blankDraft', () => {
  it('is a nameless-but-valid token with nothing else', () => {
    expect(blankDraft()).toEqual({ base: null, card: { name: 'Token', manaCost: '', typeLine: '', oracleText: '' }, artRef: null, copies: 1 })
  })
})

describe('editDraft', () => {
  const d = draftFromVariant(entry('Goblin'), 0)
  it('edits each card field, trimming, and keeps base', () => {
    expect(editDraft(d, { name: '  Goblin Chief ' }).card.name).toBe('Goblin Chief')
    expect(editDraft(d, { name: '   ' }).card.name).toBe('Goblin')            // empty name is ignored
    expect(editDraft(d, { typeLine: ' Token Creature — Goblin Warrior ' }).card.typeLine).toBe('Token Creature — Goblin Warrior')
    expect(editDraft(d, { oracleText: 'Haste\r\nMenace\r\n\r\n' }).card.oracleText).toBe('Haste\nMenace')
    expect(editDraft(d, { typeLine: 'x' }).base).toEqual(d.base)
  })
  it('sets, replaces and removes the stat; blank P/T or loyalty means none', () => {
    expect(editDraft(d, { stat: { kind: 'pt', power: ' 2', toughness: '3 ' } }).card.stat).toEqual({ kind: 'pt', power: '2', toughness: '3' })
    expect(editDraft(d, { stat: { kind: 'loyalty', value: '4' } }).card.stat).toEqual({ kind: 'loyalty', value: '4' })
    expect(editDraft(d, { stat: { kind: 'none' } }).card.stat).toBeUndefined()
    expect(editDraft(d, { stat: { kind: 'pt', power: '', toughness: '' } }).card.stat).toBeUndefined()
    expect(editDraft(d, { stat: { kind: 'loyalty', value: ' ' } }).card.stat).toBeUndefined()
  })
  it('clamps and rounds copies, and never produces NaN', () => {
    expect(editDraft(d, { copies: 0 }).copies).toBe(1)
    expect(editDraft(d, { copies: 1000 }).copies).toBe(COPIES_MAX)
    expect(editDraft(d, { copies: 2.6 }).copies).toBe(3)
    expect(editDraft(d, { copies: Number('') }).copies).toBe(1)
    expect(editDraft(d, { copies: NaN }).copies).toBe(1)
  })
  it('sets and clears the art ref without touching the card', () => {
    const e = editDraft(d, { artRef: null })
    expect(e.artRef).toBeNull(); expect(e.card).toEqual(d.card)
    expect(editDraft(e, { artRef: 'abc' }).artRef).toBe('abc')
  })
  it('does not mutate the input', () => {
    const before = JSON.stringify(d)
    editDraft(d, { name: 'Other' }); editDraft(d, { stat: { kind: 'none' } }); editDraft(d, { copies: 9 })
    expect(JSON.stringify(d)).toBe(before)
  })
})

describe('normalizeDraft', () => {
  it('round-trips a valid draft', () => {
    const d = draftFromVariant(entry('Goblin'), 0)
    expect(normalizeDraft(JSON.parse(JSON.stringify(d)))).toEqual(d)
  })
  it('returns null for garbage and repairs partial objects', () => {
    expect(normalizeDraft(null)).toBeNull()
    expect(normalizeDraft('x')).toBeNull()
    expect(normalizeDraft({ card: { name: '' } })).toBeNull()
    expect(normalizeDraft({ card: { name: 'Elf', stat: { kind: 'pt', power: 1 } }, copies: 500, base: { name: 'Elf' } }))
      .toEqual({ base: null, card: { name: 'Elf', manaCost: '', typeLine: '', oracleText: '' }, artRef: null, copies: COPIES_MAX })
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/core/token/draft.test.ts`
Expected: FAIL, cannot resolve `./draft`.

- [ ] **Step 4: Implement `src/core/token/draft.ts`**

```ts
import type { CardData } from '../card/types'
import type { TokenEntry } from './index'

export const COPIES_MIN = 1
export const COPIES_MAX = 99

/** What the Tokens panel edits and prints. Every card field is the user's once the draft exists. */
export interface TokenDraft {
  base: { name: string; variant: number } | null   // where the draft started; null for a blank token
  card: CardData                                   // what renders
  artRef: string | null                            // printing ref, null = no art
  copies: number                                   // COPIES_MIN .. COPIES_MAX
}
export type StatPatch = { kind: 'pt'; power: string; toughness: string } | { kind: 'loyalty'; value: string } | { kind: 'none' }
export type DraftPatch = { name: string } | { typeLine: string } | { oracleText: string } | { stat: StatPatch } | { artRef: string | null } | { copies: number }

const clampCopies = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(COPIES_MAX, Math.max(COPIES_MIN, Math.round(n))) : COPIES_MIN

export function draftFromVariant(entry: TokenEntry, variant: number): TokenDraft {
  const i = entry.variants[variant] ? variant : 0
  const v = entry.variants[i]
  const card: CardData = { name: entry.name, manaCost: '', typeLine: v.typeLine, oracleText: v.oracleText }
  if (v.power !== undefined && v.toughness !== undefined) card.stat = { kind: 'pt', power: v.power, toughness: v.toughness }
  return { base: { name: entry.name, variant: i }, card, artRef: v.prints[0] ?? null, copies: 1 }
}

export function blankDraft(): TokenDraft {
  return { base: null, card: { name: 'Token', manaCost: '', typeLine: '', oracleText: '' }, artRef: null, copies: 1 }
}

/** Apply one edit. Pure: returns a new draft, never mutates. */
export function editDraft(d: TokenDraft, p: DraftPatch): TokenDraft {
  if ('copies' in p) return { ...d, copies: clampCopies(p.copies) }
  if ('artRef' in p) return { ...d, artRef: p.artRef }
  const card: CardData = { ...d.card }
  if ('name' in p) { const n = p.name.trim(); if (n) card.name = n }
  else if ('typeLine' in p) card.typeLine = p.typeLine.trim()
  else if ('oracleText' in p) card.oracleText = p.oracleText.replace(/\r\n?/g, '\n').trim()
  else if ('stat' in p) {
    const s = p.stat
    if (s.kind === 'pt' && (s.power.trim() || s.toughness.trim())) card.stat = { kind: 'pt', power: s.power.trim(), toughness: s.toughness.trim() }
    else if (s.kind === 'loyalty' && s.value.trim()) card.stat = { kind: 'loyalty', value: s.value.trim() }
    else delete card.stat
  }
  return { ...d, card }
}

/** Coerce a parsed localStorage value into a valid draft, or null when it is not one. */
export function normalizeDraft(input: unknown): TokenDraft | null {
  if (!input || typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  const c = (o.card && typeof o.card === 'object' ? o.card : null) as Record<string, unknown> | null
  if (!c || typeof c.name !== 'string' || !c.name.trim()) return null
  const s = c.name.trim()
  const card: CardData = {
    name: s,
    manaCost: typeof c.manaCost === 'string' ? c.manaCost : '',
    typeLine: typeof c.typeLine === 'string' ? c.typeLine : '',
    oracleText: typeof c.oracleText === 'string' ? c.oracleText : '',
  }
  const st = (c.stat && typeof c.stat === 'object' ? c.stat : null) as Record<string, unknown> | null
  if (st?.kind === 'pt' && typeof st.power === 'string' && typeof st.toughness === 'string') card.stat = { kind: 'pt', power: st.power, toughness: st.toughness }
  else if (st?.kind === 'loyalty' && typeof st.value === 'string') card.stat = { kind: 'loyalty', value: st.value }
  const b = (o.base && typeof o.base === 'object' ? o.base : null) as Record<string, unknown> | null
  const base = b && typeof b.name === 'string' && typeof b.variant === 'number' && Number.isFinite(b.variant)
    ? { name: b.name, variant: Math.max(0, Math.floor(b.variant)) } : null
  return { base, card, artRef: typeof o.artRef === 'string' ? o.artRef : null, copies: clampCopies(o.copies ?? 1) }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/core/token/draft.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/token/draft.ts src/core/token/draft.test.ts tests/fixtures/tokens/index.json
git commit -m "feat(core): editable token draft with variant start, patches and storage normalisation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Hotspots (core)

**Files:**
- Create: `src/core/token/hotspots.ts`
- Create: `src/core/token/hotspots.test.ts`

**Interfaces:**
- Consumes: `Geometry`, `Rect` from `src/core/layout/fit.ts`
- Produces:
  - `type HotspotKind = 'name' | 'art' | 'type' | 'rules' | 'stat'`
  - `interface Hotspot { kind: HotspotKind; rect: Rect; label: string }`
  - `HOTSPOT_LABELS: Record<HotspotKind, string>`
  - `STAT_HOTSPOT = { w: 96, h: 32 }`
  - `hotspotsFor(g: Geometry): Hotspot[]` (order: name, art, type, rules, stat)

- [ ] **Step 1: Write the failing test**

Create `src/core/token/hotspots.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fit } from '../layout/fit'
import { normalizeScryfall } from '../card/normalize'
import { DEFAULT_SETTINGS } from '../settings'
import { nodeEnv } from '../../../tests/nodeEnv'
import { hotspotsFor, STAT_HOTSPOT, HOTSPOT_LABELS } from './hotspots'

const card = (n: string) => normalizeScryfall(JSON.parse(readFileSync(`tests/fixtures/cards/${n}.json`, 'utf8')))

describe('hotspotsFor', () => {
  it('maps the geometry boxes, stat last, with labels', () => {
    const g = fit(card('tarmogoyf'), DEFAULT_SETTINGS, nodeEnv)
    const spots = hotspotsFor(g)
    expect(spots.map((s) => s.kind)).toEqual(['name', 'art', 'type', 'rules', 'stat'])
    expect(spots[0].rect).toEqual(g.nameBar); expect(spots[1].rect).toEqual(g.art)
    expect(spots[2].rect).toEqual(g.typeBar); expect(spots[3].rect).toEqual(g.textBox)
    expect(spots[4].rect).toEqual(g.statBox)
    expect(spots[4].label).toBe(HOTSPOT_LABELS.stat)
    expect(spots[1].label).toBe('Change art')
  })
  it('gives a card without a stat box a 96 x 32 stat hotspot in the bottom-right of the text box', () => {
    const g = fit(card('bolt'), DEFAULT_SETTINGS, nodeEnv)
    expect(g.statBox).toBeUndefined()
    const stat = hotspotsFor(g).find((s) => s.kind === 'stat')!.rect
    expect(stat).toEqual({ x: g.textBox.x + g.textBox.w - STAT_HOTSPOT.w, y: g.textBox.y + g.textBox.h - STAT_HOTSPOT.h, w: STAT_HOTSPOT.w, h: STAT_HOTSPOT.h })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/token/hotspots.test.ts`
Expected: FAIL, cannot resolve `./hotspots`.

- [ ] **Step 3: Implement `src/core/token/hotspots.ts`**

```ts
import type { Geometry, Rect } from '../layout/fit'

export type HotspotKind = 'name' | 'art' | 'type' | 'rules' | 'stat'
export interface Hotspot { kind: HotspotKind; rect: Rect; label: string }

export const HOTSPOT_LABELS: Record<HotspotKind, string> = {
  name: 'Edit name', art: 'Change art', type: 'Edit type line', rules: 'Edit rules text', stat: 'Edit power and toughness',
}
/** Where the stat hotspot sits when the card has no stat box yet, so a P/T can be added. In dots. */
export const STAT_HOTSPOT = { w: 96, h: 32 }

/** Clickable regions of a rendered card, in card dots. Stat comes last so the view can stack it above rules. */
export function hotspotsFor(g: Geometry): Hotspot[] {
  const stat: Rect = g.statBox ?? {
    x: g.textBox.x + g.textBox.w - STAT_HOTSPOT.w, y: g.textBox.y + g.textBox.h - STAT_HOTSPOT.h, w: STAT_HOTSPOT.w, h: STAT_HOTSPOT.h,
  }
  return [
    { kind: 'name', rect: g.nameBar, label: HOTSPOT_LABELS.name },
    { kind: 'art', rect: g.art, label: HOTSPOT_LABELS.art },
    { kind: 'type', rect: g.typeBar, label: HOTSPOT_LABELS.type },
    { kind: 'rules', rect: g.textBox, label: HOTSPOT_LABELS.rules },
    { kind: 'stat', rect: stat, label: HOTSPOT_LABELS.stat },
  ]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/core/token/hotspots.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/token/hotspots.ts src/core/token/hotspots.test.ts
git commit -m "feat(core): hotspot rects derived from card geometry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Art preference (core)

**Files:**
- Create: `src/core/art/preference.ts`
- Create: `src/core/art/preference.test.ts`

**Interfaces:**
- Produces:
  - `ART_PREF_KEY = 'hot-proxies.art.v1'`
  - `type Store = Pick<Storage, 'getItem' | 'setItem'>`
  - `getPreferredArt(store: Store, name: string): string | null`
  - `setPreferredArt(store: Store, name: string, ref: string | null): void`

- [ ] **Step 1: Write the failing test**

Create `src/core/art/preference.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getPreferredArt, setPreferredArt, ART_PREF_KEY } from './preference'

function store(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init))
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) } }
}

describe('art preference', () => {
  it('is empty by default and remembers a ref per card name', () => {
    const s = store()
    expect(getPreferredArt(s, 'Lightning Bolt')).toBeNull()
    setPreferredArt(s, 'Lightning Bolt', 'abc')
    expect(getPreferredArt(s, 'Lightning Bolt')).toBe('abc')
    expect(getPreferredArt(s, 'Forest')).toBeNull()
    expect(JSON.parse(s.map.get(ART_PREF_KEY)!)).toEqual({ 'Lightning Bolt': 'abc' })
  })
  it('removes the entry on null', () => {
    const s = store({ [ART_PREF_KEY]: JSON.stringify({ Forest: 'f', Island: 'i' }) })
    setPreferredArt(s, 'Forest', null)
    expect(getPreferredArt(s, 'Forest')).toBeNull()
    expect(getPreferredArt(s, 'Island')).toBe('i')
  })
  it('treats corrupt storage as empty and survives a throwing store', () => {
    expect(getPreferredArt(store({ [ART_PREF_KEY]: '{not json' }), 'Forest')).toBeNull()
    expect(getPreferredArt(store({ [ART_PREF_KEY]: '[1,2]' }), 'Forest')).toBeNull()
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(getPreferredArt(broken, 'Forest')).toBeNull()
    expect(() => setPreferredArt(broken, 'Forest', 'x')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/art/preference.test.ts`
Expected: FAIL, cannot resolve `./preference`.

- [ ] **Step 3: Implement `src/core/art/preference.ts`**

```ts
/** Which printing's art a card name should use, remembered across Card and Deck mode. */
export const ART_PREF_KEY = 'hot-proxies.art.v1'
export type Store = Pick<Storage, 'getItem' | 'setItem'>

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
  return read(store)[name] ?? null
}

export function setPreferredArt(store: Store, name: string, ref: string | null): void {
  const all = read(store)
  if (ref) all[name] = ref; else delete all[name]
  try { store.setItem(ART_PREF_KEY, JSON.stringify(all)) } catch { /* storage full or disabled */ }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/core/art/preference.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/art/preference.ts src/core/art/preference.test.ts
git commit -m "feat(core): per-card art preference over a key-value store

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Art refs and Scryfall client additions

**Files:**
- Create: `src/data/artRef.ts`
- Create: `src/data/artRef.test.ts`
- Modify: `src/data/scryfall.ts`
- Modify: `src/data/scryfall.test.ts`

**Interfaces:**
- Consumes: `artRef` from `src/core/token/index.ts`, `ArtUnavailable`, `NetworkError` from `src/core/errors.ts`
- Produces:
  - `parseArtRef(ref: string): { uuid: string; face: 0 | 1 } | null`
  - `artCropUrl(ref: string): string | null`
  - `interface Printing { ref: string; artUrl: string; set: string; released: string }`
  - `PRINTS_PAGE_CAP = 5`
  - `ScryfallClient.fetchPrints(name: string): Promise<Printing[]>`
  - `ScryfallClient.fetchArtById(ref: string): Promise<Blob>`

- [ ] **Step 1: Write the failing artRef tests**

Create `src/data/artRef.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseArtRef, artCropUrl } from './artRef'

const HEX = 'aaaaaaaa000040008000000000000004'
const UUID = 'aaaaaaaa-0000-4000-8000-000000000004'

describe('parseArtRef', () => {
  it('re-hyphenates the id and reads the face', () => {
    expect(parseArtRef(HEX)).toEqual({ uuid: UUID, face: 0 })
    expect(parseArtRef(`${HEX}:1`)).toEqual({ uuid: UUID, face: 1 })
    expect(parseArtRef(HEX.toUpperCase())).toEqual({ uuid: UUID, face: 0 })
  })
  it('rejects anything that is not 32 hex chars with an optional :0/:1', () => {
    expect(parseArtRef('')).toBeNull(); expect(parseArtRef('abc')).toBeNull()
    expect(parseArtRef(`${HEX}:2`)).toBeNull(); expect(parseArtRef(UUID)).toBeNull()
  })
})

describe('artCropUrl', () => {
  it('builds the CDN path from the first two characters and the face', () => {
    expect(artCropUrl(HEX)).toBe(`https://cards.scryfall.io/art_crop/front/a/a/${UUID}.jpg`)
    expect(artCropUrl(`${HEX}:1`)).toBe(`https://cards.scryfall.io/art_crop/back/a/a/${UUID}.jpg`)
    expect(artCropUrl('nope')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/artRef.test.ts`
Expected: FAIL, cannot resolve `./artRef`.

- [ ] **Step 3: Implement `src/data/artRef.ts`**

```ts
/** Art refs (see core/token/index.ts artRef): 32 hex chars, optional ":1" for the back face. */
export interface ArtRef { uuid: string; face: 0 | 1 }

export function parseArtRef(ref: string): ArtRef | null {
  const m = /^([0-9a-f]{32})(?::([01]))?$/i.exec(ref)
  if (!m) return null
  const h = m[1].toLowerCase()
  const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  return { uuid, face: m[2] === '1' ? 1 : 0 }
}

/** Scryfall's CDN path for an art crop; the real URL may carry a cache-busting query, which the CDN does not require. */
export function artCropUrl(ref: string): string | null {
  const p = parseArtRef(ref)
  if (!p) return null
  return `https://cards.scryfall.io/art_crop/${p.face ? 'back' : 'front'}/${p.uuid[0]}/${p.uuid[1]}/${p.uuid}.jpg`
}
```

- [ ] **Step 4: Run the artRef test to verify it passes**

Run: `npx vitest run src/data/artRef.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing client tests**

Append to `src/data/scryfall.test.ts` (the `setup` and `json` helpers at the top of that file are reused):

```ts
describe('fetchPrints', () => {
  const ID1 = 'aaaaaaaa-0000-4000-8000-000000000001', ID2 = 'aaaaaaaa-0000-4000-8000-000000000002', ID3 = 'aaaaaaaa-0000-4000-8000-000000000003'
  const print = (id: string, set: string, released: string, art?: string, faces?: unknown[]) =>
    ({ id, set, released_at: released, ...(art ? { image_uris: { art_crop: art } } : {}), ...(faces ? { card_faces: faces } : {}) })
  it('encodes the exact-name query, follows pages, keeps only printings with front art, and caches', async () => {
    const { client, calls, fetchFn } = setup([
      json({ data: [print(ID1, 'lea', '1993-08-05', 'https://c/1.jpg'), print(ID2, 'xxx', '2000-01-01')], has_more: true, next_page: 'https://api.scryfall.com/cards/search?page=2' }),
      json({ data: [print(ID3, 'm10', '2009-07-17', undefined, [{ image_uris: { art_crop: 'https://c/3.jpg' } }])], has_more: false }),
    ])
    const prints = await client.fetchPrints("Smuggler's Copter")
    expect(calls[0]).toBe(`https://api.scryfall.com/cards/search?q=${encodeURIComponent('!"Smuggler\'s Copter"')}&unique=prints&order=released&dir=desc`)
    expect(calls[1]).toBe('https://api.scryfall.com/cards/search?page=2')
    expect(prints).toEqual([
      { ref: 'aaaaaaaa000040008000000000000001', artUrl: 'https://c/1.jpg', set: 'lea', released: '1993-08-05' },
      { ref: 'aaaaaaaa000040008000000000000003', artUrl: 'https://c/3.jpg', set: 'm10', released: '2009-07-17' },
    ])
    await client.fetchPrints("Smuggler's Copter")
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
  it('stops after PRINTS_PAGE_CAP pages', async () => {
    const page = (n: number) => json({ data: [print(`aaaaaaaa-0000-4000-8000-00000000000${n}`, 's', '2000-01-01', 'https://c/x.jpg')], has_more: true, next_page: `https://api.scryfall.com/cards/search?page=${n + 1}` })
    const { client, fetchFn } = setup([page(1), page(2), page(3), page(4), page(5), page(6), page(7)])
    const prints = await client.fetchPrints('Forest')
    expect(prints).toHaveLength(PRINTS_PAGE_CAP)
    expect(fetchFn).toHaveBeenCalledTimes(PRINTS_PAGE_CAP)
  })
  it('returns an empty list on 404 and NetworkError otherwise', async () => {
    expect(await setup([json({ object: 'error' }, 404)]).client.fetchPrints('Nope')).toEqual([])
    await expect(setup([json({}, 500)]).client.fetchPrints('Forest')).rejects.toBeInstanceOf(NetworkError)
  })
})

describe('fetchArtById', () => {
  const HEX = 'aaaaaaaa000040008000000000000004', UUID = 'aaaaaaaa-0000-4000-8000-000000000004'
  const blob = () => new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), { status: 200 })
  it('fetches the direct CDN url and caches by ref', async () => {
    const { client, calls, fetchFn } = setup([blob()])
    const a = await client.fetchArtById(HEX); const b = await client.fetchArtById(HEX)
    expect(calls[0]).toBe(`https://cards.scryfall.io/art_crop/front/a/a/${UUID}.jpg`)
    expect(a.size).toBe(3); expect(b.size).toBe(3); expect(fetchFn).toHaveBeenCalledTimes(1)
  })
  it('falls back to the card JSON when the direct url is 404, using the requested face', async () => {
    const { client, calls } = setup([
      new Response('', { status: 404 }),
      json({ id: UUID, card_faces: [{ image_uris: { art_crop: 'https://c/front.jpg' } }, { image_uris: { art_crop: 'https://c/back.jpg?123' } }] }),
      blob(),
    ])
    await client.fetchArtById(`${HEX}:1`)
    expect(calls).toEqual([`https://cards.scryfall.io/art_crop/back/a/a/${UUID}.jpg`, `https://api.scryfall.com/cards/${UUID}`, 'https://c/back.jpg?123'])
  })
  it('throws ArtUnavailable for a bad ref, a failed fallback or a missing art crop', async () => {
    await expect(setup([]).client.fetchArtById('nope')).rejects.toBeInstanceOf(ArtUnavailable)
    await expect(setup([new Response('', { status: 404 }), json({}, 500)]).client.fetchArtById(HEX)).rejects.toBeInstanceOf(ArtUnavailable)
    await expect(setup([new Response('', { status: 404 }), json({ id: UUID })]).client.fetchArtById(HEX)).rejects.toBeInstanceOf(ArtUnavailable)
    await expect(setup([new TypeError('Failed to fetch')]).client.fetchArtById(HEX)).rejects.toBeInstanceOf(ArtUnavailable)
  })
})
```

Add `PRINTS_PAGE_CAP` to the import from `./scryfall` at the top of the test file.

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run src/data/scryfall.test.ts`
Expected: FAIL, `client.fetchPrints is not a function`.

- [ ] **Step 7: Implement the client additions**

In `src/data/scryfall.ts`:

Add imports at the top:

```ts
import { artRef } from '../core/token/index'
import { parseArtRef, artCropUrl } from './artRef'
```

Extend the interface and add the constant:

```ts
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
```

Inside `createScryfallClient`, after `get`, add a shared JSON request with the 429 retry and the two helpers, then rewrite `fetchCard` to use it:

```ts
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
  const fetchForArt = async (url: string): Promise<Response> => {
    try { return await throttled(() => fetchFn(url)) } catch { throw new ArtUnavailable() }
  }
```

Replace the body of `fetchCard` so it uses `request`:

```ts
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
```

Add the two methods to the returned object:

```ts
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
        const cardRes = await fetchForArt(`${API}/cards/${parsed.uuid}`)
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
```

Remove the now-unused local `init` inside the old `fetchCard` body if one remains.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/data && npm run typecheck`
Expected: PASS for artRef, fuzzy and scryfall tests. Typecheck will fail where `Services` literals lack the new methods; that is fixed in Task 7, so only confirm `src/data` compiles (errors must all be in `src/app` or `tests`).

- [ ] **Step 9: Commit**

```bash
git add src/data/artRef.ts src/data/artRef.test.ts src/data/scryfall.ts src/data/scryfall.test.ts
git commit -m "feat(data): art refs, fetchPrints and fetchArtById on the Scryfall client

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Token index loader, `Services.loadTokens`, fakes

**Files:**
- Create: `src/data/tokenIndex.ts`
- Create: `src/data/tokenIndex.test.ts`
- Modify: `src/app/services.ts`
- Modify: `tests/fakeServices.ts`
- Modify: `src/app/App.test.tsx:15-24`, `src/app/usePrinter.test.tsx:13`, `src/app/useProxy.test.tsx:17-24` (hand-built `Services` literals)

**Interfaces:**
- Consumes: `TokenIndex`, `TokenEntry` from `src/core/token/index.ts`
- Produces:
  - `loadTokenIndex(fetchFn?: typeof fetch): Promise<TokenIndex>`
  - `tokenNames(index: TokenIndex): string[]`
  - `variantsOf(index: TokenIndex, name: string): TokenEntry | undefined`
  - `Services.loadTokens(): Promise<TokenIndex>`
  - `FakeServicesOptions` gains `loadTokens?`, `fetchPrints?`, `fetchArtById?`

- [ ] **Step 1: Write the failing loader test**

Create `src/data/tokenIndex.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { loadTokenIndex, tokenNames, variantsOf } from './tokenIndex'
import type { TokenIndex } from '../core/token/index'

const fixture = JSON.parse(readFileSync('tests/fixtures/tokens/index.json', 'utf8')) as TokenIndex
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('loadTokenIndex', () => {
  it('fetches tokens.json from the base URL once and validates the shape', async () => {
    const fetchFn = vi.fn(async () => json(fixture)) as unknown as typeof fetch
    const a = await loadTokenIndex(fetchFn); const b = await loadTokenIndex(fetchFn)
    expect(a).toEqual(fixture); expect(b).toBe(a)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(String((fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toMatch(/tokens\.json$/)
  })
  it('rejects a wrong version or HTTP error and allows a retry', async () => {
    // The module caches the first successful promise, so this test runs in a fresh module instance.
    vi.resetModules()
    const mod = await import('./tokenIndex')
    const bad = (async () => json({ version: 2, tokens: [] })) as unknown as typeof fetch
    await expect(mod.loadTokenIndex(bad)).rejects.toThrow(/unexpected format/)
    const http = (async () => json({}, 503)) as unknown as typeof fetch
    await expect(mod.loadTokenIndex(http)).rejects.toThrow(/HTTP 503/)
    const good = (async () => json(fixture)) as unknown as typeof fetch
    expect((await mod.loadTokenIndex(good)).tokens.length).toBe(fixture.tokens.length)
  })
})

describe('tokenNames and variantsOf', () => {
  it('lists the names and finds an entry by exact name', () => {
    expect(tokenNames(fixture)).toEqual(['Goblin', 'Soldier', 'The Monarch', 'Treasure'])
    expect(variantsOf(fixture, 'Goblin')!.variants).toHaveLength(2)
    expect(variantsOf(fixture, 'goblin')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/tokenIndex.test.ts`
Expected: FAIL, cannot resolve `./tokenIndex`.

- [ ] **Step 3: Implement `src/data/tokenIndex.ts`**

```ts
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
```

- [ ] **Step 4: Run the loader test to verify it passes**

Run: `npx vitest run src/data/tokenIndex.test.ts`
Expected: PASS.

- [ ] **Step 5: Extend `Services` and the browser implementation**

In `src/app/services.ts`:

```ts
import type { TokenIndex } from '../core/token/index'
import { loadTokenIndex } from '../data/tokenIndex'
```

Add to the interface, after `loadNames`:

```ts
  loadTokens(): Promise<TokenIndex>
```

Add to `createBrowserServices` after `loadNames`:

```ts
    loadTokens: () => loadTokenIndex(),
```

- [ ] **Step 6: Extend the fake services and the hand-built literals**

Replace `tests/fakeServices.ts` wholesale:

```ts
import { readFileSync } from 'node:fs'
import type { Services } from '../src/app/services'
import type { TokenIndex } from '../src/core/token/index'
import { ArtUnavailable, CardNotFound } from '../src/core/errors'
import { nodeEnv } from './nodeEnv'
import { fakePrinter, type FakePrinter } from './fakePrinter'

/** Scryfall fixtures by exact name (case-insensitive, as Scryfall's ?exact= is). */
export const FIXTURE_CARDS: Record<string, string> = {
  'lightning bolt': 'bolt', 'tarmogoyf': 'tarmogoyf', 'forest': 'forest', 'nicol bolas, the ravager': 'bolas',
  'delver of secrets': 'delver', 'delver of secrets // insectile aberration': 'delver', 'smuggler\'s copter': 'copter',
}
export const FIXTURE_NAMES = ['Lightning Bolt', 'Tarmogoyf', 'Forest', 'Nicol Bolas, the Ravager', 'Delver of Secrets // Insectile Aberration', "Smuggler's Copter"]
export const FIXTURE_TOKENS = JSON.parse(readFileSync('tests/fixtures/tokens/index.json', 'utf8')) as TokenIndex

export function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v) } }
}

export interface FakeServicesOptions {
  printer?: FakePrinter
  fetchCard?: Services['client']['fetchCard']
  fetchPrints?: Services['client']['fetchPrints']
  fetchArtById?: Services['client']['fetchArtById']
  loadNames?: Services['loadNames']
  loadTokens?: Services['loadTokens']
  storage?: Pick<Storage, 'getItem' | 'setItem'>
  decodeArt?: Services['decodeArt']
}

export function fakeServices(o: FakeServicesOptions = {}): Services & { printer: FakePrinter } {
  const fetchCard = o.fetchCard ?? (async (name: string) => {
    const f = FIXTURE_CARDS[name.toLowerCase()]
    if (!f) throw new CardNotFound(name)
    return JSON.parse(readFileSync(`tests/fixtures/cards/${f}.json`, 'utf8'))
  })
  return {
    client: {
      fetchCard,
      fetchArtBlob: async () => { throw new Error('no art in tests') },
      fetchPrints: o.fetchPrints ?? (async () => []),
      fetchArtById: o.fetchArtById ?? (async () => { throw new ArtUnavailable() }),
    },
    loadNames: o.loadNames ?? (async () => FIXTURE_NAMES),
    loadTokens: o.loadTokens ?? (async () => FIXTURE_TOKENS),
    env: nodeEnv,
    storage: o.storage ?? memoryStorage(),
    decodeArt: o.decodeArt ?? (async () => { throw new Error('unused') }),
    printer: o.printer ?? fakePrinter('connected'),
  }
}
```

In `src/app/App.test.tsx`, replace the `services` helper (lines 15-24) with:

```ts
function services(fetchCard: Services['client']['fetchCard'], printer = fakePrinter()): Services {
  return fakeServices({ fetchCard, printer, storage: { getItem: () => null, setItem: () => {} } })
}
```

and add `import { fakeServices } from '../../tests/fakeServices'` to its imports (keep the `fakePrinter` import; the `nodeEnv` import becomes unused and must be removed).

In `src/app/usePrinter.test.tsx` line 13 and `src/app/useProxy.test.tsx` lines 17-24, add the two client methods and `loadTokens` to the literal:

```ts
  client: { fetchCard: /* keep */, fetchArtBlob: /* keep */, fetchPrints: async () => [], fetchArtById: async () => { throw new Error('unused') } },
  loadNames: /* keep */,
  loadTokens: async () => ({ version: 1, tokens: [] }),
```

Run `grep -rn "fetchArtBlob:" src tests scripts` and confirm every literal outside `src/data/scryfall.ts` and `tests/fakeServices.ts` now has all four client methods.

- [ ] **Step 7: Run everything**

Run: `npm run typecheck && npm test`
Expected: typecheck clean, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/data/tokenIndex.ts src/data/tokenIndex.test.ts src/app/services.ts tests/fakeServices.ts src/app/App.test.tsx src/app/usePrinter.test.tsx src/app/useProxy.test.tsx
git commit -m "feat(data): lazy token index loader; Services.loadTokens and richer fakes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Token golden renders

**Files:**
- Modify: `src/core/render/renderProxy.test.ts`
- Create (generated): `tests/golden/token-treasure.png`, `tests/golden/token-goblin.png`

**Interfaces:**
- Consumes: `draftFromVariant` from `src/core/token/draft.ts`, `TokenIndex`

- [ ] **Step 1: Add the token golden tests**

In `src/core/render/renderProxy.test.ts`, add imports:

```ts
import type { TokenIndex } from '../token/index'
import { draftFromVariant } from '../token/draft'
```

Add after the `card` helper:

```ts
const tokenIndex = JSON.parse(readFileSync('tests/fixtures/tokens/index.json', 'utf8')) as TokenIndex
const tokenCard = (name: string, variant = 0) => draftFromVariant(tokenIndex.tokens.find((t) => t.name === name)!, variant).card
```

Add inside `describe('renderProxy', ...)`:

```ts
  it('renders a noncreature token (no cost, no stat) identically to the golden image', async () => {
    const { bits, geometry } = renderProxy(tokenCard('Treasure'), null, DEFAULT_SETTINGS, nodeEnv)
    expect(geometry.costOnSecondLine).toBe(false)
    expect(geometry.statBox).toBeUndefined()
    expect(geometry.overflow).toBe(false)
    await expectGolden('token-treasure', bits)
  })
  it('renders a creature token with P/T identically to the golden image', async () => {
    const { bits, geometry } = renderProxy(tokenCard('Goblin', 0), null, DEFAULT_SETTINGS, nodeEnv)
    expect(geometry.statBox).toBeDefined()
    expect(geometry.overflow).toBe(false)
    await expectGolden('token-goblin', bits)
  })
```

- [ ] **Step 2: Run the test; the first run writes the goldens**

Run: `npx vitest run src/core/render/renderProxy.test.ts`
Expected: PASS, and `tests/golden/token-treasure.png` and `tests/golden/token-goblin.png` now exist. Open both PNGs and check: name bar with no cost symbols, empty art frame, type line, rules text, and for the Goblin a `1/1` box bottom right.

- [ ] **Step 3: Run again to confirm determinism**

Run: `npx vitest run src/core/render/renderProxy.test.ts`
Expected: PASS with no diff written to `tests/golden/__diff__/`.

- [ ] **Step 4: Commit**

```bash
git add src/core/render/renderProxy.test.ts tests/golden/token-treasure.png tests/golden/token-goblin.png
git commit -m "test(render): golden renders for a noncreature and a creature token

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `Preview` overlay prop and `EditablePreview`

**Files:**
- Modify: `src/app/Preview.tsx`
- Create: `src/app/EditablePreview.tsx`
- Create: `src/app/EditablePreview.test.tsx`

**Interfaces:**
- Consumes: `hotspotsFor`, `HotspotKind` from `src/core/token/hotspots.ts`; `Geometry` from `src/core/layout/fit.ts`; `INK` from `./theme`
- Produces:
  - `PreviewProps.overlay?: ReactNode` (rendered inside a relatively positioned box the size of the canvas)
  - `interface EditablePreviewProps extends Omit<PreviewProps, 'overlay'> { geometry: Geometry; enabled: HotspotKind[]; disabled?: boolean; onEdit(kind: HotspotKind): void }`
  - `EditablePreview` component; overlay container has `data-testid="hotspots"`

- [ ] **Step 1: Write the failing test**

Create `src/app/EditablePreview.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { EditablePreview } from './EditablePreview'
import { fit } from '../core/layout/fit'
import { normalizeScryfall } from '../core/card/normalize'
import { DEFAULT_SETTINGS } from '../core/settings'
import { nodeEnv } from '../../tests/nodeEnv'
import type { BitImage } from '../core/art/types'

const card = normalizeScryfall(JSON.parse(readFileSync('tests/fixtures/cards/bolt.json', 'utf8')))
const geometry = fit(card, DEFAULT_SETTINGS, nodeEnv)
const bits: BitImage = { width: geometry.card.w, height: geometry.card.h, bits: new Uint8Array(geometry.card.w * geometry.card.h) }
const ALL = ['name', 'art', 'type', 'rules', 'stat'] as const

describe('EditablePreview', () => {
  it('renders one button per enabled hotspot, positioned in percent of the card, stat after rules', async () => {
    const onEdit = vi.fn()
    render(<EditablePreview bits={bits} geometry={geometry} dotsPerLine={384} dpi={203} enabled={[...ALL]} onEdit={onEdit} />)
    const buttons = screen.getAllByRole('button').filter((b) => b.closest('[data-testid="hotspots"]'))
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Edit name', 'Change art', 'Edit type line', 'Edit rules text', 'Edit power and toughness'])
    const name = screen.getByRole('button', { name: 'Edit name' })
    expect(parseFloat(name.style.left)).toBeCloseTo((100 * geometry.nameBar.x) / geometry.card.w, 3)
    expect(parseFloat(name.style.width)).toBeCloseTo((100 * geometry.nameBar.w) / geometry.card.w, 3)
    await userEvent.click(screen.getByRole('button', { name: 'Change art' }))
    expect(onEdit).toHaveBeenCalledWith('art')
  })
  it('renders only the enabled hotspots and none when disabled is set', () => {
    const { rerender } = render(<EditablePreview bits={bits} geometry={geometry} dotsPerLine={384} dpi={203} enabled={['art']} onEdit={() => {}} />)
    expect(screen.getByRole('button', { name: 'Change art' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit name' })).toBeNull()
    rerender(<EditablePreview bits={bits} geometry={geometry} dotsPerLine={384} dpi={203} enabled={['art']} disabled onEdit={() => {}} />)
    expect(screen.getByRole('button', { name: 'Change art' })).toBeDisabled()
  })
  it('still shows the zoom controls from Preview', () => {
    render(<EditablePreview bits={bits} geometry={geometry} dotsPerLine={384} dpi={203} enabled={[]} onEdit={() => {}} />)
    expect(screen.getByRole('button', { name: '2×' })).toBeInTheDocument()
    expect(screen.getByTestId('preview')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/EditablePreview.test.tsx`
Expected: FAIL, cannot resolve `./EditablePreview`.

- [ ] **Step 3: Add the overlay to `Preview`**

In `src/app/Preview.tsx`, add `import type { ReactNode } from 'react'`, extend the props and wrap the canvas so the border and shadow live on the wrapper and the overlay fills the same box:

```tsx
export interface PreviewProps { bits: BitImage; dotsPerLine: number; dpi: number; print?: PreviewPrintProps; overlay?: ReactNode }

export function Preview({ bits, dotsPerLine, dpi, print, overlay }: PreviewProps) {
  // ... existing ref/zoom/effect unchanged ...
  const widthCss = zoom === 'physical' ? `${((dotsPerLine / dpi) * 25.4).toFixed(2)}mm` : `${bits.width * Number(zoom)}px`
  return (
    <Stack spacing={1} sx={{ alignItems: 'center' }} data-testid="preview">
      <Box sx={{ position: 'relative', width: widthCss, maxWidth: '100%', lineHeight: 0, border: `1px solid ${RULE}`, background: '#fff', boxShadow: '0 4px 14px rgba(40, 32, 16, 0.15)' }}>
        <Box component="canvas" ref={ref} sx={{ display: 'block', width: '100%', height: 'auto', imageRendering: 'pixelated' }} />
        {overlay}
      </Box>
      {/* ... existing controls row unchanged ... */}
    </Stack>
  )
}
```

- [ ] **Step 4: Implement `src/app/EditablePreview.tsx`**

```tsx
import Box from '@mui/material/Box'
import { alpha } from '@mui/material/styles'
import type { Geometry } from '../core/layout/fit'
import { hotspotsFor, type HotspotKind } from '../core/token/hotspots'
import { Preview, type PreviewProps } from './Preview'
import { INK } from './theme'

export interface EditablePreviewProps extends Omit<PreviewProps, 'overlay'> {
  geometry: Geometry
  /** Which regions are clickable: all five in Tokens, only 'art' in Card mode. */
  enabled: HotspotKind[]
  disabled?: boolean
  onEdit(kind: HotspotKind): void
}

/** The bitmap preview with transparent buttons over the card's regions, sized in percent so any zoom works. */
export function EditablePreview({ geometry, enabled, disabled, onEdit, ...preview }: EditablePreviewProps) {
  const { w, h } = geometry.card
  const spots = hotspotsFor(geometry).filter((s) => enabled.includes(s.kind))
  const overlay = (
    <Box data-testid="hotspots" sx={{ position: 'absolute', inset: 0 }}>
      {spots.map((s) => (
        <Box key={s.kind} component="button" type="button" aria-label={s.label} disabled={disabled} onClick={() => onEdit(s.kind)}
          style={{ left: `${(100 * s.rect.x) / w}%`, top: `${(100 * s.rect.y) / h}%`, width: `${(100 * s.rect.w) / w}%`, height: `${(100 * s.rect.h) / h}%` }}
          sx={{
            position: 'absolute', p: 0, m: 0, background: 'transparent', border: '1px dashed transparent', borderRadius: 1,
            cursor: disabled ? 'default' : 'pointer',
            '&:not(:disabled):hover, &:focus-visible': { borderColor: 'primary.main', outline: 'none', background: alpha(INK, 0.04) },
          }} />
      ))}
    </Box>
  )
  return <Preview {...preview} overlay={overlay} />
}
```

Positions go through `style`, not `sx`, so the test can read them back from the element and MUI does not need to generate a class per card.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/EditablePreview.test.tsx src/app/App.test.tsx src/app/DeckPanel.test.tsx`
Expected: PASS (existing preview tests still find `data-testid="preview"`).

- [ ] **Step 6: Commit**

```bash
git add src/app/Preview.tsx src/app/EditablePreview.tsx src/app/EditablePreview.test.tsx
git commit -m "feat(app): Preview overlay slot and EditablePreview hotspot buttons

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `FieldDialog`

**Files:**
- Create: `src/app/FieldDialog.tsx`
- Create: `src/app/FieldDialog.test.tsx`

**Interfaces:**
- Consumes: `CardData`; `DraftPatch` from `src/core/token/draft.ts`
- Produces:
  - `type FieldKind = 'name' | 'type' | 'rules' | 'stat'` (the non-art `HotspotKind`s)
  - `interface FieldDialogProps { field: FieldKind | null; card: CardData; onSave(patch: DraftPatch): void; onClose(): void }`

- [ ] **Step 1: Write the failing test**

Create `src/app/FieldDialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FieldDialog } from './FieldDialog'
import type { CardData } from '../core/card/types'

const goblin: CardData = { name: 'Goblin', manaCost: '', typeLine: 'Token Creature — Goblin', oracleText: 'Haste', stat: { kind: 'pt', power: '1', toughness: '1' } }

describe('FieldDialog', () => {
  it('edits the name, disables Save when empty, and saves the trimmed patch on Enter', async () => {
    const onSave = vi.fn(), onClose = vi.fn()
    render(<FieldDialog field="name" card={goblin} onSave={onSave} onClose={onClose} />)
    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(input).toHaveValue('Goblin')
    await userEvent.clear(input)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.type(input, ' Goblin Chief{enter}')
    expect(onSave).toHaveBeenCalledWith({ name: ' Goblin Chief' })
  })
  it('edits the type line and the rules text', async () => {
    const onSave = vi.fn()
    const { rerender } = render(<FieldDialog field="type" card={goblin} onSave={onSave} onClose={() => {}} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Type line' }), ' Warrior')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenLastCalledWith({ typeLine: 'Token Creature — Goblin Warrior' })
    rerender(<FieldDialog field="rules" card={goblin} onSave={onSave} onClose={() => {}} />)
    const rules = screen.getByRole('textbox', { name: 'Rules text' })
    expect(rules).toHaveValue('Haste')
    await userEvent.type(rules, '{enter}Menace')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenLastCalledWith({ oracleText: 'Haste\nMenace' })
    expect(screen.getByText(/drawn as icons/)).toBeInTheDocument()
  })
  it('switches the stat between P/T, loyalty and none', async () => {
    const onSave = vi.fn()
    render(<FieldDialog field="stat" card={goblin} onSave={onSave} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'P/T', pressed: true })).toBeInTheDocument()
    await userEvent.clear(screen.getByRole('textbox', { name: 'Power' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Power' }), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenLastCalledWith({ stat: { kind: 'pt', power: '2', toughness: '1' } })
    await userEvent.click(screen.getByRole('button', { name: 'Loyalty' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Loyalty' }), '4')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenLastCalledWith({ stat: { kind: 'loyalty', value: '4' } })
    await userEvent.click(screen.getByRole('button', { name: 'None' }))
    expect(screen.queryByRole('textbox', { name: 'Loyalty' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenLastCalledWith({ stat: { kind: 'none' } })
  })
  it('starts from None for a card without a stat, and Cancel closes without saving', async () => {
    const onSave = vi.fn(), onClose = vi.fn()
    render(<FieldDialog field="stat" card={{ ...goblin, stat: undefined }} onSave={onSave} onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'None', pressed: true })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled(); expect(onSave).not.toHaveBeenCalled()
  })
  it('renders nothing when field is null', () => {
    render(<FieldDialog field={null} card={goblin} onSave={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/FieldDialog.test.tsx`
Expected: FAIL, cannot resolve `./FieldDialog`.

- [ ] **Step 3: Implement `src/app/FieldDialog.tsx`**

```tsx
import { useState } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import type { CardData } from '../core/card/types'
import type { DraftPatch } from '../core/token/draft'

export type FieldKind = 'name' | 'type' | 'rules' | 'stat'
export interface FieldDialogProps { field: FieldKind | null; card: CardData; onSave(patch: DraftPatch): void; onClose(): void }

const TITLES: Record<FieldKind, string> = { name: 'Name', type: 'Type line', rules: 'Rules text', stat: 'Power and toughness' }
type StatKind = 'none' | 'pt' | 'loyalty'

/** One dialog per hotspot. Remounted per field (key) so its state starts from the card every time it opens. */
export function FieldDialog({ field, card, onSave, onClose }: FieldDialogProps) {
  return (
    <Dialog open={field !== null} onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="field-dialog-title">
      {field && <FieldForm key={field} field={field} card={card} onSave={onSave} onClose={onClose} />}
    </Dialog>
  )
}

function FieldForm({ field, card, onSave, onClose }: { field: FieldKind; card: CardData; onSave(p: DraftPatch): void; onClose(): void }) {
  const initialText = field === 'name' ? card.name : field === 'type' ? card.typeLine : field === 'rules' ? card.oracleText : ''
  const [text, setText] = useState(initialText)
  const [statKind, setStatKind] = useState<StatKind>(card.stat?.kind ?? 'none')
  const [power, setPower] = useState(card.stat?.kind === 'pt' ? card.stat.power : '')
  const [toughness, setToughness] = useState(card.stat?.kind === 'pt' ? card.stat.toughness : '')
  const [loyalty, setLoyalty] = useState(card.stat?.kind === 'loyalty' ? card.stat.value : '')
  const canSave = field !== 'name' || text.trim().length > 0

  const patch = (): DraftPatch => {
    if (field === 'name') return { name: text }
    if (field === 'type') return { typeLine: text }
    if (field === 'rules') return { oracleText: text }
    if (statKind === 'pt') return { stat: { kind: 'pt', power, toughness } }
    if (statKind === 'loyalty') return { stat: { kind: 'loyalty', value: loyalty } }
    return { stat: { kind: 'none' } }
  }
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (canSave) onSave(patch()) }

  return (
    <form onSubmit={submit}>
      <DialogTitle id="field-dialog-title">{TITLES[field]}</DialogTitle>
      <DialogContent>
        {field === 'name' && <TextField autoFocus fullWidth label="Name" value={text} onChange={(e) => setText(e.target.value)} />}
        {field === 'type' && <TextField autoFocus fullWidth label="Type line" value={text} onChange={(e) => setText(e.target.value)} />}
        {field === 'rules' && (
          <TextField autoFocus fullWidth multiline minRows={6} label="Rules text" value={text} onChange={(e) => setText(e.target.value)}
            helperText="Mana symbols like {T} or {G} are drawn as icons." />
        )}
        {field === 'stat' && (
          <Stack spacing={2}>
            <ToggleButtonGroup exclusive size="small" value={statKind} onChange={(_e, v: StatKind | null) => { if (v) setStatKind(v) }} aria-label="Stat kind">
              <ToggleButton value="none">None</ToggleButton>
              <ToggleButton value="pt">P/T</ToggleButton>
              <ToggleButton value="loyalty">Loyalty</ToggleButton>
            </ToggleButtonGroup>
            {statKind === 'pt' && (
              <Stack direction="row" spacing={1}>
                <TextField autoFocus label="Power" value={power} onChange={(e) => setPower(e.target.value)} />
                <TextField label="Toughness" value={toughness} onChange={(e) => setToughness(e.target.value)} />
              </Stack>
            )}
            {statKind === 'loyalty' && <TextField autoFocus label="Loyalty" value={loyalty} onChange={(e) => setLoyalty(e.target.value)} />}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={!canSave}>Save</Button>
      </DialogActions>
    </form>
  )
}
```

Note: Enter inside the multi-line rules field inserts a newline (browser default for `textarea`), while Enter in the single-line fields submits the form.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/FieldDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/FieldDialog.tsx src/app/FieldDialog.test.tsx
git commit -m "feat(app): FieldDialog for name, type line, rules text and stat edits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: `ArtPickerDialog`

**Files:**
- Create: `src/app/ArtPickerDialog.tsx`
- Create: `src/app/ArtPickerDialog.test.tsx`

**Interfaces:**
- Produces:
  - `interface ArtOption { ref: string; thumbUrl: string; label: string; group?: string }`
  - `interface ArtPickerDialogProps { open: boolean; options: ArtOption[] | null; error?: string | null; current: string | null; noneLabel: string; onPick(ref: string | null): void; onClose(): void }`
  - Each tile is a `button` named by `label` (or `noneLabel`), `aria-pressed` when current; picking calls `onPick` then `onClose`.

- [ ] **Step 1: Write the failing test**

Create `src/app/ArtPickerDialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArtPickerDialog, type ArtOption } from './ArtPickerDialog'

const options: ArtOption[] = [
  { ref: 'a1', thumbUrl: 'https://c/a1.jpg', label: 'Art 1', group: 'This variant' },
  { ref: 'a2', thumbUrl: 'https://c/a2.jpg', label: 'Art 2', group: 'This variant' },
  { ref: 'b1', thumbUrl: 'https://c/b1.jpg', label: 'Art 3', group: 'Other printings of this name' },
]

describe('ArtPickerDialog', () => {
  it('lists a none tile and every option with group headings, marks the current one, and picks', async () => {
    const onPick = vi.fn(), onClose = vi.fn()
    render(<ArtPickerDialog open options={options} current="a2" noneLabel="No art" onPick={onPick} onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'No art' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Art 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('img', { name: 'Art 3' })).toHaveAttribute('src', 'https://c/b1.jpg')
    expect(screen.getByText('This variant')).toBeInTheDocument()
    expect(screen.getByText('Other printings of this name')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Art 3' }))
    expect(onPick).toHaveBeenCalledWith('b1'); expect(onClose).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'No art' }))
    expect(onPick).toHaveBeenLastCalledWith(null)
  })
  it('shows a progress bar while options are null and the error text when given', () => {
    const { rerender } = render(<ArtPickerDialog open options={null} current={null} noneLabel="Default art" onPick={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('progressbar', { name: 'Loading printings' })).toBeInTheDocument()
    rerender(<ArtPickerDialog open options={null} error="Could not load other printings." current={null} noneLabel="Default art" onPick={() => {}} onClose={() => {}} />)
    expect(screen.getByText('Could not load other printings.')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByRole('button', { name: 'Default art' })).toBeInTheDocument()
  })
  it('says so when there are no other printings', () => {
    render(<ArtPickerDialog open options={[]} current={null} noneLabel="Default art" onPick={() => {}} onClose={() => {}} />)
    expect(screen.getByText('No printings with art found.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/ArtPickerDialog.test.tsx`
Expected: FAIL, cannot resolve `./ArtPickerDialog`.

- [ ] **Step 3: Implement `src/app/ArtPickerDialog.tsx`**

```tsx
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { RULE } from './theme'

export interface ArtOption { ref: string; thumbUrl: string; label: string; group?: string }
export interface ArtPickerDialogProps {
  open: boolean
  /** null while loading */
  options: ArtOption[] | null
  error?: string | null
  current: string | null
  /** Text of the leading tile that clears the choice: "No art" in Tokens, "Default art" in Card mode. */
  noneLabel: string
  onPick(ref: string | null): void
  onClose(): void
}

const TILE_W = 120, TILE_H = 88

function Tile({ label, pressed, onClick, children }: { label: string; pressed: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <Box component="button" type="button" aria-label={label} aria-pressed={pressed} onClick={onClick}
      sx={{ flex: '0 0 auto', width: TILE_W, height: TILE_H, p: 0, overflow: 'hidden', cursor: 'pointer', background: '#fff', borderRadius: 1,
        border: 2, borderStyle: 'solid', borderColor: pressed ? 'primary.main' : RULE, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
      {children}
    </Box>
  )
}

/** A horizontal scroller of colour art crops; the plain crops are easier to tell apart than dithered ones. */
export function ArtPickerDialog({ open, options, error, current, noneLabel, onPick, onClose }: ArtPickerDialogProps) {
  const pick = (ref: string | null) => { onPick(ref); onClose() }
  let lastGroup: string | undefined
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="art-picker-title">
      <DialogTitle id="art-picker-title">Choose art</DialogTitle>
      <DialogContent>
        {error && <Typography color="error" sx={{ mb: 1 }}>{error}</Typography>}
        {!error && options === null && <LinearProgress aria-label="Loading printings" sx={{ mb: 1 }} />}
        <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', py: 1, alignItems: 'center' }}>
          <Tile label={noneLabel} pressed={current === null} onClick={() => pick(null)}>
            <Typography variant="body2">{noneLabel}</Typography>
          </Tile>
          {(options ?? []).map((o) => {
            const heading = o.group && o.group !== lastGroup ? o.group : null
            lastGroup = o.group
            return (
              <Stack key={o.ref} direction="row" spacing={1} sx={{ alignItems: 'center', flex: '0 0 auto' }}>
                {heading && <Typography variant="caption" color="text.secondary" sx={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', px: 0.5 }}>{heading}</Typography>}
                <Tile label={o.label} pressed={o.ref === current} onClick={() => pick(o.ref)}>
                  <img src={o.thumbUrl} alt={o.label} loading="lazy" width={TILE_W} height={TILE_H} style={{ display: 'block', objectFit: 'cover' }} />
                </Tile>
              </Stack>
            )
          })}
        </Stack>
        {options !== null && options.length === 0 && !error && <Typography color="text.secondary">No printings with art found.</Typography>}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/ArtPickerDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/ArtPickerDialog.tsx src/app/ArtPickerDialog.test.tsx
git commit -m "feat(app): ArtPickerDialog scroller of printings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: `resolveArt` and the Card mode preference in `useProxy`

**Files:**
- Create: `src/app/resolveArt.ts`
- Create: `src/app/resolveArt.test.ts`
- Modify: `src/app/useProxy.ts`
- Modify: `src/app/useProxy.test.tsx`

**Interfaces:**
- Consumes: `getPreferredArt`, `setPreferredArt` from `src/core/art/preference.ts`; `Printing` from `src/data/scryfall.ts`; `ArtUnavailable`
- Produces:
  - `interface ResolvedArt { art: GreyImage | null; failed: boolean }`
  - `resolveArt(services: Services, card: CardData): Promise<ResolvedArt>`
  - `useProxy` returns, in addition to today's `{ state, card, bits, geometry, errors, render }`: `artRef: string | null`, `chooseArt(ref: string | null): Promise<void>`, `prints: Printing[] | null`, `printsError: string | null`, `loadPrints(): Promise<void>`

- [ ] **Step 1: Write the failing `resolveArt` test**

Create `src/app/resolveArt.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { resolveArt } from './resolveArt'
import { fakeServices, memoryStorage } from '../../tests/fakeServices'
import { setPreferredArt } from '../core/art/preference'
import type { CardData } from '../core/card/types'
import type { GreyImage } from '../core/art/types'

const grey: GreyImage = { width: 1, height: 1, data: new Uint8Array([0]) } as unknown as GreyImage
const bolt: CardData = { name: 'Lightning Bolt', manaCost: '{R}', typeLine: 'Instant', oracleText: 'x', artUrl: 'https://c/bolt.jpg' }
const blob = new Blob([new Uint8Array([1])])

describe('resolveArt', () => {
  it('uses the card art when no preference is stored', async () => {
    const fetchArtById = vi.fn(async () => blob)
    const s = fakeServices({ fetchArtById, decodeArt: async () => grey })
    s.client.fetchArtBlob = vi.fn(async () => blob)
    expect(await resolveArt(s, bolt)).toEqual({ art: grey, failed: false })
    expect(fetchArtById).not.toHaveBeenCalled(); expect(s.client.fetchArtBlob).toHaveBeenCalledWith('https://c/bolt.jpg')
  })
  it('uses the preferred printing first, and falls back to the card art when it fails', async () => {
    const storage = memoryStorage(); setPreferredArt(storage, 'Lightning Bolt', 'ref1')
    const ok = fakeServices({ storage, fetchArtById: vi.fn(async () => blob), decodeArt: async () => grey })
    ok.client.fetchArtBlob = vi.fn(async () => { throw new Error('should not be called') })
    expect((await resolveArt(ok, bolt)).art).toBe(grey)
    expect(ok.client.fetchArtById).toHaveBeenCalledWith('ref1')
    const failing = fakeServices({ storage, fetchArtById: async () => { throw new Error('404') }, decodeArt: async () => grey })
    failing.client.fetchArtBlob = vi.fn(async () => blob)
    expect(await resolveArt(failing, bolt)).toEqual({ art: grey, failed: false })
    expect(failing.client.fetchArtBlob).toHaveBeenCalled()
  })
  it('reports failed when the card has art that cannot be loaded, and not for art-less cards', async () => {
    const s = fakeServices()   // fetchArtBlob throws by default
    expect(await resolveArt(s, bolt)).toEqual({ art: null, failed: true })
    expect(await resolveArt(s, { ...bolt, artUrl: undefined })).toEqual({ art: null, failed: false })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/resolveArt.test.ts`
Expected: FAIL, cannot resolve `./resolveArt`.

- [ ] **Step 3: Implement `src/app/resolveArt.ts`**

```ts
import type { Services } from './services'
import type { CardData } from '../core/card/types'
import type { GreyImage } from '../core/art/types'
import { getPreferredArt } from '../core/art/preference'

export interface ResolvedArt { art: GreyImage | null; failed: boolean }

/** The art to render for a card: the remembered printing first, then the card's own crop. `failed` means there was art to load and none loaded. */
export async function resolveArt(services: Services, card: CardData): Promise<ResolvedArt> {
  const pref = getPreferredArt(services.storage, card.name)
  if (pref) {
    try { return { art: await services.decodeArt(await services.client.fetchArtById(pref)), failed: false } }
    catch { /* stale or unreachable preference: fall through to the default art */ }
  }
  if (card.artUrl) {
    try { return { art: await services.decodeArt(await services.client.fetchArtBlob(card.artUrl)), failed: false } }
    catch { return { art: null, failed: true } }
  }
  return { art: null, failed: !!pref }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/resolveArt.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `useProxy` tests**

Append to `src/app/useProxy.test.tsx` (its existing `services` constant stays for the font test; these use `fakeServices`):

```tsx
import { fakeServices, memoryStorage } from '../../tests/fakeServices'
import { setPreferredArt, getPreferredArt } from '../core/art/preference'
import type { GreyImage } from '../core/art/types'

const grey: GreyImage = { width: 1, height: 1, data: new Uint8Array([0]) } as unknown as GreyImage
const blob = new Blob([new Uint8Array([1])])

describe('useProxy art preference', () => {
  it('fetches the preferred printing and exposes its ref', async () => {
    const storage = memoryStorage(); setPreferredArt(storage, 'Lightning Bolt', 'ref1')
    const fetchArtById = vi.fn(async () => blob)
    const s = fakeServices({ storage, fetchArtById, decodeArt: async () => grey })
    const { result } = renderHook(() => useProxy(s, DEFAULT_SETTINGS))
    await act(() => result.current.render('Lightning Bolt'))
    await waitFor(() => expect(result.current.bits).not.toBeNull())
    expect(fetchArtById).toHaveBeenCalledWith('ref1')
    expect(result.current.artRef).toBe('ref1')
    expect(result.current.errors).toEqual([])
  })
  it('chooseArt stores the preference, reloads the art, and null clears it', async () => {
    const storage = memoryStorage()
    const fetchArtById = vi.fn(async () => blob)
    const s = fakeServices({ storage, fetchArtById, decodeArt: async () => grey })
    const { result } = renderHook(() => useProxy(s, DEFAULT_SETTINGS))
    await act(() => result.current.render('Lightning Bolt'))
    await waitFor(() => expect(result.current.bits).not.toBeNull())
    expect(result.current.errors.some((e) => /Art could not be loaded/.test(e.message))).toBe(true)   // default art throws in tests
    await act(() => result.current.chooseArt('ref9'))
    expect(getPreferredArt(storage, 'Lightning Bolt')).toBe('ref9')
    expect(fetchArtById).toHaveBeenCalledWith('ref9')
    await waitFor(() => expect(result.current.errors).toEqual([]))
    await act(() => result.current.chooseArt(null))
    expect(getPreferredArt(storage, 'Lightning Bolt')).toBeNull()
    expect(result.current.artRef).toBeNull()
  })
  it('loadPrints fills prints, or printsError when the request fails', async () => {
    const prints = [{ ref: 'r1', artUrl: 'https://c/1.jpg', set: 'lea', released: '1993-08-05' }]
    const s = fakeServices({ fetchPrints: async () => prints })
    const { result } = renderHook(() => useProxy(s, DEFAULT_SETTINGS))
    await act(() => result.current.render('Lightning Bolt'))
    await waitFor(() => expect(result.current.card).not.toBeNull())
    expect(result.current.prints).toBeNull()
    await act(() => result.current.loadPrints())
    expect(result.current.prints).toEqual(prints)
    const failing = fakeServices({ fetchPrints: async () => { throw new Error('boom') } })
    const r2 = renderHook(() => useProxy(failing, DEFAULT_SETTINGS))
    await act(() => r2.result.current.render('Lightning Bolt'))
    await waitFor(() => expect(r2.result.current.card).not.toBeNull())
    await act(() => r2.result.current.loadPrints())
    expect(r2.result.current.printsError).toBe('Could not load other printings.')
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run src/app/useProxy.test.tsx`
Expected: FAIL, `result.current.chooseArt is not a function` (and `artRef` undefined).

- [ ] **Step 7: Rewrite `src/app/useProxy.ts`**

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Services } from './services'
import type { Settings } from '../core/settings'
import type { CardData } from '../core/card/types'
import type { GreyImage, BitImage } from '../core/art/types'
import type { Geometry } from '../core/layout/fit'
import type { Printing } from '../data/scryfall'
import { normalizeScryfall } from '../core/card/normalize'
import { renderProxy } from '../core/render/renderProxy'
import { ArtUnavailable } from '../core/errors'
import { getPreferredArt, setPreferredArt } from '../core/art/preference'
import { ensureFonts } from './browserEnv'
import { resolveArt } from './resolveArt'

export type ProxyState = 'idle' | 'loading' | 'rendered' | 'error'
export const PRINTS_ERROR = 'Could not load other printings.'

export function useProxy(services: Services, settings: Settings) {
  const [state, setState] = useState<ProxyState>('idle')
  const [card, setCard] = useState<CardData | null>(null)
  const [art, setArt] = useState<GreyImage | null>(null)
  const [artFailed, setArtFailed] = useState(false)
  const [artRef, setArtRef] = useState<string | null>(null)
  const [bits, setBits] = useState<BitImage | null>(null)
  const [geometry, setGeometry] = useState<Geometry | null>(null)
  const [errors, setErrors] = useState<Error[]>([])
  const [fontError, setFontError] = useState<Error | null>(null)
  const [prints, setPrints] = useState<Printing[] | null>(null)
  const [printsError, setPrintsError] = useState<string | null>(null)
  const seq = useRef(0)

  const render = useCallback(async (name: string) => {
    const my = ++seq.current
    setState('loading'); setErrors([]); setPrints(null); setPrintsError(null)
    try {
      const c = normalizeScryfall(await services.client.fetchCard(name))
      const r = await resolveArt(services, c)
      if (my !== seq.current) return
      setCard(c); setArt(r.art); setArtFailed(r.failed); setArtRef(getPreferredArt(services.storage, c.name)); setState('rendered')
    } catch (e) {
      if (my !== seq.current) return
      setCard(null); setArt(null); setArtFailed(false); setArtRef(null); setBits(null); setGeometry(null)
      setErrors([e instanceof Error ? e : new Error(String(e))]); setState('error')
    }
  }, [services])

  /** Remember a printing for this card name (null = default art) and reload the art. */
  const chooseArt = useCallback(async (ref: string | null) => {
    if (!card) return
    setPreferredArt(services.storage, card.name, ref)
    setArtRef(ref)
    const my = seq.current
    const r = await resolveArt(services, card)
    if (my !== seq.current) return
    setArt(r.art); setArtFailed(r.failed)
  }, [services, card])

  const loadPrints = useCallback(async () => {
    if (!card) return
    setPrints(null); setPrintsError(null)
    try { setPrints(await services.client.fetchPrints(card.name)) }
    catch { setPrintsError(PRINTS_ERROR) }
  }, [services, card])

  // Re-render whenever the card, art or settings change.
  useEffect(() => {
    if (!card) return
    let on = true
    const draw = (fontError: Error | null) => {
      if (!on) return
      setFontError(fontError)
      const r = renderProxy(card, art, settings, services.env)
      setBits(r.bits); setGeometry(r.geometry)
    }
    // A missing font (e.g. MPlantin without the local file) must not stall rendering: fall back and warn.
    ensureFonts(settings.fontFamily).then(
      () => draw(null),
      () => draw(new Error(`Font ${settings.fontFamily} could not be loaded; rendering with a fallback font.`)),
    )
    return () => { on = false }
  }, [card, art, settings, services.env])

  const allErrors = useMemo(
    () => [...errors, ...(artFailed ? [new ArtUnavailable()] : []), ...(fontError ? [fontError] : [])],
    [errors, artFailed, fontError],
  )

  return { state, card, bits, geometry, errors: allErrors, render, artRef, chooseArt, prints, printsError, loadPrints }
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/app/useProxy.test.tsx src/app/App.test.tsx`
Expected: PASS. The App test "renders a proxy and shows the art alert when art fails" still passes because `artFailed` produces the same `ArtUnavailable` alert.

- [ ] **Step 9: Commit**

```bash
git add src/app/resolveArt.ts src/app/resolveArt.test.ts src/app/useProxy.ts src/app/useProxy.test.tsx
git commit -m "feat(app): resolveArt honours the per-card art preference; useProxy exposes chooseArt and printings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Deck verify honours the art preference

**Files:**
- Modify: `src/app/useDeck.ts` (the art lines inside `verify`)
- Modify: `src/app/useDeck.test.tsx`

**Interfaces:**
- Consumes: `resolveArt` from `./resolveArt`

- [ ] **Step 1: Write the failing test**

Append to `src/app/useDeck.test.tsx`:

```tsx
import { setPreferredArt } from '../core/art/preference'
import type { GreyImage } from '../core/art/types'

describe('useDeck art preference', () => {
  it('fetches the remembered printing for a card during verify', async () => {
    const storage = memoryStorage(); setPreferredArt(storage, 'Lightning Bolt', 'ref1')
    const grey: GreyImage = { width: 1, height: 1, data: new Uint8Array([0]) } as unknown as GreyImage
    const fetchArtById = vi.fn(async () => new Blob([new Uint8Array([1])]))
    const { result } = hook(fakeServices({ storage, fetchArtById, decodeArt: async () => grey }))
    act(() => result.current.setText('1 Lightning Bolt\n1 Forest'))
    await act(() => result.current.verify())
    await waitFor(() => expect(result.current.state).toBe('ready'))
    expect(fetchArtById).toHaveBeenCalledTimes(1)
    expect(fetchArtById).toHaveBeenCalledWith('ref1')
    expect(result.current.run!.cards.find((c) => c.name === 'Lightning Bolt')!.art).toBe(grey)
    expect(result.current.run!.cards.find((c) => c.name === 'Forest')!.art).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/useDeck.test.tsx -t "art preference"`
Expected: FAIL, `fetchArtById` called 0 times.

- [ ] **Step 3: Use `resolveArt` in `verify`**

In `src/app/useDeck.ts`, add `import { resolveArt } from './resolveArt'` and replace these two lines inside `verify`:

```ts
          let art: GreyImage | null = null
          if (card.artUrl) { try { art = await services.decodeArt(await services.client.fetchArtBlob(card.artUrl)) } catch { art = null } }
```

with:

```ts
          const { art } = await resolveArt(services, card)
```

If `GreyImage` is now only used as a type elsewhere in the file keep the import; if it becomes unused, remove it so `noUnusedLocals` passes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/useDeck.test.tsx src/app/DeckPanel.test.tsx && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/useDeck.ts src/app/useDeck.test.tsx
git commit -m "feat(deck): verify uses the remembered art per card name

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: `useTokens` hook

**Files:**
- Create: `src/app/useTokens.ts`
- Create: `src/app/useTokens.test.tsx`

**Interfaces:**
- Consumes: `TokenIndex`, `TokenEntry`, `variantsOf`, `tokenNames`; `TokenDraft`, `DraftPatch`, `draftFromVariant`, `blankDraft`, `editDraft`, `normalizeDraft`; `renderProxy`; `toPacked`; `escposInit`, `escposRasterFrames`, `escposFeed`; `printJob`; `FEED_LINES_AFTER`, `FEED_LINES_BETWEEN_CARDS`; `PRINTER_MESSAGES` from `./usePrinter`; `ensureFonts` from `./browserEnv`
- Produces:
  - `TOKEN_DRAFT_KEY = 'hot-proxies.token.v1'`
  - `useTokens(services, settings)` returning `{ index, indexError, draft, entry, bits, geometry, artFailed, fontError, touched, loadNames, pickToken, pickVariant, startBlank, edit, printing, progress, print, cancel, printError, clearPrintError }`
  - `type UseTokens = ReturnType<typeof useTokens>`

- [ ] **Step 1: Write the failing tests**

Create `src/app/useTokens.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTokens, TOKEN_DRAFT_KEY } from './useTokens'
import { DEFAULT_SETTINGS } from '../core/settings'
import { fakeServices, memoryStorage, FIXTURE_TOKENS } from '../../tests/fakeServices'
import { fakePrinter } from '../../tests/fakePrinter'
import { draftFromVariant } from '../core/token/draft'
import type { GreyImage } from '../core/art/types'

vi.mock('./browserEnv', async (orig) => ({ ...(await orig<object>()), ensureFonts: async () => {} }))

const hook = (services = fakeServices()) => renderHook(() => useTokens(services, DEFAULT_SETTINGS))
const goblin = () => FIXTURE_TOKENS.tokens.find((t) => t.name === 'Goblin')!

describe('useTokens drafts', () => {
  it('loads the index, picks a token into a draft and renders it', async () => {
    const { result } = hook()
    await waitFor(() => expect(result.current.index).not.toBeNull())
    expect(await result.current.loadNames()).toEqual(['Goblin', 'Soldier', 'The Monarch', 'Treasure'])
    act(() => result.current.pickToken('Goblin'))
    expect(result.current.draft!.card.stat).toEqual({ kind: 'pt', power: '1', toughness: '1' })
    expect(result.current.entry!.name).toBe('Goblin')
    await waitFor(() => expect(result.current.bits).not.toBeNull())
    expect(result.current.geometry!.statBox).toBeDefined()
    expect(result.current.touched).toBe(false)
  })
  it('pickVariant rebuilds from that variant, edit applies a patch and marks touched, copies do not', async () => {
    const { result } = hook()
    await waitFor(() => expect(result.current.index).not.toBeNull())
    act(() => result.current.pickToken('Goblin'))
    act(() => result.current.edit({ name: 'Goblin Chief' }))
    expect(result.current.draft!.card.name).toBe('Goblin Chief'); expect(result.current.touched).toBe(true)
    act(() => result.current.pickVariant(1))
    expect(result.current.draft).toEqual(draftFromVariant(goblin(), 1)); expect(result.current.touched).toBe(false)
    act(() => result.current.edit({ copies: 4 }))
    expect(result.current.draft!.copies).toBe(4); expect(result.current.touched).toBe(false)
  })
  it('startBlank gives the blank token; the draft persists and is restored', async () => {
    const storage = memoryStorage()
    const { result } = hook(fakeServices({ storage }))
    act(() => result.current.startBlank())
    expect(result.current.draft!.card.name).toBe('Token')
    expect(JSON.parse(storage.map.get(TOKEN_DRAFT_KEY)!).card.name).toBe('Token')
    const again = hook(fakeServices({ storage }))
    expect(again.result.current.draft!.card.name).toBe('Token')
  })
  it('reports indexError when the token list cannot load', async () => {
    const { result } = hook(fakeServices({ loadTokens: async () => { throw new Error('404') } }))
    await waitFor(() => expect(result.current.indexError).toBe('Token list unavailable.'))
  })
})

describe('useTokens art', () => {
  it('fetches the draft art by ref and flags a failure', async () => {
    const grey: GreyImage = { width: 1, height: 1, data: new Uint8Array([0]) } as unknown as GreyImage
    const fetchArtById = vi.fn(async () => new Blob([new Uint8Array([1])]))
    const { result } = hook(fakeServices({ fetchArtById, decodeArt: async () => grey }))
    await waitFor(() => expect(result.current.index).not.toBeNull())
    act(() => result.current.pickToken('Treasure'))
    await waitFor(() => expect(fetchArtById).toHaveBeenCalledWith('aaaaaaaa000040008000000000000009'))
    await waitFor(() => expect(result.current.artFailed).toBe(false))
    const failing = hook()   // fetchArtById throws by default
    await waitFor(() => expect(failing.result.current.index).not.toBeNull())
    act(() => failing.result.current.pickToken('Treasure'))
    await waitFor(() => expect(failing.result.current.artFailed).toBe(true))
    act(() => failing.result.current.edit({ artRef: null }))
    await waitFor(() => expect(failing.result.current.artFailed).toBe(false))
  })
})

describe('useTokens printing', () => {
  it('sends one init, then raster and a gap feed per copy, with the tail feed last', async () => {
    const printer = fakePrinter('connected')
    const { result } = hook(fakeServices({ printer }))
    await waitFor(() => expect(result.current.index).not.toBeNull())
    act(() => result.current.pickToken('Treasure'))
    await waitFor(() => expect(result.current.bits).not.toBeNull())
    act(() => result.current.edit({ copies: 3 }))
    await act(() => result.current.print())
    const total = printer.writes.reduce((a, w) => a + w.length, 0)
    // 5 (ESC @ ESC a 0) + 3 x (9 raster blocks x 8 header bytes + 48 x 536 bytes + 3 feed bytes)
    expect(total).toBe(5 + 3 * (9 * 8 + 48 * 536 + 3))
    expect(Array.from(printer.writes[0])).toEqual([0x1b, 0x40, 0x1b, 0x61, 0x00])
    const stream = new Uint8Array(total); let o = 0; for (const w of printer.writes) { stream.set(w, o); o += w.length }
    let inits = 0; for (let i = 0; i < stream.length - 1; i++) if (stream[i] === 0x1b && stream[i + 1] === 0x40) inits++
    expect(inits).toBe(1)
    expect(Array.from(stream.subarray(stream.length - 3))).toEqual([0x1b, 0x64, 2])   // FEED_LINES_AFTER
    expect(result.current.printing).toBe(false)
  })
  it('reports a dropped connection as printError', async () => {
    const printer = fakePrinter('connected'); printer.failWrites = new Error('gatt')
    const { result } = hook(fakeServices({ printer }))
    await waitFor(() => expect(result.current.index).not.toBeNull())
    act(() => result.current.pickToken('Treasure'))
    await waitFor(() => expect(result.current.bits).not.toBeNull())
    await act(() => result.current.print())
    expect(result.current.printError).toMatch(/disconnected during printing/)
    act(() => result.current.clearPrintError())
    expect(result.current.printError).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/useTokens.test.tsx`
Expected: FAIL, cannot resolve `./useTokens`.

- [ ] **Step 3: Implement `src/app/useTokens.ts`**

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Services } from './services'
import type { Settings } from '../core/settings'
import type { TokenIndex, TokenEntry } from '../core/token/index'
import { tokenNames, variantsOf } from '../data/tokenIndex'
import { draftFromVariant, blankDraft, editDraft, normalizeDraft, type TokenDraft, type DraftPatch } from '../core/token/draft'
import type { GreyImage, BitImage } from '../core/art/types'
import type { Geometry } from '../core/layout/fit'
import { renderProxy } from '../core/render/renderProxy'
import { toPacked } from '../core/output/packed'
import { escposInit, escposRasterFrames, escposFeed } from '../core/output/escpos'
import { FEED_LINES_AFTER, FEED_LINES_BETWEEN_CARDS } from '../core/printer'
import { printJob } from '../core/printer/transport'
import { ensureFonts } from './browserEnv'
import { PRINTER_MESSAGES } from './usePrinter'

export const TOKEN_DRAFT_KEY = 'hot-proxies.token.v1'
export const TOKEN_INDEX_ERROR = 'Token list unavailable.'
type Store = Pick<Storage, 'getItem' | 'setItem'>

function loadDraft(store: Store): TokenDraft | null {
  try { return normalizeDraft(JSON.parse(store.getItem(TOKEN_DRAFT_KEY) ?? 'null')) } catch { return null }
}

/** Tokens mode: one editable draft, its art, its render, and printing N copies in one job. */
export function useTokens(services: Services, settings: Settings) {
  const [index, setIndex] = useState<TokenIndex | null>(null)
  const [indexError, setIndexError] = useState<string | null>(null)
  const [draft, setDraftState] = useState<TokenDraft | null>(() => loadDraft(services.storage))
  const [touched, setTouched] = useState(false)
  const [art, setArt] = useState<GreyImage | null>(null)
  const [artFailed, setArtFailed] = useState(false)
  const [bits, setBits] = useState<BitImage | null>(null)
  const [geometry, setGeometry] = useState<Geometry | null>(null)
  const [fontError, setFontError] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [printError, setPrintError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const artSeq = useRef(0)

  useEffect(() => {
    let on = true
    services.loadTokens().then((i) => { if (on) setIndex(i) }, () => { if (on) setIndexError(TOKEN_INDEX_ERROR) })
    return () => { on = false }
  }, [services])

  const setDraft = useCallback((d: TokenDraft | null) => {
    setDraftState(d)
    try { services.storage.setItem(TOKEN_DRAFT_KEY, JSON.stringify(d)) } catch { /* storage full or disabled: keep in memory */ }
  }, [services.storage])

  const loadNames = useCallback(() => services.loadTokens().then(tokenNames), [services])
  const entry = useMemo<TokenEntry | null>(() => (index && draft?.base ? variantsOf(index, draft.base.name) ?? null : null), [index, draft])

  const pickToken = useCallback((name: string) => {
    if (!index) return
    const e = variantsOf(index, name)
    if (!e) return
    setTouched(false); setDraft(draftFromVariant(e, 0))
  }, [index, setDraft])
  const pickVariant = useCallback((i: number) => { if (entry) { setTouched(false); setDraft(draftFromVariant(entry, i)) } }, [entry, setDraft])
  const startBlank = useCallback(() => { setTouched(false); setDraft(blankDraft()) }, [setDraft])
  const edit = useCallback((p: DraftPatch) => {
    if (!draft) return
    if (!('copies' in p)) setTouched(true)
    setDraft(editDraft(draft, p))
  }, [draft, setDraft])

  // Art follows the draft's art ref.
  const ref = draft?.artRef ?? null
  useEffect(() => {
    const my = ++artSeq.current
    if (!ref) { setArt(null); setArtFailed(false); return }
    services.client.fetchArtById(ref).then(services.decodeArt).then(
      (g) => { if (my === artSeq.current) { setArt(g); setArtFailed(false) } },
      () => { if (my === artSeq.current) { setArt(null); setArtFailed(true) } },
    )
  }, [ref, services])

  // Re-render whenever the card, art or settings change.
  const card = draft?.card ?? null
  useEffect(() => {
    if (!card) { setBits(null); setGeometry(null); return }
    let on = true
    const draw = (err: string | null) => {
      if (!on) return
      setFontError(err)
      const r = renderProxy(card, art, settings, services.env)
      setBits(r.bits); setGeometry(r.geometry)
    }
    ensureFonts(settings.fontFamily).then(
      () => draw(null),
      () => draw(`Font ${settings.fontFamily} could not be loaded; rendering with a fallback font.`),
    )
    return () => { on = false }
  }, [card, art, settings, services.env])

  /** One job: ESC @, then per copy the raster frames and a gap feed; the last copy gets the tail feed. */
  const print = useCallback(async () => {
    const printer = services.printer
    if (!bits || !draft || printer.state !== 'connected') return
    setPrinting(true); setPrintError(null); setProgress(0)
    const packed = toPacked(bits)
    const frames: Uint8Array[] = [escposInit()]
    for (let i = 0; i < draft.copies; i++) {
      frames.push(...escposRasterFrames(packed, bits.width, bits.height), escposFeed(i === draft.copies - 1 ? FEED_LINES_AFTER : FEED_LINES_BETWEEN_CARDS))
    }
    const ac = new AbortController(); abort.current = ac
    try {
      await printJob(printer, frames, { signal: ac.signal, onProgress: (sent, total) => setProgress(total ? sent / total : 0) })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setPrintError(PRINTER_MESSAGES.dropped)
    } finally {
      abort.current = null; setPrinting(false); setProgress(0)
    }
  }, [services.printer, bits, draft])

  const cancel = useCallback(() => { abort.current?.abort() }, [])
  const clearPrintError = useCallback(() => setPrintError(null), [])

  return { index, indexError, draft, entry, bits, geometry, artFailed, fontError, touched, loadNames, pickToken, pickVariant, startBlank, edit, printing, progress, print, cancel, printError, clearPrintError }
}

export type UseTokens = ReturnType<typeof useTokens>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/useTokens.test.tsx && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/useTokens.ts src/app/useTokens.test.tsx
git commit -m "feat(app): useTokens hook: draft state, persistence, art by ref, render, copies printing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Tokens mode: `useMode`, `ModeSwitch`, `SearchBox` labels, `TokensPanel`, `App` wiring

**Files:**
- Modify: `src/app/useMode.ts`
- Modify: `src/app/ModeSwitch.tsx`
- Modify: `src/app/SearchBox.tsx` (optional `label`, `placeholder`)
- Create: `src/app/TokensPanel.tsx`
- Create: `src/app/TokensPanel.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

**Interfaces:**
- Consumes: `UseTokens`; `EditablePreview`; `FieldDialog`, `FieldKind`; `ArtPickerDialog`, `ArtOption`; `variantLabel`; `artCropUrl`; `COPIES_MIN`, `COPIES_MAX`; `HotspotKind`
- Produces:
  - `type Mode = 'card' | 'deck' | 'tokens'`
  - `SearchBoxProps.label?: string` (default `'Card name'`), `SearchBoxProps.placeholder?: string` (default `'Lightning Bolt'`)
  - `interface TokensPanelProps { tokens: UseTokens; printerState: PrinterState; settings: Settings }`

- [ ] **Step 1: Write the failing `TokensPanel` tests**

Create `src/app/TokensPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TokensPanel } from './TokensPanel'
import { useTokens, TOKEN_DRAFT_KEY } from './useTokens'
import { DEFAULT_SETTINGS } from '../core/settings'
import { fakeServices, memoryStorage } from '../../tests/fakeServices'
import type { Services } from './services'

vi.mock('./browserEnv', async (orig) => ({ ...(await orig<object>()), ensureFonts: async () => {} }))

/** Mounts the real hook and the panel together so the panel is driven like in App. */
function Harness({ services }: { services: Services }) {
  const tokens = useTokens(services, DEFAULT_SETTINGS)
  return <TokensPanel tokens={tokens} printerState={services.printer.state} settings={DEFAULT_SETTINGS} />
}
const pickToken = async (name: string) => { await userEvent.type(screen.getByRole('combobox', { name: 'Token name' }), `${name}{enter}`) }

describe('TokensPanel', () => {
  it('starts with a hint, picks a token, shows the hotspots and the copies row', async () => {
    const s = fakeServices()
    render(<Harness services={s} />)
    expect(screen.getByText(/Type a token name/)).toBeInTheDocument()
    await pickToken('Treasure')
    await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Edit name' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit power and toughness' })).toBeInTheDocument()
    expect(screen.getByText('Tap a part of the card to edit it.')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Copies' })).toHaveValue(1)
    expect(screen.queryByRole('group', { name: 'Variants' })).toBeNull()
  })
  it('shows variant chips for Goblin and switches the draft', async () => {
    const storage = memoryStorage()
    render(<Harness services={fakeServices({ storage })} />)
    await pickToken('Goblin')
    const group = await screen.findByRole('group', { name: 'Variants' })
    const chips = within(group).getAllByRole('button')
    expect(chips.map((c) => c.textContent)).toEqual(['1/1 · Haste', '1/1'])
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(chips[1])
    await waitFor(() => expect(JSON.parse(storage.map.get(TOKEN_DRAFT_KEY)!).base.variant).toBe(1))
    expect(JSON.parse(storage.map.get(TOKEN_DRAFT_KEY)!).card.oracleText).toBe('')
  })
  it('opens the stat dialog from its hotspot and saves the edit into the draft', async () => {
    const storage = memoryStorage()
    render(<Harness services={fakeServices({ storage })} />)
    await pickToken('Goblin')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit power and toughness' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Edit power and toughness' }))
    const power = await screen.findByRole('textbox', { name: 'Power' })
    await userEvent.clear(power); await userEvent.type(power, '3')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(JSON.parse(storage.map.get(TOKEN_DRAFT_KEY)!).card.stat).toEqual({ kind: 'pt', power: '3', toughness: '1' }))
    expect(screen.queryByText('Tap a part of the card to edit it.')).toBeNull()
  })
  it('opens the art picker with the variant printings first and stores the pick', async () => {
    const storage = memoryStorage()
    render(<Harness services={fakeServices({ storage })} />)
    await pickToken('Goblin')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change art' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Change art' }))
    const dialog = await screen.findByRole('dialog', { name: 'Choose art' })
    const tiles = within(dialog).getAllByRole('button')
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(['No art', 'Art 1', 'Art 2', 'Art 3', 'Art 4'])
    expect(within(dialog).getByText('This variant')).toBeInTheDocument()
    expect(within(dialog).getByText('Other printings of this name')).toBeInTheDocument()
    expect(within(dialog).getByRole('img', { name: 'Art 3' })).toHaveAttribute('src', 'https://cards.scryfall.io/art_crop/front/a/a/aaaaaaaa-0000-4000-8000-000000000004.jpg')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Art 3' }))
    await waitFor(() => expect(JSON.parse(storage.map.get(TOKEN_DRAFT_KEY)!).artRef).toBe('aaaaaaaa000040008000000000000004'))
  })
  it('copies stepper clamps and Blank token starts a draft', async () => {
    const storage = memoryStorage()
    render(<Harness services={fakeServices({ storage })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Blank token' }))
    await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Fewer copies' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'More copies' }))
    expect(screen.getByRole('spinbutton', { name: 'Copies' })).toHaveValue(2)
    const field = screen.getByRole('spinbutton', { name: 'Copies' })
    await userEvent.clear(field); await userEvent.type(field, '500')
    await waitFor(() => expect(JSON.parse(storage.map.get(TOKEN_DRAFT_KEY)!).copies).toBe(99))
    expect(screen.getByRole('button', { name: 'More copies' })).toBeDisabled()
  })
  it('survives a restored draft whose variant index no longer exists', async () => {
    const storage = memoryStorage()
    storage.map.set(TOKEN_DRAFT_KEY, JSON.stringify({ base: { name: 'Goblin', variant: 7 }, card: { name: 'Goblin', manaCost: '', typeLine: 'Token Creature — Goblin', oracleText: '' }, artRef: null, copies: 1 }))
    render(<Harness services={fakeServices({ storage })} />)
    await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument())
    const group = await screen.findByRole('group', { name: 'Variants' })
    expect(within(group).getAllByRole('button').every((c) => c.getAttribute('aria-pressed') === 'false')).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Change art' }))
    const dialog = await screen.findByRole('dialog', { name: 'Choose art' })
    expect(within(dialog).getAllByRole('button').length).toBe(5)   // none + 4 Goblin printings, first variant treated as current
  })
  it('shows the token list error and keeps Blank token usable', async () => {
    render(<Harness services={fakeServices({ loadTokens: async () => { throw new Error('404') } })} />)
    await waitFor(() => expect(screen.getByText('Token list unavailable.')).toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: 'Token name' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Blank token' }))
    await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Write the failing `App` mode tests**

In `src/app/App.test.tsx`, inside `describe('App modes', ...)`, add:

```tsx
  it('switches to Tokens, persists it, and prints copies through the shared printer', async () => {
    const store = new Map<string, string>()
    const printer = fakePrinter('connected'); printer.name = 'PT210_FAKE'
    const s = services(async () => bolt, printer)
    s.storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v) } }
    render(<App services={s} />)
    await userEvent.click(screen.getByRole('button', { name: 'Tokens' }))
    expect(store.get('hot-proxies.mode.v1')).toBe('"tokens"')
    await userEvent.type(screen.getByRole('combobox', { name: 'Token name' }), 'Treasure{enter}')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'More copies' }))
    await userEvent.click(screen.getByRole('button', { name: 'Print' }))
    await waitFor(() => expect(printer.writes.reduce((a, w) => a + w.length, 0)).toBe(5 + 2 * (9 * 8 + 48 * 536 + 3)))
  })
  it('opens in Tokens mode when that was stored', () => {
    const s = services(async () => bolt)
    s.storage = { getItem: (k) => (k === 'hot-proxies.mode.v1' ? '"tokens"' : null), setItem: () => {} }
    render(<App services={s} />)
    expect(screen.getByRole('combobox', { name: 'Token name' })).toBeInTheDocument()
  })
  it('shows a token print drop in the shared snackbar', async () => {
    const printer = fakePrinter('connected'); printer.name = 'PT210_FAKE'; printer.failWrites = new Error('gatt')
    const s = services(async () => bolt, printer)
    s.storage = { getItem: (k) => (k === 'hot-proxies.mode.v1' ? '"tokens"' : null), setItem: () => {} }
    render(<App services={s} />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Token name' }), 'Treasure{enter}')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Print' }))
    expect(await screen.findByText(/disconnected during printing/)).toBeInTheDocument()
  })
```

The `services` helper in that file (rewritten in Task 7) already builds on `fakeServices`, so `loadTokens` returns the fixture index.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/app/TokensPanel.test.tsx src/app/App.test.tsx`
Expected: FAIL, cannot resolve `./TokensPanel`; App tests find no "Tokens" button.

- [ ] **Step 4: Extend `useMode` and `ModeSwitch`**

`src/app/useMode.ts`:

```ts
import { useCallback, useState } from 'react'

export type Mode = 'card' | 'deck' | 'tokens'
export const MODES: readonly Mode[] = ['card', 'deck', 'tokens']
export const MODE_KEY = 'hot-proxies.mode.v1'
type Store = Pick<Storage, 'getItem' | 'setItem'>

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
```

`src/app/ModeSwitch.tsx`: add `import TokenIcon from '@mui/icons-material/Token'` and a third entry in `MODES`:

```tsx
  { value: 'tokens', label: 'Tokens', icon: <TokenIcon /> },
```

- [ ] **Step 5: Parameterise `SearchBox`**

In `src/app/SearchBox.tsx`:

```tsx
export interface SearchBoxProps { loadNames(): Promise<string[]>; onPick(exactName: string): void; disabled?: boolean; label?: string; placeholder?: string }

export function SearchBox({ loadNames, onPick, disabled, label = 'Card name', placeholder = 'Lightning Bolt' }: SearchBoxProps) {
  // ...unchanged...
      renderInput={(params) => <TextField {...params} label={label} placeholder={placeholder} autoFocus />}
```

- [ ] **Step 6: Implement `src/app/TokensPanel.tsx`**

```tsx
import { useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import type { PrinterState } from '../core/printer/transport'
import type { Settings } from '../core/settings'
import type { CardData } from '../core/card/types'
import type { HotspotKind } from '../core/token/hotspots'
import { variantLabel } from '../core/token/index'
import { COPIES_MIN, COPIES_MAX } from '../core/token/draft'
import { artCropUrl } from '../data/artRef'
import type { UseTokens } from './useTokens'
import { SearchBox } from './SearchBox'
import { EditablePreview } from './EditablePreview'
import { FieldDialog, type FieldKind } from './FieldDialog'
import { ArtPickerDialog, type ArtOption } from './ArtPickerDialog'

export interface TokensPanelProps { tokens: UseTokens; printerState: PrinterState; settings: Settings }

const ALL_HOTSPOTS: HotspotKind[] = ['name', 'art', 'type', 'rules', 'stat']
const EMPTY_CARD: CardData = { name: '', manaCost: '', typeLine: '', oracleText: '' }

export function TokensPanel({ tokens, printerState, settings }: TokensPanelProps) {
  const [field, setField] = useState<FieldKind | null>(null)
  const [artOpen, setArtOpen] = useState(false)
  const { draft, entry, bits, geometry } = tokens
  const busy = tokens.printing
  // A draft restored after tokens.json was rebuilt may point past the current variants: treat the first as current.
  const variantIndex = entry && draft?.base ? (entry.variants[draft.base.variant] ? draft.base.variant : 0) : 0
  const variantKnown = !!entry && !!draft?.base && !!entry.variants[draft.base.variant]

  const artOptions = useMemo<ArtOption[]>(() => {
    if (!entry) return []
    const current = entry.variants[variantIndex]
    const refs = [
      ...current.prints.map((ref) => ({ ref, group: 'This variant' })),
      ...entry.variants.flatMap((v, i) => (i === variantIndex ? [] : v.prints)).filter((ref) => !current.prints.includes(ref)).map((ref) => ({ ref, group: 'Other printings of this name' })),
    ]
    return refs.map((r, i) => ({ ref: r.ref, thumbUrl: artCropUrl(r.ref) ?? '', label: `Art ${i + 1}`, group: r.group }))
  }, [entry, variantIndex])

  const onEdit = (kind: HotspotKind) => { if (kind === 'art') setArtOpen(true); else setField(kind) }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Box sx={{ flexGrow: 1 }}>
          <SearchBox loadNames={tokens.loadNames} onPick={tokens.pickToken} disabled={busy || !!tokens.indexError} label="Token name" placeholder="Treasure" />
        </Box>
        <Button onClick={tokens.startBlank} disabled={busy}>Blank token</Button>
      </Stack>
      {tokens.indexError && <Alert severity="error">{tokens.indexError}</Alert>}
      {entry && entry.variants.length > 1 && (
        <Stack direction="row" spacing={1} role="group" aria-label="Variants" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {entry.variants.map((v, i) => {
            const on = variantKnown && i === variantIndex
            return (
              <Tooltip key={i} title={<span style={{ whiteSpace: 'pre-line' }}>{v.oracleText ? `${v.typeLine}\n${v.oracleText}` : v.typeLine}</span>}>
                <Chip label={variantLabel(v)} clickable aria-pressed={on} color={on ? 'primary' : 'default'} variant="outlined" disabled={busy}
                  onClick={() => tokens.pickVariant(i)} />
              </Tooltip>
            )
          })}
        </Stack>
      )}
      {tokens.artFailed && <Alert severity="info">Art could not be loaded; rendering without it.</Alert>}
      {tokens.fontError && <Alert severity="info">{tokens.fontError}</Alert>}
      {geometry?.overflow && <Alert severity="warning">Rules text was clipped to fit.</Alert>}
      {!draft && <Typography color="text.secondary">Type a token name, or start from a blank token.</Typography>}
      {draft && bits && geometry && (
        <>
          <EditablePreview bits={bits} geometry={geometry} dotsPerLine={settings.dotsPerLine} dpi={settings.dpi}
            enabled={ALL_HOTSPOTS} disabled={busy} onEdit={onEdit}
            print={{ state: printerState, progress: tokens.progress, onPrint: () => { void tokens.print() }, onCancel: tokens.cancel }} />
          {!tokens.touched && <Typography variant="body2" color="text.secondary" align="center">Tap a part of the card to edit it.</Typography>}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'center' }}>
            <Typography>Copies</Typography>
            <IconButton aria-label="Fewer copies" size="small" disabled={busy || draft.copies <= COPIES_MIN} onClick={() => tokens.edit({ copies: draft.copies - 1 })}><RemoveIcon /></IconButton>
            <TextField size="small" type="number" value={draft.copies} disabled={busy}
              slotProps={{ htmlInput: { min: COPIES_MIN, max: COPIES_MAX, 'aria-label': 'Copies', style: { width: 48, textAlign: 'center' } } }}
              onChange={(e) => tokens.edit({ copies: Number(e.target.value) })} />
            <IconButton aria-label="More copies" size="small" disabled={busy || draft.copies >= COPIES_MAX} onClick={() => tokens.edit({ copies: draft.copies + 1 })}><AddIcon /></IconButton>
          </Stack>
        </>
      )}
      <FieldDialog field={busy ? null : field} card={draft?.card ?? EMPTY_CARD} onSave={(p) => { tokens.edit(p); setField(null) }} onClose={() => setField(null)} />
      <ArtPickerDialog open={artOpen && !busy} options={artOptions} current={draft?.artRef ?? null} noneLabel="No art"
        onPick={(ref) => tokens.edit({ artRef: ref })} onClose={() => setArtOpen(false)} />
    </Stack>
  )
}
```

- [ ] **Step 7: Wire `App.tsx`**

In `src/app/App.tsx`:

```tsx
import { useTokens } from './useTokens'
import { TokensPanel } from './TokensPanel'
```

Inside `App`, after `const deck = useDeck(services, settings)`:

```tsx
  const tokens = useTokens(services, settings)
```

Extend the snackbar source and its reset:

```tsx
  const snack = printer.error ?? (deck.state === 'paused' ? deck.error : null) ?? tokens.printError
  const clearSnack = () => { printer.clearError(); deck.clearError(); tokens.clearPrintError() }
```

After the `{mode === 'deck' && ...}` line add:

```tsx
            {mode === 'tokens' && <TokensPanel tokens={tokens} printerState={printer.state} settings={settings} />}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/app && npm run typecheck`
Expected: PASS for TokensPanel, App, SearchBox and the rest; typecheck clean. If the Copies spinbutton test fails because `userEvent.type` appends to the existing value, clear first (the test already does) and check that `Number('500')` reaches `edit` and is clamped to 99.

- [ ] **Step 9: Commit**

```bash
git add src/app/useMode.ts src/app/ModeSwitch.tsx src/app/SearchBox.tsx src/app/TokensPanel.tsx src/app/TokensPanel.test.tsx src/app/App.tsx src/app/App.test.tsx
git commit -m "feat(app): Tokens mode with search, variant chips, hotspot editing, art picker and copies

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Card mode art hotspot and picker

**Files:**
- Modify: `src/app/App.tsx` (Card mode preview block)
- Modify: `src/app/App.test.tsx`

**Interfaces:**
- Consumes: `useProxy().artRef / chooseArt / prints / printsError / loadPrints`; `EditablePreview`; `ArtPickerDialog`

- [ ] **Step 1: Write the failing test**

Add to `src/app/App.test.tsx` a new describe block:

```tsx
describe('App card art picker', () => {
  it('opens the printings from the art hotspot, stores the pick and reloads the art', async () => {
    const store = new Map<string, string>()
    const prints = [
      { ref: 'aaaaaaaa000040008000000000000001', artUrl: 'https://c/1.jpg', set: 'lea', released: '1993-08-05' },
      { ref: 'aaaaaaaa000040008000000000000002', artUrl: 'https://c/2.jpg', set: 'm10', released: '2009-07-17' },
    ]
    const fetchArtById = vi.fn(async () => { throw new Error('no art in tests') })
    const s = fakeServices({ fetchCard: async () => bolt, fetchPrints: async () => prints, fetchArtById, storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v) } } })
    render(<App services={s} />)
    await pick('Lightning Bolt')
    await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Edit name' })).toBeNull()      // Card mode: art only
    await userEvent.click(screen.getByRole('button', { name: 'Change art' }))
    const dialog = await screen.findByRole('dialog', { name: 'Choose art' })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'M10 2009-07-17' })).toBeInTheDocument())
    expect(within(dialog).getByRole('button', { name: 'Default art' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(dialog).getByRole('button', { name: 'M10 2009-07-17' }))
    await waitFor(() => expect(JSON.parse(store.get('hot-proxies.art.v1')!)).toEqual({ 'Lightning Bolt': 'aaaaaaaa000040008000000000000002' }))
    expect(fetchArtById).toHaveBeenCalledWith('aaaaaaaa000040008000000000000002')
  })
  it('shows the printings error inside the dialog', async () => {
    const s = fakeServices({ fetchCard: async () => bolt, fetchPrints: async () => { throw new Error('boom') }, storage: { getItem: () => null, setItem: () => {} } })
    render(<App services={s} />)
    await pick('Lightning Bolt')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change art' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Change art' }))
    await waitFor(() => expect(screen.getByText('Could not load other printings.')).toBeInTheDocument())
  })
})
```

Add `within` to the `@testing-library/react` import of that file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/App.test.tsx -t "art picker"`
Expected: FAIL, no button named "Change art".

- [ ] **Step 3: Replace the Card mode preview in `App.tsx`**

Imports:

```tsx
import { EditablePreview } from './EditablePreview'
import { ArtPickerDialog } from './ArtPickerDialog'
```

State next to `drawer`:

```tsx
  const [artOpen, setArtOpen] = useState(false)
```

Rename the destructured proxy so its new fields are reachable:

```tsx
  const proxy = useProxy(services, settings)
  const { state, card, bits, geometry, errors, render } = proxy
```

Replace the `<Preview ... />` block inside `state === 'rendered' && card && bits && (...)` with:

```tsx
              <EditablePreview bits={bits} geometry={geometry!} dotsPerLine={settings.dotsPerLine} dpi={settings.dpi}
                enabled={['art']} disabled={printer.state === 'printing'}
                onEdit={() => { setArtOpen(true); void proxy.loadPrints() }}
                print={{ state: printer.state, progress: printer.progress, onPrint: () => { void printer.print(bits) }, onCancel: printer.cancel }} />
```

and make the condition `state === 'rendered' && card && bits && geometry && (` so the non-null assertion can go. After the `</>` that closes the Card mode block, within the same `Stack`, add:

```tsx
            <ArtPickerDialog open={artOpen && mode === 'card'} current={proxy.artRef} noneLabel="Default art"
              options={proxy.prints?.map((p) => ({ ref: p.ref, thumbUrl: p.artUrl, label: `${p.set.toUpperCase()} ${p.released}` })) ?? null}
              error={proxy.printsError}
              onPick={(ref) => { void proxy.chooseArt(ref) }} onClose={() => setArtOpen(false)} />
```

Remove the now-unused `Preview` import from `App.tsx` if nothing else uses it there.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/App.test.tsx && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/App.tsx src/app/App.test.tsx
git commit -m "feat(app): Card mode art hotspot opens the printings picker; choice remembered per card

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: Docs, full verification, manual check

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md` (only if it lists the modes or commands)

- [ ] **Step 1: Update `CLAUDE.md`**

In the **Commands** block add after `build:names`:

```
npm run build:tokens         # rebuild public/tokens.json from Scryfall search (token sets + emblems, every printing)
```

In **Architecture**, add a bullet after the Deck printing bullet:

```
- **Tokens mode** — `core/token/index.ts` (the `tokens.json` shape and the pure grouping the build script uses), `core/token/draft.ts` (editable `TokenDraft`: card fields, art ref, copies; every field is the user's after a pick), `core/token/hotspots.ts` (clickable rects from `Geometry`). `app/useTokens.ts` owns the draft, fetches art by ref, renders with `renderProxy` unchanged, and prints N copies as one job (one `escposInit`, gap feed between copies). `TokensPanel` shows search, variant chips, `EditablePreview` (hotspot buttons over the bitmap, percent-positioned), `FieldDialog` and `ArtPickerDialog`. Design: `docs/superpowers/specs/2026-10-17-tokens-mode-design.md`.
- **Art preference** — `core/art/preference.ts` remembers a printing per card name (`hot-proxies.art.v1`); `app/resolveArt.ts` applies it for Card and Deck mode. Art refs are Scryfall ids without hyphens, `:1` for a back face (`data/artRef.ts`); the client's `fetchArtById` tries the CDN path and falls back to the card JSON, `fetchPrints` lists a card's printings.
```

In **Design decisions that constrain changes** add:

```
- Tokens are never looked up by name on Scryfall (names are ambiguous); everything comes from `public/tokens.json` plus art by id. Two-faced tokens are split into one entry per face at build time. Helper cards (The Monarch, The Ring Tempts You, The Initiative, City's Blessing) are tokens in Scryfall's data, so no rules text is hand-written.
```

In **Repo notes** mention `public/tokens.json` beside `names.json` as a committed, regenerated file.

- [ ] **Step 2: Run the whole suite and build**

Run: `npm test && npm run build`
Expected: all tests pass, typecheck clean, `dist/` builds with `tokens.json` in the precache manifest (check `dist/sw.js` contains `tokens.json`).

- [ ] **Step 3: Manual check in the browser**

Run `npm run dev`, open http://localhost:5173 and check:

1. Tokens chip appears; typing "trea" suggests Treasure; picking renders a cost-free card with an art crop.
2. Typing "gob" and picking Goblin shows two or more variant chips; switching chips re-renders.
3. Hovering the preview outlines each region; tapping the P/T box opens the stat dialog; saving re-renders.
4. Tapping the art opens the scroller with colour thumbnails; picking one re-dithers the art.
5. Copies 3 with the printer connected prints three cards with cut gaps and one init (if the printer is at hand).
6. Card mode: Lightning Bolt, tap the art, pick an old printing; reload the page, render it again, the same art is used; Deck mode with "1 Lightning Bolt" uses it too.

Note anything that differs from the spec as a follow-up; do not fix layout drift silently.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: Tokens mode, art preference and build:tokens in CLAUDE.md

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

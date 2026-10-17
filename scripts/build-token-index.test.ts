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

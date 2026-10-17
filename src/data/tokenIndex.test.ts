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

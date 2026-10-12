import { describe, it, expect, vi } from 'vitest'
import { createScryfallClient, memoryKeyValue } from './scryfall'
import { CardNotFound, NetworkError, ArtUnavailable } from '../core/errors'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function setup(responses: Array<Response | Error>, minIntervalMs = 0) {
  const calls: string[] = []
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input))
    const r = responses.shift()
    if (r instanceof Error) throw r
    return r ?? json({}, 500)
  }) as unknown as typeof fetch
  const sleeps: number[] = []
  let t = 0
  const client = createScryfallClient({ fetchFn, cache: memoryKeyValue(), minIntervalMs, sleep: async (ms) => { sleeps.push(ms); t += ms }, now: () => t })
  return { client, calls, sleeps, fetchFn }
}

describe('fetchCard', () => {
  it('URL-encodes the name and returns the JSON', async () => {
    const { client, calls } = setup([json({ object: 'card', name: "Lim-Dûl's Vault" })])
    const card = await client.fetchCard("Lim-Dûl's Vault")
    expect(card).toMatchObject({ name: "Lim-Dûl's Vault" })
    expect(calls[0]).toBe(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent("Lim-Dûl's Vault")}`)
  })
  it('serves repeat requests from the cache without fetching', async () => {
    const { client, fetchFn } = setup([json({ object: 'card', name: 'Forest' })])
    await client.fetchCard('Forest'); await client.fetchCard('Forest')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
  it('throws CardNotFound on 404', async () => {
    const { client } = setup([json({ object: 'error', code: 'not_found' }, 404)])
    await expect(client.fetchCard('Nope')).rejects.toBeInstanceOf(CardNotFound)
  })
  it('retries once after 1 s on 429, then surfaces NetworkError', async () => {
    const { client, sleeps, fetchFn } = setup([json({}, 429), json({}, 429)])
    await expect(client.fetchCard('Forest')).rejects.toBeInstanceOf(NetworkError)
    expect(fetchFn).toHaveBeenCalledTimes(2); expect(sleeps).toContain(1000)
  })
  it('recovers when the retry succeeds', async () => {
    const { client } = setup([json({}, 429), json({ object: 'card', name: 'Forest' })])
    await expect(client.fetchCard('Forest')).resolves.toMatchObject({ name: 'Forest' })
  })
  it('maps a thrown fetch to NetworkError', async () => {
    const { client } = setup([new TypeError('Failed to fetch')])
    await expect(client.fetchCard('Forest')).rejects.toBeInstanceOf(NetworkError)
  })
  it('spaces consecutive requests by the minimum interval', async () => {
    const { client, sleeps } = setup([json({ object: 'card', name: 'A' }), json({ object: 'card', name: 'B' })], 100)
    await client.fetchCard('A'); await client.fetchCard('B')
    expect(sleeps.some((ms) => ms > 0 && ms <= 100)).toBe(true)
  })
})

describe('fetchArtBlob', () => {
  it('returns and caches the blob', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
    const { client, fetchFn } = setup([new Response(blob, { status: 200 })])
    const a = await client.fetchArtBlob('https://cards.scryfall.io/art_crop/x.jpg')
    const b = await client.fetchArtBlob('https://cards.scryfall.io/art_crop/x.jpg')
    expect(a.size).toBe(3); expect(b.size).toBe(3); expect(fetchFn).toHaveBeenCalledTimes(1)
  })
  it('throws ArtUnavailable on failure', async () => {
    const { client } = setup([new Response('', { status: 404 })])
    await expect(client.fetchArtBlob('https://cards.scryfall.io/art_crop/x.jpg')).rejects.toBeInstanceOf(ArtUnavailable)
  })
})

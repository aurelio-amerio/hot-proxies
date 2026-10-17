import { describe, it, expect, vi } from 'vitest'
import { createScryfallClient, memoryKeyValue, PRINTS_PAGE_CAP } from './scryfall'
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
    expect(calls[0]).toBe("https://api.scryfall.com/cards/search?q=!%22Smuggler's%20Copter%22&unique=prints&order=released&dir=desc")
    expect(calls[1]).toBe('https://api.scryfall.com/cards/search?page=2')
    expect(prints).toEqual([
      { ref: 'aaaaaaaa000040008000000000000001', artUrl: 'https://c/1.jpg', set: 'lea', released: '1993-08-05' },
      { ref: 'aaaaaaaa000040008000000000000003', artUrl: 'https://c/3.jpg', set: 'm10', released: '2009-07-17' },
    ])
    await client.fetchPrints("Smuggler's Copter")
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
  it('escapes double quotes inside the name', async () => {
    const { client, calls } = setup([json({ data: [], has_more: false })])
    await client.fetchPrints('Kongming, "Sleeping Dragon"')
    expect(calls[0]).toBe('https://api.scryfall.com/cards/search?q=!%22Kongming%2C%20%5C%22Sleeping%20Dragon%5C%22%22&unique=prints&order=released&dir=desc')
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

import { describe, it, expect, vi } from 'vitest'
import { resolveArt } from './resolveArt'
import { loadCard } from './loadCard'
import { sheetFaces, standardSheet, type ProxyCard } from '../core/card/types'
import { fakeServices, memoryStorage, FAKE_GREY } from '../../tests/fakeServices'
import { setPreferredArt } from '../core/art/preference'
import type { CardData } from '../core/card/types'

const grey = FAKE_GREY
const bolt: CardData = { name: 'Lightning Bolt', manaCost: '{R}', typeLine: 'Instant', oracleText: 'x', artUrl: 'https://c/bolt.jpg' }
const one = (face: CardData): ProxyCard => ({ name: face.name, sheets: [standardSheet(face)] })
const blob = new Blob([new Uint8Array([1])])

describe('resolveArt', () => {
  it('uses the card art when no preference is stored', async () => {
    const fetchArtById = vi.fn(async (_ref: string) => blob)
    const s = fakeServices({ fetchArtById, decodeArt: async () => grey })
    s.client.fetchArtBlob = vi.fn(async () => blob)
    expect(await resolveArt(s, one(bolt))).toEqual([{ art: grey, failed: false }])
    expect(fetchArtById).not.toHaveBeenCalled(); expect(s.client.fetchArtBlob).toHaveBeenCalledWith('https://c/bolt.jpg')
  })
  it('uses the preferred printing first, and falls back to the card art when it fails', async () => {
    const storage = memoryStorage(); setPreferredArt(storage, 'Lightning Bolt', 'ref1')
    const ok = fakeServices({ storage, fetchArtById: vi.fn(async () => blob), decodeArt: async () => grey })
    ok.client.fetchArtBlob = vi.fn(async () => { throw new Error('should not be called') })
    expect((await resolveArt(ok, one(bolt)))[0].art).toBe(grey)
    expect(ok.client.fetchArtById).toHaveBeenCalledWith('ref1')
    const failing = fakeServices({ storage, fetchArtById: async () => { throw new Error('404') }, decodeArt: async () => grey })
    failing.client.fetchArtBlob = vi.fn(async () => blob)
    expect(await resolveArt(failing, one(bolt))).toEqual([{ art: grey, failed: false }])
    expect(failing.client.fetchArtBlob).toHaveBeenCalled()
  })
  it('reports failed when the card has art that cannot be loaded, and not for art-less cards', async () => {
    const s = fakeServices()   // fetchArtBlob throws by default
    expect(await resolveArt(s, one(bolt))).toEqual([{ art: null, failed: true }])
    expect(await resolveArt(s, one({ ...bolt, artUrl: undefined }))).toEqual([{ art: null, failed: false }])
  })
})

describe('resolveArt per sheet', () => {
  const ref = 'abcdef0123456789abcdef0123456789'
  const load = async (s: ReturnType<typeof fakeServices>, name: string) => (await loadCard(s, name)).card

  it('uses the remembered ref for the front and ref:1 for the back of a pair', async () => {
    const storage = memoryStorage()
    const fetchArtById = vi.fn(async (_ref: string) => blob)
    const s = fakeServices({ storage, fetchArtById, decodeArt: async () => grey })
    const card = await load(s, 'Delver of Secrets')
    setPreferredArt(storage, card.name, ref)
    expect(await resolveArt(s, card)).toEqual([{ art: grey, failed: false }, { art: grey, failed: false }])
    expect(fetchArtById.mock.calls.map((c) => c[0])).toEqual([ref, `${ref}:1`])
  })
  it("falls back to the back face's own crop when the :1 fetch fails", async () => {
    const storage = memoryStorage()
    const fetchArtById = vi.fn(async (r: string) => { if (r.endsWith(':1')) throw new Error('404'); return blob })
    const s = fakeServices({ storage, fetchArtById, decodeArt: async () => grey })
    s.client.fetchArtBlob = vi.fn(async () => blob)
    const card = await load(s, 'Delver of Secrets')
    setPreferredArt(storage, card.name, ref)
    const url = sheetFaces(card.sheets[1]!)[0].artUrl
    expect(url).toBeTruthy()
    expect(await resolveArt(s, card)).toEqual([{ art: grey, failed: false }, { art: grey, failed: false }])
    expect(s.client.fetchArtBlob).toHaveBeenCalledWith(url)
  })
  it('reports failed for a sheet when neither the ref nor the crop loads', async () => {
    const storage = memoryStorage()
    const s = fakeServices({ storage, fetchArtById: async () => { throw new Error('404') }, decodeArt: async () => grey })
    const card = await load(s, 'Delver of Secrets')
    setPreferredArt(storage, card.name, ref)
    expect(await resolveArt(s, card)).toEqual([{ art: null, failed: true }, { art: null, failed: true }])
  })
  it("loads a meld back from its own artUrl and ignores the preference", async () => {
    const storage = memoryStorage()
    const fetchArtById = vi.fn(async (_ref: string) => blob)
    const s = fakeServices({ storage, fetchArtById, decodeArt: async () => grey })
    s.client.fetchArtBlob = vi.fn(async () => blob)
    const card = await load(s, 'Hanweir Battlements')
    setPreferredArt(storage, card.name, ref)
    const res = await resolveArt(s, card)
    expect(res).toHaveLength(2)
    expect(fetchArtById.mock.calls.map((c) => c[0])).toEqual([ref])
    expect(s.client.fetchArtBlob).toHaveBeenCalledWith(sheetFaces(card.sheets[1]!)[0].artUrl)
  })
})

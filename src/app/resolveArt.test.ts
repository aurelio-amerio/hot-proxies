import { describe, it, expect, vi } from 'vitest'
import { resolveArt } from './resolveArt'
import { fakeServices, memoryStorage, FAKE_GREY } from '../../tests/fakeServices'
import { setPreferredArt } from '../core/art/preference'
import type { CardData } from '../core/card/types'

const grey = FAKE_GREY
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

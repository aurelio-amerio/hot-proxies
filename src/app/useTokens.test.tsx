// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTokens, TOKEN_DRAFT_KEY } from './useTokens'
import { DEFAULT_SETTINGS } from '../core/settings'
import { fakeServices, memoryStorage, FIXTURE_TOKENS, FAKE_GREY } from '../../tests/fakeServices'
import { fakePrinter } from '../../tests/fakePrinter'
import { draftFromVariant } from '../core/token/draft'
import { toPacked } from '../core/output/packed'
import { escposInit, escposRasterFrames, escposFeed } from '../core/output/escpos'
import { FEED_LINES_AFTER, FEED_LINES_BETWEEN_CARDS } from '../core/printer'
import { renderProxy } from '../core/render/renderProxy'
import type { TokenDraft } from '../core/token/draft'
import type { BitImage } from '../core/art/types'

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
  it('applies two edits made in the same tick and persists the result', async () => {
    const storage = memoryStorage()
    const { result } = hook(fakeServices({ storage }))
    act(() => result.current.startBlank())
    act(() => { result.current.edit({ name: 'Two Edits' }); result.current.edit({ copies: 5 }) })
    expect(result.current.draft!.card.name).toBe('Two Edits')
    expect(result.current.draft!.copies).toBe(5)
    const saved = JSON.parse(storage.map.get(TOKEN_DRAFT_KEY)!)
    expect(saved.card.name).toBe('Two Edits'); expect(saved.copies).toBe(5)
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
    const fetchArtById = vi.fn(async () => new Blob([new Uint8Array([1])]))
    const decodeArt = vi.fn(async () => FAKE_GREY)
    const { result } = hook(fakeServices({ fetchArtById, decodeArt }))
    await waitFor(() => expect(result.current.index).not.toBeNull())
    act(() => result.current.pickToken('Treasure'))
    const ref = result.current.draft!.artRef
    expect(ref).toBe('aaaaaaaa000040008000000000000009')
    await waitFor(() => expect(fetchArtById).toHaveBeenCalledWith(ref))
    await waitFor(() => expect(decodeArt).toHaveBeenCalled())
    await waitFor(() => expect(result.current.bits).not.toBeNull())
    expect(result.current.artFailed).toBe(false)
    const failing = hook()   // fetchArtById throws by default
    await waitFor(() => expect(failing.result.current.index).not.toBeNull())
    act(() => failing.result.current.pickToken('Treasure'))
    await waitFor(() => expect(failing.result.current.artFailed).toBe(true))
    act(() => failing.result.current.edit({ artRef: null }))
    await waitFor(() => expect(failing.result.current.artFailed).toBe(false))
  })
  it("does not render the previous token's art while the new ref is still loading", async () => {
    let releaseB: (b: Blob) => void = () => {}
    const blob = new Blob([new Uint8Array([1])])
    const fetchArtById = vi.fn((ref: string) => ref === 'aaaaaaaa000040008000000000000009'
      ? Promise.resolve(blob)
      : new Promise<Blob>((res) => { releaseB = res }))
    const s = fakeServices({ fetchArtById, decodeArt: async () => FAKE_GREY })
    const { result } = hook(s)
    const bitsOf = (d: TokenDraft, withArt: boolean) => renderProxy(d.card, withArt ? FAKE_GREY : null, DEFAULT_SETTINGS, s.env).bits
    const same = (x: BitImage | null, y: BitImage) => !!x && x.width === y.width && x.height === y.height && x.bits.every((v, i) => v === y.bits[i])
    await waitFor(() => expect(result.current.index).not.toBeNull())
    act(() => result.current.pickToken('Treasure'))
    const a = result.current.draft!
    const aArt = bitsOf(a, true)
    await waitFor(() => expect(same(result.current.bits, aArt)).toBe(true))
    act(() => result.current.pickToken('Goblin'))
    const b = result.current.draft!
    expect(b.artRef).not.toBe(a.artRef)
    const bArt = bitsOf(b, true), bBare = bitsOf(b, false)
    expect(same(bArt, bBare)).toBe(false)
    await waitFor(() => expect(fetchArtById).toHaveBeenCalledWith(b.artRef))
    await waitFor(() => expect(same(result.current.bits, bBare)).toBe(true))
    await act(async () => { releaseB(blob) })
    await waitFor(() => expect(same(result.current.bits, bArt)).toBe(true))
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
    const bits = result.current.bits!
    await act(() => result.current.print())
    const packed = toPacked(bits)
    const expected = [escposInit()]
    for (let i = 0; i < 3; i++) expected.push(...escposRasterFrames(packed, bits.width, bits.height), escposFeed(i === 2 ? FEED_LINES_AFTER : FEED_LINES_BETWEEN_CARDS))
    const concat = (parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length } return out }
    expect(concat(printer.writes)).toEqual(concat(expected))
    expect(Array.from(printer.writes[0].subarray(0, 2))).toEqual([0x1b, 0x40])   // the single init leads the stream
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

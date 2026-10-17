// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useProxy } from './useProxy'
import { DEFAULT_SETTINGS } from '../core/settings'
import { fakeServices, memoryStorage, FAKE_GREY } from '../../tests/fakeServices'
import { setPreferredArt, getPreferredArt } from '../core/art/preference'
import { renderProxy } from '../core/render/renderProxy'
import type { GreyImage, BitImage } from '../core/art/types'

vi.mock('./browserEnv', async (orig) => ({ ...(await orig<object>()), ensureFonts: async () => {} }))

const grey = FAKE_GREY
const blob = new Blob([new Uint8Array([1])])

describe('useProxy art preference', () => {
  it('fetches the preferred printing and exposes its ref', async () => {
    const storage = memoryStorage(); setPreferredArt(storage, 'Lightning Bolt', 'ref1')
    const fetchArtById = vi.fn(async () => blob)
    const s = fakeServices({ storage, fetchArtById, decodeArt: async () => grey })
    const { result } = renderHook(() => useProxy(s, DEFAULT_SETTINGS))
    await act(() => result.current.render('Lightning Bolt'))
    await waitFor(() => expect(result.current.renders).toHaveLength(1))
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
    await waitFor(() => expect(result.current.renders).toHaveLength(1))
    expect(result.current.errors.some((e) => /Art could not be loaded/.test(e.message))).toBe(true)   // default art throws in tests
    await act(() => result.current.chooseArt('ref9'))
    expect(getPreferredArt(storage, 'Lightning Bolt')).toBe('ref9')
    expect(fetchArtById).toHaveBeenCalledWith('ref9')
    await waitFor(() => expect(result.current.errors).toEqual([]))
    await act(() => result.current.chooseArt(null))
    expect(getPreferredArt(storage, 'Lightning Bolt')).toBeNull()
    expect(result.current.artRef).toBeNull()
  })
  it('chooseArt keys the preference on the full card name and re-resolves every sheet', async () => {
    const storage = memoryStorage()
    const fetchArtById = vi.fn(async () => blob)
    const fetchPrints = vi.fn(async () => [])
    const s = fakeServices({ storage, fetchArtById, fetchPrints, decodeArt: async () => grey })
    const { result } = renderHook(() => useProxy(s, DEFAULT_SETTINGS))
    await act(() => result.current.render('Delver of Secrets'))
    await waitFor(() => expect(result.current.renders).toHaveLength(2))
    await act(() => result.current.loadPrints())
    expect(fetchPrints).toHaveBeenCalledWith('Delver of Secrets // Insectile Aberration')
    await act(() => result.current.chooseArt('ref7'))
    expect(getPreferredArt(storage, 'Delver of Secrets // Insectile Aberration')).toBe('ref7')
    expect(fetchArtById).toHaveBeenCalledWith('ref7')
    expect(fetchArtById).toHaveBeenCalledWith('ref7:1')
    await waitFor(() => expect(result.current.errors).toEqual([]))
  })
  it('a slow earlier chooseArt cannot overwrite a later pick', async () => {
    const storage = memoryStorage()
    const blobA = new Blob([new Uint8Array([1])]), blobB = new Blob([new Uint8Array([2])])
    const greyA: GreyImage = { width: 1, height: 1, data: new Float32Array([0]) }
    const greyB: GreyImage = { width: 1, height: 1, data: new Float32Array([1]) }
    let releaseA: (b: Blob) => void = () => {}
    const fetchArtById = vi.fn((ref: string) => ref === 'refA' ? new Promise<Blob>((res) => { releaseA = res }) : Promise.resolve(blobB))
    const s = fakeServices({ storage, fetchArtById, decodeArt: async (b: Blob) => (b === blobA ? greyA : greyB) })
    const { result } = renderHook(() => useProxy(s, DEFAULT_SETTINGS))
    await act(() => result.current.render('Lightning Bolt'))
    await waitFor(() => expect(result.current.renders).toHaveLength(1))
    const card = result.current.card!
    const withA = renderProxy(card.sheets[0], greyA, DEFAULT_SETTINGS, s.env).bits, withB = renderProxy(card.sheets[0], greyB, DEFAULT_SETTINGS, s.env).bits
    const same = (x: BitImage | null, y: BitImage) => !!x && x.bits.every((v, i) => v === y.bits[i])
    expect(same(withA, withB)).toBe(false)
    let first!: Promise<void>
    act(() => { first = result.current.chooseArt('refA') })
    await act(() => result.current.chooseArt('refB'))
    await waitFor(() => expect(same(result.current.renders[0]?.bits ?? null, withB)).toBe(true))
    await act(async () => { releaseA(blobA); await first })
    expect(getPreferredArt(storage, 'Lightning Bolt')).toBe('refB')
    expect(result.current.artRef).toBe('refB')
    await waitFor(() => expect(same(result.current.renders[0]?.bits ?? null, withB)).toBe(true))
  })
  it('a chooseArt for the previous card that resolves after a new render cannot land its art', async () => {
    const storage = memoryStorage()
    const greyA: GreyImage = { width: 1, height: 1, data: new Float32Array([0]) }
    let releaseA: (b: Blob) => void = () => {}
    let releaseGoyf: (c: unknown) => void = () => {}
    const fetchArtById = vi.fn((ref: string) => ref === 'refA' ? new Promise<Blob>((res) => { releaseA = res }) : Promise.reject(new Error('no art')))
    const base = fakeServices()
    const fetchCard = vi.fn((name: string) => name === 'Tarmogoyf' ? new Promise((res) => { releaseGoyf = res }) : base.client.fetchCard(name))
    const s = fakeServices({ storage, fetchArtById, fetchCard: fetchCard as typeof base.client.fetchCard, decodeArt: async () => greyA })
    const { result } = renderHook(() => useProxy(s, DEFAULT_SETTINGS))
    await act(() => result.current.render('Lightning Bolt'))
    await waitFor(() => expect(result.current.renders).toHaveLength(1))
    let loading!: Promise<void>, picking!: Promise<void>
    act(() => { loading = result.current.render('Tarmogoyf') })
    act(() => { picking = result.current.chooseArt('refA') })   // a pick for Bolt while Tarmogoyf loads
    await act(async () => { releaseGoyf(await base.client.fetchCard('Tarmogoyf')); await loading })
    await waitFor(() => expect(result.current.card?.name).toBe('Tarmogoyf'))
    await act(async () => { releaseA(blob); await picking })
    const card = result.current.card!
    expect(card.name).toBe('Tarmogoyf')
    const noArt = renderProxy(card.sheets[0], null, DEFAULT_SETTINGS, s.env).bits
    await waitFor(() => expect(result.current.renders[0]?.bits.bits.every((v, i) => v === noArt.bits[i])).toBe(true))
    expect(result.current.errors.some((e) => /Art could not be loaded/.test(e.message))).toBe(true)
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

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePrinter, PRINTER_MESSAGES } from './usePrinter'
import type { Services } from './services'
import { NotAPrinter, PrinterCancelled } from '../core/printer/transport'
import { fakePrinter, type FakePrinter } from '../../tests/fakePrinter'
import { nodeEnv } from '../../tests/nodeEnv'
import type { BitImage } from '../core/art/types'
import { encodeEscPosFrames, escposInit } from '../core/output/escpos'
import { toPacked } from '../core/output/packed'
import { foldGuide } from '../core/output/foldGuide'

function services(printer: FakePrinter): Services {
  return {
    client: { fetchCard: async () => { throw new Error('unused') }, fetchCardById: async () => { throw new Error('unused') }, fetchArtBlob: async () => { throw new Error('unused') }, fetchPrints: async () => [], fetchArtById: async () => { throw new Error('unused') } },
    loadNames: async () => [], loadTokens: async () => ({ version: 1, tokens: [] }), env: nodeEnv, storage: { getItem: () => null, setItem: () => {} },
    decodeArt: async () => { throw new Error('unused') }, printer,
  }
}
// 384 x 3 encodes to 5 + 8 + 144 + 3 = 160 bytes -> two 100-byte chunks
const small: BitImage = { width: 384, height: 3, bits: new Uint8Array(384 * 3) }
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
const indexOf = (hay: Uint8Array, needle: Uint8Array, from = 0) => {
  outer: for (let i = from; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

describe('usePrinter', () => {
  it('mirrors transport state and name', async () => {
    const f = fakePrinter(); const { result } = renderHook(() => usePrinter(services(f)))
    expect(result.current.state).toBe('disconnected'); expect(result.current.name).toBeNull()
    await act(() => result.current.connect())
    expect(result.current.state).toBe('connected'); expect(result.current.name).toBe('PT210_FAKE')
    await act(() => result.current.disconnect())
    expect(result.current.state).toBe('disconnected')
  })
  it('reports a connect failure with the connect message', async () => {
    const f = fakePrinter(); f.connectImpl = async () => { throw new Error('gatt') }
    const { result } = renderHook(() => usePrinter(services(f)))
    await act(() => result.current.connect())
    expect(result.current.error).toBe(PRINTER_MESSAGES.connect)
    expect(result.current.state).toBe('disconnected')
  })
  it('reports NotAPrinter with its own message', async () => {
    const f = fakePrinter(); f.connectImpl = async () => { throw new NotAPrinter() }
    const { result } = renderHook(() => usePrinter(services(f)))
    await act(() => result.current.connect())
    expect(result.current.error).toBe(PRINTER_MESSAGES.notPrinter)
  })
  it('stays silent when the chooser is dismissed', async () => {
    const f = fakePrinter(); f.connectImpl = async () => { throw new PrinterCancelled() }
    const { result } = renderHook(() => usePrinter(services(f)))
    await act(() => result.current.connect())
    expect(result.current.error).toBeNull()
  })
  it('prints the encoded card in chunks and resets progress afterwards', async () => {
    const f = fakePrinter('connected'); const { result } = renderHook(() => usePrinter(services(f)))
    await act(() => result.current.print([small]))
    expect(f.writes.map((w) => w.length)).toEqual([5, 100, 52, 3])   // header, block (152 B), feed
    expect(Array.from(f.writes[0].subarray(0, 5))).toEqual([0x1b, 0x40, 0x1b, 0x61, 0x00])
    expect(result.current.progress).toBe(0)
    expect(result.current.state).toBe('connected')
    expect(result.current.error).toBeNull()
  })
  it('prints one sheet as the same stream as before', async () => {
    const f = fakePrinter('connected'); const { result } = renderHook(() => usePrinter(services(f)))
    await act(() => result.current.print([small]))
    expect(concat(f.writes)).toEqual(concat(encodeEscPosFrames(toPacked(small), small.width, small.height)))
  })
  it('prints a fold pair as one job: one ESC @, then the fold guide between the sheets', async () => {
    const f = fakePrinter('connected'); const { result } = renderHook(() => usePrinter(services(f)))
    await act(() => result.current.print([small, small]))
    const stream = concat(f.writes)
    expect(Array.from(stream.subarray(0, 5))).toEqual(Array.from(escposInit()))
    expect(indexOf(stream, toPacked(foldGuide(384)))).toBeGreaterThan(0)
    expect(indexOf(stream, Uint8Array.from([0x1b, 0x40]), 1)).toBe(-1)
  })
  it('ignores print() unless connected (no interleaved jobs)', async () => {
    const f = fakePrinter('disconnected'); const { result } = renderHook(() => usePrinter(services(f)))
    await act(() => result.current.print([small]))
    expect(f.writes).toEqual([])
    f.set('printing')
    await act(() => result.current.print([small]))
    expect(f.writes).toEqual([])
  })
  it('reports a drop during printing and resets progress', async () => {
    const f = fakePrinter('connected'); f.failWrites = new Error('gone')
    const { result } = renderHook(() => usePrinter(services(f)))
    await act(() => result.current.print([small]))
    expect(result.current.error).toBe(PRINTER_MESSAGES.dropped)
    expect(result.current.state).toBe('disconnected')
    expect(result.current.progress).toBe(0)
  })
  it('cancel() stops between chunks without an error', async () => {
    const f = fakePrinter('connected'); const { result } = renderHook(() => usePrinter(services(f)))
    const origWrite = f.write.bind(f)
    f.write = async (b) => { await origWrite(b); result.current.cancel() }
    await act(() => result.current.print([small]))
    expect(f.writes.map((w) => w.length)).toEqual([5, 3])   // header frame, then the feed; the raster block is skipped
    expect(Array.from(f.writes[1])).toEqual([0x1b, 0x64, 0x02])
    expect(result.current.error).toBeNull()
    await waitFor(() => expect(result.current.state).toBe('connected'))
  })
  it('clearError clears the message', async () => {
    const f = fakePrinter(); f.connectImpl = async () => { throw new Error('gatt') }
    const { result } = renderHook(() => usePrinter(services(f)))
    await act(() => result.current.connect())
    act(() => result.current.clearError())
    expect(result.current.error).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import { printJob } from './transport'
import { fakePrinter } from '../../../tests/fakePrinter'

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i & 0xff)

describe('printJob', () => {
  it('writes the bytes in order as chunks of the given size', async () => {
    const f = fakePrinter('connected')
    await printJob(f, bytes(250), { chunk: 100 })
    expect(f.writes.map((w) => w.length)).toEqual([100, 100, 50])
    expect(Array.from(f.writes[2])).toEqual(Array.from(bytes(250).subarray(200)))
  })
  it('defaults to BLE_CHUNK_BYTES (100)', async () => {
    const f = fakePrinter('connected')
    await printJob(f, bytes(101))
    expect(f.writes.map((w) => w.length)).toEqual([100, 1])
  })
  it('reports progress from 0 to total', async () => {
    const f = fakePrinter('connected'); const seen: number[] = []
    await printJob(f, bytes(250), { chunk: 100, onProgress: (sent, total) => { expect(total).toBe(250); seen.push(sent) } })
    expect(seen).toEqual([0, 100, 200, 250])
  })
  it('brackets the job with setPrinting(true/false)', async () => {
    const f = fakePrinter('connected'); const states: string[] = []
    f.onStateChange((s) => states.push(s))
    await printJob(f, bytes(10))
    expect(states).toEqual(['printing', 'connected'])
  })
  it('stops between chunks when aborted and throws AbortError', async () => {
    const f = fakePrinter('connected'); const ac = new AbortController()
    const p = printJob(f, bytes(300), { chunk: 100, signal: ac.signal, onProgress: (sent) => { if (sent === 100) ac.abort() } })
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.writes.length).toBe(1)
    expect(f.state).toBe('connected')
  })
  it('propagates a write failure and leaves the transport state to the transport', async () => {
    const f = fakePrinter('connected'); f.failWrites = new Error('gatt gone')
    await expect(printJob(f, bytes(10))).rejects.toThrow('gatt gone')
    expect(f.state).toBe('disconnected')   // setPrinting(false) must not resurrect 'connected'
  })
})

describe('printJob with frames', () => {
  it('writes frames back to back in chunks', async () => {
    const f = fakePrinter('connected')
    await printJob(f, [bytes(150), bytes(150), bytes(3)], { chunk: 100 })
    expect(f.writes.map((w) => w.length)).toEqual([100, 50, 100, 50, 3])
  })
  it('on abort finishes the current frame, skips the rest, sends the final frame, then throws AbortError', async () => {
    const f = fakePrinter('connected'); const ac = new AbortController()
    const p = printJob(f, [bytes(150), bytes(150), bytes(3)], { chunk: 100, signal: ac.signal, onProgress: (sent) => { if (sent === 100) ac.abort() } })
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.writes.map((w) => w.length)).toEqual([100, 50, 3])
    expect(f.state).toBe('connected')
  })
})

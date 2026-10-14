import type { PrinterState, PrinterTransport } from '../src/core/printer/transport'

export interface FakePrinter extends PrinterTransport {
  state: PrinterState
  name: string | null
  /** Every chunk written, copied. */
  writes: Uint8Array[]
  /** When set, the next write() moves to 'disconnected' and throws this. */
  failWrites: Error | null
  /** What connect() does after moving to 'connecting'. Replace to simulate failures. */
  connectImpl: () => Promise<void>
  /** Force a state and notify subscribers (e.g. a dropped connection). */
  set(state: PrinterState): void
}

export function fakePrinter(initial: PrinterState = 'disconnected'): FakePrinter {
  const subs = new Set<(s: PrinterState) => void>()
  const f: FakePrinter = {
    state: initial, name: null, writes: [], failWrites: null,
    connectImpl: async () => { f.name = 'PT210_FAKE'; f.set('connected') },
    set(s) { f.state = s; subs.forEach((cb) => cb(s)) },
    async connect() {
      if (f.state === 'unsupported') throw new Error('Web Bluetooth is not available')
      if (f.state !== 'disconnected') return
      f.set('connecting')
      try { await f.connectImpl() } catch (e) { f.set('disconnected'); throw e }
    },
    async disconnect() { f.set('disconnected') },
    async write(b) {
      if (f.failWrites) { f.set('disconnected'); throw f.failWrites }
      f.writes.push(Uint8Array.from(b))
    },
    setPrinting(on) {
      if (on && f.state === 'connected') f.set('printing')
      else if (!on && f.state === 'printing') f.set('connected')
    },
    onStateChange(cb) { subs.add(cb); return () => { subs.delete(cb) } },
  }
  return f
}

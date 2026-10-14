# Bluetooth Printing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print the currently rendered proxy on the PT-210 over Web Bluetooth from Chrome on Windows and Android, with a status chip that shows which printer is connected.

**Architecture:** `src/core/` gains a pure ESC/POS raster encoder and a framework-free `PrinterTransport` interface plus a `printJob` driver that chunks bytes and reports progress. `src/app/` gains the single Web Bluetooth implementation of that interface, a `usePrinter` hook, a `PrinterChip` in the app bar and a Print button in `Preview`, all wired through the existing `Services` injection object so tests use a fake transport.

**Tech Stack:** TypeScript, React 19, MUI 9, Vitest 5 (node + jsdom), Testing Library, Web Bluetooth API (`@types/web-bluetooth` for typing).

**Spec:** `docs/superpowers/specs/2026-10-14-bluetooth-printing-design.md`

## Global Constraints

- `src/core/` never imports from `src/app/`, never touches `document`, `window` or `navigator`.
- Printer constants have one home, `src/core/printer.ts`: `RASTER_BLOCK_ROWS = 64`, `FEED_LINES_AFTER = 4`, `BLE_CHUNK_BYTES = 100`. They are not user settings.
- ESC/POS stream is exactly: `1B 40`, `1B 61 00`, then per block of ≤64 rows `1D 76 30 00 xL xH yL yH` + rows, then `1B 64 04`. A 384 × 536 card encodes to exactly 25,808 bytes.
- Service/characteristic preference order: ISSC `49535343-fe7d-4ae5-8fa9-9fafd205e455` / `49535343-8841-43f4-a8d4-ecbe34729bb3`, then `0000ff00-…` / `0000ff02-…`, then `000018f0-…` / `00002af1-…`.
- No retry after a failed or dropped print.
- User-facing strings (copy exactly):
  - "Could not connect to the printer. Make sure it is on and nearby."
  - "This device does not look like a supported printer."
  - "Printer disconnected during printing. Reconnect and print again."
  - Chip: "No Bluetooth", "Connect printer", "NAME: tap to reconnect", "Connecting…", "NAME", "NAME: printing"; unsupported tooltip "Printing needs Chrome on Android or desktop over https".
- Vitest globals are off: import `describe/it/expect/vi` explicitly. UI tests start with `// @vitest-environment jsdom`.
- Commit after every task. Run `npm test` and `npm run typecheck` before each commit.

## Review Focus

1. **Print tapped while a print is running** (double tap, or tap during the first chunk): the second tap must be ignored, never interleave bytes. Test added in Task 4.
2. **Connect tapped while already connecting**: must not open a second chooser. Test added in Task 3.
3. **Width not a multiple of 8** (user set `dotsPerLine` to 200): stride must round up and the length check must use the rounded stride. Test added in Task 1.
4. **Older Chrome characteristic without `writeValueWithoutResponse`/`writeValueWithResponse`** (only legacy `writeValue`): write must fall back instead of throwing "not a function". Test added in Task 3.
5. **Printer powered off between connect and Print**: the write rejects, state must end `disconnected` with the "disconnected during printing" message, and progress must reset to 0. Test added in Task 4.

---

### Task 1: Printer constants and ESC/POS raster encoder

**Files:**
- Modify: `src/core/printer.ts`
- Create: `src/core/output/escpos.ts`
- Test: `src/core/output/escpos.test.ts`

**Interfaces:**
- Consumes: `toPacked(b: BitImage): Uint8Array` from `src/core/output/packed.ts` (MSB-first, `ceil(width/8)` bytes per row).
- Produces: `encodeEscPosRaster(packed: Uint8Array, width: number, height: number): Uint8Array`; constants `RASTER_BLOCK_ROWS`, `FEED_LINES_AFTER`, `BLE_CHUNK_BYTES`.

- [ ] **Step 1: Add the constants**

Append to `src/core/printer.ts`:

```ts
/** ESC/POS `GS v 0` raster is sent in blocks of this many rows. */
export const RASTER_BLOCK_ROWS = 64
/** Lines fed after the card so it clears the tear bar (`ESC d n`). */
export const FEED_LINES_AFTER = 4
/** Bytes per BLE write. 100 printed a full card correctly on the PT-210 (2026-10-14). */
export const BLE_CHUNK_BYTES = 100
```

- [ ] **Step 2: Write the failing tests**

Create `src/core/output/escpos.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { encodeEscPosRaster } from './escpos'
import { toPacked } from './packed'

const packedFor = (width: number, height: number) => toPacked({ width, height, bits: new Uint8Array(width * height) })

describe('encodeEscPosRaster', () => {
  it('starts with ESC @ and ESC a 0, ends with ESC d 4', () => {
    const out = encodeEscPosRaster(packedFor(8, 1), 8, 1)
    expect(Array.from(out.subarray(0, 5))).toEqual([0x1b, 0x40, 0x1b, 0x61, 0x00])
    expect(Array.from(out.subarray(out.length - 3))).toEqual([0x1b, 0x64, 0x04])
  })
  it('emits one GS v 0 block per 64 rows with the right header', () => {
    const out = encodeEscPosRaster(packedFor(384, 70), 384, 70)
    // header(5) + block1 header(8) + 64*48 + block2 header(8) + 6*48 + feed(3)
    expect(out.length).toBe(5 + 8 + 64 * 48 + 8 + 6 * 48 + 3)
    expect(Array.from(out.subarray(5, 13))).toEqual([0x1d, 0x76, 0x30, 0x00, 48, 0, 64, 0])
    const second = 5 + 8 + 64 * 48
    expect(Array.from(out.subarray(second, second + 8))).toEqual([0x1d, 0x76, 0x30, 0x00, 48, 0, 6, 0])
  })
  it('encodes a 384 x 536 card to exactly 25808 bytes (9 blocks)', () => {
    expect(encodeEscPosRaster(packedFor(384, 536), 384, 536).length).toBe(25808)
  })
  it('copies the packed rows into the blocks in order', () => {
    const packed = Uint8Array.from([0xaa, 0x55, 0x0f])   // width 8, height 3
    const out = encodeEscPosRaster(packed, 8, 3)
    expect(Array.from(out.subarray(13, 16))).toEqual([0xaa, 0x55, 0x0f])
  })
  it('rounds the stride up for widths that are not multiples of 8', () => {
    const out = encodeEscPosRaster(packedFor(200, 2), 200, 2)   // stride 25
    expect(Array.from(out.subarray(5, 13))).toEqual([0x1d, 0x76, 0x30, 0x00, 25, 0, 2, 0])
    expect(out.length).toBe(5 + 8 + 50 + 3)
  })
  it('rejects a packed buffer whose length does not match width x height', () => {
    expect(() => encodeEscPosRaster(new Uint8Array(10), 8, 3)).toThrow(/does not match/)
  })
})
```

- [ ] **Step 3: Run the tests, expect failure**

Run: `npx vitest run src/core/output/escpos.test.ts`
Expected: FAIL, cannot resolve `./escpos`.

- [ ] **Step 4: Implement the encoder**

Create `src/core/output/escpos.ts`:

```ts
import { RASTER_BLOCK_ROWS, FEED_LINES_AFTER } from '../printer'

/**
 * Wrap packed 1-bit rows (from `toPacked`) in the ESC/POS stream the PT-210 printed
 * correctly on 2026-10-14: ESC @, ESC a 0, GS v 0 blocks of ≤64 rows, ESC d 4.
 */
export function encodeEscPosRaster(packed: Uint8Array, width: number, height: number): Uint8Array {
  const stride = Math.ceil(width / 8)
  if (packed.length !== stride * height) {
    throw new Error(`packed length ${packed.length} does not match ${stride} bytes x ${height} rows`)
  }
  const blocks = Math.ceil(height / RASTER_BLOCK_ROWS)
  const out = new Uint8Array(5 + blocks * 8 + packed.length + 3)
  let o = 0
  out.set([0x1b, 0x40, 0x1b, 0x61, 0x00], o); o += 5
  for (let y = 0; y < height; y += RASTER_BLOCK_ROWS) {
    const rows = Math.min(RASTER_BLOCK_ROWS, height - y)
    out.set([0x1d, 0x76, 0x30, 0x00, stride & 0xff, stride >> 8, rows & 0xff, rows >> 8], o); o += 8
    out.set(packed.subarray(y * stride, (y + rows) * stride), o); o += rows * stride
  }
  out.set([0x1b, 0x64, FEED_LINES_AFTER], o)
  return out
}
```

- [ ] **Step 5: Run the tests, expect pass**

Run: `npx vitest run src/core/output/escpos.test.ts`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add src/core/printer.ts src/core/output/escpos.ts src/core/output/escpos.test.ts
git commit -m "feat(core): ESC/POS raster encoder and printer constants"
```

---

### Task 2: PrinterTransport interface, printJob, and the test fake

**Files:**
- Create: `src/core/printer/transport.ts`
- Create: `tests/fakePrinter.ts`
- Test: `src/core/printer/transport.test.ts`

**Interfaces:**
- Consumes: `BLE_CHUNK_BYTES` from `src/core/printer.ts`.
- Produces:
  ```ts
  type PrinterState = 'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'printing'
  interface PrinterTransport { readonly state; readonly name; connect(); disconnect(); write(bytes); setPrinting(on); onStateChange(cb) }
  class PrinterCancelled extends Error      // chooser dismissed
  class NotAPrinter extends Error           // no writable characteristic
  printJob(t, bytes, { chunk?, signal?, onProgress? }): Promise<void>
  ```
  and `fakePrinter(initial?: PrinterState): FakePrinter` in `tests/fakePrinter.ts` with `writes: Uint8Array[]`, `failWrites: Error | null`, `connectImpl`, `set(state)`.

- [ ] **Step 1: Write the interface and errors**

Create `src/core/printer/transport.ts`:

```ts
import { BLE_CHUNK_BYTES } from '../printer'

export type PrinterState = 'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'printing'

/** A byte sink for the printer. The app provides the Web Bluetooth implementation; tests a fake. */
export interface PrinterTransport {
  readonly state: PrinterState
  /** Device name once the user has chosen one, else null. */
  readonly name: string | null
  /** Opens the chooser if no device is remembered in memory, otherwise reconnects to it. */
  connect(): Promise<void>
  disconnect(): Promise<void>
  /** Writes one chunk; resolves when the stack accepted it. */
  write(bytes: Uint8Array): Promise<void>
  /** connected -> printing (true) / printing -> connected (false). A drop during printing wins. */
  setPrinting(on: boolean): void
  /** Returns an unsubscribe function. */
  onStateChange(cb: (s: PrinterState) => void): () => void
}

/** The user dismissed the device chooser. Not an error to show. */
export class PrinterCancelled extends Error {
  constructor() { super('Printer selection cancelled'); this.name = 'PrinterCancelled' }
}

/** The chosen device exposes none of the known printer characteristics. */
export class NotAPrinter extends Error {
  constructor() { super('This device does not look like a supported printer.'); this.name = 'NotAPrinter' }
}

export interface PrintJobOptions {
  chunk?: number
  signal?: AbortSignal
  onProgress?: (sent: number, total: number) => void
}

/** Sends `bytes` in order as `chunk`-sized writes. Never retries. */
export async function printJob(t: PrinterTransport, bytes: Uint8Array, opts: PrintJobOptions = {}): Promise<void> {
  const chunk = opts.chunk ?? BLE_CHUNK_BYTES
  t.setPrinting(true)
  try {
    opts.onProgress?.(0, bytes.length)
    for (let i = 0; i < bytes.length; i += chunk) {
      if (opts.signal?.aborted) throw new DOMException('Print cancelled', 'AbortError')
      const end = Math.min(i + chunk, bytes.length)
      await t.write(bytes.subarray(i, end))
      opts.onProgress?.(end, bytes.length)
    }
  } finally {
    t.setPrinting(false)
  }
}
```

- [ ] **Step 2: Write the fake transport**

Create `tests/fakePrinter.ts`:

```ts
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
```

- [ ] **Step 3: Write the failing printJob tests**

Create `src/core/printer/transport.test.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests, expect pass** (interface and fake were written first; the tests should pass on first run, and they confirm the fake's semantics)

Run: `npx vitest run src/core/printer/transport.test.ts`
Expected: 6 passed. If `DOMException` is undefined in your Node, the Node version is below 17; the repo uses Node 24.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add src/core/printer/transport.ts src/core/printer/transport.test.ts tests/fakePrinter.ts
git commit -m "feat(core): PrinterTransport interface, printJob and test fake"
```

---

### Task 3: Web Bluetooth transport and Services wiring

**Files:**
- Modify: `package.json` (devDependency `@types/web-bluetooth`), `tsconfig.json` (`types`)
- Create: `src/app/bluetoothPrinter.ts`
- Modify: `src/app/services.ts`
- Modify: `src/app/App.test.tsx:14-22`, `src/app/useProxy.test.tsx:16-22` (add `printer` to the fake `Services`)
- Test: `src/app/bluetoothPrinter.test.ts`

**Interfaces:**
- Consumes: `PrinterTransport`, `PrinterState`, `PrinterCancelled`, `NotAPrinter` from `src/core/printer/transport.ts`; `fakePrinter` from `tests/fakePrinter.ts`.
- Produces: `createBluetoothPrinter(bluetooth: Bluetooth | undefined): PrinterTransport`; `PRINTER_SERVICES`; `Services.printer: PrinterTransport`.

- [ ] **Step 1: Install Web Bluetooth types**

Run: `npm install --save-dev @types/web-bluetooth`

Edit `tsconfig.json` line 15:

```json
    "types": ["vite/client", "node", "web-bluetooth"]
```

- [ ] **Step 2: Write the failing tests**

Create `src/app/bluetoothPrinter.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { createBluetoothPrinter, PRINTER_SERVICES } from './bluetoothPrinter'
import { NotAPrinter, PrinterCancelled } from '../core/printer/transport'

type Props = { write?: boolean; writeWithoutResponse?: boolean }
type Legacy = { legacyOnly?: boolean }

/** A fake BluetoothDevice exposing the given services (keyed by service uuid). */
function makeDevice(available: Record<string, Props>, opts: Legacy = {}) {
  const target = new EventTarget()
  const calls = { withoutResponse: [] as Uint8Array[], withResponse: [] as Uint8Array[], legacy: [] as Uint8Array[] }
  let connected = false
  const gatt = {
    get connected() { return connected },
    connect: vi.fn(async () => { connected = true; return gatt }),
    disconnect: vi.fn(() => { connected = false; target.dispatchEvent(new Event('gattserverdisconnected')) }),
    getPrimaryService: async (uuid: string) => {
      if (!(uuid in available)) throw new DOMException('no service', 'NotFoundError')
      return {
        getCharacteristic: async () => {
          const c: Record<string, unknown> = {
            properties: { write: false, writeWithoutResponse: false, ...available[uuid] },
            writeValue: async (v: Uint8Array) => { calls.legacy.push(new Uint8Array(v)) },
          }
          if (!opts.legacyOnly) {
            c.writeValueWithoutResponse = async (v: Uint8Array) => { calls.withoutResponse.push(new Uint8Array(v)) }
            c.writeValueWithResponse = async (v: Uint8Array) => { calls.withResponse.push(new Uint8Array(v)) }
          }
          return c
        },
      }
    },
  }
  const device = Object.assign(target, { name: 'PT210_TEST', id: 'dev-1', gatt }) as unknown as BluetoothDevice
  return { device, gatt, calls, drop: () => { connected = false; target.dispatchEvent(new Event('gattserverdisconnected')) } }
}

function makeBluetooth(device: BluetoothDevice | (() => Promise<BluetoothDevice>)) {
  const requestDevice = vi.fn(typeof device === 'function' ? device : async () => device)
  return { bluetooth: { requestDevice } as unknown as Bluetooth, requestDevice }
}

const ISSC = PRINTER_SERVICES[0], FF00 = PRINTER_SERVICES[1], S18F0 = PRINTER_SERVICES[2]

describe('createBluetoothPrinter', () => {
  it('is unsupported without the API and connect rejects', async () => {
    const t = createBluetoothPrinter(undefined)
    expect(t.state).toBe('unsupported')
    await expect(t.connect()).rejects.toThrow(/not available/)
  })
  it('asks the chooser for the three printer services and connects to the ISSC characteristic', async () => {
    const { device } = makeDevice({ [ISSC.service]: { writeWithoutResponse: true } })
    const { bluetooth, requestDevice } = makeBluetooth(device)
    const t = createBluetoothPrinter(bluetooth); const states: string[] = []
    t.onStateChange((s) => states.push(s))
    await t.connect()
    expect(requestDevice).toHaveBeenCalledWith({
      filters: PRINTER_SERVICES.map((p) => ({ services: [p.service] })),
      optionalServices: PRINTER_SERVICES.map((p) => p.service),
    })
    expect(states).toEqual(['connecting', 'connected'])
    expect(t.name).toBe('PT210_TEST')
  })
  it('falls back to ff02 then 2af1 when ISSC is absent', async () => {
    const a = makeDevice({ [FF00.service]: { write: true }, [S18F0.service]: { write: true } })
    const ta = createBluetoothPrinter(makeBluetooth(a.device).bluetooth)
    await ta.connect(); await ta.write(Uint8Array.from([1]))
    expect(a.calls.withResponse.length).toBe(1)
    const b = makeDevice({ [S18F0.service]: { writeWithoutResponse: true } })
    const tb = createBluetoothPrinter(makeBluetooth(b.device).bluetooth)
    await tb.connect(); await tb.write(Uint8Array.from([1]))
    expect(b.calls.withoutResponse.length).toBe(1)
  })
  it('uses writeValueWithoutResponse when supported, else writeValueWithResponse, else legacy writeValue', async () => {
    const wr = makeDevice({ [ISSC.service]: { writeWithoutResponse: true, write: true } })
    const t1 = createBluetoothPrinter(makeBluetooth(wr.device).bluetooth)
    await t1.connect(); await t1.write(Uint8Array.from([1, 2]))
    expect(wr.calls.withoutResponse.map((w) => Array.from(w))).toEqual([[1, 2]])
    const w = makeDevice({ [ISSC.service]: { write: true } })
    const t2 = createBluetoothPrinter(makeBluetooth(w.device).bluetooth)
    await t2.connect(); await t2.write(Uint8Array.from([3]))
    expect(w.calls.withResponse.map((x) => Array.from(x))).toEqual([[3]])
    const legacy = makeDevice({ [ISSC.service]: { write: true } }, { legacyOnly: true })
    const t3 = createBluetoothPrinter(makeBluetooth(legacy.device).bluetooth)
    await t3.connect(); await t3.write(Uint8Array.from([4]))
    expect(legacy.calls.legacy.map((x) => Array.from(x))).toEqual([[4]])
  })
  it('turns a dismissed chooser into PrinterCancelled and goes back to disconnected', async () => {
    const { bluetooth } = makeBluetooth(async () => { throw new DOMException('User cancelled', 'NotFoundError') })
    const t = createBluetoothPrinter(bluetooth)
    await expect(t.connect()).rejects.toBeInstanceOf(PrinterCancelled)
    expect(t.state).toBe('disconnected')
  })
  it('rejects a device with no writable printer characteristic and forgets it', async () => {
    const d = makeDevice({ [ISSC.service]: {} })   // characteristic present but not writable
    const { bluetooth, requestDevice } = makeBluetooth(d.device)
    const t = createBluetoothPrinter(bluetooth)
    await expect(t.connect()).rejects.toBeInstanceOf(NotAPrinter)
    expect(t.state).toBe('disconnected')
    expect(d.gatt.disconnect).toHaveBeenCalled()
    await t.connect().catch(() => {})
    expect(requestDevice).toHaveBeenCalledTimes(2)   // chooser opens again
  })
  it('reflects a dropped connection and reconnects without the chooser', async () => {
    const d = makeDevice({ [ISSC.service]: { writeWithoutResponse: true } })
    const { bluetooth, requestDevice } = makeBluetooth(d.device)
    const t = createBluetoothPrinter(bluetooth)
    await t.connect()
    d.drop()
    expect(t.state).toBe('disconnected')
    expect(t.name).toBe('PT210_TEST')
    await expect(t.write(Uint8Array.from([1]))).rejects.toThrow(/not connected/)
    await t.connect()
    expect(t.state).toBe('connected')
    expect(requestDevice).toHaveBeenCalledTimes(1)
    expect(d.gatt.connect).toHaveBeenCalledTimes(2)
  })
  it('ignores connect() while already connecting (no second chooser)', async () => {
    let release!: (d: BluetoothDevice) => void
    const d = makeDevice({ [ISSC.service]: { writeWithoutResponse: true } })
    const { bluetooth, requestDevice } = makeBluetooth(() => new Promise<BluetoothDevice>((r) => { release = r }))
    const t = createBluetoothPrinter(bluetooth)
    const first = t.connect()
    expect(t.state).toBe('connecting')
    await t.connect()                       // returns immediately
    expect(requestDevice).toHaveBeenCalledTimes(1)
    release(d.device); await first
    expect(t.state).toBe('connected')
  })
  it('setPrinting toggles connected <-> printing but a drop during printing wins', async () => {
    const d = makeDevice({ [ISSC.service]: { writeWithoutResponse: true } })
    const t = createBluetoothPrinter(makeBluetooth(d.device).bluetooth)
    await t.connect()
    t.setPrinting(true); expect(t.state).toBe('printing')
    t.setPrinting(false); expect(t.state).toBe('connected')
    t.setPrinting(true); d.drop(); t.setPrinting(false)
    expect(t.state).toBe('disconnected')
  })
  it('disconnect() releases the GATT link', async () => {
    const d = makeDevice({ [ISSC.service]: { writeWithoutResponse: true } })
    const t = createBluetoothPrinter(makeBluetooth(d.device).bluetooth)
    await t.connect(); await t.disconnect()
    expect(d.gatt.disconnect).toHaveBeenCalled()
    expect(t.state).toBe('disconnected')
  })
})
```

- [ ] **Step 3: Run the tests, expect failure**

Run: `npx vitest run src/app/bluetoothPrinter.test.ts`
Expected: FAIL, cannot resolve `./bluetoothPrinter`.

- [ ] **Step 4: Implement the transport**

Create `src/app/bluetoothPrinter.ts`:

```ts
import { NotAPrinter, PrinterCancelled, type PrinterState, type PrinterTransport } from '../core/printer/transport'

/** Known "serial over BLE" printer services, in preference order. Measured on a PT-210 (2026-10-14). */
export const PRINTER_SERVICES = [
  { service: '49535343-fe7d-4ae5-8fa9-9fafd205e455', characteristic: '49535343-8841-43f4-a8d4-ecbe34729bb3' }, // Microchip/ISSC
  { service: '0000ff00-0000-1000-8000-00805f9b34fb', characteristic: '0000ff02-0000-1000-8000-00805f9b34fb' },
  { service: '000018f0-0000-1000-8000-00805f9b34fb', characteristic: '00002af1-0000-1000-8000-00805f9b34fb' },
] as const

type Char = BluetoothRemoteGATTCharacteristic & {
  writeValueWithoutResponse?: (v: BufferSource) => Promise<void>
  writeValueWithResponse?: (v: BufferSource) => Promise<void>
}

/** The only place in the app that talks to Web Bluetooth. Pass `undefined` when the API is unavailable. */
export function createBluetoothPrinter(bluetooth: Bluetooth | undefined): PrinterTransport {
  const subs = new Set<(s: PrinterState) => void>()
  let state: PrinterState = bluetooth ? 'disconnected' : 'unsupported'
  let device: BluetoothDevice | null = null
  let char: Char | null = null

  const set = (s: PrinterState) => { if (s !== state) { state = s; subs.forEach((cb) => cb(s)) } }
  const onDrop = () => { char = null; set('disconnected') }
  const forget = () => { device?.removeEventListener('gattserverdisconnected', onDrop); device = null }

  async function pickDevice(): Promise<BluetoothDevice> {
    try {
      return await bluetooth!.requestDevice({
        filters: PRINTER_SERVICES.map((p) => ({ services: [p.service] })),
        optionalServices: PRINTER_SERVICES.map((p) => p.service),
      })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') throw new PrinterCancelled()
      throw e
    }
  }

  async function findCharacteristic(server: BluetoothRemoteGATTServer): Promise<Char | null> {
    for (const p of PRINTER_SERVICES) {
      try {
        const c = (await (await server.getPrimaryService(p.service)).getCharacteristic(p.characteristic)) as Char
        if (c.properties.write || c.properties.writeWithoutResponse) return c
      } catch { /* service or characteristic absent on this device: try the next */ }
    }
    return null
  }

  return {
    get state() { return state },
    get name() { return device?.name ?? null },
    async connect() {
      if (!bluetooth) throw new Error('Web Bluetooth is not available')
      if (state !== 'disconnected') return
      set('connecting')
      try {
        if (!device) {
          device = await pickDevice()
          device.addEventListener('gattserverdisconnected', onDrop)
        }
        const server = await device.gatt!.connect()
        const c = await findCharacteristic(server)
        if (!c) { server.disconnect(); forget(); throw new NotAPrinter() }
        char = c
        set('connected')
      } catch (e) {
        char = null; set('disconnected'); throw e
      }
    },
    async disconnect() {
      char = null
      if (device?.gatt?.connected) device.gatt.disconnect()
      set('disconnected')
    },
    async write(bytes) {
      if (!char) throw new Error('Printer is not connected')
      const value = Uint8Array.from(bytes)   // fresh ArrayBuffer-backed copy for the BufferSource parameter
      if (char.properties.writeWithoutResponse && char.writeValueWithoutResponse) return char.writeValueWithoutResponse(value)
      if (char.writeValueWithResponse) return char.writeValueWithResponse(value)
      return char.writeValue(value)
    },
    setPrinting(on) {
      if (on && state === 'connected') set('printing')
      else if (!on && state === 'printing') set('connected')
    },
    onStateChange(cb) { subs.add(cb); return () => { subs.delete(cb) } },
  }
}
```

- [ ] **Step 5: Run the tests, expect pass**

Run: `npx vitest run src/app/bluetoothPrinter.test.ts`
Expected: 10 passed.

- [ ] **Step 6: Wire `printer` into Services**

Edit `src/app/services.ts`:

```ts
import { get, set } from 'idb-keyval'
import type { RenderEnv } from '../core/env'
import type { GreyImage } from '../core/art/types'
import type { PrinterTransport } from '../core/printer/transport'
import { createScryfallClient, type KeyValue, type ScryfallClient } from '../data/scryfall'
import { loadNameIndex } from '../data/nameIndex'
import { browserEnv, blobToGrey } from './browserEnv'
import { createBluetoothPrinter } from './bluetoothPrinter'

export interface Services {
  client: ScryfallClient
  loadNames(): Promise<string[]>
  env: RenderEnv
  storage: Pick<Storage, 'getItem' | 'setItem'>
  decodeArt(blob: Blob): Promise<GreyImage>
  printer: PrinterTransport
}

const idbCache: KeyValue = { get: (k) => get(k), set: (k, v) => set(k, v) }

/** Web Bluetooth exists only in secure contexts (https or localhost) and only in Chromium browsers. */
function webBluetooth(): Bluetooth | undefined {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return undefined
  if (!window.isSecureContext) return undefined
  return navigator.bluetooth ?? undefined
}

export function createBrowserServices(): Services {
  return {
    client: createScryfallClient({ cache: idbCache }),
    loadNames: () => loadNameIndex(),
    env: browserEnv,
    storage: localStorage,
    decodeArt: blobToGrey,
    printer: createBluetoothPrinter(webBluetooth()),
  }
}
```

- [ ] **Step 7: Add `printer` to the existing test fakes**

In `src/app/App.test.tsx` add the import and field:

```ts
import { fakePrinter } from '../../tests/fakePrinter'
// ...
function services(fetchCard: Services['client']['fetchCard']): Services {
  return {
    client: { fetchCard, fetchArtBlob: async () => { throw new Error('no art in tests') } },
    loadNames: async () => ['Lightning Bolt', 'Delver of Secrets'],
    env: nodeEnv,
    storage: { getItem: () => null, setItem: () => {} },
    decodeArt: async () => { throw new Error('unused') },
    printer: fakePrinter(),
  }
}
```

In `src/app/useProxy.test.tsx` add the same import and `printer: fakePrinter(),` as the last field of the `services` object literal.

- [ ] **Step 8: Run everything, typecheck, commit**

Run: `npm test && npm run typecheck`
Expected: all green.

```bash
git add package.json package-lock.json tsconfig.json src/app/bluetoothPrinter.ts src/app/bluetoothPrinter.test.ts src/app/services.ts src/app/App.test.tsx src/app/useProxy.test.tsx
git commit -m "feat(app): Web Bluetooth printer transport and Services.printer"
```

---

### Task 4: usePrinter hook

**Files:**
- Create: `src/app/usePrinter.ts`
- Test: `src/app/usePrinter.test.tsx`

**Interfaces:**
- Consumes: `Services.printer`; `encodeEscPosRaster`; `toPacked`; `printJob`, `PrinterCancelled`, `NotAPrinter`, `PrinterState`.
- Produces:
  ```ts
  usePrinter(services): { state: PrinterState; name: string | null; error: string | null; progress: number;
                          connect(): Promise<void>; disconnect(): Promise<void>; print(bits: BitImage): Promise<void>;
                          cancel(): void; clearError(): void }
  PRINTER_MESSAGES = { connect, notPrinter, dropped }
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/app/usePrinter.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePrinter, PRINTER_MESSAGES } from './usePrinter'
import type { Services } from './services'
import { NotAPrinter, PrinterCancelled } from '../core/printer/transport'
import { fakePrinter, type FakePrinter } from '../../tests/fakePrinter'
import { nodeEnv } from '../../tests/nodeEnv'
import type { BitImage } from '../core/art/types'

function services(printer: FakePrinter): Services {
  return {
    client: { fetchCard: async () => { throw new Error('unused') }, fetchArtBlob: async () => { throw new Error('unused') } },
    loadNames: async () => [], env: nodeEnv, storage: { getItem: () => null, setItem: () => {} },
    decodeArt: async () => { throw new Error('unused') }, printer,
  }
}
// 384 x 3 encodes to 5 + 8 + 144 + 3 = 160 bytes -> two 100-byte chunks
const small: BitImage = { width: 384, height: 3, bits: new Uint8Array(384 * 3) }

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
    await act(() => result.current.print(small))
    expect(f.writes.map((w) => w.length)).toEqual([100, 60])
    expect(Array.from(f.writes[0].subarray(0, 5))).toEqual([0x1b, 0x40, 0x1b, 0x61, 0x00])
    expect(result.current.progress).toBe(0)
    expect(result.current.state).toBe('connected')
    expect(result.current.error).toBeNull()
  })
  it('ignores print() unless connected (no interleaved jobs)', async () => {
    const f = fakePrinter('disconnected'); const { result } = renderHook(() => usePrinter(services(f)))
    await act(() => result.current.print(small))
    expect(f.writes).toEqual([])
    f.set('printing')
    await act(() => result.current.print(small))
    expect(f.writes).toEqual([])
  })
  it('reports a drop during printing and resets progress', async () => {
    const f = fakePrinter('connected'); f.failWrites = new Error('gone')
    const { result } = renderHook(() => usePrinter(services(f)))
    await act(() => result.current.print(small))
    expect(result.current.error).toBe(PRINTER_MESSAGES.dropped)
    expect(result.current.state).toBe('disconnected')
    expect(result.current.progress).toBe(0)
  })
  it('cancel() stops between chunks without an error', async () => {
    const f = fakePrinter('connected'); const { result } = renderHook(() => usePrinter(services(f)))
    const origWrite = f.write.bind(f)
    f.write = async (b) => { await origWrite(b); result.current.cancel() }
    await act(() => result.current.print(small))
    expect(f.writes.length).toBe(1)
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
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `npx vitest run src/app/usePrinter.test.tsx`
Expected: FAIL, cannot resolve `./usePrinter`.

- [ ] **Step 3: Implement the hook**

Create `src/app/usePrinter.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Services } from './services'
import type { BitImage } from '../core/art/types'
import { toPacked } from '../core/output/packed'
import { encodeEscPosRaster } from '../core/output/escpos'
import { printJob, PrinterCancelled, NotAPrinter, type PrinterState } from '../core/printer/transport'

export const PRINTER_MESSAGES = {
  connect: 'Could not connect to the printer. Make sure it is on and nearby.',
  notPrinter: 'This device does not look like a supported printer.',
  dropped: 'Printer disconnected during printing. Reconnect and print again.',
} as const

export function usePrinter(services: Services) {
  const printer = services.printer
  const [state, setState] = useState<PrinterState>(printer.state)
  const [name, setName] = useState<string | null>(printer.name)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => printer.onStateChange((s) => { setState(s); setName(printer.name) }), [printer])

  const connect = useCallback(async () => {
    setError(null)
    try { await printer.connect() }
    catch (e) {
      if (e instanceof PrinterCancelled) return
      setError(e instanceof NotAPrinter ? PRINTER_MESSAGES.notPrinter : PRINTER_MESSAGES.connect)
    }
  }, [printer])

  const disconnect = useCallback(async () => { setError(null); await printer.disconnect() }, [printer])

  const print = useCallback(async (bits: BitImage) => {
    if (printer.state !== 'connected') return
    setError(null); setProgress(0)
    const bytes = encodeEscPosRaster(toPacked(bits), bits.width, bits.height)
    const ac = new AbortController(); abort.current = ac
    try {
      await printJob(printer, bytes, { signal: ac.signal, onProgress: (sent, total) => setProgress(total ? sent / total : 0) })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(PRINTER_MESSAGES.dropped)
    } finally {
      abort.current = null; setProgress(0)
    }
  }, [printer])

  const cancel = useCallback(() => { abort.current?.abort() }, [])
  const clearError = useCallback(() => setError(null), [])

  return { state, name, error, progress, connect, disconnect, print, cancel, clearError }
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `npx vitest run src/app/usePrinter.test.tsx`
Expected: 9 passed.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add src/app/usePrinter.ts src/app/usePrinter.test.tsx
git commit -m "feat(app): usePrinter hook"
```

---

### Task 5: PrinterChip component

**Files:**
- Create: `src/app/PrinterChip.tsx`
- Test: `src/app/PrinterChip.test.tsx`

**Interfaces:**
- Consumes: `PrinterState`.
- Produces: `PrinterChip({ state, name, onConnect, onDisconnect })`; `chipLabel(state, name): string`; `UNSUPPORTED_HINT`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/PrinterChip.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PrinterChip, chipLabel } from './PrinterChip'

describe('chipLabel', () => {
  it('matches the spec table', () => {
    expect(chipLabel('unsupported', null)).toBe('No Bluetooth')
    expect(chipLabel('disconnected', null)).toBe('Connect printer')
    expect(chipLabel('disconnected', 'PT210')).toBe('PT210: tap to reconnect')
    expect(chipLabel('connecting', null)).toBe('Connecting…')
    expect(chipLabel('connected', 'PT210')).toBe('PT210')
    expect(chipLabel('printing', 'PT210')).toBe('PT210: printing')
  })
})

describe('PrinterChip', () => {
  it('connects on tap when disconnected', async () => {
    const onConnect = vi.fn()
    render(<PrinterChip state="disconnected" name={null} onConnect={onConnect} onDisconnect={() => {}} />)
    await userEvent.click(screen.getByText('Connect printer'))
    expect(onConnect).toHaveBeenCalledTimes(1)
  })
  it('offers Disconnect in a menu when connected', async () => {
    const onDisconnect = vi.fn()
    render(<PrinterChip state="connected" name="PT210" onConnect={() => {}} onDisconnect={onDisconnect} />)
    await userEvent.click(screen.getByText('PT210'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Disconnect' }))
    expect(onDisconnect).toHaveBeenCalledTimes(1)
  })
  it('does nothing on tap while connecting or printing', async () => {
    const onConnect = vi.fn(), onDisconnect = vi.fn()
    const { rerender } = render(<PrinterChip state="connecting" name={null} onConnect={onConnect} onDisconnect={onDisconnect} />)
    await userEvent.click(screen.getByText('Connecting…'))
    rerender(<PrinterChip state="printing" name="PT210" onConnect={onConnect} onDisconnect={onDisconnect} />)
    await userEvent.click(screen.getByText('PT210: printing'))
    expect(onConnect).not.toHaveBeenCalled(); expect(onDisconnect).not.toHaveBeenCalled()
  })
  it('is disabled with the hint when unsupported', () => {
    render(<PrinterChip state="unsupported" name={null} onConnect={() => {}} onDisconnect={() => {}} />)
    const chip = screen.getByText('No Bluetooth').closest('[aria-disabled], .Mui-disabled')
    expect(chip).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `npx vitest run src/app/PrinterChip.test.tsx`
Expected: FAIL, cannot resolve `./PrinterChip`.

- [ ] **Step 3: Implement the chip**

Create `src/app/PrinterChip.tsx`:

```tsx
import { useState, type MouseEvent } from 'react'
import Chip from '@mui/material/Chip'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import BluetoothIcon from '@mui/icons-material/Bluetooth'
import BluetoothConnectedIcon from '@mui/icons-material/BluetoothConnected'
import BluetoothDisabledIcon from '@mui/icons-material/BluetoothDisabled'
import BluetoothSearchingIcon from '@mui/icons-material/BluetoothSearching'
import type { PrinterState } from '../core/printer/transport'

export interface PrinterChipProps {
  state: PrinterState
  name: string | null
  onConnect(): void
  onDisconnect(): void
}

export const UNSUPPORTED_HINT = 'Printing needs Chrome on Android or desktop over https'

export function chipLabel(state: PrinterState, name: string | null): string {
  switch (state) {
    case 'unsupported': return 'No Bluetooth'
    case 'disconnected': return name ? `${name}: tap to reconnect` : 'Connect printer'
    case 'connecting': return 'Connecting…'
    case 'connected': return name ?? 'Connected'
    case 'printing': return `${name ?? 'Printer'}: printing`
  }
}

function iconFor(state: PrinterState) {
  if (state === 'unsupported') return <BluetoothDisabledIcon />
  if (state === 'connecting') return <BluetoothSearchingIcon />
  if (state === 'disconnected') return <BluetoothIcon />
  return <BluetoothConnectedIcon />
}

/** App-bar status chip: the only entry point for connecting to the printer. */
export function PrinterChip({ state, name, onConnect, onDisconnect }: PrinterChipProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const narrow = useMediaQuery(useTheme().breakpoints.down('sm'))
  const label = chipLabel(state, name)
  const clickable = state === 'disconnected' || state === 'connected'
  const onClick = (e: MouseEvent<HTMLElement>) => {
    if (state === 'disconnected') onConnect()
    else if (state === 'connected') setAnchor(e.currentTarget)
  }
  return (
    <>
      <Tooltip title={state === 'unsupported' ? UNSUPPORTED_HINT : label}>
        <span>
          <Chip
            icon={iconFor(state)}
            label={narrow ? undefined : label}
            aria-label={label}
            color={state === 'connected' || state === 'printing' ? 'success' : 'default'}
            variant="outlined"
            clickable={clickable}
            disabled={state === 'unsupported'}
            onClick={clickable ? onClick : undefined}
            sx={{ color: 'inherit', borderColor: 'currentColor', mr: 1, '& .MuiChip-icon': { color: 'inherit' } }}
          />
        </span>
      </Tooltip>
      <Menu open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}>
        <MenuItem onClick={() => { setAnchor(null); onDisconnect() }}>Disconnect</MenuItem>
      </Menu>
    </>
  )
}
```

Note: jsdom has no `matchMedia`, so `useMediaQuery` returns `false` there and the label renders, which the tests rely on.

- [ ] **Step 4: Run the tests, expect pass**

Run: `npx vitest run src/app/PrinterChip.test.tsx`
Expected: 5 passed. If the "disabled" test fails on the selector, inspect `screen.debug()` and match on the class MUI actually sets (`Mui-disabled` on the root chip).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add src/app/PrinterChip.tsx src/app/PrinterChip.test.tsx
git commit -m "feat(app): PrinterChip status chip"
```

---

### Task 6: Print button in Preview and App wiring

**Files:**
- Modify: `src/app/Preview.tsx`
- Modify: `src/app/App.tsx`
- Test: `src/app/App.test.tsx`

**Interfaces:**
- Consumes: `usePrinter`, `PrinterChip`, `fakePrinter`.
- Produces: `Preview` gains optional prop `print?: { state: PrinterState; progress: number; onPrint(): void; onCancel(): void }`.

- [ ] **Step 1: Write the failing App tests**

Append to `src/app/App.test.tsx` (inside or after the existing `describe`; it needs `fakePrinter` from Task 3 and a `services` overload that accepts a printer):

Change the helper signature to:

```ts
function services(fetchCard: Services['client']['fetchCard'], printer = fakePrinter()): Services {
  return {
    client: { fetchCard, fetchArtBlob: async () => { throw new Error('no art in tests') } },
    loadNames: async () => ['Lightning Bolt', 'Delver of Secrets'],
    env: nodeEnv,
    storage: { getItem: () => null, setItem: () => {} },
    decodeArt: async () => { throw new Error('unused') },
    printer,
  }
}
```

Add:

```tsx
describe('App printing', () => {
  it('shows the chip, enables Print after connecting, and sends the card bytes', async () => {
    const printer = fakePrinter()
    render(<App services={services(async () => bolt, printer)} />)
    await pick('Lightning Bolt')
    await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled()
    await userEvent.click(screen.getByText('Connect printer'))
    await waitFor(() => expect(screen.getByText('PT210_FAKE')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Print' }))
    await waitFor(() => expect(printer.writes.reduce((a, w) => a + w.length, 0)).toBe(25808))
    expect(printer.writes[0].length).toBe(100)
  })
  it('hides Print and shows "No Bluetooth" when unsupported', async () => {
    render(<App services={services(async () => bolt, fakePrinter('unsupported'))} />)
    await pick('Lightning Bolt')
    await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument())
    expect(screen.getByText('No Bluetooth')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull()
  })
  it('shows a snackbar when connecting fails', async () => {
    const printer = fakePrinter(); printer.connectImpl = async () => { throw new Error('gatt') }
    render(<App services={services(async () => bolt, printer)} />)
    await userEvent.click(screen.getByText('Connect printer'))
    await waitFor(() => expect(screen.getByText(/Could not connect to the printer/)).toBeInTheDocument())
  })
  it('shows progress and Cancel while printing', async () => {
    const printer = fakePrinter('connected'); printer.name = 'PT210_FAKE'
    let release!: () => void
    const origWrite = printer.write.bind(printer)
    printer.write = async (b) => { await new Promise<void>((r) => { release = r }); await origWrite(b) }
    render(<App services={services(async () => bolt, printer)} />)
    await pick('Lightning Bolt')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Print' }))
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Print progress' })).toBeInTheDocument())
    expect(screen.getByText('PT210_FAKE: printing')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    release()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument())
    expect(printer.writes.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `npx vitest run src/app/App.test.tsx`
Expected: the four new tests FAIL (no chip, no Print button).

- [ ] **Step 3: Add the Print button to Preview**

Edit `src/app/Preview.tsx`. New imports:

```tsx
import LinearProgress from '@mui/material/LinearProgress'
import PrintIcon from '@mui/icons-material/Print'
import type { PrinterState } from '../core/printer/transport'
```

Props:

```tsx
export interface PreviewPrintProps { state: PrinterState; progress: number; onPrint(): void; onCancel(): void }
export interface PreviewProps { bits: BitImage; cardName: string; dotsPerLine: number; dpi: number; print?: PreviewPrintProps }

export function Preview({ bits, cardName, dotsPerLine, dpi, print }: PreviewProps) {
```

Replace the inner `<Stack direction="row" spacing={1}>` block with:

```tsx
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
        <ToggleButtonGroup size="small" exclusive value={zoom} onChange={(_e, v) => v && setZoom(v)}>
          <ToggleButton value="1">1×</ToggleButton><ToggleButton value="2">2×</ToggleButton><ToggleButton value="physical">Print size</ToggleButton>
        </ToggleButtonGroup>
        <Button variant="contained" startIcon={<DownloadIcon />} onClick={download}>Download PNG</Button>
        {print && print.state !== 'unsupported' && (
          print.state === 'printing'
            ? <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 180 }}>
                <LinearProgress variant="determinate" value={print.progress * 100} aria-label="Print progress" sx={{ flexGrow: 1 }} />
                <Button size="small" onClick={print.onCancel}>Cancel</Button>
              </Stack>
            : <Button variant="contained" startIcon={<PrintIcon />} disabled={print.state !== 'connected'} onClick={print.onPrint}>Print</Button>
        )}
      </Stack>
```

- [ ] **Step 4: Wire App**

Edit `src/app/App.tsx`. New imports:

```tsx
import Snackbar from '@mui/material/Snackbar'
import { usePrinter } from './usePrinter'
import { PrinterChip } from './PrinterChip'
```

Inside `App`, after `useProxy`:

```tsx
  const printer = usePrinter(services)
```

Toolbar:

```tsx
      <AppBar position="static"><Toolbar>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>Hot Proxies</Typography>
        <PrinterChip state={printer.state} name={printer.name} onConnect={printer.connect} onDisconnect={printer.disconnect} />
        <IconButton color="inherit" aria-label="settings" onClick={() => setDrawer(true)}><SettingsIcon /></IconButton>
      </Toolbar></AppBar>
```

Preview call:

```tsx
          {state === 'rendered' && card && bits && (
            <Preview bits={bits} cardName={card.name} dotsPerLine={settings.dotsPerLine} dpi={settings.dpi}
              print={{ state: printer.state, progress: printer.progress, onPrint: () => { void printer.print(bits) }, onCancel: printer.cancel }} />
          )}
```

After `<SettingsDrawer … />`:

```tsx
      <Snackbar open={!!printer.error} autoHideDuration={6000} onClose={printer.clearError}>
        <Alert severity="error" onClose={printer.clearError} variant="filled">{printer.error}</Alert>
      </Snackbar>
```

- [ ] **Step 5: Run the tests, expect pass**

Run: `npx vitest run src/app/App.test.tsx`
Expected: 8 passed (4 old + 4 new). The first printing test renders Bolt without art, so the byte count is 25,808 regardless of art.

- [ ] **Step 6: Full suite, typecheck, build, commit**

Run: `npm test && npm run build`
Expected: green; `dist/` builds.

```bash
git add src/app/Preview.tsx src/app/App.tsx src/app/App.test.tsx
git commit -m "feat(app): Print button, printer chip and error snackbar"
```

---

### Task 7: Docs and hardware verification

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md` (Architecture bullets)

- [ ] **Step 1: README printing section**

Insert after the "Develop" section of `README.md`:

```markdown
## Printing

The app prints over Web Bluetooth (BLE GATT), which works in Chrome on Android and on desktop
(Windows, macOS, Linux, ChromeOS). It needs a secure context: the GitHub Pages deployment
(https) or `http://localhost`. Firefox, Safari and all iOS browsers lack Web Bluetooth and show
"No Bluetooth" in the app bar.

1. Turn the printer on. Tap the Bluetooth chip in the app bar and pick the printer
   (`PT210_xxxx`) in Chrome's chooser. Android asks for the Nearby devices permission the first time.
2. Render a card and press **Print**. The card is sent as ESC/POS raster in 100-byte chunks.
3. If the printer powers off or goes out of range the chip shows "tap to reconnect".

Blank paper of the right length means the roll is in backwards: thermal paper prints on one
side only.

Testing on a phone against the dev server: `npm run dev -- --host`, connect the phone over USB,
enable port forwarding for 5173 in `chrome://inspect/#devices`, and open `http://localhost:5173`
on the phone (localhost counts as secure).

The printer exposes three BLE "serial" services; the app tries them in order:
ISSC `49535343-fe7d-…` (write char `…8841…`), `ff00`/`ff02`, `18f0`/`2af1`.
```

- [ ] **Step 2: CLAUDE.md**

In `CLAUDE.md`, "What this is": replace "Phase 1 (current) renders, previews and downloads PNG; printing over Web Bluetooth with ESC/POS raster encoding is the next phase and the architecture is already shaped for it (see "Design decisions")." with:

```markdown
Phase 1 renders, previews and downloads PNG. Phase 2 prints over Web Bluetooth (BLE GATT, ESC/POS `GS v 0` raster); its design is `docs/superpowers/specs/2026-10-14-bluetooth-printing-design.md`.
```

Under Architecture, after the `src/core/env.ts` bullet, add:

```markdown
- **Printing** — `core/output/escpos.ts` wraps packed rows in ESC/POS; `core/printer/transport.ts` defines `PrinterTransport` (state machine `unsupported | disconnected | connecting | connected | printing`) and `printJob` (chunked writes, progress, abort, no retry). `app/bluetoothPrinter.ts` is the only file that touches `navigator.bluetooth`; everything else gets the transport through `Services.printer`, and tests use `tests/fakePrinter.ts`. Constants (`RASTER_BLOCK_ROWS`, `FEED_LINES_AFTER`, `BLE_CHUNK_BYTES`) live in `core/printer.ts`.
```

- [ ] **Step 3: Manual hardware check on Windows**

Run `npm run dev`, open `http://localhost:5173` in Chrome, tap the chip, choose `PT210_4394`, render "Lightning Bolt", press Print. Expect a card identical to the 2026-10-14 SPP print. Then power the printer off: the chip must read "PT210_4394: tap to reconnect" within a few seconds; power on, tap, print again.

- [ ] **Step 4: Manual hardware check on Android**

Push to `main` (or use the port-forwarding route from the README), open the app in Chrome on the phone, repeat Step 3. Record in the commit message which Android/Chrome version was used.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: printing instructions and architecture notes"
```

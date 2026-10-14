# Hot Proxies: Bluetooth printing (phase 2)

Date: 2026-10-14. Extends `2026-10-12-hot-proxies-design.md`, which still
governs rendering, layout and settings.

## 1. Goal

Print the currently rendered proxy on the PT-210 printer directly from the
PWA, in Chrome on Windows and on Android, with a visible indication of which
printer the app is connected to.

Out of scope for this phase: copy count, deck/batch printing, Web Serial
fallback, printer tuning settings (density, feed length), iOS.

## 2. Findings that constrain the design

Established on 2026-10-14 with the real printer (`PT210_4394`):

- Classic Bluetooth SPP (Windows COM4) accepts ESC/POS and prints the card
  correctly. Chrome's Web Bluetooth cannot use SPP, and Web Serial does not
  exist on Android, so SPP is not used by the app.
- The printer also advertises BLE GATT. Chrome on Windows connects to it in
  about 350 ms and lists these services:
  - `49535343-fe7d-4ae5-8fa9-9fafd205e455` (Microchip/ISSC serial over BLE),
    write characteristic `49535343-8841-43f4-a8d4-ecbe34729bb3`, supports
    write-without-response. **Primary.**
  - `000018f0-0000-1000-8000-00805f9b34fb`, write characteristic `00002af1-...`.
  - `0000ff00-0000-1000-8000-00805f9b34fb`, write characteristic `0000ff02-...`.
- The full card (25,808 bytes: init + 9 raster blocks + feed) sent as 100-byte
  write-without-response chunks with no delay printed correctly.
- `navigator.bluetooth.getDevices` is not available in the tested Chrome, so
  silent reconnect across page reloads cannot be relied on.
- Web Bluetooth needs a secure context (https or localhost) and a user gesture
  to open the device chooser.

## 3. ESC/POS stream

`encodeEscPosRaster(packed, width, height)` in `src/core/output/escpos.ts`
produces exactly the stream that printed:

```
1B 40                      ESC @        initialise
1B 61 00                   ESC a 0      left align
repeat per block of up to 64 rows:
  1D 76 30 00 xL xH yL yH  GS v 0       raster, xL xH = bytes per row (48), yL yH = rows
  <rows * bytesPerRow bytes, MSB first, 1 = black>   (from output/packed.ts)
1B 64 04                   ESC d 4      feed 4 lines
```

Constants `RASTER_BLOCK_ROWS = 64`, `FEED_LINES_AFTER = 4` and
`BLE_CHUNK_BYTES = 100` live in `src/core/printer.ts`. They are not user
settings.

## 4. Architecture

Hard rule unchanged: `src/core/` never touches the DOM or `navigator`.

### 4.1 Core

- `src/core/output/escpos.ts`: `encodeEscPosRaster` as above. Pure.
- `src/core/printer/transport.ts`:

```ts
export type PrinterState = 'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'printing'

export interface PrinterTransport {
  readonly state: PrinterState
  readonly name: string | null            // device name once chosen
  connect(): Promise<void>                // opens chooser if no device yet, else reconnects
  disconnect(): Promise<void>
  write(bytes: Uint8Array): Promise<void> // one chunk, resolves when accepted
  setPrinting(on: boolean): void          // connected <-> printing
  onStateChange(cb: (s: PrinterState) => void): () => void
}

export class PrinterCancelled extends Error {}   // user dismissed the chooser

export async function printJob(
  t: PrinterTransport, bytes: Uint8Array,
  opts: { chunk?: number; signal?: AbortSignal; onProgress?: (sent: number, total: number) => void },
): Promise<void>
```

`printJob` calls `setPrinting(true)`, slices `bytes` into `chunk`-sized
writes (default `BLE_CHUNK_BYTES`), awaits each, reports progress after each,
throws a `DOMException` named `AbortError` if the signal fires between chunks,
lets a write failure propagate, and always calls `setPrinting(false)` at the
end. It does not retry: a retry after a mid-print failure would print a second
partial card.

### 4.2 App

- `src/app/bluetoothPrinter.ts`: `createBluetoothPrinter(bluetooth: Bluetooth | undefined): PrinterTransport`.
  The only file that uses Web Bluetooth.
  - If `bluetooth` is undefined (no API, or insecure context) the state is
    `unsupported` and `connect` rejects.
  - `connect()`: if no device is remembered in memory, calls `requestDevice`
    with `filters: [{ services: [ISSC] }, { services: [18f0] }, { services: [ff00] }]`
    and `optionalServices` listing all three. A `NotFoundError` from a
    dismissed chooser becomes `PrinterCancelled`. Then `gatt.connect()`, then
    the first available write characteristic in the order ISSC, `ff02`, `2af1`.
    If none is writable, disconnect and throw an `Error` with a clear message.
  - Registers `gattserverdisconnected` on the device: state becomes
    `disconnected` and the characteristic is dropped. The device object is
    kept so the next `connect()` reconnects without a chooser.
  - `write()` uses `writeValueWithoutResponse` when the characteristic
    supports it, otherwise `writeValueWithResponse`.
  - `setPrinting(true)` moves `connected` to `printing`; `setPrinting(false)`
    moves back only if still connected (a drop during printing wins).
- `Services` gains `printer: PrinterTransport`. The browser factory passes
  `navigator.bluetooth`, or `undefined` when the API is missing or
  `window.isSecureContext` is false.
- `src/app/usePrinter.ts`: `usePrinter(services)` returns
  `{ state, name, error, progress, connect, disconnect, print(bits), cancel }`.
  `print` packs the `BitImage`, encodes ESC/POS, runs `printJob`, updates
  `progress` in [0, 1]. Errors are stored as a user-facing sentence and
  cleared on the next action. `PrinterCancelled` sets no error.

### 4.3 UI

- `PrinterChip` in the app bar, right of the title, left of the settings
  icon. Bluetooth icon plus label:

  | state | label | tap |
  |---|---|---|
  | unsupported | "No Bluetooth" (tooltip: "Printing needs Chrome on Android or desktop over https") | nothing |
  | disconnected, no name | "Connect printer" | connect (chooser) |
  | disconnected, name known | "NAME: tap to reconnect" | connect (no chooser) |
  | connecting | "Connecting…" | nothing |
  | connected | "NAME" (green dot) | menu: Disconnect |
  | printing | "NAME: printing" | nothing |

  Below the `sm` breakpoint the chip shows the icon and dot only; the label is
  the `aria-label` and tooltip.
- `Preview` gets a `Print` button beside `Download PNG`, same variant,
  printer icon. Props: `onPrint`, `onCancel`, `printState`, `progress`.
  Hidden when state is `unsupported`; disabled unless `connected`; replaced by
  a `LinearProgress` with a Cancel button while `printing`.
- Errors surface as a `Snackbar` with an `Alert` (severity error).

### 4.4 Error handling

| situation | behaviour |
|---|---|
| chooser dismissed | silent |
| GATT connect fails | state `disconnected`, snackbar "Could not connect to the printer. Make sure it is on and nearby." |
| no writable characteristic | state `disconnected`, snackbar "This device does not look like a supported printer." |
| connection drops while idle | chip flips to "tap to reconnect" |
| write fails / drop mid-print | state `disconnected`, snackbar "Printer disconnected during printing. Reconnect and print again." progress reset |
| user cancels print | writes stop between chunks; printer may emit a partial card; no error |
| no Web Bluetooth / insecure context | chip "No Bluetooth", Print hidden |

## 5. Android notes (for README)

- Works in Chrome for Android over https (GitHub Pages) or localhost.
- Chrome asks for the Nearby devices permission on the first chooser.
  Bluetooth and, on older Android, Location must be on.
- Local testing: `npm run dev -- --host` then Chrome's USB port forwarding
  (`chrome://inspect/#devices`) so the phone opens `http://localhost:5173`,
  which counts as a secure context.
- Firefox, Safari and every iOS browser lack Web Bluetooth and show the
  unsupported chip.

## 6. Testing

- `src/core/output/escpos.test.ts`: header bytes, block count (9 for 536
  rows: 8 × 64 + 24), per-block header, total length 25,808 for 384 × 536,
  trailing feed; also a non-multiple height and a different width (stride).
- `src/core/printer/transport.test.ts` with a recording fake: chunk
  boundaries and order, progress callbacks, abort between chunks, write error
  propagation, `setPrinting` bracketing.
- `src/app/bluetoothPrinter.test.ts` (jsdom) with a fake `Bluetooth` object:
  filter list passed to `requestDevice`, characteristic preference order,
  `NotFoundError` to `PrinterCancelled`, `gattserverdisconnected` to state,
  reconnect without chooser, no API gives `unsupported`.
- `src/app/usePrinter.test.tsx` with a fake transport: state and error
  messages per row of §4.4, progress, cancel.
- `src/app/App.test.tsx`: chip label per state, Print hidden when
  unsupported, disabled when disconnected.
- Manual: print Lightning Bolt from the running app on Windows Chrome and on
  Android Chrome; compare with the SPP print from 2026-10-14.

## 7. Files

```
src/core/printer.ts                 + RASTER_BLOCK_ROWS, FEED_LINES_AFTER, BLE_CHUNK_BYTES
src/core/output/escpos.ts           new
src/core/printer/transport.ts       new
src/app/bluetoothPrinter.ts         new
src/app/usePrinter.ts               new
src/app/PrinterChip.tsx             new
src/app/services.ts                 + printer
src/app/App.tsx                     chip, snackbar, wiring
src/app/Preview.tsx                 Print button / progress
README.md                           printing section, Android notes
```

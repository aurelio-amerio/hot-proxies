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

/**
 * Sends `data` in order as `chunk`-sized writes. Never retries.
 * With a single buffer, abort is honoured between chunks. With frames (see `encodeEscPosFrames`),
 * abort is honoured only between frames so the printer is never left inside a raster block, and
 * the final frame (the feed) is still sent so the partial card clears the head.
 */
export async function printJob(t: PrinterTransport, data: Uint8Array | Uint8Array[], opts: PrintJobOptions = {}): Promise<void> {
  const chunk = opts.chunk ?? BLE_CHUNK_BYTES
  const frames = Array.isArray(data) ? data : [data]
  const atomicFrames = Array.isArray(data)
  const total = frames.reduce((a, f) => a + f.length, 0)
  let sent = 0
  const aborted = () => opts.signal?.aborted === true
  const writeFrame = async (f: Uint8Array) => {
    for (let i = 0; i < f.length; i += chunk) {
      if (!atomicFrames && aborted()) throw new DOMException('Print cancelled', 'AbortError')
      const end = Math.min(i + chunk, f.length)
      await t.write(f.subarray(i, end))
      sent += end - i
      opts.onProgress?.(sent, total)
    }
  }
  t.setPrinting(true)
  try {
    opts.onProgress?.(0, total)
    for (let k = 0; k < frames.length; k++) {
      if (atomicFrames && aborted()) {
        if (k < frames.length - 1) await writeFrame(frames[frames.length - 1])
        throw new DOMException('Print cancelled', 'AbortError')
      }
      await writeFrame(frames[k])
    }
  } finally {
    t.setPrinting(false)
  }
}

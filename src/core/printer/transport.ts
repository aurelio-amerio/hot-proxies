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

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

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
      try {
        if (char.properties.writeWithoutResponse && char.writeValueWithoutResponse) await char.writeValueWithoutResponse(value)
        else if (char.writeValueWithResponse) await char.writeValueWithResponse(value)
        else await char.writeValue(value)
      } catch (e) {
        // Any GATT failure mid-stream leaves the printer in an unknown state: treat it as a drop
        // so the UI asks for a reconnect instead of re-enabling Print on a dead or desynced link.
        char = null
        if (device?.gatt?.connected) device.gatt.disconnect()
        set('disconnected')
        throw e
      }
    },
    setPrinting(on) {
      if (on && state === 'connected') set('printing')
      else if (!on && state === 'printing') set('connected')
    },
    onStateChange(cb) { subs.add(cb); return () => { subs.delete(cb) } },
  }
}

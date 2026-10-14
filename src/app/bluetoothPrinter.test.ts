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

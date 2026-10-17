import { get, set } from 'idb-keyval'
import type { RenderEnv } from '../core/env'
import type { GreyImage } from '../core/art/types'
import type { PrinterTransport } from '../core/printer/transport'
import { createScryfallClient, type KeyValue, type ScryfallClient } from '../data/scryfall'
import { loadNameIndex } from '../data/nameIndex'
import type { TokenIndex } from '../core/token/index'
import { loadTokenIndex } from '../data/tokenIndex'
import { browserEnv, blobToGrey } from './browserEnv'
import { createBluetoothPrinter } from './bluetoothPrinter'

export interface Services {
  client: ScryfallClient
  loadNames(): Promise<string[]>
  loadTokens(): Promise<TokenIndex>
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
    loadTokens: () => loadTokenIndex(),
    env: browserEnv,
    storage: localStorage,
    decodeArt: blobToGrey,
    printer: createBluetoothPrinter(webBluetooth()),
  }
}

import { get, set } from 'idb-keyval'
import type { RenderEnv } from '../core/env'
import type { GreyImage } from '../core/art/types'
import { createScryfallClient, type KeyValue, type ScryfallClient } from '../data/scryfall'
import { loadNameIndex } from '../data/nameIndex'
import { browserEnv, blobToGrey } from './browserEnv'

export interface Services {
  client: ScryfallClient
  loadNames(): Promise<string[]>
  env: RenderEnv
  storage: Pick<Storage, 'getItem' | 'setItem'>
  decodeArt(blob: Blob): Promise<GreyImage>
}

const idbCache: KeyValue = { get: (k) => get(k), set: (k, v) => set(k, v) }

export function createBrowserServices(): Services {
  return {
    client: createScryfallClient({ cache: idbCache }),
    loadNames: () => loadNameIndex(),
    env: browserEnv,
    storage: localStorage,
    decodeArt: blobToGrey,
  }
}

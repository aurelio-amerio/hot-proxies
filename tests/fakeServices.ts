import { readFileSync } from 'node:fs'
import type { Services } from '../src/app/services'
import { CardNotFound } from '../src/core/errors'
import { nodeEnv } from './nodeEnv'
import { fakePrinter, type FakePrinter } from './fakePrinter'

/** Scryfall fixtures by exact name (case-insensitive, as Scryfall's ?exact= is). */
export const FIXTURE_CARDS: Record<string, string> = {
  'lightning bolt': 'bolt', 'tarmogoyf': 'tarmogoyf', 'forest': 'forest', 'nicol bolas, the ravager': 'bolas',
  'delver of secrets': 'delver', 'delver of secrets // insectile aberration': 'delver', 'smuggler\'s copter': 'copter',
}
export const FIXTURE_NAMES = ['Lightning Bolt', 'Tarmogoyf', 'Forest', 'Nicol Bolas, the Ravager', 'Delver of Secrets // Insectile Aberration', "Smuggler's Copter"]

export function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v) } }
}

export interface FakeServicesOptions {
  printer?: FakePrinter
  fetchCard?: Services['client']['fetchCard']
  loadNames?: Services['loadNames']
  storage?: Pick<Storage, 'getItem' | 'setItem'>
}

export function fakeServices(o: FakeServicesOptions = {}): Services & { printer: FakePrinter } {
  const fetchCard = o.fetchCard ?? (async (name: string) => {
    const f = FIXTURE_CARDS[name.toLowerCase()]
    if (!f) throw new CardNotFound(name)
    return JSON.parse(readFileSync(`tests/fixtures/cards/${f}.json`, 'utf8'))
  })
  return {
    client: { fetchCard, fetchArtBlob: async () => { throw new Error('no art in tests') } },
    loadNames: o.loadNames ?? (async () => FIXTURE_NAMES),
    env: nodeEnv,
    storage: o.storage ?? memoryStorage(),
    decodeArt: async () => { throw new Error('unused') },
    printer: o.printer ?? fakePrinter('connected'),
  }
}

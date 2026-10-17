import { readFileSync } from 'node:fs'
import type { Services } from '../src/app/services'
import type { TokenIndex } from '../src/core/token/index'
import type { GreyImage } from '../src/core/art/types'
import type { Store } from '../src/core/art/preference'
import { ArtUnavailable, CardNotFound } from '../src/core/errors'
import { nodeEnv } from './nodeEnv'
import { fakePrinter, type FakePrinter } from './fakePrinter'

/** Scryfall fixtures by exact name (case-insensitive, as Scryfall's ?exact= is). */
export const FIXTURE_CARDS: Record<string, string> = {
  'lightning bolt': 'bolt', 'tarmogoyf': 'tarmogoyf', 'forest': 'forest', 'nicol bolas, the ravager': 'bolas',
  'delver of secrets': 'delver', 'delver of secrets // insectile aberration': 'delver', 'smuggler\'s copter': 'copter',
  'academy at tolaria west': 'plane',
}
// Every layout fixture, by full name and by each face name, read from the JSON itself.
const LAYOUT_FIXTURES = ['benalia', 'urzas-saga', 'ranger-class', 'case-skeleton', 'transcendent-master', 'fleshgorger', 'bonecrusher', 'fire-ice', 'dusk-dawn', 'bushi', 'valki', 'gobakhan', 'hanweir-battlements', 'hanweir-township', 'kami-war']
const readCard = (f: string) => JSON.parse(readFileSync(`tests/fixtures/cards/${f}.json`, 'utf8')) as { id: string; name: string; card_faces?: { name: string }[] }
for (const f of LAYOUT_FIXTURES) {
  const c = readCard(f)
  FIXTURE_CARDS[c.name.toLowerCase()] = f
  for (const face of c.card_faces ?? []) FIXTURE_CARDS[face.name.toLowerCase()] = f
}
export const FIXTURE_NAMES = ['Lightning Bolt', 'Tarmogoyf', 'Forest', 'Nicol Bolas, the Ravager', 'Delver of Secrets // Insectile Aberration', "Smuggler's Copter", ...LAYOUT_FIXTURES.map((f) => readCard(f).name)]
export const FIXTURE_TOKENS = JSON.parse(readFileSync('tests/fixtures/tokens/index.json', 'utf8')) as TokenIndex
export const FAKE_GREY: GreyImage = { width: 1, height: 1, data: new Float32Array([0]) }

export function memoryStorage(): Store & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v) } }
}

export interface FakeServicesOptions {
  printer?: FakePrinter
  fetchCard?: Services['client']['fetchCard']
  fetchCardById?: Services['client']['fetchCardById']
  fetchPrints?: Services['client']['fetchPrints']
  fetchArtById?: Services['client']['fetchArtById']
  loadNames?: Services['loadNames']
  loadTokens?: Services['loadTokens']
  storage?: Pick<Storage, 'getItem' | 'setItem'>
  decodeArt?: Services['decodeArt']
}

export function fakeServices(o: FakeServicesOptions = {}): Services & { printer: FakePrinter } {
  const fetchCard = o.fetchCard ?? (async (name: string) => {
    const f = FIXTURE_CARDS[name.toLowerCase()]
    if (!f) throw new CardNotFound(name)
    return JSON.parse(readFileSync(`tests/fixtures/cards/${f}.json`, 'utf8'))
  })
  return {
    client: {
      fetchCard,
      fetchCardById: o.fetchCardById ?? (async (id: string) => {
        for (const f of new Set(Object.values(FIXTURE_CARDS))) { const c = readCard(f); if (c.id === id) return c }
        throw new CardNotFound(id)
      }),
      fetchArtBlob: async () => { throw new Error('no art in tests') },
      fetchPrints: o.fetchPrints ?? (async () => []),
      fetchArtById: o.fetchArtById ?? (async () => { throw new ArtUnavailable() }),
    },
    loadNames: o.loadNames ?? (async () => FIXTURE_NAMES),
    loadTokens: o.loadTokens ?? (async () => FIXTURE_TOKENS),
    env: nodeEnv,
    storage: o.storage ?? memoryStorage(),
    decodeArt: o.decodeArt ?? (async () => { throw new Error('unused') }),
    printer: o.printer ?? fakePrinter('connected'),
  }
}

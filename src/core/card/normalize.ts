import { UnsupportedLayout } from '../errors'
import type { CardData } from './types'

type Raw = Record<string, unknown>
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

export function normalizeScryfall(json: unknown): CardData {
  const raw = (json ?? {}) as Raw
  const name = str(raw.name) ?? '?'
  const layout = str(raw.layout) ?? 'unknown'
  if (layout !== 'normal') throw new UnsupportedLayout(name, layout)
  const power = str(raw.power), toughness = str(raw.toughness), loyalty = str(raw.loyalty)
  const imageUris = (raw.image_uris ?? {}) as Raw
  const card: CardData = {
    name,
    manaCost: str(raw.mana_cost) ?? '',
    typeLine: str(raw.type_line) ?? '',
    oracleText: str(raw.oracle_text) ?? '',
  }
  if (power !== undefined && toughness !== undefined) card.stat = { kind: 'pt', power, toughness }
  else if (loyalty !== undefined) card.stat = { kind: 'loyalty', value: loyalty }
  const art = str(imageUris.art_crop)
  if (art) card.artUrl = art
  return card
}

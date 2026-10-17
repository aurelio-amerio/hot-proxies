import { UnsupportedLayout } from '../errors'
import { caseSections, classSections, levelerSections, prototypeFaces, sagaSections } from './sections'
import { standardSheet, type Face, type ProxyCard, type Section, type Sheet, type Stat } from './types'

type Raw = Record<string, unknown>
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const obj = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {})

/** Layouts that are not standard card size, or are Un-cards, and so are refused. */
export const EXCLUDED_LAYOUTS: ReadonlySet<string> = new Set(['planar', 'scheme', 'vanguard', 'art_series', 'augment', 'host'])

/** Layouts whose card_faces are two halves of one sheet. */
const ONE_SHEET_FACES = new Set(['adventure', 'flip', 'split'])
const TWO_SHEETS = new Set(['transform', 'modal_dfc'])
/** Single-sheet layouts that read the top-level fields. */
const TOP_LEVEL = new Set(['normal', 'mutate', 'saga', 'class', 'case', 'leveler', 'prototype', 'meld', 'token', 'emblem'])
/** Single-sheet layouts whose fields live on card_faces[0]. */
const FRONT_FACE = new Set(['reversible_card', 'double_faced_token'])

/** A face from a Scryfall face object (or the card itself); art comes from `artSource`'s image_uris. */
function faceFrom(raw: Raw, artSource: Raw): Face {
  const power = str(raw.power), toughness = str(raw.toughness)
  const loyalty = str(raw.loyalty), defense = str(raw.defense)
  const face: Face = {
    name: str(raw.name) ?? '?',
    manaCost: str(raw.mana_cost) ?? '',
    typeLine: str(raw.type_line) ?? '',
    oracleText: str(raw.oracle_text) ?? '',
  }
  let stat: Stat | undefined
  if (power !== undefined && toughness !== undefined) stat = { kind: 'pt', power, toughness }
  else if (loyalty !== undefined) stat = { kind: 'loyalty', value: loyalty }
  else if (defense !== undefined) stat = { kind: 'defense', value: defense }
  if (stat) face.stat = stat
  const art = str(obj(artSource.image_uris).art_crop)
  if (art) face.artUrl = art
  return face
}

/** Spec §4.2: the sheet style of a single face. */
function styleFace(face: Face, layout: string): Sheet {
  let parse: ((text: string) => Section[]) | undefined
  if (/\bSaga\b/.test(face.typeLine)) parse = sagaSections
  else if (/\bClass\b/.test(face.typeLine)) parse = classSections
  else if (/\bCase\b/.test(face.typeLine)) parse = caseSections
  else if (layout === 'leveler') parse = levelerSections
  if (parse) return { kind: 'columns', face, sections: parse(face.oracleText) }
  if (layout === 'prototype') {
    const p = prototypeFaces(face)
    if (p) return { kind: 'stacked', face: p.main, sub: p.sub }
  }
  return standardSheet(face)
}

export function normalizeScryfall(json: unknown): ProxyCard {
  const raw = obj(json)
  const name = str(raw.name) ?? '?'
  const layout = str(raw.layout) ?? 'unknown'
  const faces = Array.isArray(raw.card_faces) ? (raw.card_faces as unknown[]).map(obj) : []
  const front = faces[0] ?? raw

  if (ONE_SHEET_FACES.has(layout) && faces.length >= 2) {
    const [a, b] = [faceFrom(faces[0], raw), faceFrom(faces[1], raw)]
    return { name, sheets: [layout === 'split' ? { kind: 'split', halves: [a, b] } : { kind: 'stacked', face: a, sub: b }] }
  }
  if (TWO_SHEETS.has(layout) && faces.length >= 2) {
    return { name, sheets: [styleFace(faceFrom(faces[0], faces[0]), layout), styleFace(faceFrom(faces[1], faces[1]), layout)] }
  }
  // Face layouts that lack their faces fall through to the top-level fields: empty text, not a throw.
  const known = TOP_LEVEL.has(layout) || FRONT_FACE.has(layout) || ONE_SHEET_FACES.has(layout) || TWO_SHEETS.has(layout)
  if (EXCLUDED_LAYOUTS.has(layout) || !known) throw new UnsupportedLayout(name, layout)

  const source = FRONT_FACE.has(layout) ? front : raw
  const card: ProxyCard = { name, sheets: [styleFace(faceFrom(source, source), layout)] }
  if (layout === 'meld') {
    const id = str(raw.id)
    const result = (Array.isArray(raw.all_parts) ? raw.all_parts : []).map(obj)
      .find((p) => p.component === 'meld_result' && str(p.name) !== name && str(p.id) !== id)
    const resultId = str(result?.id)
    if (resultId) card.meldResult = resultId
  }
  return card
}

/** Appends the melded card's sheet as the back of a meld part. */
export function attachMeldBack(card: ProxyCard, resultJson: unknown): ProxyCard {
  const result = normalizeScryfall(resultJson)
  const { meldResult: _drop, ...rest } = card
  return { ...rest, sheets: [card.sheets[0], result.sheets[0]], meldBack: true }
}

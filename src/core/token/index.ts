/** Shape of public/tokens.json and the pure grouping that builds it. */
export interface TokenVariant { typeLine: string; oracleText: string; power?: string; toughness?: string; prints: string[] }
export interface TokenEntry { name: string; variants: TokenVariant[] }
export interface TokenIndex { version: 1; tokens: TokenEntry[] }

/** One face of a raw Scryfall card, as the index sees it. */
export interface FaceRecord { name: string; typeLine: string; oracleText: string; power?: string; toughness?: string; ref: string; released: string }

type Raw = Record<string, unknown>
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** Art ref: the Scryfall id without hyphens, ":1" for the back face. */
export function artRef(id: string, face: 0 | 1): string {
  const hex = id.replace(/-/g, '')
  return face ? `${hex}:1` : hex
}

/** Scryfall mostly names emblems "<planeswalker> Emblem"; fold the "Emblem — X" form into the same shape. */
export function tokenName(name: string): string {
  const m = /^Emblem\s+[—-]\s+(.+)$/.exec(name)
  return m ? `${m[1]} Emblem` : name
}

const SKIP_LAYOUTS = new Set(['art_series'])

/** The faces of one raw card that belong in the index: 0, 1 or 2 records. */
export function faceRecords(json: unknown): FaceRecord[] {
  const raw = (json ?? {}) as Raw
  const id = str(raw.id)
  if (!id || SKIP_LAYOUTS.has(str(raw.layout) ?? '') || str(raw.set_type) === 'memorabilia') return []
  const released = str(raw.released_at) ?? '0000-00-00'
  const faces = Array.isArray(raw.card_faces) && raw.card_faces.length ? (raw.card_faces as Raw[]) : [raw]
  const out: FaceRecord[] = []
  faces.slice(0, 2).forEach((f, i) => {
    const name = str(f.name), typeLine = str(f.type_line)
    if (!name || !typeLine) return
    const oracleText = str(f.oracle_text) ?? ''
    if (typeLine === 'Card' && oracleText === '') return   // punch-out counters and other blanks
    const rec: FaceRecord = { name: tokenName(name), typeLine, oracleText, ref: artRef(id, i as 0 | 1), released }
    const power = str(f.power), toughness = str(f.toughness)
    if (power !== undefined && toughness !== undefined) { rec.power = power; rec.toughness = toughness }
    out.push(rec)
  })
  return out
}

const variantKey = (r: Pick<FaceRecord, 'typeLine' | 'oracleText' | 'power' | 'toughness'>) =>
  [r.typeLine, r.oracleText, r.power ?? '', r.toughness ?? ''].join('\u0000')

/** Group raw cards by name, then by distinct rules. Variants: most printed first, then newest. Prints: newest first. */
export function tokenIndexFromCards(cards: unknown[]): TokenIndex {
  const byName = new Map<string, Map<string, FaceRecord[]>>()
  for (const c of cards) for (const r of faceRecords(c)) {
    let variants = byName.get(r.name)
    if (!variants) { variants = new Map(); byName.set(r.name, variants) }
    const k = variantKey(r)
    const list = variants.get(k)
    if (list) list.push(r); else variants.set(k, [r])
  }
  const tokens: TokenEntry[] = [...byName.entries()].map(([name, variants]) => {
    const built = [...variants.values()].map((recs) => {
      recs.sort((a, b) => b.released.localeCompare(a.released) || a.ref.localeCompare(b.ref))
      const seen = new Set<string>()
      const prints = recs.map((r) => r.ref).filter((ref) => !seen.has(ref) && !!seen.add(ref))
      const first = recs[0]
      const v: TokenVariant = { typeLine: first.typeLine, oracleText: first.oracleText, prints }
      if (first.power !== undefined && first.toughness !== undefined) { v.power = first.power; v.toughness = first.toughness }
      return { v, newest: first.released }
    })
    built.sort((a, b) => b.v.prints.length - a.v.prints.length || b.newest.localeCompare(a.newest) || a.v.typeLine.localeCompare(b.v.typeLine))
    return { name, variants: built.map((b) => b.v) }
  })
  tokens.sort((a, b) => a.name.localeCompare(b.name))
  return { version: 1, tokens }
}

/** Short chip label: "1/1 · Haste", "0/1 · Defender", "1/1"; noncreatures show the first rules line; blanks the type line. */
export function variantLabel(v: TokenVariant): string {
  const pt = v.power !== undefined && v.toughness !== undefined ? `${v.power}/${v.toughness}` : ''
  const first = v.oracleText.split('\n')[0] ?? ''
  const text = first.length > 24 ? `${first.slice(0, 24).trimEnd()}…` : first
  return [pt, text].filter(Boolean).join(' · ') || v.typeLine
}

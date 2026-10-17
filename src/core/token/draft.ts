import type { CardData } from '../card/types'
import type { TokenEntry } from './index'

export const COPIES_MIN = 1
export const COPIES_MAX = 99

/** What the Tokens panel edits and prints. Every card field is the user's once the draft exists. */
export interface TokenDraft {
  base: { name: string; variant: number } | null   // where the draft started; null for a blank token
  card: CardData                                   // what renders
  artRef: string | null                            // printing ref, null = no art
  copies: number                                   // COPIES_MIN .. COPIES_MAX
}
export type StatPatch = { kind: 'pt'; power: string; toughness: string } | { kind: 'loyalty'; value: string } | { kind: 'none' }
export type DraftPatch = { name: string } | { typeLine: string } | { oracleText: string } | { stat: StatPatch } | { artRef: string | null } | { copies: number }

const clampCopies = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(COPIES_MAX, Math.max(COPIES_MIN, Math.round(n))) : COPIES_MIN

export function draftFromVariant(entry: TokenEntry, variant: number): TokenDraft {
  const i = entry.variants[variant] ? variant : 0
  const v = entry.variants[i]
  const card: CardData = { name: entry.name, manaCost: '', typeLine: v.typeLine, oracleText: v.oracleText }
  if (v.power !== undefined && v.toughness !== undefined) card.stat = { kind: 'pt', power: v.power, toughness: v.toughness }
  return { base: { name: entry.name, variant: i }, card, artRef: v.prints[0] ?? null, copies: 1 }
}

export function blankDraft(): TokenDraft {
  return { base: null, card: { name: 'Token', manaCost: '', typeLine: '', oracleText: '' }, artRef: null, copies: 1 }
}

/** Apply one edit. Pure: returns a new draft, never mutates. */
export function editDraft(d: TokenDraft, p: DraftPatch): TokenDraft {
  if ('copies' in p) return { ...d, copies: clampCopies(p.copies) }
  if ('artRef' in p) return { ...d, artRef: p.artRef }
  const card: CardData = { ...d.card }
  if ('name' in p) { const n = p.name.trim(); if (n) card.name = n }
  else if ('typeLine' in p) card.typeLine = p.typeLine.trim()
  else if ('oracleText' in p) card.oracleText = p.oracleText.replace(/\r\n?/g, '\n').trim()
  else if ('stat' in p) {
    const s = p.stat
    if (s.kind === 'pt' && (s.power.trim() || s.toughness.trim())) card.stat = { kind: 'pt', power: s.power.trim(), toughness: s.toughness.trim() }
    else if (s.kind === 'loyalty' && s.value.trim()) card.stat = { kind: 'loyalty', value: s.value.trim() }
    else delete card.stat
  }
  return { ...d, card }
}

/** Coerce a parsed localStorage value into a valid draft, or null when it is not one. */
export function normalizeDraft(input: unknown): TokenDraft | null {
  if (!input || typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  const c = (o.card && typeof o.card === 'object' ? o.card : null) as Record<string, unknown> | null
  if (!c || typeof c.name !== 'string' || !c.name.trim()) return null
  const s = c.name.trim()
  const card: CardData = {
    name: s,
    manaCost: typeof c.manaCost === 'string' ? c.manaCost : '',
    typeLine: typeof c.typeLine === 'string' ? c.typeLine : '',
    oracleText: typeof c.oracleText === 'string' ? c.oracleText : '',
  }
  const st = (c.stat && typeof c.stat === 'object' ? c.stat : null) as Record<string, unknown> | null
  if (st?.kind === 'pt' && typeof st.power === 'string' && typeof st.toughness === 'string') card.stat = { kind: 'pt', power: st.power, toughness: st.toughness }
  else if (st?.kind === 'loyalty' && typeof st.value === 'string') card.stat = { kind: 'loyalty', value: st.value }
  const b = (o.base && typeof o.base === 'object' ? o.base : null) as Record<string, unknown> | null
  const base = b && typeof b.name === 'string' && typeof b.variant === 'number' && Number.isFinite(b.variant)
    ? { name: b.name, variant: Math.max(0, Math.floor(b.variant)) } : null
  return { base, card, artRef: typeof o.artRef === 'string' ? o.artRef : null, copies: clampCopies(o.copies ?? 1) }
}

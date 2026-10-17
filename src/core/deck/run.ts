import type { ProxyCard } from '../card/types'
import type { GreyImage } from '../art/types'

/** One distinct card of a verified list: its sheets' art (one entry per sheet) and whether a meld part's back could not be fetched. */
export interface DeckCard { key: string; name: string; count: number; line: number; card: ProxyCard; arts: (GreyImage | null)[]; meldFailed: boolean }
export type ItemStatus = 'pending' | 'printed' | 'skipped'
export interface PrintItem { cardKey: string; copy: number; status: ItemStatus }
/** Immutable print queue: one item per copy, in list order. Every function returns a new run. */
export interface DeckRun { cards: DeckCard[]; items: PrintItem[]; excluded: ReadonlySet<string> }

export function createRun(cards: DeckCard[]): DeckRun {
  const items: PrintItem[] = []
  for (const c of cards) for (let copy = 1; copy <= c.count; copy++) items.push({ cardKey: c.key, copy, status: 'pending' })
  return { cards, items, excluded: new Set() }
}

/** Exclude or re-include a card. Only pending/skipped copies change; printed copies stay printed. */
export function toggleCard(run: DeckRun, key: string): DeckRun {
  const excluded = new Set(run.excluded)
  const nowExcluded = !excluded.has(key)
  if (nowExcluded) excluded.add(key); else excluded.delete(key)
  const items = run.items.map((i) => {
    if (i.cardKey !== key || i.status === 'printed') return i
    return { ...i, status: nowExcluded ? 'skipped' as const : 'pending' as const }
  })
  return { ...run, items, excluded }
}

export function nextPending(run: DeckRun): PrintItem | null {
  return run.items.find((i) => i.status === 'pending') ?? null
}

export function markPrinted(run: DeckRun, item: PrintItem): DeckRun {
  const items = run.items.map((i) => (i.cardKey === item.cardKey && i.copy === item.copy ? { ...i, status: 'printed' as const } : i))
  return { ...run, items }
}

/** total = pending + printed; skipped copies are out of the denominator. */
export function progress(run: DeckRun): { printed: number; total: number; remaining: number } {
  let printed = 0, remaining = 0
  for (const i of run.items) { if (i.status === 'printed') printed++; else if (i.status === 'pending') remaining++ }
  return { printed, total: printed + remaining, remaining }
}

/** Start over: printed copies back to pending; exclusions kept. */
export function reset(run: DeckRun): DeckRun {
  return { ...run, items: run.items.map((i) => (i.status === 'printed' ? { ...i, status: 'pending' as const } : i)) }
}

import type { Services } from './services'
import type { ProxyCard } from '../core/card/types'
import { normalizeScryfall, attachMeldBack } from '../core/card/normalize'

export interface LoadedCard { card: ProxyCard; meldFailed: boolean }

/** fetchCard + normalizeScryfall; for a meld part also fetchCardById(meldResult) + attachMeldBack. A failed second fetch gives meldFailed: true and a one-sheet card. */
export async function loadCard(services: Services, name: string): Promise<LoadedCard> {
  const card = normalizeScryfall(await services.client.fetchCard(name))
  if (!card.meldResult) return { card, meldFailed: false }
  let result: unknown
  try { result = await services.client.fetchCardById(card.meldResult) }
  catch { return { card, meldFailed: true } }
  return { card: attachMeldBack(card, result), meldFailed: false }
}

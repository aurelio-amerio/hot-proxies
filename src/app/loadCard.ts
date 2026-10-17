import type { Services } from './services'
import type { ProxyCard } from '../core/card/types'
import { normalizeScryfall, attachMeldBack } from '../core/card/normalize'

export interface LoadedCard { card: ProxyCard; meldFailed: boolean }

/** fetchCard + normalizeScryfall; for a meld part also fetchCardById(meldResult) + attachMeldBack. A failed second fetch gives meldFailed: true and a one-sheet card. */
export async function loadCard(services: Services, name: string): Promise<LoadedCard> {
  const card = normalizeScryfall(await services.client.fetchCard(name))
  if (!card.meldResult) return { card, meldFailed: false }
  try {
    return { card: attachMeldBack(card, await services.client.fetchCardById(card.meldResult)), meldFailed: false }
  } catch {
    return { card, meldFailed: true }
  }
}

import type { Services } from './services'
import type { CardData } from '../core/card/types'
import type { GreyImage } from '../core/art/types'
import { getPreferredArt } from '../core/art/preference'

export interface ResolvedArt { art: GreyImage | null; failed: boolean }

/** The art to render for a card: the remembered printing first, then the card's own crop. `failed` means there was art to load and none loaded. */
export async function resolveArt(services: Services, card: CardData): Promise<ResolvedArt> {
  const pref = getPreferredArt(services.storage, card.name)
  if (pref) {
    try { return { art: await services.decodeArt(await services.client.fetchArtById(pref)), failed: false } }
    catch { /* stale or unreachable preference: fall through to the default art */ }
  }
  if (card.artUrl) {
    try { return { art: await services.decodeArt(await services.client.fetchArtBlob(card.artUrl)), failed: false } }
    catch { return { art: null, failed: true } }
  }
  return { art: null, failed: !!pref }
}

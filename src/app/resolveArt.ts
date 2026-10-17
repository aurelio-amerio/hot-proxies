import type { Services } from './services'
import { sheetFaces, type ProxyCard } from '../core/card/types'
import type { GreyImage } from '../core/art/types'
import { getPreferredArt } from '../core/art/preference'

export interface ResolvedArt { art: GreyImage | null; failed: boolean }

/** One entry per sheet. Sheet 0 uses the remembered printing ref; sheet 1 of a non-meld pair uses `${ref}:1`; a meld back ignores the preference. Each falls back to its first face's artUrl, then to null. `failed` means there was art to load and none loaded. */
export async function resolveArt(services: Services, card: ProxyCard): Promise<ResolvedArt[]> {
  const pref = getPreferredArt(services.storage, card.name)
  return Promise.all(card.sheets.map(async (sheet, i): Promise<ResolvedArt> => {
    const ref = !pref || (i === 1 && card.meldBack) ? null : i === 1 ? `${pref}:1` : pref
    if (ref) {
      try { return { art: await services.decodeArt(await services.client.fetchArtById(ref)), failed: false } }
      catch { /* stale or unreachable preference: fall through to the face's own art */ }
    }
    const url = sheetFaces(sheet)[0].artUrl
    if (url) {
      try { return { art: await services.decodeArt(await services.client.fetchArtBlob(url)), failed: false } }
      catch { return { art: null, failed: true } }
    }
    return { art: null, failed: !!ref }
  }))
}

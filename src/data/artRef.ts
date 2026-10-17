/** Art refs (see core/token/index.ts artRef): 32 hex chars, optional ":1" for the back face. */
export interface ArtRef { uuid: string; face: 0 | 1 }

export function parseArtRef(ref: string): ArtRef | null {
  const m = /^([0-9a-f]{32})(?::([01]))?$/i.exec(ref)
  if (!m) return null
  const h = m[1].toLowerCase()
  const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  return { uuid, face: m[2] === '1' ? 1 : 0 }
}

/** Scryfall's CDN path for an art crop; the real URL may carry a cache-busting query, which the CDN does not require. */
export function artCropUrl(ref: string): string | null {
  const p = parseArtRef(ref)
  if (!p) return null
  return `https://cards.scryfall.io/art_crop/${p.face ? 'back' : 'front'}/${p.uuid[0]}/${p.uuid[1]}/${p.uuid}.jpg`
}

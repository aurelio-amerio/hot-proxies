import { describe, it, expect } from 'vitest'
import { parseArtRef, artCropUrl } from './artRef'

const HEX = 'aaaaaaaa000040008000000000000004'
const UUID = 'aaaaaaaa-0000-4000-8000-000000000004'

describe('parseArtRef', () => {
  it('re-hyphenates the id and reads the face', () => {
    expect(parseArtRef(HEX)).toEqual({ uuid: UUID, face: 0 })
    expect(parseArtRef(`${HEX}:1`)).toEqual({ uuid: UUID, face: 1 })
    expect(parseArtRef(HEX.toUpperCase())).toEqual({ uuid: UUID, face: 0 })
  })
  it('rejects anything that is not 32 hex chars with an optional :0/:1', () => {
    expect(parseArtRef('')).toBeNull(); expect(parseArtRef('abc')).toBeNull()
    expect(parseArtRef(`${HEX}:2`)).toBeNull(); expect(parseArtRef(UUID)).toBeNull()
  })
})

describe('artCropUrl', () => {
  it('builds the CDN path from the first two characters and the face', () => {
    expect(artCropUrl(HEX)).toBe(`https://cards.scryfall.io/art_crop/front/a/a/${UUID}.jpg`)
    expect(artCropUrl(`${HEX}:1`)).toBe(`https://cards.scryfall.io/art_crop/back/a/a/${UUID}.jpg`)
    expect(artCropUrl('nope')).toBeNull()
  })
})

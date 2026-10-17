import { describe, it, expect } from 'vitest'
import { sheetFrames } from './sheets'
import { escposFeed, escposRasterFrames } from '../output/escpos'
import { foldGuide } from '../output/foldGuide'
import { rotate180 } from '../output/rotate'
import { toPacked } from '../output/packed'

const sheet = (seed: number) => ({ width: 384, height: 3, bits: Uint8Array.from({ length: 384 * 3 }, (_, i) => (i * seed) % 5 === 0 ? 1 : 0) })
const raster = (b: { width: number; height: number; bits: Uint8Array }) => escposRasterFrames(toPacked(b), b.width, b.height)

describe('sheetFrames', () => {
  it('one sheet: raster then feed', () => {
    const a = sheet(3)
    expect(sheetFrames([a], 2)).toEqual([...raster(a), escposFeed(2)])
  })
  it('two sheets: front, fold guide, back rotated 180, feed; no ESC @', () => {
    const a = sheet(3), b = sheet(7)
    const frames = sheetFrames([a, b], 2)
    expect(frames).toEqual([...raster(a), ...raster(foldGuide(384)), ...raster(rotate180(b)), escposFeed(2)])
    for (const f of frames) expect(f[0] === 0x1b && f[1] === 0x40).toBe(false)
  })
})

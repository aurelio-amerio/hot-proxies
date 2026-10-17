import { describe, it, expect } from 'vitest'
import { foldGuide } from './foldGuide'
import { toPacked } from './packed'
import { FOLD_GUIDE_ROWS } from '../printer'

const count = (g: { width: number; bits: Uint8Array }, y: number) => g.bits.slice(y * g.width, (y + 1) * g.width).reduce((a, v) => a + v, 0)

describe('foldGuide', () => {
  const g = foldGuide(384)
  it('is FOLD_GUIDE_ROWS tall and as wide as asked', () => {
    expect(g.height).toBe(FOLD_GUIDE_ROWS); expect(g.width).toBe(384)
    expect(toPacked(g).length).toBe(48 * FOLD_GUIDE_ROWS)
  })
  it('dashes row 8 (192 dash dots + the two ticks that fall in an off run) with black edge ticks', () => {
    expect(count(g, 8)).toBe(194)
    expect(g.bits[8 * 384]).toBe(1); expect(g.bits[8 * 384 + 383]).toBe(1)
    expect(g.bits[8 * 384 + 8]).toBe(0)
  })
  it('draws only the four tick dots on row 7 and leaves the outer rows white', () => {
    expect(count(g, 7)).toBe(4)
    expect(count(g, 0)).toBe(0); expect(count(g, 15)).toBe(0)
  })
})

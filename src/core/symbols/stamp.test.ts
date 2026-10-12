import { describe, it, expect } from 'vitest'
import { nodeEnv, FONT_FAMILY } from '../../../tests/nodeEnv'
import { StampCache } from './stamp'

const black = (s: { canvas: { getContext(t: '2d'): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } } }, x: number, y: number) =>
  s.canvas.getContext('2d').getImageData(x, y, 1, 1).data[0] < 128

describe('StampCache', () => {
  const cache = new StampCache(nodeEnv, FONT_FAMILY)

  it('produces a square stamp of the requested size with a circle outline', () => {
    const s = cache.get('G', 20)
    expect(s.size).toBe(20); expect(s.canvas.width).toBe(20); expect(s.canvas.height).toBe(20)
    expect(black(s, 10, 1)).toBe(true)     // top of the outline
    expect(black(s, 0, 0)).toBe(false)     // corner outside the circle stays white
  })
  it('draws something inside the circle for a glyph and leaves the inner ring white', () => {
    const s = cache.get('W', 24)
    let inkInside = 0
    for (let y = 7; y < 17; y++) for (let x = 7; x < 17; x++) if (black(s, x, y)) inkInside++
    expect(inkInside).toBeGreaterThan(5)
    expect(black(s, 12, 3)).toBe(false)
  })
  it('returns the same object for the same code and size', () => {
    expect(cache.get('T', 18)).toBe(cache.get('T', 18))
    expect(cache.get('T', 18)).not.toBe(cache.get('T', 19))
  })
  it('renders hybrid, phyrexian and unknown codes without throwing', () => {
    for (const code of ['W/U', '2/G', 'G/P', '1000000', 'WOW']) expect(() => cache.get(code, 18)).not.toThrow()
    const s = cache.get('W/U', 24)
    expect(black(s, 12, 12)).toBe(true)    // the diagonal divider crosses the centre
  })
})

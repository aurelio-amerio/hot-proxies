import { describe, it, expect } from 'vitest'
import { resizeCover } from './resize'
import type { GreyImage } from './types'

const img = (w: number, h: number, f: (x: number, y: number) => number): GreyImage => {
  const data = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x, y)
  return { width: w, height: h, data }
}

describe('resizeCover', () => {
  it('returns the requested size', () => {
    const r = resizeCover(img(100, 50, () => 0.5), 40, 30)
    expect(r.width).toBe(40); expect(r.height).toBe(30); expect(r.data.length).toBe(1200)
  })
  it('averages when shrinking', () => {
    const r = resizeCover(img(4, 4, (x) => (x % 2 === 0 ? 0 : 1)), 2, 2)
    for (const v of r.data) expect(v).toBeCloseTo(0.5, 5)
  })
  it('cover-resizes a portrait source: crops top/bottom, keeps full width', () => {
    // top half black, bottom half white; portrait 20x80 into landscape 20x10 → centre crop is around the middle
    const r = resizeCover(img(20, 80, (_x, y) => (y < 40 ? 0 : 1)), 20, 10)
    expect(r.width).toBe(20); expect(r.height).toBe(10)
    expect(r.data[0]).toBeCloseTo(0, 5)                       // first row from just above the middle
    expect(r.data[r.data.length - 1]).toBeCloseTo(1, 5)       // last row from just below
  })
  it('cover-resizes a tiny source by enlarging without letterboxing', () => {
    const r = resizeCover(img(2, 2, (x) => x), 8, 6)
    expect(r.data[0]).toBeCloseTo(0, 5)
    expect(r.data[7]).toBeCloseTo(1, 5)
  })
})

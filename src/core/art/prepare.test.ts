import { describe, it, expect } from 'vitest'
import { prepareArt } from './prepare'
import { DEFAULT_SETTINGS } from '../settings'
import type { GreyImage } from './types'

const gradient = (w: number, h: number): GreyImage => {
  const data = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = x / (w - 1)
  return { width: w, height: h, data }
}

describe('prepareArt', () => {
  it('produces a BitImage exactly the size of the box', () => {
    const b = prepareArt(gradient(200, 150), { w: 101, h: 73 }, DEFAULT_SETTINGS)
    expect(b.width).toBe(101); expect(b.height).toBe(73)
  })
  it('with block 2 still fills the box exactly, with 2x2 blocks', () => {
    const b = prepareArt(gradient(200, 150), { w: 100, h: 74 }, { ...DEFAULT_SETTINGS, block: 2 })
    expect(b.width).toBe(100); expect(b.height).toBe(74)
    expect(b.bits[0]).toBe(b.bits[1]); expect(b.bits[0]).toBe(b.bits[100])
  })
  it('is darker on the left of a left-to-right gradient', () => {
    const b = prepareArt(gradient(200, 100), { w: 100, h: 50 }, DEFAULT_SETTINGS)
    let left = 0, right = 0
    for (let y = 0; y < 50; y++) for (let x = 0; x < 100; x++) (x < 50 ? (left += b.bits[y * 100 + x]) : (right += b.bits[y * 100 + x]))
    expect(left).toBeGreaterThan(right * 2)
  })
})

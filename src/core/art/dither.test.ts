import { describe, it, expect } from 'vitest'
import { atkinson, floydSteinberg, bayer4, threshold, upscale } from './dither'
import type { GreyImage } from './types'

const flat = (w: number, h: number, v: number): GreyImage => ({ width: w, height: h, data: new Float32Array(w * h).fill(v) })
const inkRatio = (b: { bits: Uint8Array }) => b.bits.reduce((a, v) => a + v, 0) / b.bits.length

describe('threshold', () => {
  it('maps dark to 1 and light to 0', () => {
    const b = threshold({ width: 2, height: 1, data: Float32Array.from([0.2, 0.8]) })
    expect(Array.from(b.bits)).toEqual([1, 0])
  })
})

describe.each([['atkinson', atkinson], ['floydSteinberg', floydSteinberg], ['bayer4', bayer4]] as const)('%s', (_n, fn) => {
  it('keeps pure black and pure white', () => {
    expect(inkRatio(fn(flat(16, 16, 0)))).toBe(1)
    expect(inkRatio(fn(flat(16, 16, 1)))).toBe(0)
  })
  it('renders mid grey as roughly half ink', () => {
    const r = inkRatio(fn(flat(32, 32, 0.5)))
    expect(r).toBeGreaterThan(0.3); expect(r).toBeLessThan(0.7)
  })
  it('preserves dimensions', () => {
    const b = fn(flat(7, 5, 0.3)); expect(b.width).toBe(7); expect(b.height).toBe(5); expect(b.bits.length).toBe(35)
  })
})

describe('bayer4', () => {
  it('is a fixed pattern: 25 % grey gives exactly 12 of 16 ink in each 4x4 tile', () => {
    const b = bayer4(flat(4, 4, 0.25))
    expect(b.bits.reduce((a, v) => a + v, 0)).toBe(12)
  })
})

describe('upscale', () => {
  it('repeats each bit block×block', () => {
    const b = upscale({ width: 2, height: 1, bits: Uint8Array.from([1, 0]) }, 2)
    expect(b.width).toBe(4); expect(b.height).toBe(2)
    expect(Array.from(b.bits)).toEqual([1, 1, 0, 0, 1, 1, 0, 0])
  })
})

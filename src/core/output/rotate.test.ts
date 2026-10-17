import { describe, it, expect } from 'vitest'
import { rotate180 } from './rotate'

describe('rotate180', () => {
  it('moves (0,0) of a 3x2 image to (2,1)', () => {
    const b = { width: 3, height: 2, bits: Uint8Array.from([1, 0, 0, 0, 0, 0]) }
    expect(Array.from(rotate180(b).bits)).toEqual([0, 0, 0, 0, 0, 1])
  })
  it('is its own inverse and keeps the size', () => {
    const b = { width: 3, height: 2, bits: Uint8Array.from([1, 1, 0, 0, 1, 0]) }
    const r = rotate180(b)
    expect(r.width).toBe(3); expect(r.height).toBe(2)
    expect(r.bits).not.toBe(b.bits)
    expect(Array.from(rotate180(r).bits)).toEqual(Array.from(b.bits))
  })
})

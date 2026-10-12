import { describe, it, expect } from 'vitest'
import { toPacked, bitImageToImageData } from './packed'

describe('toPacked', () => {
  it('packs MSB-first, 1 = black, rows padded to whole bytes', () => {
    const b = { width: 10, height: 2, bits: Uint8Array.from([1,0,0,0,0,0,0,0, 1,1,  0,0,0,0,0,0,0,1, 0,0]) }
    expect(Array.from(toPacked(b))).toEqual([0b10000000, 0b11000000, 0b00000001, 0b00000000])
  })
  it('produces 48 bytes per row for 384 dots', () => {
    expect(toPacked({ width: 384, height: 3, bits: new Uint8Array(384 * 3) }).length).toBe(144)
  })
})

describe('bitImageToImageData', () => {
  it('maps 1 to opaque black and 0 to opaque white', () => {
    const id = bitImageToImageData({ width: 2, height: 1, bits: Uint8Array.from([1, 0]) })
    expect(Array.from(id.data)).toEqual([0, 0, 0, 255, 255, 255, 255, 255])
  })
})

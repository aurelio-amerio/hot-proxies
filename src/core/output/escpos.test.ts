import { describe, it, expect } from 'vitest'
import { encodeEscPosRaster, encodeEscPosFrames } from './escpos'
import { toPacked } from './packed'

const packedFor = (width: number, height: number) => toPacked({ width, height, bits: new Uint8Array(width * height) })

describe('encodeEscPosRaster', () => {
  it('starts with ESC @ and ESC a 0, ends with ESC d 4', () => {
    const out = encodeEscPosRaster(packedFor(8, 1), 8, 1)
    expect(Array.from(out.subarray(0, 5))).toEqual([0x1b, 0x40, 0x1b, 0x61, 0x00])
    expect(Array.from(out.subarray(out.length - 3))).toEqual([0x1b, 0x64, 0x02])
  })
  it('emits one GS v 0 block per 64 rows with the right header', () => {
    const out = encodeEscPosRaster(packedFor(384, 70), 384, 70)
    // header(5) + block1 header(8) + 64*48 + block2 header(8) + 6*48 + feed(3)
    expect(out.length).toBe(5 + 8 + 64 * 48 + 8 + 6 * 48 + 3)
    expect(Array.from(out.subarray(5, 13))).toEqual([0x1d, 0x76, 0x30, 0x00, 48, 0, 64, 0])
    const second = 5 + 8 + 64 * 48
    expect(Array.from(out.subarray(second, second + 8))).toEqual([0x1d, 0x76, 0x30, 0x00, 48, 0, 6, 0])
  })
  it('encodes a 384 x 536 card to exactly 25808 bytes (9 blocks)', () => {
    expect(encodeEscPosRaster(packedFor(384, 536), 384, 536).length).toBe(25808)
  })
  it('copies the packed rows into the blocks in order', () => {
    const packed = Uint8Array.from([0xaa, 0x55, 0x0f])   // width 8, height 3
    const out = encodeEscPosRaster(packed, 8, 3)
    expect(Array.from(out.subarray(13, 16))).toEqual([0xaa, 0x55, 0x0f])
  })
  it('rounds the stride up for widths that are not multiples of 8', () => {
    const out = encodeEscPosRaster(packedFor(200, 2), 200, 2)   // stride 25
    expect(Array.from(out.subarray(5, 13))).toEqual([0x1d, 0x76, 0x30, 0x00, 25, 0, 2, 0])
    expect(out.length).toBe(5 + 8 + 50 + 3)
  })
  it('rejects a packed buffer whose length does not match width x height', () => {
    expect(() => encodeEscPosRaster(new Uint8Array(10), 8, 3)).toThrow(/does not match/)
  })
})

describe('encodeEscPosFrames', () => {
  it('splits the stream into header, one frame per raster block, and the feed', () => {
    const frames = encodeEscPosFrames(packedFor(384, 536), 384, 536)
    expect(frames.length).toBe(1 + 9 + 1)
    expect(Array.from(frames[0])).toEqual([0x1b, 0x40, 0x1b, 0x61, 0x00])
    expect(frames[1].length).toBe(8 + 64 * 48)
    expect(frames[9].length).toBe(8 + 24 * 48)
    expect(Array.from(frames[10])).toEqual([0x1b, 0x64, 0x02])
  })
  it('concatenates to exactly the raster stream', () => {
    const frames = encodeEscPosFrames(packedFor(200, 70), 200, 70)
    const joined = new Uint8Array(frames.reduce((a, f) => a + f.length, 0)); let o = 0
    for (const f of frames) { joined.set(f, o); o += f.length }
    expect(Array.from(joined)).toEqual(Array.from(encodeEscPosRaster(packedFor(200, 70), 200, 70)))
  })
})

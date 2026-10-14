import { RASTER_BLOCK_ROWS, FEED_LINES_AFTER } from '../printer'

/**
 * Wrap packed 1-bit rows (from `toPacked`) in the ESC/POS stream the PT-210 printed
 * correctly on 2026-10-14: ESC @, ESC a 0, GS v 0 blocks of ≤64 rows, ESC d 4.
 */
export function encodeEscPosRaster(packed: Uint8Array, width: number, height: number): Uint8Array {
  const stride = Math.ceil(width / 8)
  if (packed.length !== stride * height) {
    throw new Error(`packed length ${packed.length} does not match ${stride} bytes x ${height} rows`)
  }
  const blocks = Math.ceil(height / RASTER_BLOCK_ROWS)
  const out = new Uint8Array(5 + blocks * 8 + packed.length + 3)
  let o = 0
  out.set([0x1b, 0x40, 0x1b, 0x61, 0x00], o); o += 5
  for (let y = 0; y < height; y += RASTER_BLOCK_ROWS) {
    const rows = Math.min(RASTER_BLOCK_ROWS, height - y)
    out.set([0x1d, 0x76, 0x30, 0x00, stride & 0xff, stride >> 8, rows & 0xff, rows >> 8], o); o += 8
    out.set(packed.subarray(y * stride, (y + rows) * stride), o); o += rows * stride
  }
  out.set([0x1b, 0x64, FEED_LINES_AFTER], o)
  return out
}

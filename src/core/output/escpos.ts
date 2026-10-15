import { RASTER_BLOCK_ROWS, FEED_LINES_AFTER } from '../printer'

/** `ESC @` (initialise) then `ESC a 0` (left align). Sent once per run, never between cards: ESC @ clears the print buffer. */
export function escposInit(): Uint8Array {
  return Uint8Array.from([0x1b, 0x40, 0x1b, 0x61, 0x00])
}

/** `ESC d n`: print and feed n lines. */
export function escposFeed(lines: number): Uint8Array {
  return Uint8Array.from([0x1b, 0x64, lines & 0xff])
}

/**
 * One `GS v 0` frame per block of ≤RASTER_BLOCK_ROWS rows. A transfer may only stop between
 * frames: stopping inside a block leaves the printer waiting for image bytes and it would
 * swallow the next commands.
 */
export function escposRasterFrames(packed: Uint8Array, width: number, height: number): Uint8Array[] {
  const stride = Math.ceil(width / 8)
  if (packed.length !== stride * height) {
    throw new Error(`packed length ${packed.length} does not match ${stride} bytes x ${height} rows`)
  }
  const frames: Uint8Array[] = []
  for (let y = 0; y < height; y += RASTER_BLOCK_ROWS) {
    const rows = Math.min(RASTER_BLOCK_ROWS, height - y)
    const f = new Uint8Array(8 + rows * stride)
    f.set([0x1d, 0x76, 0x30, 0x00, stride & 0xff, stride >> 8, rows & 0xff, rows >> 8], 0)
    f.set(packed.subarray(y * stride, (y + rows) * stride), 8)
    frames.push(f)
  }
  return frames
}

/**
 * The ESC/POS stream the PT-210 printed correctly on 2026-10-14, as separate frames:
 * [ESC @ ESC a 0], one [GS v 0 header + rows] per block of ≤64 rows, then [ESC d n].
 */
export function encodeEscPosFrames(packed: Uint8Array, width: number, height: number): Uint8Array[] {
  return [escposInit(), ...escposRasterFrames(packed, width, height), escposFeed(FEED_LINES_AFTER)]
}

/** The frames of `encodeEscPosFrames` as one contiguous stream. */
export function encodeEscPosRaster(packed: Uint8Array, width: number, height: number): Uint8Array {
  const frames = encodeEscPosFrames(packed, width, height)
  const out = new Uint8Array(frames.reduce((a, f) => a + f.length, 0))
  let o = 0
  for (const f of frames) { out.set(f, o); o += f.length }
  return out
}

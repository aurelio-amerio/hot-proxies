/** PT-210 class printer: 58 mm roll, 48 mm printable, 203 dpi. */
export const DOTS_PER_LINE = 384
export const DPI = 203
/** Card height in dots for a given width, keeping the real 63:88 card ratio. */
export function cardHeight(width: number): number {
  return Math.round((width * 88) / 63)
}
/** ESC/POS `GS v 0` raster is sent in blocks of this many rows. */
export const RASTER_BLOCK_ROWS = 64
/** Lines fed after the card so it clears the tear bar (`ESC d n`). */
export const FEED_LINES_AFTER = 4
/** Bytes per BLE write. 100 printed a full card correctly on the PT-210 (2026-10-14). */
export const BLE_CHUNK_BYTES = 100

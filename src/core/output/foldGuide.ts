import type { BitImage } from '../art/types'
import { FOLD_GUIDE_ROWS } from '../printer'

const FOLD_ROW = 8
const DASH = 8
const TICK = 2

/** A dashed fold line (8 on / 8 off) across row 8 with short edge ticks on rows 7..8. */
export function foldGuide(width: number): BitImage {
  const bits = new Uint8Array(width * FOLD_GUIDE_ROWS)
  for (let x = 0; x < width; x++) {
    if (x % (2 * DASH) < DASH) bits[FOLD_ROW * width + x] = 1
    if (x < TICK || x >= width - TICK) {
      bits[(FOLD_ROW - 1) * width + x] = 1
      bits[FOLD_ROW * width + x] = 1
    }
  }
  return { width, height: FOLD_GUIDE_ROWS, bits }
}

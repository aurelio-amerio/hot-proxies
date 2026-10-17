import type { BitImage } from '../art/types'
import { escposFeed, escposRasterFrames } from '../output/escpos'
import { foldGuide } from '../output/foldGuide'
import { toPacked } from '../output/packed'
import { rotate180 } from '../output/rotate'

const raster = (b: BitImage) => escposRasterFrames(toPacked(b), b.width, b.height)

/**
 * Frames for one proxy card: raster(sheets[0]) [+ raster(foldGuide) + raster(rotate180(sheets[1]))] + feed.
 * The back is rotated so it reads upright when the folded card is turned over its long edge.
 * No ESC @ (the caller sends one per job); the sheets are separated by the guide only, no feed.
 */
export function sheetFrames(sheets: BitImage[], gapAfter: number): Uint8Array[] {
  const frames = raster(sheets[0])
  if (sheets.length > 1) frames.push(...raster(foldGuide(sheets[0].width)), ...raster(rotate180(sheets[1])))
  frames.push(escposFeed(gapAfter))
  return frames
}

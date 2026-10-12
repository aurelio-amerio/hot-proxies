import type { Settings } from '../settings'
import { autocontrast, gammaLift } from './grey'
import { resizeCover } from './resize'
import { atkinson, bayer4, floydSteinberg, threshold, upscale } from './dither'
import type { GreyImage, BitImage } from './types'

const DITHERS = { atkinson, 'floyd-steinberg': floydSteinberg, bayer4, threshold } as const

/** Full art pipeline: contrast → gamma → cover-resize to box/block → dither → upscale. Output is exactly box-sized. */
export function prepareArt(src: GreyImage, box: { w: number; h: number }, s: Settings): BitImage {
  const block = s.block
  const small = resizeCover(gammaLift(autocontrast(src, s.contrastCutoff), s.gamma), Math.ceil(box.w / block), Math.ceil(box.h / block))
  const bits = upscale(DITHERS[s.dither](small), block)
  if (bits.width === box.w && bits.height === box.h) return bits
  const out = new Uint8Array(box.w * box.h)
  for (let y = 0; y < box.h; y++) out.set(bits.bits.subarray(y * bits.width, y * bits.width + box.w), y * box.w)
  return { width: box.w, height: box.h, bits: out }
}

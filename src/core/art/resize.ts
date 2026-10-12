import type { GreyImage } from './types'

/** Scale so the source covers w×h, centre-crop the excess, then box-filter resample. */
export function resizeCover(src: GreyImage, w: number, h: number): GreyImage {
  const scale = Math.max(w / src.width, h / src.height)
  const cropW = w / scale, cropH = h / scale
  const x0 = (src.width - cropW) / 2, y0 = (src.height - cropH) / 2
  const data = new Float32Array(w * h)
  for (let dy = 0; dy < h; dy++) {
    const sy0 = y0 + (dy * cropH) / h, sy1 = y0 + ((dy + 1) * cropH) / h
    for (let dx = 0; dx < w; dx++) {
      const sx0 = x0 + (dx * cropW) / w, sx1 = x0 + ((dx + 1) * cropW) / w
      let sum = 0, weight = 0
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0)
        if (wy <= 0) continue
        const row = Math.min(src.height - 1, Math.max(0, sy)) * src.width
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0)
          if (wx <= 0) continue
          const v = src.data[row + Math.min(src.width - 1, Math.max(0, sx))]
          sum += v * wx * wy; weight += wx * wy
        }
      }
      data[dy * w + dx] = weight > 0 ? sum / weight : 0
    }
  }
  return { width: w, height: h, data }
}

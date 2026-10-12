import type { ImageDataLike } from '../env'
import type { GreyImage } from './types'

export function imageDataToGrey(id: ImageDataLike): GreyImage {
  const n = id.width * id.height, data = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const r = id.data[i * 4], g = id.data[i * 4 + 1], b = id.data[i * 4 + 2]
    data[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  }
  return { width: id.width, height: id.height, data }
}

/** Stretch so that `cutoffPercent` of pixels clip at each end (like PIL autocontrast). */
export function autocontrast(g: GreyImage, cutoffPercent: number): GreyImage {
  const sorted = Float32Array.from(g.data).sort()
  const n = sorted.length
  if (n === 0) return g
  const k = Math.min(n - 1, Math.floor((n * cutoffPercent) / 100))
  const lo = sorted[k], hi = sorted[n - 1 - k]
  const span = hi - lo
  const data = new Float32Array(n)
  for (let i = 0; i < n; i++) data[i] = span <= 1e-6 ? g.data[i] : Math.min(1, Math.max(0, (g.data[i] - lo) / span))
  return { width: g.width, height: g.height, data }
}

/** gamma > 1 brightens midtones (thermal paper darkens), gamma < 1 darkens. */
export function gammaLift(g: GreyImage, gamma: number): GreyImage {
  const data = new Float32Array(g.data.length)
  const inv = 1 / gamma
  for (let i = 0; i < data.length; i++) data[i] = Math.pow(g.data[i], inv)
  return { width: g.width, height: g.height, data }
}

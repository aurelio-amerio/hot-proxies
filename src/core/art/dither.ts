import type { GreyImage, BitImage } from './types'

export function threshold(g: GreyImage): BitImage {
  const bits = new Uint8Array(g.data.length)
  for (let i = 0; i < bits.length; i++) bits[i] = g.data[i] < 0.5 ? 1 : 0
  return { width: g.width, height: g.height, bits }
}

type Kernel = Array<[dx: number, dy: number, weight: number]>
function diffuse(g: GreyImage, kernel: Kernel): BitImage {
  const { width: w, height: h } = g
  const buf = Float32Array.from(g.data)
  const bits = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, old = buf[i], nw = old < 0.5 ? 0 : 1
    bits[i] = nw === 0 ? 1 : 0
    const err = old - nw
    for (const [dx, dy, wt] of kernel) {
      const nx = x + dx, ny = y + dy
      if (nx >= 0 && nx < w && ny < h) buf[ny * w + nx] += err * wt
    }
  }
  return { width: w, height: h, bits }
}

/** Atkinson: diffuses 6/8 of the error, which keeps highlights clean. */
export const atkinson = (g: GreyImage) => diffuse(g, [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]])
export const floydSteinberg = (g: GreyImage) => diffuse(g, [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]])

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
export function bayer4(g: GreyImage): BitImage {
  const bits = new Uint8Array(g.data.length)
  for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) {
    const t = (BAYER[y % 4][x % 4] + 0.5) / 16
    bits[y * g.width + x] = g.data[y * g.width + x] < t ? 1 : 0
  }
  return { width: g.width, height: g.height, bits }
}

export function upscale(b: BitImage, block: number): BitImage {
  if (block === 1) return b
  const w = b.width * block, h = b.height * block, bits = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bits[y * w + x] = b.bits[Math.floor(y / block) * b.width + Math.floor(x / block)]
  return { width: w, height: h, bits }
}

import type { BitImage } from '../art/types'
import type { CanvasLike, ImageDataLike } from '../env'

/** Pack rows MSB-first, 1 = black. This is the ESC/POS raster layout. */
export function toPacked(b: BitImage): Uint8Array {
  const stride = Math.ceil(b.width / 8)
  const out = new Uint8Array(stride * b.height)
  for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
    if (b.bits[y * b.width + x]) out[y * stride + (x >> 3)] |= 0x80 >> (x & 7)
  }
  return out
}

export function bitImageToImageData(b: BitImage): ImageDataLike {
  const data = new Uint8ClampedArray(b.width * b.height * 4)
  for (let i = 0; i < b.bits.length; i++) {
    const v = b.bits[i] ? 0 : 255
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255
  }
  return { width: b.width, height: b.height, data }
}

/** Threshold a painted greyscale canvas at 50 %. */
export function canvasToBitImage(canvas: CanvasLike): BitImage {
  const id = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  const bits = new Uint8Array(canvas.width * canvas.height)
  for (let i = 0; i < bits.length; i++) {
    const lum = 0.299 * id.data[i * 4] + 0.587 * id.data[i * 4 + 1] + 0.114 * id.data[i * 4 + 2]
    bits[i] = lum < 128 ? 1 : 0
  }
  return { width: canvas.width, height: canvas.height, bits }
}

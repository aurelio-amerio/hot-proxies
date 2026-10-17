import type { BitImage } from '../art/types'

/** A new image turned half a revolution: (x, y) -> (w-1-x, h-1-y). */
export function rotate180(b: BitImage): BitImage {
  const n = b.bits.length
  const bits = new Uint8Array(n)
  for (let i = 0; i < n; i++) bits[n - 1 - i] = b.bits[i]
  return { width: b.width, height: b.height, bits }
}

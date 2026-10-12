import { describe, it, expect } from 'vitest'
import { nodeEnv, FONT_FAMILY } from '../../../tests/nodeEnv'
import { StampCache } from '../symbols/stamp'
import { canvasToBitImage } from '../output/packed'
import { drawLines } from './draw'

const stamps = new StampCache(nodeEnv, FONT_FAMILY)

/** Rows containing ink after 50 % threshold, for a single glyph drawn by drawLines at a sub-dot x offset. */
function inkRows(text: string, size: number, dx: number): number {
  const canvas = nodeEnv.createCanvas(40, 40)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 40, 40)
  drawLines(ctx, [{ items: [{ kind: 'text', text, x: dx, width: 10 }], width: 10 }], 10, 5, 24, `${size}px ${FONT_FAMILY}`, stamps, 16)
  const b = canvasToBitImage(canvas)
  let rows = 0
  for (let y = 0; y < b.height; y++) if (b.bits.subarray(y * b.width, (y + 1) * b.width).some((v) => v)) rows++
  return rows
}

describe('drawLines', () => {
  it('keeps the vertical stroke of "+" at every rules text size and sub-dot phase', () => {
    for (let size = 11; size <= 22; size++) for (const dx of [0, 0.25, 0.5, 0.75]) {
      expect(inkRows('+', size, dx), `${size}px at +${dx}`).toBeGreaterThan(2)
    }
  })
})

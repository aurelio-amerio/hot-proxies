import type { Ctx2D } from '../env'
import type { StampCache } from '../symbols/stamp'
import type { Line } from './wrap'

const OVERSTRIKE = 0.5

/** Paint wrapped lines. `top` is the top of the first line; text baseline sits at 75 % of lineHeight. */
export function drawLines(ctx: Ctx2D, lines: Line[], x: number, top: number, lineHeight: number, font: string, stamps: StampCache, symbolSize: number): void {
  ctx.font = font
  ctx.fillStyle = '#000'
  ctx.textBaseline = 'alphabetic'
  const baseline = Math.round(lineHeight * 0.75)
  lines.forEach((line, i) => {
    const y = top + i * lineHeight
    for (const item of line.items) {
      if (item.kind === 'text') {
        // Overstrike by half a dot: hairline strokes (the stem of "+", the dot of "i") otherwise
        // straddle two dots at < 50 % each and vanish when thresholded, turning "+3:" into "−3:".
        ctx.fillText(item.text, x + item.x, y + baseline)
        ctx.fillText(item.text, x + item.x + OVERSTRIKE, y + baseline)
      }
      else ctx.drawImage(stamps.get(item.code, symbolSize).canvas, x + item.x + 1, y + Math.round((lineHeight - symbolSize) / 2))
    }
  })
}

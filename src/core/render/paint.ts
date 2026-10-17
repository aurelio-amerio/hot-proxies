import type { Sheet } from '../card/types'
import type { Settings } from '../settings'
import type { RenderEnv } from '../env'
import type { Geometry } from '../layout/fit'
import type { BitImage } from '../art/types'
import type { StampCache } from '../symbols/stamp'
import { canvasToBitImage } from '../output/packed'
import { drawFace, strokeRect } from './parts'
import { paintColumns } from './paintColumns'
import { paintStacked } from './paintStacked'
import { FRAME } from '../layout/constants'

/** Paint the card (text, bars, symbols) in greyscale, threshold it, then blit the dithered art bits. */
export function paint(sheet: Extract<Sheet, { kind: 'standard' | 'columns' | 'stacked' }>, g: Geometry, artBits: BitImage | null, s: Settings, env: RenderEnv, stamps: StampCache): BitImage {
  const canvas = env.createCanvas(g.card.w, g.card.h)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, g.card.w, g.card.h)
  strokeRect(ctx, { x: 0, y: 0, w: g.card.w, h: g.card.h }, FRAME)

  if (sheet.kind === 'columns') paintColumns(ctx, sheet, g, s, stamps)
  else if (sheet.kind === 'stacked') paintStacked(ctx, sheet, g, s, stamps)
  else drawFace(ctx, sheet.face, g, s.fontFamily, stamps)

  const bits = canvasToBitImage(canvas)
  if (artBits && g.art) {
    const ax = g.art.x + 2, ay = g.art.y + 2
    for (let y = 0; y < artBits.height; y++) bits.bits.set(artBits.bits.subarray(y * artBits.width, (y + 1) * artBits.width), (ay + y) * bits.width + ax)
  }
  return bits
}

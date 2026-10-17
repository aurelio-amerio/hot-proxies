import type { Sheet } from '../card/types'
import type { Settings } from '../settings'
import type { RenderEnv, Ctx2D } from '../env'
import type { Geometry } from '../layout/fit'
import type { BitImage } from '../art/types'
import type { StampCache } from '../symbols/stamp'
import { drawLines } from '../text/draw'
import { canvasToBitImage } from '../output/packed'
import { drawNameBar, drawTypeBar, drawStatBox, strokeRect } from './parts'
import { paintColumns } from './paintColumns'
import { FRAME, TEXT_PAD } from '../layout/constants'

/** Paint the card (text, bars, symbols) in greyscale, threshold it, then blit the dithered art bits. */
export function paint(sheet: Extract<Sheet, { kind: 'standard' | 'columns' }>, g: Geometry, artBits: BitImage | null, s: Settings, env: RenderEnv, stamps: StampCache): BitImage {
  const canvas = env.createCanvas(g.card.w, g.card.h)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, g.card.w, g.card.h)
  strokeRect(ctx, { x: 0, y: 0, w: g.card.w, h: g.card.h }, FRAME)

  if (sheet.kind === 'columns') paintColumns(ctx, sheet, g, s, stamps)
  else paintStandard(ctx, sheet, g, s, stamps)

  const bits = canvasToBitImage(canvas)
  if (artBits && g.art) {
    const ax = g.art.x + 2, ay = g.art.y + 2
    for (let y = 0; y < artBits.height; y++) bits.bits.set(artBits.bits.subarray(y * artBits.width, (y + 1) * artBits.width), (ay + y) * bits.width + ax)
  }
  return bits
}

function paintStandard(ctx: Ctx2D, sheet: Extract<Sheet, { kind: 'standard' }>, g: Geometry, s: Settings, stamps: StampCache): void {
  const face = sheet.face
  const family = s.fontFamily
  drawNameBar(ctx, g, face, family, stamps)

  // art frame (art itself is blitted after thresholding)
  if (g.art) strokeRect(ctx, g.art, 2)

  drawTypeBar(ctx, g.typeBar, g.typeFontSize, face.typeLine, family)

  // text box
  strokeRect(ctx, g.textBox, 2)
  drawLines(ctx, g.textLines, g.textBox.x + TEXT_PAD, g.textBox.y + TEXT_PAD, g.lineHeight, `${g.textFontSize}px ${family}`, stamps, g.symbolSize)

  if (g.statBox && face.stat) drawStatBox(ctx, g.statBox, face.stat, family)
}

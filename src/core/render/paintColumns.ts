import type { Sheet } from '../card/types'
import type { Settings } from '../settings'
import type { Ctx2D } from '../env'
import type { Geometry } from '../layout/fit'
import type { StampCache } from '../symbols/stamp'
import { drawLines } from '../text/draw'
import { drawNameBar, drawTypeBar, drawStatBox, drawCostRight, strokeRect } from './parts'
import { TEXT_PAD, BADGE, SECTION_RULE } from '../layout/constants'

/** Columns sheet: bars, text column with its sections, the art column's frame and the stat box. The art is blitted by `paint`. */
export function paintColumns(ctx: Ctx2D, sheet: Extract<Sheet, { kind: 'columns' }>, g: Geometry, s: Settings, stamps: StampCache): void {
  const face = sheet.face
  const family = s.fontFamily
  const tb = g.textBox
  const right = tb.x + tb.w - TEXT_PAD

  drawNameBar(ctx, g, face, family, stamps)
  if (g.art) strokeRect(ctx, g.art, 2)
  drawTypeBar(ctx, g.typeBar, g.typeFontSize, face.typeLine, family)
  strokeRect(ctx, tb, 2)

  for (const sec of g.sections ?? []) {
    ctx.fillStyle = '#000'
    // hairline rules are filled, not stroked, so they land on whole dots and survive thresholding
    if (sec.rule !== undefined) ctx.fillRect(tb.x + TEXT_PAD, sec.rule, tb.w - 2 * TEXT_PAD, SECTION_RULE)
    if (sec.header) {
      const h = sec.header
      ctx.font = `bold ${g.textFontSize}px ${family}`; ctx.textBaseline = 'alphabetic'
      const baseline = h.y + Math.round(g.lineHeight * 0.75)
      ctx.fillText(h.label, sec.textX, baseline)
      if (h.statLabel) {
        ctx.fillText(h.statLabel, right - ctx.measureText(h.statLabel).width, baseline)
      } else if (h.costCodes.length) {
        drawCostRight(ctx, h.costCodes, right - 1, h.y + Math.round((g.lineHeight - g.symbolSize) / 2), g.symbolSize, 2, stamps)
      }
    }
    for (const b of sec.badges) ctx.drawImage(stamps.get(b.code, BADGE).canvas, b.rect.x, b.rect.y)
    drawLines(ctx, sec.lines, sec.textX, sec.textTop, g.lineHeight, `${g.textFontSize}px ${family}`, stamps, g.symbolSize)
  }

  if (g.statBox && face.stat) drawStatBox(ctx, g.statBox, face.stat, family)
}

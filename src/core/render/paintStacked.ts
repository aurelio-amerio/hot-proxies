import type { Sheet } from '../card/types'
import type { Settings } from '../settings'
import type { Ctx2D } from '../env'
import type { Geometry } from '../layout/fit'
import type { StampCache } from '../symbols/stamp'
import { drawLines } from '../text/draw'
import { drawFace, drawStatBox, drawCostRight, strokeRect } from './parts'
import { costCodes } from '../layout/bars'
import { SUB_PAD, SUB_TYPE_H } from '../layout/constants'

/** Stacked sheet: the main face as a standard card, then the sub box (header, type row, text, stat). The art is blitted by `paint`. */
export function paintStacked(ctx: Ctx2D, sheet: Extract<Sheet, { kind: 'stacked' }>, g: Geometry, s: Settings, stamps: StampCache): void {
  const family = s.fontFamily
  drawFace(ctx, sheet.face, g, family, stamps)

  const sub = g.sub!, face = sheet.sub, box = sub.box
  const left = box.x + SUB_PAD, right = box.x + box.w - SUB_PAD
  strokeRect(ctx, box, 2)

  // header: name left; cost right-aligned, followed by the prototype's size when it has one
  ctx.fillStyle = '#000'; ctx.font = `bold ${g.textFontSize}px ${family}`; ctx.textBaseline = 'alphabetic'
  const baseline = sub.nameY + Math.round(g.lineHeight * 0.75)
  ctx.fillText(face.name, left, baseline)
  let costRight = right
  if (sub.headerStat) {
    const w = ctx.measureText(sub.headerStat).width
    ctx.fillText(sub.headerStat, right - w, baseline)
    costRight = right - w - 6
  }
  drawCostRight(ctx, costCodes(face.manaCost), costRight - 1, sub.nameY + Math.round((g.lineHeight - g.symbolSize) / 2), g.symbolSize, 2, stamps)

  // type row, clipped to the box like the type bar
  if (sub.typeY !== undefined) {
    ctx.font = `bold ${sub.typeFontSize}px ${family}`
    ctx.save()
    ctx.beginPath(); ctx.moveTo(box.x + 2, sub.typeY); ctx.lineTo(box.x + box.w - 4, sub.typeY)
    ctx.lineTo(box.x + box.w - 4, sub.typeY + SUB_TYPE_H); ctx.lineTo(box.x + 2, sub.typeY + SUB_TYPE_H); ctx.closePath(); ctx.clip()
    ctx.fillText(face.typeLine, left, sub.typeY + Math.round(SUB_TYPE_H * 0.7))
    ctx.restore()
  }

  drawLines(ctx, sub.lines, left, sub.textTop, g.lineHeight, `${g.textFontSize}px ${family}`, stamps, g.symbolSize)
  if (sub.statBox && face.stat) drawStatBox(ctx, sub.statBox, face.stat, family)
}

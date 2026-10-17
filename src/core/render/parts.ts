import type { Face, Stat } from '../card/types'
import { statLabel } from '../card/types'
import type { Ctx2D } from '../env'
import type { Geometry, Rect } from '../layout/fit'
import { costCodes, type NameBarFit } from '../layout/bars'
import type { StampCache } from '../symbols/stamp'
import { drawLines } from '../text/draw'
import { NAME_H, STAT_PAD, TEXT_PAD } from '../layout/constants'

export function strokeRect(ctx: Ctx2D, r: Rect, lw: number): void {
  ctx.lineWidth = lw; ctx.strokeStyle = '#000'
  ctx.beginPath(); ctx.moveTo(r.x + lw / 2, r.y + lw / 2); ctx.lineTo(r.x + r.w - lw / 2, r.y + lw / 2)
  ctx.lineTo(r.x + r.w - lw / 2, r.y + r.h - lw / 2); ctx.lineTo(r.x + lw / 2, r.y + r.h - lw / 2); ctx.closePath(); ctx.stroke()
}

/** Name bar: frame, name, and the cost symbols right-aligned (or under the name). */
export function drawNameBar(ctx: Ctx2D, bar: NameBarFit & { costSymbolSize: number }, face: Pick<Face, 'name' | 'manaCost'>, family: string, stamps: StampCache): void {
  strokeRect(ctx, bar.nameBar, 2)
  ctx.fillStyle = '#000'; ctx.font = `bold ${bar.nameFontSize}px ${family}`; ctx.textBaseline = 'alphabetic'
  ctx.fillText(face.name, bar.nameBar.x + 8, bar.nameBar.y + Math.round(NAME_H * 0.68))
  const y = bar.costOnSecondLine ? bar.nameBar.y + NAME_H : bar.nameBar.y + Math.round((NAME_H - bar.costSymbolSize) / 2)
  drawCostRight(ctx, costCodes(face.manaCost), bar.nameBar.x + bar.nameBar.w - 8, y, bar.costSymbolSize, 3, stamps)
}

/** Cost symbols in a row, `gap` dots apart, the last one ending at `right`. */
export function drawCostRight(ctx: Ctx2D, codes: string[], right: number, y: number, size: number, gap: number, stamps: StampCache): void {
  let x = right - codes.length * (size + gap) + gap
  for (const code of codes) { ctx.drawImage(stamps.get(code, size).canvas, x, y); x += size + gap }
}

/** Type bar: frame plus the type line, clipped to the bar. */
export function drawTypeBar(ctx: Ctx2D, bar: Rect, fontSize: number, typeLine: string, family: string): void {
  strokeRect(ctx, bar, 2)
  ctx.fillStyle = '#000'; ctx.font = `bold ${fontSize}px ${family}`
  ctx.save()
  ctx.beginPath(); ctx.moveTo(bar.x + 2, bar.y); ctx.lineTo(bar.x + bar.w - 4, bar.y)
  ctx.lineTo(bar.x + bar.w - 4, bar.y + bar.h); ctx.lineTo(bar.x + 2, bar.y + bar.h); ctx.closePath(); ctx.clip()
  ctx.fillText(typeLine, bar.x + 8, bar.y + Math.round(bar.h * 0.7))
  ctx.restore()
}

export function drawStatBox(ctx: Ctx2D, box: Rect, stat: Stat, family: string): void {
  ctx.fillStyle = '#fff'; ctx.fillRect(box.x, box.y, box.w, box.h)
  strokeRect(ctx, box, 2)
  ctx.fillStyle = '#000'; ctx.font = `bold 24px ${family}`
  ctx.fillText(statLabel(stat), box.x + STAT_PAD, box.y + Math.round(box.h * 0.75))
}

/** A face laid out as a standard card: name bar, art frame (the art is blitted later), type bar, text box and stat box. */
export function drawFace(ctx: Ctx2D, face: Face, g: Geometry, family: string, stamps: StampCache): void {
  drawNameBar(ctx, g, face, family, stamps)

  // art frame (art itself is blitted after thresholding)
  if (g.art) strokeRect(ctx, g.art, 2)

  drawTypeBar(ctx, g.typeBar, g.typeFontSize, face.typeLine, family)

  // text box
  strokeRect(ctx, g.textBox, 2)
  drawLines(ctx, g.textLines, g.textBox.x + TEXT_PAD, g.textBox.y + TEXT_PAD, g.lineHeight, `${g.textFontSize}px ${family}`, stamps, g.symbolSize)

  if (g.statBox && face.stat) drawStatBox(ctx, g.statBox, face.stat, family)
}

import type { Face, Stat } from '../card/types'
import { statLabel } from '../card/types'
import type { Ctx2D } from '../env'
import type { Rect } from '../layout/fit'
import type { NameBarFit } from '../layout/bars'
import type { StampCache } from '../symbols/stamp'
import { NAME_H, STAT_PAD } from '../layout/constants'

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
  const codes = (face.manaCost.match(/\{([^}]+)\}/g) ?? []).map((m) => m.slice(1, -1))
  if (codes.length) {
    const step = bar.costSymbolSize + 3
    const y = bar.costOnSecondLine ? bar.nameBar.y + NAME_H : bar.nameBar.y + Math.round((NAME_H - bar.costSymbolSize) / 2)
    let x = bar.nameBar.x + bar.nameBar.w - 8 - codes.length * step + 3
    for (const code of codes) { ctx.drawImage(stamps.get(code, bar.costSymbolSize).canvas, x, y); x += step }
  }
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

import type { Face, Sheet } from '../card/types'
import type { Settings } from '../settings'
import type { Ctx2D } from '../env'
import type { Geometry, HalfGeometry } from '../layout/fit'
import type { StampCache } from '../symbols/stamp'
import { drawLines } from '../text/draw'
import { drawNameBar, drawTypeBar, strokeRect } from './parts'
import { TEXT_PAD } from '../layout/constants'

/** Split sheet: two half-cards (name bar, type bar, text box) with the art frame between them. The art is blitted by `paint`. */
export function paintSplit(ctx: Ctx2D, sheet: Extract<Sheet, { kind: 'split' }>, g: Geometry, s: Settings, stamps: StampCache): void {
  const first: HalfGeometry = {
    nameBar: g.nameBar, nameFontSize: g.nameFontSize, costOnSecondLine: g.costOnSecondLine,
    typeBar: g.typeBar, typeFontSize: g.typeFontSize, textBox: g.textBox, lines: g.textLines,
  }
  drawHalf(ctx, sheet.halves[0], first, g, s.fontFamily, stamps)
  if (g.art) strokeRect(ctx, g.art, 2)
  drawHalf(ctx, sheet.halves[1], g.second!, g, s.fontFamily, stamps)
}

function drawHalf(ctx: Ctx2D, face: Face, h: HalfGeometry, g: Geometry, family: string, stamps: StampCache): void {
  drawNameBar(ctx, { ...h, costSymbolSize: g.costSymbolSize }, face, family, stamps)
  drawTypeBar(ctx, h.typeBar, h.typeFontSize, face.typeLine, family)
  strokeRect(ctx, h.textBox, 2)
  drawLines(ctx, h.lines, h.textBox.x + TEXT_PAD, h.textBox.y + TEXT_PAD, g.lineHeight, `${g.textFontSize}px ${family}`, stamps, g.symbolSize)
}

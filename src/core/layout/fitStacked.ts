import type { Face, Sheet } from '../card/types'
import { statLabel } from '../card/types'
import type { Settings } from '../settings'
import type { RenderEnv, Ctx2D } from '../env'
import { cardHeight } from '../printer'
import { tokenize } from '../text/tokenize'
import { wrapText, type Line } from '../text/wrap'
import { stripReminder } from './reminder'
import { stackedCandidates } from './candidates'
import { fitNameBar, fitTypeFont, statWidth, lineHeightFor, symbolSizeFor } from './bars'
import { faceBoxes, wrapBoxText, type FaceBoxes } from './face'
import type { Geometry, Rect, SubGeometry } from './fit'
import { MARGIN, GAP, STAT_H, COST_SYMBOL, SUB_PAD, SUB_TYPE_H } from './constants'

type StackedSheet = Extract<Sheet, { kind: 'stacked' }>

/** The sub face's fixed parts: type font and stat width do not depend on the candidate. */
interface SubFrame { face: Face; typeFontSize: number; statW: number; headerStat?: string }

/** Stacked sheet (adventure, flip, prototype): the main face as a standard card, the second face in a box at the bottom. Spec 5.2. */
export function fitStacked(sheet: StackedSheet, s: Settings, env: RenderEnv): Geometry {
  const face = sheet.face
  const W = s.dotsPerLine, H = cardHeight(W)
  const ctx = env.createCanvas(8, 8).getContext('2d')
  const family = s.fontFamily
  const innerW = W - 2 * MARGIN

  const { nameBar, nameFontSize, costOnSecondLine } = fitNameBar(ctx, face, s.nameSize, family, MARGIN, MARGIN, innerW)
  const statW = face.stat ? statWidth(ctx, face.stat, family) : 0
  const typeFontSize = fitTypeFont(ctx, face.typeLine, family, innerW)
  const fixedTop = nameBar.y + nameBar.h + GAP

  const sub = sheet.sub
  const frame: SubFrame = {
    face: sub,
    typeFontSize: sub.typeLine ? fitTypeFont(ctx, sub.typeLine, family, innerW - 2 * SUB_PAD + 16) : 0,
    // a prototype has no type row: its size goes in the header instead of a stat box
    statW: sub.stat && sub.typeLine ? statWidth(ctx, sub.stat, family) : 0,
    headerStat: sub.stat && !sub.typeLine ? statLabel(sub.stat) : undefined,
  }

  const layout = (textSize: number, artH: number, stripped: boolean, subText: string, subLines?: number) => {
    const subG = layoutSub(ctx, frame, subText, textSize, family, MARGIN, H - MARGIN, innerW, subLines)
    const boxes = faceBoxes(MARGIN, fixedTop, innerW, artH, subG.box.y - GAP, statW)
    const text = stripped ? stripReminder(face.oracleText) : face.oracleText
    return { subG, boxes, ...wrapBoxText(ctx, text, textSize, family, boxes.textBox, statW) }
  }

  let chosen: { subG: SubGeometry; boxes: FaceBoxes; lines: Line[]; textSize: number; artH: number; stripped: boolean; overflow: boolean } | undefined
  const cands = stackedCandidates(s.textSize, s.stripReminder)
  for (const [i, cand] of cands.entries()) {
    const subText = cand.stripped ? stripReminder(sub.oracleText) : sub.oracleText
    let l = layout(cand.textSize, cand.artH, cand.stripped, subText)
    if (l.lines.length <= l.linesAvail) { chosen = { ...l, ...cand, overflow: false }; break }
    if (i < cands.length - 1) continue
    // overflow: give the main text room by clipping the sub text first (down to one line), then clip the main text
    for (let k = l.subG.lines.length - 1; k >= 1 && l.lines.length > l.linesAvail; k--) l = layout(cand.textSize, cand.artH, cand.stripped, subText, k)
    chosen = { ...l, lines: l.lines.slice(0, Math.max(1, l.linesAvail)), ...cand, overflow: true }
  }
  const c = chosen!
  const { art, typeBar, textBox, statBox } = c.boxes

  return {
    kind: 'stacked',
    card: { w: W, h: H },
    nameBar, nameFontSize, costOnSecondLine, costSymbolSize: COST_SYMBOL,
    art, typeBar, typeFontSize,
    textBox, textFontSize: c.textSize, lineHeight: lineHeightFor(c.textSize), symbolSize: symbolSizeFor(c.textSize), textLines: c.lines,
    statBox,
    sub: c.subG,
    overflow: c.overflow, strippedReminder: c.stripped,
  }
}

/**
 * The sub box, sized to its wrapped lines and sitting on `bottom`. Lines that would run into its stat box are
 * narrowed; since the box height depends on the line count, wrap again until the count settles. `maxLines`
 * clips the text to that many lines, wrapped for the smaller box.
 */
function layoutSub(ctx: Ctx2D, f: SubFrame, text: string, textSize: number, family: string, x: number, bottom: number, w: number, maxLines?: number): SubGeometry {
  const lh = lineHeightFor(textSize)
  const wrapW = w - 2 * SUB_PAD
  const headerH = SUB_PAD + lh + (f.face.typeLine ? SUB_TYPE_H : 0)
  const boxFor = (n: number): Rect => { const h = headerH + n * lh + SUB_PAD; return { x, y: bottom - h, w, h } }
  /** Wrap for `box`; null wraps at full width, which gives the fewest lines. */
  const wrap = (box: Rect | null) => {
    const statTop = box ? box.y + box.h - STAT_H - 2 : Infinity
    const textTop = box ? box.y + headerH : 0
    const widthForLine = (i: number) => f.statW && textTop + (i + 1) * lh > statTop ? wrapW - f.statW - 4 : wrapW
    return wrapText(tokenize(text), { ctx, font: `${textSize}px ${family}`, symbolSize: symbolSizeFor(textSize), widthForLine })
  }

  let n = maxLines ?? wrap(null).length
  let lines = wrap(boxFor(n))
  if (maxLines === undefined) while (lines.length > n) { n = lines.length; lines = wrap(boxFor(n)) }
  else lines = lines.slice(0, n)
  const box = boxFor(n)

  const nameY = box.y + SUB_PAD
  const typeY = f.face.typeLine ? nameY + lh : undefined
  return {
    box, nameY, typeY, typeFontSize: f.typeFontSize,
    textTop: typeY !== undefined ? typeY + SUB_TYPE_H : nameY + lh,
    lines,
    statBox: f.statW ? { x: box.x + box.w - f.statW, y: box.y + box.h - STAT_H, w: f.statW, h: STAT_H } : undefined,
    headerStat: f.headerStat,
  }
}

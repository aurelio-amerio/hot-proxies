import type { Face, Sheet } from '../card/types'
import type { Settings } from '../settings'
import type { RenderEnv, Ctx2D } from '../env'
import { cardHeight } from '../printer'
import { tokenize } from '../text/tokenize'
import { wrapText, type Line } from '../text/wrap'
import { stripReminder } from './reminder'
import { splitCandidates } from './candidates'
import { fitNameBar, fitTypeFont, lineHeightFor, symbolSizeFor, type NameBarFit } from './bars'
import type { Geometry, HalfGeometry, Rect } from './fit'
import { MARGIN, GAP, TYPE_H, TEXT_PAD, COST_SYMBOL } from './constants'

type SplitSheet = Extract<Sheet, { kind: 'split' }>

/** A half's fixed parts: name bar (fitted at y = 0) and type font do not depend on the candidate. */
interface HalfFrame { face: Face; bar: NameBarFit; typeFontSize: number }

/** Split sheet (split, aftermath): two half-cards top to bottom, the shared art between them. Spec 5.3. */
export function fitSplit(sheet: SplitSheet, s: Settings, env: RenderEnv): Geometry {
  const W = s.dotsPerLine, H = cardHeight(W)
  const ctx = env.createCanvas(8, 8).getContext('2d')
  const family = s.fontFamily
  const innerW = W - 2 * MARGIN

  const frames = sheet.halves.map((face): HalfFrame => ({
    face,
    bar: fitNameBar(ctx, face, s.nameSize, family, MARGIN, 0, innerW),
    typeFontSize: fitTypeFont(ctx, face.typeLine, family, innerW),
  })) as [HalfFrame, HalfFrame]
  // everything but the text lines and the art: two name bars, two type bars, the gaps and the text boxes' padding
  const fixedH = MARGIN + frames.reduce((h, f) => h + f.bar.nameBar.h + GAP + TYPE_H + GAP + 2 * TEXT_PAD, 0) + GAP

  let chosen: { lines: [Line[], Line[]]; textSize: number; artH: number; stripped: boolean; overflow: boolean } | undefined
  for (const cand of splitCandidates(s.textSize, s.stripReminder)) {
    const lines = frames.map((f) => wrap(ctx, cand.stripped ? stripReminder(f.face.oracleText) : f.face.oracleText, cand.textSize, family, innerW)) as [Line[], Line[]]
    const artH = cand.artH ? cand.artH + GAP : 0
    const bottom = fixedH + artH + (lines[0].length + lines[1].length) * lineHeightFor(cand.textSize)
    if (bottom <= H - MARGIN) { chosen = { lines, ...cand, overflow: false }; break }
    chosen = { lines, ...cand, overflow: true }
  }
  const c = chosen!
  const lh = lineHeightFor(c.textSize)
  if (c.overflow) {
    // clip the second half first (down to one line), then the first
    const T = Math.floor((H - MARGIN - fixedH - (c.artH ? c.artH + GAP : 0)) / lh)
    const nB = Math.max(1, Math.min(c.lines[1].length, T - c.lines[0].length))
    const nA = Math.max(0, Math.min(c.lines[0].length, T - nB))
    c.lines = [c.lines[0].slice(0, nA), c.lines[1].slice(0, nB)]
  }

  const first = layoutHalf(frames[0], c.lines[0], MARGIN, lh)
  let y = first.textBox.y + first.textBox.h + GAP
  const art: Rect | undefined = c.artH ? { x: MARGIN, y, w: innerW, h: c.artH } : undefined
  if (art) y += art.h + GAP
  const second = layoutHalf(frames[1], c.lines[1], y, lh)

  return {
    kind: 'split',
    card: { w: W, h: H },
    nameBar: first.nameBar, nameFontSize: first.nameFontSize, costOnSecondLine: first.costOnSecondLine, costSymbolSize: COST_SYMBOL,
    art, typeBar: first.typeBar, typeFontSize: first.typeFontSize,
    textBox: first.textBox, textFontSize: c.textSize, lineHeight: lh, symbolSize: symbolSizeFor(c.textSize), textLines: first.lines,
    second,
    overflow: c.overflow, strippedReminder: c.stripped,
  }
}

/** Both halves wrap at the full text box width: split cards have no stat box. */
function wrap(ctx: Ctx2D, text: string, textSize: number, family: string, innerW: number): Line[] {
  const w = innerW - 2 * TEXT_PAD
  return wrapText(tokenize(text), { ctx, font: `${textSize}px ${family}`, symbolSize: symbolSizeFor(textSize), widthForLine: () => w })
}

/** Name bar at `top`, then the type bar and a text box sized to its lines. */
function layoutHalf(f: HalfFrame, lines: Line[], top: number, lh: number): HalfGeometry {
  const nameBar: Rect = { ...f.bar.nameBar, y: top }
  const typeBar: Rect = { x: nameBar.x, y: nameBar.y + nameBar.h + GAP, w: nameBar.w, h: TYPE_H }
  const textBox: Rect = { x: nameBar.x, y: typeBar.y + typeBar.h + GAP, w: nameBar.w, h: lines.length * lh + 2 * TEXT_PAD }
  return { nameBar, nameFontSize: f.bar.nameFontSize, costOnSecondLine: f.bar.costOnSecondLine, typeBar, typeFontSize: f.typeFontSize, textBox, lines }
}

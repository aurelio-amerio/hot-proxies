import type { Face, Sheet } from '../card/types'
import type { Settings } from '../settings'
import type { RenderEnv } from '../env'
import { cardHeight } from '../printer'
import type { Line } from '../text/wrap'
import { stripReminder } from './reminder'
import { fitCandidates } from './candidates'
import { fitNameBar, fitTypeFont, statWidth, lineHeightFor, symbolSizeFor } from './bars'
import { fitColumns } from './fitColumns'
import { fitStacked } from './fitStacked'
import { fitSplit } from './fitSplit'
import { faceBoxes, wrapBoxText, type FaceBoxes } from './face'
import { MARGIN, GAP, COST_SYMBOL } from './constants'

export interface Rect { x: number; y: number; w: number; h: number }
export interface SectionGeometry { rule?: number; header?: { label: string; y: number; costCodes: string[]; statLabel?: string }; badges: { code: string; rect: Rect }[]; textX: number; textTop: number; lines: Line[] }
export interface SubGeometry { box: Rect; nameY: number; typeY?: number; typeFontSize: number; textTop: number; lines: Line[]; statBox?: Rect; headerStat?: string }
export interface HalfGeometry { nameBar: Rect; nameFontSize: number; costOnSecondLine: boolean; typeBar: Rect; typeFontSize: number; textBox: Rect; lines: Line[] }

export interface Geometry {
  kind: 'standard' | 'columns' | 'stacked' | 'split'
  card: { w: number; h: number }
  nameBar: Rect; nameFontSize: number; costOnSecondLine: boolean; costSymbolSize: number
  art?: Rect                                         // absent when the art was dropped
  typeBar: Rect; typeFontSize: number
  textBox: Rect; textFontSize: number; lineHeight: number; symbolSize: number; textLines: Line[]
  statBox?: Rect
  sections?: SectionGeometry[]                       // columns
  sub?: SubGeometry                                  // stacked
  second?: HalfGeometry                              // split
  overflow: boolean; strippedReminder: boolean
}

export function fit(sheet: Sheet, s: Settings, env: RenderEnv): Geometry {
  if (sheet.kind === 'columns') return fitColumns(sheet, s, env)
  if (sheet.kind === 'stacked') return fitStacked(sheet, s, env)
  if (sheet.kind === 'split') return fitSplit(sheet, s, env)
  return fitStandard(sheet.face, s, env)
}

function fitStandard(face: Face, s: Settings, env: RenderEnv): Geometry {
  const W = s.dotsPerLine, H = cardHeight(W)
  const ctx = env.createCanvas(8, 8).getContext('2d')
  const family = s.fontFamily
  const innerW = W - 2 * MARGIN

  const { nameBar, nameFontSize, costOnSecondLine } = fitNameBar(ctx, face, s.nameSize, family, MARGIN, MARGIN, innerW)
  const statW = face.stat ? statWidth(ctx, face.stat, family) : 0
  // --- type line: shrink until it fits inside the bar's 8-dot side padding ---
  const typeFontSize = fitTypeFont(ctx, face.typeLine, family, innerW)
  const fixedTop = nameBar.y + nameBar.h + GAP

  // --- art + text share the rest ---
  let chosen: { boxes: FaceBoxes; lines: Line[]; textSize: number; artH: number; stripped: boolean; overflow: boolean } | undefined
  for (const cand of fitCandidates(s.textSize, s.stripReminder)) {
    const text = cand.stripped ? stripReminder(face.oracleText) : face.oracleText
    const boxes = faceBoxes(MARGIN, fixedTop, innerW, cand.artH, H - MARGIN, statW)
    const { lines, linesAvail } = wrapBoxText(ctx, text, cand.textSize, family, boxes.textBox, statW)
    if (lines.length <= linesAvail) { chosen = { boxes, lines, ...cand, overflow: false }; break }
    chosen = { boxes, lines: lines.slice(0, Math.max(1, linesAvail)), ...cand, overflow: true }
  }
  const c = chosen!
  const { art, typeBar, textBox, statBox } = c.boxes

  return {
    kind: 'standard',
    card: { w: W, h: H },
    nameBar, nameFontSize, costOnSecondLine, costSymbolSize: COST_SYMBOL,
    art, typeBar, typeFontSize,
    textBox, textFontSize: c.textSize, lineHeight: lineHeightFor(c.textSize), symbolSize: symbolSizeFor(c.textSize), textLines: c.lines,
    statBox,
    overflow: c.overflow, strippedReminder: c.stripped,
  }
}

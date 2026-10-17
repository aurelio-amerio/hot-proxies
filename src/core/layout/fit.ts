import type { Face, Sheet } from '../card/types'
import type { Settings } from '../settings'
import type { RenderEnv } from '../env'
import { cardHeight } from '../printer'
import { tokenize } from '../text/tokenize'
import { wrapText, type Line } from '../text/wrap'
import { stripReminder } from './reminder'
import { fitCandidates } from './candidates'
import { fitNameBar, fitTypeFont, statWidth } from './bars'
import { MARGIN, GAP, TYPE_H, TEXT_PAD, STAT_H, COST_SYMBOL, LINE_HEIGHT_RATIO } from './constants'

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

export const lineHeightFor = (fontSize: number) => Math.round(fontSize * LINE_HEIGHT_RATIO)
export const symbolSizeFor = (fontSize: number) => Math.round(fontSize * 0.95)

export function fit(sheet: Sheet, s: Settings, env: RenderEnv): Geometry {
  if (sheet.kind !== 'standard') throw new Error('not implemented')
  return fitStandard(sheet.face, s, env)
}

function fitStandard(card: Face, s: Settings, env: RenderEnv): Geometry {
  const W = s.dotsPerLine, H = cardHeight(W)
  const ctx = env.createCanvas(8, 8).getContext('2d')
  const family = s.fontFamily
  const innerW = W - 2 * MARGIN

  const { nameBar, nameFontSize, costOnSecondLine } = fitNameBar(ctx, card, s.nameSize, family, MARGIN, MARGIN, innerW)

  // --- stat box width ---
  let statBox: Rect | undefined
  const statW = card.stat ? statWidth(ctx, card.stat, family) : 0

  // --- art + text share the rest ---
  const typeBarH = TYPE_H
  // --- type line: shrink until it fits inside the bar's 8-dot side padding ---
  const typeFontSize = fitTypeFont(ctx, card.typeLine, family, innerW)
  const fixedTop = nameBar.y + nameBar.h + GAP
  const available = H - MARGIN - fixedTop - GAP - typeBarH - GAP   // art + text box
  const textInnerW = innerW - 2 * TEXT_PAD

  let chosen: { lines: Line[]; textSize: number; artH: number; stripped: boolean; overflow: boolean } | undefined
  for (const cand of fitCandidates(s.textSize, s.stripReminder)) {
    const text = cand.stripped ? stripReminder(card.oracleText) : card.oracleText
    const lh = lineHeightFor(cand.textSize)
    const boxH = available - cand.artH - GAP
    const linesAvail = Math.floor((boxH - 2 * TEXT_PAD) / lh)
    // lines whose bottom would overlap the stat box get narrowed
    const widthForLine = (i: number) => {
      if (!card.stat) return textInnerW
      const bottom = TEXT_PAD + (i + 1) * lh
      return bottom > boxH - STAT_H - 2 ? textInnerW - statW - 4 : textInnerW
    }
    const lines = wrapText(tokenize(text), { ctx, font: `${cand.textSize}px ${family}`, symbolSize: symbolSizeFor(cand.textSize), widthForLine })
    if (lines.length <= linesAvail) { chosen = { lines, ...cand, overflow: false }; break }
    chosen = { lines: lines.slice(0, Math.max(1, linesAvail)), ...cand, overflow: true }
  }
  const c = chosen!
  const artH = c.artH
  const art: Rect = { x: MARGIN, y: fixedTop, w: innerW, h: artH }
  const typeBar: Rect = { x: MARGIN, y: art.y + art.h + GAP, w: innerW, h: typeBarH }
  const textBox: Rect = { x: MARGIN, y: typeBar.y + typeBar.h + GAP, w: innerW, h: H - MARGIN - (typeBar.y + typeBar.h + GAP) }
  if (card.stat) statBox = { x: textBox.x + textBox.w - statW, y: textBox.y + textBox.h - STAT_H, w: statW, h: STAT_H }

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

import type { CardData } from '../card/types'
import type { Settings } from '../settings'
import type { RenderEnv } from '../env'
import { cardHeight } from '../printer'
import { tokenize } from '../text/tokenize'
import { wrapText, type Line } from '../text/wrap'
import { stripReminder } from './reminder'
import { fitCandidates } from './candidates'
import { MARGIN, GAP, NAME_H, TYPE_H, TEXT_PAD, STAT_H, STAT_PAD, COST_SYMBOL, NAME_MIN, TYPE_SIZE, TYPE_MIN, LINE_HEIGHT_RATIO } from './constants'

export interface Rect { x: number; y: number; w: number; h: number }
export interface Geometry {
  card: { w: number; h: number }
  nameBar: Rect; nameFontSize: number; costOnSecondLine: boolean; costSymbolSize: number
  art: Rect; typeBar: Rect; typeFontSize: number
  textBox: Rect; textFontSize: number; lineHeight: number; symbolSize: number; textLines: Line[]
  statBox?: Rect
  overflow: boolean; strippedReminder: boolean
}

const symbolCount = (cost: string) => (cost.match(/\{[^}]+\}/g) ?? []).length
export const lineHeightFor = (fontSize: number) => Math.round(fontSize * LINE_HEIGHT_RATIO)
export const symbolSizeFor = (fontSize: number) => Math.round(fontSize * 0.95)

export function fit(card: CardData, s: Settings, env: RenderEnv): Geometry {
  const W = s.dotsPerLine, H = cardHeight(W)
  const ctx = env.createCanvas(8, 8).getContext('2d')
  const family = s.fontFamily
  const innerW = W - 2 * MARGIN

  // --- name bar ---
  const costW = symbolCount(card.manaCost) * (COST_SYMBOL + 3)
  const barInner = innerW - 16
  let costOnSecondLine = costW > barInner / 2
  let nameFontSize = s.nameSize
  const nameRoom = costOnSecondLine ? barInner : barInner - costW - 6
  for (; nameFontSize > NAME_MIN; nameFontSize--) {
    ctx.font = `bold ${nameFontSize}px ${family}`
    if (ctx.measureText(card.name).width <= nameRoom) break
  }
  const nameBar: Rect = { x: MARGIN, y: MARGIN, w: innerW, h: costOnSecondLine ? NAME_H + COST_SYMBOL + 4 : NAME_H }

  // --- stat box width ---
  let statBox: Rect | undefined
  let statW = 0
  if (card.stat) {
    ctx.font = `bold 24px ${family}`
    const label = card.stat.kind === 'pt' ? `${card.stat.power}/${card.stat.toughness}` : card.stat.value
    statW = Math.ceil(ctx.measureText(label).width) + 2 * STAT_PAD
  }

  // --- art + text share the rest ---
  const typeBarH = TYPE_H
  // --- type line: shrink until it fits inside the bar's 8-dot side padding ---
  let typeFontSize = TYPE_SIZE
  for (; typeFontSize > TYPE_MIN; typeFontSize--) {
    ctx.font = `bold ${typeFontSize}px ${family}`
    if (ctx.measureText(card.typeLine).width <= innerW - 16) break
  }
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
    card: { w: W, h: H },
    nameBar, nameFontSize, costOnSecondLine, costSymbolSize: COST_SYMBOL,
    art, typeBar, typeFontSize,
    textBox, textFontSize: c.textSize, lineHeight: lineHeightFor(c.textSize), symbolSize: symbolSizeFor(c.textSize), textLines: c.lines,
    statBox,
    overflow: c.overflow, strippedReminder: c.stripped,
  }
}

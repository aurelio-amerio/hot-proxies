import type { Section, Sheet } from '../card/types'
import { statLabel } from '../card/types'
import type { Settings } from '../settings'
import type { RenderEnv, Ctx2D } from '../env'
import { cardHeight } from '../printer'
import { tokenize } from '../text/tokenize'
import { wrapText } from '../text/wrap'
import { stripReminder } from './reminder'
import { columnCandidates } from './candidates'
import { fitNameBar, fitTypeFont, statWidth, lineHeightFor, symbolSizeFor } from './bars'
import type { Geometry, Rect, SectionGeometry } from './fit'
import { MARGIN, GAP, TYPE_H, TEXT_PAD, STAT_H, COST_SYMBOL, BADGE, BADGE_GUTTER, SECTION_GAP } from './constants'

type ColumnsSheet = Extract<Sheet, { kind: 'columns' }>

const BADGE_STEP = BADGE + 2   // badge plus the 2-dot gap below it
/** Offset that centres the first badge on the section's first text line. */
const badgeTop = (lh: number) => Math.max(0, Math.round((lh - BADGE) / 2))
const costCodes = (cost = '') => (cost.match(/\{([^}]+)\}/g) ?? []).map((m) => m.slice(1, -1))

interface Stack { sections: SectionGeometry[]; bottoms: number[] }

/** Columns sheet (saga, class, case, leveler): text sections left, art column right, type bar at the bottom. Spec 5.1. */
export function fitColumns(sheet: ColumnsSheet, s: Settings, env: RenderEnv): Geometry {
  const face = sheet.face
  const W = s.dotsPerLine, H = cardHeight(W)
  const ctx = env.createCanvas(8, 8).getContext('2d')
  const family = s.fontFamily
  const innerW = W - 2 * MARGIN

  const { nameBar, nameFontSize, costOnSecondLine } = fitNameBar(ctx, face, s.nameSize, family, MARGIN, MARGIN, innerW)
  const typeFontSize = fitTypeFont(ctx, face.typeLine, family, innerW)
  const typeBar: Rect = { x: MARGIN, y: H - MARGIN - TYPE_H, w: innerW, h: TYPE_H }
  const colTop = nameBar.y + nameBar.h + GAP
  const colH = typeBar.y - GAP - colTop
  const statW = face.stat ? statWidth(ctx, face.stat, family) : 0

  let chosen: { stack: Stack; textBox: Rect; textSize: number; colW: number; stripped: boolean; overflow: boolean } | undefined
  for (const cand of columnCandidates(s.textSize, s.stripReminder)) {
    const textBox: Rect = { x: MARGIN, y: colTop, w: innerW - (cand.colW ? cand.colW + GAP : 0), h: colH }
    const stack = layoutSections(ctx, sheet.sections, textBox, cand.textSize, cand.stripped, family, statW)
    const limit = textBox.y + textBox.h - TEXT_PAD
    if (stackBottom(stack) <= limit) { chosen = { stack, textBox, ...cand, overflow: false }; break }
    chosen = { stack, textBox, ...cand, overflow: true }
  }
  const c = chosen!
  if (c.overflow) c.stack = clip(c.stack, c.textBox.y + c.textBox.h - TEXT_PAD, lineHeightFor(c.textSize))
  const { textBox } = c
  const art: Rect | undefined = c.colW ? { x: textBox.x + textBox.w + GAP, y: colTop, w: c.colW, h: colH } : undefined
  const statBox: Rect | undefined = face.stat ? { x: textBox.x + textBox.w - statW, y: textBox.y + textBox.h - STAT_H, w: statW, h: STAT_H } : undefined

  return {
    kind: 'columns',
    card: { w: W, h: H },
    nameBar, nameFontSize, costOnSecondLine, costSymbolSize: COST_SYMBOL,
    art, typeBar, typeFontSize,
    textBox, textFontSize: c.textSize, lineHeight: lineHeightFor(c.textSize), symbolSize: symbolSizeFor(c.textSize), textLines: [],
    statBox,
    sections: c.stack.sections,
    overflow: c.overflow, strippedReminder: c.stripped,
  }
}

/** Stack the sections top to bottom inside the text column; lines that would run into the stat box are narrowed. */
function layoutSections(ctx: Ctx2D, sections: Section[], textBox: Rect, textSize: number, stripped: boolean, family: string, statW: number): Stack {
  const lh = lineHeightFor(textSize)
  const statTop = textBox.y + textBox.h - STAT_H - 2
  const out: Stack = { sections: [], bottoms: [] }
  let y = textBox.y + TEXT_PAD
  for (const sec of sections) {
    const text = stripped ? stripReminder(sec.text) : sec.text
    const codes = sec.badges ?? []
    if (!text && !sec.header && !codes.length) continue
    const g: SectionGeometry = { badges: [], textX: 0, textTop: 0, lines: [] }
    if (out.sections.length > 0) {
      y += SECTION_GAP
      if (sec.header) g.rule = y - 3
    }
    if (sec.header) {
      g.header = { label: sec.header.label, y, costCodes: costCodes(sec.header.cost) }
      if (sec.header.stat) g.header.statLabel = statLabel(sec.header.stat)
      y += lh
    }
    const gutter = codes.length ? BADGE_GUTTER : 0
    g.badges = codes.map((code, k) => ({ code, rect: { x: textBox.x + TEXT_PAD, y: y + badgeTop(lh) + k * BADGE_STEP, w: BADGE, h: BADGE } }))
    g.textX = textBox.x + TEXT_PAD + gutter
    g.textTop = y
    const wrapW = textBox.w - 2 * TEXT_PAD - gutter
    const top = y
    const widthForLine = (i: number) => statW && top + (i + 1) * lh > statTop ? wrapW - statW - 4 : wrapW
    g.lines = text ? wrapText(tokenize(text), { ctx, font: `${textSize}px ${family}`, symbolSize: symbolSizeFor(textSize), widthForLine }) : []
    y += sectionBody(g, lh)
    out.sections.push(g); out.bottoms.push(y)
  }
  return out
}

/** Height of a section below its header row: its lines, or its badges if they are taller. */
const sectionBody = (g: SectionGeometry, lh: number) => Math.max(g.lines.length * lh, g.badges.length ? badgeTop(lh) + g.badges.length * BADGE_STEP : 0)
const stackBottom = (st: Stack) => st.bottoms.length ? st.bottoms[st.bottoms.length - 1] : 0

/** Overflow: drop lines from the last section, then the section itself once it would be left without text. */
function clip(st: Stack, limit: number, lh: number): Stack {
  const sections = [...st.sections], bottoms = [...st.bottoms]
  while (sections.length && bottoms[bottoms.length - 1] > limit) {
    const n = sections.length - 1, last = sections[n]
    if (last.lines.length <= 1) { sections.pop(); bottoms.pop(); continue }
    const bodyTop = bottoms[n] - sectionBody(last, lh)
    sections[n] = { ...last, lines: last.lines.slice(0, -1) }
    bottoms[n] = bodyTop + sectionBody(sections[n], lh)
  }
  return { sections, bottoms }
}

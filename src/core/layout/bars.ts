import type { Face, Stat } from '../card/types'
import { statLabel } from '../card/types'
import type { Ctx2D } from '../env'
import type { Rect } from './fit'
import { NAME_H, COST_SYMBOL, NAME_MIN, TYPE_SIZE, TYPE_MIN, STAT_PAD, LINE_HEIGHT_RATIO } from './constants'

export const lineHeightFor = (fontSize: number) => Math.round(fontSize * LINE_HEIGHT_RATIO)
export const symbolSizeFor = (fontSize: number) => Math.round(fontSize * 0.95)

export interface NameBarFit { nameBar: Rect; nameFontSize: number; costOnSecondLine: boolean }

/** The symbol codes of a mana cost, "{2}{U}" -> ["2", "U"]. */
export const costCodes = (cost = '') => (cost.match(/\{([^}]+)\}/g) ?? []).map((m) => m.slice(1, -1))

/** Name bar at (x, y) with width w: shrink the name to fit beside the cost, or move the cost under it. */
export function fitNameBar(ctx: Ctx2D, face: Pick<Face, 'name' | 'manaCost'>, baseSize: number, family: string, x: number, y: number, w: number): NameBarFit {
  const costW = costCodes(face.manaCost).length * (COST_SYMBOL + 3)
  const barInner = w - 16
  const costOnSecondLine = costW > barInner / 2
  let nameFontSize = baseSize
  const nameRoom = costOnSecondLine ? barInner : barInner - costW - 6
  for (; nameFontSize > NAME_MIN; nameFontSize--) {
    ctx.font = `bold ${nameFontSize}px ${family}`
    if (ctx.measureText(face.name).width <= nameRoom) break
  }
  const nameBar: Rect = { x, y, w, h: costOnSecondLine ? NAME_H + COST_SYMBOL + 4 : NAME_H }
  return { nameBar, nameFontSize, costOnSecondLine }
}

/** Type line font: shrink until it fits inside the bar's 8-dot side padding. */
export function fitTypeFont(ctx: Ctx2D, typeLine: string, family: string, w: number): number {
  let typeFontSize = TYPE_SIZE
  for (; typeFontSize > TYPE_MIN; typeFontSize--) {
    ctx.font = `bold ${typeFontSize}px ${family}`
    if (ctx.measureText(typeLine).width <= w - 16) break
  }
  return typeFontSize
}

export function statWidth(ctx: Ctx2D, stat: Stat, family: string): number {
  ctx.font = `bold 24px ${family}`
  return Math.ceil(ctx.measureText(statLabel(stat)).width) + 2 * STAT_PAD
}

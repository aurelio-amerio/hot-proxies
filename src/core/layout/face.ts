import type { Ctx2D } from '../env'
import type { Rect } from './fit'
import { tokenize } from '../text/tokenize'
import { wrapText, type Line } from '../text/wrap'
import { lineHeightFor, symbolSizeFor } from './bars'
import { GAP, TYPE_H, TEXT_PAD, STAT_H } from './constants'

export interface FaceBoxes { art?: Rect; typeBar: Rect; textBox: Rect; statBox?: Rect }

/** The boxes under a face's name bar: art (absent when artH is 0), type bar, and a text box from there down to `bottom`. */
export function faceBoxes(x: number, top: number, w: number, artH: number, bottom: number, statW: number): FaceBoxes {
  const art: Rect | undefined = artH ? { x, y: top, w, h: artH } : undefined
  const typeBar: Rect = { x, y: art ? art.y + art.h + GAP : top, w, h: TYPE_H }
  const textY = typeBar.y + typeBar.h + GAP
  const textBox: Rect = { x, y: textY, w, h: bottom - textY }
  const statBox: Rect | undefined = statW ? { x: x + w - statW, y: textBox.y + textBox.h - STAT_H, w: statW, h: STAT_H } : undefined
  return { art, typeBar, textBox, statBox }
}

/**
 * Wrap a face's text for its text box and count how many lines the box holds; lines whose bottom would overlap
 * the stat box get narrowed. The text is laid out one GAP shy of the box bottom, as it always has been.
 */
export function wrapBoxText(ctx: Ctx2D, text: string, textSize: number, family: string, textBox: Rect, statW: number): { lines: Line[]; linesAvail: number } {
  const lh = lineHeightFor(textSize)
  const boxH = textBox.h - GAP
  const textInnerW = textBox.w - 2 * TEXT_PAD
  const widthForLine = (i: number) => {
    if (!statW) return textInnerW
    const bottom = TEXT_PAD + (i + 1) * lh
    return bottom > boxH - STAT_H - 2 ? textInnerW - statW - 4 : textInnerW
  }
  const lines = wrapText(tokenize(text), { ctx, font: `${textSize}px ${family}`, symbolSize: symbolSizeFor(textSize), widthForLine })
  return { lines, linesAvail: Math.floor((boxH - 2 * TEXT_PAD) / lh) }
}

import type { Ctx2D } from '../env'
import { isAbilityPrefix, type Token } from './tokenize'

export type LineItem =
  | { kind: 'text'; text: string; x: number; width: number }
  | { kind: 'symbol'; code: string; x: number; width: number }
export interface Line { items: LineItem[]; width: number }

export interface WrapOptions {
  ctx: Ctx2D
  font: string
  symbolSize: number
  widthForLine: (lineIndex: number) => number
}

export function wrapText(tokens: Token[], opts: WrapOptions): Line[] {
  const { ctx, symbolSize } = opts
  ctx.font = opts.font
  const space = ctx.measureText(' ').width
  const measure = (t: string) => ctx.measureText(t).width

  const lines: Line[] = []
  let items: LineItem[] = []
  let x = 0
  let indent = 0
  let paragraphStart = true

  const flush = () => {
    const width = items.length ? items[items.length - 1].x + items[items.length - 1].width : 0
    lines.push({ items, width })
    items = []; x = indent
  }

  for (const tok of tokens) {
    if (tok.kind === 'break') { flush(); indent = 0; x = 0; paragraphStart = true; continue }
    const maxW = opts.widthForLine(lines.length)
    const width = tok.kind === 'symbol' ? symbolSize + 2 : measure(tok.text)
    const gap = items.length === 0 || tok.glue ? 0 : space
    if (items.length > 0 && x + gap + width > maxW) { flush() }
    const startX = items.length === 0 ? x : x + gap

    if (tok.kind === 'word' && startX + width > maxW && width > maxW - indent) {
      // Overlong word: emit character runs that fit.
      let rest = tok.text, cx = startX
      while (rest.length) {
        let n = rest.length
        while (n > 1 && cx + measure(rest.slice(0, n)) > opts.widthForLine(lines.length)) n--
        const piece = rest.slice(0, n), pw = measure(piece)
        items.push({ kind: 'text', text: piece, x: cx, width: pw })
        rest = rest.slice(n)
        if (rest.length) { flush(); cx = x }
        else x = cx + pw
      }
    } else if (tok.kind === 'word') {
      items.push({ kind: 'text', text: tok.text, x: startX, width })
      x = startX + width
    } else {
      items.push({ kind: 'symbol', code: tok.code, x: startX, width })
      x = startX + width
    }

    if (paragraphStart) {
      paragraphStart = false
      if (tok.kind === 'word' && isAbilityPrefix(tok.text)) indent = width + space
    }
  }
  if (items.length) flush()
  return lines
}

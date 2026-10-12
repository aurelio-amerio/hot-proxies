import { describe, it, expect } from 'vitest'
import { nodeEnv, FONT_FAMILY } from '../../../tests/nodeEnv'
import { tokenize } from './tokenize'
import { wrapText, type WrapOptions } from './wrap'

const ctx = nodeEnv.createCanvas(10, 10).getContext('2d')
const opts = (width: number, extra: Partial<WrapOptions> = {}): WrapOptions => ({
  ctx, font: `17px ${FONT_FAMILY}`, symbolSize: 16, widthForLine: () => width, ...extra,
})
const text = (l: { items: { kind: string; text?: string; code?: string }[] }) =>
  l.items.map((i) => (i.kind === 'text' ? i.text : `{${i.code}}`)).join(' ')

describe('wrapText', () => {
  it('keeps short text on one line', () => {
    const lines = wrapText(tokenize('Flying, trample'), opts(300))
    expect(lines).toHaveLength(1)
    expect(text(lines[0])).toBe('Flying, trample')
    expect(lines[0].width).toBeGreaterThan(0)
  })
  it('wraps at the given width and never exceeds it', () => {
    const lines = wrapText(tokenize('Whenever a creature you control becomes the target of a spell, target opponent gets a poison counter.'), opts(200))
    expect(lines.length).toBeGreaterThan(2)
    for (const l of lines) expect(l.width).toBeLessThanOrEqual(200)
  })
  it('starts a new line at a paragraph break', () => {
    const lines = wrapText(tokenize('Toxic 1\nFlying'), opts(300))
    expect(lines.map(text)).toEqual(['Toxic 1', 'Flying'])
  })
  it('places symbols inline with glue and advances x', () => {
    const [l] = wrapText(tokenize('{T}: Add {G}.'), opts(300))
    expect(l.items.map((i) => i.kind)).toEqual(['symbol', 'text', 'text', 'symbol', 'text'])
    expect(l.items[0].width).toBe(18)           // symbolSize + 2 dots spacing (spec 5.2)
    expect(l.items[1].x).toBe(l.items[0].x + 18)          // glued, no space
    expect(l.items[2].x).toBeGreaterThan(l.items[1].x + l.items[1].width)  // spaced
  })
  it('hangs continuation lines of a planeswalker ability', () => {
    const lines = wrapText(tokenize('−9: Nicol Bolas deals 7 damage to target player or planeswalker. That player discards seven cards.'), opts(220))
    expect(lines.length).toBeGreaterThan(1)
    expect(lines[0].items[0].x).toBe(0)
    expect(lines[1].items[0].x).toBeGreaterThan(10)
    expect(lines[1].items[0].x).toBe(lines[2]?.items[0].x ?? lines[1].items[0].x)
  })
  it('breaks an overlong word by characters', () => {
    const lines = wrapText(tokenize('Asmoranomardicadaistinaculdacar'), opts(120))
    expect(lines.length).toBeGreaterThan(1)
    for (const l of lines) expect(l.width).toBeLessThanOrEqual(120)
    expect(lines.map(text).join('')).toBe('Asmoranomardicadaistinaculdacar')
  })
  it('narrows specific lines through widthForLine', () => {
    const t = tokenize('one two three four five six seven eight nine ten eleven twelve')
    const wide = wrapText(t, opts(250))
    const narrowed = wrapText(t, opts(250, { widthForLine: (i) => (i >= 1 ? 120 : 250) }))
    expect(narrowed.length).toBeGreaterThan(wide.length)
    for (const l of narrowed.slice(1)) expect(l.width).toBeLessThanOrEqual(120)
  })
  it('returns no lines for no tokens', () => { expect(wrapText([], opts(100))).toEqual([]) })
})

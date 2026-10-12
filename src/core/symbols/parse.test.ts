import { describe, it, expect } from 'vitest'
import { parseSymbol } from './parse'

describe('parseSymbol', () => {
  it('maps colors, colorless and generic numbers to glyphs', () => {
    expect(parseSymbol('G')).toEqual({ kind: 'glyph', glyph: 'g' })
    expect(parseSymbol('C')).toEqual({ kind: 'glyph', glyph: 'c' })
    expect(parseSymbol('12')).toEqual({ kind: 'glyph', glyph: '12' })
    expect(parseSymbol('X')).toEqual({ kind: 'glyph', glyph: 'x' })
  })
  it('maps tap and untap', () => {
    expect(parseSymbol('T')).toEqual({ kind: 'glyph', glyph: 'tap' })
    expect(parseSymbol('Q')).toEqual({ kind: 'glyph', glyph: 'untap' })
  })
  it('maps hybrid and phyrexian', () => {
    expect(parseSymbol('W/U')).toEqual({ kind: 'hybrid', a: 'w', b: 'u' })
    expect(parseSymbol('2/G')).toEqual({ kind: 'hybrid', a: '2', b: 'g' })
    expect(parseSymbol('G/P')).toEqual({ kind: 'phyrexian', color: 'g' })
    expect(parseSymbol('G/U/P')).toEqual({ kind: 'phyrexian', color: 'g' })
  })
  it('falls back to literal text for unknown codes', () => {
    expect(parseSymbol('1000000')).toEqual({ kind: 'text', text: '1000000' })
    expect(parseSymbol('WOW')).toEqual({ kind: 'text', text: 'WOW' })
  })
  it('is case-insensitive', () => { expect(parseSymbol('t')).toEqual({ kind: 'glyph', glyph: 'tap' }) })
})

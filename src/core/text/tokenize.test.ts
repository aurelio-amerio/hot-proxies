import { describe, it, expect } from 'vitest'
import { tokenize, isAbilityPrefix } from './tokenize'

describe('tokenize', () => {
  it('splits words and paragraph breaks', () => {
    expect(tokenize('Flying\nTrample')).toEqual([
      { kind: 'word', text: 'Flying', glue: false }, { kind: 'break' }, { kind: 'word', text: 'Trample', glue: false },
    ])
  })
  it('extracts symbols and glues punctuation to them', () => {
    expect(tokenize('{T}: Add {G}.')).toEqual([
      { kind: 'symbol', code: 'T', glue: false }, { kind: 'word', text: ':', glue: true },
      { kind: 'word', text: 'Add', glue: false },
      { kind: 'symbol', code: 'G', glue: false }, { kind: 'word', text: '.', glue: true },
    ])
  })
  it('glues consecutive symbols', () => {
    expect(tokenize('{1}{G}')).toEqual([
      { kind: 'symbol', code: '1', glue: false }, { kind: 'symbol', code: 'G', glue: true },
    ])
  })
  it('collapses runs of spaces and ignores leading/trailing whitespace', () => {
    expect(tokenize('  a   b  ')).toEqual([{ kind: 'word', text: 'a', glue: false }, { kind: 'word', text: 'b', glue: false }])
  })
  it('returns nothing for empty text', () => { expect(tokenize('')).toEqual([]) })
})

describe('isAbilityPrefix', () => {
  it('recognises planeswalker loyalty prefixes', () => {
    expect(isAbilityPrefix('+3:')).toBe(true)
    expect(isAbilityPrefix('−2:')).toBe(true)   // U+2212 minus, as Scryfall writes it
    expect(isAbilityPrefix('-2:')).toBe(true)
    expect(isAbilityPrefix('0:')).toBe(true)
    expect(isAbilityPrefix('Toxic')).toBe(false)
    expect(isAbilityPrefix('3')).toBe(false)
  })
})

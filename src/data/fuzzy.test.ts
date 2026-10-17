import { describe, it, expect } from 'vitest'
import { createMatcher } from './fuzzy'

const names = ['Lightning Bolt', 'Lightning Helix', 'Chain Lightning', 'Bolt Bend', "Lim-Dûl's Vault", 'Æther Vial', 'Forest', 'Venerated Rotpriest', 'Nicol Bolas, Planeswalker']
const m = createMatcher(names)

describe('createMatcher', () => {
  it('ranks prefix matches first, then word prefixes, then substrings', () => {
    expect(m.search('light').slice(0, 3)).toEqual(['Lightning Bolt', 'Lightning Helix', 'Chain Lightning'])
    expect(m.search('bolt')[0]).toBe('Bolt Bend')
    expect(m.search('bolt')).toContain('Lightning Bolt')
  })
  it('is case-insensitive', () => { expect(m.search('LIGHTNING BOLT')[0]).toBe('Lightning Bolt') })
  it('matches ignoring diacritics', () => {
    expect(m.search('lim-dul')[0]).toBe("Lim-Dûl's Vault")
    expect(m.search('aether')[0]).toBe('Æther Vial')
  })
  it('tolerates a typo through bigram similarity', () => { expect(m.search('lightnig bolt')[0]).toBe('Lightning Bolt') })
  it('respects the limit and returns nothing for empty queries', () => {
    expect(m.search('l', 2)).toHaveLength(2)
    expect(m.search('')).toEqual([]); expect(m.search('   ')).toEqual([])
  })
})

describe('half-name matching', () => {
  const m = createMatcher(['Fire // Ice', 'Bonecrusher Giant // Stomp', 'Lightning Bolt'])
  it('finds a multi-face card by its second half', () => {
    expect(m.search('stomp')).toEqual(['Bonecrusher Giant // Stomp'])
  })
  it('ranks a half-name prefix above a shorter word-prefix match', () => {
    expect(createMatcher(['A Ice', 'Fire // Ice']).search('ice')).toEqual(['Fire // Ice', 'A Ice'])
  })
  it('tolerates a typo in a half name (stomx)', () => {
    expect(m.search('stomx')).toEqual(['Bonecrusher Giant // Stomp'])
  })
  it('returns a card once when several of its aliases match', () => {
    const r = createMatcher(['Fire // Fire Ice', 'Fire // Ice']).search('fire')
    expect(r).toEqual(['Fire // Ice', 'Fire // Fire Ice'])
    expect(createMatcher(['Ice // Ice']).search('ice')).toEqual(['Ice // Ice'])
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { normalizeScryfall } from './normalize'
import { UnsupportedLayout } from '../errors'

const load = (n: string) => JSON.parse(readFileSync(`tests/fixtures/cards/${n}.json`, 'utf8'))

describe('normalizeScryfall', () => {
  it('maps a creature', () => {
    const c = normalizeScryfall(load('rotpriest'))
    expect(c).toMatchObject({ name: 'Venerated Rotpriest', manaCost: '{G}', typeLine: 'Creature — Phyrexian Druid',
      stat: { kind: 'pt', power: '1', toughness: '2' } })
    expect(c.oracleText).toContain('Toxic 1')
    expect(c.artUrl).toMatch(/^https:\/\/cards\.scryfall\.io\/art_crop\//)
  })
  it('maps an instant with no stat', () => {
    const c = normalizeScryfall(load('bolt'))
    expect(c.typeLine).toBe('Instant'); expect(c.stat).toBeUndefined(); expect(c.manaCost).toBe('{R}')
  })
  it('maps a land with empty mana cost', () => {
    const c = normalizeScryfall(load('starting-town'))
    expect(c.manaCost).toBe(''); expect(c.typeLine).toBe('Land — Town')
  })
  it('maps a planeswalker to loyalty', () => {
    expect(normalizeScryfall(load('bolas')).stat).toEqual({ kind: 'loyalty', value: '5' })
  })
  it('maps a vehicle P/T even though it is not a creature', () => {
    expect(normalizeScryfall(load('copter')).stat).toEqual({ kind: 'pt', power: '3', toughness: '3' })
  })
  it('keeps star power and toughness verbatim', () => {
    expect(normalizeScryfall(load('tarmogoyf')).stat).toEqual({ kind: 'pt', power: '*', toughness: '1+*' })
  })
  it('throws UnsupportedLayout for transform cards', () => {
    expect(() => normalizeScryfall(load('delver'))).toThrow(UnsupportedLayout)
    expect(() => normalizeScryfall(load('delver'))).toThrow(/transform/)
  })
  it('throws UnsupportedLayout for junk input', () => {
    expect(() => normalizeScryfall({})).toThrow(UnsupportedLayout)
  })
})

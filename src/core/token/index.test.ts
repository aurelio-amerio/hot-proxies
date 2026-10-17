import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { artRef, tokenName, faceRecords, tokenIndexFromCards, variantLabel } from './index'

const raw = JSON.parse(readFileSync('tests/fixtures/tokens/raw.json', 'utf8')) as unknown[]
const ID = (n: string) => `aaaaaaaa00004000800000000000000${n}`

describe('artRef', () => {
  it('drops hyphens and marks the back face', () => {
    expect(artRef('aaaaaaaa-0000-4000-8000-000000000004', 0)).toBe(ID('4'))
    expect(artRef('aaaaaaaa-0000-4000-8000-000000000004', 1)).toBe(`${ID('4')}:1`)
  })
})

describe('tokenName', () => {
  it('turns "Emblem — X" into "X Emblem" and leaves other names alone', () => {
    expect(tokenName('Emblem — Ajani, Adversary of Tyrants')).toBe('Ajani, Adversary of Tyrants Emblem')
    expect(tokenName('Ajani Resolute Emblem')).toBe('Ajani Resolute Emblem')
    expect(tokenName('Goblin')).toBe('Goblin')
  })
})

describe('faceRecords', () => {
  it('splits a double-faced token into two records with front and back refs', () => {
    const recs = faceRecords(raw[3])
    expect(recs.map((r) => [r.name, r.ref])).toEqual([['Goblin', ID('4')], ['Soldier', `${ID('4')}:1`]])
    expect(recs[0]).toMatchObject({ typeLine: 'Token Creature — Goblin', oracleText: '', power: '1', toughness: '1', released: '2022-01-01' })
  })
  it('skips art series, memorabilia and blank helper cards', () => {
    expect(faceRecords(raw[6])).toEqual([])
    expect(faceRecords(raw[7])).toEqual([])
    expect(faceRecords({ id: 'x', layout: 'token', set_type: 'memorabilia', type_line: 'Card', oracle_text: 'text', name: 'Gift' })).toEqual([])
    expect(faceRecords(null)).toEqual([])
  })
})

describe('tokenIndexFromCards', () => {
  const index = tokenIndexFromCards(raw)
  it('has version 1 and sorted unique names', () => {
    expect(index.version).toBe(1)
    expect(index.tokens.map((t) => t.name)).toEqual(['Ajani, Adversary of Tyrants Emblem', 'Goblin', 'Soldier', 'The Monarch', 'Treasure'])
  })
  it('groups Goblin into two variants, most printed then newest first, prints newest first', () => {
    const goblin = index.tokens.find((t) => t.name === 'Goblin')!
    expect(goblin.variants).toEqual([
      { typeLine: 'Token Creature — Goblin', oracleText: 'Haste', power: '1', toughness: '1', prints: [ID('2'), ID('1')] },
      { typeLine: 'Token Creature — Goblin', oracleText: '', power: '1', toughness: '1', prints: [ID('4'), ID('3')] },
    ])
  })
  it('keeps the back-face ref for Soldier and omits power/toughness for noncreatures', () => {
    expect(index.tokens.find((t) => t.name === 'Soldier')!.variants[0].prints).toEqual([`${ID('4')}:1`])
    const treasure = index.tokens.find((t) => t.name === 'Treasure')!.variants[0]
    expect(treasure).not.toHaveProperty('power')
    expect(treasure.oracleText).toBe('{T}, Sacrifice this artifact: Add one mana of any color.')
  })
})

describe('variantLabel', () => {
  it('shows P/T and the first rules line, cut at 24 characters', () => {
    expect(variantLabel({ typeLine: 'Token Creature — Goblin', oracleText: 'Haste', power: '1', toughness: '1', prints: [] })).toBe('1/1 · Haste')
    expect(variantLabel({ typeLine: 'Token Creature — Goblin', oracleText: '', power: '1', toughness: '1', prints: [] })).toBe('1/1')
    expect(variantLabel({ typeLine: 'Token Artifact — Treasure', oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.', prints: [] })).toBe('{T}, Sacrifice this arti…')
    expect(variantLabel({ typeLine: 'Card', oracleText: '', prints: [] })).toBe('Card')
  })
})

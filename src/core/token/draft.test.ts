import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import type { TokenIndex } from './index'
import { draftFromVariant, blankDraft, editDraft, normalizeDraft, COPIES_MAX } from './draft'

const index = JSON.parse(readFileSync('tests/fixtures/tokens/index.json', 'utf8')) as TokenIndex
const entry = (n: string) => index.tokens.find((t) => t.name === n)!

describe('draftFromVariant', () => {
  it('fills the card from the variant, no mana cost, first printing as art', () => {
    const d = draftFromVariant(entry('Goblin'), 1)
    expect(d.base).toEqual({ name: 'Goblin', variant: 1 })
    expect(d.card).toEqual({ name: 'Goblin', manaCost: '', typeLine: 'Token Creature — Goblin', oracleText: '', stat: { kind: 'pt', power: '1', toughness: '1' } })
    expect(d.artRef).toBe('aaaaaaaa000040008000000000000004')
    expect(d.copies).toBe(1)
  })
  it('omits the stat for noncreatures and falls back to variant 0 when out of range', () => {
    const d = draftFromVariant(entry('Treasure'), 5)
    expect(d.base).toEqual({ name: 'Treasure', variant: 0 })
    expect(d.card.stat).toBeUndefined()
  })
})

describe('blankDraft', () => {
  it('is a nameless-but-valid token with nothing else', () => {
    expect(blankDraft()).toEqual({ base: null, card: { name: 'Token', manaCost: '', typeLine: '', oracleText: '' }, artRef: null, copies: 1 })
  })
})

describe('editDraft', () => {
  const d = draftFromVariant(entry('Goblin'), 0)
  it('edits each card field, trimming, and keeps base', () => {
    expect(editDraft(d, { name: '  Goblin Chief ' }).card.name).toBe('Goblin Chief')
    expect(editDraft(d, { name: '   ' }).card.name).toBe('Goblin')            // empty name is ignored
    expect(editDraft(d, { typeLine: ' Token Creature — Goblin Warrior ' }).card.typeLine).toBe('Token Creature — Goblin Warrior')
    expect(editDraft(d, { oracleText: 'Haste\r\nMenace\r\n\r\n' }).card.oracleText).toBe('Haste\nMenace')
    expect(editDraft(d, { typeLine: 'x' }).base).toEqual(d.base)
  })
  it('sets, replaces and removes the stat; blank P/T or loyalty means none', () => {
    expect(editDraft(d, { stat: { kind: 'pt', power: ' 2', toughness: '3 ' } }).card.stat).toEqual({ kind: 'pt', power: '2', toughness: '3' })
    expect(editDraft(d, { stat: { kind: 'loyalty', value: '4' } }).card.stat).toEqual({ kind: 'loyalty', value: '4' })
    expect(editDraft(d, { stat: { kind: 'none' } }).card.stat).toBeUndefined()
    expect(editDraft(d, { stat: { kind: 'pt', power: '', toughness: '' } }).card.stat).toBeUndefined()
    expect(editDraft(d, { stat: { kind: 'loyalty', value: ' ' } }).card.stat).toBeUndefined()
  })
  it('clamps and rounds copies, and never produces NaN', () => {
    expect(editDraft(d, { copies: 0 }).copies).toBe(1)
    expect(editDraft(d, { copies: 1000 }).copies).toBe(COPIES_MAX)
    expect(editDraft(d, { copies: 2.6 }).copies).toBe(3)
    expect(editDraft(d, { copies: Number('') }).copies).toBe(1)
    expect(editDraft(d, { copies: NaN }).copies).toBe(1)
  })
  it('sets and clears the art ref without touching the card', () => {
    const e = editDraft(d, { artRef: null })
    expect(e.artRef).toBeNull(); expect(e.card).toEqual(d.card)
    expect(editDraft(e, { artRef: 'abc' }).artRef).toBe('abc')
  })
  it('does not mutate the input', () => {
    const before = JSON.stringify(d)
    editDraft(d, { name: 'Other' }); editDraft(d, { stat: { kind: 'none' } }); editDraft(d, { copies: 9 })
    expect(JSON.stringify(d)).toBe(before)
  })
})

describe('normalizeDraft', () => {
  it('round-trips a valid draft', () => {
    const d = draftFromVariant(entry('Goblin'), 0)
    expect(normalizeDraft(JSON.parse(JSON.stringify(d)))).toEqual(d)
  })
  it('returns null for garbage and repairs partial objects', () => {
    expect(normalizeDraft(null)).toBeNull()
    expect(normalizeDraft('x')).toBeNull()
    expect(normalizeDraft({ card: { name: '' } })).toBeNull()
    expect(normalizeDraft({ card: { name: 'Elf', stat: { kind: 'pt', power: 1 } }, copies: 500, base: { name: 'Elf' } }))
      .toEqual({ base: null, card: { name: 'Elf', manaCost: '', typeLine: '', oracleText: '' }, artRef: null, copies: COPIES_MAX })
  })
})

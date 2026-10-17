import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { sagaSections, classSections, caseSections, levelerSections, prototypeFaces } from './sections'
import { stripReminder } from '../layout/reminder'

const text = (n: string): string => {
  const j = JSON.parse(readFileSync(`tests/fixtures/cards/${n}.json`, 'utf8'))
  return j.oracle_text ?? j.card_faces[0].oracle_text
}

describe('sections', () => {
  it('splits History of Benalia into reminder + I,II + III', () => {
    const s = sagaSections(text('benalia'))
    expect(s.map((x) => x.badges)).toEqual([undefined, ['I', 'II'], ['III']])
    expect(s[0].text).toMatch(/^\(As this Saga enters/)
    expect(s[2].text).toBe('Knights you control get +2/+1 until end of turn.')
  })
  it('keeps an em dash inside chapter text', () => {
    const s = sagaSections('I — Choose one —\n• A\n• B\nII — Done.')
    expect(s[0].text).toBe('Choose one —\n• A\n• B'); expect(s[1].badges).toEqual(['II'])
  })
  it('splits Ranger Class into level 1 (no header) and levels 2, 3 with costs', () => {
    const s = classSections(text('ranger-class'))
    expect(s.length).toBe(3); expect(s[0].header).toBeUndefined()
    expect(s[1].header).toEqual({ label: 'Level 2', cost: '{1}{G}' })
    expect(s[2].header).toEqual({ label: 'Level 3', cost: '{3}{G}' })
    expect(s[2].text.split('\n').length).toBe(2)
  })
  it('splits a Case into setup, To solve and Solved', () => {
    const s = caseSections(text('case-skeleton'))
    expect(s.map((x) => x.header?.label)).toEqual([undefined, 'To solve', 'Solved'])
    expect(s[1].text).toMatch(/^You control no suspected Skeletons/)
  })
  it('splits a leveler and lifts the level P/T into the header', () => {
    const s = levelerSections(text('transcendent-master'))
    expect(s[0].text).toMatch(/^Level up \{1\}/)
    expect(s[1].header).toEqual({ label: 'LEVEL 6-11', stat: { kind: 'pt', power: '6', toughness: '6' } })
    expect(s[1].text).toBe('Lifelink')
    expect(s[2].header!.label).toBe('LEVEL 12+'); expect(s[2].text).toBe('Lifelink, indestructible')
  })
  it('splits a prototype into main and sub faces', () => {
    const r = prototypeFaces({ name: 'Phyrexian Fleshgorger', manaCost: '{7}', typeLine: 'Artifact Creature — Phyrexian Wurm', oracleText: text('fleshgorger'), stat: { kind: 'pt', power: '7', toughness: '5' } })!
    expect(r.sub).toEqual({ name: 'Prototype', manaCost: '{1}{B}{B}', typeLine: '', oracleText: expect.stringMatching(/^\(You may cast this spell.*\)$/), stat: { kind: 'pt', power: '3', toughness: '3' } })
    expect(r.main.oracleText).toMatch(/^Menace, lifelink/)
    expect(prototypeFaces({ name: 'x', manaCost: '', typeLine: '', oracleText: 'Flying' })).toBeNull()
  })
  it('keeps the prototype reminder in parentheses so stripping removes it', () => {
    const r = prototypeFaces({ name: 'Phyrexian Fleshgorger', manaCost: '{7}', typeLine: 'Artifact Creature — Phyrexian Wurm', oracleText: text('fleshgorger') })!
    expect(stripReminder(r.sub.oracleText)).toBe('')
  })
  it('gives an empty sub text for a Prototype line without reminder', () => {
    const r = prototypeFaces({ name: 'x', manaCost: '{5}', typeLine: 'Artifact Creature', oracleText: 'Prototype {2}{R} — 2/2\nHaste' })!
    expect(r.sub.oracleText).toBe('')
    expect(r.sub.stat).toEqual({ kind: 'pt', power: '2', toughness: '2' })
    expect(r.main.oracleText).toBe('Haste')
  })
  it('keeps an unrecognised first paragraph as plain text', () => {
    expect(sagaSections('Odd first line.\nI — A.')[0]).toEqual({ text: 'Odd first line.' })
  })
})

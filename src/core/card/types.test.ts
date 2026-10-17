import { describe, it, expect } from 'vitest'
import { standardSheet, sheetFaces, statLabel, type Face } from './types'
const f: Face = { name: 'A', manaCost: '', typeLine: 'Instant', oracleText: '' }
describe('card types', () => {
  it('wraps a face as a standard sheet', () => { expect(standardSheet(f)).toEqual({ kind: 'standard', face: f }) })
  it('lists the faces of each sheet kind', () => {
    const g = { ...f, name: 'B' }
    expect(sheetFaces({ kind: 'standard', face: f })).toEqual([f])
    expect(sheetFaces({ kind: 'stacked', face: f, sub: g })).toEqual([f, g])
    expect(sheetFaces({ kind: 'split', halves: [f, g] })).toEqual([f, g])
  })
  it('labels every stat kind', () => {
    expect(statLabel({ kind: 'pt', power: '3', toughness: '3' })).toBe('3/3')
    expect(statLabel({ kind: 'loyalty', value: '5' })).toBe('5')
    expect(statLabel({ kind: 'defense', value: '4' })).toBe('4')
  })
})

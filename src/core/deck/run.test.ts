import { describe, it, expect } from 'vitest'
import { createRun, toggleCard, nextPending, markPrinted, progress, reset, type DeckCard } from './run'

const card = (key: string, count: number): DeckCard => ({
  key, name: key, count, line: 1, art: null,
  card: { name: key, manaCost: '', typeLine: '', oracleText: '' },
})
const statuses = (r: ReturnType<typeof createRun>) => r.items.map((i) => `${i.cardKey}${i.copy}:${i.status}`)

describe('createRun', () => {
  it('expands copies in list order, consecutively, all pending', () => {
    const r = createRun([card('bolt', 2), card('forest', 1)])
    expect(statuses(r)).toEqual(['bolt1:pending', 'bolt2:pending', 'forest1:pending'])
    expect(r.excluded.size).toBe(0)
  })
})

describe('toggleCard', () => {
  it('skips every pending copy of the card and restores them when toggled back', () => {
    const r0 = createRun([card('bolt', 2), card('forest', 1)])
    const r1 = toggleCard(r0, 'bolt')
    expect(statuses(r1)).toEqual(['bolt1:skipped', 'bolt2:skipped', 'forest1:pending'])
    expect(r1.excluded.has('bolt')).toBe(true)
    const r2 = toggleCard(r1, 'bolt')
    expect(statuses(r2)).toEqual(['bolt1:pending', 'bolt2:pending', 'forest1:pending'])
    expect(r2.excluded.has('bolt')).toBe(false)
  })
  it('never touches printed copies', () => {
    const r0 = createRun([card('bolt', 2)])
    const r1 = markPrinted(r0, r0.items[0])
    const r2 = toggleCard(r1, 'bolt')
    expect(statuses(r2)).toEqual(['bolt1:printed', 'bolt2:skipped'])
    expect(statuses(toggleCard(r2, 'bolt'))).toEqual(['bolt1:printed', 'bolt2:pending'])
  })
  it('does not mutate the input run', () => {
    const r0 = createRun([card('bolt', 1)])
    toggleCard(r0, 'bolt')
    expect(statuses(r0)).toEqual(['bolt1:pending'])
  })
})

describe('nextPending and markPrinted', () => {
  it('walks the queue in order and returns null when nothing is pending', () => {
    let r = createRun([card('bolt', 1), card('forest', 2)])
    expect(nextPending(r)).toMatchObject({ cardKey: 'bolt', copy: 1 })
    r = markPrinted(r, nextPending(r)!)
    expect(nextPending(r)).toMatchObject({ cardKey: 'forest', copy: 1 })
    r = markPrinted(r, nextPending(r)!)
    r = markPrinted(r, nextPending(r)!)
    expect(nextPending(r)).toBeNull()
  })
  it('skips excluded cards when finding the next item', () => {
    const r = toggleCard(createRun([card('bolt', 1), card('forest', 1)]), 'bolt')
    expect(nextPending(r)).toMatchObject({ cardKey: 'forest' })
  })
  it('returns null when every card is deselected', () => {
    const r = toggleCard(toggleCard(createRun([card('bolt', 1), card('forest', 1)]), 'bolt'), 'forest')
    expect(nextPending(r)).toBeNull()
    expect(progress(r)).toEqual({ printed: 0, total: 0, remaining: 0 })
  })
})

describe('progress', () => {
  it('counts pending and printed, not skipped', () => {
    let r = createRun([card('bolt', 2), card('forest', 3)])
    r = toggleCard(r, 'forest')
    r = markPrinted(r, nextPending(r)!)
    expect(progress(r)).toEqual({ printed: 1, total: 2, remaining: 1 })
  })
})

describe('reset', () => {
  it('returns printed copies to pending and keeps exclusions', () => {
    let r = createRun([card('bolt', 1), card('forest', 1)])
    r = toggleCard(r, 'forest')
    r = markPrinted(r, nextPending(r)!)
    r = reset(r)
    expect(statuses(r)).toEqual(['bolt1:pending', 'forest1:skipped'])
    expect(r.excluded.has('forest')).toBe(true)
  })
})

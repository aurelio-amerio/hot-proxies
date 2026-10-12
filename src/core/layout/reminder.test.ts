import { describe, it, expect } from 'vitest'
import { stripReminder } from './reminder'

describe('stripReminder', () => {
  it('removes trailing reminder text from a line', () => {
    expect(stripReminder('Toxic 1 (Players dealt combat damage by this creature also get a poison counter.)\nFlying'))
      .toBe('Toxic 1\nFlying')
  })
  it('removes a paragraph that is only reminder text', () => {
    expect(stripReminder('({T}: Add {G}.)')).toBe('')
    expect(stripReminder('Flying\n({T}: Add {G}.)\nTrample')).toBe('Flying\nTrample')
  })
  it('removes reminder text in the middle of a line and tidies spaces', () => {
    expect(stripReminder('Ward {2} (Whenever this becomes the target, counter it unless they pay {2}.) Haste'))
      .toBe('Ward {2} Haste')
  })
  it('leaves text without parentheses untouched', () => {
    expect(stripReminder('Destroy target creature.')).toBe('Destroy target creature.')
  })
})

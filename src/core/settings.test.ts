import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings } from './settings'
import { cardHeight, DOTS_PER_LINE } from './printer'

describe('printer', () => {
  it('derives card height from width at 63:88', () => {
    expect(cardHeight(DOTS_PER_LINE)).toBe(536)
    expect(cardHeight(576)).toBe(805)
  })
})

describe('normalizeSettings', () => {
  it('returns defaults for non-objects', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('clamps and defaults a corrupt object', () => {
    const s = normalizeSettings({ gamma: 9, textSize: 'big', dither: 'magic', block: 3, dotsPerLine: 100, stripReminder: 'yes' })
    expect(s.gamma).toBe(1.6)
    expect(s.textSize).toBe(17)
    expect(s.dither).toBe('atkinson')
    expect(s.block).toBe(1)
    expect(s.dotsPerLine).toBe(192)
    expect(s.stripReminder).toBe(true)
  })

  it('keeps valid values', () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, dither: 'bayer4', block: 2, textSize: 20, fontFamily: 'MPlantin' })
    expect(s.dither).toBe('bayer4')
    expect(s.block).toBe(2)
    expect(s.textSize).toBe(20)
    expect(s.fontFamily).toBe('MPlantin')
  })
})

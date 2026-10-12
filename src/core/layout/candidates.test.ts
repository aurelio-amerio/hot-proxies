import { describe, it, expect } from 'vitest'
import { fitCandidates } from './candidates'

describe('fitCandidates', () => {
  it('follows the spec order for base 17 with reminder kept', () => {
    const c = fitCandidates(17, false)
    expect(c[0]).toEqual({ textSize: 17, artH: 250, stripped: false })
    expect(c[7]).toEqual({ textSize: 17, artH: 180, stripped: false })      // art 250→180 in 10s: 8 candidates
    expect(c[8]).toEqual({ textSize: 16, artH: 180, stripped: false })      // then text 16..14 at 180
    expect(c[10]).toEqual({ textSize: 14, artH: 180, stripped: false })
    expect(c[11]).toEqual({ textSize: 14, artH: 170, stripped: false })     // then art 170..100 at 14
    expect(c[18]).toEqual({ textSize: 14, artH: 100, stripped: false })
    expect(c[19]).toEqual({ textSize: 17, artH: 180, stripped: true })      // strip, restart text step from base
    expect(c[30]).toEqual({ textSize: 14, artH: 100, stripped: true })
    expect(c[31]).toEqual({ textSize: 13, artH: 100, stripped: true })      // last resort 13..11
    expect(c[c.length - 1]).toEqual({ textSize: 11, artH: 100, stripped: true })
    expect(c).toHaveLength(34)
  })
  it('skips the strip phase when the setting already stripped', () => {
    const c = fitCandidates(17, true)
    expect(c.every((x) => x.stripped)).toBe(true)
    expect(c).toHaveLength(22)
  })
  it('never yields a text size below the floor or above the base', () => {
    for (const x of fitCandidates(20, false)) { expect(x.textSize).toBeLessThanOrEqual(20); expect(x.textSize).toBeGreaterThanOrEqual(11) }
  })
})

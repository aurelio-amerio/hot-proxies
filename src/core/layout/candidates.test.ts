import { describe, it, expect } from 'vitest'
import { fitCandidates, columnCandidates, stackedCandidates, splitCandidates } from './candidates'

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

describe('columnCandidates', () => {
  it('follows the column order for base 17 with reminder kept', () => {
    const c = columnCandidates(17, false)
    expect(c[0]).toEqual({ textSize: 17, colW: 150, stripped: false })
    expect(c[3]).toEqual({ textSize: 17, colW: 120, stripped: false })
    expect(c[4]).toEqual({ textSize: 16, colW: 120, stripped: false })
    expect(c[7]).toEqual({ textSize: 14, colW: 110, stripped: false })
    expect(c[10]).toEqual({ textSize: 14, colW: 80, stripped: false })
    expect(c[11]).toEqual({ textSize: 17, colW: 120, stripped: true })
    expect(c.findIndex((x) => x.colW === 0)).toBe(19)
    expect(c[19]).toEqual({ textSize: 17, colW: 0, stripped: true })
    expect(c[c.length - 1]).toEqual({ textSize: 11, colW: 0, stripped: true })
  })
  it('drops the column right after the strip phase when the setting already stripped', () => {
    const c = columnCandidates(17, true)
    expect(c.every((x) => x.stripped)).toBe(true)
    expect(c.findIndex((x) => x.colW === 0)).toBe(11)
  })
  it('has no text below 14 with a column, and no duplicate neighbours', () => {
    for (const strip of [false, true]) for (const base of [20, 17, 14]) {
      const c = columnCandidates(base, strip)
      for (const x of c) if (x.textSize < 14) { expect(x.colW).toBe(0); expect(x.stripped).toBe(true) }
      c.forEach((x, i) => { if (i) expect(x).not.toEqual(c[i - 1]) })
    }
  })
  it('never grows the column between neighbours at the same text size', () => {
    const c = columnCandidates(17, false)
    c.forEach((x, i) => { if (i && x.textSize === c[i - 1].textSize && x.stripped === c[i - 1].stripped) expect(x.colW).toBeLessThanOrEqual(c[i - 1].colW) })
  })
})

describe('stackedCandidates', () => {
  it('starts like fitCandidates up to the first text size below 14', () => {
    const f = fitCandidates(24, false)
    const s = stackedCandidates(24, false)
    const n = f.findIndex((x) => x.textSize < 14)
    expect(s.slice(0, n)).toEqual(f.slice(0, n))
  })
  it('drops the art, then text below 14, instead of shrinking it further', () => {
    const c = stackedCandidates(17, false)
    expect(c.findIndex((x) => x.artH === 0)).toBe(31)
    expect(c[30]).toEqual({ textSize: 14, artH: 100, stripped: true })
    expect(c[31]).toEqual({ textSize: 17, artH: 0, stripped: true })
    expect(c[c.length - 1]).toEqual({ textSize: 11, artH: 0, stripped: true })
    for (const x of c) if (x.textSize < 14) { expect(x.artH).toBe(0); expect(x.stripped).toBe(true) }
  })
  it('never grows the art between neighbours at the same text size', () => {
    const c = stackedCandidates(17, false)
    c.forEach((x, i) => { if (i && x.textSize === c[i - 1].textSize && x.stripped === c[i - 1].stripped) expect(x.artH).toBeLessThanOrEqual(c[i - 1].artH) })
  })
})

describe('splitCandidates', () => {
  it('follows the split order for base 17 with reminder kept', () => {
    const c = splitCandidates(17, false)
    expect(c[0]).toEqual({ textSize: 17, artH: 120, stripped: false })
    expect(c[6]).toEqual({ textSize: 17, artH: 60, stripped: false })
    expect(c[7]).toEqual({ textSize: 16, artH: 60, stripped: false })
    expect(c[9]).toEqual({ textSize: 14, artH: 60, stripped: false })
    expect(c[10]).toEqual({ textSize: 17, artH: 60, stripped: true })
    expect(c.findIndex((x) => x.artH === 0)).toBe(14)
    expect(c[c.length - 1]).toEqual({ textSize: 11, artH: 0, stripped: true })
    for (const x of c) if (x.textSize < 14) { expect(x.artH).toBe(0); expect(x.stripped).toBe(true) }
  })
  it('skips the strip phase when the setting already stripped', () => {
    const c = splitCandidates(17, true)
    expect(c.every((x) => x.stripped)).toBe(true)
    expect(c.findIndex((x) => x.artH === 0)).toBe(10)
  })
  it('has no duplicate neighbours, even for a base at or below 14', () => {
    for (const strip of [false, true]) for (const base of [20, 14, 12]) {
      const c = splitCandidates(base, strip)
      c.forEach((x, i) => { if (i) expect(x).not.toEqual(c[i - 1]) })
    }
  })
})

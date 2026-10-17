import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fit } from '../layout/fit'
import { normalizeScryfall } from '../card/normalize'
import { DEFAULT_SETTINGS } from '../settings'
import { nodeEnv } from '../../../tests/nodeEnv'
import { standardSheet } from '../card/types'
import { hotspotsFor, STAT_HOTSPOT, HOTSPOT_LABELS } from './hotspots'

const card = (n: string) => normalizeScryfall(JSON.parse(readFileSync(`tests/fixtures/cards/${n}.json`, 'utf8')))

describe('hotspotsFor', () => {
  it('maps the geometry boxes, stat last, with labels', () => {
    const g = fit(standardSheet(card('tarmogoyf')), DEFAULT_SETTINGS, nodeEnv)
    const spots = hotspotsFor(g)
    expect(spots.map((s) => s.kind)).toEqual(['name', 'art', 'type', 'rules', 'stat'])
    expect(spots[0].rect).toEqual(g.nameBar); expect(spots[1].rect).toEqual(g.art)
    expect(spots[2].rect).toEqual(g.typeBar); expect(spots[3].rect).toEqual(g.textBox)
    expect(spots[4].rect).toEqual(g.statBox)
    expect(spots[4].label).toBe(HOTSPOT_LABELS.stat)
    expect(spots[1].label).toBe('Change art')
  })
  it('omits the art hotspot when the art was dropped', () => {
    const g = { ...fit(standardSheet(card('bolt')), DEFAULT_SETTINGS, nodeEnv), art: undefined }
    const kinds = hotspotsFor(g).map((s) => s.kind)
    expect(kinds).toHaveLength(4)
    expect(kinds).not.toContain('art')
  })
  it('gives a card without a stat box a 96 x 32 stat hotspot in the bottom-right of the text box', () => {
    const g = fit(standardSheet(card('bolt')), DEFAULT_SETTINGS, nodeEnv)
    expect(g.statBox).toBeUndefined()
    const stat = hotspotsFor(g).find((s) => s.kind === 'stat')!.rect
    expect(stat).toEqual({ x: g.textBox.x + g.textBox.w - STAT_HOTSPOT.w, y: g.textBox.y + g.textBox.h - STAT_HOTSPOT.h, w: STAT_HOTSPOT.w, h: STAT_HOTSPOT.h })
  })
})

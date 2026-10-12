import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { nodeEnv } from '../../../tests/nodeEnv'
import { fit } from './fit'
import { normalizeScryfall } from '../card/normalize'
import { DEFAULT_SETTINGS } from '../settings'
import type { CardData } from '../card/types'
import { ART_MAX, ART_MID, ART_MIN, TEXT_MIN, TEXT_FLOOR } from './constants'

const card = (n: string) => normalizeScryfall(JSON.parse(readFileSync(`tests/fixtures/cards/${n}.json`, 'utf8')))
const synthetic = (words: number, extra: Partial<CardData> = {}): CardData => ({
  name: 'Test Card', manaCost: '{1}{G}', typeLine: 'Creature — Test', oracleText: Array(words).fill('word').join(' '),
  stat: { kind: 'pt', power: '1', toughness: '1' }, ...extra,
})
const S = DEFAULT_SETTINGS

describe('fit', () => {
  it('fills the card grid and stacks bars without overlap', () => {
    const g = fit(card('rotpriest'), S, nodeEnv)
    expect(g.card).toEqual({ w: 384, h: 536 })
    expect(g.nameBar.y).toBeLessThan(g.art.y); expect(g.art.y + g.art.h).toBeLessThanOrEqual(g.typeBar.y)
    expect(g.typeBar.y + g.typeBar.h).toBeLessThanOrEqual(g.textBox.y)
    expect(g.textBox.y + g.textBox.h).toBeLessThanOrEqual(536 - 8)
  })
  it('gives a short card full-size art at base text size', () => {
    const g = fit(card('bolt'), S, nodeEnv)
    expect(g.art.h).toBe(ART_MAX); expect(g.textFontSize).toBe(S.textSize); expect(g.overflow).toBe(false)
  })
  it('shrinks art before text for a medium card', () => {
    const g = fit(synthetic(60), S, nodeEnv)
    expect(g.textFontSize).toBe(S.textSize); expect(g.art.h).toBeLessThan(ART_MAX); expect(g.art.h).toBeGreaterThanOrEqual(ART_MID)
  })
  it('fits Bolas without overflow and with a loyalty box', () => {
    const g = fit(card('bolas'), S, nodeEnv)
    expect(g.overflow).toBe(false)
    expect(g.statBox).toBeDefined()
  })
  it('shrinks text once art is at the middle floor (Bolas-length synthetic text)', () => {
    const g = fit(synthetic(120), S, nodeEnv)
    expect(g.overflow).toBe(false)
    expect(g.art.h).toBeLessThanOrEqual(ART_MID)
    expect(g.textFontSize).toBeLessThan(S.textSize); expect(g.textFontSize).toBeGreaterThanOrEqual(TEXT_MIN)
    expect(g.statBox).toBeDefined()
  })
  it('strips reminder text only when needed and reports it', () => {
    const long = synthetic(80, { oracleText: 'Toxic 1 (Players dealt combat damage by this creature also get a poison counter.) ' + Array(70).fill('word').join(' ') })
    const g = fit(long, { ...S, stripReminder: false }, nodeEnv)
    expect(g.strippedReminder).toBe(false)
    const absurd = synthetic(0, { oracleText: Array(40).fill('(reminder text here) ').join('') + Array(200).fill('word').join(' ') })
    const g2 = fit(absurd, { ...S, stripReminder: false }, nodeEnv)
    expect(g2.strippedReminder).toBe(true)
  })
  it('flags overflow at the floor for absurd text and still returns valid geometry', () => {
    const g = fit(synthetic(600), S, nodeEnv)
    expect(g.overflow).toBe(true); expect(g.textFontSize).toBe(TEXT_FLOOR); expect(g.art.h).toBe(ART_MIN)
    expect(g.textLines.length).toBeGreaterThan(0)
  })
  it('flows the last lines around the stat box', () => {
    const g = fit(synthetic(55), S, nodeEnv)
    const inner = g.textBox.w - 2 * 6
    const last = g.textLines[g.textLines.length - 1]
    expect(last.width).toBeLessThanOrEqual(inner - (g.statBox!.w + 4))
  })
  it('shrinks a long type line until it fits inside the type bar', () => {
    const typeLine = 'Legendary Artifact Planeswalker — Equipment Luxior'
    const g = fit(synthetic(5, { typeLine }), S, nodeEnv)
    expect(g.typeFontSize).toBeLessThan(18)
    const ctx = nodeEnv.createCanvas(8, 8).getContext('2d')
    ctx.font = `bold ${g.typeFontSize}px ${S.fontFamily}`
    expect(ctx.measureText(typeLine).width).toBeLessThanOrEqual(g.typeBar.w - 16)
    expect(fit(card('bolt'), S, nodeEnv).typeFontSize).toBe(18)
  })
  it('uses the whole name bar when there is no mana cost', () => {
    const g = fit(card('starting-town'), S, nodeEnv)
    expect(g.nameFontSize).toBe(22); expect(g.costOnSecondLine).toBe(false); expect(g.statBox).toBeUndefined()
  })
  it('shrinks a long name to clear the cost', () => {
    const g = fit(card('bolas'), S, nodeEnv)
    expect(g.nameFontSize).toBeLessThan(22); expect(g.costOnSecondLine).toBe(false)
  })
  it('moves a huge cost to a second line', () => {
    const g = fit(synthetic(5, { manaCost: '{W}{U}{B}{R}{G}{W}{U}{B}{R}{G}{W}{U}' }), S, nodeEnv)
    expect(g.costOnSecondLine).toBe(true); expect(g.nameBar.h).toBeGreaterThan(34)
  })
  it('respects a custom dots-per-line', () => {
    const g = fit(card('bolt'), { ...S, dotsPerLine: 576 }, nodeEnv)
    expect(g.card).toEqual({ w: 576, h: 805 })
  })
})

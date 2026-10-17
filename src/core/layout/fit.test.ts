import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { nodeEnv } from '../../../tests/nodeEnv'
import { fit } from './fit'
import { normalizeScryfall } from '../card/normalize'
import { DEFAULT_SETTINGS } from '../settings'
import { standardSheet, type CardData, type Sheet } from '../card/types'
import { ART_MAX, ART_MID, ART_MIN, TEXT_MIN, TEXT_FLOOR, COL_ART_MAX, GAP, BADGE, SPLIT_ART_MAX } from './constants'

const card = (n: string) => normalizeScryfall(JSON.parse(readFileSync(`tests/fixtures/cards/${n}.json`, 'utf8'))).sheets[0]
const synthetic = (words: number, extra: Partial<CardData> = {}): CardData => ({
  name: 'Test Card', manaCost: '{1}{G}', typeLine: 'Creature — Test', oracleText: Array(words).fill('word').join(' '),
  stat: { kind: 'pt', power: '1', toughness: '1' }, ...extra,
})
const S = DEFAULT_SETTINGS

describe('fit', () => {
  it('tags a standard sheet', () => {
    expect(fit(card('bolt'), S, nodeEnv).kind).toBe('standard')
  })
  it('fills the card grid and stacks bars without overlap', () => {
    const g = fit(card('rotpriest'), S, nodeEnv)
    expect(g.card).toEqual({ w: 384, h: 536 })
    expect(g.nameBar.y).toBeLessThan(g.art!.y); expect(g.art!.y + g.art!.h).toBeLessThanOrEqual(g.typeBar.y)
    expect(g.typeBar.y + g.typeBar.h).toBeLessThanOrEqual(g.textBox.y)
    expect(g.textBox.y + g.textBox.h).toBeLessThanOrEqual(536 - 8)
  })
  it('gives a short card full-size art at base text size', () => {
    const g = fit(card('bolt'), S, nodeEnv)
    expect(g.art!.h).toBe(ART_MAX); expect(g.textFontSize).toBe(S.textSize); expect(g.overflow).toBe(false)
  })
  it('shrinks art before text for a medium card', () => {
    const g = fit(standardSheet(synthetic(40)), S, nodeEnv)
    expect(g.textFontSize).toBe(S.textSize); expect(g.art!.h).toBeLessThan(ART_MAX); expect(g.art!.h).toBeGreaterThanOrEqual(ART_MID)
  })
  it('fits Bolas without overflow and with a loyalty box', () => {
    const g = fit(card('bolas'), S, nodeEnv)
    expect(g.overflow).toBe(false)
    expect(g.statBox).toBeDefined()
  })
  it('shrinks text once art is at the middle floor (Bolas-length synthetic text)', () => {
    const g = fit(standardSheet(synthetic(120)), S, nodeEnv)
    expect(g.overflow).toBe(false)
    expect(g.art!.h).toBeLessThanOrEqual(ART_MID)
    expect(g.textFontSize).toBeLessThan(S.textSize); expect(g.textFontSize).toBeGreaterThanOrEqual(TEXT_MIN)
    expect(g.statBox).toBeDefined()
  })
  it('strips reminder text only when needed and reports it', () => {
    const long = synthetic(80, { oracleText: 'Toxic 1 (Players dealt combat damage by this creature also get a poison counter.) ' + Array(70).fill('word').join(' ') })
    const g = fit(standardSheet(long), { ...S, stripReminder: false }, nodeEnv)
    expect(g.strippedReminder).toBe(false)
    const absurd = synthetic(0, { oracleText: Array(40).fill('(reminder text here) ').join('') + Array(200).fill('word').join(' ') })
    const g2 = fit(standardSheet(absurd), { ...S, stripReminder: false }, nodeEnv)
    expect(g2.strippedReminder).toBe(true)
  })
  it('flags overflow at the floor for absurd text and still returns valid geometry', () => {
    const g = fit(standardSheet(synthetic(600)), S, nodeEnv)
    expect(g.overflow).toBe(true); expect(g.textFontSize).toBe(TEXT_FLOOR); expect(g.art!.h).toBe(ART_MIN)
    expect(g.textLines.length).toBeGreaterThan(0)
  })
  it('flows the last lines around the stat box', () => {
    const g = fit(standardSheet(synthetic(55)), S, nodeEnv)
    const inner = g.textBox.w - 2 * 6
    const last = g.textLines[g.textLines.length - 1]
    expect(last.width).toBeLessThanOrEqual(inner - (g.statBox!.w + 4))
  })
  it('shrinks a long type line until it fits inside the type bar', () => {
    const typeLine = 'Legendary Artifact Planeswalker — Equipment Luxior'
    const g = fit(standardSheet(synthetic(5, { typeLine })), S, nodeEnv)
    expect(g.typeFontSize).toBeLessThan(18)
    const ctx = nodeEnv.createCanvas(8, 8).getContext('2d')
    ctx.font = `bold ${g.typeFontSize}px ${S.fontFamily}`
    expect(ctx.measureText(typeLine).width).toBeLessThanOrEqual(g.typeBar.w - 16)
    expect(fit(card('bolt'), S, nodeEnv).typeFontSize).toBe(18)
  })
  it('uses the whole name bar when there is no mana cost', () => {
    const g = fit(card('starting-town'), S, nodeEnv)
    expect(g.nameFontSize).toBe(S.nameSize); expect(g.costOnSecondLine).toBe(false); expect(g.statBox).toBeUndefined()
  })
  it('shrinks a long name to clear the cost', () => {
    const g = fit(card('bolas'), S, nodeEnv)
    expect(g.nameFontSize).toBeLessThan(S.nameSize); expect(g.costOnSecondLine).toBe(false)
  })
  it('moves a huge cost to a second line', () => {
    const g = fit(standardSheet(synthetic(5, { manaCost: '{W}{U}{B}{R}{G}{W}{U}{B}{R}{G}{W}{U}' })), S, nodeEnv)
    expect(g.costOnSecondLine).toBe(true); expect(g.nameBar.h).toBeGreaterThan(34)
  })
  it('respects a custom dots-per-line', () => {
    const g = fit(card('bolt'), { ...S, dotsPerLine: 576 }, nodeEnv)
    expect(g.card).toEqual({ w: 576, h: 805 })
  })
  it('columns: Benalia keeps base text and the widest art column', () => {
    // reminder kept, so the lore-counter paragraph is a section of its own
    const g = fit(card('benalia'), { ...S, stripReminder: false }, nodeEnv)
    expect(g.kind).toBe('columns'); expect(g.art!.w).toBe(COL_ART_MAX); expect(g.textFontSize).toBe(S.textSize)
    expect(g.typeBar.y + g.typeBar.h).toBe(536 - 8); expect(g.art!.x).toBe(g.textBox.x + g.textBox.w + GAP)
    expect(g.sections!.map((x) => x.badges.map((b) => b.code))).toEqual([[], ['I', 'II'], ['III']])
    expect(g.sections![1].badges[1].rect.y).toBe(g.sections![1].badges[0].rect.y + BADGE + 2)
    expect(g.sections![0].rule).toBeUndefined()
  })
  it('columns: stripping reminder text skips the section it leaves empty', () => {
    const g = fit(card('benalia'), S, nodeEnv)
    expect(g.strippedReminder).toBe(true)
    expect(g.sections!.map((x) => x.badges.map((b) => b.code))).toEqual([['I', 'II'], ['III']])
  })
  it('columns: a rule sits above every header but the first section', () => {
    const g = fit(card('ranger-class'), S, nodeEnv)
    const [first, l2, l3] = g.sections!
    expect(first.rule).toBeUndefined(); expect(first.header).toBeUndefined()
    expect(l2.header).toMatchObject({ label: 'Level 2', costCodes: ['1', 'G'] }); expect(l2.rule).toBe(l2.header!.y - 3)
    expect(l3.textTop).toBe(l3.header!.y + g.lineHeight)
  })
  it("columns: Urza's Saga shrinks the column before the text and never overflows", () => {
    const g = fit(card('urzas-saga'), S, nodeEnv)
    expect(g.overflow).toBe(false); expect(g.textFontSize).toBeGreaterThanOrEqual(TEXT_MIN)
    expect(g.art === undefined || g.art.w < COL_ART_MAX).toBe(true)
  })
  it('columns: a leveler puts the card P/T in a stat box and the level P/T in headers', () => {
    const g = fit(card('transcendent-master'), S, nodeEnv)
    expect(g.statBox).toBeDefined(); expect(g.sections![1].header!.statLabel).toBe('6/6')
  })
  it('columns: a very long class drops the art column before clipping', () => {
    const ranger = card('ranger-class') as Extract<Sheet, { kind: 'columns' }>
    const sheet = { ...ranger, sections: ranger.sections.map((x) => ({ ...x, text: Array(60).fill('word').join(' ') })) }
    const g = fit(sheet as Sheet, S, nodeEnv)
    expect(g.art).toBeUndefined(); expect(g.textBox.w).toBe(384 - 16)
  })
  it('columns: absurd text clips the last sections at the floor and flags overflow', () => {
    const ranger = card('ranger-class') as Extract<Sheet, { kind: 'columns' }>
    const sheet = { ...ranger, sections: ranger.sections.map((x) => ({ ...x, text: Array(200).fill('word').join(' ') })) }
    const g = fit(sheet as Sheet, S, nodeEnv)
    expect(g.overflow).toBe(true); expect(g.textFontSize).toBe(TEXT_FLOOR); expect(g.art).toBeUndefined()
    const last = g.sections![g.sections!.length - 1]
    expect(last.lines.length).toBeGreaterThan(0)
    expect(last.textTop + last.lines.length * g.lineHeight).toBeLessThanOrEqual(g.textBox.y + g.textBox.h - 6)
  })
  it('stacked: Bonecrusher keeps the art and puts Stomp in a sub box above the bottom margin', () => {
    const g = fit(card('bonecrusher'), S, nodeEnv)
    expect(g.kind).toBe('stacked'); expect(g.art).toBeDefined(); expect(g.sub!.box.y + g.sub!.box.h).toBe(536 - 8)
    expect(g.textBox.y + g.textBox.h + GAP).toBe(g.sub!.box.y); expect(g.sub!.typeY).toBeDefined(); expect(g.statBox).toBeDefined()
  })
  it('stacked: a flip card gives the flipped face its own stat box', () => { expect(fit(card('bushi'), S, nodeEnv).sub!.statBox).toBeDefined() })
  it('stacked: a prototype shows its size in the header, no type row', () => {
    const g = fit(card('fleshgorger'), S, nodeEnv); expect(g.sub!.typeY).toBeUndefined(); expect(g.sub!.headerStat).toBe('3/3'); expect(g.sub!.statBox).toBeUndefined()
  })
  it('stacked: long text drops the art before going below 14 px', () => {
    const c = card('bonecrusher') as Extract<Sheet, { kind: 'stacked' }>
    const g = fit({ ...c, face: { ...c.face, oracleText: Array(160).fill('word').join(' ') } }, S, nodeEnv)
    expect(g.art).toBeUndefined(); expect(g.textFontSize).toBeGreaterThanOrEqual(TEXT_MIN); expect(g.typeBar.y).toBe(g.nameBar.y + g.nameBar.h + GAP)
  })
  it('split: Fire // Ice is two halves with the art between them', () => {
    const g = fit(card('fire-ice'), S, nodeEnv)
    expect(g.kind).toBe('split'); expect(g.art!.h).toBe(SPLIT_ART_MAX); expect(g.textFontSize).toBe(S.textSize)
    expect(g.art!.y).toBe(g.textBox.y + g.textBox.h + GAP); expect(g.second!.nameBar.y).toBe(g.art!.y + g.art!.h + GAP)
    expect(g.second!.textBox.y + g.second!.textBox.h).toBeLessThanOrEqual(536 - 8); expect(g.statBox).toBeUndefined()
  })
  it('split: long halves drop the art before text goes below 14 px', () => {
    const c = card('fire-ice') as Extract<Sheet, { kind: 'split' }>
    const long = Array(90).fill('word').join(' ')
    const g = fit({ kind: 'split', halves: [{ ...c.halves[0], oracleText: long }, { ...c.halves[1], oracleText: long }] }, S, nodeEnv)
    expect(g.art).toBeUndefined(); expect(g.textFontSize).toBeGreaterThanOrEqual(TEXT_MIN); expect(g.overflow).toBe(false)
  })
  it('split: absurd text clips the second half first and flags overflow', () => {
    const c = card('fire-ice') as Extract<Sheet, { kind: 'split' }>
    const g = fit({ kind: 'split', halves: [{ ...c.halves[0], oracleText: Array(600).fill('word').join(' ') }, c.halves[1]] }, S, nodeEnv)
    expect(g.overflow).toBe(true); expect(g.textFontSize).toBe(TEXT_FLOOR); expect(g.second!.lines.length).toBe(1)
    expect(g.second!.textBox.y + g.second!.textBox.h).toBeLessThanOrEqual(536 - 8)
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { normalizeScryfall, attachMeldBack } from './normalize'
import { UnsupportedLayout } from '../errors'
import type { Face } from './types'

const load = (n: string) => JSON.parse(readFileSync(`tests/fixtures/cards/${n}.json`, 'utf8'))
const face = (n: string) => (normalizeScryfall(load(n)).sheets[0] as { kind: 'standard'; face: Face }).face

describe('normalizeScryfall', () => {
  it('maps a creature', () => {
    const c = face('rotpriest')
    expect(c).toMatchObject({ name: 'Venerated Rotpriest', manaCost: '{G}', typeLine: 'Creature — Phyrexian Druid',
      stat: { kind: 'pt', power: '1', toughness: '2' } })
    expect(c.oracleText).toContain('Toxic 1')
    expect(c.artUrl).toMatch(/^https:\/\/cards\.scryfall\.io\/art_crop\//)
    expect(normalizeScryfall(load('rotpriest')).sheets[0].kind).toBe('standard')
  })
  it('maps an instant with no stat', () => {
    const c = face('bolt')
    expect(c.typeLine).toBe('Instant'); expect(c.stat).toBeUndefined(); expect(c.manaCost).toBe('{R}')
  })
  it('maps a land with empty mana cost', () => {
    const c = face('starting-town')
    expect(c.manaCost).toBe(''); expect(c.typeLine).toBe('Land — Town')
  })
  it('maps a planeswalker to loyalty', () => {
    expect(face('bolas').stat).toEqual({ kind: 'loyalty', value: '5' })
  })
  it('maps a vehicle P/T even though it is not a creature', () => {
    expect(face('copter').stat).toEqual({ kind: 'pt', power: '3', toughness: '3' })
  })
  it('keeps star power and toughness verbatim', () => {
    expect(face('tarmogoyf').stat).toEqual({ kind: 'pt', power: '*', toughness: '1+*' })
  })
  it('throws UnsupportedLayout for junk input', () => {
    expect(() => normalizeScryfall({})).toThrow(UnsupportedLayout)
  })

  it('saga → one columns sheet with chapter badges', () => {
    const c = normalizeScryfall(load('benalia'))
    expect(c.sheets.length).toBe(1); expect(c.sheets[0].kind).toBe('columns')
    expect((c.sheets[0] as any).sections[1].badges).toEqual(['I', 'II'])
  })
  it('class, case and leveler → columns', () => {
    for (const n of ['ranger-class', 'case-skeleton', 'transcendent-master']) expect(normalizeScryfall(load(n)).sheets[0].kind).toBe('columns')
  })
  it('prototype → stacked with a Prototype sub face', () => {
    const s = normalizeScryfall(load('fleshgorger')).sheets[0]
    expect(s.kind).toBe('stacked'); expect((s as any).sub.name).toBe('Prototype')
  })
  it('adventure and flip → stacked, art from the top-level image_uris', () => {
    const a = normalizeScryfall(load('bonecrusher')); const s = a.sheets[0] as any
    expect(a.name).toBe('Bonecrusher Giant // Stomp'); expect(s.kind).toBe('stacked')
    expect(s.face.name).toBe('Bonecrusher Giant')
    expect(s.sub).toMatchObject({ name: 'Stomp', manaCost: '{1}{R}', typeLine: 'Instant — Adventure' })
    expect(s.face.artUrl).toMatch(/art_crop/); expect(s.face.stat).toEqual({ kind: 'pt', power: '4', toughness: '3' })
    expect((normalizeScryfall(load('bushi')).sheets[0] as any).sub.stat).toEqual({ kind: 'pt', power: '3', toughness: '4' })
  })
  it('split → one split sheet with two halves', () => {
    const s = normalizeScryfall(load('fire-ice')).sheets[0] as any
    expect(s.kind).toBe('split'); expect(s.halves.map((h: Face) => h.name)).toEqual(['Fire', 'Ice'])
    expect(normalizeScryfall(load('dusk-dawn')).sheets[0].kind).toBe('split')
  })
  it('transform and modal_dfc → two sheets, each face with its own art', () => {
    const c = normalizeScryfall(load('delver'))
    expect(c.sheets.length).toBe(2)
    expect((c.sheets[0] as any).face).toMatchObject({ name: 'Delver of Secrets', stat: { kind: 'pt', power: '1', toughness: '1' } })
    expect((c.sheets[1] as any).face.artUrl).toMatch(/\/back\//)
    expect((normalizeScryfall(load('valki')).sheets[1] as any).face.stat).toEqual({ kind: 'loyalty', value: '5' })
  })
  it('battle → defense stat on the front', () => {
    expect((normalizeScryfall(load('gobakhan')).sheets[0] as any).face.stat).toEqual({ kind: 'defense', value: '3' })
  })
  it('transform saga → columns front, standard back', () => {
    const c = normalizeScryfall(load('kami-war'))
    expect(c.sheets.map((s) => s.kind)).toEqual(['columns', 'standard'])
  })
  it('meld part → one sheet plus meldResult; attachMeldBack appends the result', () => {
    const c = normalizeScryfall(load('hanweir-battlements'))
    expect(c.sheets.length).toBe(1); expect(c.meldResult).toBe(load('hanweir-township').id)
    const full = attachMeldBack(c, load('hanweir-township'))
    expect(full.sheets.length).toBe(2); expect((full.sheets[1] as any).face.name).toBe('Hanweir, the Writhing Township')
    expect(full.meldBack).toBe(true); expect(full.meldResult).toBeUndefined()
    expect(normalizeScryfall(load('hanweir-township')).meldResult).toBeUndefined()
  })
  it('a face without oracle_text normalises to empty text', () => {
    const raw = load('delver'); delete raw.card_faces[1].oracle_text
    expect((normalizeScryfall(raw).sheets[1] as any).face.oracleText).toBe('')
  })
  it('a face layout without card_faces falls back to the top-level fields instead of throwing', () => {
    const raw = load('delver'); delete raw.card_faces
    const c = normalizeScryfall(raw)
    expect(c.sheets.length).toBe(1); expect(c.sheets[0].kind).toBe('standard')
    for (const layout of ['adventure', 'split', 'modal_dfc']) expect(() => normalizeScryfall({ ...raw, layout })).not.toThrow()
  })
  it('excluded layouts throw with the oversized message', () => {
    expect(() => normalizeScryfall(load('plane'))).toThrow(/'planar' layout; oversized and Un-set cards are not supported/)
  })
})

import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { ImageData, loadImage } from '@napi-rs/canvas'
import { nodeEnv, canvasToPng } from '../../../tests/nodeEnv'
import { loadArt } from '../../../tests/loadArt'
import { standardSheet } from '../card/types'
import { renderProxy } from './renderProxy'
import { normalizeScryfall } from '../card/normalize'
import { DEFAULT_SETTINGS } from '../settings'
import { bitImageToImageData, toPacked } from '../output/packed'
import type { BitImage } from '../art/types'
import type { TokenIndex } from '../token/index'
import { draftFromVariant } from '../token/draft'

const GOLDEN = 'tests/golden', DIFF = 'tests/golden/__diff__'
const card = (n: string) => normalizeScryfall(JSON.parse(readFileSync(`tests/fixtures/cards/${n}.json`, 'utf8'))).sheets[0]
const tokenIndex = JSON.parse(readFileSync('tests/fixtures/tokens/index.json', 'utf8')) as TokenIndex
const tokenCard = (name: string, variant = 0) => draftFromVariant(tokenIndex.tokens.find((t) => t.name === name)!, variant).card

function toCanvas(b: BitImage) {
  const c = nodeEnv.createCanvas(b.width, b.height)
  const id = bitImageToImageData(b)
  ;(c.getContext('2d') as unknown as { putImageData(d: unknown, x: number, y: number): void })
    .putImageData(new ImageData(id.data, id.width, id.height), 0, 0)
  return c
}

async function pngToBits(path: string): Promise<Uint8Array> {
  const img = await loadImage(path)
  const c = nodeEnv.createCanvas(img.width, img.height); const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, img.width, img.height).data
  const bits = new Uint8Array(img.width * img.height)
  for (let i = 0; i < bits.length; i++) bits[i] = d[i * 4] < 128 ? 1 : 0
  return bits
}

async function expectGolden(name: string, bits: BitImage) {
  mkdirSync(GOLDEN, { recursive: true })
  const file = `${GOLDEN}/${name}.png`
  const png = canvasToPng(toCanvas(bits))
  if (!existsSync(file) || process.env.UPDATE_GOLDEN) { writeFileSync(file, png); return }
  const expected = await pngToBits(file)
  let diff = 0
  for (let i = 0; i < bits.bits.length; i++) if (bits.bits[i] !== expected[i]) diff++
  if (diff > 0) {
    mkdirSync(DIFF, { recursive: true }); writeFileSync(`${DIFF}/${name}.png`, png)
    throw new Error(`${name}: ${diff} dots differ from golden; actual written to ${DIFF}/${name}.png (set UPDATE_GOLDEN=1 to accept)`)
  }
}

describe('renderProxy', () => {
  for (const name of ['rotpriest', 'bolt', 'starting-town', 'bolas']) {
    it(`renders ${name} identically to the golden image`, async () => {
      const art = await loadArt(`tests/fixtures/art/${name}.jpg`)
      const { bits, geometry } = renderProxy(card(name), art, DEFAULT_SETTINGS, nodeEnv)
      expect(bits.width).toBe(384); expect(bits.height).toBe(536)
      expect(geometry.overflow).toBe(false)
      expect(toPacked(bits).length).toBe(48 * 536)
      await expectGolden(name, bits)
    })
  }
  for (const [golden, fixture, artName] of [
    ['saga-benalia', 'benalia', 'bolas'], ['saga-urza', 'urzas-saga', null], ['class-ranger', 'ranger-class', 'rotpriest'],
    ['case-skeleton', 'case-skeleton', null], ['leveler-master', 'transcendent-master', 'bolt'],
  ] as const) {
    it(`renders ${golden} (columns sheet) identically to the golden image`, async () => {
      const art = artName ? await loadArt(`tests/fixtures/art/${artName}.jpg`) : null
      const { bits, geometry } = renderProxy(card(fixture), art, DEFAULT_SETTINGS, nodeEnv)
      expect(geometry.overflow).toBe(false)
      await expectGolden(golden, bits)
    })
  }
  for (const [golden, fixture, artName] of [
    ['adventure-bonecrusher', 'bonecrusher', 'rotpriest'], ['flip-bushi', 'bushi', 'bolt'], ['prototype-fleshgorger', 'fleshgorger', null],
  ] as const) {
    it(`renders ${golden} (stacked sheet) identically to the golden image`, async () => {
      const art = artName ? await loadArt(`tests/fixtures/art/${artName}.jpg`) : null
      const { bits, geometry } = renderProxy(card(fixture), art, DEFAULT_SETTINGS, nodeEnv)
      expect(geometry.kind).toBe('stacked'); expect(geometry.overflow).toBe(false)
      await expectGolden(golden, bits)
    })
  }
  for (const [golden, fixture, artName] of [['split-fire-ice', 'fire-ice', 'bolt'], ['split-dusk-dawn', 'dusk-dawn', null]] as const) {
    it(`renders ${golden} (split sheet) identically to the golden image`, async () => {
      const art = artName ? await loadArt(`tests/fixtures/art/${artName}.jpg`) : null
      const { bits, geometry } = renderProxy(card(fixture), art, DEFAULT_SETTINGS, nodeEnv)
      expect(geometry.kind).toBe('split'); expect(geometry.overflow).toBe(false)
      await expectGolden(golden, bits)
    })
  }
  it('renders the front of a transforming saga (The Kami War) identically to the golden image', async () => {
    const { bits, geometry } = renderProxy(card('kami-war'), null, DEFAULT_SETTINGS, nodeEnv)
    expect(geometry.kind).toBe('columns'); expect(geometry.overflow).toBe(false)
    await expectGolden('saga-kami-war-front', bits)
  })
  it('renders a noncreature token (no cost, no stat) identically to the golden image', async () => {
    const { bits, geometry } = renderProxy(standardSheet(tokenCard('Treasure')), null, DEFAULT_SETTINGS, nodeEnv)
    expect(geometry.costOnSecondLine).toBe(false)
    expect(geometry.statBox).toBeUndefined()
    expect(geometry.overflow).toBe(false)
    await expectGolden('token-treasure', bits)
  })
  it('renders a creature token with P/T identically to the golden image', async () => {
    const { bits, geometry } = renderProxy(standardSheet(tokenCard('Goblin', 0)), null, DEFAULT_SETTINGS, nodeEnv)
    expect(geometry.statBox).toBeDefined()
    expect(geometry.overflow).toBe(false)
    await expectGolden('token-goblin', bits)
  })
  it('renders without art', () => {
    const { bits } = renderProxy(card('bolt'), null, DEFAULT_SETTINGS, nodeEnv)
    expect(bits.bits.reduce((a, v) => a + v, 0)).toBeGreaterThan(1000)
  })
  it('is deterministic', () => {
    const a = renderProxy(card('bolt'), null, DEFAULT_SETTINGS, nodeEnv).bits.bits
    const b = renderProxy(card('bolt'), null, DEFAULT_SETTINGS, nodeEnv).bits.bits
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0)
  })
  it('changes the art region when the dither changes', () => {
    return loadArt('tests/fixtures/art/bolt.jpg').then((art) => {
      const a = renderProxy(card('bolt'), art, DEFAULT_SETTINGS, nodeEnv).bits.bits
      const b = renderProxy(card('bolt'), art, { ...DEFAULT_SETTINGS, dither: 'bayer4' }, nodeEnv).bits.bits
      expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).not.toBe(0)
    })
  })
})

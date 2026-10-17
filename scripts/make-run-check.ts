// Writes two 3-card ESC/POS streams for a manual check on the real printer.
// Usage: npm run check:run   then send each file over the printer's SPP COM port (see the printed instructions).
import { standardSheet } from '../src/core/card/types'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { nodeEnv } from '../tests/nodeEnv'
import { loadArt } from '../tests/loadArt'
import { normalizeScryfall } from '../src/core/card/normalize'
import { renderProxy } from '../src/core/render/renderProxy'
import { DEFAULT_SETTINGS } from '../src/core/settings'
import { toPacked } from '../src/core/output/packed'
import { escposInit, escposRasterFrames, escposFeed, encodeEscPosFrames } from '../src/core/output/escpos'
import { FEED_LINES_AFTER, FEED_LINES_BETWEEN_CARDS } from '../src/core/printer'

const fixtures: [string, string | null][] = [['bolt', 'bolt'], ['tarmogoyf', null], ['bolas', 'bolas']]
const packs: { packed: Uint8Array; width: number; height: number }[] = []
for (const [card, art] of fixtures) {
  const c = normalizeScryfall(JSON.parse(readFileSync(`tests/fixtures/cards/${card}.json`, 'utf8')))
  const g = art ? await loadArt(`tests/fixtures/art/${art}.jpg`) : null
  const { bits } = renderProxy(standardSheet(c), g, DEFAULT_SETTINGS, nodeEnv)
  packs.push({ packed: toPacked(bits), width: bits.width, height: bits.height })
}

const join = (frames: Uint8Array[]) => {
  const out = new Uint8Array(frames.reduce((a, f) => a + f.length, 0)); let o = 0
  for (const f of frames) { out.set(f, o); o += f.length }
  return out
}

// Option B (spec §2.2): one init, a gap feed between cards, the tail feed at the end.
const oneInit = join([
  escposInit(),
  ...packs.flatMap((p, i) => [...escposRasterFrames(p.packed, p.width, p.height), escposFeed(i === packs.length - 1 ? FEED_LINES_AFTER : FEED_LINES_BETWEEN_CARDS)]),
])
// Option A, for comparison: today's single-card stream repeated (ESC @ before every card).
const resetPerCard = join(packs.flatMap((p) => encodeEscPosFrames(p.packed, p.width, p.height)))

mkdirSync('tmp/run-check', { recursive: true })
writeFileSync('tmp/run-check/one-init.bin', oneInit)
writeFileSync('tmp/run-check/reset-per-card.bin', resetPerCard)
console.log(`one-init.bin: ${oneInit.length} bytes, reset-per-card.bin: ${resetPerCard.length} bytes (gap ${FEED_LINES_BETWEEN_CARDS} lines)`)
console.log(`
Send each file over the printer's SPP port (COM4 on 2026-10-14) from PowerShell:
  $p = New-Object System.IO.Ports.SerialPort COM4; $p.Open()
  $b = [IO.File]::ReadAllBytes("tmp\\run-check\\one-init.bin"); $p.Write($b, 0, $b.Length); Start-Sleep -Seconds 8; $p.Close()
Check: (1) every card's bottom edge is complete, (2) the gap between cards is wide enough to cut,
(3) no visible seam where the head paused. Then repeat with reset-per-card.bin.`)

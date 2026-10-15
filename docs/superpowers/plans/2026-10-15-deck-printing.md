# Deck Printing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paste a deck list, press Verify to resolve every name through Scryfall (with "did you mean" suggestions for failures), review thumbnails, deselect unwanted cards, and print the whole deck in one run with a cuttable gap between cards, resumable after a cancel or a dropped connection.

**Architecture:** `src/core/deck/` gains two pure modules: `parse.ts` (deck text to entries, section skipping, Moxfield URL detection, line rewriting) and `run.ts` (an immutable queue of print items with pending/printed/skipped status). `src/core/output/escpos.ts` is split into `escposInit`, `escposRasterFrames` and `escposFeed` so a run sends one `ESC @` and a per-card gap feed. `src/app/useDeck.ts` is the only async piece: it verifies names through the injected Scryfall client, renders thumbnails with `renderProxy`, and loops `printJob` over pending items. `DeckPanel`, `DeckStrip` and `DeckIssuesDialog` are the React views; `App.tsx` gains a persisted `Card | Deck` toggle.

**Tech Stack:** TypeScript, React 19, MUI 9, Vitest 5 (node + jsdom), Testing Library, existing `PrinterTransport` and `printJob`.

**Spec:** `docs/superpowers/specs/2026-10-15-deck-printing-design.md`

## Global Constraints

- `src/core/` never imports from `src/app/`, never touches `document`, `window` or `navigator`. `src/core/deck/parse.ts` may import `normalizeName` from `src/data/fuzzy.ts` (pure TS).
- Printer constants have one home, `src/core/printer.ts`. New constant `FEED_LINES_BETWEEN_CARDS = 2` (tuned in Task 2, record the date). Not a user setting.
- A run's byte stream is: `escposInit()` once (`1B 40 1B 61 00`), then per card the `GS v 0` blocks of ≤64 rows followed by `1B 64 <FEED_LINES_BETWEEN_CARDS>`; the last card is followed by `1B 64 <FEED_LINES_AFTER>` instead. Resume after a pause sends `escposInit()` again first.
- `encodeEscPosFrames` and `encodeEscPosRaster` keep their exact current output (25,808 bytes for a 384 × 536 card). Their existing tests must pass unchanged.
- Verify resolves every distinct name through `services.client.fetchCard` + `normalizeScryfall`. The bundled name index (`services.loadNames`) is used only for suggestions.
- No retry after a failed or dropped print. The dropped message is `PRINTER_MESSAGES.dropped` from `src/app/usePrinter.ts`: "Printer disconnected during printing. Reconnect and print again."
- localStorage keys: `hot-proxies.deck.v1` (deck text), `hot-proxies.mode.v1` (`'card' | 'deck'`).
- User-facing strings (copy exactly):
  - Moxfield alert: "Moxfield decks cannot be imported directly. Open the deck on Moxfield, choose Export, copy the list and paste it here."
  - Dialog title: "N cards could not be resolved" (N = number of issues; "1 card could not be resolved" when N is 1).
  - Issue reasons: "Not found", "Layout 'LAYOUT' is not supported", "Count must be 1 to 99".
  - Buttons: "Verify", "Fix all", "Close", "Print N cards", "Cancel", "Resume from card N", "Start over".
  - Status: "Checking A of B", "Card A of B · NAME", "N cards printed", "N of M selected".
  - Summaries: "N cards, M distinct" (editing), "N cards ready, M distinct" (ready/paused/done with nothing excluded), "N lines have problems".
- Vitest globals are off: import `describe/it/expect/vi` explicitly. UI tests start with `// @vitest-environment jsdom`.
- Line numbers are 1-based everywhere (parser, issues, dialog).
- Commit after every task. Run `npm test` and `npm run typecheck` before each commit.

## Review Focus

1. **Text pasted with Windows line endings (`\r\n`)**: every line must be trimmed of `\r` before matching, so names resolve and `rewriteCardName` keeps the other lines intact. Test added in Task 3.
2. **The same card on several lines with different case or accents** (`Lightning Bolt` and `lightning bolt`): one distinct card with the summed count, one thumbnail, and a suggestion applied to one line fixes all lines with that name. Tests added in Tasks 3 and 5.
3. **Print tapped twice quickly, or while a run is already printing**: the second call must be ignored, never interleave two loops. Test added in Task 6.
4. **`names.json` fails to load during Verify**: suggestions must be `null`, Verify must still complete and list the unresolved names. Test added in Task 5.
5. **Every card deselected**: `nextPending` is null, the Print button is disabled, and the summary reads "0 of N selected". Tests added in Tasks 4 and 9.

---

### Task 1: Printer constant and ESC/POS helpers

**Files:**
- Modify: `src/core/printer.ts`
- Modify: `src/core/output/escpos.ts`
- Test: `src/core/output/escpos.test.ts` (append)

**Interfaces:**
- Consumes: `RASTER_BLOCK_ROWS`, `FEED_LINES_AFTER` from `src/core/printer.ts`; `toPacked(b: BitImage): Uint8Array` from `src/core/output/packed.ts`.
- Produces: `FEED_LINES_BETWEEN_CARDS: number`; `escposInit(): Uint8Array`; `escposRasterFrames(packed: Uint8Array, width: number, height: number): Uint8Array[]`; `escposFeed(lines: number): Uint8Array`. `encodeEscPosFrames` and `encodeEscPosRaster` unchanged in behaviour.

- [ ] **Step 1: Write the failing tests**

Append to `src/core/output/escpos.test.ts` (and extend the import line to `import { encodeEscPosRaster, encodeEscPosFrames, escposInit, escposRasterFrames, escposFeed } from './escpos'` plus `import { FEED_LINES_AFTER, FEED_LINES_BETWEEN_CARDS } from '../printer'`):

```ts
describe('escpos helpers', () => {
  it('escposInit is ESC @ then ESC a 0', () => {
    expect(Array.from(escposInit())).toEqual([0x1b, 0x40, 0x1b, 0x61, 0x00])
  })
  it('escposFeed is ESC d n', () => {
    expect(Array.from(escposFeed(2))).toEqual([0x1b, 0x64, 0x02])
    expect(Array.from(escposFeed(7))).toEqual([0x1b, 0x64, 0x07])
  })
  it('escposRasterFrames emits only the GS v 0 blocks', () => {
    const frames = escposRasterFrames(packedFor(384, 536), 384, 536)
    expect(frames.length).toBe(9)
    expect(Array.from(frames[0].subarray(0, 8))).toEqual([0x1d, 0x76, 0x30, 0x00, 48, 0, 64, 0])
    expect(frames[8].length).toBe(8 + 24 * 48)
  })
  it('init + raster + feed(FEED_LINES_AFTER) is exactly encodeEscPosFrames', () => {
    const packed = packedFor(200, 70)
    const composed = [escposInit(), ...escposRasterFrames(packed, 200, 70), escposFeed(FEED_LINES_AFTER)]
    expect(composed.map((f) => Array.from(f))).toEqual(encodeEscPosFrames(packed, 200, 70).map((f) => Array.from(f)))
  })
  it('a two-card run has exactly one ESC @ and a gap feed between the cards', () => {
    const packed = packedFor(8, 1)
    const run = [escposInit(), ...escposRasterFrames(packed, 8, 1), escposFeed(FEED_LINES_BETWEEN_CARDS), ...escposRasterFrames(packed, 8, 1), escposFeed(FEED_LINES_AFTER)]
    const joined = new Uint8Array(run.reduce((a, f) => a + f.length, 0)); let o = 0
    for (const f of run) { joined.set(f, o); o += f.length }
    let resets = 0
    for (let i = 0; i + 1 < joined.length; i++) if (joined[i] === 0x1b && joined[i + 1] === 0x40) resets++
    expect(resets).toBe(1)
    expect(Array.from(run[2])).toEqual([0x1b, 0x64, FEED_LINES_BETWEEN_CARDS])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/core/output/escpos.test.ts`
Expected: FAIL, `escposInit is not a function` (or `FEED_LINES_BETWEEN_CARDS` has no exported member).

- [ ] **Step 3: Add the constant**

Append to `src/core/printer.ts`:

```ts
/** Lines fed between cards in a deck run (`ESC d n`) so the cards can be cut apart. Starts at FEED_LINES_AFTER's value; tuned in Task 2 of the deck-printing plan. */
export const FEED_LINES_BETWEEN_CARDS = 2
```

- [ ] **Step 4: Split the encoder**

Replace the body of `src/core/output/escpos.ts` with:

```ts
import { RASTER_BLOCK_ROWS, FEED_LINES_AFTER } from '../printer'

/** `ESC @` (initialise) then `ESC a 0` (left align). Sent once per run, never between cards: ESC @ clears the print buffer. */
export function escposInit(): Uint8Array {
  return Uint8Array.from([0x1b, 0x40, 0x1b, 0x61, 0x00])
}

/** `ESC d n`: print and feed n lines. */
export function escposFeed(lines: number): Uint8Array {
  return Uint8Array.from([0x1b, 0x64, lines & 0xff])
}

/**
 * One `GS v 0` frame per block of ≤RASTER_BLOCK_ROWS rows. A transfer may only stop between
 * frames: stopping inside a block leaves the printer waiting for image bytes and it would
 * swallow the next commands.
 */
export function escposRasterFrames(packed: Uint8Array, width: number, height: number): Uint8Array[] {
  const stride = Math.ceil(width / 8)
  if (packed.length !== stride * height) {
    throw new Error(`packed length ${packed.length} does not match ${stride} bytes x ${height} rows`)
  }
  const frames: Uint8Array[] = []
  for (let y = 0; y < height; y += RASTER_BLOCK_ROWS) {
    const rows = Math.min(RASTER_BLOCK_ROWS, height - y)
    const f = new Uint8Array(8 + rows * stride)
    f.set([0x1d, 0x76, 0x30, 0x00, stride & 0xff, stride >> 8, rows & 0xff, rows >> 8], 0)
    f.set(packed.subarray(y * stride, (y + rows) * stride), 8)
    frames.push(f)
  }
  return frames
}

/**
 * The ESC/POS stream the PT-210 printed correctly on 2026-10-14, as separate frames:
 * [ESC @ ESC a 0], one [GS v 0 header + rows] per block of ≤64 rows, then [ESC d n].
 */
export function encodeEscPosFrames(packed: Uint8Array, width: number, height: number): Uint8Array[] {
  return [escposInit(), ...escposRasterFrames(packed, width, height), escposFeed(FEED_LINES_AFTER)]
}

/** The frames of `encodeEscPosFrames` as one contiguous stream. */
export function encodeEscPosRaster(packed: Uint8Array, width: number, height: number): Uint8Array {
  const frames = encodeEscPosFrames(packed, width, height)
  const out = new Uint8Array(frames.reduce((a, f) => a + f.length, 0))
  let o = 0
  for (const f of frames) { out.set(f, o); o += f.length }
  return out
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/core/output/escpos.test.ts`
Expected: PASS, all existing and new tests (the 25,808-byte card test proves the stream is unchanged).

- [ ] **Step 6: Commit**

```bash
npm test && npm run typecheck
git add src/core/printer.ts src/core/output/escpos.ts src/core/output/escpos.test.ts
git commit -m "feat(core): split ESC/POS encoder into init, raster and feed frames; FEED_LINES_BETWEEN_CARDS"
```

---

### Task 2: Real-printer check of the run stream (manual, decides the gap)

**Files:**
- Create: `scripts/make-run-check.ts`
- Modify: `package.json` (script `check:run`)
- Modify: `.gitignore` (add `tmp/`)
- Modify: `src/core/printer.ts` (record the chosen value and date)

**Interfaces:**
- Consumes: `escposInit`, `escposRasterFrames`, `escposFeed`, `encodeEscPosFrames` from Task 1; `renderProxy`, `normalizeScryfall`, `toPacked`, `DEFAULT_SETTINGS`; `tests/nodeEnv.ts` and `tests/loadArt.ts`.
- Produces: two files under `tmp/run-check/` and a recorded decision in `src/core/printer.ts`. No app code.

Why this exists: the spec (§2.2) requires checking on the PT-210 that one `ESC @` per run leaves every card's tail intact, that the gap is cuttable, and that there is no seam. Classic Bluetooth SPP on Windows (COM4 on 2026-10-14) accepts the same bytes, so the check needs no UI.

- [ ] **Step 1: Write the script**

Create `scripts/make-run-check.ts`:

```ts
// Writes two 3-card ESC/POS streams for a manual check on the real printer.
// Usage: npm run check:run   then send each file over the printer's SPP COM port (see the printed instructions).
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
  const { bits } = renderProxy(c, g, DEFAULT_SETTINGS, nodeEnv)
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
```

- [ ] **Step 2: Wire the script and ignore its output**

In `package.json` scripts add `"check:run": "tsx scripts/make-run-check.ts"`. Append to `.gitignore`:

```
# manual printer-check streams (scripts/make-run-check.ts)
tmp/
```

- [ ] **Step 3: Generate the files**

Run: `npm run check:run`
Expected: `one-init.bin: 77414 bytes, reset-per-card.bin: 77424 bytes (gap 2 lines)` (three 25,808-byte cards; option B saves two 5-byte inits, so the sizes differ by exactly 10 bytes) and the PowerShell instructions.

- [ ] **Step 4: Print both streams on the PT-210 (human step)**

Pair the printer over classic Bluetooth if needed, find its outgoing COM port in Windows Bluetooth settings, run the two PowerShell commands from Step 3's output. Decide:
- If option B printed all three cards complete with a cuttable gap: keep `FEED_LINES_BETWEEN_CARDS = 2`.
- If the gap is too tight to cut: raise `FEED_LINES_BETWEEN_CARDS` (try 3, then 4), regenerate, reprint.
- If `ESC d` steps are too coarse: replace `escposFeed` for the gap with `ESC J n` (`[0x1b, 0x4a, n]`, feed n dots) and add `GAP_DOTS_BETWEEN_CARDS` instead; adjust the Task 1 test for the gap frame accordingly.
- If option B shows a truncated tail or a seam that option A does not: stop and report; the spec's §2.2 decision needs revisiting before Task 6.

- [ ] **Step 5: Record the decision**

Edit the comment on `FEED_LINES_BETWEEN_CARDS` in `src/core/printer.ts` to state the chosen value and the date, in the style of the neighbouring constants, for example:

```ts
/** Lines fed between cards in a deck run (`ESC d n`). 2 gave a cuttable gap with no truncated tails or seams on the real printer (2026-10-15). */
export const FEED_LINES_BETWEEN_CARDS = 2
```

- [ ] **Step 6: Commit**

```bash
npm test && npm run typecheck
git add scripts/make-run-check.ts package.json .gitignore src/core/printer.ts
git commit -m "chore: printer run-stream check script; record FEED_LINES_BETWEEN_CARDS"
```

---

### Task 3: Deck list parser

**Files:**
- Create: `src/core/deck/parse.ts`
- Create: `tests/fixtures/decks/moxfield.txt`, `tests/fixtures/decks/arena.txt`, `tests/fixtures/decks/mtgo.txt`, `tests/fixtures/decks/plain.txt`
- Test: `src/core/deck/parse.test.ts`

**Interfaces:**
- Consumes: `normalizeName(s: string): string` from `src/data/fuzzy.ts`.
- Produces:

```ts
export interface DeckEntry { line: number; count: number; name: string }
export interface ParseIssue { kind: 'bad-count'; line: number; text: string }
export interface ParsedDeck { entries: DeckEntry[]; issues: ParseIssue[]; moxfieldUrl: string | null }
export interface DistinctEntry { key: string; name: string; count: number; line: number }
export function parseDeckList(text: string): ParsedDeck
export function distinctCards(entries: DeckEntry[]): DistinctEntry[]
export function rewriteCardName(text: string, oldName: string, newName: string): string
export function lineText(text: string, line: number): string
```

- [ ] **Step 1: Create the fixtures**

`tests/fixtures/decks/moxfield.txt` (what Moxfield's Export produces, including a foil marker and a sideboard):

```
1 Magda, Brazen Outlaw (KHM) 142
21 Mountain (KHM) 390
1 Sol Ring (C21) 263 *F*
1 Lim-Dûl's Vault (CMR) 426

SIDEBOARD:
1 Enslaved Dwarf (MIR) 177
```

`tests/fixtures/decks/arena.txt`:

```
Deck
4 Lightning Bolt (STA) 42
4 Delver of Secrets (ISD) 51

Sideboard
2 Spell Pierce (XLN) 81
```

`tests/fixtures/decks/mtgo.txt`:

```
4 Lightning Bolt
20 Mountain

4 Spell Pierce
```

`tests/fixtures/decks/plain.txt`:

```
Lightning Bolt
Tarmogoyf
Nicol Bolas, the Ravager
```

- [ ] **Step 2: Write the failing tests**

Create `src/core/deck/parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseDeckList, distinctCards, rewriteCardName, lineText } from './parse'

const fixture = (n: string) => readFileSync(`tests/fixtures/decks/${n}.txt`, 'utf8')
const names = (text: string) => parseDeckList(text).entries.map((e) => `${e.count} ${e.name}`)

describe('parseDeckList', () => {
  it('reads counts with and without x, defaulting to 1', () => {
    expect(names('4 Lightning Bolt\n2x Mountain\n3X Forest\nTarmogoyf')).toEqual(['4 Lightning Bolt', '2 Mountain', '3 Forest', '1 Tarmogoyf'])
  })
  it('strips set and collector suffixes, including letters and stars', () => {
    expect(names('1 Sol Ring (C21) 263\n1 Forest (UNF) 240a\n1 Island (SLD) 1★\n1 Opt (ELD)')).toEqual(['1 Sol Ring', '1 Forest', '1 Island', '1 Opt'])
  })
  it('strips Moxfield finish markers', () => {
    expect(names('1 Sol Ring (C21) 263 *F*\n1 Opt *E*')).toEqual(['1 Sol Ring', '1 Opt'])
  })
  it('skips blank lines and comments, keeps 1-based line numbers', () => {
    const p = parseDeckList('// my deck\n\n# lands\n4 Mountain')
    expect(p.entries).toEqual([{ line: 4, count: 4, name: 'Mountain' }])
  })
  it('skips every header spelling and prints Commander cards', () => {
    const text = 'Deck\n1 A\nMainboard:\n1 B\nMain\n1 C\nCommander\n1 D\nCommanders:\n1 E\nCompanion\n1 F'
    expect(names(text)).toEqual(['1 A', '1 B', '1 C', '1 D', '1 E', '1 F'])
  })
  it('enters skip mode on Sideboard, Maybeboard, Considering and Tokens, and leaves it on Deck', () => {
    const text = '1 A\nSideboard\n1 S1\nMaybeboard\n1 M1\nDeck\n1 B\nConsidering:\n1 C1\nTokens\n1 T1\nMainboard\n1 C'
    expect(names(text)).toEqual(['1 A', '1 B', '1 C'])
  })
  it('does not treat a blank line as a sideboard separator (MTGO text prints everything)', () => {
    expect(names(fixture('mtgo'))).toEqual(['4 Lightning Bolt', '20 Mountain', '4 Spell Pierce'])
  })
  it('parses the Moxfield export without its sideboard', () => {
    const p = parseDeckList(fixture('moxfield'))
    expect(p.entries.map((e) => e.name)).toEqual(['Magda, Brazen Outlaw', 'Mountain', 'Sol Ring', "Lim-Dûl's Vault"])
    expect(p.entries[1].count).toBe(21)
  })
  it('parses the Arena export without its sideboard', () => {
    expect(names(fixture('arena'))).toEqual(['4 Lightning Bolt', '4 Delver of Secrets'])
  })
  it('parses plain names', () => {
    expect(names(fixture('plain'))).toEqual(['1 Lightning Bolt', '1 Tarmogoyf', '1 Nicol Bolas, the Ravager'])
  })
  it('keeps double-faced names whole', () => {
    expect(names('1 Delver of Secrets // Insectile Aberration')).toEqual(['1 Delver of Secrets // Insectile Aberration'])
  })
  it('reports counts of 0 or above 99 as bad-count issues and drops the entry', () => {
    const p = parseDeckList('0 Mountain\n100 Forest\n99 Island')
    expect(p.issues).toEqual([{ kind: 'bad-count', line: 1, text: '0 Mountain' }, { kind: 'bad-count', line: 2, text: '100 Forest' }])
    expect(names('0 Mountain\n100 Forest\n99 Island')).toEqual(['99 Island'])
  })
  it('detects a Moxfield URL and does not treat it as a card', () => {
    const p = parseDeckList('https://moxfield.com/decks/b4VMi7ZsdUOcDNFXxctNsQ\n1 Mountain')
    expect(p.moxfieldUrl).toBe('https://moxfield.com/decks/b4VMi7ZsdUOcDNFXxctNsQ')
    expect(p.entries.length).toBe(1)
    expect(parseDeckList('1 Mountain').moxfieldUrl).toBeNull()
  })
  it('handles Windows line endings', () => {
    const p = parseDeckList('4 Lightning Bolt\r\n2 Mountain\r\n')
    expect(p.entries).toEqual([{ line: 1, count: 4, name: 'Lightning Bolt' }, { line: 2, count: 2, name: 'Mountain' }])
  })
})

describe('distinctCards', () => {
  it('sums counts per name, folding case and accents, keeping first-appearance order and line', () => {
    const p = parseDeckList("2 Lightning Bolt\n1 Lim-Dûl's Vault\n2 lightning bolt\n1 Lim-Dul's Vault")
    expect(distinctCards(p.entries)).toEqual([
      { key: 'lightning bolt', name: 'Lightning Bolt', count: 4, line: 1 },
      { key: "lim-dul's vault", name: "Lim-Dûl's Vault", count: 2, line: 2 },
    ])
  })
})

describe('rewriteCardName', () => {
  it('replaces the name on every line that has it, keeping the count and dropping suffixes', () => {
    const text = '4 Lightnin Bolt (STA) 42\n2 Mountain\nlightnin bolt *F*'
    expect(rewriteCardName(text, 'Lightnin Bolt', 'Lightning Bolt')).toBe('4 Lightning Bolt\n2 Mountain\nLightning Bolt')
  })
  it('keeps the other lines, headers and comments byte for byte, and normalises CRLF to LF', () => {
    const text = '// note\r\nDeck\r\n1 Lightnin Bolt\r\n\r\nSideboard\r\n1 Lightnin Bolt'
    expect(rewriteCardName(text, 'Lightnin Bolt', 'Lightning Bolt')).toBe('// note\nDeck\n1 Lightning Bolt\n\nSideboard\n1 Lightnin Bolt')
  })
})

describe('lineText', () => {
  it('returns the trimmed text of a 1-based line, or "" when out of range', () => {
    expect(lineText('a\n  b  \r\nc', 2)).toBe('b')
    expect(lineText('a', 5)).toBe('')
  })
})
```

Note: the sideboard line in the second `rewriteCardName` test stays untouched because rewriting only touches lines the parser yields as entries, and skip mode excludes the sideboard.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/core/deck/parse.test.ts`
Expected: FAIL, cannot find module `./parse`.

- [ ] **Step 4: Implement the parser**

Create `src/core/deck/parse.ts`:

```ts
import { normalizeName } from '../../data/fuzzy'

export interface DeckEntry { line: number; count: number; name: string }
export interface ParseIssue { kind: 'bad-count'; line: number; text: string }
export interface ParsedDeck { entries: DeckEntry[]; issues: ParseIssue[]; moxfieldUrl: string | null }
export interface DistinctEntry { key: string; name: string; count: number; line: number }

const HEADER = /^(deck|mainboard|main|commander|commanders|companion|sideboard|maybeboard|considering|tokens):?$/i
const SKIP_HEADERS = new Set(['sideboard', 'maybeboard', 'considering', 'tokens'])
const MOXFIELD = /https?:\/\/(?:www\.)?moxfield\.com\/decks\/[A-Za-z0-9_-]+/
const COUNT = /^(\d+)\s*[xX]?\s+(\S.*)$/
const FINISH_FLAGS = /(\s+\*[A-Za-z]\*)+$/
const SET_SUFFIX = /\s+\([A-Za-z0-9]{2,6}\)(\s+[A-Za-z0-9★]+)?$/

const splitLines = (text: string) => text.split('\n').map((l) => l.replace(/\r$/, ''))

/** Count and name of a card line, or null when the line is blank, a comment, a header or a URL. */
function parseLine(raw: string): { count: number | null; name: string } | null {
  const t = raw.trim()
  if (!t || t.startsWith('//') || t.startsWith('#') || HEADER.test(t) || MOXFIELD.test(t)) return null
  const m = COUNT.exec(t)
  const count = m ? Number(m[1]) : null
  const rest = (m ? m[2] : t).replace(FINISH_FLAGS, '').replace(SET_SUFFIX, '').trim()
  return { count, name: rest }
}

export function parseDeckList(text: string): ParsedDeck {
  const entries: DeckEntry[] = []
  const issues: ParseIssue[] = []
  let moxfieldUrl: string | null = null
  let skipping = false
  splitLines(text).forEach((raw, i) => {
    const line = i + 1
    const t = raw.trim()
    const url = MOXFIELD.exec(t)
    if (url) { moxfieldUrl = url[0]; return }
    const header = HEADER.exec(t)
    if (header) { skipping = SKIP_HEADERS.has(header[1].toLowerCase()); return }
    if (skipping) return
    const parsed = parseLine(raw)
    if (!parsed) return
    const count = parsed.count ?? 1
    if (count < 1 || count > 99) { issues.push({ kind: 'bad-count', line, text: t }); return }
    entries.push({ line, count, name: parsed.name })
  })
  return { entries, issues, moxfieldUrl }
}

/** Sum counts per card, comparing names case- and accent-insensitively; first appearance wins the spelling and line. */
export function distinctCards(entries: DeckEntry[]): DistinctEntry[] {
  const out: DistinctEntry[] = []
  const byKey = new Map<string, DistinctEntry>()
  for (const e of entries) {
    const key = normalizeName(e.name)
    const hit = byKey.get(key)
    if (hit) hit.count += e.count
    else { const d = { key, name: e.name, count: e.count, line: e.line }; byKey.set(key, d); out.push(d) }
  }
  return out
}

/** Rewrite every entry line whose name matches `oldName` to `<count> <newName>` (count kept only when it was written). Normalises line endings to LF. */
export function rewriteCardName(text: string, oldName: string, newName: string): string {
  const target = normalizeName(oldName)
  const lines = splitLines(text)
  const entryLines = new Set(parseDeckList(text).entries.filter((e) => normalizeName(e.name) === target).map((e) => e.line))
  return lines.map((raw, i) => {
    if (!entryLines.has(i + 1)) return raw
    const parsed = parseLine(raw)
    return parsed?.count != null ? `${parsed.count} ${newName}` : newName
  }).join('\n')
}

/** The trimmed text of a 1-based line, "" when out of range. */
export function lineText(text: string, line: number): string {
  return (splitLines(text)[line - 1] ?? '').trim()
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/core/deck/parse.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 6: Commit**

```bash
npm test && npm run typecheck
git add src/core/deck/parse.ts src/core/deck/parse.test.ts tests/fixtures/decks
git commit -m "feat(core): deck list parser with export formats, section skipping and line rewriting"
```

---

### Task 4: Run model

**Files:**
- Create: `src/core/deck/run.ts`
- Test: `src/core/deck/run.test.ts`

**Interfaces:**
- Consumes: `CardData` from `src/core/card/types.ts`, `GreyImage` from `src/core/art/types.ts`.
- Produces:

```ts
export interface DeckCard { key: string; name: string; count: number; line: number; card: CardData; art: GreyImage | null }
export type ItemStatus = 'pending' | 'printed' | 'skipped'
export interface PrintItem { cardKey: string; copy: number; status: ItemStatus }
export interface DeckRun { cards: DeckCard[]; items: PrintItem[]; excluded: ReadonlySet<string> }
export function createRun(cards: DeckCard[]): DeckRun
export function toggleCard(run: DeckRun, key: string): DeckRun
export function nextPending(run: DeckRun): PrintItem | null
export function markPrinted(run: DeckRun, item: PrintItem): DeckRun
export function progress(run: DeckRun): { printed: number; total: number; remaining: number }
export function reset(run: DeckRun): DeckRun
```

- [ ] **Step 1: Write the failing tests**

Create `src/core/deck/run.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createRun, toggleCard, nextPending, markPrinted, progress, reset, type DeckCard } from './run'

const card = (key: string, count: number): DeckCard => ({
  key, name: key, count, line: 1, art: null,
  card: { name: key, manaCost: '', typeLine: '', oracleText: '' },
})
const statuses = (r: ReturnType<typeof createRun>) => r.items.map((i) => `${i.cardKey}${i.copy}:${i.status}`)

describe('createRun', () => {
  it('expands copies in list order, consecutively, all pending', () => {
    const r = createRun([card('bolt', 2), card('forest', 1)])
    expect(statuses(r)).toEqual(['bolt1:pending', 'bolt2:pending', 'forest1:pending'])
    expect(r.excluded.size).toBe(0)
  })
})

describe('toggleCard', () => {
  it('skips every pending copy of the card and restores them when toggled back', () => {
    const r0 = createRun([card('bolt', 2), card('forest', 1)])
    const r1 = toggleCard(r0, 'bolt')
    expect(statuses(r1)).toEqual(['bolt1:skipped', 'bolt2:skipped', 'forest1:pending'])
    expect(r1.excluded.has('bolt')).toBe(true)
    const r2 = toggleCard(r1, 'bolt')
    expect(statuses(r2)).toEqual(['bolt1:pending', 'bolt2:pending', 'forest1:pending'])
    expect(r2.excluded.has('bolt')).toBe(false)
  })
  it('never touches printed copies', () => {
    const r0 = createRun([card('bolt', 2)])
    const r1 = markPrinted(r0, r0.items[0])
    const r2 = toggleCard(r1, 'bolt')
    expect(statuses(r2)).toEqual(['bolt1:printed', 'bolt2:skipped'])
    expect(statuses(toggleCard(r2, 'bolt'))).toEqual(['bolt1:printed', 'bolt2:pending'])
  })
  it('does not mutate the input run', () => {
    const r0 = createRun([card('bolt', 1)])
    toggleCard(r0, 'bolt')
    expect(statuses(r0)).toEqual(['bolt1:pending'])
  })
})

describe('nextPending and markPrinted', () => {
  it('walks the queue in order and returns null when nothing is pending', () => {
    let r = createRun([card('bolt', 1), card('forest', 2)])
    expect(nextPending(r)).toMatchObject({ cardKey: 'bolt', copy: 1 })
    r = markPrinted(r, nextPending(r)!)
    expect(nextPending(r)).toMatchObject({ cardKey: 'forest', copy: 1 })
    r = markPrinted(r, nextPending(r)!)
    r = markPrinted(r, nextPending(r)!)
    expect(nextPending(r)).toBeNull()
  })
  it('skips excluded cards when finding the next item', () => {
    const r = toggleCard(createRun([card('bolt', 1), card('forest', 1)]), 'bolt')
    expect(nextPending(r)).toMatchObject({ cardKey: 'forest' })
  })
  it('returns null when every card is deselected', () => {
    const r = toggleCard(toggleCard(createRun([card('bolt', 1), card('forest', 1)]), 'bolt'), 'forest')
    expect(nextPending(r)).toBeNull()
    expect(progress(r)).toEqual({ printed: 0, total: 0, remaining: 0 })
  })
})

describe('progress', () => {
  it('counts pending and printed, not skipped', () => {
    let r = createRun([card('bolt', 2), card('forest', 3)])
    r = toggleCard(r, 'forest')
    r = markPrinted(r, nextPending(r)!)
    expect(progress(r)).toEqual({ printed: 1, total: 2, remaining: 1 })
  })
})

describe('reset', () => {
  it('returns printed copies to pending and keeps exclusions', () => {
    let r = createRun([card('bolt', 1), card('forest', 1)])
    r = toggleCard(r, 'forest')
    r = markPrinted(r, nextPending(r)!)
    r = reset(r)
    expect(statuses(r)).toEqual(['bolt1:pending', 'forest1:skipped'])
    expect(r.excluded.has('forest')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/core/deck/run.test.ts`
Expected: FAIL, cannot find module `./run`.

- [ ] **Step 3: Implement the run model**

Create `src/core/deck/run.ts`:

```ts
import type { CardData } from '../card/types'
import type { GreyImage } from '../art/types'

export interface DeckCard { key: string; name: string; count: number; line: number; card: CardData; art: GreyImage | null }
export type ItemStatus = 'pending' | 'printed' | 'skipped'
export interface PrintItem { cardKey: string; copy: number; status: ItemStatus }
/** Immutable print queue: one item per copy, in list order. Every function returns a new run. */
export interface DeckRun { cards: DeckCard[]; items: PrintItem[]; excluded: ReadonlySet<string> }

export function createRun(cards: DeckCard[]): DeckRun {
  const items: PrintItem[] = []
  for (const c of cards) for (let copy = 1; copy <= c.count; copy++) items.push({ cardKey: c.key, copy, status: 'pending' })
  return { cards, items, excluded: new Set() }
}

/** Exclude or re-include a card. Only pending/skipped copies change; printed copies stay printed. */
export function toggleCard(run: DeckRun, key: string): DeckRun {
  const excluded = new Set(run.excluded)
  const nowExcluded = !excluded.has(key)
  if (nowExcluded) excluded.add(key); else excluded.delete(key)
  const items = run.items.map((i) => {
    if (i.cardKey !== key || i.status === 'printed') return i
    return { ...i, status: nowExcluded ? 'skipped' as const : 'pending' as const }
  })
  return { ...run, items, excluded }
}

export function nextPending(run: DeckRun): PrintItem | null {
  return run.items.find((i) => i.status === 'pending') ?? null
}

export function markPrinted(run: DeckRun, item: PrintItem): DeckRun {
  const items = run.items.map((i) => (i.cardKey === item.cardKey && i.copy === item.copy ? { ...i, status: 'printed' as const } : i))
  return { ...run, items }
}

/** total = pending + printed; skipped copies are out of the denominator. */
export function progress(run: DeckRun): { printed: number; total: number; remaining: number } {
  let printed = 0, remaining = 0
  for (const i of run.items) { if (i.status === 'printed') printed++; else if (i.status === 'pending') remaining++ }
  return { printed, total: printed + remaining, remaining }
}

/** Start over: printed copies back to pending; exclusions kept. */
export function reset(run: DeckRun): DeckRun {
  return { ...run, items: run.items.map((i) => (i.status === 'printed' ? { ...i, status: 'pending' as const } : i)) }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/core/deck/run.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
npm test && npm run typecheck
git add src/core/deck/run.ts src/core/deck/run.test.ts
git commit -m "feat(core): immutable deck print queue with toggle, resume and progress"
```

---

### Task 5: `useDeck` hook, part 1: text, verify, issues

**Files:**
- Create: `src/app/useDeck.ts`
- Create: `tests/fakeServices.ts`
- Test: `src/app/useDeck.test.tsx`

**Interfaces:**
- Consumes: `parseDeckList`, `distinctCards`, `rewriteCardName`, `lineText` (Task 3); `createRun`, `DeckCard`, `DeckRun` (Task 4); `normalizeScryfall`; `CardNotFound`, `UnsupportedLayout`, `NetworkError` from `src/core/errors.ts`; `createMatcher` from `src/data/fuzzy.ts`; `Services`.
- Produces (the part of the hook result used by Task 7 and Task 9):

```ts
export type DeckState = 'editing' | 'verifying' | 'ready' | 'printing' | 'paused' | 'done'
export type DeckIssue =
  | { kind: 'not-found'; line: number; text: string; name: string; suggestion: string | null }
  | { kind: 'unsupported-layout'; line: number; text: string; name: string; layout: string }
  | { kind: 'bad-count'; line: number; text: string }
export const DECK_TEXT_KEY = 'hot-proxies.deck.v1'
export function useDeck(services: Services, settings: Settings): UseDeck
export interface UseDeck {
  state: DeckState
  text: string; setText(v: string): void
  parsed: ParsedDeck; distinct: DistinctEntry[]
  issues: DeckIssue[] | null; applySuggestion(issue: DeckIssue & { kind: 'not-found' }): void; applyAllSuggestions(): void; closeIssues(): void
  verifyProgress: { done: number; total: number } | null
  error: string | null; clearError(): void
  run: DeckRun | null
  verify(): Promise<void>
  // Task 6 adds: thumbs, rendering, fontWarning, current, toggleCard, print, cancel, startOver
}
```

- [ ] **Step 1: Write a reusable fake services factory**

Create `tests/fakeServices.ts`:

```ts
import { readFileSync } from 'node:fs'
import type { Services } from '../src/app/services'
import { CardNotFound } from '../src/core/errors'
import { nodeEnv } from './nodeEnv'
import { fakePrinter, type FakePrinter } from './fakePrinter'

/** Scryfall fixtures by exact name (case-insensitive, as Scryfall's ?exact= is). */
export const FIXTURE_CARDS: Record<string, string> = {
  'lightning bolt': 'bolt', 'tarmogoyf': 'tarmogoyf', 'forest': 'forest', 'nicol bolas, the ravager': 'bolas',
  'delver of secrets': 'delver', 'delver of secrets // insectile aberration': 'delver', 'smuggler\'s copter': 'copter',
}
export const FIXTURE_NAMES = ['Lightning Bolt', 'Tarmogoyf', 'Forest', 'Nicol Bolas, the Ravager', 'Delver of Secrets // Insectile Aberration', "Smuggler's Copter"]

export function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v) } }
}

export interface FakeServicesOptions {
  printer?: FakePrinter
  fetchCard?: Services['client']['fetchCard']
  loadNames?: Services['loadNames']
  storage?: Pick<Storage, 'getItem' | 'setItem'>
}

export function fakeServices(o: FakeServicesOptions = {}): Services & { printer: FakePrinter } {
  const fetchCard = o.fetchCard ?? (async (name: string) => {
    const f = FIXTURE_CARDS[name.toLowerCase()]
    if (!f) throw new CardNotFound(name)
    return JSON.parse(readFileSync(`tests/fixtures/cards/${f}.json`, 'utf8'))
  })
  return {
    client: { fetchCard, fetchArtBlob: async () => { throw new Error('no art in tests') } },
    loadNames: o.loadNames ?? (async () => FIXTURE_NAMES),
    env: nodeEnv,
    storage: o.storage ?? memoryStorage(),
    decodeArt: async () => { throw new Error('unused') },
    printer: o.printer ?? fakePrinter('connected'),
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/app/useDeck.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDeck, DECK_TEXT_KEY } from './useDeck'
import { DEFAULT_SETTINGS } from '../core/settings'
import { NetworkError } from '../core/errors'
import { fakeServices, memoryStorage } from '../../tests/fakeServices'

vi.mock('./browserEnv', async (orig) => ({ ...(await orig<object>()), ensureFonts: async () => {} }))

function hook(services = fakeServices()) {
  return renderHook(() => useDeck(services, DEFAULT_SETTINGS))
}

describe('useDeck text', () => {
  it('starts from the stored text and persists edits', () => {
    const storage = memoryStorage(); storage.map.set(DECK_TEXT_KEY, '2 Forest')
    const { result } = hook(fakeServices({ storage }))
    expect(result.current.text).toBe('2 Forest')
    expect(result.current.distinct).toEqual([{ key: 'forest', name: 'Forest', count: 2, line: 1 }])
    act(() => result.current.setText('4 Lightning Bolt'))
    expect(storage.map.get(DECK_TEXT_KEY)).toBe('4 Lightning Bolt')
    expect(result.current.state).toBe('editing')
  })
})

describe('useDeck verify', () => {
  it('resolves every distinct card and builds the run', async () => {
    const { result } = hook()
    act(() => result.current.setText('4 Lightning Bolt\n2 lightning bolt\n1 Tarmogoyf'))
    await act(() => result.current.verify())
    await waitFor(() => expect(result.current.state).toBe('ready'))
    expect(result.current.run!.cards.map((c) => [c.name, c.count])).toEqual([['Lightning Bolt', 6], ['Tarmogoyf', 1]])
    expect(result.current.run!.items.length).toBe(7)
    expect(result.current.issues).toBeNull()
    expect(result.current.verifyProgress).toBeNull()
  })
  it('lists not-found names with a suggestion, unsupported layouts and bad counts, pinned to lines, and stays editing', async () => {
    const { result } = hook()
    act(() => result.current.setText('4 Lightnin Bolt (STA) 42\n0 Forest\n1 Delver of Secrets\n1 Zzzzqqq'))
    await act(() => result.current.verify())
    expect(result.current.state).toBe('editing')
    expect(result.current.run).toBeNull()
    expect(result.current.issues).toEqual([
      { kind: 'not-found', line: 1, text: '4 Lightnin Bolt (STA) 42', name: 'Lightnin Bolt', suggestion: 'Lightning Bolt' },
      { kind: 'bad-count', line: 2, text: '0 Forest' },
      { kind: 'unsupported-layout', line: 3, text: '1 Delver of Secrets', name: 'Delver of Secrets', layout: 'transform' },
      { kind: 'not-found', line: 4, text: '1 Zzzzqqq', name: 'Zzzzqqq', suggestion: null },
    ])
  })
  it('still lists unresolved names when names.json fails to load', async () => {
    const { result } = hook(fakeServices({ loadNames: async () => { throw new Error('names.json: HTTP 404') } }))
    act(() => result.current.setText('1 Lightnin Bolt'))
    await act(() => result.current.verify())
    expect(result.current.issues).toEqual([{ kind: 'not-found', line: 1, text: '1 Lightnin Bolt', name: 'Lightnin Bolt', suggestion: null }])
  })
  it('stops on a network error with one message and no issues', async () => {
    let calls = 0
    const services = fakeServices({ fetchCard: async () => { calls++; throw new NetworkError() } })
    const { result } = hook(services)
    act(() => result.current.setText('1 Lightning Bolt\n1 Tarmogoyf'))
    await act(() => result.current.verify())
    expect(calls).toBe(1)
    expect(result.current.state).toBe('editing')
    expect(result.current.issues).toBeNull()
    expect(result.current.error).toMatch(/Could not reach Scryfall/)
    act(() => result.current.clearError())
    expect(result.current.error).toBeNull()
  })
  it('ignores text edits while verifying (the field is read-only then) and finishes the verify', async () => {
    let release!: () => void
    const base = fakeServices()
    const services = fakeServices({ fetchCard: async (n) => { await new Promise<void>((r) => { release = r }); return base.client.fetchCard(n) } })
    const { result } = hook(services)
    act(() => result.current.setText('1 Lightning Bolt'))
    const p = act(() => result.current.verify())
    await waitFor(() => expect(result.current.state).toBe('verifying'))
    act(() => result.current.setText('1 Tarmogoyf'))
    expect(result.current.text).toBe('1 Lightning Bolt')
    release(); await p
    await waitFor(() => expect(result.current.state).toBe('ready'))
    expect(result.current.run!.cards[0].name).toBe('Lightning Bolt')
  })
  it('shows verify progress and clears it at the end', async () => {
    let release!: () => void
    const base = fakeServices()
    const services = fakeServices({ fetchCard: async (n) => { await new Promise<void>((r) => { release = r }); return base.client.fetchCard(n) } })
    const { result } = hook(services)
    act(() => result.current.setText('1 Lightning Bolt'))
    const p = act(() => result.current.verify())
    await waitFor(() => expect(result.current.verifyProgress).toEqual({ done: 0, total: 1 }))
    release(); await p
    await waitFor(() => expect(result.current.verifyProgress).toBeNull())
  })
  it('ignores a second verify while one is running', async () => {
    let calls = 0
    let release!: () => void
    const base = fakeServices()
    const services = fakeServices({ fetchCard: async (n) => { calls++; await new Promise<void>((r) => { release = r }); return base.client.fetchCard(n) } })
    const { result } = hook(services)
    act(() => result.current.setText('1 Lightning Bolt'))
    const p1 = act(() => result.current.verify())
    await waitFor(() => expect(result.current.state).toBe('verifying'))
    await act(() => result.current.verify())
    release(); await p1
    expect(calls).toBe(1)
    await waitFor(() => expect(result.current.state).toBe('ready'))
  })
})

describe('useDeck suggestions', () => {
  it('applySuggestion rewrites every line with that name and removes the row; the dialog closes when none remain', async () => {
    const { result } = hook()
    act(() => result.current.setText('4 Lightnin Bolt (STA) 42\n1 Tarmogoyf\n2 lightnin bolt'))
    await act(() => result.current.verify())
    const issue = result.current.issues![0]
    expect(issue.kind).toBe('not-found')
    act(() => result.current.applySuggestion(issue as Extract<typeof issue, { kind: 'not-found' }>))
    expect(result.current.text).toBe('4 Lightning Bolt\n1 Tarmogoyf\n2 Lightning Bolt')
    expect(result.current.issues).toBeNull()
    expect(result.current.state).toBe('editing')
  })
  it('applyAllSuggestions fixes every suggested line and keeps the rows without a suggestion', async () => {
    const { result } = hook()
    act(() => result.current.setText('1 Lightnin Bolt\n1 Tarmogoyff\n1 Zzzzqqq\n0 Forest'))
    await act(() => result.current.verify())
    act(() => result.current.applyAllSuggestions())
    expect(result.current.text).toBe('1 Lightning Bolt\n1 Tarmogoyf\n1 Zzzzqqq\n0 Forest')
    expect(result.current.issues!.map((i) => i.line)).toEqual([3, 4])
  })
  it('closeIssues clears the dialog and leaves the list editing', async () => {
    const { result } = hook()
    act(() => result.current.setText('1 Zzzzqqq'))
    await act(() => result.current.verify())
    act(() => result.current.closeIssues())
    expect(result.current.issues).toBeNull()
    expect(result.current.state).toBe('editing')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/app/useDeck.test.tsx`
Expected: FAIL, cannot find module `./useDeck`.

- [ ] **Step 4: Implement the hook (verify half)**

Create `src/app/useDeck.ts`:

```ts
import { useCallback, useMemo, useRef, useState } from 'react'
import type { Services } from './services'
import type { Settings } from '../core/settings'
import { parseDeckList, distinctCards, rewriteCardName, lineText, type ParsedDeck, type DistinctEntry } from '../core/deck/parse'
import { createRun, type DeckCard, type DeckRun } from '../core/deck/run'
import { normalizeScryfall } from '../core/card/normalize'
import { CardNotFound, NetworkError, UnsupportedLayout } from '../core/errors'
import { createMatcher, type Matcher } from '../data/fuzzy'
import type { GreyImage } from '../core/art/types'

export type DeckState = 'editing' | 'verifying' | 'ready' | 'printing' | 'paused' | 'done'
export type DeckIssue =
  | { kind: 'not-found'; line: number; text: string; name: string; suggestion: string | null }
  | { kind: 'unsupported-layout'; line: number; text: string; name: string; layout: string }
  | { kind: 'bad-count'; line: number; text: string }

export const DECK_TEXT_KEY = 'hot-proxies.deck.v1'
type Store = Pick<Storage, 'getItem' | 'setItem'>
const loadText = (s: Store) => { try { return s.getItem(DECK_TEXT_KEY) ?? '' } catch { return '' } }

export function useDeck(services: Services, settings: Settings) {
  void settings   // used by the thumbnail renderer added in the next task
  const [state, setState] = useState<DeckState>('editing')
  const [text, setTextState] = useState(() => loadText(services.storage))
  const [issues, setIssues] = useState<DeckIssue[] | null>(null)
  const [verifyProgress, setVerifyProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [run, setRunState] = useState<DeckRun | null>(null)
  const runRef = useRef<DeckRun | null>(null)
  const stateRef = useRef<DeckState>('editing')
  const seq = useRef(0)

  const parsed = useMemo<ParsedDeck>(() => parseDeckList(text), [text])
  const distinct = useMemo<DistinctEntry[]>(() => distinctCards(parsed.entries), [parsed])

  const go = useCallback((s: DeckState) => { stateRef.current = s; setState(s) }, [])
  const setRun = useCallback((r: DeckRun | null) => { runRef.current = r; setRunState(r) }, [])

  /** Persist text without touching verify state (used by suggestion rewrites). */
  const commitText = useCallback((v: string) => {
    setTextState(v)
    try { services.storage.setItem(DECK_TEXT_KEY, v) } catch { /* storage full or disabled: keep in memory */ }
  }, [services.storage])

  /** Text area edits: discard any run or verify result. Ignored while verifying or printing (the field is read-only then). */
  const setText = useCallback((v: string) => {
    if (stateRef.current === 'verifying' || stateRef.current === 'printing') return
    seq.current++
    commitText(v); setRun(null); setIssues(null); setVerifyProgress(null); go('editing')
  }, [commitText, setRun, go])

  const verify = useCallback(async () => {
    if (stateRef.current === 'verifying' || stateRef.current === 'printing') return
    const my = ++seq.current
    const snapshotText = text
    go('verifying'); setError(null); setIssues(null); setRun(null)
    setVerifyProgress({ done: 0, total: distinct.length })
    const found: DeckIssue[] = parsed.issues.map((i) => ({ ...i }))
    const cards: DeckCard[] = []
    let matcher: Matcher | null | undefined
    const suggest = async (name: string): Promise<string | null> => {
      if (matcher === undefined) matcher = await services.loadNames().then((n) => createMatcher(n), () => null)
      return matcher ? matcher.search(name, 1)[0] ?? null : null
    }
    try {
      for (let i = 0; i < distinct.length; i++) {
        const d = distinct[i]
        try {
          const card = normalizeScryfall(await services.client.fetchCard(d.name))
          let art: GreyImage | null = null
          if (card.artUrl) { try { art = await services.decodeArt(await services.client.fetchArtBlob(card.artUrl)) } catch { art = null } }
          cards.push({ key: d.key, name: card.name, count: d.count, line: d.line, card, art })
        } catch (e) {
          const text = lineText(snapshotText, d.line)
          if (e instanceof CardNotFound) found.push({ kind: 'not-found', line: d.line, text, name: d.name, suggestion: await suggest(d.name) })
          else if (e instanceof UnsupportedLayout) found.push({ kind: 'unsupported-layout', line: d.line, text, name: d.name, layout: e.layout })
          else throw e
        }
        if (my !== seq.current) return
        setVerifyProgress({ done: i + 1, total: distinct.length })
      }
    } catch (e) {
      if (my !== seq.current) return
      setError(e instanceof NetworkError ? e.message : (e instanceof Error ? e.message : String(e)))
      setVerifyProgress(null); go('editing'); return
    }
    if (my !== seq.current) return
    setVerifyProgress(null)
    if (found.length) { found.sort((a, b) => a.line - b.line); setIssues(found); go('editing') }
    else { setRun(createRun(cards)); go('ready') }
  }, [text, parsed, distinct, services, go, setRun])

  const applySuggestion = useCallback((issue: Extract<DeckIssue, { kind: 'not-found' }>) => {
    if (!issue.suggestion) return
    commitText(rewriteCardName(text, issue.name, issue.suggestion))
    setIssues((prev) => { const rest = (prev ?? []).filter((i) => i.line !== issue.line); return rest.length ? rest : null })
  }, [text, commitText])

  const applyAllSuggestions = useCallback(() => {
    let next = text
    const fixed = new Set<number>()
    for (const i of issues ?? []) if (i.kind === 'not-found' && i.suggestion) { next = rewriteCardName(next, i.name, i.suggestion); fixed.add(i.line) }
    commitText(next)
    setIssues((prev) => { const rest = (prev ?? []).filter((i) => !fixed.has(i.line)); return rest.length ? rest : null })
  }, [text, issues, commitText])

  const closeIssues = useCallback(() => setIssues(null), [])
  const clearError = useCallback(() => setError(null), [])

  return { state, text, setText, parsed, distinct, issues, applySuggestion, applyAllSuggestions, closeIssues, verifyProgress, error, clearError, run, verify }
}

export type UseDeck = ReturnType<typeof useDeck>
```

Note on `fetchCard` case: `FIXTURE_CARDS` in the fake is keyed lower-case so `lightning bolt` resolves like Scryfall's `?exact=`, which is case-insensitive.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/useDeck.test.tsx`
Expected: PASS (10 tests). If the "reports progress" test is flaky on `seen`, drop the `seen` capture lines; the asserted outcome is the `ready` state with 7 items.

- [ ] **Step 6: Commit**

```bash
npm test && npm run typecheck
git add src/app/useDeck.ts src/app/useDeck.test.tsx tests/fakeServices.ts
git commit -m "feat(app): useDeck verify: resolve names through Scryfall, issues with suggestions"
```

---

### Task 6: `useDeck` hook, part 2: thumbnails and the print loop

**Files:**
- Modify: `src/app/useDeck.ts`
- Test: `src/app/useDeck.test.tsx` (append)

**Interfaces:**
- Consumes: `renderProxy`, `ensureFonts` (from `./browserEnv`), `toPacked`, `escposInit`/`escposRasterFrames`/`escposFeed` (Task 1), `FEED_LINES_AFTER`/`FEED_LINES_BETWEEN_CARDS`, `printJob`, `PRINTER_MESSAGES` from `./usePrinter`, `toggleCard`/`nextPending`/`markPrinted`/`progress`/`reset` (Task 4).
- Produces, added to `UseDeck`:

```ts
thumbs: Map<string, DeckThumb>            // key -> { bits, overflow, artMissing }
rendering: boolean                        // true while thumbnails are being (re)rendered
fontWarning: string | null
current: { item: PrintItem; fraction: number } | null
toggleCard(key: string): void
print(): Promise<void>
cancel(): void
startOver(): void
export interface DeckThumb { bits: BitImage; overflow: boolean; artMissing: boolean }
```

- [ ] **Step 1: Write the failing tests**

Append to `src/app/useDeck.test.tsx` (add `import { fakePrinter } from '../../tests/fakePrinter'` and `import { encodeEscPosFrames } from '../core/output/escpos'`, `import { toPacked } from '../core/output/packed'`):

```tsx
async function verified(text: string, services = fakeServices()) {
  const r = hook(services)
  act(() => r.result.current.setText(text))
  await act(() => r.result.current.verify())
  await waitFor(() => expect(r.result.current.state).toBe('ready'))
  await waitFor(() => expect(r.result.current.rendering).toBe(false))
  return r
}
const totalBytes = (p: ReturnType<typeof fakePrinter>) => p.writes.reduce((a, w) => a + w.length, 0)
const countResets = (p: ReturnType<typeof fakePrinter>) => p.writes.filter((w) => w.length === 5 && w[0] === 0x1b && w[1] === 0x40).length

describe('useDeck thumbnails', () => {
  it('renders one thumbnail per distinct card from the same bits that print, flagging missing art', async () => {
    const { result } = await verified('2 Lightning Bolt\n1 Forest')
    expect([...result.current.thumbs.keys()]).toEqual(['lightning bolt', 'forest'])
    const t = result.current.thumbs.get('lightning bolt')!
    expect(t.bits.width).toBe(384); expect(t.bits.height).toBe(536)
    expect(t.artMissing).toBe(true)    // bolt has art_crop but the fake art fetch fails
    expect(result.current.thumbs.get('forest')!.artMissing).toBe(true)
  })
  it('re-renders on a settings change without resetting statuses', async () => {
    const services = fakeServices()
    const { result, rerender } = renderHook(({ s }) => useDeck(services, s), { initialProps: { s: DEFAULT_SETTINGS } })
    act(() => result.current.setText('2 Lightning Bolt'))
    await act(() => result.current.verify())
    await waitFor(() => expect(result.current.rendering).toBe(false))
    const before = result.current.thumbs.get('lightning bolt')!.bits
    await act(() => result.current.print())
    expect(result.current.state).toBe('done')
    rerender({ s: { ...DEFAULT_SETTINGS, textSize: DEFAULT_SETTINGS.textSize - 4 } })
    await waitFor(() => expect(result.current.thumbs.get('lightning bolt')!.bits).not.toBe(before))
    expect(result.current.run!.items.every((i) => i.status === 'printed')).toBe(true)
  })
})

describe('useDeck print', () => {
  it('prints every pending copy in order with one init, gap feeds between cards and the tail feed last', async () => {
    const printer = fakePrinter('connected')
    const { result } = await verified('2 Lightning Bolt\n1 Forest', fakeServices({ printer }))
    await act(() => result.current.print())
    expect(result.current.state).toBe('done')
    expect(countResets(printer)).toBe(1)
    const single = encodeEscPosFrames(toPacked(result.current.thumbs.get('forest')!.bits), 384, 536).reduce((a, f) => a + f.length, 0)
    // 3 cards: one init (5) + 3 × (raster 25800 + feed 3)
    expect(totalBytes(printer)).toBe(5 + 3 * (single - 5))
    const feeds = printer.writes.filter((w) => w.length === 3 && w[0] === 0x1b && w[1] === 0x64).map((w) => w[2])
    expect(feeds.length).toBe(3)
    expect(feeds[2]).toBe(2)   // FEED_LINES_AFTER on the last card
    expect(result.current.run!.items.map((i) => i.status)).toEqual(['printed', 'printed', 'printed'])
  })
  it('skips deselected cards and disables printing when nothing is selected', async () => {
    const printer = fakePrinter('connected')
    const { result } = await verified('1 Lightning Bolt\n1 Forest', fakeServices({ printer }))
    act(() => result.current.toggleCard('lightning bolt'))
    await act(() => result.current.print())
    expect(result.current.run!.items.map((i) => i.status)).toEqual(['skipped', 'printed'])
    act(() => result.current.startOver())
    act(() => result.current.toggleCard('forest'))
    const before = printer.writes.length
    await act(() => result.current.print())
    expect(printer.writes.length).toBe(before)
    expect(result.current.state).toBe('ready')
  })
  it('ignores a second print() while printing', async () => {
    const printer = fakePrinter('connected')
    let release!: () => void; let gated = true
    const origWrite = printer.write.bind(printer)
    printer.write = async (b) => { if (gated) { gated = false; await new Promise<void>((r) => { release = r }) } await origWrite(b) }
    const { result } = await verified('1 Lightning Bolt', fakeServices({ printer }))
    const p1 = act(() => result.current.print())
    await waitFor(() => expect(result.current.state).toBe('printing'))
    await act(() => result.current.print())
    release(); await p1
    expect(result.current.state).toBe('done')
    expect(countResets(printer)).toBe(1)
  })
  it('cancel pauses after the current card, leaves it pending, and resume reprints it with a new init', async () => {
    const printer = fakePrinter('connected')
    const { result } = await verified('3 Lightning Bolt', fakeServices({ printer }))
    let seenFirstChunk = false
    const origWrite = printer.write.bind(printer)
    printer.write = async (b) => { await origWrite(b); if (!seenFirstChunk && b.length === 100) { seenFirstChunk = true; result.current.cancel() } }
    await act(() => result.current.print())
    expect(result.current.state).toBe('paused')
    expect(result.current.run!.items.map((i) => i.status)).toEqual(['pending', 'pending', 'pending'])
    expect(result.current.error).toBeNull()
    // frames after the init: first raster block, then the feed that clears the head
    expect(printer.writes.slice(-1)[0].length).toBe(3)
    printer.write = origWrite
    await act(() => result.current.print())
    expect(result.current.state).toBe('done')
    expect(countResets(printer)).toBe(2)
  })
  it('a dropped connection pauses with the message, the card stays pending, and resume continues after reconnecting', async () => {
    const printer = fakePrinter('connected')
    const { result } = await verified('1 Lightning Bolt\n1 Forest', fakeServices({ printer }))
    const origWrite = printer.write.bind(printer)
    let n = 0
    printer.write = async (b) => { if (++n === 3) { printer.set('disconnected'); throw new Error('gatt gone') } await origWrite(b) }
    await act(() => result.current.print())
    expect(result.current.state).toBe('paused')
    expect(result.current.error).toBe('Printer disconnected during printing. Reconnect and print again.')
    expect(result.current.run!.items.map((i) => i.status)).toEqual(['pending', 'pending'])
    printer.write = origWrite; printer.set('connected')
    await act(() => result.current.print())
    expect(result.current.state).toBe('done')
    expect(result.current.run!.items.map((i) => i.status)).toEqual(['printed', 'printed'])
  })
  it('does nothing when the printer is not connected', async () => {
    const printer = fakePrinter('disconnected')
    const { result } = await verified('1 Lightning Bolt', fakeServices({ printer }))
    await act(() => result.current.print())
    expect(result.current.state).toBe('ready')
    expect(printer.writes.length).toBe(0)
  })
  it('startOver returns to ready with everything pending', async () => {
    const { result } = await verified('1 Lightning Bolt')
    await act(() => result.current.print())
    expect(result.current.state).toBe('done')
    act(() => result.current.startOver())
    expect(result.current.state).toBe('ready')
    expect(result.current.run!.items[0].status).toBe('pending')
  })
  it('toggleCard is ignored while printing', async () => {
    const printer = fakePrinter('connected')
    let release!: () => void; let gated = true
    const origWrite = printer.write.bind(printer)
    printer.write = async (b) => { if (gated) { gated = false; await new Promise<void>((r) => { release = r }) } await origWrite(b) }
    const { result } = await verified('1 Lightning Bolt\n1 Forest', fakeServices({ printer }))
    const p = act(() => result.current.print())
    await waitFor(() => expect(result.current.state).toBe('printing'))
    act(() => result.current.toggleCard('forest'))
    expect(result.current.run!.excluded.has('forest')).toBe(false)
    release(); await p
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/useDeck.test.tsx`
Expected: FAIL, `result.current.rendering` is undefined / `print is not a function`.

- [ ] **Step 3: Add thumbnails and printing to the hook**

In `src/app/useDeck.ts`, replace `void settings` and extend the hook. Add imports:

```ts
import { useEffect } from 'react'   // merge into the existing react import
import type { BitImage } from '../core/art/types'
import type { PrintItem } from '../core/deck/run'
import { toggleCard as toggleRun, nextPending, markPrinted, progress, reset } from '../core/deck/run'
import { renderProxy } from '../core/render/renderProxy'
import { ensureFonts } from './browserEnv'
import { toPacked } from '../core/output/packed'
import { escposInit, escposRasterFrames, escposFeed } from '../core/output/escpos'
import { FEED_LINES_AFTER, FEED_LINES_BETWEEN_CARDS } from '../core/printer'
import { printJob } from '../core/printer/transport'
import { PRINTER_MESSAGES } from './usePrinter'

export interface DeckThumb { bits: BitImage; overflow: boolean; artMissing: boolean }
```

Add state inside the hook, after `seq`:

```ts
  const [thumbs, setThumbs] = useState<Map<string, DeckThumb>>(new Map())
  const [rendering, setRendering] = useState(false)
  const [fontWarning, setFontWarning] = useState<string | null>(null)
  const [current, setCurrent] = useState<{ item: PrintItem; fraction: number } | null>(null)
  const thumbsRef = useRef<Map<string, DeckThumb>>(new Map())
  const packedRef = useRef<Map<string, Uint8Array>>(new Map())
  const abort = useRef<AbortController | null>(null)
```

Make `setText` also clear thumbnails: add `setThumbs(new Map()); thumbsRef.current = new Map(); packedRef.current = new Map()` to its body (before `go('editing')`), and the same two ref resets plus `setThumbs(new Map())` at the start of `verify` after `setRun(null)`.

Add the thumbnail effect after `setRun` is defined:

```ts
  // Render one BitImage per distinct card whenever the cards or settings change. Statuses are untouched.
  const cards = run?.cards ?? null
  useEffect(() => {
    if (!cards) return
    let on = true
    setRendering(true)
    const draw = async (fontError: Error | null) => {
      const next = new Map<string, DeckThumb>()
      for (let i = 0; i < cards.length; i++) {
        if (!on) return
        const c = cards[i]
        const r = renderProxy(c.card, c.art, settings, services.env)
        next.set(c.key, { bits: r.bits, overflow: r.geometry.overflow, artMissing: !!c.card.artUrl && !c.art })
        if (i % 4 === 3) await new Promise<void>((res) => setTimeout(res, 0))   // keep the UI responsive
      }
      if (!on) return
      thumbsRef.current = next; packedRef.current = new Map()
      setThumbs(next); setFontWarning(fontError ? fontError.message : null); setRendering(false)
    }
    ensureFonts(settings.fontFamily).then(
      () => draw(null),
      () => draw(new Error(`Font ${settings.fontFamily} could not be loaded; rendering with a fallback font.`)),
    )
    return () => { on = false }
  }, [cards, settings, services.env])
```

Add the actions before the `return`:

```ts
  const toggleCard = useCallback((key: string) => {
    if (stateRef.current === 'printing' || !runRef.current) return
    setRun(toggleRun(runRef.current, key))
  }, [setRun])

  const startOver = useCallback(() => {
    if (stateRef.current === 'printing' || !runRef.current) return
    setRun(reset(runRef.current)); setError(null); go('ready')
  }, [setRun, go])

  const packedFor = (key: string): Uint8Array => {
    let p = packedRef.current.get(key)
    if (!p) { p = toPacked(thumbsRef.current.get(key)!.bits); packedRef.current.set(key, p) }
    return p
  }

  /** Print every pending item, in order. Each call (first start or resume) begins with ESC @. */
  const print = useCallback(async () => {
    const printer = services.printer
    const s = stateRef.current
    if ((s !== 'ready' && s !== 'paused') || !runRef.current || printer.state !== 'connected') return
    if (!nextPending(runRef.current) || thumbsRef.current.size !== runRef.current.cards.length) return
    go('printing'); setError(null)
    const ac = new AbortController(); abort.current = ac
    let first = true
    try {
      for (;;) {
        const run = runRef.current!
        const item = nextPending(run)
        if (!item) break
        const bits = thumbsRef.current.get(item.cardKey)!.bits
        const last = progress(run).remaining === 1
        const frames = [
          ...(first ? [escposInit()] : []),
          ...escposRasterFrames(packedFor(item.cardKey), bits.width, bits.height),
          escposFeed(last ? FEED_LINES_AFTER : FEED_LINES_BETWEEN_CARDS),
        ]
        first = false
        setCurrent({ item, fraction: 0 })
        await printJob(printer, frames, { signal: ac.signal, onProgress: (sent, total) => setCurrent({ item, fraction: total ? sent / total : 0 }) })
        setRun(markPrinted(runRef.current!, item))
      }
      go('done')
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setError(printer.state === 'disconnected' ? PRINTER_MESSAGES.dropped : (e instanceof Error ? e.message : String(e)))
      }
      go('paused')
    } finally {
      abort.current = null; setCurrent(null)
    }
  }, [services.printer, go, setRun])

  const cancel = useCallback(() => { abort.current?.abort() }, [])
```

Extend the returned object with `thumbs, rendering, fontWarning, current, toggleCard, print, cancel, startOver`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/useDeck.test.tsx`
Expected: PASS (20 tests). The cancel test relies on `printJob`'s frame contract: after abort it finishes the current frame, sends the final frame (the feed) and throws `AbortError`, so the last write is 3 bytes.

- [ ] **Step 5: Commit**

```bash
npm test && npm run typecheck
git add src/app/useDeck.ts src/app/useDeck.test.tsx
git commit -m "feat(app): useDeck thumbnails and resumable print loop with one init per run"
```

---

### Task 7: Issues dialog

**Files:**
- Create: `src/app/DeckIssuesDialog.tsx`
- Test: `src/app/DeckIssuesDialog.test.tsx`

**Interfaces:**
- Consumes: `DeckIssue` from `./useDeck`.
- Produces:

```ts
export interface DeckIssuesDialogProps {
  issues: DeckIssue[] | null
  onApply(issue: Extract<DeckIssue, { kind: 'not-found' }>): void
  onApplyAll(): void
  onClose(): void
}
export function DeckIssuesDialog(props: DeckIssuesDialogProps): JSX.Element
export function issueReason(issue: DeckIssue): string
```

- [ ] **Step 1: Write the failing tests**

Create `src/app/DeckIssuesDialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeckIssuesDialog, issueReason } from './DeckIssuesDialog'
import type { DeckIssue } from './useDeck'

const issues: DeckIssue[] = [
  { kind: 'not-found', line: 1, text: '4 Lightnin Bolt (STA) 42', name: 'Lightnin Bolt', suggestion: 'Lightning Bolt' },
  { kind: 'bad-count', line: 2, text: '0 Forest' },
  { kind: 'unsupported-layout', line: 3, text: '1 Delver of Secrets', name: 'Delver of Secrets', layout: 'transform' },
  { kind: 'not-found', line: 4, text: '1 Zzzzqqq', name: 'Zzzzqqq', suggestion: null },
]

describe('issueReason', () => {
  it('words each kind', () => {
    expect(issueReason(issues[0])).toBe('Not found')
    expect(issueReason(issues[1])).toBe('Count must be 1 to 99')
    expect(issueReason(issues[2])).toBe("Layout 'transform' is not supported")
  })
})

describe('DeckIssuesDialog', () => {
  it('renders nothing when there are no issues', () => {
    render(<DeckIssuesDialog issues={null} onApply={() => {}} onApplyAll={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('lists each issue with line, text and reason, and a suggestion button where available', () => {
    render(<DeckIssuesDialog issues={issues} onApply={() => {}} onApplyAll={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: '4 cards could not be resolved' })).toBeInTheDocument()
    expect(screen.getByText('Line 1')).toBeInTheDocument()
    expect(screen.getByText('4 Lightnin Bolt (STA) 42')).toBeInTheDocument()
    expect(screen.getAllByText('Not found').length).toBe(2)
    expect(screen.getByText("Layout 'transform' is not supported")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lightning Bolt' })).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Lightning Bolt', 'Fix all', 'Close'])
  })
  it('uses the singular title for one issue and hides Fix all when nothing can be fixed', () => {
    render(<DeckIssuesDialog issues={[issues[3]]} onApply={() => {}} onApplyAll={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: '1 card could not be resolved' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fix all' })).toBeNull()
  })
  it('wires the buttons', async () => {
    const onApply = vi.fn(), onApplyAll = vi.fn(), onClose = vi.fn()
    render(<DeckIssuesDialog issues={issues} onApply={onApply} onApplyAll={onApplyAll} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Lightning Bolt' }))
    expect(onApply).toHaveBeenCalledWith(issues[0])
    await userEvent.click(screen.getByRole('button', { name: 'Fix all' }))
    expect(onApplyAll).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/DeckIssuesDialog.test.tsx`
Expected: FAIL, cannot find module `./DeckIssuesDialog`.

- [ ] **Step 3: Implement the dialog**

Create `src/app/DeckIssuesDialog.tsx`:

```tsx
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { DeckIssue } from './useDeck'

type NotFound = Extract<DeckIssue, { kind: 'not-found' }>

export interface DeckIssuesDialogProps {
  issues: DeckIssue[] | null
  onApply(issue: NotFound): void
  onApplyAll(): void
  onClose(): void
}

export function issueReason(issue: DeckIssue): string {
  switch (issue.kind) {
    case 'not-found': return 'Not found'
    case 'unsupported-layout': return `Layout '${issue.layout}' is not supported`
    case 'bad-count': return 'Count must be 1 to 99'
  }
}

/** Lists the lines Verify could not resolve. Closing leaves the list unverified; the user must press Verify again. */
export function DeckIssuesDialog({ issues, onApply, onApplyAll, onClose }: DeckIssuesDialogProps) {
  const open = !!issues && issues.length > 0
  const list = issues ?? []
  const fixable = list.some((i) => i.kind === 'not-found' && i.suggestion)
  const title = `${list.length} ${list.length === 1 ? 'card' : 'cards'} could not be resolved`
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby="deck-issues-title" fullWidth maxWidth="sm">
      <DialogTitle id="deck-issues-title">{title}</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <List dense disablePadding>
          {list.map((issue) => (
            <ListItem key={issue.line} divider sx={{ alignItems: 'flex-start', gap: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ minWidth: 48, pt: 0.5 }}>{`Line ${issue.line}`}</Typography>
              <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography sx={{ fontFamily: 'monospace', fontSize: 14, overflowWrap: 'anywhere' }}>{issue.text}</Typography>
                <Typography variant="body2" color="text.secondary">{issueReason(issue)}</Typography>
              </Stack>
              {issue.kind === 'not-found' && issue.suggestion && (
                <Button size="small" variant="outlined" onClick={() => onApply(issue)} sx={{ flexShrink: 0, alignSelf: 'center' }}>{issue.suggestion}</Button>
              )}
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        {fixable && <Button onClick={onApplyAll}>Fix all</Button>}
        <Button onClick={onClose} variant="contained">Close</Button>
      </DialogActions>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/DeckIssuesDialog.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
npm test && npm run typecheck
git add src/app/DeckIssuesDialog.tsx src/app/DeckIssuesDialog.test.tsx
git commit -m "feat(app): DeckIssuesDialog with per-line reasons and suggestion buttons"
```

---

### Task 8: Thumbnail strip

**Files:**
- Create: `src/app/DeckStrip.tsx`
- Test: `src/app/DeckStrip.test.tsx`

**Interfaces:**
- Consumes: `DeckCard` (Task 4), `DeckThumb` (Task 6), `bitImageToImageData` from `src/core/output/packed.ts`, `RULE` from `./theme`.
- Produces:

```ts
export interface DeckStripProps {
  cards: DeckCard[]
  thumbs: Map<string, DeckThumb>
  excluded: ReadonlySet<string>
  currentKey: string | null
  disabled: boolean
  onToggle(key: string): void
  onOpen(key: string): void
}
export function DeckStrip(props: DeckStripProps): JSX.Element
```

- [ ] **Step 1: Write the failing tests**

Create `src/app/DeckStrip.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeckStrip } from './DeckStrip'
import type { DeckCard } from '../core/deck/run'
import type { DeckThumb } from './useDeck'

const card = (key: string, name: string, count: number): DeckCard => ({ key, name, count, line: 1, art: null, card: { name, manaCost: '', typeLine: '', oracleText: '' } })
const thumb = (overflow = false, artMissing = false): DeckThumb => ({ bits: { width: 8, height: 8, bits: new Uint8Array(64) }, overflow, artMissing })
const cards = [card('bolt', 'Lightning Bolt', 4), card('forest', 'Forest', 20)]
const thumbs = new Map([['bolt', thumb()], ['forest', thumb(true, true)]])

describe('DeckStrip', () => {
  it('shows one thumbnail per card with its count badge and a checkbox', () => {
    render(<DeckStrip cards={cards} thumbs={thumbs} excluded={new Set()} currentKey={null} disabled={false} onToggle={() => {}} onOpen={() => {}} />)
    expect(screen.getByRole('checkbox', { name: 'Include Lightning Bolt' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Include Forest' })).toBeChecked()
    expect(screen.getByText('×4')).toBeInTheDocument()
    expect(screen.getByText('×20')).toBeInTheDocument()
  })
  it('marks excluded cards unchecked and flags clipped text or missing art', () => {
    render(<DeckStrip cards={cards} thumbs={thumbs} excluded={new Set(['forest'])} currentKey={null} disabled={false} onToggle={() => {}} onOpen={() => {}} />)
    expect(screen.getByRole('checkbox', { name: 'Include Forest' })).not.toBeChecked()
    expect(screen.getByLabelText('Rules text clipped; art missing')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Lightning Bolt.*clipped/)).toBeNull()
  })
  it('toggles and opens', async () => {
    const onToggle = vi.fn(), onOpen = vi.fn()
    render(<DeckStrip cards={cards} thumbs={thumbs} excluded={new Set()} currentKey={null} disabled={false} onToggle={onToggle} onOpen={onOpen} />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include Forest' }))
    expect(onToggle).toHaveBeenCalledWith('forest')
    await userEvent.click(screen.getByRole('button', { name: 'Preview Lightning Bolt' }))
    expect(onOpen).toHaveBeenCalledWith('bolt')
  })
  it('disables the checkboxes while printing and highlights the current card', () => {
    render(<DeckStrip cards={cards} thumbs={thumbs} excluded={new Set()} currentKey="forest" disabled onToggle={() => {}} onOpen={() => {}} />)
    expect(screen.getByRole('checkbox', { name: 'Include Forest' })).toBeDisabled()
    expect(screen.getByTestId('deck-thumb-forest')).toHaveAttribute('data-current', 'true')
    expect(screen.getByTestId('deck-thumb-bolt')).toHaveAttribute('data-current', 'false')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/DeckStrip.test.tsx`
Expected: FAIL, cannot find module `./DeckStrip`.

- [ ] **Step 3: Implement the strip**

Create `src/app/DeckStrip.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import type { BitImage } from '../core/art/types'
import type { DeckCard } from '../core/deck/run'
import type { DeckThumb } from './useDeck'
import { bitImageToImageData } from '../core/output/packed'
import { INK, RULE } from './theme'

export interface DeckStripProps {
  cards: DeckCard[]
  thumbs: Map<string, DeckThumb>
  excluded: ReadonlySet<string>
  currentKey: string | null
  disabled: boolean
  onToggle(key: string): void
  onOpen(key: string): void
}

const THUMB_W = 96   // CSS px; the 63:88 card ratio gives 134 px tall

function Thumb({ bits }: { bits: BitImage }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current; if (!c) return
    c.width = bits.width; c.height = bits.height
    const ctx = c.getContext?.('2d')
    if (!ctx || typeof ImageData === 'undefined') return   // jsdom has no canvas
    const id = bitImageToImageData(bits)
    ctx.putImageData(new ImageData(id.data as Uint8ClampedArray<ArrayBuffer>, id.width, id.height), 0, 0)
  }, [bits])
  return <Box component="canvas" ref={ref} sx={{ width: THUMB_W, height: 'auto', display: 'block', imageRendering: 'pixelated', background: '#fff' }} />
}

function warningText(t: DeckThumb): string | null {
  const parts = [t.overflow ? 'Rules text clipped' : null, t.artMissing ? 'art missing' : null].filter((p): p is string => !!p)
  return parts.length ? parts.join('; ') : null
}

/** One thumbnail per distinct card, drawn from the bits that will print. */
export function DeckStrip({ cards, thumbs, excluded, currentKey, disabled, onToggle, onOpen }: DeckStripProps) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ overflowX: 'auto', pb: 1, px: 0.5 }} data-testid="deck-strip">
      {cards.map((c) => {
        const t = thumbs.get(c.key)
        const off = excluded.has(c.key)
        const current = currentKey === c.key
        const warn = t ? warningText(t) : null
        return (
          <Stack key={c.key} spacing={0.5} data-testid={`deck-thumb-${c.key}`} data-current={current ? 'true' : 'false'}
            sx={{ flex: '0 0 auto', width: THUMB_W, opacity: off ? 0.4 : 1, alignItems: 'center' }}>
            <Box sx={{ position: 'relative', border: `${current ? 2 : 1}px solid ${current ? INK : RULE}`, borderRadius: 1, overflow: 'hidden', width: THUMB_W }}>
              <ButtonBase aria-label={`Preview ${c.name}`} onClick={() => onOpen(c.key)} sx={{ display: 'block' }}>
                {t ? <Thumb bits={t.bits} /> : <Box sx={{ width: THUMB_W, height: Math.round((THUMB_W * 88) / 63), bgcolor: 'action.hover' }} />}
              </ButtonBase>
              <Chip label={`×${c.count}`} size="small" sx={{ position: 'absolute', top: 4, right: 4, bgcolor: INK, color: '#fff', height: 20 }} />
              {warn && (
                <Tooltip title={warn}>
                  <WarningAmberIcon aria-label={warn} color="warning" fontSize="small" sx={{ position: 'absolute', bottom: 4, right: 4, bgcolor: '#fff', borderRadius: '50%' }} />
                </Tooltip>
              )}
              <Checkbox size="small" checked={!off} disabled={disabled} onChange={() => onToggle(c.key)}
                slotProps={{ input: { 'aria-label': `Include ${c.name}` } }} sx={{ position: 'absolute', top: 0, left: 0, bgcolor: 'rgba(255,255,255,0.85)', p: 0.25 }} />
            </Box>
            <Typography variant="caption" noWrap sx={{ width: '100%', textAlign: 'center' }} title={c.name}>{c.name}</Typography>
          </Stack>
        )
      })}
    </Stack>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/DeckStrip.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
npm test && npm run typecheck
git add src/app/DeckStrip.tsx src/app/DeckStrip.test.tsx
git commit -m "feat(app): DeckStrip thumbnails with count badges, checkboxes and warnings"
```

---

### Task 9: Deck panel

**Files:**
- Create: `src/app/DeckPanel.tsx`
- Test: `src/app/DeckPanel.test.tsx`

**Interfaces:**
- Consumes: `UseDeck` (Tasks 5 and 6), `DeckStrip` (Task 8), `DeckIssuesDialog` (Task 7), `Preview` from `./Preview`, `PrinterState`, `Settings`, `progress` (Task 4).
- Produces:

```ts
export interface DeckPanelProps { deck: UseDeck; printerState: PrinterState; settings: Settings }
export function DeckPanel(props: DeckPanelProps): JSX.Element
export const MOXFIELD_HINT: string
```

- [ ] **Step 1: Write the failing tests**

Create `src/app/DeckPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeckPanel, MOXFIELD_HINT } from './DeckPanel'
import { useDeck } from './useDeck'
import { DEFAULT_SETTINGS } from '../core/settings'
import type { Services } from './services'
import type { PrinterState } from '../core/printer/transport'
import { fakeServices } from '../../tests/fakeServices'
import { fakePrinter } from '../../tests/fakePrinter'

vi.mock('./browserEnv', async (orig) => ({ ...(await orig<object>()), ensureFonts: async () => {} }))

function Harness({ services, printerState }: { services: Services; printerState: PrinterState }) {
  const deck = useDeck(services, DEFAULT_SETTINGS)
  return <DeckPanel deck={deck} printerState={printerState} settings={DEFAULT_SETTINGS} />
}
const setup = (services = fakeServices(), printerState: PrinterState = 'connected') => render(<Harness services={services} printerState={printerState} />)
const textbox = () => screen.getByRole('textbox', { name: 'Deck list' })

describe('DeckPanel editing', () => {
  it('shows the live summary and enables Verify once there are entries', async () => {
    setup()
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled()
    await userEvent.type(textbox(), '4 Lightning Bolt{enter}2 lightning bolt{enter}1 Forest')
    expect(screen.getByText('7 cards, 2 distinct')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verify' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^Print/ })).toBeNull()
  })
  it('counts parser problems in the summary', async () => {
    setup()
    await userEvent.type(textbox(), '0 Forest{enter}1 Lightning Bolt')
    expect(screen.getByText('1 card, 1 distinct')).toBeInTheDocument()
    expect(screen.getByText('1 line has problems')).toBeInTheDocument()
  })
  it('shows the Moxfield hint when a deck URL is pasted', async () => {
    setup()
    await userEvent.type(textbox(), 'https://moxfield.com/decks/b4VMi7ZsdUOcDNFXxctNsQ')
    expect(screen.getByText(MOXFIELD_HINT)).toBeInTheDocument()
  })
})

describe('DeckPanel verify', () => {
  it('opens the issues dialog on failure and Fix all rewrites the text', async () => {
    setup()
    await userEvent.type(textbox(), '4 Lightnin Bolt')
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: '1 card could not be resolved' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Fix all' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(textbox()).toHaveValue('4 Lightning Bolt')
  })
  it('moves to ready with the strip, the ready summary and the Print button', async () => {
    setup()
    await userEvent.type(textbox(), '4 Lightning Bolt{enter}1 Forest')
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(screen.getByText('5 cards ready, 2 distinct')).toBeInTheDocument())
    expect(screen.getByTestId('deck-strip')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Print 5 cards' })).toBeEnabled())
    expect(textbox()).not.toHaveAttribute('readonly')
  })
  it('shows Checking progress and a read-only text area while verifying', async () => {
    let release!: () => void
    const base = fakeServices()
    const services = fakeServices({ fetchCard: async (n) => { await new Promise<void>((r) => { release = r }); return base.client.fetchCard(n) } })
    setup(services)
    await userEvent.type(textbox(), '1 Lightning Bolt')
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(screen.getByText('Checking 0 of 1')).toBeInTheDocument())
    expect(textbox()).toHaveAttribute('readonly')
    release()
    await waitFor(() => expect(screen.getByText('1 card ready, 1 distinct')).toBeInTheDocument())
  })
  it('shows a network error alert', async () => {
    const services = fakeServices({ fetchCard: async () => { throw new (await import('../core/errors')).NetworkError() } })
    setup(services)
    await userEvent.type(textbox(), '1 Lightning Bolt')
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(screen.getByText(/Could not reach Scryfall/)).toBeInTheDocument())
  })
})

describe('DeckPanel selection and printing', () => {
  async function ready(services = fakeServices(), printerState: PrinterState = 'connected', text = '2 Lightning Bolt{enter}1 Forest') {
    setup(services, printerState)
    await userEvent.type(textbox(), text)
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(screen.getByTestId('deck-strip')).toBeInTheDocument())
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())
  }
  it('updates the summary when cards are deselected and disables Print when none remain', async () => {
    await ready()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include Lightning Bolt' }))
    expect(screen.getByText('1 of 3 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print 1 cards' })).toBeEnabled()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include Forest' }))
    expect(screen.getByText('0 of 3 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print 0 cards' })).toBeDisabled()
  })
  it('disables Print when the printer is not connected', async () => {
    await ready(fakeServices({ printer: fakePrinter('disconnected') }), 'disconnected')
    expect(screen.getByRole('button', { name: 'Print 3 cards' })).toBeDisabled()
  })
  it('hides the print row when Bluetooth is unsupported', async () => {
    await ready(fakeServices({ printer: fakePrinter('unsupported') }), 'unsupported')
    expect(screen.queryByRole('button', { name: /^Print/ })).toBeNull()
  })
  it('prints, then shows the done line and Start over', async () => {
    const printer = fakePrinter('connected')
    await ready(fakeServices({ printer }))
    await userEvent.click(screen.getByRole('button', { name: 'Print 3 cards' }))
    await waitFor(() => expect(screen.getByText('3 cards printed')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect(screen.getByRole('button', { name: 'Print 3 cards' })).toBeEnabled()
  })
  it('shows card progress with Cancel while printing, then Resume after cancelling', async () => {
    const printer = fakePrinter('connected')
    let release!: () => void; let gated = true
    const origWrite = printer.write.bind(printer)
    printer.write = async (b) => { if (gated) { gated = false; await new Promise<void>((r) => { release = r }) } await origWrite(b) }
    await ready(fakeServices({ printer }))
    await userEvent.click(screen.getByRole('button', { name: 'Print 3 cards' }))
    await waitFor(() => expect(screen.getByText('Card 1 of 3 · Lightning Bolt')).toBeInTheDocument())
    expect(screen.getByRole('progressbar', { name: 'Print progress' })).toBeInTheDocument()
    expect(textbox()).toHaveAttribute('readonly')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    release()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume from card 1' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Start over' })).toBeInTheDocument()
  })
  it('opens a full-size preview when a thumbnail is tapped', async () => {
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Preview Forest' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Forest' })).toBeInTheDocument())
    expect(screen.getByTestId('preview')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/DeckPanel.test.tsx`
Expected: FAIL, cannot find module `./DeckPanel`.

- [ ] **Step 3: Implement the panel**

Create `src/app/DeckPanel.tsx`:

```tsx
import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import PrintIcon from '@mui/icons-material/Print'
import type { PrinterState } from '../core/printer/transport'
import type { Settings } from '../core/settings'
import { progress } from '../core/deck/run'
import type { UseDeck } from './useDeck'
import { DeckStrip } from './DeckStrip'
import { DeckIssuesDialog } from './DeckIssuesDialog'
import { Preview } from './Preview'

export const MOXFIELD_HINT = 'Moxfield decks cannot be imported directly. Open the deck on Moxfield, choose Export, copy the list and paste it here.'
const PLACEHOLDER = '4 Lightning Bolt\n1 Sol Ring (C21) 263\n\nSideboard lines are skipped.'

export interface DeckPanelProps { deck: UseDeck; printerState: PrinterState; settings: Settings }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function DeckPanel({ deck, printerState, settings }: DeckPanelProps) {
  const [open, setOpen] = useState<string | null>(null)
  const { state, run, parsed, distinct } = deck
  const busy = state === 'verifying' || state === 'printing'
  const totalEntered = parsed.entries.reduce((a, e) => a + e.count, 0)
  const prog = run ? progress(run) : null
  const allCopies = run ? run.items.length : 0
  const selected = prog ? prog.total : 0

  const summary = (() => {
    if (!run || !prog) return `${plural(totalEntered, 'card')}, ${distinct.length} distinct`
    if (run.excluded.size > 0) return `${selected} of ${allCopies} selected`
    return `${plural(selected, 'card')} ready, ${run.cards.length} distinct`
  })()

  const canPrint = (state === 'ready' || state === 'paused') && printerState === 'connected' && !!prog && prog.remaining > 0 && !deck.rendering
  const currentCard = deck.current && run ? run.cards.find((c) => c.key === deck.current!.item.cardKey) : null
  const openCard = open && run ? run.cards.find((c) => c.key === open) : null
  const openThumb = open ? deck.thumbs.get(open) : undefined

  return (
    <Stack spacing={2}>
      <TextField multiline minRows={6} maxRows={14} label="Deck list" placeholder={PLACEHOLDER} value={deck.text}
        onChange={(e) => deck.setText(e.target.value)} slotProps={{ input: { readOnly: busy, sx: { fontFamily: 'monospace', fontSize: 14 } } }} />
      {parsed.moxfieldUrl && <Alert severity="info">{MOXFIELD_HINT}</Alert>}
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Stack>
          <Typography color="text.secondary">{summary}</Typography>
          {parsed.issues.length > 0 && !run && <Typography color="warning.main" variant="body2">{`${plural(parsed.issues.length, 'line')} ${parsed.issues.length === 1 ? 'has' : 'have'} problems`}</Typography>}
        </Stack>
        {state === 'editing' && (
          <Button variant="contained" disabled={parsed.entries.length === 0} onClick={() => { void deck.verify() }}>Verify</Button>
        )}
      </Stack>
      {state === 'verifying' && deck.verifyProgress && (
        <Stack spacing={0.5}>
          <Typography variant="body2" color="text.secondary">{`Checking ${deck.verifyProgress.done} of ${deck.verifyProgress.total}`}</Typography>
          <LinearProgress variant="determinate" value={deck.verifyProgress.total ? (100 * deck.verifyProgress.done) / deck.verifyProgress.total : 0} aria-label="Verify progress" />
        </Stack>
      )}
      {deck.error && <Alert severity="error" onClose={deck.clearError}>{deck.error}</Alert>}
      {deck.fontWarning && <Alert severity="info">{deck.fontWarning}</Alert>}
      {run && (
        <>
          <DeckStrip cards={run.cards} thumbs={deck.thumbs} excluded={run.excluded} currentKey={deck.current?.item.cardKey ?? null}
            disabled={state === 'printing'} onToggle={deck.toggleCard} onOpen={setOpen} />
          {deck.rendering && <LinearProgress aria-label="Rendering" />}
          {printerState !== 'unsupported' && prog && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
              {state === 'printing' && (
                <Stack spacing={0.5} sx={{ flexGrow: 1, minWidth: 220 }}>
                  <Typography variant="body2">{`Card ${prog.printed + 1} of ${prog.total} · ${currentCard?.name ?? ''}`}</Typography>
                  <LinearProgress variant="determinate" value={(deck.current?.fraction ?? 0) * 100} aria-label="Print progress" />
                </Stack>
              )}
              {state === 'printing' && <Button size="small" onClick={deck.cancel}>Cancel</Button>}
              {state === 'ready' && (
                <Button variant="contained" startIcon={<PrintIcon />} disabled={!canPrint} onClick={() => { void deck.print() }}>{`Print ${prog.total} cards`}</Button>
              )}
              {state === 'paused' && (
                <Button variant="contained" startIcon={<PrintIcon />} disabled={!canPrint} onClick={() => { void deck.print() }}>{`Resume from card ${prog.printed + 1}`}</Button>
              )}
              {state === 'done' && <Typography>{`${plural(prog.printed, 'card')} printed`}</Typography>}
              {(state === 'paused' || state === 'done') && <Button onClick={deck.startOver}>Start over</Button>}
            </Stack>
          )}
        </>
      )}
      <DeckIssuesDialog issues={deck.issues} onApply={deck.applySuggestion} onApplyAll={deck.applyAllSuggestions} onClose={deck.closeIssues} />
      <Dialog open={!!openCard} onClose={() => setOpen(null)} aria-labelledby="deck-preview-title" maxWidth="md">
        <DialogTitle id="deck-preview-title">{openCard?.name ?? ''}</DialogTitle>
        <DialogContent>
          {openThumb && <Preview bits={openThumb.bits} dotsPerLine={settings.dotsPerLine} dpi={settings.dpi} />}
        </DialogContent>
      </Dialog>
    </Stack>
  )
}
```

Note: "Print N cards" always uses the plural form (`Print 1 cards` in the deselection test) to keep the button label stable; the summary and done line use `plural`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/DeckPanel.test.tsx`
Expected: PASS (13 tests). If MUI's `TextField` `slotProps.input.readOnly` does not land on the `<textarea>` as a `readonly` attribute in this MUI version, pass `inputProps={{ readOnly: busy }}` instead and keep the assertion.

- [ ] **Step 5: Commit**

```bash
npm test && npm run typecheck
git add src/app/DeckPanel.tsx src/app/DeckPanel.test.tsx
git commit -m "feat(app): DeckPanel with text area, summary, verify, strip, print row and preview dialog"
```

---

### Task 10: Mode toggle in App, docs

**Files:**
- Create: `src/app/useMode.ts`
- Modify: `src/app/App.tsx`
- Test: `src/app/App.test.tsx` (append)
- Modify: `README.md` (Printing section), `CLAUDE.md` (architecture notes)

**Interfaces:**
- Consumes: `useDeck`, `DeckPanel`.
- Produces: `export type Mode = 'card' | 'deck'`; `export const MODE_KEY = 'hot-proxies.mode.v1'`; `export function useMode(store): [Mode, (m: Mode) => void]`.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/App.test.tsx`:

```tsx
describe('App modes', () => {
  it('starts in Card mode, switches to Deck and persists the choice', async () => {
    const store = new Map<string, string>()
    const s = services(async () => bolt)
    s.storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v) } }
    render(<App services={s} />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Deck' }))
    expect(screen.getByRole('textbox', { name: 'Deck list' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(store.get('hot-proxies.mode.v1')).toBe('"deck"')
  })
  it('opens in Deck mode when that was stored', () => {
    const s = services(async () => bolt)
    s.storage = { getItem: (k) => (k === 'hot-proxies.mode.v1' ? '"deck"' : null), setItem: () => {} }
    render(<App services={s} />)
    expect(screen.getByRole('textbox', { name: 'Deck list' })).toBeInTheDocument()
  })
  it('keeps the deck text when switching modes back and forth', async () => {
    render(<App services={services(async () => bolt)} />)
    await userEvent.click(screen.getByRole('button', { name: 'Deck' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Deck list' }), '4 Lightning Bolt')
    await userEvent.click(screen.getByRole('button', { name: 'Card' }))
    await userEvent.click(screen.getByRole('button', { name: 'Deck' }))
    expect(screen.getByRole('textbox', { name: 'Deck list' })).toHaveValue('4 Lightning Bolt')
  })
  it('shows a deck print drop in the shared snackbar', async () => {
    const printer = fakePrinter('connected'); printer.name = 'PT210_FAKE'
    const origWrite = printer.write.bind(printer)
    let n = 0
    printer.write = async (b) => { if (++n === 2) { printer.set('disconnected'); throw new Error('gatt gone') } await origWrite(b) }
    render(<App services={services(async () => bolt, printer)} />)
    await userEvent.click(screen.getByRole('button', { name: 'Deck' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Deck list' }), '1 Lightning Bolt')
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Print 1 cards' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Print 1 cards' }))
    await waitFor(() => expect(screen.getByText('Printer disconnected during printing. Reconnect and print again.')).toBeInTheDocument())
  })
})
```

`services(...)` in this file returns a fresh object, so assigning `s.storage` is safe.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/App.test.tsx`
Expected: FAIL, no button named "Deck".

- [ ] **Step 3: Add `useMode`**

Create `src/app/useMode.ts`:

```ts
import { useCallback, useState } from 'react'

export type Mode = 'card' | 'deck'
export const MODE_KEY = 'hot-proxies.mode.v1'
type Store = Pick<Storage, 'getItem' | 'setItem'>

function load(store: Store): Mode {
  try { return JSON.parse(store.getItem(MODE_KEY) ?? 'null') === 'deck' ? 'deck' : 'card' } catch { return 'card' }
}

/** Which panel is shown: single card or deck. Persisted so a reload lands where the user was. */
export function useMode(store: Store): [Mode, (m: Mode) => void] {
  const [mode, setModeState] = useState<Mode>(() => load(store))
  const setMode = useCallback((m: Mode) => {
    setModeState(m)
    try { store.setItem(MODE_KEY, JSON.stringify(m)) } catch { /* storage full or disabled: keep in memory */ }
  }, [store])
  return [mode, setMode]
}
```

- [ ] **Step 4: Wire the toggle and the deck panel into `App.tsx`**

Add imports:

```tsx
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import { useMode } from './useMode'
import { useDeck } from './useDeck'
import { DeckPanel } from './DeckPanel'
```

Inside `App`, after `const printer = usePrinter(services)`:

```tsx
  const [mode, setMode] = useMode(services.storage)
  const deck = useDeck(services, settings)
  const snack = printer.error ?? deck.error
  const clearSnack = () => { printer.clearError(); deck.clearError() }
```

Replace the header row's contents so the toggle sits between the chip and the settings icon:

```tsx
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <PrinterChip state={printer.state} name={printer.name} onConnect={printer.connect} onDisconnect={printer.disconnect} />
              <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_e, v) => v && setMode(v)} aria-label="Mode">
                <ToggleButton value="card">Card</ToggleButton>
                <ToggleButton value="deck">Deck</ToggleButton>
              </ToggleButtonGroup>
              <IconButton aria-label="settings" sx={{ color: 'text.primary' }} onClick={() => setDrawer(true)}><SettingsIcon /></IconButton>
            </Stack>
```

Wrap the existing single-card block (from `<SearchBox …/>` through the `<Preview …/>` closing) in `{mode === 'card' && (<> … </>)}` and add, after it:

```tsx
            {mode === 'deck' && <DeckPanel deck={deck} printerState={printer.state} settings={settings} />}
```

Change the snackbar to use the shared message:

```tsx
      <Snackbar open={!!snack} autoHideDuration={6000} onClose={clearSnack}>
        <Alert severity="error" onClose={clearSnack} variant="filled">{snack}</Alert>
      </Snackbar>
```

Since `DeckPanel` already shows `deck.error` inline for verify failures, keep that: the snackbar is for print drops. To avoid showing a verify network error twice, change `snack` to `printer.error ?? (deck.state === 'paused' ? deck.error : null)`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/App.test.tsx`
Expected: PASS, all existing App tests plus the 4 new ones. The existing single-card tests must still find the combobox because Card is the default mode.

- [ ] **Step 6: Update the docs**

In `README.md`, after the numbered list in the Printing section, add:

```markdown
### Printing a deck

Switch to **Deck** in the header. Paste a list, one card per line, in any of the usual export
formats (`4 Lightning Bolt`, `4x Lightning Bolt`, `1 Sol Ring (C21) 263`). `Sideboard`,
`Maybeboard`, `Considering` and `Tokens` sections are skipped; `Commander` cards are printed.
Press **Verify**: every name is resolved through Scryfall, and unresolved lines are listed with a
suggested fix you can apply with one tap. Then untick any cards you do not want, and press
**Print**. Cards print back to back with a short gap for cutting. Cancel or a lost connection
pauses the run; **Resume** continues from the card that did not finish.

Moxfield deck links cannot be imported directly (Moxfield's API does not allow browser requests
from other sites). Open the deck on Moxfield, choose Export, copy the list and paste it.
```

In `CLAUDE.md`, under Architecture, add a bullet after the Printing one:

```markdown
- **Deck printing** — `core/deck/parse.ts` (deck text → entries, section skipping, Moxfield URL detection, line rewriting) and `core/deck/run.ts` (immutable print queue: pending/printed/skipped items, toggle, resume) are pure. `app/useDeck.ts` verifies names through `Services.client`, renders one `BitImage` per distinct card with `renderProxy`, and loops `printJob` per pending item; a run sends `escposInit()` once and `escposFeed(FEED_LINES_BETWEEN_CARDS)` between cards (never `ESC @` between cards: it clears the print buffer). `DeckPanel`/`DeckStrip`/`DeckIssuesDialog` are the views; `App.tsx` switches `Card | Deck` via `useMode`. Design: `docs/superpowers/specs/2026-10-15-deck-printing-design.md`.
```

And in the Commands block add `npm run check:run          # write 3-card ESC/POS streams to tmp/run-check/ for a manual printer check`.

- [ ] **Step 7: Commit**

```bash
npm test && npm run typecheck && npm run build
git add src/app/useMode.ts src/app/App.tsx src/app/App.test.tsx README.md CLAUDE.md
git commit -m "feat(app): Card | Deck mode toggle, deck panel wired into App; docs"
```

---

### Task 11: End-to-end check on the real printer (manual)

**Files:** none (report only; fixes go through new tasks if needed).

- [ ] **Step 1: Run the app against the printer**

`npm run dev`, open `http://localhost:5173` in Chrome, connect the PT-210 via the chip, switch to Deck, paste `tests/fixtures/decks/plain.txt`, Verify, Print.

- [ ] **Step 2: Check**

- All three cards print complete, with the gap chosen in Task 2 between them and the tail feed after the last.
- Press Print again on a 5-card list and Cancel during card 2: card 2's partial print is followed by a feed, the button reads "Resume from card 2", Resume reprints card 2 fully and finishes.
- Power the printer off during a run: the snackbar shows the disconnected message, the chip shows "tap to reconnect", and after reconnecting Resume continues from the pending card.
- Switch to Card mode during a deck print: the Card Print button is disabled while the chip says printing.

- [ ] **Step 3: Record**

If any check fails, write the observation in a new task appended to this plan before changing code. If all pass, note the date in the `FEED_LINES_BETWEEN_CARDS` comment if it is not already there.

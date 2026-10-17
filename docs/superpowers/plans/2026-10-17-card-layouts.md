# Card Layouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render and print every standard-size Scryfall layout: side columns for sagas/classes/cases/levelers, stacked adventure/flip/prototype, two-half split cards, and fold pairs (front, fold guide, back rotated 180°) for transform/MDFC/meld/battle, in Card and Deck mode.

**Architecture:** The normaliser turns Scryfall JSON into a `ProxyCard` of one or two `Sheet`s; each sheet kind (`standard`, `columns`, `stacked`, `split`) has its own pure fit and paint path behind the unchanged `renderProxy` entry point, sharing the name/type/stat bar helpers extracted from today's code so existing golden renders stay bit-identical. A pure `sheetFrames` helper turns a card's sheets into the ESC/POS frame sequence (fold guide and `rotate180` between the two sheets of a pair); `loadCard` and a per-sheet `resolveArt` feed `useProxy` and `useDeck`.

**Tech Stack:** TypeScript, React 19, MUI 9, Vite, Vitest (node + jsdom), `@napi-rs/canvas` in tests, `tsx` for scripts.

**Spec:** `docs/superpowers/specs/2026-10-17-card-layouts-design.md` (mockup: `brainstorm/layout/2026-10-17-card-layouts.html`)

## Global Constraints

- `src/core/` is framework-free TypeScript and never touches the DOM; drawing goes through `Ctx2D` from `core/env.ts`.
- All geometry in printer dots on a 384 × 536 grid; new constants live in `core/layout/constants.ts`, printer constants in `core/printer.ts`.
- Every existing golden PNG in `tests/golden/` stays bit-identical through every task. Never run `UPDATE_GOLDEN=1` on an existing golden; only new goldens are created (a missing golden is written on first run).
- Readability beats art: in every fit order the art shrinks, then text shrinks to 14 px, then reminder text is stripped, then art is dropped, then text goes to 11 px, then the text is clipped with `overflow = true`.
- Printing: one `escposInit()` per job; `escposFeed(FEED_LINES_BETWEEN_CARDS)` between cards and `escposFeed(FEED_LINES_AFTER)` after the last; never `ESC @` between cards. The two sheets of a fold pair are separated by the fold-guide raster only, no feed.
- Everything external enters the UI through `Services`; tests use `tests/fakeServices.ts` and `tests/fakePrinter.ts`; Scryfall is never hit in tests.
- Excluded layouts: `planar`, `scheme`, `vanguard`, `art_series`, `augment`, `host`. Message: `<name> uses the '<layout>' layout; oversized and Un-set cards are not supported.`
- Art refs: Scryfall id without hyphens, `:1` for the back face. One remembered printing per card name; a fold pair's back uses `<ref>:1`.
- Vitest globals are off; UI tests start with `// @vitest-environment jsdom`.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A saga chapter whose text itself contains an em dash ("III — Choose one —") must keep the whole text after the first dash. Test in Task 2.
2. A face with no `oracle_text` (a vanilla transform back) or a card with no `card_faces` where one is expected must normalise to empty text, not throw. Test in Task 4.
3. A deck line `1 Fire // Ice` must verify as a card: `//` is a comment marker only at the start of a line. Test in Task 13.
4. If the printer drops after the first sheet of a fold pair, the item must stay pending and the resume must send both sheets again. Test in Task 13.
5. When the remembered printing's back-face crop cannot be fetched, the back sheet must fall back to its face's own crop instead of printing blank. Test in Task 11.

---

### Task 1: Types and fixtures

**Files:**
- Modify: `src/core/card/types.ts`
- Create: `src/core/card/types.test.ts`
- Create: `tests/fixtures/cards/{benalia,urzas-saga,ranger-class,case-skeleton,transcendent-master,fleshgorger,bonecrusher,fire-ice,dusk-dawn,bushi,valki,gobakhan,hanweir-battlements,hanweir-township,kami-war,plane}.json`

**Interfaces:**
- Produces:
  ```ts
  export type Stat = { kind: 'pt'; power: string; toughness: string } | { kind: 'loyalty'; value: string } | { kind: 'defense'; value: string }
  export interface Face { name: string; manaCost: string; typeLine: string; oracleText: string; stat?: Stat; artUrl?: string }
  export type CardData = Face                                  // alias; Tokens mode keeps compiling
  export interface Section { header?: { label: string; cost?: string; stat?: Stat }; badges?: string[]; text: string }
  export type Sheet =
    | { kind: 'standard'; face: Face }
    | { kind: 'columns'; face: Face; sections: Section[] }
    | { kind: 'stacked'; face: Face; sub: Face }
    | { kind: 'split'; halves: [Face, Face] }
  export interface ProxyCard { name: string; sheets: [Sheet] | [Sheet, Sheet]; meldResult?: string; meldBack?: true }
  export function standardSheet(face: Face): Sheet
  export function sheetFaces(sheet: Sheet): Face[]            // the face(s) a sheet draws: [face], [face, sub] or halves
  export function statLabel(stat: Stat): string               // "3/3", "5", "4"
  ```

- [ ] **Step 1: Write the failing test** `src/core/card/types.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { standardSheet, sheetFaces, statLabel, type Face } from './types'
const f: Face = { name: 'A', manaCost: '', typeLine: 'Instant', oracleText: '' }
describe('card types', () => {
  it('wraps a face as a standard sheet', () => { expect(standardSheet(f)).toEqual({ kind: 'standard', face: f }) })
  it('lists the faces of each sheet kind', () => {
    const g = { ...f, name: 'B' }
    expect(sheetFaces({ kind: 'standard', face: f })).toEqual([f])
    expect(sheetFaces({ kind: 'stacked', face: f, sub: g })).toEqual([f, g])
    expect(sheetFaces({ kind: 'split', halves: [f, g] })).toEqual([f, g])
  })
  it('labels every stat kind', () => {
    expect(statLabel({ kind: 'pt', power: '3', toughness: '3' })).toBe('3/3')
    expect(statLabel({ kind: 'loyalty', value: '5' })).toBe('5')
    expect(statLabel({ kind: 'defense', value: '4' })).toBe('4')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/core/card/types.test.ts`
Expected: FAIL, `standardSheet` is not exported.

- [ ] **Step 3: Add the types and the three helpers to `src/core/card/types.ts`** exactly as in Interfaces. Keep `CardData` as `export type CardData = Face`.

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run src/core/card/types.test.ts && npm run typecheck`
Expected: PASS; typecheck clean (nothing else changed).

- [ ] **Step 5: Download the fixtures** (network allowed here; never in tests). From the repo root in Git Bash:

```bash
dl() { curl -sS -A "hot-proxies-fixtures" -H "Accept: application/json" "https://api.scryfall.com/cards/named?exact=$(python -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$2")" -o "tests/fixtures/cards/$1.json"; sleep 0.15; }
dl benalia "History of Benalia"; dl urzas-saga "Urza's Saga"; dl ranger-class "Ranger Class"
dl case-skeleton "Case of the Stashed Skeleton"; dl transcendent-master "Transcendent Master"
dl fleshgorger "Phyrexian Fleshgorger"; dl bonecrusher "Bonecrusher Giant // Stomp"; dl fire-ice "Fire // Ice"
dl dusk-dawn "Dusk // Dawn"; dl bushi "Bushi Tenderfoot // Kenzo the Hardhearted"
dl valki "Valki, God of Lies // Tibalt, Cosmic Impostor"; dl gobakhan "Invasion of Gobakhan // Lightshield Array"
dl hanweir-battlements "Hanweir Battlements"; dl hanweir-township "Hanweir, the Writhing Township"
dl kami-war "The Kami War // O-Kagachi Made Manifest"; dl plane "Academy at Tolaria West"
for f in tests/fixtures/cards/*.json; do python -I -c "import json,sys; c=json.load(open(sys.argv[1],encoding='utf-8')); print(sys.argv[1].split('/')[-1], c.get('layout'), c.get('object'))" "$f"; done
```

Expected: every line prints a layout (`saga`, `class`, `case`, `leveler`, `prototype`, `adventure`, `split`, `split`, `flip`, `modal_dfc`, `transform`, `meld`, `meld`, `transform`, `planar`) and `card`, never `error`. `gobakhan.json` has `layout: transform` with a `defense` field on its first face.

- [ ] **Step 6: Commit**

```bash
git add src/core/card/types.ts src/core/card/types.test.ts tests/fixtures/cards
git commit -m "feat(core): Face, Sheet and ProxyCard types; Scryfall fixtures for every layout"
```

---

### Task 2: Section parsing

**Files:**
- Create: `src/core/card/sections.ts`, `src/core/card/sections.test.ts`

**Interfaces:**
- Consumes: `Section`, `Face`, `Stat` from Task 1.
- Produces:
  ```ts
  export function sagaSections(text: string): Section[]
  export function classSections(text: string): Section[]
  export function caseSections(text: string): Section[]
  export function levelerSections(text: string): Section[]
  /** null when paragraph 0 is not a Prototype line. */
  export function prototypeFaces(face: Face): { main: Face; sub: Face } | null
  ```
  Regexes (em dash is U+2014): saga `^((?:[IVX]+)(?:, [IVX]+)*) — (.*)$`; class `^(\{.*\}): Level (\d+)$`; case `^To solve — (.*)$` / `^Solved — (.*)$`; leveler `^LEVEL (\d+(?:-\d+|\+))$` then an optional `^(\d+|\*)/(\d+|\*)$` stat paragraph; prototype `^Prototype (\{.*\}) — (\S+)\/(\S+)(?: \((.*)\))?$`.

- [ ] **Step 1: Write the failing tests** using the fixtures' `oracle_text` (read the JSON, take `oracle_text`, or `card_faces[0].oracle_text` for kami-war):

```ts
it('splits History of Benalia into reminder + I,II + III', () => {
  const s = sagaSections(text('benalia'))
  expect(s.map((x) => x.badges)).toEqual([undefined, ['I', 'II'], ['III']])
  expect(s[0].text).toMatch(/^\(As this Saga enters/)
  expect(s[2].text).toBe('Knights you control get +2/+1 until end of turn.')
})
it('keeps an em dash inside chapter text', () => {
  const s = sagaSections('I — Choose one —\n• A\n• B\nII — Done.')
  expect(s[0].text).toBe('Choose one —\n• A\n• B'); expect(s[1].badges).toEqual(['II'])
})
it('splits Ranger Class into level 1 (no header) and levels 2, 3 with costs', () => {
  const s = classSections(text('ranger-class'))
  expect(s.length).toBe(3); expect(s[0].header).toBeUndefined()
  expect(s[1].header).toEqual({ label: 'Level 2', cost: '{1}{G}' })
  expect(s[2].header).toEqual({ label: 'Level 3', cost: '{3}{G}' })
  expect(s[2].text.split('\n').length).toBe(2)
})
it('splits a Case into setup, To solve and Solved', () => {
  const s = caseSections(text('case-skeleton'))
  expect(s.map((x) => x.header?.label)).toEqual([undefined, 'To solve', 'Solved'])
  expect(s[1].text).toMatch(/^You control no suspected Skeletons/)
})
it('splits a leveler and lifts the level P/T into the header', () => {
  const s = levelerSections(text('transcendent-master'))
  expect(s[0].text).toMatch(/^Level up \{1\}/)
  expect(s[1].header).toEqual({ label: 'LEVEL 6-11', stat: { kind: 'pt', power: '6', toughness: '6' } })
  expect(s[1].text).toBe('Lifelink')
  expect(s[2].header!.label).toBe('LEVEL 12+'); expect(s[2].text).toBe('Lifelink, indestructible')
})
it('splits a prototype into main and sub faces', () => {
  const r = prototypeFaces({ name: 'Phyrexian Fleshgorger', manaCost: '{7}', typeLine: 'Artifact Creature — Phyrexian Wurm', oracleText: text('fleshgorger'), stat: { kind: 'pt', power: '7', toughness: '5' } })!
  expect(r.sub).toEqual({ name: 'Prototype', manaCost: '{1}{B}{B}', typeLine: '', oracleText: expect.stringMatching(/^You may cast this spell/), stat: { kind: 'pt', power: '3', toughness: '3' } })
  expect(r.main.oracleText).toMatch(/^Menace, lifelink/)
  expect(prototypeFaces({ name: 'x', manaCost: '', typeLine: '', oracleText: 'Flying' })).toBeNull()
})
it('keeps an unrecognised first paragraph as plain text', () => {
  expect(sagaSections('Odd first line.\nI — A.')[0]).toEqual({ text: 'Odd first line.' })
})
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/core/card/sections.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `sections.ts`.** Paragraph-driven: split on `\n`, start a new section when a paragraph matches the layout's header regex, otherwise append the paragraph to the current section's text (joined with `\n`). A header-less, badge-less section with empty text is never emitted. The sub face's `oracleText` for prototype is the reminder inside the parentheses, or `''` when absent.

- [ ] **Step 4: Run to verify they pass** — `npx vitest run src/core/card/sections.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add src/core/card/sections.ts src/core/card/sections.test.ts && git commit -m "feat(core): parse saga, class, case, leveler and prototype sections"`

---

### Task 3: Renderer takes a Sheet (standard only), shared bar helpers

**Files:**
- Create: `src/core/layout/bars.ts`, `src/core/render/parts.ts`
- Modify: `src/core/layout/fit.ts`, `src/core/render/paint.ts`, `src/core/render/renderProxy.ts`, `src/core/token/hotspots.ts`, `src/core/token/hotspots.test.ts`
- Modify callers to wrap with `standardSheet(...)`: `src/app/useProxy.ts`, `src/app/useDeck.ts`, `src/app/useTokens.ts`, `scripts/make-run-check.ts`, `src/core/layout/fit.test.ts`, `src/core/render/renderProxy.test.ts`, `src/core/layout/fit.golden.test.ts` if present (grep `fit(` and `renderProxy(` under `src/` and `scripts/`).

**Interfaces:**
- Produces:
  ```ts
  // layout/fit.ts
  export interface Geometry {
    kind: 'standard' | 'columns' | 'stacked' | 'split'
    card: { w: number; h: number }
    nameBar: Rect; nameFontSize: number; costOnSecondLine: boolean; costSymbolSize: number
    art?: Rect                                         // absent when the art was dropped
    typeBar: Rect; typeFontSize: number
    textBox: Rect; textFontSize: number; lineHeight: number; symbolSize: number; textLines: Line[]
    statBox?: Rect
    sections?: SectionGeometry[]                       // columns (Task 6)
    sub?: SubGeometry                                  // stacked (Task 7)
    second?: HalfGeometry                              // split (Task 8)
    overflow: boolean; strippedReminder: boolean
  }
  export function fit(sheet: Sheet, s: Settings, env: RenderEnv): Geometry   // dispatches on sheet.kind; only 'standard' implemented here, others throw `new Error('not implemented')`
  // layout/bars.ts (pure extractions of today's fit code; same numbers)
  export interface NameBarFit { nameBar: Rect; nameFontSize: number; costOnSecondLine: boolean }
  export function fitNameBar(ctx: Ctx2D, face: Pick<Face, 'name' | 'manaCost'>, baseSize: number, family: string, x: number, y: number, w: number): NameBarFit
  export function fitTypeFont(ctx: Ctx2D, typeLine: string, family: string, w: number): number   // TYPE_SIZE down to TYPE_MIN against w - 16
  export function statWidth(ctx: Ctx2D, stat: Stat, family: string): number                    // bold 24px label width + 2 * STAT_PAD
  // render/parts.ts (pure extractions of today's paint code)
  export function drawNameBar(ctx: Ctx2D, bar: NameBarFit & { costSymbolSize: number }, face: Pick<Face, 'name' | 'manaCost'>, family: string, stamps: StampCache): void
  export function drawTypeBar(ctx: Ctx2D, bar: Rect, fontSize: number, typeLine: string, family: string): void
  export function drawStatBox(ctx: Ctx2D, box: Rect, stat: Stat, family: string): void
  export function strokeRect(ctx: Ctx2D, r: Rect, lw: number): void
  // render/renderProxy.ts
  export function renderProxy(sheet: Sheet, art: GreyImage | null, settings: Settings, env: RenderEnv): { bits: BitImage; geometry: Geometry }
  export const artInnerBox = (g: Geometry) => g.art ? { w: g.art.w - 4, h: g.art.h - 4 } : null   // prepareArt is skipped when null
  ```
  `hotspotsFor(g)` omits the `art` hotspot when `g.art` is undefined.

- [ ] **Step 1: Update the tests first.** In `fit.test.ts` and `renderProxy.test.ts` wrap every `fit(card(...))` / `renderProxy(card(...))` argument in `standardSheet(...)` (and `synthetic(...)` likewise). Add to `fit.test.ts`: `expect(fit(standardSheet(card('bolt')), S, nodeEnv).kind).toBe('standard')`. Add to `hotspots.test.ts`: a geometry with `art: undefined` yields four hotspots and none of kind `art`.

- [ ] **Step 2: Run them to verify they fail** — `npx vitest run src/core/layout src/core/render src/core/token/hotspots.test.ts` → FAIL (type errors / `kind` undefined).

- [ ] **Step 3: Extract `bars.ts` and `parts.ts` from the current `fit.ts` and `paint.ts` without changing a single computed value**, give `fit`/`paint`/`renderProxy` the `Sheet` signature, set `kind: 'standard'`, make `art` optional (paint skips the art frame and the blit when absent). Update `hotspotsFor`. Wrap callers in `useProxy`, `useDeck`, `useTokens`, `make-run-check.ts` with `standardSheet`.

- [ ] **Step 4: Run the whole suite and the typecheck** — `npm test && npm run typecheck` → PASS, every golden identical (no files appear in `tests/golden/__diff__/`).

- [ ] **Step 5: Commit** — `git commit -am "refactor(core): renderProxy and fit take a Sheet; shared name/type/stat bar helpers"` (add the two new files first).

---

### Task 4: Normaliser produces a ProxyCard for every layout

**Files:**
- Modify: `src/core/card/normalize.ts`, `src/core/card/normalize.test.ts`, `src/core/errors.ts`
- Modify (compile only, temporary `.sheets[0]`): `src/app/useProxy.ts`, `src/app/useDeck.ts`, `scripts/make-run-check.ts`, `src/core/layout/fit.test.ts`, `src/core/render/renderProxy.test.ts` (helper `card(n)` returns `normalizeScryfall(...).sheets[0]`, dropping the `standardSheet` wrap from Task 3)
- Modify: `tests/fakeServices.ts` (`FIXTURE_CARDS` gains every Task 1 fixture by lower-case full name and by each face name, e.g. `'bonecrusher giant'`, `'stomp'`, `'fire // ice'`, `'fire'`; `FIXTURE_NAMES` gains the full names; the client gains `fetchCardById` returning the fixture whose `id` matches, else `CardNotFound`)

**Interfaces:**
- Consumes: Task 1 types, Task 2 parsers.
- Produces:
  ```ts
  export const EXCLUDED_LAYOUTS: ReadonlySet<string>   // planar, scheme, vanguard, art_series, augment, host
  export function normalizeScryfall(json: unknown): ProxyCard
  export function attachMeldBack(card: ProxyCard, resultJson: unknown): ProxyCard   // appends the result's standard sheet, sets meldBack: true, clears meldResult
  // errors.ts
  export class UnsupportedLayout extends Error { cardName; layout }   // message per Global Constraints
  export class MeldUnavailable extends Error { constructor() { super('Melded side could not be loaded.') } }
  ```
  Face style rule (spec §4.2): type line `/\bSaga\b/` → columns + `sagaSections`; `/\bClass\b/` → columns + `classSections`; `/\bCase\b/` → columns + `caseSections`; top-level layout `leveler` → columns + `levelerSections`; `prototype` → stacked via `prototypeFaces` (standard if it returns null); else standard. Stat: `pt` if power+toughness, else `loyalty`, else `defense`. Missing `oracle_text` → `''`. `ScryfallClient` gains `fetchCardById(id: string): Promise<unknown>` (implemented in Task 10; add to the interface and every fake now).

- [ ] **Step 1: Rewrite `normalize.test.ts`** — keep the existing cases on `c.sheets[0]` (`kind: 'standard'`, `face` fields) and add one per layout row:

```ts
it('saga → one columns sheet with chapter badges', () => {
  const c = normalizeScryfall(load('benalia'))
  expect(c.sheets.length).toBe(1); expect(c.sheets[0].kind).toBe('columns')
  expect((c.sheets[0] as any).sections[1].badges).toEqual(['I', 'II'])
})
it('class, case and leveler → columns', () => { for (const n of ['ranger-class', 'case-skeleton', 'transcendent-master']) expect(normalizeScryfall(load(n)).sheets[0].kind).toBe('columns') })
it('prototype → stacked with a Prototype sub face', () => { const s = normalizeScryfall(load('fleshgorger')).sheets[0]; expect(s.kind).toBe('stacked'); expect((s as any).sub.name).toBe('Prototype') })
it('adventure and flip → stacked, art from the top-level image_uris', () => {
  const a = normalizeScryfall(load('bonecrusher')); const s = a.sheets[0] as any
  expect(a.name).toBe('Bonecrusher Giant // Stomp'); expect(s.kind).toBe('stacked')
  expect(s.face.name).toBe('Bonecrusher Giant'); expect(s.sub).toMatchObject({ name: 'Stomp', manaCost: '{1}{R}', typeLine: 'Instant — Adventure' })
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
it('battle → defense stat on the front', () => { expect((normalizeScryfall(load('gobakhan')).sheets[0] as any).face.stat).toEqual({ kind: 'defense', value: '3' }) })
it('transform saga → columns front, standard back', () => { const c = normalizeScryfall(load('kami-war')); expect(c.sheets.map((s) => s.kind)).toEqual(['columns', 'standard']) })
it('meld part → one sheet plus meldResult; attachMeldBack appends the result', () => {
  const c = normalizeScryfall(load('hanweir-battlements'))
  expect(c.sheets.length).toBe(1); expect(c.meldResult).toBe(load('hanweir-township').id)
  const full = attachMeldBack(c, load('hanweir-township'))
  expect(full.sheets.length).toBe(2); expect((full.sheets[1] as any).face.name).toBe('Hanweir, the Writhing Township'); expect(full.meldBack).toBe(true); expect(full.meldResult).toBeUndefined()
  expect(normalizeScryfall(load('hanweir-township')).meldResult).toBeUndefined()
})
it('a face without oracle_text normalises to empty text', () => {
  const raw = load('delver'); delete raw.card_faces[1].oracle_text
  expect((normalizeScryfall(raw).sheets[1] as any).face.oracleText).toBe('')
})
it('excluded layouts throw with the oversized message', () => {
  expect(() => normalizeScryfall(load('plane'))).toThrow(/'planar' layout; oversized and Un-set cards are not supported/)
})
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/core/card/normalize.test.ts` → FAIL.

- [ ] **Step 3: Implement** `normalize.ts` (a `faceFrom(raw, artSource)` helper, a `styleFace(face, layout)` helper, the layout table of spec §4), `attachMeldBack`, the error classes; add `fetchCardById` to the `ScryfallClient` interface with a `throw new Error('not implemented')` body in the real client (Task 10 fills it) and fixture lookups in `tests/fakeServices.ts`; point the app and test callers at `.sheets[0]` so everything compiles.

- [ ] **Step 4: Run everything** — `npm test && npm run typecheck` → PASS; `useDeck.test.tsx`'s "unsupported-layout" case now needs a plane instead of Delver: change that deck line to `1 Academy at Tolaria West` and the expected `layout` to `planar` (add `'academy at tolaria west': 'plane'` to the fixtures). Goldens identical.

- [ ] **Step 5: Commit** — `git commit -am "feat(core): normalise every standard-size layout into a ProxyCard"`

---

### Task 5: Fit candidate lists for columns, stacked and split

**Files:**
- Modify: `src/core/layout/candidates.ts`, `src/core/layout/candidates.test.ts`, `src/core/layout/constants.ts`

**Interfaces:**
- Produces (constants): `COL_ART_MAX = 150`, `COL_ART_MID = 120`, `COL_ART_MIN = 80`, `COL_ART_STEP = 10`, `BADGE = 22`, `BADGE_GUTTER = 28`, `SECTION_GAP = 6`, `SECTION_RULE = 1`, `SUB_PAD = 6`, `SUB_TYPE_H = 22`, `SPLIT_ART_MAX = 120`, `SPLIT_ART_MIN = 60`, `SPLIT_ART_STEP = 10`.
- Produces (functions; `fitCandidates` unchanged):
  ```ts
  export interface ColumnCandidate { textSize: number; colW: number; stripped: boolean }   // colW 0 = column dropped
  export function columnCandidates(base: number, strip: boolean): ColumnCandidate[]
  export function stackedCandidates(base: number, strip: boolean): FitCandidate[]           // artH 0 = art dropped
  export function splitCandidates(base: number, strip: boolean): FitCandidate[]
  ```
  Orders: **columns** = (base, 150..120 step 10, strip) → (base−1..14, 120, strip) → (14, 110..80, strip) → if `!strip`: (base..14, 120, true), (14, 110..80, true) → (base..14, 0, true) → (13..11, 0, true). **stacked** = today's `fitCandidates(base, strip)` with its final `(13..11, ART_MIN, true)` block replaced by (base..14, 0, true) → (13..11, 0, true). **split** = (base, 120..60 step 10, strip) → (base−1..14, 60, strip) → if `!strip`: (base..14, 60, true) → (base..14, 0, true) → (13..11, 0, true). No duplicate consecutive entries.

- [ ] **Step 1: Write the failing tests** asserting the first entry, the last entry, the index where `colW`/`artH` first drops to 0, that every entry with `textSize < 14` has art 0 and `stripped: true`, that art never grows between consecutive entries at the same text size, and that `stackedCandidates(24, false)` begins with the same entries as `fitCandidates(24, false)` up to the first `textSize < 14`.

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/core/layout/candidates.test.ts` → FAIL.
- [ ] **Step 3: Implement** the three list builders and the constants.
- [ ] **Step 4: Run to verify they pass** — same command → PASS; `npm test` still green.
- [ ] **Step 5: Commit** — `git commit -am "feat(layout): fit candidates and constants for columns, stacked and split sheets"`

---

### Task 6: Columns geometry and paint (sagas, classes, cases, levelers)

**Files:**
- Create: `src/core/layout/fitColumns.ts`, `src/core/render/paintColumns.ts`
- Modify: `src/core/layout/fit.ts` (dispatch), `src/core/render/paint.ts` (dispatch), `src/core/layout/fit.test.ts`, `src/core/render/renderProxy.test.ts`
- Create goldens: `tests/golden/{saga-benalia,saga-urza,class-ranger,case-skeleton,leveler-master,saga-kami-war-front}.png`

**Interfaces:**
- Produces:
  ```ts
  export interface SectionGeometry {
    rule?: number                                    // y of the 1-dot rule above a header; absent on the first section
    header?: { label: string; y: number; costCodes: string[]; statLabel?: string }   // row is lineHeight tall
    badges: { code: string; rect: Rect }[]           // [] when none
    textX: number; textTop: number; lines: Line[]
  }
  export function fitColumns(sheet: Extract<Sheet, { kind: 'columns' }>, s: Settings, env: RenderEnv): Geometry
  export function paintColumns(ctx: Ctx2D, sheet: Extract<Sheet, { kind: 'columns' }>, g: Geometry, s: Settings, stamps: StampCache): void   // everything but the art blit
  ```
  Layout (spec §5.1), all absolute dots: `colTop = nameBar.y + nameBar.h + GAP`; `typeBar = { x: MARGIN, y: H − MARGIN − TYPE_H, w: innerW, h: TYPE_H }`; `colH = typeBar.y − GAP − colTop`; `textBox = { x: MARGIN, y: colTop, w: innerW − (colW ? colW + GAP : 0), h: colH }`; `art = colW ? { x: textBox.x + textBox.w + GAP, y: colTop, w: colW, h: colH } : undefined`. Sections stack from `textBox.y + TEXT_PAD`: for `i > 0` add `SECTION_GAP` and, if the section has a header, `rule = y − 3`; header row takes `lineHeight`; badges are `BADGE`-square rects at `x = textBox.x + TEXT_PAD`, stacked with 2-dot gaps, one per numeral; `textX = textBox.x + TEXT_PAD + (badges ? BADGE_GUTTER : 0)`; the section's text wraps at `textBox.w − 2·TEXT_PAD − (badges ? BADGE_GUTTER : 0)` at the candidate's text size; section height = header + max(lines·lineHeight, badges·(BADGE + 2)). Fits when the stack's bottom + `TEXT_PAD` + (stat ? `STAT_H + 2` : 0) ≤ `textBox.y + textBox.h`. The stat box (levelers) sits bottom-right of `textBox` as in the standard sheet; no line narrowing. Reminder stripping applies `stripReminder` to each section's text; a section left with no text, header or badges is skipped. Overflow: drop lines from the last section, then whole sections from the end, until it fits; `overflow = true`. `textLines` is `[]` for columns.
  Painting: name bar, type bar, stat box through `parts.ts`; `strokeRect(textBox, 2)` and `strokeRect(art, 2)`; rules via `ctx.fillRect(textBox.x + TEXT_PAD, rule, textBox.w − 2·TEXT_PAD, SECTION_RULE)`; header label `bold ${textFontSize}px` at `textX`, baseline `y + round(lineHeight·0.75)`; cost symbols right-aligned at `symbolSize` ending at `textBox.x + textBox.w − TEXT_PAD`; `statLabel` bold right-aligned there instead when present; badges via `stamps.get(code, BADGE)`; text via `drawLines` with each section's `textX`/`textTop`.

- [ ] **Step 1: Write the failing tests.** `fit.test.ts`:

```ts
it('columns: Benalia keeps base text and the widest art column', () => {
  const g = fit(card('benalia'), S, nodeEnv)
  expect(g.kind).toBe('columns'); expect(g.art!.w).toBe(COL_ART_MAX); expect(g.textFontSize).toBe(S.textSize)
  expect(g.typeBar.y + g.typeBar.h).toBe(536 - 8); expect(g.art!.x).toBe(g.textBox.x + g.textBox.w + GAP)
  expect(g.sections!.map((x) => x.badges.map((b) => b.code))).toEqual([[], ['I', 'II'], ['III']])
  expect(g.sections![1].badges[1].rect.y).toBe(g.sections![1].badges[0].rect.y + BADGE + 2)
})
it('columns: Urza\'s Saga shrinks the column before the text and never overflows', () => {
  const g = fit(card('urzas-saga'), S, nodeEnv)
  expect(g.overflow).toBe(false); expect(g.textFontSize).toBeGreaterThanOrEqual(TEXT_MIN)
  expect(g.art === undefined || g.art.w < COL_ART_MAX).toBe(true)
})
it('columns: a leveler puts the card P/T in a stat box and the level P/T in headers', () => {
  const g = fit(card('transcendent-master'), S, nodeEnv)
  expect(g.statBox).toBeDefined(); expect(g.sections![1].header!.statLabel).toBe('6/6')
})
it('columns: a very long class drops the art column before clipping', () => {
  const sheet = { ...card('ranger-class'), sections: card('ranger-class').sections.map((x) => ({ ...x, text: Array(60).fill('word').join(' ') })) }
  const g = fit(sheet as Sheet, S, nodeEnv)
  expect(g.art).toBeUndefined(); expect(g.textBox.w).toBe(384 - 16)
})
```
`renderProxy.test.ts`: a golden loop over `[['saga-benalia', 'benalia', 'bolas'], ['saga-urza', 'urzas-saga', null], ['class-ranger', 'ranger-class', 'rotpriest'], ['case-skeleton', 'case-skeleton', null], ['leveler-master', 'transcendent-master', 'bolt']]` (golden name, fixture, art fixture to reuse; `null` = no art), each asserting `geometry.overflow === false` and `expectGolden`; plus `saga-kami-war-front` from `normalizeScryfall(load('kami-war')).sheets[0]`.

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/core/layout/fit.test.ts src/core/render/renderProxy.test.ts` → FAIL (`not implemented`).
- [ ] **Step 3: Implement `fitColumns.ts` and `paintColumns.ts`**, dispatch from `fit`/`paint`.
- [ ] **Step 4: Run to verify they pass** — same command; the new goldens are written on the first run. Open `tests/golden/saga-benalia.png` and `class-ranger.png` and compare with mockup A: name bar, badges/level headers left, art right, type bar at the bottom. Then `npm test` → PASS, old goldens untouched.
- [ ] **Step 5: Commit** — `git add -A src/core tests/golden && git commit -m "feat(render): side-column geometry for sagas, classes, cases and levelers"`

---

### Task 7: Stacked geometry and paint (adventure, flip, prototype)

**Files:**
- Create: `src/core/layout/fitStacked.ts`, `src/core/render/paintStacked.ts`
- Modify: `fit.ts`, `paint.ts` (dispatch), `fit.test.ts`, `renderProxy.test.ts`
- Create goldens: `tests/golden/{adventure-bonecrusher,flip-bushi,prototype-fleshgorger}.png`

**Interfaces:**
- Produces:
  ```ts
  export interface SubGeometry { box: Rect; nameY: number; typeY?: number; typeFontSize: number; textTop: number; lines: Line[]; statBox?: Rect; headerStat?: string }
  export function fitStacked(sheet: Extract<Sheet, { kind: 'stacked' }>, s: Settings, env: RenderEnv): Geometry
  export function paintStacked(ctx: Ctx2D, sheet: Extract<Sheet, { kind: 'stacked' }>, g: Geometry, s: Settings, stamps: StampCache): void
  ```
  Layout (spec §5.2): main face exactly as the standard fit for a given candidate `(textSize, artH)`, except that when `artH === 0` the type bar follows the name bar directly (`art` undefined). Sub box: `subH = 2·SUB_PAD + lineHeight + (sub.typeLine ? SUB_TYPE_H : 0) + subLines·lineHeight`, `box = { x: MARGIN, y: H − MARGIN − subH, w: innerW, h: subH }`; main `textBox.h = box.y − GAP − textBox.y`. `nameY = box.y + SUB_PAD` (header row: bold `textFontSize` name at `box.x + SUB_PAD`; right side, right-aligned at `symbolSize`, the cost symbols, and when `sub.typeLine === ''` and `sub.stat`, `headerStat = statLabel(sub.stat)` drawn bold 6 dots right of the cost). `typeY = nameY + lineHeight` when `sub.typeLine` is non-empty, type font from `fitTypeFont(ctx, sub.typeLine, family, innerW − 2·SUB_PAD + 16)`. `textTop = typeY ? typeY + SUB_TYPE_H : nameY + lineHeight`. Sub text wraps at `innerW − 2·SUB_PAD`, narrowed on lines overlapping the sub stat box exactly as the main box does (`sub.statBox` bottom-right inside `box`, present when `sub.stat` and `sub.typeLine !== ''`). Both faces' text is stripped of reminder text when the candidate says so. Fits when main lines fit in `textBox` (today's rule, including stat narrowing). Candidates from `stackedCandidates`. Overflow: clip sub lines first (down to 1), then main lines.

- [ ] **Step 1: Write the failing tests.** `fit.test.ts`:

```ts
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
  const g = fit({ ...c, face: { ...c.face, oracleText: Array(130).fill('word').join(' ') } }, S, nodeEnv)
  expect(g.art).toBeUndefined(); expect(g.textFontSize).toBeGreaterThanOrEqual(TEXT_MIN); expect(g.typeBar.y).toBe(g.nameBar.y + g.nameBar.h + GAP)
})
```
`renderProxy.test.ts`: goldens `adventure-bonecrusher` (art `rotpriest`), `flip-bushi` (art `bolt`), `prototype-fleshgorger` (no art), each `overflow === false`.

- [ ] **Step 2: Run to verify they fail** → FAIL (`not implemented`).
- [ ] **Step 3: Implement** `fitStacked.ts`, `paintStacked.ts`, dispatch.
- [ ] **Step 4: Run to verify they pass**; look at `adventure-bonecrusher.png` against mockup C (sub-box with "Stomp {1}{R}" header and "Instant — Adventure" row). `npm test` → PASS.
- [ ] **Step 5: Commit** — `git add -A src/core tests/golden && git commit -m "feat(render): stacked geometry for adventure, flip and prototype cards"`

---

### Task 8: Split geometry and paint

**Files:**
- Create: `src/core/layout/fitSplit.ts`, `src/core/render/paintSplit.ts`
- Modify: `fit.ts`, `paint.ts`, `fit.test.ts`, `renderProxy.test.ts`
- Create goldens: `tests/golden/{split-fire-ice,split-dusk-dawn}.png`

**Interfaces:**
- Produces:
  ```ts
  export interface HalfGeometry { nameBar: Rect; nameFontSize: number; costOnSecondLine: boolean; typeBar: Rect; typeFontSize: number; textBox: Rect; lines: Line[] }
  export function fitSplit(sheet: Extract<Sheet, { kind: 'split' }>, s: Settings, env: RenderEnv): Geometry
  export function paintSplit(ctx: Ctx2D, sheet: Extract<Sheet, { kind: 'split' }>, g: Geometry, s: Settings, stamps: StampCache): void
  ```
  Layout (spec §5.3): half A = `fitNameBar` at `y = MARGIN`, `typeBar` at `+GAP` (`TYPE_H`), `textBox` at `+GAP` with `h = linesA·lineHeight + 2·TEXT_PAD`; then `GAP` and, if `artH > 0`, `art = { x: MARGIN, y, w: innerW, h: artH }` and another `GAP`; half B the same three blocks; the sheet fits when half B's `textBox` bottom ≤ `H − MARGIN`. Both halves wrap at `innerW − 2·TEXT_PAD` at one shared text size; no stat boxes. `Geometry.nameBar/typeBar/textBox/textLines/nameFontSize/costOnSecondLine/typeFontSize` describe half A; `second` describes half B. Candidates from `splitCandidates`. Overflow (last candidate): total available lines `T = floor((H − MARGIN − fixedHeights) / lineHeight)`; `linesB = max(1, min(linesB, T − linesA))`, `linesA = min(linesA, T − linesB)`; `overflow = true`. Half B's text box is bottom-aligned to `H − MARGIN` only through its own height, i.e. blocks flow top to bottom, leaving any slack at the bottom.

- [ ] **Step 1: Write the failing tests.** `fit.test.ts`:

```ts
it('split: Fire // Ice is two halves with the art between them', () => {
  const g = fit(card('fire-ice'), S, nodeEnv)
  expect(g.kind).toBe('split'); expect(g.art!.h).toBe(SPLIT_ART_MAX); expect(g.textFontSize).toBe(S.textSize)
  expect(g.art!.y).toBe(g.textBox.y + g.textBox.h + GAP); expect(g.second!.nameBar.y).toBe(g.art!.y + g.art!.h + GAP)
  expect(g.second!.textBox.y + g.second!.textBox.h).toBeLessThanOrEqual(536 - 8); expect(g.statBox).toBeUndefined()
})
it('split: long halves drop the art before text goes below 14 px', () => {
  const c = card('fire-ice') as Extract<Sheet, { kind: 'split' }>
  const long = Array(70).fill('word').join(' ')
  const g = fit({ kind: 'split', halves: [{ ...c.halves[0], oracleText: long }, { ...c.halves[1], oracleText: long }] }, S, nodeEnv)
  expect(g.art).toBeUndefined(); expect(g.textFontSize).toBeGreaterThanOrEqual(TEXT_MIN); expect(g.overflow).toBe(false)
})
```
`renderProxy.test.ts`: goldens `split-fire-ice` (art `bolt`) and `split-dusk-dawn` (no art), `overflow === false`.

- [ ] **Step 2: Run to verify they fail** → FAIL.
- [ ] **Step 3: Implement** `fitSplit.ts`, `paintSplit.ts` (two name bars and two type bars through `parts.ts`), dispatch.
- [ ] **Step 4: Run to verify they pass**; compare `split-fire-ice.png` with mockup C's Fire // Ice. `npm test` → PASS.
- [ ] **Step 5: Commit** — `git add -A src/core tests/golden && git commit -m "feat(render): two-half geometry for split and aftermath cards"`

---

### Task 9: Fold pair output: rotate180, fold guide, sheetFrames

**Files:**
- Create: `src/core/output/rotate.ts`, `src/core/output/rotate.test.ts`, `src/core/output/foldGuide.ts`, `src/core/output/foldGuide.test.ts`, `src/core/printer/sheets.ts`, `src/core/printer/sheets.test.ts`
- Modify: `src/core/printer.ts`, `scripts/make-run-check.ts`, `src/core/render/renderProxy.test.ts` (fold-pair goldens)
- Create goldens: `tests/golden/{transform-delver-front,transform-delver-back,mdfc-valki-front,mdfc-valki-back,battle-gobakhan-front,battle-gobakhan-back,meld-battlements-front,meld-battlements-back,saga-kami-war-back}.png`

**Interfaces:**
- Produces:
  ```ts
  export function rotate180(b: BitImage): BitImage                 // new buffer; (x, y) -> (w-1-x, h-1-y)
  export const FOLD_GUIDE_ROWS = 16                                 // core/printer.ts
  export function foldGuide(width: number): BitImage                // FOLD_GUIDE_ROWS tall, all white except: row 8 dashed (8 on / 8 off, starting on), and rows 7..8 black at x < 2 and x >= width - 2 (edge ticks)
  /** Frames for one proxy card: raster(sheets[0]) [+ raster(foldGuide) + raster(rotate180(sheets[1]))] + escposFeed(gapAfter). No ESC @. */
  export function sheetFrames(sheets: BitImage[], gapAfter: number): Uint8Array[]
  ```

- [ ] **Step 1: Write the failing tests.** `rotate.test.ts`: a 3×2 image with one black dot at (0,0) rotates to (2,1); `rotate180(rotate180(x))` equals `x`; width/height preserved. `foldGuide.test.ts`: height `FOLD_GUIDE_ROWS`, width 384; row 8 has exactly 192 black dots (8 on / 8 off) plus the ticks make dots (0,8) and (383,8) black; row 7 has exactly 4 black dots (the ticks); rows 0 and 15 are all white; `toPacked(foldGuide(384)).length === 48 * FOLD_GUIDE_ROWS`. `sheets.test.ts`: for one 384×3 sheet the frames are `[...escposRasterFrames(packed, 384, 3), escposFeed(2)]` (deep equal); for two sheets the frame list is raster(A) frames, then raster(foldGuide) frames, then raster(rotate180(B)) frames, then the feed, with no `0x1b 0x40` anywhere. `renderProxy.test.ts`: fold-pair goldens from `normalizeScryfall(load(n)).sheets[i]` for delver (arts `bolt`/`rotpriest`), valki (no art), gobakhan (no art), hanweir-battlements via `attachMeldBack(…, load('hanweir-township'))` (no art), kami-war back (no art); all `overflow === false`.

- [ ] **Step 2: Run to verify they fail** → FAIL (modules missing).
- [ ] **Step 3: Implement** the three modules and the constant; in `make-run-check.ts` add a third file `tmp/run-check/fold-pair.bin` = `escposInit()` + `sheetFrames([delverFront, delverBack], FEED_LINES_AFTER)` and a printed instruction to fold along the dashed line and check that the back reads upright when the card is turned over around its long edge.
- [ ] **Step 4: Run** — `npm test && npm run typecheck && npm run check:run` → PASS; `tmp/run-check/fold-pair.bin` exists.
- [ ] **Step 5: Commit** — `git add -A src/core scripts tests/golden && git commit -m "feat(output): rotate180, fold guide and sheetFrames for fold pairs"`

---

### Task 10: Data layer: fetchCardById, half-name matching, name index filter

**Files:**
- Modify: `src/data/scryfall.ts`, `src/data/scryfall.test.ts`, `src/data/fuzzy.ts`, `src/data/fuzzy.test.ts`, `scripts/build-name-index.ts`, `scripts/build-name-index.test.ts`, `tests/fixtures/oracle-sample.jsonl`
- Modify: `docs/superpowers/specs/2026-10-12-hot-proxies-design.md` (§3 "Layouts" row and §4.1 to say "every layout except the excluded set; see 2026-10-17-card-layouts-design.md")

**Interfaces:**
- Produces: `ScryfallClient.fetchCardById(id: string): Promise<unknown>` — GET `${API}/cards/${id}`, cache key `card:id:${id}`, 404 → `CardNotFound(id)`, other non-OK → `NetworkError`. `createMatcher(names)` additionally indexes each half of a name containing `' // '` (normalised) as an alias that resolves to the full name; results are de-duplicated by full name. `buildNameIndex` keeps a card when `!EXCLUDED_LAYOUTS.has(layout) && !['token','double_faced_token','emblem'].includes(layout) && !EXCLUDED_SET_TYPES.has(set_type)`; import `EXCLUDED_LAYOUTS` from `src/core/card/normalize.ts`.

- [ ] **Step 1: Write the failing tests.** `scryfall.test.ts`: `fetchCardById` hits `/cards/<id>` once, caches, maps 404. `fuzzy.test.ts`: `createMatcher(['Fire // Ice', 'Bonecrusher Giant // Stomp', 'Lightning Bolt']).search('stomp')` → `['Bonecrusher Giant // Stomp']`; `search('ice')` returns `'Fire // Ice'` once; `search('fire //')` still finds it. `build-name-index.test.ts`: append to `oracle-sample.jsonl` one line each from `benalia.json`, `fire-ice.json`, `plane.json` and a `layout: "token"` object (minimal: `name`, `layout`, `set_type`); assert the saga and the split name are kept, the plane and the token are not.

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/data scripts` → FAIL.
- [ ] **Step 3: Implement**, and update the two spec rows in the phase 1 design.
- [ ] **Step 4: Run** — `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(data): fetchCardById, half-name matching, name index keeps every supported layout"`

---

### Task 11: loadCard and per-sheet resolveArt

**Files:**
- Create: `src/app/loadCard.ts`, `src/app/loadCard.test.ts`
- Modify: `src/app/resolveArt.ts`, `src/app/resolveArt.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface LoadedCard { card: ProxyCard; meldFailed: boolean }
  /** fetchCard + normalizeScryfall; for a meld part also fetchCardById(meldResult) + attachMeldBack. A failed second fetch gives meldFailed: true and a one-sheet card. */
  export async function loadCard(services: Services, name: string): Promise<LoadedCard>
  export interface ResolvedArt { art: GreyImage | null; failed: boolean }
  /** One entry per sheet. Sheet 0 uses the remembered printing ref; sheet 1 of a non-meld pair uses `${ref}:1`; a meld back ignores the preference. Each falls back to its first face's artUrl, then to null. */
  export async function resolveArt(services: Services, card: ProxyCard): Promise<ResolvedArt[]>
  ```

- [ ] **Step 1: Write the failing tests.** `loadCard.test.ts` (node env, `fakeServices`): "Lightning Bolt" → one sheet, `meldFailed: false`; "Hanweir Battlements" → two sheets, back face named "Hanweir, the Writhing Township"; with `fetchCardById` rejecting → one sheet, `meldFailed: true`; "Academy at Tolaria West" rejects with `UnsupportedLayout`. `resolveArt.test.ts`: for the delver card with a remembered ref `abc…` (32 hex), `fetchArtById` is called with `ref` then `ref:1` and both sheets get art; when the `:1` fetch throws, sheet 1 falls back to `fetchArtBlob(face.artUrl)` (`failed: false`); when both fail, `{ art: null, failed: true }`; a meld card's back calls `fetchArtBlob` with the township's `artUrl`, never `fetchArtById`.

- [ ] **Step 2: Run to verify they fail** → FAIL.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4: Run** — `npx vitest run src/app/loadCard.test.ts src/app/resolveArt.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/app/loadCard.ts src/app/loadCard.test.ts src/app/resolveArt.ts src/app/resolveArt.test.ts && git commit -m "feat(app): loadCard with meld back, per-sheet art resolution"`

---

### Task 12: Card mode renders and prints every sheet

**Files:**
- Modify: `src/app/useProxy.ts`, `src/app/useProxy.test.tsx`, `src/app/useProxy.art.test.tsx`, `src/app/usePrinter.ts`, `src/app/usePrinter.test.tsx`, `src/app/App.tsx`, `src/app/App.test.tsx`, `src/app/useTokens.ts` (print through `sheetFrames([bits], …)` per copy; behaviour unchanged)

**Interfaces:**
- Produces:
  ```ts
  // useProxy return value
  { state; card: ProxyCard | null; renders: { bits: BitImage; geometry: Geometry }[]; errors: Error[]; render(name); artRef; chooseArt(ref); prints; printsError; loadPrints() }
  // usePrinter
  print(sheets: BitImage[]): Promise<void>     // frames = [escposInit(), ...sheetFrames(sheets, FEED_LINES_AFTER)]
  ```
  `useProxy.render` uses `loadCard` then `resolveArt`; `errors` gains `MeldUnavailable` when `meldFailed`, `ArtUnavailable` when any sheet `failed`. `chooseArt` re-resolves every sheet. `App.tsx`: one `EditablePreview` per render inside a `Stack` (`direction={{ xs: 'column', sm: 'row' }}`), captions "Front" / "Back" (`Typography variant="caption"`) only when there are two; the `art` hotspot enabled on the first preview only; one Print control (pass `print` to the first preview only) calling `printer.print(renders.map((r) => r.bits))`; overflow alerts per sheet: "Rules text was clipped to fit." for one sheet, "Rules text on the front/back was clipped to fit." for a pair.

- [ ] **Step 1: Write the failing tests.** `useProxy.test.tsx`: rendering "Delver of Secrets" gives `renders.length === 2`, each 384×536; "Hanweir Battlements" with `fetchCardById` rejecting gives one render and an error whose message is "Melded side could not be loaded.". `usePrinter.test.tsx`: `print([small, small])` writes `escposInit()` first and the concatenated writes contain the fold guide's packed bytes and no second `1b 40`; `print([small])` byte stream equals today's `encodeEscPosFrames` stream. `App.test.tsx`: picking a two-faced fixture shows two `preview` test ids and captions "Front" and "Back"; a one-sheet card shows no captions.

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/app` → FAIL.
- [ ] **Step 3: Implement**; the inline `services` objects in `useProxy.test.tsx` and `usePrinter.test.tsx` gain `fetchCardById`.
- [ ] **Step 4: Run** — `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(app): Card mode previews and prints every sheet of a card"`

---

### Task 13: Deck mode with fold pairs

**Files:**
- Modify: `src/core/deck/run.ts` (`DeckCard.card: ProxyCard; arts: (GreyImage | null)[]`), `src/core/deck/run.test.ts` (its `DeckCard` literals), `src/app/useDeck.ts`, `src/app/useDeck.test.tsx`, `src/app/DeckStrip.tsx`, `src/app/DeckStrip.test.tsx`, `src/app/DeckPanel.tsx`, `src/app/DeckPanel.test.tsx`

**Interfaces:**
- Produces: `DeckThumb { bits: BitImage[]; overflow: boolean; artMissing: boolean; meldFailed: boolean }`; verify uses `loadCard` + `resolveArt`; the render effect calls `renderProxy` per sheet; `packedRef` caches `Uint8Array[]` per key; the print loop builds `[init?, ...sheetFrames(thumb.bits, last ? FEED_LINES_AFTER : FEED_LINES_BETWEEN_CARDS)]`; `markPrinted` only after the whole item's job resolves. `DeckStrip`: thumb shows `bits[0]`, a `Chip label="2 sheets"` bottom-left when `bits.length === 2`; `warningText` adds `'melded side missing'`. `DeckPanel` preview dialog shows one `Preview` per sheet.

- [ ] **Step 1: Write the failing tests.** `useDeck.test.tsx`: `'1 Bonecrusher Giant\n1 Fire // Ice\n1 Delver of Secrets'` verifies to `ready` with three cards, three items, `issues === null`, and `thumbs.get(<delver key>)!.bits.length === 2`; printing that run writes exactly one `1b 40` and the fold-guide bytes once; with the fake printer's `write` replaced by a wrapper that delegates for the first 60 chunks and then calls `printer.set('disconnected')` and throws (the drop lands after the first sheet of the Delver pair, which prints last), the Delver item stays `pending`, `progress().printed` is unchanged, the hook is `paused`, and after `printer.set('connected')` a second `print()` writes `escposInit()` and the fold-guide bytes again. `DeckStrip.test.tsx`: a two-sheet thumb shows "2 sheets"; a `meldFailed` thumb's warning includes "melded side missing". `DeckPanel.test.tsx`: opening a two-sheet card shows two previews.

- [ ] **Step 2: Run to verify they fail** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(deck): fold pairs print as one item with a fold guide; two-sheet thumbs"`

---

### Task 14: Name index, docs, final verification

**Files:**
- Modify: `public/names.json` (regenerated), `CLAUDE.md`, `docs/superpowers/specs/2026-10-17-card-layouts-design.md` (status line only if anything was settled differently)

- [ ] **Step 1: Regenerate `public/names.json`** (network; ~150 MB download, gitignored):

```bash
url=$(curl -sS -A hot-proxies -H "Accept: application/json" https://api.scryfall.com/bulk-data/oracle-cards | python -I -c "import json,sys; print(json.load(sys.stdin)['download_uri'])")
curl -sS -A hot-proxies "$url" -o oracle-cards-bulk.json
python -I -c "import json; [print(json.dumps(c, ensure_ascii=False)) for c in json.load(open('oracle-cards-bulk.json', encoding='utf-8'))]" > oracle-cards-$(date +%Y%m%d%H%M%S).jsonl
rm oracle-cards-bulk.json
npm run build:names -- oracle-cards-*.jsonl
python -I -c "import json; n=json.load(open('public/names.json', encoding='utf-8')); print(len(n), 'History of Benalia' in n, 'Fire // Ice' in n, 'Bonecrusher Giant // Stomp' in n, any(x.startswith('Academy at Tolaria') for x in n))"
```
Expected: count above the previous ~33,000; `True True True False`.

- [ ] **Step 2: Update `CLAUDE.md`**: in "What this is" replace the `normal`-only sentence; in Architecture add a bullet "**Layouts** — `core/card/normalize.ts` maps every standard-size Scryfall layout to a `ProxyCard` of one or two `Sheet`s (`standard | columns | stacked | split`); `layout/fitColumns|fitStacked|fitSplit` and `render/paint*` are the per-kind paths behind `renderProxy(sheet, …)`; fold pairs print through `printer/sheets.ts` (`sheetFrames`: fold guide + `rotate180` back). Design: `docs/superpowers/specs/2026-10-17-card-layouts-design.md`."; in "Design decisions" replace "Only Scryfall `normal` layout is supported…" with the excluded-layouts rule and "readability beats art, art is dropped before text goes below 14 px"; mention `FOLD_GUIDE_ROWS` next to the other printer constants.

- [ ] **Step 3: Full verification** — `npm test && npm run typecheck && npm run build` → all PASS, `dist/` built. `git status` shows only intended files; `tests/golden/__diff__/` is empty or absent.

- [ ] **Step 4: Commit** — `git add public/names.json CLAUDE.md docs && git commit -m "chore: regenerate names.json for every supported layout; document the layout pipeline"`

---

## Self-review notes

- Spec coverage: §1 criteria → Tasks 6–8 (renders), 9 + 12 + 13 (fold pairs, deck counts), 10 + 14 (index, "stomp"/"ice"), 4 (excluded message); §3 → Task 1; §4 → Tasks 2, 4, 11; §5 → Tasks 5–8; §6 → Task 9; §7 → Tasks 10–13; §8 fixtures and tests → spread over Tasks 1–13; §8.1 → Task 14 (mockup already committed); §9 unchanged.
- Types: `Sheet`, `ProxyCard`, `Face`, `Stat`, `statLabel`, `standardSheet` (Task 1) are used by that name throughout; `SectionGeometry`/`SubGeometry`/`HalfGeometry` are defined in the task that first fills them and declared optional on `Geometry` in Task 3; `sheetFrames(sheets, gapAfter)` (Task 9) is what Tasks 12 and 13 call; `resolveArt` returns an array from Task 11 on; `fetchCardById` is declared in Task 4 and implemented in Task 10.
- Review Focus tests live in Tasks 2, 4, 11, 13 (two).

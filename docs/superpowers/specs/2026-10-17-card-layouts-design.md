# Card layouts: sagas, classes and multi-face cards

Date: 2026-10-17
Status: implemented. Settled differently: leveler stat box narrows its lines; first saga badge centred on the first text line; art preference keyed on the full card name.

Builds on `2026-10-12-hot-proxies-design.md` (pipeline, fit, settings),
`2026-10-15-deck-printing-design.md` (print run loop, verify) and
`2026-10-17-tokens-mode-design.md` (art picker, art refs). Where this document
and §3 "Layouts: normal only" or §9 of the first design disagree, this one
wins; the builder updates that table row to point here.

## 1. Goal

Print any Magic card that fits on a standard card, not only the `normal`
layout. Today the normaliser rejects every other Scryfall layout and the
autocomplete index never offers those names, so a saga, a class, an adventure
or a transform card cannot be printed at all.

After this work:

- Sagas, Classes, Cases and levelers render with a **side-column** geometry:
  name bar on top, rules text in a left column with chapter badges or level
  headers, art in a right column, type bar at the bottom (the real card's
  silhouette).
- Adventure and flip cards render as **one proxy with both halves stacked**:
  the main face in the standard geometry, the second face in a sub-box
  underneath. Split cards (including aftermath) render as **two symmetric
  half-cards on one proxy**, each with its own name bar, type bar and text,
  the shared art between them.
- Transform, modal double-faced, meld and battle cards print as a **fold
  pair**: front face, a fold guide, then the back face rotated 180°, on one
  uncut strip. Folded along the guide, the strip is a double-thickness proxy
  that reads correctly when flipped like a real double-faced card.
- Prototype cards get a sub-box with the prototype cost and size; mutate cards
  are ordinary cards.
- The name index offers every supported card, and a two-faced name matches on
  either half.
- Oversized and silver-border oddities (planes, schemes, vanguard, art series,
  augment/host) still raise `UnsupportedLayout`, with a message that says why.

### Success criteria

- "History of Benalia", "Ranger Class", "Case of the Stashed Skeleton" and
  "Transcendent Master" render in the column geometry with every chapter or
  level readable at 14 px or more and the art column present.
- "Urza's Saga" (three long chapters) renders without overflow, dropping the
  art column if it has to.
- "Bonecrusher Giant // Stomp", "Fire // Ice", "Dusk // Dawn" and "Bushi
  Tenderfoot // Kenzo the Hardhearted" render on one proxy with both halves
  complete.
- "Delver of Secrets // Insectile Aberration", "Valki, God of Lies // Tibalt,
  Cosmic Impostor", "Invasion of Gobakhan // Lightshield Array" and "Hanweir
  Battlements" print as fold pairs in Card and Deck mode; the back face comes
  out upside down relative to the front, and folding the strip gives a proxy
  whose back reads upright when the card is turned over around its long edge.
- "The Kami War // O-Kagachi Made Manifest" (a transform saga) prints a
  column-geometry front and a standard back.
- A deck list containing `1 Bonecrusher Giant`, `1 Fire // Ice` and
  `1 Delver of Secrets` verifies without issues; the run counts three cards
  and prints four sheets.
- Typing "stomp" or "ice" in Card mode offers the full two-faced names.
- Every existing golden render is unchanged.

## 2. Decisions and constraints

| Topic | Decision |
|---|---|
| Sagas, Classes, Cases, levelers | Side-column geometry (user's pick, mockup A). Text column left, art column right, type bar at the bottom. |
| Adventure, flip | One stacked proxy (user's pick, mockup C). Main face standard, second face in a sub-box. Flip's second half is drawn upright, not rotated: readability beats fidelity (my call). |
| Split, aftermath | One proxy with two symmetric halves and the shared art between them (user's pick, mockup C). Aftermath keeps the graveyard half second. |
| Transform, modal DFC, battle | Fold pair: front, fold guide, back rotated 180° (user's idea). |
| Meld | Each meld part prints as a fold pair whose back is the full melded card, so no third sheet is needed. The melded card looked up by its own name prints as a single standard card (my call). |
| Prototype | Standard geometry plus a sub-box holding the prototype cost and P/T (my call). |
| Mutate, reversible cards | Standard geometry; a reversible card prints its front face only (my call). |
| Face arrangement vs. face style | The Scryfall `layout` decides how many sheets and whether a sheet is stacked. The style of each face (column or standard) is decided from the face itself, so a transform saga gets columns on the front. |
| Excluded | `planar`, `scheme`, `vanguard`, `art_series`, `augment`, `host`. `UnsupportedLayout` stays, message reworded. |
| Rotation | A pure `rotate180(BitImage)` in core; preview shows the back upright, only the printed stream is rotated. |
| Fold guide | A short raster block with a dashed line, printed between the two sheets with no feed; the cut gap after the pair is the existing between-cards feed. |
| Art preference | Still one remembered printing per card name. A fold pair's back uses the `:1` ref of the same printing. |
| Settings | None added. Column and sub-box sizes derive from the existing text and art ranges. |
| Tokens mode | Unchanged: tokens remain single-face standard sheets. |

## 3. Vocabulary and data model

A **face** is what Scryfall calls a face: name, cost, type line, rules text,
stat, art. A **sheet** is one printed 384 × 536 bitmap. A **proxy card** is
everything printed for one card name: one sheet, or a fold pair of two.

```ts
// core/card/types.ts
export type Stat =
  | { kind: 'pt'; power: string; toughness: string }
  | { kind: 'loyalty'; value: string }
  | { kind: 'defense'; value: string }          // battles

export interface Face {                           // today's CardData, renamed
  name: string; manaCost: string; typeLine: string; oracleText: string
  stat?: Stat; artUrl?: string
}

export interface Section {                        // one block of a column sheet
  header?: { label: string; cost?: string; stat?: Stat }   // "Level 2" {1}{G}, "To solve", "LEVEL 6-11" 6/6
  badges?: string[]                                         // chapter numerals: ["I", "II"]
  text: string                                              // paragraphs separated by "\n"
}

export type Sheet =
  | { kind: 'standard'; face: Face }
  | { kind: 'columns'; face: Face; sections: Section[] }    // face.oracleText keeps the raw text
  | { kind: 'stacked'; face: Face; sub: Face }              // adventure, flip, prototype
  | { kind: 'split'; halves: [Face, Face] }                  // split, aftermath

export interface ProxyCard {
  name: string                                   // Scryfall's full name, "Fire // Ice"
  sheets: [Sheet] | [Sheet, Sheet]               // two = fold pair, index 1 is the back
  meldResult?: string                            // Scryfall id of the melded card, until attached
}
```

`CardData` stays as a type alias of `Face` while the rename propagates, so
Tokens mode compiles unchanged; `TokenDraft` produces a standard sheet.

## 4. Normalisation

`normalizeScryfall(json): ProxyCard` in `core/card/normalize.ts` stays pure.
Per Scryfall layout:

| Layout | Sheets | Source of each face |
|---|---|---|
| `normal`, `mutate`, `reversible_card` | 1 standard | top-level fields (`card_faces[0]` for reversible) |
| `saga`, `class`, `case`, `leveler` | 1 columns | top-level fields, sections parsed from `oracle_text` (§4.1) |
| `prototype` | 1 stacked | top-level fields; sub = Prototype line (§4.1) |
| `adventure`, `flip` | 1 stacked | `card_faces[0]` main, `card_faces[1]` sub; art from the top-level `image_uris` |
| `split` | 1 split | `card_faces[0]` and `card_faces[1]` as the halves; art from the top-level `image_uris` |
| `transform`, `modal_dfc` | 2 | `card_faces[0]` front, `card_faces[1]` back, each with its own `image_uris`; each face styled by §4.2 |
| `meld` | 1 or 2 | top-level fields. If `all_parts` has a `meld_result` whose name differs from this card, `meldResult` is set and the back is attached later (§4.3). |
| `token`, `double_faced_token`, `emblem` | 1 standard | as `normal` (they only reach Card mode through the deck list; Tokens mode has its own path) |
| anything else | throw `UnsupportedLayout` | message: "X uses the 'planar' layout; oversized and Un-set cards are not supported." |

Battles are `transform` cards whose front has `defense`; the stat kinds are
`pt` if power and toughness exist, else `loyalty`, else `defense`. The
combined type line ("Creature — Human Wizard // Creature — Human Insect") and
`color_indicator` are not used.

### 4.1 Section parsing (pure, `core/card/sections.ts`)

Scryfall's oracle text has a stable shape for each of these; the parser works
on paragraphs (split on `\n`) and must not lose text: any paragraph it does not
recognise is appended to the current section's text.

- **Saga.** Paragraph 0 is the reminder "(As this Saga enters …)": it becomes
  the text of a header-less first section, so `stripReminder` removes it as
  usual. Each paragraph matching `^((?:[IVX]+)(?:, [IVX]+)*) — (.*)$` (em dash
  U+2014) starts a section with `badges` = the numerals and `text` = the rest.
  Two sagas with read-ahead chapters like "The Kami War" follow the same
  pattern.
- **Class.** Paragraph 0 is the reminder; it and the following paragraphs up
  to the first level line form the first section (no header: real cards do
  not label level 1). A paragraph matching `^(\{.*\}): Level (\d+)$` starts a
  section with `header = { label: "Level N", cost }`.
- **Case.** Paragraphs before "To solve —" form the first section (no
  header). `^To solve — (.*)$` and `^Solved — (.*)$` start sections with those
  labels; the rest of the line is the first paragraph of the section.
- **Leveler.** Paragraph 0 ("Level up {1} (…)") is the first section's text.
  `^LEVEL (\d+(?:-\d+|\+))$` starts a section with `header.label` = "LEVEL
  6-11"; if the next paragraph matches `^(\d+|\*)/(\d+|\*)$` it becomes the
  header's `stat` and is not repeated in the text. The card's own P/T is the
  level-0 stat and goes in the usual stat box.
- **Prototype.** Paragraph 0 matches
  `^Prototype (\{.*\}) — (\S+)/(\S+)(?: \((.*)\))?$`. The sub face is
  `{ name: "Prototype", manaCost, typeLine: "", oracleText: reminder, stat }`;
  the main face's text is the remaining paragraphs.

If paragraph 0 does not match the expected reminder, nothing is lost: it is
ordinary text of the first section.

### 4.2 Face style

For a single face (including each face of a fold pair):

- type line contains "Saga" → columns with saga parsing;
- type line contains "Class" → columns with class parsing;
- type line contains "Case" (as a word) → columns with case parsing;
- top-level layout `leveler` → columns with leveler parsing;
- otherwise standard.

Only the single-face layouts above are ever parsed, so a creature whose name
contains "Case" is unaffected: the check is on the type line.

### 4.3 Meld

`normalizeScryfall` cannot fetch. `app/loadCard.ts` wraps fetch + normalise
for Card and Deck mode: it calls `fetchCard`, normalises, and when
`meldResult` is set it fetches that card by id (`ScryfallClient.fetchCardById`,
new, cached like `fetchCard`) and calls `attachMeldBack(card, resultJson)`
(pure, in core) which appends the melded card's standard sheet and clears
`meldResult`. If the second fetch fails, the card prints as a single sheet and
the UI shows an info alert "Melded side could not be loaded."

## 5. Geometry and fit

All values in dots; constants join `core/layout/constants.ts`. `Geometry`
gains `kind` and the optional parts below; existing fields keep their meaning
so `paint`, `EditablePreview` hotspots and Tokens mode keep working. `art`
becomes optional: a sheet whose art was dropped has no art rect.

```ts
interface Geometry {
  kind: 'standard' | 'columns' | 'stacked' | 'split'
  card; nameBar; nameFontSize; costOnSecondLine; costSymbolSize
  art?: Rect; typeBar; typeFontSize
  textBox; textFontSize; lineHeight; symbolSize; textLines   // columns: the text column; stacked/split: the first face's text box
  statBox?
  sections?: SectionGeometry[]          // columns
  sub?: SubGeometry                     // stacked
  second?: HalfGeometry                 // split: the lower half
  overflow; strippedReminder
}
interface SectionGeometry { header?: { y: number; costX: number; statX: number }; badges?: Rect[]; top: number; lines: Line[] }
interface SubGeometry { box: Rect; nameY: number; typeY: number; textTop: number; lines: Line[]; statBox?: Rect }
interface HalfGeometry { nameBar: Rect; nameFontSize: number; costOnSecondLine: boolean; typeBar: Rect; typeFontSize: number; textBox: Rect; lines: Line[] }
```

### 5.1 Columns

```
MARGIN, name bar (as today)
GAP
+----------------------------+--------------+
| text column                | art column   |   height = H - MARGIN*2 - nameBar.h - TYPE_H - 2*GAP
| sections …                 | (cover crop) |
+----------------------------+--------------+
GAP
type bar (TYPE_H), MARGIN
```

Constants: `COL_ART_MAX = 150`, `COL_ART_MID = 120`, `COL_ART_MIN = 80`,
`COL_ART_STEP = 10`, `BADGE = 22` (badge diameter), `BADGE_GUTTER = 28`
(badge column width inside the text column), `SECTION_GAP = 6`,
`SECTION_RULE = 1` (hairline between sections).

Inside the text column each section is laid out top to bottom:

- **header row** (if any): one `lineHeight` tall, bold text-size label at the
  left, cost symbols right-aligned, or the level stat right-aligned in bold.
  A `SECTION_RULE` line runs across the column above every header.
- **badges** (saga): one `BADGE` circle per numeral stacked vertically at the
  left of the gutter, numeral drawn as literal text through the symbol stamp
  cache (which already renders unknown codes as text in a circle). The
  section's text is wrapped to `column width - BADGE_GUTTER` and starts at the
  same top as the first badge; the section is at least as tall as its badges.
- **text**: wrapped with the shared text size; the first section (the reminder
  paragraph) wraps to the full column width.
- `SECTION_GAP` between sections.

The art column is a single rect from the top of the text column to its
bottom, so the crop is tall; Scryfall's `art_crop` for sagas is already a
portrait crop, and for Classes it is landscape and will be centre-cropped
by the existing cover-fit in `prepareArt`.

**Fit order** (same spirit as spec §5.5, readability beats art):

1. Text at base size, art column 150. Fits? Done.
2. Art column down in steps of 10 to 120.
3. Text down 1 px at a time to 14 with the column at 120.
4. Art column down to 80.
5. Strip reminder text (if not already) and go to 3.
6. Drop the art column: text column takes the full inner width, `art`
   undefined. Retry from base text size down to 14.
7. Text down to 11. Still too tall: clip the last section's lines and set
   `overflow`.

"Fits" means the stacked sections' total height ≤ the column height minus
`2 * TEXT_PAD`. Stat box: a column card with a stat (levelers) keeps the
standard bottom-right stat box inside the text column; the wrapper narrows the
last lines as today.

### 5.2 Stacked

The standard geometry with a sub-box inserted between the text box and the
bottom margin:

```
name bar / art / type bar / text box (+ stat)      <- main face, as today
GAP
+------------------------------------------+
| Stomp                          {1}{R}    |  header: bold text-size name, cost right-aligned
| Instant — Adventure                      |  type: bold TYPE_MIN..TYPE_SIZE, shrinks like the type bar
| Damage can't be prevented this turn …    |  text, shared text size, stat box bottom-right if any
+------------------------------------------+
MARGIN
```

Constants: `SUB_PAD = TEXT_PAD`, `SUB_HEADER_H = lineHeight`, `SUB_TYPE_H =
TYPE_H - 6`. Sub-box height = header + type + lines × lineHeight + 2 × SUB_PAD;
when `sub.typeLine` is empty (prototype) the type row is omitted and the
header's stat (P/T) is drawn right of the cost. The sub face's name bar text
is the face name only ("Stomp", "Ice", "Kenzo the Hardhearted").

Fit order: the §5.5 candidate list runs unchanged with "fits" meaning main
lines + sub-box height ≤ the space under the type bar, with one extra phase:
after step 5 (strip reminder) and before text goes below 14, **drop the art**
(`art` undefined, art height 0). For split cards the art is shared by two
spells and goes first; dropping it is expected on long pairs. Overflow clips
the sub text first, then the main text.

Flip cards: `sub` is the flipped face, drawn upright.

### 5.3 Split

Two half-cards of equal rank, top to bottom, with the shared art between them
(mockup C, Fire // Ice):

```
MARGIN
name bar (first half, as the standard name bar: face name, cost right)
GAP, type bar (TYPE_H), GAP
text box (first half)
GAP
art (SPLIT_ART_MAX .. SPLIT_ART_MIN, or absent)
GAP
name bar (second half), GAP, type bar, GAP
text box (second half)
MARGIN
```

Constants: `SPLIT_ART_MAX = 120`, `SPLIT_ART_MIN = 60`, `SPLIT_ART_STEP = 10`.
Both halves share one text size. Each text box is sized to its wrapped lines
plus `2 * TEXT_PAD`; neither half has a stat box (split cards are never
creatures). Each name bar fits its own face name and cost with the standard
name rules.

Fit order: text at base size with art 120; art down in steps of 10 to 60;
text down to 14; strip reminder text; drop the art (`art` undefined); text
down to 11; clip the second half's lines first, then the first half's, and set
`overflow`. Aftermath cards keep `card_faces[1]` (the graveyard half) as the
lower half, as on the real card.

### 5.4 Standard

Unchanged. The existing golden renders must stay bit-identical.

## 6. Painting and output

- `paint` dispatches on `geometry.kind`; split paints two name bars and two
  type bars with the existing name-bar and type-bar code. Column headers use the bold text
  font; badge numerals go through the stamp cache (`stamps.get('II', BADGE)`).
  Hairline section rules are 1 dot and drawn with `fillRect`, not stroked, so
  they survive thresholding.
- `core/output/rotate.ts`: `rotate180(bits: BitImage): BitImage` (pure, with a
  test that two applications give the input back and that the corner dot
  moves to the opposite corner).
- `core/output/foldGuide.ts`: `foldGuide(width): BitImage` of
  `FOLD_GUIDE_ROWS = 16` rows, white except a dashed 1-dot line on the middle
  row (8 on, 8 off) and a 2-dot black tick at each edge. Printed as raster
  between the sheets, no `ESC d`, so the fold position is exact. Tune the row
  count on the real printer, like `FEED_LINES_AFTER` was.
- `core/printer.ts` gets `FOLD_GUIDE_ROWS`.
- Printing one proxy card (`core/printer/sheets.ts`, pure):
  `sheetFrames(bits: BitImage[], gapAfter: number): Uint8Array[]` =
  raster(bits[0]) [+ raster(foldGuide) + raster(rotate180(bits[1]))] +
  `escposFeed(gapAfter)`. Card mode prepends `escposInit()`; Deck and Tokens
  mode keep their one-init-per-run rule and use the same helper.

Why 180° and not a mirror: folding the strip backwards along the guide is a
rotation about the fold line; viewing the back after turning the card over
around its long edge mirrors x again. The two together are a point
reflection, i.e. a 180° rotation of the printed image.

## 7. Data and app layer

- **Scryfall client.** `fetchCardById(id)` (cached `card:id:<id>`).
  `fetchPrints(name)` is unchanged; Scryfall's exact-name search accepts the
  full "A // B" name. `printingOf` already takes the front face's art.
- **Art per sheet.** `resolveArt(services, card: ProxyCard): ResolvedArt[]`,
  one entry per sheet. Preferred printing `ref` → sheet 0 uses `ref`, sheet 1
  of a fold pair uses `ref` with `:1` (`artRef(id, 1)`). Without a preference,
  each sheet uses its face's `artUrl`. A meld back has its own card id, so its
  default art is the melded card's crop and the preference does not apply to
  it.
- **Card mode (`useProxy`).** State holds `card: ProxyCard`, `arts`,
  `renders: { bits; geometry }[]`. The preview shows one `EditablePreview` per
  sheet, side by side when the viewport allows and stacked otherwise, with
  "Front" / "Back" captions for a fold pair; the back is shown upright. The
  art hotspot is on the front sheet only. The overflow warning names the
  sheet ("Rules text on the back was clipped to fit."). Print sends both
  sheets as one job via `sheetFrames`; progress is over the whole job.
- **Deck mode (`useDeck`).** `DeckCard.card: ProxyCard`, `arts`, thumbs hold
  `bits: BitImage[]`. One `PrintItem` per copy as today: a fold pair is one
  item and one card in the counts. `DeckStrip` shows the front thumb with a
  small "2 sheets" badge for fold pairs. Verify goes through `loadCard`, so
  meld parts get their back during verify. The issues dialog's
  `unsupported-layout` entry keeps working for the excluded layouts.
- **Name index.** `build-name-index.ts` keeps every layout except the
  excluded set and the existing set-type exclusions; names stay full
  ("Fire // Ice"). `createMatcher` also indexes each half of a " // " name
  pointing at the full name, so "stomp" offers "Bonecrusher Giant // Stomp"
  and the deck verifier's suggestion for a misspelt half is the full name.
  The spec table in the first design (§4.1) is updated accordingly.
- **Deck list parsing.** No change needed: `fetchCard(exact=…)` resolves a
  face name ("Bonecrusher Giant") to the full card, and `//` is a comment
  marker only at the start of a line.
- **Settings drawer, Tokens mode.** No change.

## 8. Testing

- Fixtures (raw Scryfall JSON in `tests/fixtures/cards/`, art crops in
  `tests/fixtures/art/`): History of Benalia, Urza's Saga, Ranger Class, Case
  of the Stashed Skeleton, Transcendent Master, Phyrexian Fleshgorger,
  Bonecrusher Giant // Stomp, Fire // Ice, Dusk // Dawn, Bushi Tenderfoot //
  Kenzo the Hardhearted, Delver of Secrets // Insectile Aberration, Valki,
  God of Lies // Tibalt, Cosmic Impostor, Invasion of Gobakhan // Lightshield
  Array, Hanweir Battlements, Hanweir, the Writhing Township, The Kami War //
  O-Kagachi Made Manifest, and one excluded card (a plane).
- `normalize.test.ts`: one case per layout row of §4 (sheet count, kinds,
  face fields, stat kinds including `defense`, `meldResult`, the excluded
  message).
- `sections.test.ts`: saga (incl. "I, II —" and read-ahead chapters), class,
  case, leveler (stat captured), prototype; an unrecognised first paragraph is
  kept as text.
- `fit.test.ts`: columns fit order (art column shrinks before text, dropped
  before 11 px, Urza's Saga does not overflow); stacked fit (art dropped
  after the reminder is stripped, before text goes below 14); split fit
  (both halves share a text size, art dropped before 14 px on a long pair).
- `renderProxy.test.ts`: golden PNGs for every new fixture (front and back
  where there are two); every existing golden stays identical.
- `rotate.test.ts`, `foldGuide.test.ts`, `sheets.test.ts` (frame sequence for
  one and two sheets).
- `fuzzy.test.ts`: half-name matching. `build-name-index.test.ts`: new layout
  filter.
- `useProxy.test.tsx`, `useDeck.test.tsx`, `usePrinter.test.tsx`: fold pair
  renders two previews, prints one job with the fold guide, deck counts a
  pair as one card, meld back attached during verify and the info alert when
  it fails.
- `scripts/check-run.ts` writes a fold pair stream too, for the manual
  printer check.

## 8.1 Plan prerequisites

- The approved mockup is committed as
  `brainstorm/layout/2026-10-17-card-layouts.html` (reference material, like
  the existing contact sheets); open it in a browser to see the wireframes.
- `public/names.json` must be regenerated for the "stomp" / "ice" criterion.
  No `oracle-cards-*.jsonl` is present locally: the plan includes a step that
  downloads Scryfall's `oracle_cards` bulk file (via
  `https://api.scryfall.com/bulk-data/oracle-cards`) and converts the JSON
  array to JSONL, as the phase 1 plan did, then runs `npm run build:names`.

## 9. Out of scope

- Oversized and Un-set cards (planes, schemes, vanguard, augment/host).
- Rotated (landscape) rendering of battles and split cards; the two split
  halves are both drawn upright.
- Colour indicators, set symbols, flavour text, artist credits.
- Printing the melded result at double size.
- Settings for column or sub-box sizes.

## 10. Builder's calls still open

Settle these in the plan without coming back:

- Exact badge drawing (circle vs. shield) and the header font weight: match
  the mockup `brainstorm/layout/2026-10-17-card-layouts.html`, which the user
  approved, and tune against a real print.
- `FOLD_GUIDE_ROWS` and `COL_ART_*` values after the first print; constants,
  not settings.
- Whether `Geometry.art` optional ripples into `EditablePreview`'s hotspot
  list (skip the art hotspot when absent).

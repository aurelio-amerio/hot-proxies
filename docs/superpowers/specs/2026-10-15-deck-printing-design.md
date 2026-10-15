# Hot Proxies: deck printing (phase 3)

Date: 2026-10-15. Extends `2026-10-12-hot-proxies-design.md` (rendering,
layout, settings) and `2026-10-14-bluetooth-printing-design.md` (transport,
ESC/POS stream). Both still govern what they cover; this spec only adds.

## 1. Goal

Paste a deck list, press Verify, see that every name resolves, press Print
once and get the whole deck on the roll with a cuttable gap between cards.
If some names do not resolve, a dialog lists them line by line with a
suggested correction, the user fixes the text and verifies again.

Success criteria:

- A 60 to 100 card list exported from Moxfield, Arena or MTGO text verifies
  in seconds and reports every typo before any paper is spent.
- One tap prints the selected cards without further interaction. A dropped
  connection or a cancel can be resumed from the card that did not finish.
- Cards the user does not want (a pile of basics, say) can be deselected
  before printing without editing the list.

Out of scope: importing a Moxfield deck from its URL (see §2.1), merging an
edited list with an in-progress run, a delay setting between cards, iOS.

## 2. Decisions and findings

### 2.1 Moxfield links

Probed on 2026-10-15: `https://api2.moxfield.com/v3/decks/all/<id>` returns
the deck JSON (boards `mainboard`, `sideboard`, `maybeboard`, `commanders`,
`companions`, ...) to a request with a browser user agent, but the response
carries no `Access-Control-Allow-Origin` header. A page on GitHub Pages
therefore cannot read it; a relay backend would be needed. Decision: no
import. A pasted Moxfield URL is recognised and the UI shows a hint to use
Moxfield's Export and paste the text, which the parser accepts. A relay is a
possible later phase and would print `mainboard` plus `commanders` only.

### 2.2 Print stream

The printer has no notion of a job: it sees one byte stream and prints
raster rows as they arrive. The app sends one card at a time only so that
progress, cancel and resume work per card. Decision (option B of the
brainstorm): `ESC @` and `ESC a 0` are sent **once** at the start of a run,
never between cards, because `ESC @` clears the print buffer and a cheap
firmware could drop the tail of the previous card if it is still printing.
Each card is followed by a feed of `FEED_LINES_BETWEEN_CARDS` lines; the run
ends with the existing `FEED_LINES_AFTER` feed so the last card clears the
head.

`FEED_LINES_BETWEEN_CARDS` starts at 2 (the value chosen for
`FEED_LINES_AFTER` on the real printer). It is a constant in
`src/core/printer.ts`, not a setting. Before the UI work, a 3-card run is
printed on the PT-210 with this stream and, for comparison, with the
per-card reset stream, checking: every card's tail is complete, the gap is
wide enough to cut, and there is no visible seam between cards. The chosen
value and date are recorded next to the constant. If `ESC d` proves too
coarse, the fallback is `ESC J n` (feed `n` dots).

### 2.3 Verification resolves through Scryfall

Verify fetches every distinct name (the client caches in IndexedDB and spaces
requests at 100 ms) and normalises it, so it catches not-found names,
unsupported layouts and network outages before printing. The bundled name
index is used only to propose corrections.

## 3. Parsing (`src/core/deck/parse.ts`, pure)

```ts
export interface DeckEntry { line: number; count: number; name: string }
export interface ParseIssue { line: number; text: string; kind: 'bad-count' }
export interface ParsedDeck { entries: DeckEntry[]; issues: ParseIssue[]; moxfieldUrl: string | null }
export function parseDeckList(text: string): ParsedDeck
```

Per line, after trimming:

- Blank line: skipped.
- Comment: starts with `//` or `#`: skipped.
- Moxfield URL: matches `moxfield.com/decks/<id>`: sets `moxfieldUrl`, not an
  entry.
- Section header: the whole line, case-insensitive, optional trailing colon,
  is one of `Deck`, `Mainboard`, `Main`, `Commander`, `Commanders`,
  `Companion`, `Sideboard`, `Maybeboard`, `Considering`, `Tokens`. Headers are
  never entries. `Sideboard`, `Maybeboard`, `Considering` and `Tokens` enter
  **skip mode**: every following line is ignored until the next header. The
  other headers leave skip mode. `Commander` cards print with the deck.
- Count: optional leading integer with optional `x`/`X` (`4 Bolt`, `4x Bolt`).
  Missing count means 1. A count of 0 or above 99 produces a `bad-count`
  issue and no entry.
- Suffix stripping, from the right: trailing flags such as `*F*` (Moxfield
  foil), then a trailing `(SET) 123`, `(SET) 123a`, `(SET) 123★` or `(SET)`
  block. What remains is the name.
- Double-faced names (`A // B`) are kept whole. Scryfall resolves them; the
  normaliser then rejects the layout, which becomes a verify issue.

Entries keep their line number. The parser does not merge duplicates. A
helper `distinctCards(entries)` sums counts per name, comparing names with
`normalizeName` from `data/fuzzy.ts` (accents and `æ` folded, case-
insensitive) and preserving first-appearance order and the first line.

## 4. Verify (`useDeck.verify`)

For each distinct name, in order:

1. `services.client.fetchCard(name)` then `normalizeScryfall`.
2. If the card has art: `fetchArtBlob` then `decodeArt`. Art failure is not an
   issue; the card renders without art and its thumbnail shows a warning.

Issue kinds, each attached to the first line where the name appears:

```ts
type DeckIssue =
  | { kind: 'not-found'; line: number; text: string; name: string; suggestion: string | null }
  | { kind: 'unsupported-layout'; line: number; text: string; name: string; layout: string }
  | { kind: 'bad-count'; line: number; text: string }
```

`suggestion` is the fuzzy matcher's first result for the name (`createMatcher`
over the bundled index, `search(name, 1)`), or null when it returns nothing.
The matcher already requires a prefix, word-prefix, substring or bigram
similarity of at least 0.5, so no extra threshold is applied.

A `NetworkError` stops the pass. The hook shows one error alert and returns
to `editing`; no lines are blamed. Cards resolved before the failure stay
cached, so the retry only fetches the rest.

While verifying, progress is "Checking N of M" with a determinate bar and the
text area is read-only. Editing the text afterwards returns the hook to
`editing` and discards the result.

## 5. Run model (`src/core/deck/run.ts`, pure, immutable)

```ts
export interface DeckCard { key: string; name: string; count: number; line: number; card: CardData; art: GreyImage | null }
export interface PrintItem { cardKey: string; copy: number; status: 'pending' | 'printed' | 'skipped' }
export interface DeckRun { cards: DeckCard[]; items: PrintItem[]; excluded: ReadonlySet<string> }

export function createRun(cards: DeckCard[]): DeckRun            // items expanded in list order, copies consecutive
export function toggleCard(run: DeckRun, key: string): DeckRun   // pending <-> skipped for that card; printed items untouched
export function nextPending(run: DeckRun): PrintItem | null
export function markPrinted(run: DeckRun, item: PrintItem): DeckRun
export function progress(run: DeckRun): { printed: number; total: number; remaining: number }  // total = pending + printed
export function reset(run: DeckRun): DeckRun                     // printed -> pending, exclusions kept
```

`key` is the normalised name. Every function returns a new run.

Lifecycle rules enforced by the hook:

- Editing the text discards the run and thumbnails.
- A settings change re-renders every card's bits but keeps item statuses.
- `toggleCard` is allowed in `ready`, `paused` and `done`, never in
  `printing`.

## 6. Printing (`useDeck.print`)

Hook state: `editing | verifying | ready | printing | paused | done`.

- Print is enabled when state is `ready` or `paused`, the transport is
  `connected` and `nextPending` is not null.
- The loop, per pending item: look up the card's `BitImage` (rendered once
  per distinct card and cached), `toPacked`, raster frames, gap feed frame;
  the very first item of a run (state `ready` with nothing printed, or after
  `reset`) is preceded by the init frame; the last item's gap feed is replaced
  by the tail feed. `await printJob(printer, frames, { signal, onProgress })`,
  then `markPrinted`. The loop re-reads `nextPending` each iteration.
- Resume after a pause sends the init frame again (the printer may have been
  power-cycled), then continues. This is the only case where `ESC @` appears
  mid-deck, and it never follows raster data within the same connection.
- Exposed progress: `progress(run)` ("Card 12 of 61"), the current card's
  name and key (to highlight its thumbnail), and the current card's byte
  fraction for the bar.
- Cancel aborts the current `printJob`. The existing contract holds: abort is
  honoured between frames and the final frame of that card (the feed) is
  still sent. The item stays `pending`; state becomes `paused`.
- A transport failure (drop) sets state `paused` with the item pending and
  reports `PRINTER_MESSAGES.dropped` through the same snackbar as single-card
  mode. No retry.
- Any other exception in the loop also pauses the run and surfaces its
  message; the state never sticks in `printing`.
- When `nextPending` is null the state is `done`.

`usePrinter` is unchanged and still serves Card mode. `useDeck` takes
`services.printer` and calls `printJob` directly; the two hooks share only
the transport, which lives in `Services` outside React, so mode switching
never touches the connection.

### 6.1 ESC/POS helpers (`src/core/output/escpos.ts`)

```ts
export function escposInit(): Uint8Array                                       // ESC @, ESC a 0
export function escposRasterFrames(packed: Uint8Array, width: number, height: number): Uint8Array[]  // GS v 0 blocks of RASTER_BLOCK_ROWS
export function escposFeed(lines: number): Uint8Array                          // ESC d n
```

`encodeEscPosFrames` is kept and redefined as
`[escposInit(), ...escposRasterFrames(...), escposFeed(FEED_LINES_AFTER)]`;
its existing tests must pass unchanged, which pins the validated stream.

## 7. UI

### 7.1 Mode toggle (`App.tsx`)

A `ToggleButtonGroup` `Card | Deck` in the header row between the printer
chip and the settings icon. The mode is persisted in localStorage under
`hot-proxies.mode`. Both hooks stay mounted; only the panel shown changes, so
a deck print continues while the user looks at Card mode. Card mode's Print
button is already disabled while the transport reports `printing`.

### 7.2 `DeckPanel.tsx`

- Multiline `TextField`, placeholder showing `4 Lightning Bolt`,
  `1 Sol Ring (C21) 263`, and that `Sideboard` lines are skipped. Content
  persisted in localStorage under `hot-proxies.deck` on change. Read-only in
  `verifying` and `printing`.
- If `moxfieldUrl` is set: an info alert, "Moxfield decks cannot be imported
  directly. Open the deck on Moxfield, choose Export, copy the list and paste
  it here."
- Live summary from the parser, no network: "61 cards, 48 distinct", plus
  "N lines have problems" when the parser reports issues.
- **Verify** button, the only action in `editing`. Opens the issues dialog on
  failure; moves to `ready` on success.
- `ready`/`paused`/`done`: summary "61 cards ready, 48 distinct" or
  "40 of 61 selected" when some are excluded; the thumbnail strip; the print
  row.
- Print row: "Print 61 cards" in `ready`; in `printing` "Card 12 of 61 ·
  Lightning Bolt" with the per-card bar and Cancel; in `paused` "Resume from
  card 12" and "Start over"; in `done` "61 cards printed" and "Start over".
  Disabled rules as in Card mode; the row is hidden when the transport is
  `unsupported`.

### 7.3 `DeckStrip.tsx`

Horizontally scrolling row of canvases drawn from each card's `BitImage` at
about 96 × 134 CSS px, each with a `×N` badge, a checkbox, and a warning icon
when the geometry has `overflow` or art failed. Excluded cards are dimmed.
The card currently printing is highlighted. Tapping a thumbnail opens a
dialog with the existing `Preview` (zoom toggles, no print props).

Thumbnail rendering happens once after Verify and again on a settings change,
in a loop that yields to the event loop every few cards.

### 7.4 `DeckIssuesDialog.tsx`

Title "N cards could not be resolved". One row per issue: line number, the
text as typed, the reason ("Not found", "Layout 'transform' is not
supported", "Count must be 1 to 99"), and, for `not-found` with a
suggestion, a button with the suggested name. Tapping it rewrites that line
in the text area keeping the count and dropping any set suffix, and removes
the row. **Fix all** applies every available suggestion. **Close** dismisses;
the list stays in `editing` so Verify must be pressed again.

## 8. Error handling summary

| Situation | Behaviour |
|---|---|
| Bad count on a line | `bad-count` issue in the dialog |
| Name not on Scryfall | `not-found` issue, suggestion when available |
| Card found, layout not `normal` | `unsupported-layout` issue |
| Network error during Verify | pass stops, one error alert, back to `editing` |
| Art fails to load | card renders without art, warning badge, not an issue |
| Font fails to load | fallback font and the same warning text as Card mode |
| Printer drops or user cancels | `paused`, card left pending, resume from it |
| Unknown error in the print loop | `paused`, message in the snackbar |

## 9. Testing

- `src/core/deck/parse.test.ts`: counts with and without `x`; set suffixes
  with letters and `★`; foil markers; every header spelling; skip mode entered
  by `Sideboard` and left by `Deck`; comments; a Moxfield URL; accent-folded
  duplicate merging in `distinctCards`; bad counts. Fixtures in
  `tests/fixtures/decks/` for Moxfield, Arena, MTGO text and plain names.
- `src/core/deck/run.test.ts`: expansion order; toggle leaves printed items
  alone and restores pending ones; `nextPending` after a partial run;
  `progress` excludes skipped; `reset`.
- `src/core/output/escpos.test.ts`: the helpers compose byte-for-byte to the
  existing `encodeEscPosFrames` output; a two-card run contains exactly one
  `ESC @`.
- `src/app/useDeck.test.tsx` (jsdom, fake services, `tests/fakePrinter.ts`):
  verify collects issues with suggestions and stops on `NetworkError`; print
  marks items in order and the fake sees one init frame; cancel pauses with
  the current item pending; a drop pauses and resume continues from the same
  item with a new init frame; editing the text discards the run; a settings
  change re-renders without resetting statuses.
- `src/app/DeckPanel.test.tsx`: button enablement per state, summary strings,
  dialog rows, Fix all rewriting the text area, mode persistence.
- Golden renders are unchanged: the deck reuses `renderProxy` as is.
- Manual, recorded in the plan: the 3-card printer check of §2.2.

## 10. Files

New: `src/core/deck/parse.ts`, `src/core/deck/run.ts` and their tests;
`src/app/useDeck.ts`, `src/app/DeckPanel.tsx`, `src/app/DeckStrip.tsx`,
`src/app/DeckIssuesDialog.tsx` and their tests; `tests/fixtures/decks/*.txt`.

Changed: `src/core/printer.ts` (`FEED_LINES_BETWEEN_CARDS`),
`src/core/output/escpos.ts` (helpers, `encodeEscPosFrames` recomposed),
`src/app/App.tsx` (mode toggle, panel switch), `CLAUDE.md` (architecture
notes for the deck layer), `README` printing section (deck mode, Moxfield
hint).

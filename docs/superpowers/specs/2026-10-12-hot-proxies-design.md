# Hot Proxies: thermal-printer MTG proxy renderer

Date: 2026-10-12
Status: approved design, phase 1

## 1. Goal

A Chrome PWA that turns a Magic: The Gathering card name into a black-and-white
proxy image sized for a 58 mm thermal printer (PT-210 class). Phase 1 renders
and previews a single card and lets the user download it as PNG. Printing,
deck lists and multi-face cards are later phases, but the architecture is
chosen so they slot in without rework.

### Success criteria

- Typing a card name offers fuzzy suggestions from a local index without
  network access.
- Selecting a suggestion fetches the card from Scryfall and shows the exact
  1-bit bitmap that would print, within about two seconds on a normal
  connection.
- The proxy carries name, mana cost, type line, rules text, and power/toughness
  or loyalty. Nothing else.
- Rules text never overflows the card for any `normal`-layout card in the
  Scryfall oracle set.
- The art is a recognizable 1-bit rendition of the original art crop.
- Dither algorithm, block size, text sizes and printer dimensions are user
  settings, so the right combination can be found once the printer is in hand.

## 2. Decisions and constraints

| Topic | Decision |
|---|---|
| Card size | Width = printable width of the roll, 384 dots (48 mm at 203 dpi). Height follows the real 63:88 card ratio: 536 dots. Both are constants in `printer.ts` and user-editable settings. |
| Data | Local name index for autocomplete only. Every card lookup goes to Scryfall. |
| Layouts | `normal` only. Other layouts raise `UnsupportedLayout`. |
| Art style | Four selectable 1-bit styles: Atkinson (default), Floyd–Steinberg, Bayer 4×4 ordered, plain threshold; block size 1 (default) or 2. Blocks of 3 or more were tested and are unreadable. |
| Symbols | Vendored SVG glyphs from the Mana project (`mana-master/svg`, SIL OFL), drawn inside a white circle with a black outline, inline in cost line and rules text. |
| Extras | None: no set code, collector number, artist, flavor text or color indicator. Reminder text in parentheses is stripped by default (setting). |
| Layout | Adaptive. Start from the classic proportions, shrink art first, then text. Readability beats art. |
| Stack | Vite, React, TypeScript, MUI (Material Design), `vite-plugin-pwa`, Vitest. |
| Rendering | Hand-written Canvas 2D renderer in framework-free TypeScript. |
| Fonts | Bundled free serif (Crimson Pro or Libre Caslon, regular and bold) as woff2. MPlantin from `mana-master/fonts` is a local, uncommitted option behind a flag because its license is unclear. |

## 3. Architecture

```
src/
  core/                 pure TypeScript; Canvas API only, no React
    printer.ts          DOTS_PER_LINE = 384, DPI = 203, card height derivation
    card/               CardData model, normalizeScryfall(json): CardData
    text/               tokenizer, measurer, wrapper (inline symbol boxes)
    symbols/            Mana SVG -> cached 1-bit stamps per pixel size
    art/                greyscale, contrast, gamma, resize, four dithers
    layout/             fit(card, settings) -> Geometry (boxes, font sizes)
    render/             paint(card, art, geometry, settings) -> ImageData
    output/             ImageData -> packed 1-bit rows -> PNG blob
  data/
    nameIndex.ts        load public/names.json, fuzzy match
    scryfall.ts         fetchCard(exactName), fetchArt(url), IndexedDB cache,
                        rate-limited queue
  app/                  React + MUI: App, SearchBox, Preview, SettingsDrawer
  assets/mana/          only the SVGs used, copied from mana-master/svg
  assets/fonts/         bundled woff2
scripts/
  build-name-index.ts   JSONL -> public/names.json
public/names.json       committed output of the script
```

Boundaries:

- `renderProxy(card, artBitmap, settings): ImageData` is the only entry point
  the UI calls. It is a pure function, so a future deck-list feature is a loop
  over it with one shared settings object.
- `fetchCard` is standalone and goes through a queue that spaces requests by
  100 ms, so batch use later respects Scryfall's rate guidance. A deck importer
  would add `cards/collection` (75 names per request) behind the same
  normalizer.
- `output/` keeps the packed 1-bit buffer (48 bytes per row) as the canonical
  result. PNG is one encoder over it. ESC/POS raster for the printer is a second
  encoder added in the printing phase.
- Settings is a plain serializable object. Printer constants have one home.

## 4. Data layer

### 4.1 Name index

`scripts/build-name-index.ts` reads `oracle-cards-*.jsonl` and writes
`public/names.json` as an array of `[name, oracle_id]` for cards whose `layout`
is `normal` and whose `set_type` is not `token`, `memorabilia` or `minigame`.
About 33,000 entries, roughly 1 MB raw and 250 KB gzipped. The JSONL is
gitignored; the JSON output is committed and refreshed by rerunning the script.

### 4.2 Fuzzy matching

In memory, client side, loaded lazily on the first keystroke and precached by
the service worker. Matching is case- and diacritic-insensitive. Ranking:
prefix match, then substring, then bigram similarity. Debounce 100 ms, show the
top 8. Each suggestion carries the exact name, which is what the fetch uses.
Implementation: Fuse.js if it meets the latency target on 33,000 strings,
otherwise a hand-rolled bigram scorer.

### 4.3 Scryfall

- `fetchCard(exactName)` calls
  `https://api.scryfall.com/cards/named?exact=<name>`; CORS is confirmed open.
- `fetchArt(url)` loads `image_uris.art_crop` with `crossOrigin="anonymous"`
  into an `ImageBitmap`; the CDN sends `access-control-allow-origin: *`.
- Both responses are cached in IndexedDB keyed by exact name (JSON) and URL
  (blob), so a card seen once renders offline.
- HTTP 429 is retried once after 1 s, then surfaced as `NetworkError`.

### 4.4 CardData

```ts
interface CardData {
  name: string
  manaCost: string            // Scryfall notation, e.g. "{4}{U}{B}{B}{R}"; "" for lands
  typeLine: string
  oracleText: string          // paragraphs separated by "\n"
  stat?:
    | { kind: 'pt'; power: string; toughness: string }   // includes "*" and "1+*"
    | { kind: 'loyalty'; value: string }
  artUrl?: string
}
```

`normalizeScryfall(json)` throws `UnsupportedLayout(layout)` for anything but
`normal`. Reminder text stripping happens at render time from the setting, so
the cached card keeps the full text.

## 5. Rendering pipeline

All geometry is in printer dots on a 384 × 536 grid.

### 5.1 Painting and thresholding

The renderer paints onto an offscreen greyscale canvas with normal
anti-aliasing. Lines and text are then thresholded at 50 % to 1-bit. The art is
dithered separately and composited as already-binary pixels. Text is never
dithered.

### 5.2 Text engine

Tokenizer input: a string. Output: a sequence of `word`, `space`, `symbol`
(the text inside braces), `newline`. The wrapper measures words with
`measureText` and symbols as boxes of width equal to the line's symbol size
plus 2 dots spacing, and lays out lines greedily within a given width. Lines
beginning with `+N:`, `−N:` or `0:` (planeswalker abilities) get a hanging
indent equal to the width of the prefix. The same engine renders the name bar
and type line, with wrapping disabled.

### 5.3 Symbols

On first use at a given size, each Mana SVG is drawn via an `Image` onto a
small canvas, centered in a white circle with a 2-dot black outline, and
thresholded. Stamps are cached by `(symbol, size)`. Hybrid `{W/U}` splits the
circle along the diagonal using `half.svg` with each glyph scaled to its half.
Phyrexian `{G/P}` overlays `p.svg`. Numbers `{0}` to `{20}` use the digit
glyphs; larger numbers and `{X}`, `{Y}`, `{Z}`, `{S}`, `{E}`, `{C}`, `{T}`,
`{Q}` map to their SVGs. Any unknown symbol renders as its literal text in a
circle, so new mechanics degrade gracefully instead of failing.

### 5.4 Art

```
art crop -> greyscale -> autocontrast (1 % cutoff) -> gamma (default 1.2)
  -> cover-resize to (artBox / block) with area averaging
  -> dither (atkinson | floyd-steinberg | bayer4 | threshold)
  -> nearest-neighbour upscale by block
```

Dither algorithm, block size, gamma and contrast cutoff are settings. The art
is re-dithered whenever the art box height changes. If the art fails to load,
the box is drawn empty with its frame and the card still renders.

### 5.5 Fit algorithm

Fixed heights: outer margin 8, name bar 34, type bar 28, gaps 4. The remaining
420 dots are shared between art and text box. The text box is sized to the
wrapped text height plus padding; the art takes the remainder.

1. Rules text 17 px, name 22 px, art 250. Fits? Done.
2. Shrink art in steps of 10 down to 180. Fits? Done.
3. With art at 180, step rules text down 1 px at a time to 14, re-wrapping.
   Fits? Done.
4. With text at 14, shrink art in steps of 10 down to 100. Fits? Done.
5. If reminder text has not been stripped already, strip it and go to step 3.
6. Step rules text down to 11 px. If it still does not fit, clip the text and
   set `geometry.overflow = true` so the UI can warn.

The base sizes in step 1 come from settings, so a user who wants bigger text
simply raises the base and the same loop applies. Steps 2 and 4 are in units
of 10 dots to keep the loop cheap; a step is roughly one line of text.

Name fitting is independent: the name shrinks from its base size down to 14 px
until name plus cost fit on one line with 6 dots between them. If the cost
alone is wider than half the bar, the bar grows by one line and the cost moves
below the name, right-aligned.

P/T or loyalty sits in a 32-dot-tall box in the bottom right corner of the
text box. The wrapper narrows the available width of any line that would
overlap that box, so text flows around it and is never masked.

### 5.6 Output

`toPacked(imageData): Uint8Array` packs each row MSB-first, 1 = black, 48
bytes per row, 25,728 bytes per card. `toPng(packed)` produces a 1-bit PNG
blob for preview and download. The printing phase adds `toEscPosRaster`.

## 6. UI and PWA

### 6.1 Screen

One column, Material. App bar with title and a settings icon. Search field
(MUI Autocomplete) fed by the name index. Preview panel showing the real 1-bit
bitmap with `image-rendering: pixelated`, default 2× zoom, toggle to physical
size (384 dots mapped to 48 mm via CSS mm units). A "Download PNG" button
named `<card-name>.png`. The exact arrangement will be tuned later; the pieces
above are the contract.

### 6.2 States and errors

Idle (hint text), loading (linear progress), rendered, error. Errors show as
MUI Alerts under the search field:

| Error | Message | Card rendered? |
|---|---|---|
| `CardNotFound` | "Scryfall has no card named X." | no |
| `NetworkError` | "Could not reach Scryfall. Check your connection." | no |
| `UnsupportedLayout` | "X uses the 'transform' layout, which is not supported yet." | no |
| `ArtUnavailable` | "Art could not be loaded; rendering without it." | yes |
| `geometry.overflow` | "Rules text was clipped to fit." | yes |

### 6.3 Settings drawer

- Art: dither algorithm, block size (1, 2), gamma (0.8 to 1.6), contrast cutoff
  (0 to 5 %).
- Text: base rules text size (14 to 22, default 17), base name size (16 to 26,
  default 22), strip reminder text (default on).
- Printer: dots per line (default 384), dpi (default 203). Card height is
  derived from width and the 63:88 ratio.
- Reset to defaults.

Settings persist in localStorage, are clamped to their ranges on load, and
re-render the current card live.

### 6.4 PWA

`vite-plugin-pwa` with manifest and icons. The service worker precaches the
app shell, fonts, Mana SVGs and `names.json`. Scryfall data is cached by the
app in IndexedDB rather than by the worker.

## 7. Error handling

Each stage returns a value or throws one of the typed errors above. The UI
maps error types to messages; no generic catch-all swallows failures. Art is
the only stage whose failure is non-fatal. Corrupt or out-of-range settings
are clamped, never fatal.

## 8. Testing

Vitest everywhere. Core tests run in Node with `@napi-rs/canvas`.

- Normalizer: fixtures for a creature, instant, sorcery, land, planeswalker,
  vehicle (P/T, not a creature), star-power creature, and a transform card
  that must throw.
- Tokenizer and wrapper: exact output on hand-written inputs, including
  symbols mid-sentence, hybrid costs, and planeswalker prefixes.
- Dithers: tiny hand-computed images for each algorithm.
- Fit: synthetic short, medium, Bolas-length and absurd texts; assert which
  step terminates and that no result overflows unless flagged.
- Snapshots: Rotpriest, Lightning Bolt, Starting Town and Nicol Bolas rendered
  from fixtures and compared to committed golden PNGs; a mismatch writes a
  diff image to disk. Fonts are bundled, so output is deterministic.
- Name index script: 20-line JSONL sample, assert filtering and shape.
- UI: React Testing Library; suggestions appear on typing, selection fetches
  the exact name, each error type renders its alert. Scryfall mocked with
  fixtures.

## 9. Out of scope for phase 1

- Printing (Web Bluetooth or Web Serial, ESC/POS raster encoding).
- Deck-list import and batch rendering UI with shared options.
- Layouts other than `normal`: transform, modal DFC, split, adventure, saga,
  class, flip, leveler.
- Color indicators, set information, artist credit, flavor text.

## 10. Reference material in the repo

- `brainstorm/art-style/00-contact-sheet.png`: the four dither styles on two
  real art crops at print resolution.
- `brainstorm/layout/00-contact-sheet.png`: classic and text-first layout
  mockups that motivated the adaptive fit.
- `creature.png`, `instant.png`, `land.png`, `planeswalker.png`, `sorcery.png`:
  Scryfall scans of the five layouts phase 1 must handle.
- `mana-master/`: upstream Mana icon set; only needed SVGs are vendored.

# Tokens mode and art picker

Date: 2026-10-17
Status: approved design

Builds on `2026-10-12-hot-proxies-design.md` (pipeline, `CardData`, fit,
settings), `2026-10-14-bluetooth-printing-design.md` (transport) and
`2026-10-15-deck-printing-design.md` (print run loop, verify).

## 1. Goal

A third mode beside Card and Deck for printing tokens and helper cards: type a
token name, pick one of its variants, edit any field of the card by tapping it
on the preview, pick the art from the token's printings, and print one or more
copies. The same art picker also lets Card mode choose among a card's
printings, and that choice is remembered for Card and Deck mode.

"Token" here means anything Scryfall files in a token set or as an emblem:
creature and noncreature tokens (Goblin, Treasure, Food), emblems, and helper
cards such as The Monarch, City's Blessing, The Ring Tempts You and The
Initiative. Scryfall already carries all of them with rules text, so no rules
are hand-written in this app.

### Success criteria

- Typing "gob" offers Goblin tokens from a local index without network access;
  picking one renders a proxy within a second plus the art download.
- A name with several rule variants (Goblin with and without haste) shows them
  and the chosen one fills the card.
- Tapping the name, type line, rules text, P/T or art on the preview opens a
  dialog; saving re-renders the card. Every field is editable, so a blank or
  custom token is possible.
- "Copies: 5" prints five cards in one job with cut gaps, using the deck run
  rules (one `ESC @`, feed between cards).
- In Card mode, tapping the art opens the same picker over the card's
  printings; the pick is remembered and used in Deck mode too.
- Renders stay deterministic: tokens go through `renderProxy` unchanged.

## 2. Decisions and constraints

| Topic | Decision |
|---|---|
| Token identity | Name plus properties (type line, rules text, P/T). Art is a separate choice from any printing of that name. |
| Data source | A self-contained `public/tokens.json` built by a script from Scryfall search. Picking a token needs no network; only the art crop is fetched. |
| Double-faced tokens | Split into one entry per face at index build time. No double-faced rendering. |
| Editing | Every field editable from the preview itself: hotspots over the rendered bitmap open a dialog per field. No card-shaped form. |
| Quantity | One token at a time with a Copies count (default 1, 1 to 99). No token queue. |
| Card mode | Gains the art hotspot and picker only. No text editing. |
| Deck mode | No visible change; honours the remembered art per card name. |
| Rendering | No fit or paint changes. A token is a `CardData` with an empty mana cost. |

## 3. Architecture

New and changed files:

```
scripts/
  build-token-index.ts        Scryfall search -> public/tokens.json
public/tokens.json            committed output
src/core/token/
  index.ts                    TokenIndex types, variant grouping helpers (pure)
  draft.ts                    TokenDraft, draftFromVariant, editDraft, blankDraft
  hotspots.ts                 hotspotsFor(geometry)
src/core/art/preference.ts    art preference: card name -> printing id (pure over a Store)
src/data/tokenIndex.ts        lazy load of tokens.json, token matcher, variantsOf
src/data/scryfall.ts          + fetchPrints(name), + fetchArtById(ref)
src/app/
  useMode.ts                  Mode = 'card' | 'deck' | 'tokens'
  ModeSwitch.tsx              third chip
  services.ts                 + loadTokens()
  useTokens.ts                draft state, persistence, render, print copies
  TokensPanel.tsx             search, variant chips, editable preview, copies, print
  EditablePreview.tsx         Preview + hotspot overlay
  FieldDialog.tsx             name / type / rules / stat dialogs
  ArtPickerDialog.tsx         horizontal scroller of printings
  useProxy.ts                 art preference + fetchArtById when a preference exists
  useDeck.ts                  same, during verify
```

Boundaries kept: `src/core/` stays DOM-free; everything external enters through
`Services`; `renderProxy` is the only renderer entry point; the printer is
reached only through `Services.printer` and `printJob`.

## 4. Token index

### 4.1 Format

```ts
interface TokenIndex { version: 1; tokens: TokenEntry[] }
interface TokenEntry {
  name: string                 // "Goblin", "The Monarch", "Elspeth, Sun's Champion Emblem"
  variants: TokenVariant[]     // distinct rules, most printed first
}
interface TokenVariant {
  typeLine: string
  oracleText: string           // paragraphs separated by "\n"
  power?: string
  toughness?: string
  prints: string[]             // art refs: Scryfall id without hyphens, ":1" suffix for a back face; newest first
}
```

Variants are keyed by `(typeLine, oracleText, power, toughness)`. Colours, set
codes, artists and loyalty are dropped; tokens with loyalty do not exist in
practice and the stat dialog can add one by hand. Names are sorted with
`localeCompare`; `tokens` has no duplicate names.

Emblem entries are named `<planeswalker name> Emblem`. Scryfall names emblems
either `Emblem — <planeswalker>` or `<planeswalker> Emblem` depending on the
set; both normalise to the same entry.

Expected size: roughly 1,200 names, 2,000 variants, 6,000 printing refs; about
400 to 500 KB raw and 120 KB gzipped, in line with `names.json`. The service
worker precaches it like `names.json`.

### 4.2 Build script

`npm run build:tokens` runs `scripts/build-token-index.ts`. It pages through
`GET /cards/search` with the query

```
(st:token or layout:emblem) -st:memorabilia -is:playtest
```

and `unique=prints`, following `next_page`, spacing requests by at least
100 ms, with an `Accept: application/json` header. `fetchFn` is injected so
tests run on fixtures.

Per raw card:

- Skip `layout` `art_series` and any card without `type_line`.
- Cards with `card_faces`: emit one record per face, using the face's `name`,
  `type_line`, `oracle_text`, `power` and `toughness` and the shared card `id`.
  The first face's ref is the bare id; the second face's ref is `<id>:1`.
- Single-face cards: one record from the top-level fields, ref is the bare id.
- Skip records whose `type_line` is `Card` and whose `oracle_text` is empty
  (punch-out counters and similar blanks).

Records are grouped by name, then by variant key. Variants are ordered by
printing count descending; printings within a variant by `released_at`
descending. The script prints the counts and writes `public/tokens.json`.

### 4.3 Loader and search

`src/data/tokenIndex.ts` mirrors `nameIndex.ts`: `loadTokenIndex(fetchFn)`
fetches `${BASE_URL}tokens.json` once, caches the promise, and drops the cache
on failure. `createTokenMatcher(index)` builds the existing bigram `Matcher`
over the names, so ranking matches Card mode. `variantsOf(index, name)` returns
the entry or `undefined`.

## 5. Token draft (core)

```ts
interface TokenDraft {
  base: { name: string; variant: number } | null   // null for a blank token
  card: CardData                                   // what renders; every field editable
  artRef: string | null                            // printing ref, null = no art
  copies: number                                   // 1 .. 99
}
type StatPatch = { kind: 'pt'; power: string; toughness: string } | { kind: 'loyalty'; value: string } | { kind: 'none' }
type DraftPatch = { name: string } | { typeLine: string } | { oracleText: string } | { stat: StatPatch } | { artRef: string | null } | { copies: number }
```

Pure functions in `src/core/token/draft.ts`:

- `draftFromVariant(entry, variantIndex)`: `card` from the variant with
  `manaCost: ''`, `artRef` the variant's first printing or `null` if it has
  none, `copies: 1`.
- `blankDraft()`: name "Token", empty type line and text, no stat, no art,
  `copies: 1`.
- `editDraft(draft, patch)`: returns a new draft. The name is trimmed; an
  empty name leaves the old one in place (the dialog also disables Save).
  `copies` is rounded and clamped to 1 to 99. `stat: none` deletes
  `card.stat`. Changing `copies` or `artRef` keeps `base`; changing any card
  field keeps `base` too, since it only records where the draft started.
- `normalizeDraft(unknown)`: coerces a parsed localStorage value into a valid
  draft or returns `null`, in the spirit of `normalizeSettings`.

Rendering is `renderProxy(draft.card, art, settings, env)` with no changes to
fit or paint. The empty cost already yields a cost-free name bar.

### 5.1 Hotspots

`hotspotsFor(geometry): Hotspot[]` in `src/core/token/hotspots.ts` returns
rects in card dots with a `kind`; the view maps them to percentages of the
card.

| Kind | Rect | Dialog |
|---|---|---|
| `name` | `nameBar` | Name |
| `art` | `art` | Art picker |
| `type` | `typeBar` | Type line |
| `rules` | `textBox` | Rules text |
| `stat` | `statBox` when present, else a 96 × 32 dot area in the bottom-right corner of `textBox` | Stat |

The stat button is rendered above the rules button so it wins the overlap.

## 6. Art preference (core)

`src/core/art/preference.ts` wraps a `Store` (`getItem`/`setItem`) under the
key `hot-proxies.art.v1` holding a JSON object `{ [cardName]: artRef }`.
`getPreferredArt(store, name)` returns the ref or `null`;
`setPreferredArt(store, name, ref | null)` sets or removes the entry. Corrupt
storage reads as empty. Tokens do not use it: a token's name is not unique, so
the choice lives on the draft.

## 7. Data layer additions

Both new client methods use the throttled queue, the IndexedDB `KeyValue`
cache and the existing error classes.

- `fetchPrints(name): Promise<Printing[]>` with
  `Printing = { ref: string; artUrl: string; set: string; released: string }`.
  Calls `/cards/search?q=!"<name>"&unique=prints&order=released`, follows
  `next_page` up to 5 pages, keeps printings whose front face has an
  `art_crop` (top-level `image_uris` or `card_faces[0].image_uris`), and caches
  the list under `prints:<name>`. HTTP 404 yields an empty list; other failures
  throw `NetworkError`.
- `fetchArtById(ref): Promise<Blob>` where `ref` is `<id>` or `<id>:1`. Builds
  `https://cards.scryfall.io/art_crop/<front|back>/<id[0]>/<id[1]>/<uuid>.jpg`
  with the uuid re-hyphenated, fetches it, and on 404 falls back to
  `GET /cards/<uuid>` to read the real `art_crop` from `image_uris` or the
  matching face. Cached under `art:<ref>`. Failures throw `ArtUnavailable`.

`Services` gains `loadTokens(): Promise<TokenIndex>`. The browser version
calls `loadTokenIndex()`; tests use a fixture index.

## 8. UI

### 8.1 Mode switch

`Mode` becomes `'card' | 'deck' | 'tokens'`; the stored value is validated
against the three. `ModeSwitch` renders a third chip "Tokens". `App.tsx`
mounts `TokensPanel` for the new mode.

### 8.2 Tokens panel

Top to bottom:

1. Search box: the existing `SearchBox` component, parameterised with the token
   matcher and the label "Token name". Picking a name calls
   `pickToken(name)`, which builds a draft from the first variant. A "Blank
   token" text button beside it calls `startBlank()`.
2. Variant chips, shown only when the picked name has more than one variant:
   one `Chip` per variant labelled `<P/T> · <first line of rules, cut at 24
   characters>` (for example "1/1 · Haste", "0/1 · Defender", "1/1"), with the
   full type line and rules in a tooltip. The selected variant is the primary
   chip. Clicking a chip calls `pickVariant(i)`, which rebuilds the draft from
   that variant and discards edits, since the user chose a different base.
3. `EditablePreview` with the rendered bits. Under it, until the first edit,
   the hint "Tap a part of the card to edit it."
4. Action row: a Copies stepper (`-`, number, `+`, 1 to 99) and the Print
   button with progress bar and Cancel, reusing the `print` props shape of
   `Preview`.

Alerts follow Card mode: art unavailable (info), rules clipped (warning), font
fallback (info), token list unavailable (error; search disabled, Blank token
still works).

### 8.3 Editable preview

`EditablePreview` renders `Preview` and an absolutely positioned overlay the
exact size of the bitmap element. For each hotspot it places a transparent
`button` with `left/top/width/height` in percent of the card, so zoom and the
physical-size toggle need no recomputation. Styling: no visible border at
rest; a dashed 1 px outline on hover and focus; `aria-label` per hotspot
("Edit name", "Change art", "Edit type line", "Edit rules text", "Edit power
and toughness"). The `enabled` prop lists which hotspots are active: all five
in Tokens, only `art` in Card mode. While a print job runs, the overlay is
disabled.

### 8.4 Field dialogs

One `FieldDialog` component with a `field` prop:

- `name`: single-line `TextField`, required; Save disabled when empty after
  trimming.
- `typeLine`: single-line `TextField`, may be empty.
- `oracleText`: multi-line `TextField` (6 rows), helper text "Mana symbols
  like {T} or {G} are drawn as icons."
- `stat`: a `ToggleButtonGroup` None | P/T | Loyalty, then two small fields
  (Power, Toughness) or one (Loyalty). Empty inputs with P/T or Loyalty chosen
  count as None.

Save calls `editDraft`; Cancel or Escape discards. Dialogs are MUI `Dialog`
with `fullWidth` and `maxWidth="xs"` so they fit a phone.

### 8.5 Art picker dialog

`ArtPickerDialog` receives `options: ArtOption[]` with
`{ ref: string; thumbUrl: string; label: string; group?: string }`, the
current `ref | null`, and `onPick`. It renders a horizontally scrolling row of
colour thumbnails (the Scryfall art crop, `loading="lazy"`, about 120 px wide),
the current one outlined, with a leading "No art" tile. Groups are separated by
a divider with the group label. Loading and error states show inline text.

- Tokens: options come from the index, no network for the list. Group 1 is the
  chosen variant's printings, group 2 "Other printings of this name" is every
  other variant's printings. Thumbnail URLs are built from the ref the same way
  `fetchArtById` builds them. Picking sets `draft.artRef`.
- Card mode: options come from `fetchPrints(card.name)`, newest first, plus a
  leading "Default art" tile that clears the preference. Picking calls
  `setPreferredArt` and re-fetches the art.

Thumbnails are the plain colour crops, since those are easier to tell apart;
only the chosen one is dithered.

### 8.6 Printing copies

`useTokens.print()` packs the current bits once and runs, in one job through
`printJob`: `escposInit()`, then for each copy the raster frames followed by
`escposFeed(FEED_LINES_BETWEEN_CARDS)`, except the last copy, which uses
`FEED_LINES_AFTER`. Progress is the fraction of bytes written. Cancel aborts
the job; no resume is offered, the user prints again. This reuses the frame
builders and constants from the deck work, so the deck spec's rule "never
`ESC @` between cards" holds.

### 8.7 Card and Deck mode changes

- `useProxy`: after normalising the card, if `getPreferredArt(name)` returns a
  ref, fetch the art with `fetchArtById(ref)` instead of `card.artUrl`. If that
  fails, fall back to `card.artUrl`, then to no art with the usual info alert.
  The preview in Card mode is `EditablePreview` with only the art hotspot.
- `useDeck`: the same art resolution during verify, per distinct card.
- Settings drawer is untouched.

### 8.8 Persistence

| Key | Value |
|---|---|
| `hot-proxies.mode.v1` | `'card' \| 'deck' \| 'tokens'` |
| `hot-proxies.token.v1` | the current `TokenDraft`, normalised on load |
| `hot-proxies.art.v1` | `{ [cardName]: artRef }` |

All reads are wrapped so corrupt or disabled storage degrades to defaults.

## 9. Error handling and edge cases

| Case | Behaviour |
|---|---|
| `tokens.json` fails to load | Error alert "Token list unavailable", search disabled, Blank token works |
| Art for the chosen printing fails | `ArtUnavailable` info alert, empty art frame, card still renders |
| `fetchPrints` fails in Card mode | Picker shows "Could not load other printings", current art stays |
| Preferred printing no longer resolves | Fall back to the card's default art, keep the preference |
| Rules text too long after an edit | Existing fit loop, then the "clipped" warning |
| Empty name in the dialog | Save disabled |
| P/T fields left blank | Stat becomes None |
| Printing in progress | Copies stepper, dialogs and hotspots disabled until the job ends or is cancelled |
| Mode switch mid-edit | Draft persisted, restored on return |
| Printer disconnected | Print button disabled, as in Card mode |

## 10. Testing

Following the repo conventions (Vitest, node by default, jsdom opt-in,
fixtures only, no Scryfall).

- `scripts/build-token-index.test.ts`: fixture of raw token objects (a
  double-faced token, two Goblins with different rules, The Monarch, an
  emblem, an art-series card, a blank helper) asserting face split, variant
  grouping and ordering, exclusions, name normalisation and output shape.
- `core/token/draft.test.ts`: `draftFromVariant`, `blankDraft`, every
  `editDraft` patch including stat transitions, empty name and copies
  clamping, `normalizeDraft` on garbage.
- `core/token/hotspots.test.ts`: rects for a card with and without a stat box.
- `core/art/preference.test.ts`: get, set, remove, corrupt storage.
- `data/scryfall.test.ts`: `fetchPrints` paging, page cap, art-less printings
  dropped, 404 empty, cache hit; `fetchArtById` direct hit, 404 fallback,
  back-face ref, cache hit.
- `core/render/renderProxy.test.ts`: two new goldens, a Treasure (no art, no
  stat) and a 1/1 Goblin with P/T, both with empty mana cost.
- UI (jsdom): Tokens chip switches mode; picking a token renders; variant chips
  rebuild the draft; each hotspot opens its dialog and Save re-renders; empty
  name cannot be saved; art picker changes the art ref; Copies 3 sends one
  init and three raster sequences to the fake printer; Card mode art pick is
  stored and used on the next render; deck verify uses the preference.

## 11. Out of scope

- Non-`normal` card layouts (sagas, classes, split, adventure, double-faced).
  Next spec.
- Printing the deck list's `Tokens` section; it stays skipped.
- A saved library of custom tokens or a "recent tokens" row.
- Text editing in Card mode.
- Double-faced token rendering.

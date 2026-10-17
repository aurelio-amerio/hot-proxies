# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome PWA that turns a Magic: The Gathering card name into a 1-bit black-and-white proxy bitmap sized for a **PT-210 class 58 mm Bluetooth thermal printer** (384 dots per line, 203 dpi, card 384 × 536 dots at the real 63:88 ratio). Every standard-size layout is supported; fold pairs (e.g. double-faced cards) print front, fold guide, then the back rotated 180°. The end goal is to print these proxies directly on that printer. Phase 1 rendered, previewed and downloaded PNG (the Download button has since been removed; Print is the only action). Phase 2 prints over Web Bluetooth (BLE GATT, ESC/POS `GS v 0` raster); its design is `docs/superpowers/specs/2026-10-14-bluetooth-printing-design.md`. The approved design lives in `docs/superpowers/specs/2026-10-12-hot-proxies-design.md`; read it before changing layout, fit or output behaviour.

## Commands

```
export npm_config_cache="$TMPDIR/npm-cache"   # only inside the Claude Code sandbox
npm install
npm run dev                  # Vite dev server, http://localhost:5173
npm test                     # vitest run: core, scripts, data and UI tests
npm run test:watch
npx vitest run src/core/layout/fit.test.ts        # single file
npx vitest run -t "renders bolt"                  # single test by name
npm run typecheck            # tsc for app (tsconfig.json) and node scripts (tsconfig.node.json)
npm run build                # typecheck + vite build with service worker, served from /
BASE_PATH=/hot-proxies/ npm run build   # what the Pages workflow runs; base path, manifest start_url/scope and SW scope follow it
npm run preview              # serve dist/ locally
UPDATE_GOLDEN=1 npm test     # accept new golden renders after an intentional rendering change
npm run build:names -- oracle-cards-YYYYMMDDhhmmss.jsonl   # rebuild public/names.json from Scryfall bulk JSONL
npm run build:tokens         # rebuild public/tokens.json from Scryfall search (token sets + emblems, every printing)
npm run vendor:mana          # regenerate src/assets/mana/paths.ts from mana-master/svg
npm run check:run          # write 3-card ESC/POS streams to tmp/run-check/ for a manual printer check
```

There is no linter configured.

## Architecture

Three layers, with a hard rule: `src/core/` is framework-free TypeScript and never touches the DOM.

- **`src/core/`** — the rendering pipeline. `renderProxy(sheet, art, settings, env)` in `render/renderProxy.ts` is the single pure entry point: `layout/fit` (dispatching on sheet kind) computes a `Geometry` (boxes and font sizes), `art/prepare` dithers the art crop to fit its box, `render/paint` draws everything onto an offscreen greyscale canvas and thresholds it at 50 % into a `BitImage` (one byte per dot, 1 = black). Text is never dithered; art is dithered separately and composited as binary pixels. `output/packed.ts` turns a `BitImage` into MSB-first packed rows (48 bytes/row), which is the canonical result and the layout ESC/POS raster expects.
- **`src/core/env.ts`** — `RenderEnv` abstracts canvas creation (`createCanvas`, `createPath`). The browser supplies `src/app/browserEnv.ts`; tests supply `tests/nodeEnv.ts` backed by `@napi-rs/canvas` with the bundled Crimson Text font registered as `ProxySerif`. Any new drawing code must go through `Ctx2D` from `env.ts`, not the DOM canvas type, so it works in both.
- **Printing** — `core/output/escpos.ts` wraps packed rows in ESC/POS; `core/printer/transport.ts` defines `PrinterTransport` (state machine `unsupported | disconnected | connecting | connected | printing`) and `printJob` (chunked writes, progress, abort, no retry). `app/bluetoothPrinter.ts` is the only file that touches `navigator.bluetooth`; everything else gets the transport through `Services.printer`, and tests use `tests/fakePrinter.ts`. Constants (`RASTER_BLOCK_ROWS`, `FEED_LINES_AFTER`, `BLE_CHUNK_BYTES`, `FOLD_GUIDE_ROWS`) live in `core/printer.ts`.
- **Deck printing** — `core/deck/parse.ts` (deck text → entries, section skipping, Moxfield URL detection, line rewriting) and `core/deck/run.ts` (immutable print queue: pending/printed/skipped items, toggle, resume) are pure. `app/useDeck.ts` verifies names through `Services.client`, renders one `BitImage` per sheet of each distinct card with `renderProxy` (a fold pair is one queue item printed through `sheetFrames`), and loops `printJob` per pending item; a run sends `escposInit()` once and `escposFeed(FEED_LINES_BETWEEN_CARDS)` between cards (never `ESC @` between cards: it clears the print buffer). `DeckPanel`/`DeckStrip`/`DeckIssuesDialog` are the views; `App.tsx` switches `Card | Deck | Tokens` via `useMode`. Design: `docs/superpowers/specs/2026-10-15-deck-printing-design.md`.
- **Tokens mode** — `core/token/index.ts` (the `tokens.json` shape and the pure grouping the build script uses), `core/token/draft.ts` (editable `TokenDraft`: card fields, art ref, copies; every field is the user's after a pick), `core/token/hotspots.ts` (clickable rects from `Geometry`). `app/useTokens.ts` owns the draft, fetches art by ref, renders with `renderProxy` unchanged, and prints N copies as one job (one `escposInit`, gap feed between copies). `TokensPanel` shows search, variant chips, `EditablePreview` (hotspot buttons over the bitmap, percent-positioned), `FieldDialog` and `ArtPickerDialog`. Design: `docs/superpowers/specs/2026-10-17-tokens-mode-design.md`.
- **Layouts** — `core/card/normalize.ts` maps every standard-size Scryfall layout (`EXCLUDED_LAYOUTS` are rejected) to a `ProxyCard` of one or two `Sheet`s (`standard | columns | stacked | split`); `core/card/sections.ts` splits oracle text into sections. `layout/fitColumns|fitStacked|fitSplit` and `render/paintColumns|paintStacked|paintSplit` are the per-kind paths behind `renderProxy(sheet, …)`. Fold pairs print through `core/printer/sheets.ts` (`sheetFrames`: fold guide from `output/foldGuide.ts` + the back sheet through `output/rotate.ts` `rotate180`, no feed between). `app/loadCard.ts` fetches and normalises (incl. meld back); `app/resolveArt.ts` resolves art per sheet. Design: `docs/superpowers/specs/2026-10-17-card-layouts-design.md`.
- **Art preference** — `core/art/preference.ts` remembers a printing per card name (`hot-proxies.art.v1`, keyed on `ProxyCard.name`, so the full "A // B" for multi-face cards); `app/resolveArt.ts` applies it for Card and Deck mode. Art refs are Scryfall ids without hyphens, `:1` for a back face (`data/artRef.ts`); the client's `fetchArtById` tries the CDN path and falls back to the card JSON, `fetchPrints` lists a card's printings.
- **`src/data/`** — `scryfall.ts` (client with a serialised queue spacing requests ≥100 ms, caching through an injected `KeyValue`; the browser injects IndexedDB via `idb-keyval`), `nameIndex.ts` + `fuzzy.ts` for offline autocomplete from `public/names.json`.
- **`src/app/`** — React + MUI UI. Everything external is injected through a `Services` object (`services.ts`: Scryfall client, name loader, `RenderEnv`, storage, art decoder), so tests pass a fake. `useProxy` loads a `ProxyCard` (`loadCard`, art via `resolveArt`), then re-runs `renderProxy` for each sheet whenever card, art or settings change; `useSettings` persists to localStorage via `core/settings.ts`'s `normalizeSettings`, which clamps every field.

### Design decisions that constrain changes

- All geometry is in printer dots; the constants are in `core/layout/constants.ts` and the printer in `core/printer.ts` (one home for `DOTS_PER_LINE`/`DPI`; card height is derived, never stored).
- The fit algorithm (spec §5.5) is an ordered candidate list in `layout/candidates.ts`: shrink art 250→180, then text 17→14, then art →100, then strip reminder text and retry, then text →11, then clip with `geometry.overflow = true`. Readability beats art. Name fitting is independent (shrink to 14 px, then move the cost under the name).
- Excluded layouts: planar, scheme, vanguard, art_series, augment, host (`normalizeScryfall` throws `UnsupportedLayout`; oversized and Un-set cards are not supported). The proxy shows name, cost, type line, rules text and P/T, loyalty or defense — nothing else, by decision. Readability beats art: art is dropped before text goes below 14 px.
- Mana symbols are vendored SVG path data (`src/assets/mana/paths.ts`, generated — do not hand-edit) stamped into white circles and cached per `(symbol, size)` in `symbols/stamp.ts`; unknown symbols fall back to literal text in a circle.
- Settings are a plain serialisable object. Adding a setting means: field + default + range in `core/settings.ts` (with clamping in `normalizeSettings`), then the drawer control.
- Dither block sizes above 2 were tested and rejected as unreadable.
- Tokens are never looked up by name on Scryfall (names are ambiguous); everything comes from `public/tokens.json` plus art by id. Two-faced tokens are split into one entry per face at build time. Helper cards (The Monarch, The Ring Tempts You, The Initiative, City's Blessing) are tokens in Scryfall's data, so no rules text is hand-written.

## Testing conventions

- Vitest with `environment: 'node'` by default; UI test files opt into jsdom with a `// @vitest-environment jsdom` first line. Vitest globals are off (explicit imports; `tests/setup.ts` handles Testing Library cleanup).
- `src/core/render/renderProxy.test.ts` compares renders bit-for-bit to `tests/golden/*.png`. A mismatch writes the actual render to `tests/golden/__diff__/` (gitignored) and reports the dot count. Any intentional change to rendering requires `UPDATE_GOLDEN=1 npm test` and committing the new PNGs; the renders are deterministic because fonts are bundled.
- Card fixtures are raw Scryfall JSON in `tests/fixtures/cards/`, art crops in `tests/fixtures/art/`. Scryfall is never hit in tests.

## Repo notes

- Deployment: `.github/workflows/pages.yml` tests, builds with `BASE_PATH=/<repo>/` and publishes `dist/` to GitHub Pages on every push to `main` (Pages source must be set to "GitHub Actions" in the repo settings). Locally the base path is `/`, so `npm run dev` and `npm run preview` need no extra setup.
- `public/names.json` (from `build:names`) and `public/tokens.json` (from `build:tokens`) are committed, regenerated files; both are precached by the service worker.
- `oracle-cards-*.jsonl` (≈200 MB Scryfall bulk export), `dist/`, `.superpowers/` and `src/assets/fonts/local/` (optional MPlantin font) are gitignored. The root `*.png` files and `brainstorm/` are reference scans and mockups, not app assets.
- `mana-master/` is the upstream Mana icon set kept only as the source for `npm run vendor:mana`.
- Fonts: Crimson Text (SIL OFL) is bundled as `ProxySerif`. MPlantin is an opt-in setting that only works if `src/assets/fonts/local/mplantin.ttf` is present; the app must keep rendering with a fallback and a warning when it is missing.
- On WSL there is no browser companion; verify visual changes by writing comparison PNGs into the repo rather than serving pages.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome PWA that turns a Magic: The Gathering card name into a 1-bit black-and-white proxy bitmap sized for a **PT-210 class 58 mm Bluetooth thermal printer** (384 dots per line, 203 dpi, card 384 × 536 dots at the real 63:88 ratio). The end goal is to print these proxies directly on that printer. Phase 1 (current) renders, previews and downloads PNG; printing over Web Bluetooth with ESC/POS raster encoding is the next phase and the architecture is already shaped for it (see "Design decisions"). The approved design lives in `docs/superpowers/specs/2026-10-12-hot-proxies-design.md`; read it before changing layout, fit or output behaviour.

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
npm run build                # typecheck + vite build with service worker
UPDATE_GOLDEN=1 npm test     # accept new golden renders after an intentional rendering change
npm run build:names -- oracle-cards-YYYYMMDDhhmmss.jsonl   # rebuild public/names.json from Scryfall bulk JSONL
npm run vendor:mana          # regenerate src/assets/mana/paths.ts from mana-master/svg
```

There is no linter configured.

## Architecture

Three layers, with a hard rule: `src/core/` is framework-free TypeScript and never touches the DOM.

- **`src/core/`** — the rendering pipeline. `renderProxy(card, art, settings, env)` in `render/renderProxy.ts` is the single pure entry point: `layout/fit` computes a `Geometry` (boxes and font sizes), `art/prepare` dithers the art crop to fit its box, `render/paint` draws everything onto an offscreen greyscale canvas and thresholds it at 50 % into a `BitImage` (one byte per dot, 1 = black). Text is never dithered; art is dithered separately and composited as binary pixels. `output/packed.ts` turns a `BitImage` into MSB-first packed rows (48 bytes/row), which is the canonical result and the layout ESC/POS raster expects.
- **`src/core/env.ts`** — `RenderEnv` abstracts canvas creation (`createCanvas`, `createPath`). The browser supplies `src/app/browserEnv.ts`; tests supply `tests/nodeEnv.ts` backed by `@napi-rs/canvas` with the bundled Crimson Text font registered as `ProxySerif`. Any new drawing code must go through `Ctx2D` from `env.ts`, not the DOM canvas type, so it works in both.
- **`src/data/`** — `scryfall.ts` (client with a serialised queue spacing requests ≥100 ms, caching through an injected `KeyValue`; the browser injects IndexedDB via `idb-keyval`), `nameIndex.ts` + `fuzzy.ts` for offline autocomplete from `public/names.json`.
- **`src/app/`** — React + MUI UI. Everything external is injected through a `Services` object (`services.ts`: Scryfall client, name loader, `RenderEnv`, storage, art decoder), so tests pass a fake. `useProxy` fetches + normalises the card, then re-runs `renderProxy` whenever card, art or settings change; `useSettings` persists to localStorage via `core/settings.ts`'s `normalizeSettings`, which clamps every field.

### Design decisions that constrain changes

- All geometry is in printer dots; the constants are in `core/layout/constants.ts` and the printer in `core/printer.ts` (one home for `DOTS_PER_LINE`/`DPI`; card height is derived, never stored).
- The fit algorithm (spec §5.5) is an ordered candidate list in `layout/candidates.ts`: shrink art 250→180, then text 17→14, then art →100, then strip reminder text and retry, then text →11, then clip with `geometry.overflow = true`. Readability beats art. Name fitting is independent (shrink to 14 px, then move the cost under the name).
- Only Scryfall `normal` layout is supported; `normalizeScryfall` throws `UnsupportedLayout` otherwise. The proxy shows name, cost, type line, rules text and P/T or loyalty — nothing else, by decision.
- Mana symbols are vendored SVG path data (`src/assets/mana/paths.ts`, generated — do not hand-edit) stamped into white circles and cached per `(symbol, size)` in `symbols/stamp.ts`; unknown symbols fall back to literal text in a circle.
- Settings are a plain serialisable object. Adding a setting means: field + default + range in `core/settings.ts` (with clamping in `normalizeSettings`), then the drawer control.
- Dither block sizes above 2 were tested and rejected as unreadable.

## Testing conventions

- Vitest with `environment: 'node'` by default; UI test files opt into jsdom with a `// @vitest-environment jsdom` first line. Vitest globals are off (explicit imports; `tests/setup.ts` handles Testing Library cleanup).
- `src/core/render/renderProxy.test.ts` compares renders bit-for-bit to `tests/golden/*.png`. A mismatch writes the actual render to `tests/golden/__diff__/` (gitignored) and reports the dot count. Any intentional change to rendering requires `UPDATE_GOLDEN=1 npm test` and committing the new PNGs; the renders are deterministic because fonts are bundled.
- Card fixtures are raw Scryfall JSON in `tests/fixtures/cards/`, art crops in `tests/fixtures/art/`. Scryfall is never hit in tests.

## Repo notes

- `oracle-cards-*.jsonl` (≈200 MB Scryfall bulk export), `dist/`, `.superpowers/` and `src/assets/fonts/local/` (optional MPlantin font) are gitignored. The root `*.png` files and `brainstorm/` are reference scans and mockups, not app assets.
- `mana-master/` is the upstream Mana icon set kept only as the source for `npm run vendor:mana`.
- Fonts: Crimson Text (SIL OFL) is bundled as `ProxySerif`. MPlantin is an opt-in setting that only works if `src/assets/fonts/local/mplantin.ttf` is present; the app must keep rendering with a fallback and a warning when it is missing.
- On WSL there is no browser companion; verify visual changes by writing comparison PNGs into the repo rather than serving pages.

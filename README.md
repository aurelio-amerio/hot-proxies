# hot-proxies

Black-and-white Magic: The Gathering proxies sized for a 58 mm thermal printer (PT-210 class), rendered in the browser as a PWA.

## Develop

    export npm_config_cache="$TMPDIR/npm-cache"   # only needed inside the Claude Code sandbox
    npm install
    npm run dev          # http://localhost:5173
    npm test             # Vitest: core, data and UI tests
    npm run build        # type-check + production build with service worker
    npm run preview      # serve the production build locally

Pushes to `main` are deployed to GitHub Pages by `.github/workflows/pages.yml`,
which builds with `BASE_PATH=/hot-proxies/` so the app lives under the repo subpath.

## Data

- `public/names.json` is the autocomplete index. Rebuild it from a Scryfall "Oracle Cards" bulk JSONL:
  `npm run build:names -- oracle-cards-YYYYMMDDhhmmss.jsonl`
- Card data and art are fetched live from Scryfall and cached in IndexedDB.
- `src/assets/mana/paths.ts` is generated from `mana-master/svg` by `npm run vendor:mana` (Mana font, SIL OFL 1.1).
- Fonts: Crimson Text (SIL OFL). Drop `mplantin.ttf` into `src/assets/fonts/local/` (gitignored) to enable the MPlantin option.

## Golden images

`tests/golden/*.png` are the reference renders. After an intentional rendering change, run `UPDATE_GOLDEN=1 npm test` and commit the new images.

See `docs/superpowers/specs/2026-10-12-hot-proxies-design.md` for the design.
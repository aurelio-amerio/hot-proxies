# MTG thermal proxies

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

## Printing

The app prints over Web Bluetooth (BLE GATT), which works in Chrome on Android and on desktop
(Windows, macOS, Linux, ChromeOS). It needs a secure context: the GitHub Pages deployment
(https) or `http://localhost`. Firefox, Safari and all iOS browsers lack Web Bluetooth and show
"No Bluetooth" in the app bar.

1. Turn the printer on. Tap the Bluetooth chip in the app bar and pick the printer
   (`PT210_xxxx`) in Chrome's chooser. Android asks for the Nearby devices permission the first time.
2. Render a card and press **Print**. The card is sent as ESC/POS raster in 100-byte chunks.
3. If the printer powers off or goes out of range the chip shows "tap to reconnect".

Blank paper of the right length means the roll is in backwards: thermal paper prints on one
side only.

Testing on a phone against the dev server: `npm run dev -- --host`, connect the phone over USB,
enable port forwarding for 5173 in `chrome://inspect/#devices`, and open `http://localhost:5173`
on the phone (localhost counts as secure).

The printer exposes three BLE "serial" services; the app tries them in order:
ISSC `49535343-fe7d-…` (write char `…8841…`), `ff00`/`ff02`, `18f0`/`2af1`.

## Data

- `public/names.json` is the autocomplete index. Rebuild it from a Scryfall "Oracle Cards" bulk JSONL:
  `npm run build:names -- oracle-cards-YYYYMMDDhhmmss.jsonl`
- Card data and art are fetched live from Scryfall and cached in IndexedDB.
- `src/assets/mana/paths.ts` is generated from `mana-master/svg` by `npm run vendor:mana` (Mana font, SIL OFL 1.1).
- Fonts: Crimson Text (SIL OFL). Drop `mplantin.ttf` into `src/assets/fonts/local/` (gitignored) to enable the MPlantin option.

## Golden images

`tests/golden/*.png` are the reference renders. After an intentional rendering change, run `UPDATE_GOLDEN=1 npm test` and commit the new images.

See `docs/superpowers/specs/2026-10-12-hot-proxies-design.md` for the design.

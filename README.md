# Ptasie głosy — Polish Bird Song Trainer

Static, offline-friendly web app for learning Polish birds — city, lakes, forests and meadows — by ear. By Piotr Pasza Storożenko ([@pstorozenko](https://github.com/pstorozenko)).

The app only reads **bundled static files**. It never calls Xeno-canto or Wikimedia, and no API key is ever shipped to the browser.

## Layout
```
content/            hand-edited inputs
  species.json      species list: names, habitats, sound types, look-alikes; file order = unlock order
  overrides.json    manual fixes: excluded/pinned clips, Commons photo choices, credit cleanup
scripts/
  build_data.py     content/ -> public/ (Xeno-canto + Wikimedia + ffmpeg), run on the dev machine
  make_icons.py     renders public/icons/icon.svg to PNG icons
public/             served as-is
  data/birds.json   generated
  audio/, img/      generated (committed: rebuilding needs the API key and ~130 MB of downloads)
  icons/, manifest.webmanifest
src/                the app (TypeScript, no framework); sw.template.js becomes dist/sw.js at build time
```

## Requirements
- [bun](https://bun.sh) (web app), [uv](https://docs.astral.sh/uv/) (scripts), `ffmpeg` with libwebp.

## Web app
```sh
bun install
bun run dev -- --host     # open http://<your-LAN-ip>:5173/ on your phone (offline mode needs HTTPS or localhost)
bun run test              # unit tests
bun run build             # static site in dist/, including the service worker
```

## Building the data
```sh
cp .env.example .env              # XENO_CANTO_API_KEY (https://xeno-canto.org/account), WIKIMEDIA_CONTACT (url or email)
uv run scripts/build_data.py      # all species marked "enabled" in content/species.json
uv run scripts/build_data.py --only sitta-europaea,crex-crex   # add/refresh some (merged into birds.json)
```
Downloads are cached in `.cache/` (git-ignored), so re-runs only fetch what's missing; `--refresh` redoes everything. Edits to names, habitats or notes in `species.json` apply on any run without re-downloading.

Each species has `types`: any Xeno-canto sound type, e.g. `["song"]` (default), `["call"]`, `["call", "song"]` (1 clip each) or `["bill clapping"]`. Rules: Polish recordings only, quality A (falling back to B), source ≥ 8 s, **no ND licences**. Each clip is the loudest 12 s window, loudness-normalised, AAC `.m4a`, ~125 KB. Photos: CC (no ND) or public domain only.

### Overrides (`content/overrides.json`)
```json
{
  "parus-major":       { "exclude": ["xc123522"], "pin": ["xc975501"] },
  "luscinia-luscinia": { "image": "File:Some_better_photo.jpg" },
  "ardea-cinerea":     { "imageAuthor": "Giacomo Cimino" }
}
```
`image` picks a specific Wikimedia Commons file (default: the species' English Wikipedia lead photo); `imageAuthor` shortens a messy credit. Re-run with `--only <id>` afterwards.

## Design notes
- **No runtime APIs.** Xeno-canto needs an API key (it must never reach the browser) and live fetching breaks offline use, so all data is built once on the dev machine and shipped as static files.
- **Licences.** Clips are trimmed and re-encoded, which is a derivative work, so ND licences are excluded. Audio is mostly CC BY-NC-SA, so the app must stay non-commercial and the modified clips are shared under the same licences (see the in-app credits). Photos are CC (no ND) or public domain only.
- **Learning model.** Leitner boxes 1–4 per species (correct: +1, wrong: back to 1), sampling weights 8/4/2/1. Learners start with the first 6 species; the next unlocks when at most 2 active species are below box 3. "Learned" = box 4. Progress lives in `localStorage` (`birdTrainer.progress.v1`), per device, with export/import.
- **Hard mode** picks wrong answers from look-alikes (`similarTo`), then the same family, then the same habitat.
- **Offline.** A service worker precaches the app, data and photos; recordings are cached on first play or all at once from the Info tab.

# Ptasie głosy — Polish Bird Song Trainer

Static, offline-friendly web app for learning birds of Olsztyn's forests and meadows by ear. See [DESIGN.md](DESIGN.md).

The app only reads **bundled static files** (`public/data/birds.json`, `public/audio/`, `public/img/`). It never calls Xeno-canto or Wikimedia, and no API key is ever shipped to the browser.

## Requirements
- [bun](https://bun.sh) (web app), [uv](https://docs.astral.sh/uv/) (data script), `ffmpeg` with libwebp.

## Building the data (dev machine only)
```sh
cp .env.example .env              # put your key from https://xeno-canto.org/account
uv run scripts/build_data.py      # species marked "enabled" in data/species.json
uv run scripts/build_data.py --only turdus-philomelos,sitta-europaea   # add/refresh some
uv run scripts/build_data.py --all
```
Downloads are cached in `.cache/` (git-ignored), so re-runs only fetch what's missing. `--refresh` re-fetches and re-processes everything.

Each species in `data/species.json` has `types` (`["song"]` by default, `["call"]`, or both; with both, the clip budget is split, e.g. 1 song + 1 call). The order of the file is the **unlock order** in the quiz: the first 6 enabled species are where a new learner starts (currently distinct city birds).

Rules: Polish recordings only, quality A (falling back to B), **no ND licences** (clips are trimmed and re-encoded). Each clip is the loudest 12 s window, loudness-normalised, as AAC `.m4a`, ~125 KB.

### Overriding picks
After listening, create `data/overrides.json`:
```json
{
  "parus-major": { "exclude": ["xc123522"], "pin": ["xc975501"] },
  "turdus-merula": { "image": "File:Some_better_photo.jpg" }
}
```
Then re-run with `--only <id>`.

## Web app
```sh
bun install
bun run dev -- --host     # open http://<your-LAN-ip>:5173/review.html on your phone
bun run build             # static site in dist/
```

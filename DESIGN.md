# Polish Bird Song Trainer — Design Doc

Status: draft v0.1 (written away from the computer, meant to be iterated on in Claude Code)
Author: project owner + Claude
Context: learning bird songs of forests and meadows around Olsztyn (Warmia-Masuria, Poland). Personal project, shared with friends.

---

## 1. Summary

A small, single-page, static web app for learning to recognise Polish forest and meadow birds by their sound.

- **Study tab**: browse a list of birds, see the photo and name, listen to the song/call.
- **Quiz tab**: a random recording plays, the user picks the right bird from four picture + name options, gets instant feedback, and birds they miss come up more often.

Flashcard-style and loosely Duolingo-inspired, but deliberately simple: no accounts, no backend, no streaks/gamification beyond a basic score. Hosted for free as static files (GitHub Pages / Netlify / Cloudflare Pages), shared as a link.

## 2. Goals and non-goals

### Goals
- Learn ~40–50 common species of the Olsztyn region by ear.
- Works well on a phone, in the field, ideally **offline** (forests have poor signal).
- Zero running cost, zero backend, trivial to deploy.
- Progress stored locally in the browser.
- Correct attribution for all third-party audio and images.

### Non-goals (v1)
- User accounts, sync across devices, leaderboards.
- Live bird identification from microphone input.
- Full coverage of all Polish birds.
- Native mobile apps.

## 3. Users

1. The owner, learning birds for walks and forest work around Olsztyn.
2. A handful of friends who get the link. Casual use, mostly phone.

## 4. Tech approach

| Concern | Decision |
|---|---|
| App | **Vite + TypeScript** (via bun), no runtime dependencies; builds to plain static files (`base: './'`). |
| Data source (audio) | [Xeno-canto](https://xeno-canto.org) recordings, Creative Commons licensed |
| Data source (images) | Wikimedia Commons / Wikipedia (CC-licensed bird photos) |
| Backend | None. All data is prebuilt static JSON + audio files committed or built into the site |
| State | `localStorage` |
| Hosting | GitHub Pages (or equivalent) |
| Offline | Service worker + web app manifest (PWA), caches app shell, JSON, audio, images |

### Key decision: bundle, don't fetch live

Do **not** call the Xeno-canto API from the browser. Reasons:
- Xeno-canto's current API (v3) requires an API key, and a key shipped in client code is exposed.
- Live fetching breaks offline use and adds latency and failure modes.
- Recording quality varies wildly; curation matters for a learning tool.

Instead, a **build-time data script** (Node or Python, run manually on the dev machine) queries Xeno-canto and Wikimedia once, downloads the chosen assets, and writes static files into the repo. The app only ever reads local static files.

> **Verified 2026-10-31:** API v2 is shut down. v3 (`https://xeno-canto.org/api/3/recordings?query=gen:Parus sp:major cnt:poland type:song q:A&key=…&per_page=500`) requires a key, and the query takes tags only. Licences on Polish clips are BY-NC-SA or BY-NC-ND, and ND is excluded because we trim and re-encode. Wikimedia rate-limits aggressively: the script throttles to one request per 1.5 s per host and retries on 429.

## 5. Data pipeline (`scripts/build-data`)

Implemented as `scripts/build_data.py` (Python, run with `uv run`). Input: `data/species.json` (hand-maintained seed list, see section 6). Decisions: **Poland-only recordings, 2 songs per species** (species included in the build are flagged `enabled`; 20 as of 2026-10-31), 12 s loudest-window clips as AAC `.m4a` at 80 kbps (plays everywhere, including iOS), photos as 640 px WebP. Manual picks go in `data/overrides.json`.

For each species the script:
1. Queries Xeno-canto for recordings by scientific name, filtered to:
   - quality A (fall back to B),
   - type `song` (and optionally `call`),
   - a CC licence that allows redistribution with attribution,
   - preferably recorded in Poland or nearby Europe (regional dialect matters a little, but don't over-constrain).
2. Picks N recordings per species (start with 3 songs, plus 1 call if available), favouring short, clean, low-noise clips.
3. Downloads audio, then with `ffmpeg`:
   - trims to a max of ~15 s (or picks the loudest/cleanest 10–15 s window),
   - normalises loudness,
   - encodes to **Opus/OGG or MP3 at modest bitrate** (target ~100–200 KB per clip, whole app under ~50 MB for 40 species).
4. Fetches one good photo per species from Wikimedia Commons, resizes to ~600 px wide, saves as WebP/JPEG.
5. Records attribution (recordist, XC catalogue number + URL, licence; photographer, source URL, licence) in the output JSON.
6. Writes `public/data/birds.json` and the asset files under `public/audio/` and `public/img/`.

The script should be **idempotent** and cache downloads, so re-running only fetches what's missing. API keys go in a local `.env` file that is git-ignored.

## 6. Species list

Maintained by hand in `data/species.json`. Starter candidates (verify scientific names and that Xeno-canto has good recordings for each):

**Forest / woodland**
Sikora bogatka (*Parus major*), modraszka (*Cyanistes caeruleus*), czarnogłówka (*Poecile montanus*), sikora uboga (*Poecile palustris*), rudzik (*Erithacus rubecula*), zięba (*Fringilla coelebs*), kos (*Turdus merula*), śpiewak (*Turdus philomelos*), kowalik (*Sitta europaea*), pełzacz leśny (*Certhia familiaris*), strzyżyk (*Troglodytes troglodytes*), mysikrólik (*Regulus regulus*), pierwiosnek (*Phylloscopus collybita*), świstunka leśna (*Phylloscopus sibilatrix*), kapturka (*Sylvia atricapilla*), gajówka (*Sylvia borin*), muchołówka żałobna (*Ficedula hypoleuca*), wilga (*Oriolus oriolus*), sójka (*Garrulus glandarius*), dzięcioł duży (*Dendrocopos major*), dzięcioł czarny (*Dryocopus martius*), kukułka (*Cuculus canorus*), gołąb grzywacz (*Columba palumbus*), puszczyk (*Strix aluco*), grubodziób (*Coccothraustes coccothraustes*), gil (*Pyrrhula pyrrhula*), krzyżodziób świerkowy (*Loxia curvirostra*), trznadel (*Emberiza citrinella*)

**Meadow / farmland / wetland edge**
Skowronek (*Alauda arvensis*), świergotek drzewny (*Anthus trivialis*), potrzos (*Emberiza schoeniclus*), cierniówka (*Curruca communis*), słowik szary (*Luscinia luscinia*), derkacz (*Crex crex*), żuraw (*Grus grus*), pokląskwa (*Saxicola rubetra*), pliszka żółta (*Motacilla flava*), szczygieł (*Carduelis carduelis*), dzwoniec (*Chloris chloris*)

Notes:
- Warmia-Masuria specifics worth considering: żuraw, słowik szary (northeastern Poland is its stronghold), derkacz, bielik.
- Start with ~20 species for the MVP, expand to 40–50 once the pipeline works.
- Tag each species with `habitat`, `family`, and an optional `similarTo` list (used for harder quiz distractors).

## 7. Data model

`public/data/birds.json` (generated):

```json
{
  "version": 1,
  "generatedAt": "2026-10-24T10:00:00Z",
  "species": [
    {
      "id": "parus-major",
      "namePl": "Sikora bogatka",
      "nameEn": "Great Tit",
      "nameLatin": "Parus major",
      "family": "Paridae",
      "habitat": ["forest", "park"],
      "similarTo": ["cyanistes-caeruleus", "poecile-palustris"],
      "note": "Two-note 'tea-cher' song, very common year-round.",
      "image": {
        "src": "img/parus-major.webp",
        "author": "…",
        "license": "CC BY-SA 4.0",
        "sourceUrl": "https://commons.wikimedia.org/…"
      },
      "recordings": [
        {
          "id": "xc123456",
          "src": "audio/parus-major-xc123456.ogg",
          "type": "song",
          "durationSec": 12,
          "recordist": "…",
          "license": "CC BY-NC-SA 4.0",
          "sourceUrl": "https://xeno-canto.org/123456",
          "country": "Poland"
        }
      ]
    }
  ]
}
```

`localStorage` key `birdTrainer.progress.v1`:

```json
{
  "species": {
    "parus-major": { "box": 2, "seen": 9, "correct": 6, "lastSeen": "2026-10-24T09:10:00Z" }
  },
  "settings": { "language": "pl", "quizChoices": 4 },
  "stats": { "totalAnswered": 120, "totalCorrect": 84 }
}
```

Version the key so the schema can change later without breaking old data.

## 8. App structure and UX

Single page, two tabs in a bottom nav (mobile-first): **Study** and **Quiz**. Polish UI by default, English toggle optional (bird names shown in Polish with Latin and English as secondary).

### 8.1 Study tab
- Searchable, filterable list (by habitat, family, "birds I struggle with").
- Each row: thumbnail, Polish name, Latin name, a play button for the primary recording.
- Tap a bird for a detail view: large photo, names, short field note, all recordings (song/call) with play controls, attribution links.
- Optional "learned / not yet" indicator from quiz progress.

### 8.2 Quiz tab
Core loop:
1. Pick a species (weighted, see 8.3) and one of its recordings at random.
2. Auto-play (or tap-to-play, since mobile browsers block autoplay without a gesture), with a replay button. No visual hints about the bird yet.
3. Show 4 choices, each a **photo + Polish name**.
4. User taps one. Feedback is immediate:
   - correct: green highlight, short positive cue,
   - wrong: wrong card red, correct card green.
5. Reveal card: species name, Latin name, field note, link to the recording source. "Next" button.
6. Session summary after e.g. 10 questions: score, birds missed (with a link to study them).

Quiz options (small settings sheet):
- Question count per round: 10 / 20 / endless.
- Difficulty: *easy* (random distractors) / *hard* (distractors chosen from `similarTo` / same family).
- Habitat filter (forest only, meadow only, all).
- Optional: "Recent only", restricting to species the user has already studied.

### 8.3 Selection logic (spaced-repetition lite)
Leitner-style boxes, 1–4 per species:
- New species start in box 1.
- Correct answer: box +1 (max 4). Wrong answer: back to box 1.
- Sampling weights, e.g. box 1: 8, box 2: 4, box 3: 2, box 4: 1, so struggling birds appear more often.
- Don't repeat the same species twice in a row.
- Introduce new species gradually (e.g. keep ≤ 8 active species at first, unlock more as boxes rise), or just offer a "start with N species" setting if that proves too complex. Keep it simple for v1.
- Rotate through different recordings of the same species so the user learns the species, not one specific clip.

### 8.4 Audio handling
- Use plain `<audio>` elements or the Web Audio API. `<audio>` is enough for v1.
- Preload the next question's clip while the user answers the current one.
- Only one clip plays at a time; starting a new one stops the previous.
- Handle the mobile autoplay policy: first play requires a user gesture (the "Start quiz" tap covers it).

### 8.5 Visual design
Clean, calm, nature-ish palette, large tap targets, works one-handed in portrait. Dark mode follows system setting. No need for heavy animation. Accessibility: keyboard operable, sufficient contrast, labels on audio controls, don't rely on colour alone for correct/wrong (add icon/text).

## 9. Offline / PWA
- `manifest.webmanifest` so it can be added to the home screen.
- Service worker precaches the app shell and `birds.json`; audio and images cached on first use or via an explicit "Download for offline" button (shows size, e.g. "38 MB").
- Cache versioning tied to `birds.json` version.

## 10. Licensing and attribution
- Xeno-canto recordings carry individual Creative Commons licences. Some are NC (non-commercial) or ND variants. For a free personal/friends project NC is generally fine, but **filter by licence in the build script and record it per clip**; don't mix in clips whose terms you can't satisfy.
- Show recordist + XC number + licence next to every playing clip, and photographer + licence next to every image (detail view and/or an About/Credits page listing everything).
- Add a Credits page generated from `birds.json`.
- Re-check Xeno-canto's terms for downloading and redistributing audio before publishing.

## 11. Project layout (proposed)

```
bird-song-trainer/
├─ DESIGN.md
├─ README.md
├─ data/
│  └─ species.json          # hand-maintained seed list
├─ scripts/
│  └─ build-data.(mjs|py)   # Xeno-canto + Wikimedia fetcher, ffmpeg processing
├─ public/
│  ├─ index.html
│  ├─ data/birds.json       # generated
│  ├─ audio/                # generated
│  ├─ img/                  # generated
│  ├─ sw.js
│  └─ manifest.webmanifest
├─ src/
│  ├─ main.js
│  ├─ study.js
│  ├─ quiz.js
│  ├─ storage.js            # localStorage wrapper + schema versioning
│  ├─ audio.js
│  └─ styles.css
└─ .env.example             # XENO_CANTO_API_KEY=
```

## 12. Milestones

1. **Data pipeline MVP**: 10 species, 2 recordings each, images, `birds.json`, all with attribution.
2. **Study tab**: list + detail + audio playback.
3. **Quiz tab**: basic loop with random selection and feedback.
4. **Progress**: localStorage, Leitner weighting, session summary.
5. **Polish**: mobile layout, dark mode, settings, difficulty modes.
6. **Offline + deploy**: service worker, manifest, GitHub Pages, Credits page.
7. **Content**: grow to 40–50 species, check clip quality by ear, fix bad picks.

## 13. Open questions
- Plain JS vs Vite + TypeScript (framework-free seems enough).
- Node vs Python for the data script (whichever is more comfortable; ffmpeg needed either way).
- Song only, or also calls (many forest birds are recognised mainly by calls)?
- Which Xeno-canto recordings: strictly Polish, or any European? How many per species?
- Is a "learned" threshold needed, or is the Leitner box display enough?
- Polish-only UI, or bilingual from the start?
- Maximum total download size for offline mode on mobile data.

## 14. Instructions for Claude Code (first session)
1. Read this document fully, then propose the concrete stack and scaffold the repo per section 11.
2. Check current Xeno-canto API docs (v3, key requirement) and Wikimedia APIs before writing the data script; adjust section 5 if anything has changed.
3. Start with milestone 1 on ~10 species; stop and let the owner listen to the chosen clips before scaling up.
4. Keep dependencies minimal and the app deployable as plain static files.

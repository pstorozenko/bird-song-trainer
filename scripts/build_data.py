# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27", "numpy>=1.26", "python-dotenv>=1.0"]
# ///
"""Build static bird data for the app.

Queries Xeno-canto (API v3) and Wikimedia once on the dev machine, downloads and
processes audio/images, and writes public/data/birds.json. The web app only ever
reads these local static files — the API key never leaves this script.

Usage:
  uv run scripts/build_data.py            # species marked "enabled"
  uv run scripts/build_data.py --only parus-major,turdus-merula
  uv run scripts/build_data.py --all [--refresh]
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import unquote

import httpx
import numpy as np
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
SPECIES_FILE = ROOT / "content" / "species.json"
OVERRIDES_FILE = ROOT / "content" / "overrides.json"
CACHE = ROOT / ".cache"
PUBLIC = ROOT / "public"
OUT_JSON = PUBLIC / "data" / "birds.json"

XC_API = "https://xeno-canto.org/api/3/recordings"
UA = "BirdSongTrainer/0.1 (personal learning project; data build script)"

RECORDINGS_PER_SPECIES = 4
META_KEYS = ("id", "namePl", "nameEn", "nameLatin", "family", "habitat", "similarTo", "note")
COUNTRY = "poland"
MAX_SOURCE_SEC = 90  # prefer short source recordings (less to sift through)
MIN_SOURCE_SEC = 8   # too short to hold more than one phrase
CLIP_SEC = 12.0
SAMPLE_RATE = 32000


# ---------------------------------------------------------------- helpers

def log(msg: str) -> None:
    print(msg, flush=True)


def parse_len(s: str) -> int:
    secs = 0
    for part in s.split(":"):
        secs = secs * 60 + int(part)
    return secs


def license_name(url: str) -> str:
    """'//creativecommons.org/licenses/by-nc-sa/4.0/' -> 'CC BY-NC-SA 4.0'"""
    m = re.search(r"licenses/([a-z-]+)/([\d.]+)", url)
    if not m:
        return url
    return f"CC {m.group(1).upper()} {m.group(2)}"


def license_ok(url: str) -> bool:
    # ND forbids derivatives; we trim + re-encode, so exclude it.
    return "creativecommons.org/licenses/" in url and "-nd" not in url


def strip_html(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, capture_output=True, **kw)


class Http:
    def __init__(self, wiki_delay: float = 1.5, contact: str = "") -> None:
        ua = f"{UA[:-1]}; {contact})" if contact else UA
        self.client = httpx.Client(headers={"User-Agent": ua, "Accept": "application/json, */*", "Accept-Encoding": "gzip"}, timeout=60, follow_redirects=True)
        self.wiki_delay = wiki_delay
        self.requests = 0  # network requests actually made (cache hits don't count)
        self._last: dict[str, float] = {}

    def _throttle(self, url: str) -> None:
        """Be polite: Wikimedia hosts share one slow lane; other hosts get 1.5 s spacing."""
        host = httpx.URL(url).host
        min_gap = 1.5
        if host.endswith(("wikipedia.org", "wikimedia.org")):
            host, min_gap = "wikimedia", self.wiki_delay
        wait = min_gap - (time.monotonic() - self._last.get(host, 0.0))
        if wait > 0:
            time.sleep(wait)
        self._last[host] = time.monotonic()

    def get(self, url: str, params: dict | None = None, retries: int = 4) -> httpx.Response:
        for attempt in range(retries):
            self._throttle(url)
            self.requests += 1
            r = self.client.get(url, params=params)
            if r.status_code not in (429, 503) and not (r.status_code == 403 and "robot policy" in r.text):
                r.raise_for_status()
                return r
            delay = float(r.headers.get("Retry-After", 0) or 0) or 5 * 2 ** attempt
            delay = min(delay, 60)
            if attempt == retries - 1:
                break
            log(f"  … {r.status_code} from {httpx.URL(url).host}, retrying in {delay:.0f}s")
            time.sleep(delay)
        r.raise_for_status()
        return r

    def json_cached(self, cache_name: str, url: str, params: dict, refresh: bool, retries: int = 4) -> dict:
        path = CACHE / "api" / cache_name
        if path.exists() and not refresh:
            return json.loads(path.read_text())
        data = self.get(url, params, retries).json()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1))
        return data

    def download(self, url: str, dest: Path, retries: int = 4) -> Path:
        if dest.exists() and dest.stat().st_size > 0:
            return dest
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        tmp.write_bytes(self.get(url, retries=retries).content)
        tmp.rename(dest)
        return dest


# ---------------------------------------------------------------- xeno-canto

def xc_candidates(http: Http, key: str, sp: dict, quality: str, refresh: bool, rtype: str = "song") -> list[dict]:
    gen, spec = sp["nameLatin"].split()[:2]
    type_q = f'"{rtype}"' if " " in rtype else rtype  # e.g. type:"bill clapping"
    query = f"gen:{gen} sp:{spec} cnt:{COUNTRY} type:{type_q} q:{quality}"
    # songs keep the original cache names so existing picks stay stable
    tag = "" if rtype == "song" else f"{rtype.replace(' ', '_')}-"
    recs: list[dict] = []
    page = 1
    while True:
        data = http.json_cached(
            f"xc-{sp['id']}-{tag}{quality}-p{page}.json",
            XC_API,
            {"query": query, "key": key, "per_page": 500, "page": page},
            refresh,
        )
        if "error" in data:
            raise RuntimeError(f"Xeno-canto error for {sp['id']}: {data}")
        recs += data.get("recordings", [])
        if page >= int(data.get("numPages", 1)):
            break
        page += 1
    return recs


def pick_recordings(recs: list[dict], n: int, overrides: dict, skip: set[str] = frozenset()) -> list[dict]:
    exclude = {x.removeprefix("xc") for x in overrides.get("exclude", [])} | set(skip)
    # clips approved in the review tool stay put, like explicit pins
    pins = [x.removeprefix("xc") for x in [*overrides.get("pin", []), *overrides.get("approved", [])]]
    by_id = {r["id"]: r for r in recs}

    usable = [
        r for r in recs
        if license_ok(r.get("lic", "")) and r["id"] not in exclude and r.get("file")
        and parse_len(r.get("length", "0:00")) >= MIN_SOURCE_SEC
    ]

    def score(r: dict) -> tuple:
        length = parse_len(r.get("length", "0:00"))
        return (
            length > MAX_SOURCE_SEC,          # short ones first
            len(r.get("also") or []) > 0,     # no background species first
            r.get("q") != "A",
            abs(length - 30),                 # ~30 s sources are a sweet spot
        )

    chosen: list[dict] = [by_id[p] for p in pins if p in by_id and p not in exclude][:n]
    recordists = {r["rec"] for r in chosen}
    ranked = sorted(usable, key=score)
    # first pass: distinct recordists; second pass: fill up
    for distinct in (True, False):
        for r in ranked:
            if len(chosen) >= n:
                break
            if r in chosen or (distinct and r["rec"] in recordists):
                continue
            chosen.append(r)
            recordists.add(r["rec"])
    return chosen


# ---------------------------------------------------------------- audio

def loudest_window_start(src: Path, clip_sec: float) -> float:
    pcm = run([
        "ffmpeg", "-v", "error", "-i", str(src), "-ac", "1", "-ar", str(SAMPLE_RATE),
        "-f", "f32le", "-",
    ]).stdout
    x = np.frombuffer(pcm, dtype=np.float32)
    duration = len(x) / SAMPLE_RATE
    if duration <= clip_sec:
        return 0.0
    # high-pass-ish: remove DC / low rumble with first difference, then energy per 100 ms
    hop = SAMPLE_RATE // 10
    frames = len(x) // hop
    e = np.square(np.diff(x[: frames * hop], prepend=0)).reshape(frames, hop).mean(axis=1)
    win = int(clip_sec * 10)
    sums = np.convolve(e, np.ones(win), mode="valid")
    return float(np.argmax(sums)) / 10.0


def process_audio(src: Path, dest: Path, refresh: bool) -> float:
    if dest.exists() and not refresh:
        return probe_duration(dest)
    start = loudest_window_start(src, CLIP_SEC)
    fade_out_start = max(CLIP_SEC - 0.4, 0)
    dest.parent.mkdir(parents=True, exist_ok=True)
    run([
        "ffmpeg", "-v", "error", "-y", "-ss", f"{start:.2f}", "-t", f"{CLIP_SEC}", "-i", str(src),
        "-ac", "1", "-ar", "44100",
        "-af", f"highpass=f=150,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=0.2,afade=t=out:st={fade_out_start}:d=0.4",
        "-c:a", "aac", "-b:a", "80k", "-movflags", "+faststart", str(dest),
    ])
    return probe_duration(dest)


def probe_duration(path: Path) -> float:
    out = run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path),
    ]).stdout.decode().strip()
    return round(float(out), 1)


# ---------------------------------------------------------------- images

def image_license_ok(lic: str) -> bool:
    """CC (no ND) or public domain only. GFDL etc. would require shipping the full licence text."""
    u = lic.upper().strip()
    if u in ("CC0", "PUBLIC DOMAIN", "PD") or u.startswith(("CC0", "PUBLIC DOMAIN", "PD-")):
        return True
    return u.startswith("CC ") and "ND" not in u.replace("CC ", "").split("-")


def to_webp(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vf", "scale='min(640,iw)':-2",
         "-c:v", "libwebp", "-quality", "78", str(dest)])


def wikimedia_image(http: Http, sp: dict, refresh: bool, overrides: dict) -> dict | None:
    dest = PUBLIC / "img" / f"{sp['id']}.webp"
    file_title = overrides.get("image")  # optional "File:....jpg" override
    if not file_title:
        wp = http.json_cached(
            f"wp-{sp['id']}.json",
            "https://en.wikipedia.org/w/api.php",
            {"action": "query", "format": "json", "prop": "pageimages", "piprop": "name",
             "redirects": 1, "titles": sp["nameLatin"]},
            refresh, retries=1,
        )
        page = next(iter(wp["query"]["pages"].values()))
        if "pageimage" not in page:
            log(f"  ! no Wikipedia page image for {sp['nameLatin']}")
            return None
        file_title = "File:" + page["pageimage"]
    info = http.json_cached(
        f"commons-{sp['id']}.json",
        "https://commons.wikimedia.org/w/api.php",
        {"action": "query", "format": "json", "prop": "imageinfo",
         "iiprop": "url|extmetadata", "iiurlwidth": 800, "titles": file_title},
        refresh, retries=1,
    )
    ii = next(iter(info["query"]["pages"].values()))["imageinfo"][0]
    meta = ii.get("extmetadata", {})
    lic = meta.get("LicenseShortName", {}).get("value", "")
    if not image_license_ok(lic):
        log(f"  ! image licence not usable: {lic!r} — pick another via overrides.json \"image\"")
        return None

    if refresh or not dest.exists():
        raw = http.download(ii["thumburl"], CACHE / "img" / f"{sp['id']}{Path(ii['thumburl'].split('?')[0]).suffix}", retries=1)
        to_webp(raw, dest)

    return {
        "src": f"img/{dest.name}",
        "author": overrides.get("imageAuthor") or strip_html(meta.get("Artist", {}).get("value", "")) or "unknown",
        "license": lic,
        "licenseUrl": meta.get("LicenseUrl", {}).get("value", ""),
        "sourceUrl": ii["descriptionurl"],
    }


def commons_title(url: str) -> str:
    """'https://commons.wikimedia.org/wiki/File:A_b%C3%B3.jpg' or 'File:A b.jpg' -> 'A bó.jpg'"""
    return unquote(url.rsplit("File:", 1)[-1]).replace("_", " ").strip()


def fetch_image(http: Http, sp: dict, refresh: bool, overrides: dict, previous: dict | None) -> dict | None:
    # Reuse the previous photo (no network) unless overrides now asks for a different Commons file.
    prev = (previous or {}).get("image")
    if prev and not refresh and (PUBLIC / prev["src"]).exists():
        wanted = overrides.get("image")
        if not wanted or commons_title(wanted) == commons_title(prev.get("sourceUrl", "")):
            img = dict(prev)
            if overrides.get("imageAuthor"):
                img["author"] = overrides["imageAuthor"]
            return img
    try:
        return wikimedia_image(http, sp, refresh, overrides)
    except (httpx.HTTPError, KeyError, StopIteration) as e:
        log(f"  ! photo skipped ({type(e).__name__}: {str(e)[:80]}) — re-run later or set 'image' in overrides.json")
        # keep a photo from an earlier successful build, if any
        if previous and previous.get("image") and (PUBLIC / previous["image"]["src"]).exists():
            return previous["image"]
        return None


# ---------------------------------------------------------------- main

def build_species(http: Http, key: str, sp: dict, refresh: bool, overrides: dict, previous: dict | None) -> dict:
    log(f"• {sp['namePl']} ({sp['nameLatin']})")
    types = sp.get("types") or ["song"]
    n = RECORDINGS_PER_SPECIES
    # split the clip budget across types, e.g. 4 clips over [call, song] -> 2 + 2
    quotas = [n // len(types) + (1 if i < n % len(types) else 0) for i in range(len(types))]
    pools: dict[str, list[dict]] = {}
    chosen: list[tuple[str, dict]] = []  # newly picked (XC API records)

    # Keep finished clips from the previous build that are still wanted: no API call, no download.
    excluded = {x.removeprefix("xc") for x in overrides.get("exclude", [])}
    kept: list[dict] = []
    if previous and not refresh:
        kept = [
            rec for rec in previous.get("recordings", [])
            if rec["id"].removeprefix("xc") not in excluded and rec.get("type") in types and (PUBLIC / rec["src"]).exists()
        ][:n]
        # an explicit "pin" that isn't among them means: pick again from scratch
        if {x.removeprefix("xc") for x in overrides.get("pin", [])} - {r["id"].removeprefix("xc") for r in kept}:
            kept = []
    kept_ids = {r["id"].removeprefix("xc") for r in kept}

    def take(rtype: str, k: int) -> None:
        if k <= 0:
            return
        taken = kept_ids | {r["id"] for _, r in chosen}
        pools.setdefault(rtype, xc_candidates(http, key, sp, "A", refresh, rtype))
        picked = pick_recordings(pools[rtype], k, overrides, taken)
        if len(picked) < k:
            pools[rtype] += xc_candidates(http, key, sp, "B", refresh, rtype)
            picked = pick_recordings(pools[rtype], k, overrides, taken)
        chosen.extend((rtype, r) for r in picked)

    for rtype, k in zip(types, quotas):
        take(rtype, k - sum(1 for r in kept if r["type"] == rtype))
    for rtype in types:  # top up from any type if one came up short
        take(rtype, n - len(kept) - len(chosen))
    if len(kept) + len(chosen) < n:
        log(f"  ! only {len(kept) + len(chosen)} usable Polish recordings ({'/'.join(types)})")

    recordings = []
    for rec in kept:
        log(f"  = {rec['type']} {rec['id'].upper()} (kept)")
        recordings.append({**rec, "sizeBytes": (PUBLIC / rec["src"]).stat().st_size})
    for rtype, r in chosen:
        ext = Path(r.get("file-name") or "x.mp3").suffix or ".mp3"
        raw = http.download(r["file"], CACHE / "xc" / f"{r['id']}{ext}")
        dest = PUBLIC / "audio" / f"{sp['id']}-xc{r['id']}.m4a"
        dur = process_audio(raw, dest, refresh)
        recordings.append({
            "id": f"xc{r['id']}",
            "src": f"audio/{dest.name}",
            "type": rtype,
            "durationSec": dur,
            "sizeBytes": dest.stat().st_size,
            "sourceLengthSec": parse_len(r.get("length", "0:00")),
            "quality": r.get("q"),
            "recordist": r["rec"],
            "license": license_name(r["lic"]),
            "licenseUrl": "https:" + r["lic"] if r["lic"].startswith("//") else r["lic"],
            "sourceUrl": r.get("url") or f"https://xeno-canto.org/{r['id']}",
            "country": r.get("cnt"),
            "location": r.get("loc"),
            "date": r.get("date"),
        })
        log(f"  ♪ {rtype} XC{r['id']} q:{r.get('q')} {r.get('length')} {license_name(r['lic'])} — {r['rec']} ({r.get('loc')})")

    image = fetch_image(http, sp, refresh, overrides, previous)
    if image:
        log(f"  ▣ {image['license']} — {image['author']}")

    out = {k: sp[k] for k in META_KEYS}
    out["image"] = image
    out["recordings"] = sorted(recordings, key=lambda r: types.index(r["type"]) if r["type"] in types else len(types))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--enabled", action="store_true", help="only species marked enabled (default)")
    g.add_argument("--all", action="store_true", help="all species in content/species.json")
    g.add_argument("--only", help="comma-separated species ids")
    ap.add_argument("--refresh", action="store_true", help="ignore caches and re-process")
    ap.add_argument("--wiki-delay", type=float, default=5.0, help="seconds between Wikimedia requests (default 5)")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    key = os.environ.get("XENO_CANTO_API_KEY", "").strip()
    if not key:
        log("XENO_CANTO_API_KEY missing — put it in .env (see .env.example)")
        return 1

    for tool in ("ffmpeg", "ffprobe"):
        try:
            run([tool, "-version"])
        except (OSError, subprocess.CalledProcessError):
            log(f"{tool} not found on PATH")
            return 1

    seed = json.loads(SPECIES_FILE.read_text())["species"]
    overrides_all = json.loads(OVERRIDES_FILE.read_text()) if OVERRIDES_FILE.exists() else {}

    if args.only:
        ids = set(args.only.split(","))
        selected = [s for s in seed if s["id"] in ids]
        missing = ids - {s["id"] for s in selected}
        if missing:
            log(f"unknown ids: {', '.join(sorted(missing))}")
            return 1
    elif args.all:
        selected = seed
    else:
        selected = [s for s in seed if s.get("enabled")]

    http = Http(args.wiki_delay, os.environ.get("WIKIMEDIA_CONTACT", "").strip())
    previous = {s["id"]: s for s in json.loads(OUT_JSON.read_text())["species"]} if OUT_JSON.exists() else {}
    seed_by_id = {s["id"]: s for s in seed}
    built = {
        sp["id"]: build_species(http, key, sp, args.refresh, overrides_all.get(sp["id"], {}), previous.get(sp["id"]))
        for sp in selected
    }

    # --only merges into the existing build instead of replacing it.
    if args.only:
        for sid, s in previous.items():
            built.setdefault(sid, s)
    # Metadata always comes from the seed file, so edits there apply without re-fetching.
    for sid, s in built.items():
        if sid in seed_by_id:
            s.update({k: seed_by_id[sid][k] for k in META_KEYS})
    species = [built[s["id"]] for s in seed if s["id"] in built]  # seed order

    # Keep similarTo pointing only at species that are actually in the build.
    present = set(built)
    for s in species:
        s["similarTo"] = [x for x in seed_by_id[s["id"]]["similarTo"] if x in present]

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps({
        "version": 1,
        "generatedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "species": species,
    }, ensure_ascii=False, indent=2) + "\n")

    # Remove generated assets no longer referenced (e.g. after an override).
    referenced = {r["src"] for s in species for r in s["recordings"]} | {s["image"]["src"] for s in species if s["image"]}
    # Safe for --only too: `species` is the merged, complete list.
    for sub in ("audio", "img"):
        for f in (PUBLIC / sub).glob("*"):
            if f"{sub}/{f.name}" not in referenced:
                f.unlink()
                log(f"removed stale {sub}/{f.name}")

    total = sum((PUBLIC / p).stat().st_size for p in referenced)
    log(f"\nNetwork requests: {http.requests}")
    log(f"Wrote {OUT_JSON.relative_to(ROOT)}: {len(species)} species, "
        f"{sum(len(s['recordings']) for s in species)} clips, {total / 1024:.0f} KB of assets")
    return 0


if __name__ == "__main__":
    sys.exit(main())

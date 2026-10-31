// Service worker template. vite.config.ts fills in the version and precache list at build time
// and writes the result to dist/sw.js. Plain JS on purpose: it's not part of the app bundle.

const VERSION = '__VERSION__';
const SHELL_CACHE = `shell-${VERSION}`;
const AUDIO_CACHE = 'audio-v1'; // must match src/offline.ts
const PRECACHE = __PRECACHE__;
const scope = self.registration.scope;
const abs = (path) => new URL(path, scope).href;
// Servers add Vary (Origin, Accept-Encoding); our files are static per URL, so match on URL only.
const MATCH = { ignoreSearch: true, ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(PRECACHE.map((p) => new Request(abs(p), { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('shell-') && key !== SHELL_CACHE) await caches.delete(key);
      }
      await pruneAudio();
      await self.clients.claim();
    })(),
  );
});

/** Drop cached clips that the current birds.json no longer references (e.g. after a clip swap). */
async function pruneAudio() {
  try {
    const res = await caches.match(abs('data/birds.json'), MATCH);
    if (!res) return;
    const data = await res.json();
    const keep = new Set(data.species.flatMap((s) => s.recordings.map((r) => abs(r.src))));
    const cache = await caches.open(AUDIO_CACHE);
    for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
  } catch {
    /* best effort */
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.href.startsWith(abs('audio/'))) {
    event.respondWith(serveAudio(req));
    return;
  }
  event.respondWith(serveShell(req));
});

/** App shell, data and photos: cache first (precached at install), network as fallback. */
async function serveShell(req) {
  const cache = await caches.open(SHELL_CACHE);
  const hit =
    (await cache.match(req, MATCH)) || (req.mode === 'navigate' ? await cache.match(abs('./'), MATCH) : undefined);
  if (hit) return hit;
  return fetch(req);
}

/** Recordings: cache on first play, then serve offline. Media elements send Range requests. */
async function serveAudio(req) {
  const cache = await caches.open(AUDIO_CACHE);
  const key = new URL(req.url);
  key.search = '';
  let res = await cache.match(key.href, MATCH);
  if (!res) {
    let net;
    try {
      net = await fetch(key.href); // full file, no Range, so it can be cached whole
    } catch {
      return new Response('offline', { status: 503 });
    }
    if (!net.ok) return net;
    await cache.put(key.href, net.clone());
    res = net;
  }
  return withRange(req, res);
}

/** Safari refuses to play media served as a plain 200 to a Range request, so answer with 206. */
async function withRange(req, res) {
  const range = req.headers.get('range');
  if (!range) return res;
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = 0;
  let end = size - 1;
  if (m) {
    if (m[1] === '' && m[2] !== '') {
      start = Math.max(0, size - Number(m[2])); // suffix range: last N bytes
    } else {
      start = Number(m[1] || 0);
      if (m[2] !== '') end = Math.min(Number(m[2]), size - 1);
    }
  }
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'audio/mp4',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

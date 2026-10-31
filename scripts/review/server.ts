// Local clip-review tool (never deployed). Run: bun run review  →  http://localhost:5174
//
// - Lists every clip from public/data/birds.json with a spectrogram.
// - OK / Bad marks are written to content/overrides.json ("approved" / "exclude").
// - "Replace bad clips" re-runs scripts/build_data.py --only <species with excluded clips>,
//   streaming its output, so replacements can be reviewed right away.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');
const PUBLIC = join(ROOT, 'public');
const BIRDS = join(PUBLIC, 'data', 'birds.json');
const OVERRIDES = join(ROOT, 'content', 'overrides.json');
const SPECTRO_DIR = join(ROOT, '.cache', 'spectrograms');
const PAGE = join(import.meta.dir, 'index.html');
const PORT = Number(process.env.PORT ?? 5174);

type Overrides = Record<string, { exclude?: string[]; approved?: string[]; [k: string]: unknown }>;
type Birds = { species: { id: string; recordings: { id: string; src: string }[] }[] };

const readJson = <T>(path: string, fallback: T): T => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);
const writeOverrides = (o: Overrides) => {
  // drop empty entries/lists so the file stays tidy
  for (const [id, entry] of Object.entries(o)) {
    for (const key of ['exclude', 'approved'] as const) if (entry[key]?.length === 0) delete entry[key];
    if (Object.keys(entry).length === 0) delete o[id];
  }
  writeFileSync(OVERRIDES, JSON.stringify(o, null, 2) + '\n');
};

/** Species that have an excluded clip still present in birds.json, i.e. waiting for a replacement. */
function pendingReplace(): string[] {
  const birds = readJson<Birds>(BIRDS, { species: [] });
  const o = readJson<Overrides>(OVERRIDES, {});
  return birds.species
    .filter((s) => s.recordings.some((r) => o[s.id]?.exclude?.includes(r.id)))
    .map((s) => s.id);
}

async function spectrogram(file: string): Promise<Response> {
  const audio = join(PUBLIC, 'audio', file);
  if (!/^[\w.-]+\.m4a$/.test(file) || !existsSync(audio)) return new Response('not found', { status: 404 });
  mkdirSync(SPECTRO_DIR, { recursive: true });
  const png = join(SPECTRO_DIR, file.replace(/\.m4a$/, '.png'));
  if (!existsSync(png) || statSync(png).mtimeMs < statSync(audio).mtimeMs) {
    const proc = Bun.spawn(
      ['ffmpeg', '-v', 'error', '-y', '-i', audio, '-lavfi',
        'showspectrumpic=s=1000x220:legend=0:fscale=lin:scale=log:color=viridis:stop=12000', png],
      { stderr: 'pipe' },
    );
    if ((await proc.exited) !== 0) return new Response(await new Response(proc.stderr).text(), { status: 500 });
  }
  return new Response(Bun.file(png), { headers: { 'Cache-Control': 'no-cache' } });
}

let rebuilding = false;

function rebuild(): Response {
  const ids = pendingReplace();
  if (rebuilding) return new Response('A rebuild is already running.\n', { status: 409 });
  if (!ids.length) return new Response('Nothing to replace.\n');
  rebuilding = true;
  const proc = Bun.spawn(['uv', 'run', 'scripts/build_data.py', '--only', ids.join(',')], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      ctrl.enqueue(enc.encode(`$ uv run scripts/build_data.py --only ${ids.join(',')}\n`));
      const pump = async (s: ReadableStream<Uint8Array>) => {
        for await (const chunk of s) ctrl.enqueue(chunk);
      };
      await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
      const code = await proc.exited;
      ctrl.enqueue(enc.encode(code === 0 ? '\n✓ done\n' : `\n✗ exited with code ${code}\n`));
      rebuilding = false;
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname);

    if (path === '/') return new Response(Bun.file(PAGE), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

    if (path === '/api/state') {
      return Response.json({
        birds: readJson(BIRDS, { species: [] }),
        overrides: readJson(OVERRIDES, {}),
        pending: pendingReplace(),
        rebuilding,
      });
    }

    if (path === '/api/mark' && req.method === 'POST') {
      const { species, clip, status } = (await req.json()) as { species: string; clip: string; status: 'ok' | 'bad' | null };
      if (!/^[a-z-]+$/.test(species) || !/^xc\d+$/.test(clip)) return new Response('bad request', { status: 400 });
      const o = readJson<Overrides>(OVERRIDES, {});
      const entry = (o[species] ??= {});
      entry.exclude = (entry.exclude ?? []).filter((x) => x !== clip);
      entry.approved = (entry.approved ?? []).filter((x) => x !== clip);
      if (status === 'bad') entry.exclude.push(clip);
      if (status === 'ok') entry.approved.push(clip);
      writeOverrides(o);
      return Response.json({ ok: true, pending: pendingReplace() });
    }

    if (path === '/api/rebuild' && req.method === 'POST') return rebuild();

    if (path.startsWith('/spectrogram/')) return spectrogram(path.slice('/spectrogram/'.length));

    // static files from public/ (audio, img, data); refuse anything outside it
    const file = normalize(join(PUBLIC, path));
    if (file.startsWith(PUBLIC + '/') && existsSync(file) && statSync(file).isFile()) {
      return new Response(Bun.file(file), { headers: { 'Cache-Control': 'no-cache' } });
    }
    return new Response('not found', { status: 404 });
  },
});

console.log(`Clip review: http://localhost:${PORT}  (Ctrl+C to stop)`);

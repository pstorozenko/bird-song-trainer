// Offline support, page side: service worker registration and the "download all recordings" job.
// The service worker (src/sw.template.js) serves the same caches.
import { asset } from './data';
import { requestPersistence } from './storage';
import type { BirdsData } from './types';

/** Must match AUDIO_CACHE in src/sw.template.js. Clip file names are immutable (they contain the XC id). */
export const AUDIO_CACHE = 'audio-v1';

export const offlineSupported = () => typeof caches !== 'undefined';

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('service worker failed', e));
  });
}

export interface AudioCacheStatus {
  cached: number;
  total: number;
  cachedBytes: number;
  totalBytes: number;
}

const clipList = (data: BirdsData) =>
  data.species.flatMap((s) => s.recordings.map((r) => ({ url: asset(r.src), bytes: r.sizeBytes ?? 0 })));

export async function audioCacheStatus(data: BirdsData): Promise<AudioCacheStatus> {
  const clips = clipList(data);
  const totalBytes = clips.reduce((n, c) => n + c.bytes, 0);
  if (!offlineSupported()) return { cached: 0, total: clips.length, cachedBytes: 0, totalBytes };
  const cache = await caches.open(AUDIO_CACHE);
  const have = new Set((await cache.keys()).map((r) => r.url));
  const done = clips.filter((c) => have.has(c.url));
  return { cached: done.length, total: clips.length, cachedBytes: done.reduce((n, c) => n + c.bytes, 0), totalBytes };
}

/** Fetch every clip that isn't cached yet. Resolves with the number of failures. */
export async function downloadAllAudio(
  data: BirdsData,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<number> {
  void requestPersistence();
  const cache = await caches.open(AUDIO_CACHE);
  const have = new Set((await cache.keys()).map((r) => r.url));
  const todo = clipList(data).filter((c) => !have.has(c.url));
  let done = 0;
  let failed = 0;
  onProgress(0, todo.length);

  const worker = async () => {
    while (todo.length && !signal?.aborted) {
      const clip = todo.shift()!;
      try {
        const res = await fetch(clip.url, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await cache.put(clip.url, res);
      } catch (e) {
        if (signal?.aborted) return;
        failed++;
        console.warn('download failed', clip.url, e);
      }
      onProgress(++done, done + todo.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return failed;
}

export const formatMB = (bytes: number) => `${(bytes / 1_000_000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} MB`;

export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

// Android/desktop Chrome "install app" prompt, captured so the Info page can offer a button.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let installPrompt: BeforeInstallPromptEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as BeforeInstallPromptEvent;
});
export const canPromptInstall = () => installPrompt !== null;
export async function promptInstall(): Promise<boolean> {
  if (!installPrompt) return false;
  await installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  return outcome === 'accepted';
}

/** Single shared <audio> element: starting a clip stops whatever was playing. */
const player = new Audio();
player.preload = 'auto';
const listeners = new Set<(src: string | null) => void>();

export function playClip(src: string): Promise<void> {
  if (player.src !== src) player.src = src;
  player.currentTime = 0;
  return player.play();
}

export function stopClip(): void {
  player.pause();
}

export function toggleClip(src: string): void {
  if (isPlaying(src)) stopClip();
  else playClip(src).catch(reportPlayError);
}

/** Tell the user why nothing plays; the usual cause in the field is a clip that isn't saved offline. */
export function reportPlayError(err: unknown): void {
  if (err instanceof DOMException && err.name === 'AbortError') return; // interrupted by another clip
  console.warn('play failed', err);
  showToast(
    navigator.onLine
      ? 'Nie udało się odtworzyć nagrania.'
      : 'To nagranie nie jest zapisane offline. Pobierz wszystkie w zakładce Info, gdy będziesz mieć internet.',
  );
}

let toastTimer = 0;
export function showToast(text: string): void {
  let el = document.querySelector<HTMLDivElement>('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('is-visible'), 5000);
}

export function isPlaying(src: string): boolean {
  return player.src === src && !player.paused;
}

/** Subscribe to playback changes; returns an unsubscribe function. */
export function onPlaybackChange(cb: (src: string | null) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const notify = (playing: string | null) => listeners.forEach((cb) => cb(playing));
for (const ev of ['play', 'pause', 'ended'] as const) {
  player.addEventListener(ev, () => notify(player.paused ? null : player.src));
}
// A clip that fails to load (e.g. offline and not cached) fires 'play' but never 'pause'.
player.addEventListener('error', () => {
  player.pause();
  notify(null);
});

/** Warm the cache for a clip we'll need soon (next quiz question). */
const preloader = new Audio();
preloader.preload = 'auto';
preloader.muted = true;
export function preloadClip(src: string): void {
  if (preloader.src === src) return;
  preloader.src = src;
  preloader.load();
}

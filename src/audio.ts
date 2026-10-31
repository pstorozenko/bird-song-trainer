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
  else playClip(src).catch((err) => console.warn('play failed', err));
}

export function isPlaying(src: string): boolean {
  return player.src === src && !player.paused;
}

/** Subscribe to playback changes; returns an unsubscribe function. */
export function onPlaybackChange(cb: (src: string | null) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

for (const ev of ['play', 'pause', 'ended'] as const) {
  player.addEventListener(ev, () => {
    const playing = player.paused ? null : player.src;
    listeners.forEach((cb) => cb(playing));
  });
}

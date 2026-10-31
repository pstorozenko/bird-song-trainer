/** Single shared <audio> element: starting a clip stops whatever was playing. */
const player = new Audio();
player.preload = 'auto';
let onChange: ((src: string | null) => void) | null = null;

export function playClip(src: string): Promise<void> {
  if (player.src !== src) player.src = src;
  player.currentTime = 0;
  return player.play();
}

export function stopClip(): void {
  player.pause();
}

export function isPlaying(src: string): boolean {
  return player.src === src && !player.paused;
}

export function onPlaybackChange(cb: (src: string | null) => void): void {
  onChange = cb;
}

for (const ev of ['play', 'pause', 'ended'] as const) {
  player.addEventListener(ev, () => onChange?.(player.paused ? null : player.src));
}

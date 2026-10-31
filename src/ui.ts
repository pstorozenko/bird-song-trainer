import { isPlaying, onPlaybackChange, toggleClip } from './audio';
import type { Recording } from './types';

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h12v12H6z"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>',
};

/** Also the display order of the habitat filter chips. */
export const HABITAT_PL: Record<string, string> = {
  city: 'miasto',
  forest: 'las',
  meadow: 'łąka',
  park: 'park',
  wetland: 'mokradła',
};

export const TYPE_PL: Record<string, string> = { song: 'śpiew', call: 'głos', 'bill clapping': 'klekot' };

/** Round play/stop button for one clip. Wire it up once per container with bindPlayButtons(). */
export function playButton(src: string, label: string, extraClass = ''): string {
  return `<button class="play-btn ${extraClass}" type="button" data-src="${esc(src)}"
    aria-label="${esc(label)}" aria-pressed="false">${ICON.play}</button>`;
}

/** Delegated click handling + icon sync for every .play-btn inside `root`. Returns cleanup. */
export function bindPlayButtons(root: HTMLElement): () => void {
  const sync = (playing: string | null) => {
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.play-btn')) {
      const on = btn.dataset.src === playing;
      btn.innerHTML = on ? ICON.stop : ICON.play;
      btn.setAttribute('aria-pressed', String(on));
    }
  };
  const onClick = (ev: Event) => {
    const btn = (ev.target as Element).closest<HTMLButtonElement>('.play-btn');
    if (!btn || !root.contains(btn)) return;
    ev.preventDefault();
    ev.stopPropagation();
    toggleClip(btn.dataset.src!);
  };
  root.addEventListener('click', onClick);
  const unsubscribe = onPlaybackChange(sync);
  sync([...root.querySelectorAll<HTMLButtonElement>('.play-btn')].find((b) => isPlaying(b.dataset.src!))?.dataset.src ?? null);
  return () => {
    root.removeEventListener('click', onClick);
    unsubscribe();
  };
}

export function recordingCredit(r: Recording): string {
  return `${esc(r.recordist)} ·
    <a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">${esc(r.id.toUpperCase())}</a> ·
    <a href="${esc(r.licenseUrl ?? r.sourceUrl)}" target="_blank" rel="noopener">${esc(r.license)}</a>`;
}

/** Lower-case, strip diacritics (incl. ł) so "ziebe" finds "Zięba". */
export function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l');
}

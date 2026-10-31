// Listening review page: lets the owner check every chosen clip and photo on a phone.
import './styles.css';
import { asset, loadBirds } from './data';
import { isPlaying, onPlaybackChange, playClip, stopClip } from './audio';
import type { Recording, Species } from './types';

const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h12v12H6z"/></svg>';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function clipRow(sp: Species, r: Recording, i: number): string {
  const src = asset(r.src);
  return `
    <li class="clip">
      <button class="play-btn" type="button" data-src="${esc(src)}"
        aria-label="Odtwórz nagranie ${i + 1}: ${esc(sp.namePl)}">${PLAY}</button>
      <div class="clip-meta">
        <strong>${esc(r.id.toUpperCase())}</strong> · ${r.durationSec}s z ${r.sourceLengthSec ?? '?'}s · jakość ${esc(r.quality ?? '?')}<br />
        ${esc(r.recordist)} · ${esc(r.location ?? r.country ?? '')}<br />
        <a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">xeno-canto</a> ·
        <a href="${esc(r.licenseUrl ?? r.sourceUrl)}" target="_blank" rel="noopener">${esc(r.license)}</a>
      </div>
    </li>`;
}

function card(sp: Species): string {
  const img = sp.image
    ? `<img class="card-photo" src="${esc(asset(sp.image.src))}" alt="${esc(sp.namePl)}" loading="lazy" />`
    : '<div class="card-photo card-photo--empty" aria-hidden="true">brak zdjęcia</div>';
  const credit = sp.image
    ? `<p class="credit">Zdjęcie: ${esc(sp.image.author)} · ${
        sp.image.licenseUrl
          ? `<a href="${esc(sp.image.licenseUrl)}" target="_blank" rel="noopener">${esc(sp.image.license)}</a>`
          : esc(sp.image.license)
      }${
        sp.image.sourceUrl
          ? ` · <a href="${esc(sp.image.sourceUrl)}" target="_blank" rel="noopener">${esc(new URL(sp.image.sourceUrl).hostname)}</a>`
          : ''
      }</p>`
    : '<p class="credit error">Brak zdjęcia</p>';
  return `
    <article class="card" id="${esc(sp.id)}">
      ${img}
      <div class="card-body">
        <h2 class="card-title">${esc(sp.namePl)}</h2>
        <p class="card-sub"><i>${esc(sp.nameLatin)}</i> · ${esc(sp.nameEn)}</p>
        <p class="card-note">${esc(sp.note)}</p>
        <ul class="clips">${sp.recordings.map((r, i) => clipRow(sp, r, i)).join('')}</ul>
        ${credit}
      </div>
    </article>`;
}

async function main() {
  const summary = document.getElementById('summary')!;
  const list = document.getElementById('list')!;
  try {
    const data = await loadBirds();
    const clips = data.species.reduce((n, s) => n + s.recordings.length, 0);
    summary.textContent = `${data.species.length} gatunków · ${clips} nagrań · wygenerowano ${new Date(
      data.generatedAt,
    ).toLocaleString('pl-PL')}`;
    list.innerHTML = data.species.map(card).join('');
  } catch (e) {
    summary.innerHTML = `<span class="error">Nie udało się wczytać danych: ${esc(String(e))}</span>`;
    return;
  }

  list.addEventListener('click', (ev) => {
    const btn = (ev.target as Element).closest<HTMLButtonElement>('.play-btn');
    if (!btn) return;
    const src = btn.dataset.src!;
    if (isPlaying(src)) stopClip();
    else playClip(src).catch((err) => console.warn('play failed', err));
  });

  onPlaybackChange((playing) => {
    for (const btn of list.querySelectorAll<HTMLButtonElement>('.play-btn')) {
      const on = btn.dataset.src === playing;
      btn.innerHTML = on ? STOP : PLAY;
      btn.setAttribute('aria-pressed', String(on));
    }
  });
}

main();

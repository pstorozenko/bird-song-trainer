// Study tab: searchable/filterable species list and a detail view per species.
import { asset } from './data';
import { bindPlayButtons, esc, fold, HABITAT_PL, ICON, playButton, recordingCredit } from './ui';
import type { BirdsData, Species } from './types';

type Cleanup = () => void;

/** Filter state survives switching between list and detail (not page reloads). */
const filter = { query: '', habitat: '' };
let listScrollY = 0;

const TYPE_PL: Record<string, string> = { song: 'śpiew', call: 'głos' };

function matches(sp: Species): boolean {
  if (filter.habitat && !sp.habitat.includes(filter.habitat)) return false;
  if (!filter.query) return true;
  const q = fold(filter.query.trim());
  return [sp.namePl, sp.nameLatin, sp.nameEn, sp.family].some((s) => fold(s).includes(q));
}

function row(sp: Species): string {
  const thumb = sp.image
    ? `<img class="row-thumb" src="${esc(asset(sp.image.src))}" alt="" loading="lazy" width="64" height="64" />`
    : '<div class="row-thumb row-thumb--empty" aria-hidden="true"></div>';
  const first = sp.recordings[0];
  return `
    <li class="row">
      <a class="row-link" href="#/study/${esc(sp.id)}">
        ${thumb}
        <span class="row-text">
          <span class="row-title">${esc(sp.namePl)}</span>
          <span class="row-sub">${esc(sp.nameLatin)}</span>
        </span>
      </a>
      ${first ? playButton(asset(first.src), `Odtwórz: ${sp.namePl}`) : ''}
    </li>`;
}

export function renderStudyList(view: HTMLElement, data: BirdsData): Cleanup {
  const habitats = [...new Set(data.species.flatMap((s) => s.habitat))].sort(
    (a, b) => Object.keys(HABITAT_PL).indexOf(a) - Object.keys(HABITAT_PL).indexOf(b),
  );

  view.innerHTML = `
    <header class="list-header">
      <h1 class="view-title">Nauka</h1>
      <label class="search">
        <span class="visually-hidden">Szukaj ptaka</span>
        <input id="search" type="search" placeholder="Szukaj: nazwa polska, łacińska…"
          autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" value="${esc(filter.query)}" />
      </label>
      <div class="chips" role="group" aria-label="Siedlisko">
        ${['', ...habitats]
          .map(
            (h) => `<button type="button" class="chip" data-habitat="${h}" aria-pressed="${filter.habitat === h}">
              ${h ? esc(HABITAT_PL[h] ?? h) : 'wszystkie'}</button>`,
          )
          .join('')}
      </div>
    </header>
    <p class="list-count" aria-live="polite"></p>
    <ul class="rows"></ul>`;

  const list = view.querySelector<HTMLUListElement>('.rows')!;
  const count = view.querySelector<HTMLParagraphElement>('.list-count')!;
  const search = view.querySelector<HTMLInputElement>('#search')!;

  const update = () => {
    const shown = data.species.filter(matches);
    list.innerHTML = shown.map(row).join('');
    count.textContent = shown.length
      ? `${shown.length} z ${data.species.length} gatunków`
      : 'Brak ptaków pasujących do wyszukiwania.';
    for (const chip of view.querySelectorAll<HTMLButtonElement>('.chip')) {
      chip.setAttribute('aria-pressed', String(chip.dataset.habitat === filter.habitat));
    }
  };

  search.addEventListener('input', () => {
    filter.query = search.value;
    update();
  });
  view.querySelector('.chips')!.addEventListener('click', (ev) => {
    const chip = (ev.target as Element).closest<HTMLButtonElement>('.chip');
    if (!chip) return;
    filter.habitat = chip.dataset.habitat ?? '';
    update();
  });
  const onScroll = () => (listScrollY = window.scrollY);

  update();
  const unbind = bindPlayButtons(list);
  requestAnimationFrame(() => window.scrollTo(0, listScrollY));
  window.addEventListener('scroll', onScroll, { passive: true });

  return () => {
    unbind();
    window.removeEventListener('scroll', onScroll);
  };
}

export function renderStudyDetail(view: HTMLElement, data: BirdsData, id: string): Cleanup {
  const sp = data.species.find((s) => s.id === id);
  if (!sp) {
    view.innerHTML = `<p class="status">Nie znaleziono ptaka „${esc(id)}”. <a href="#/study">Wróć do listy</a></p>`;
    return () => {};
  }

  const similar = sp.similarTo
    .map((sid) => data.species.find((s) => s.id === sid))
    .filter((s): s is Species => !!s);

  const photo = sp.image
    ? `<img class="detail-photo" src="${esc(asset(sp.image.src))}" alt="${esc(sp.namePl)}" />`
    : '<div class="detail-photo card-photo--empty" aria-hidden="true">brak zdjęcia</div>';

  const photoCredit = sp.image
    ? `<p class="credit">Zdjęcie: ${esc(sp.image.author)} · ${
        sp.image.licenseUrl
          ? `<a href="${esc(sp.image.licenseUrl)}" target="_blank" rel="noopener">${esc(sp.image.license)}</a>`
          : esc(sp.image.license)
      }${
        sp.image.sourceUrl
          ? ` · <a href="${esc(sp.image.sourceUrl)}" target="_blank" rel="noopener">źródło</a>`
          : ''
      }</p>`
    : '';

  view.innerHTML = `
    <div class="detail">
      <a class="back-link" href="#/study">${ICON.back}<span>Lista</span></a>
      ${photo}
      <div class="detail-body">
        <h1 class="detail-title">${esc(sp.namePl)}</h1>
        <p class="detail-sub"><i>${esc(sp.nameLatin)}</i> · ${esc(sp.nameEn)}</p>
        <p class="tags">${sp.habitat.map((h) => `<span class="tag">${esc(HABITAT_PL[h] ?? h)}</span>`).join('')}
          <span class="tag tag--muted">${esc(sp.family)}</span></p>
        <p class="detail-note">${esc(sp.note)}</p>

        <h2 class="section-title">Nagrania</h2>
        <ul class="clips">
          ${sp.recordings
            .map(
              (r, i) => `
            <li class="clip">
              ${playButton(asset(r.src), `Odtwórz nagranie ${i + 1}: ${sp.namePl}`)}
              <div class="clip-meta">
                <strong>${esc(TYPE_PL[r.type] ?? r.type)} ${i + 1}</strong> · ${Math.round(r.durationSec)} s${
                  r.location ? ` · ${esc(shortLocation(r.location))}` : ''
                }<br />
                ${recordingCredit(r)}
              </div>
            </li>`,
            )
            .join('')}
        </ul>

        ${
          similar.length
            ? `<h2 class="section-title">Podobne</h2>
               <ul class="similar">${similar
                 .map((s) => `<li><a href="#/study/${esc(s.id)}">${esc(s.namePl)}</a></li>`)
                 .join('')}</ul>`
            : ''
        }
        ${photoCredit}
      </div>
    </div>`;

  window.scrollTo(0, 0);
  return bindPlayButtons(view);
}

/** "Gmina Kęty (near  Kęty), Powiat oświęcimski, Małopolskie" -> "Gmina Kęty, Małopolskie" */
function shortLocation(loc: string): string {
  const parts = loc.replace(/\s*\(near[^)]*\)/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? `${parts[0]}, ${parts[parts.length - 1]}` : parts[0] ?? '';
}

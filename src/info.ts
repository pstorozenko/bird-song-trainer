// Info tab: install/offline status, "download all recordings", and full credits.
import {
  audioCacheStatus, canPromptInstall, downloadAllAudio, formatMB, isIOS, isStandalone, offlineSupported, promptInstall,
} from './offline';
import { esc, TYPE_PL } from './ui';
import type { BirdsData, Species } from './types';

function installSection(): string {
  if (isStandalone()) return '';
  if (isIOS()) {
    return `
      <div class="info-card info-card--tip">
        <h2 class="info-h">Dodaj do ekranu początkowego</h2>
        <p>Na iPhonie stuknij <strong>Udostępnij</strong> (kwadrat ze strzałką), a potem
        <strong>Do ekranu początkowego</strong>. Aplikacja będzie działać bez internetu, a Safari nie
        usunie Twojego postępu po kilku dniach nieużywania.</p>
      </div>`;
  }
  return `
    <div class="info-card info-card--tip" ${canPromptInstall() ? '' : 'hidden'} data-install>
      <h2 class="info-h">Zainstaluj aplikację</h2>
      <p>Ikona na ekranie głównym, pełny ekran i działanie bez internetu.</p>
      <button class="btn btn-primary btn-block" type="button" data-action="install">Zainstaluj</button>
    </div>`;
}

function offlineSection(): string {
  if (!offlineSupported()) {
    return `<div class="info-card"><h2 class="info-h">Tryb offline</h2>
      <p>Ta przeglądarka nie obsługuje zapisywania nagrań offline.</p></div>`;
  }
  return `
    <div class="info-card" id="offline">
      <h2 class="info-h">Tryb offline</h2>
      <p>Aplikacja, zdjęcia i dane zapisują się automatycznie. Nagrania zapisują się, gdy je odtworzysz —
      albo pobierz wszystkie naraz przed wyjściem w teren.</p>
      <p class="offline-status" aria-live="polite">Sprawdzam…</p>
      <div class="meter" hidden><span></span></div>
      <button class="btn btn-primary btn-block" type="button" data-action="download" hidden>Pobierz wszystkie nagrania</button>
    </div>`;
}

function speciesCredits(sp: Species): string {
  const img = sp.image;
  const photo = img
    ? `<li>Zdjęcie: ${esc(img.author)} · ${
        img.licenseUrl ? `<a href="${esc(img.licenseUrl)}" target="_blank" rel="noopener">${esc(img.license)}</a>` : esc(img.license)
      }${img.sourceUrl ? ` · <a href="${esc(img.sourceUrl)}" target="_blank" rel="noopener">źródło</a>` : ''}</li>`
    : '';
  const clips = sp.recordings
    .map(
      (r) => `<li>${esc(TYPE_PL[r.type] ?? r.type)}: ${esc(r.recordist)} ·
        <a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">${esc(r.id.toUpperCase())}</a> ·
        <a href="${esc(r.licenseUrl ?? r.sourceUrl)}" target="_blank" rel="noopener">${esc(r.license)}</a></li>`,
    )
    .join('');
  return `<li class="credits-species"><a class="credits-name" href="#/study/${esc(sp.id)}">${esc(sp.namePl)}</a>
    <i>${esc(sp.nameLatin)}</i><ul>${clips}${photo}</ul></li>`;
}

function creditsSection(data: BirdsData): string {
  const recordists = new Set(data.species.flatMap((s) => s.recordings.map((r) => r.recordist)));
  return `
    <section class="info-card" id="credits">
      <h2 class="info-h">Autorzy i licencje</h2>
      <p>Nagrania pochodzą z <a href="https://xeno-canto.org" target="_blank" rel="noopener">xeno-canto.org</a>
      (${recordists.size} autorów, licencje Creative Commons). Na potrzeby aplikacji zostały
      <strong>zmodyfikowane</strong>: przycięte do ok. 12 s, wyrównane głośnościowo i przekodowane do AAC.
      Zmodyfikowane nagrania udostępniamy na tych samych licencjach co oryginały (podanych przy każdym nagraniu),
      wyłącznie niekomercyjnie.</p>
      <p>Zdjęcia pochodzą głównie z <a href="https://commons.wikimedia.org" target="_blank" rel="noopener">Wikimedia Commons</a>
      (licencje CC lub domena publiczna); zostały przeskalowane i skadrowane.</p>
      <p>Dziękujemy wszystkim autorom nagrań i zdjęć!</p>
      <ul class="credits">${data.species.map(speciesCredits).join('')}</ul>
    </section>`;
}

export function renderInfo(view: HTMLElement, data: BirdsData): () => void {
  view.innerHTML = `
    <h1 class="view-title">Info</h1>
    <p class="info-lead">Ptasie głosy — nauka rozpoznawania ptaków po głosie.
      ${data.species.length} gatunków, ${data.species.reduce((n, s) => n + s.recordings.length, 0)} nagrań.</p>
    ${installSection()}
    ${offlineSection()}
    <div class="info-card">
      <h2 class="info-h">Autor</h2>
      <p>Piotr Pasza Storożenko<br />
        GitHub: <a href="https://github.com/pstorozenko" target="_blank" rel="noopener">github.com/pstorozenko</a></p>
    </div>
    ${creditsSection(data)}
    <p class="info-foot">Projekt prywatny, niekomercyjny. Dane z ${new Date(data.generatedAt).toLocaleDateString('pl-PL')}.</p>`;

  const abort = new AbortController();
  const status = view.querySelector<HTMLParagraphElement>('.offline-status');
  const meter = view.querySelector<HTMLDivElement>('.meter');
  const button = view.querySelector<HTMLButtonElement>('[data-action=download]');
  let downloading = false;

  const refresh = async () => {
    if (!status || !button) return;
    const s = await audioCacheStatus(data);
    if (abort.signal.aborted) return;
    const missing = s.totalBytes - s.cachedBytes;
    if (s.cached >= s.total) {
      status.innerHTML = `<span class="ok-text">✓ Wszystkie nagrania (${s.total}) są zapisane — możesz ćwiczyć bez internetu.</span>`;
      button.hidden = true;
    } else {
      status.textContent = `Zapisane nagrania: ${s.cached} z ${s.total}.`;
      button.hidden = false;
      button.textContent = `Pobierz ${s.cached ? 'brakujące' : 'wszystkie'} nagrania (${formatMB(missing)})`;
    }
  };

  const onClick = async (ev: Event) => {
    const el = (ev.target as Element).closest<HTMLElement>('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'install') {
      await promptInstall();
      view.querySelector<HTMLElement>('[data-install]')?.setAttribute('hidden', '');
      return;
    }
    if (el.dataset.action !== 'download' || downloading || !status || !meter || !button) return;
    downloading = true;
    button.disabled = true;
    meter.hidden = false;
    const bar = meter.querySelector('span')!;
    const failed = await downloadAllAudio(
      data,
      (done, total) => {
        status.textContent = `Pobieranie… ${done} z ${total}`;
        bar.style.width = `${total ? (done / total) * 100 : 100}%`;
      },
      abort.signal,
    );
    if (abort.signal.aborted) return;
    downloading = false;
    button.disabled = false;
    meter.hidden = true;
    await refresh();
    if (failed) status.innerHTML += ` <span class="error">Nie udało się pobrać ${failed} — spróbuj ponownie.</span>`;
  };

  view.addEventListener('click', onClick);
  void refresh();
  window.scrollTo(0, 0);
  return () => {
    abort.abort();
    view.removeEventListener('click', onClick);
  };
}

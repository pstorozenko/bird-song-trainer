import './styles.css';
import { stopClip } from './audio';
import { loadBirds } from './data';
import { renderInfo } from './info';
import { registerServiceWorker } from './offline';
import { renderQuiz } from './quiz';
import { renderStudyDetail, renderStudyList } from './study';
import { esc } from './ui';
import type { BirdsData } from './types';

const view = document.getElementById('view')!;
const tabs = [...document.querySelectorAll<HTMLAnchorElement>('.tabbar a[data-tab]')];
let cleanup: () => void = () => {};
let lastTab = '';

type Route = { tab: 'study'; id?: string } | { tab: 'quiz' } | { tab: 'info' };

function parseRoute(): Route {
  const [, tab, id] = location.hash.replace(/^#/, '').split('/');
  if (tab === 'quiz') return { tab: 'quiz' };
  if (tab === 'info') return { tab: 'info' };
  return { tab: 'study', id: id ? decodeURIComponent(id) : undefined };
}

function render(data: BirdsData) {
  const route = parseRoute();
  cleanup();
  if (route.tab !== lastTab) stopClip(); // switching tabs silences any clip
  lastTab = route.tab;

  for (const a of tabs) {
    if (a.dataset.tab === route.tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }

  // Lets the desktop layout give each view its own width/arrangement.
  view.dataset.view = route.tab === 'study' ? (route.id ? 'detail' : 'list') : route.tab;

  if (route.tab === 'quiz') cleanup = renderQuiz(view, data);
  else if (route.tab === 'info') cleanup = renderInfo(view, data);
  else if (route.id) cleanup = renderStudyDetail(view, data, route.id);
  else cleanup = renderStudyList(view, data);

  view.focus({ preventScroll: true });
}

async function main() {
  try {
    const data = await loadBirds();
    window.addEventListener('hashchange', () => render(data));
    render(data);
  } catch (e) {
    view.innerHTML = `<p class="status error">Nie udało się wczytać danych: ${esc(String(e))}</p>`;
  }
}

registerServiceWorker();
main();

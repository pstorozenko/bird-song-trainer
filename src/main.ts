import './styles.css';
import { stopClip } from './audio';
import { loadBirds } from './data';
import { renderQuiz } from './quiz';
import { renderStudyDetail, renderStudyList } from './study';
import { esc } from './ui';
import type { BirdsData } from './types';

const view = document.getElementById('view')!;
const tabs = [...document.querySelectorAll<HTMLAnchorElement>('.tabbar a')];
let cleanup: () => void = () => {};
let lastTab = '';

type Route = { tab: 'study'; id?: string } | { tab: 'quiz' };

function parseRoute(): Route {
  const [, tab, id] = location.hash.replace(/^#/, '').split('/');
  if (tab === 'quiz') return { tab: 'quiz' };
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

  if (route.tab === 'quiz') cleanup = renderQuiz(view, data);
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

main();

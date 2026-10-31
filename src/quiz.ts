// Quiz tab — milestone 3. Placeholder for now.
import type { BirdsData } from './types';

export function renderQuiz(view: HTMLElement, data: BirdsData): () => void {
  view.innerHTML = `
    <h1 class="view-title">Quiz</h1>
    <div class="placeholder">
      <p>Wkrótce: posłuchaj nagrania i wybierz właściwego ptaka spośród czterech.</p>
      <p>Na razie poznaj ${data.species.length} gatunków w zakładce <a href="#/study">Nauka</a>.</p>
    </div>`;
  window.scrollTo(0, 0);
  return () => {};
}

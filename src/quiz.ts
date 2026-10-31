// Quiz tab: hear a clip, pick the bird from four photos, get instant feedback.
import { isPlaying, onPlaybackChange, playClip, preloadClip, stopClip } from './audio';
import { asset } from './data';
import { activeIds, isLearned, isNew, lockedIds, maybeUnlock, recordAnswer, weightOf } from './progress';
import { QuestionPicker, type Answer, type Question } from './quizEngine';
import { exportProgress, getProgress, readProgressFile, replaceProgress, requestPersistence, resetProgress, saveProgress } from './storage';
import { esc, ICON, recordingCredit, TYPE_PL } from './ui';
import type { BirdsData, Species } from './types';

const ROUND_LENGTH = 10;
const CHOICES = 4;

type Phase = 'intro' | 'question' | 'answered' | 'summary';

interface Session {
  phase: Phase;
  picker: QuestionPicker;
  current: Question | null;
  upcoming: Question | null;
  answers: Answer[];
  /** Species unlocked during this round, in order. */
  unlocked: Species[];
  /** Species unlocked by the most recent answer (shown in the reveal panel). */
  justUnlocked: Species | null;
}

/** Module-level so a round survives switching to the Study tab and back. */
let session: Session | null = null;

const allIds = (data: BirdsData) => data.species.map((s) => s.id);

function newSession(data: BirdsData): Session {
  const picker = new QuestionPicker({
    pool: data.species,
    active: () => activeIds(getProgress(), allIds(data)),
    weight: (id) => weightOf(getProgress(), id),
    choiceCount: CHOICES,
  });
  return { phase: 'intro', picker, current: null, upcoming: null, answers: [], unlocked: [], justUnlocked: null };
}

function advance(s: Session) {
  s.current = s.upcoming ?? s.picker.next();
  s.upcoming = null; // picked after answering, so it reflects the updated boxes
  s.justUnlocked = null;
  s.phase = 'question';
}

const clipSrc = (q: Question) => asset(q.recording.src);

function playCurrent(s: Session) {
  if (!s.current) return;
  playClip(clipSrc(s.current)).catch((err) => console.warn('play failed', err));
}

// ---------------------------------------------------------------- views

function introView(data: BirdsData, message = ''): string {
  const p = getProgress();
  const ids = allIds(data);
  const active = activeIds(p, ids);
  const learned = ids.filter((id) => isLearned(p, id)).length;
  const { totalAnswered, totalCorrect } = p.stats;
  const accuracy = totalAnswered ? `${Math.round((totalCorrect / totalAnswered) * 100)}%` : '–';
  const locked = lockedIds(p, ids).length;

  return `
    <h1 class="view-title">Quiz</h1>
    <div class="quiz-intro">
      <div class="quiz-intro-icon" aria-hidden="true">${ICON.play}</div>
      <p class="quiz-intro-lead">Posłuchaj nagrania i wybierz właściwego ptaka.</p>
      <p class="quiz-intro-sub">${ROUND_LENGTH} pytań · ${active.length} ${active.length === 1 ? 'gatunek' : 'gatunków'} w nauce</p>
      <button class="btn btn-primary btn-block" type="button" data-action="start">${totalAnswered ? 'Kontynuuj naukę' : 'Zaczynamy'}</button>
    </div>

    <dl class="stats">
      <div><dt>W nauce</dt><dd>${active.length}<small> / ${ids.length}</small></dd></div>
      <div><dt>Opanowane</dt><dd>${learned}</dd></div>
      <div><dt>Skuteczność</dt><dd>${accuracy}</dd></div>
    </dl>
    <p class="stats-hint">${
      locked
        ? `Kolejne gatunki odblokują się, gdy dobrze poznasz obecne. Zostało jeszcze ${locked}.`
        : 'Wszystkie gatunki są już w nauce.'
    }</p>

    <details class="manage" ${message ? 'open' : ''}>
      <summary>Zarządzaj postępem</summary>
      <p>Postęp zapisuje się tylko na tym urządzeniu, w tej przeglądarce. Możesz go zapisać do pliku i wczytać na innym urządzeniu.</p>
      <div class="manage-actions">
        <button class="btn btn-ghost" type="button" data-action="export">Zapisz do pliku</button>
        <label class="btn btn-ghost">Wczytaj z pliku<input type="file" accept="application/json,.json" data-action="import" hidden /></label>
        <button class="btn btn-ghost btn-danger" type="button" data-action="reset">Zacznij od nowa</button>
      </div>
      ${message ? `<p class="manage-message" role="status">${message}</p>` : ''}
    </details>`;
}

function progressView(s: Session): string {
  const n = s.answers.length + (s.phase === 'question' ? 1 : 0);
  const correct = s.answers.filter((a) => a.correct).length;
  return `
    <div class="quiz-top">
      <span>Pytanie <strong>${Math.min(n, ROUND_LENGTH)}</strong> z ${ROUND_LENGTH}</span>
      <span class="quiz-score" aria-label="Poprawne odpowiedzi: ${correct}">✓ ${correct}</span>
    </div>
    <div class="quiz-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${ROUND_LENGTH}"
      aria-valuenow="${s.answers.length}"><span style="width:${(s.answers.length / ROUND_LENGTH) * 100}%"></span></div>`;
}

function choiceView(sp: Species, i: number, answer: Answer | null): string {
  let state = '';
  let badge = !answer && isNew(getProgress(), sp.id) ? '<span class="choice-new">nowy</span>' : '';
  if (answer) {
    if (sp.id === answer.question.species.id) {
      state = 'is-correct';
      badge = '<span class="choice-badge" aria-hidden="true">✓</span><span class="visually-hidden">(poprawna odpowiedź)</span>';
    } else if (sp.id === answer.picked.id) {
      state = 'is-wrong';
      badge = '<span class="choice-badge" aria-hidden="true">✗</span><span class="visually-hidden">(twoja odpowiedź, błędna)</span>';
    } else {
      state = 'is-dim';
    }
  }
  const img = sp.image
    ? `<img src="${esc(asset(sp.image.src))}" alt="" />`
    : '<span class="choice-noimg" aria-hidden="true"></span>';
  return `
    <button type="button" class="choice ${state}" data-choice="${esc(sp.id)}" ${answer ? 'disabled' : ''}>
      <span class="choice-photo">${img}${badge}</span>
      <span class="choice-name"><span class="choice-key" aria-hidden="true">${i + 1}</span>${esc(sp.namePl)}</span>
    </button>`;
}

function questionView(s: Session): string {
  const q = s.current!;
  const answer = s.phase === 'answered' ? s.answers[s.answers.length - 1] : null;
  const playing = isPlaying(clipSrc(q));
  const last = s.answers.length >= ROUND_LENGTH;

  const reveal = answer
    ? `
      <section class="reveal ${answer.correct ? 'reveal--ok' : 'reveal--bad'}" aria-live="assertive">
        <p class="reveal-status">${
          answer.correct
            ? '<span aria-hidden="true">✓</span> Dobrze!'
            : `<span aria-hidden="true">✗</span> Niestety — to nie ${esc(answer.picked.namePl.toLowerCase())}.`
        }</p>
        <p class="reveal-name"><strong>${esc(q.species.namePl)}</strong> · <i>${esc(q.species.nameLatin)}</i></p>
        <p class="reveal-note">${esc(q.species.note)}</p>
        <p class="credit">Nagranie (${esc(TYPE_PL[q.recording.type] ?? q.recording.type)}): ${recordingCredit(q.recording)}</p>
        ${
          s.justUnlocked
            ? `<p class="reveal-unlock">Nowy ptak w quizie: <a href="#/study/${esc(s.justUnlocked.id)}">${esc(s.justUnlocked.namePl)}</a></p>`
            : ''
        }
        <div class="reveal-actions">
          <a class="btn btn-ghost" href="#/study/${esc(q.species.id)}">Więcej</a>
          <button class="btn btn-primary" type="button" data-action="next">${last ? 'Wynik' : 'Dalej'}</button>
        </div>
      </section>`
    : '';

  return `
    ${progressView(s)}
    <div class="listen">
      <button class="listen-btn" type="button" data-action="replay" aria-pressed="${playing}"
        aria-label="${playing ? 'Zatrzymaj nagranie' : 'Odtwórz nagranie'}">${playing ? ICON.stop : ICON.play}</button>
      <p class="listen-hint">${answer ? 'Posłuchaj jeszcze raz' : q.recording.type === 'song' ? 'Kto tak śpiewa?' : 'Czyj to głos?'}</p>
    </div>
    <div class="choices" role="group" aria-label="Odpowiedzi">
      ${q.choices.map((c, i) => choiceView(c, i, answer)).join('')}
    </div>
    ${reveal}`;
}

function summaryView(s: Session): string {
  const correct = s.answers.filter((a) => a.correct).length;
  const pct = Math.round((correct / s.answers.length) * 100);
  const missed = new Map<string, Species>();
  for (const a of s.answers) if (!a.correct) missed.set(a.question.species.id, a.question.species);
  const verdict = pct === 100 ? 'Perfekcyjnie!' : pct >= 80 ? 'Świetnie!' : pct >= 50 ? 'Nieźle!' : 'Ćwiczenie czyni mistrza.';

  return `
    <h1 class="view-title">Wynik</h1>
    <div class="summary">
      <p class="summary-score"><strong>${correct}</strong> / ${s.answers.length}</p>
      <p class="summary-verdict">${verdict}</p>
      ${
        missed.size
          ? `<h2 class="section-title">Do powtórki</h2>
             <ul class="rows">${[...missed.values()]
               .map(
                 (sp) => `
               <li class="row"><a class="row-link" href="#/study/${esc(sp.id)}">
                 ${
                   sp.image
                     ? `<img class="row-thumb" src="${esc(asset(sp.image.src))}" alt="" width="64" height="64" />`
                     : '<span class="row-thumb" aria-hidden="true"></span>'
                 }
                 <span class="row-text"><span class="row-title">${esc(sp.namePl)}</span>
                 <span class="row-sub">${esc(sp.nameLatin)}</span></span></a></li>`,
               )
               .join('')}</ul>`
          : ''
      }
      ${
        s.unlocked.length
          ? `<h2 class="section-title">Nowe w quizie</h2>
             <p class="summary-unlocked">${s.unlocked
               .map((sp) => `<a href="#/study/${esc(sp.id)}">${esc(sp.namePl)}</a>`)
               .join(', ')} — posłuchaj ${s.unlocked.length > 1 ? 'ich' : 'go'} w zakładce Nauka.</p>`
          : ''
      }
      <div class="summary-actions">
        <button class="btn btn-primary btn-block" type="button" data-action="restart">Jeszcze raz</button>
        <button class="btn btn-ghost btn-block" type="button" data-action="intro">Postęp i statystyki</button>
      </div>
    </div>`;
}

// ---------------------------------------------------------------- controller

export function renderQuiz(view: HTMLElement, data: BirdsData): () => void {
  session ??= newSession(data);
  const s = session;

  const paint = (message = '') => {
    if (s.phase === 'intro') view.innerHTML = introView(data, message);
    else if (s.phase === 'summary') view.innerHTML = summaryView(s);
    else view.innerHTML = questionView(s);
  };

  const start = () => {
    Object.assign(s, newSession(data)); // reset in place; `session` still points at `s`
    advance(s);
    paint();
    window.scrollTo(0, 0);
    playCurrent(s); // inside the tap handler, so mobile autoplay rules are satisfied
  };

  const answer = (id: string) => {
    if (s.phase !== 'question' || !s.current) return;
    const picked = s.current.choices.find((c) => c.id === id);
    if (!picked) return;
    const correct = picked.id === s.current.species.id;
    s.answers.push({ question: s.current, picked, correct });
    s.phase = 'answered';

    const p = getProgress();
    recordAnswer(p, s.current.species.id, correct);
    const unlockedId = maybeUnlock(p, allIds(data));
    saveProgress(p);
    void requestPersistence();
    s.justUnlocked = unlockedId ? data.species.find((sp) => sp.id === unlockedId) ?? null : null;
    if (s.justUnlocked) s.unlocked.push(s.justUnlocked);

    if (s.answers.length < ROUND_LENGTH) {
      s.upcoming = s.picker.next();
      preloadClip(asset(s.upcoming.recording.src));
    }
    navigator.vibrate?.(correct ? 20 : [40, 60, 40]);
    paint();
    view.querySelector('.reveal')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const next = () => {
    if (s.phase !== 'answered') return;
    stopClip();
    if (s.answers.length >= ROUND_LENGTH) {
      s.phase = 'summary';
      paint();
      window.scrollTo(0, 0);
      return;
    }
    advance(s);
    paint();
    window.scrollTo(0, 0);
    playCurrent(s);
  };

  const replay = () => {
    if (!s.current) return;
    if (isPlaying(clipSrc(s.current))) stopClip();
    else playCurrent(s);
  };

  const onClick = (ev: Event) => {
    const el = (ev.target as Element).closest<HTMLElement>('[data-action],[data-choice]');
    if (!el || !view.contains(el)) return;
    if (el.dataset.choice) return answer(el.dataset.choice);
    switch (el.dataset.action) {
      case 'start':
      case 'restart':
        return start();
      case 'next':
        return next();
      case 'replay':
        return replay();
      case 'intro':
        s.phase = 'intro';
        paint();
        window.scrollTo(0, 0);
        return;
      case 'export':
        return exportProgress();
      case 'reset':
        if (confirm('Usunąć cały postęp na tym urządzeniu? Tego nie da się cofnąć.')) {
          resetProgress();
          paint('Postęp wyczyszczony.');
        }
        return;
    }
  };

  const onChange = async (ev: Event) => {
    const input = ev.target as HTMLInputElement;
    if (input.dataset.action !== 'import' || !input.files?.[0]) return;
    try {
      const imported = await readProgressFile(input.files[0]);
      if (!confirm('Zastąpić obecny postęp tym z pliku?')) return paint();
      replaceProgress(imported);
      paint(`Wczytano postęp: ${imported.stats.totalAnswered} odpowiedzi.`);
    } catch (e) {
      paint(`<span class="error">${esc(e instanceof Error ? e.message : String(e))}</span>`);
    }
  };

  const onKey = (ev: KeyboardEvent) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (s.phase === 'question' && /^[1-9]$/.test(ev.key)) {
      const c = s.current?.choices[Number(ev.key) - 1];
      if (c) answer(c.id);
    } else if ((ev.key === ' ' || ev.key === 'r') && (s.phase === 'question' || s.phase === 'answered')) {
      if ((ev.target as Element).closest('button, a')) return; // let Space activate focused controls
      ev.preventDefault();
      replay();
    } else if (ev.key === 'Enter' && s.phase === 'answered' && !(ev.target as Element).closest('button, a')) {
      next();
    }
  };

  // Keep the big listen button in sync with playback.
  const unsubscribe = onPlaybackChange((playing) => {
    const btn = view.querySelector<HTMLButtonElement>('.listen-btn');
    if (!btn || !s.current) return;
    const on = playing === clipSrc(s.current);
    btn.innerHTML = on ? ICON.stop : ICON.play;
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Zatrzymaj nagranie' : 'Odtwórz nagranie');
  });

  view.addEventListener('click', onClick);
  view.addEventListener('change', onChange);
  document.addEventListener('keydown', onKey);
  paint();
  window.scrollTo(0, 0);

  return () => {
    view.removeEventListener('click', onClick);
    view.removeEventListener('change', onChange);
    document.removeEventListener('keydown', onKey);
    unsubscribe();
  };
}

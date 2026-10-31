// localStorage-backed progress store + export/import. All storage access is try/catch'd:
// private mode or blocked storage must never break the app (progress just won't persist).
import { emptyProgress, normalizeProgress, type Progress } from './progress';

const KEY = 'birdTrainer.progress.v1';
const PERSIST_ASKED_KEY = 'birdTrainer.persistAsked';

let cached: Progress | null = null;

export function getProgress(): Progress {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    cached = raw ? normalizeProgress(JSON.parse(raw)) : emptyProgress();
  } catch (e) {
    console.warn('progress: starting fresh', e);
    cached = emptyProgress();
  }
  return cached;
}

export function saveProgress(p: Progress = getProgress()): void {
  cached = p;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch (e) {
    console.warn('progress: could not save', e);
  }
}

export function replaceProgress(p: Progress): void {
  saveProgress(p);
}

export function resetProgress(): void {
  saveProgress(emptyProgress());
}

/**
 * Ask the browser not to evict our storage (helps on iOS/Safari). Asked once per device,
 * after the first answer, because Firefox shows a permission prompt for it.
 */
export async function requestPersistence(): Promise<void> {
  try {
    if (localStorage.getItem(PERSIST_ASKED_KEY)) return;
    localStorage.setItem(PERSIST_ASKED_KEY, '1');
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    /* best effort */
  }
}

export function exportProgress(p: Progress = getProgress()): void {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ptasie-glosy-postep-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Parse an exported file. Throws a user-presentable error if it isn't valid progress. */
export async function readProgressFile(file: File): Promise<Progress> {
  if (file.size > 1_000_000) throw new Error('Plik jest za duży.');
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('To nie jest plik JSON.');
  }
  try {
    return normalizeProgress(data);
  } catch {
    throw new Error('To nie jest plik z postępem Ptasich głosów.');
  }
}

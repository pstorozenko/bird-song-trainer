// Spaced-repetition-lite (Leitner boxes) and gradual unlocking. Pure logic, no DOM/storage.

export type Box = 1 | 2 | 3 | 4;

export interface SpeciesProgress {
  box: Box;
  seen: number;
  correct: number;
  lastSeen: string | null;
}

export interface Progress {
  version: 1;
  species: Record<string, SpeciesProgress>;
  /** Species currently in the quiz, in unlock order. */
  unlocked: string[];
  stats: { totalAnswered: number; totalCorrect: number };
}

export const MAX_BOX = 4;
/** Sampling weight per box: struggling birds come up 8x as often as learned ones. */
export const BOX_WEIGHTS: Record<Box, number> = { 1: 8, 2: 4, 3: 2, 4: 1 };
/** How many species a fresh learner starts with. */
export const INITIAL_ACTIVE = 6;
/** A species counts as "solid" from this box upwards. */
export const SOLID_BOX: Box = 3;
/** Unlock the next species once at most this many active species are below SOLID_BOX. */
export const MAX_WEAK_TO_UNLOCK = 2;

export function emptyProgress(): Progress {
  return { version: 1, species: {}, unlocked: [], stats: { totalAnswered: 0, totalCorrect: 0 } };
}

export function speciesProgress(p: Progress, id: string): SpeciesProgress {
  return p.species[id] ?? { box: 1, seen: 0, correct: 0, lastSeen: null };
}

export const weightOf = (p: Progress, id: string) => BOX_WEIGHTS[speciesProgress(p, id).box];
export const isLearned = (p: Progress, id: string) => speciesProgress(p, id).box === MAX_BOX;
export const isNew = (p: Progress, id: string) => speciesProgress(p, id).seen === 0;
/** Answered at least once and currently back in box 1. */
export const isStruggling = (p: Progress, id: string) => {
  const s = speciesProgress(p, id);
  return s.seen > 0 && s.box === 1;
};

/**
 * Species ids in the quiz right now. `allIds` is the unlock order (birds.json order).
 * Ensures the initial set exists and drops ids no longer in the data. Mutates `p.unlocked`.
 */
export function activeIds(p: Progress, allIds: string[]): string[] {
  const known = new Set(allIds);
  p.unlocked = p.unlocked.filter((id) => known.has(id));
  for (const id of allIds) {
    if (p.unlocked.length >= INITIAL_ACTIVE) break;
    if (!p.unlocked.includes(id)) p.unlocked.push(id);
  }
  return [...p.unlocked];
}

export const lockedIds = (p: Progress, allIds: string[]) => {
  const active = new Set(activeIds(p, allIds));
  return allIds.filter((id) => !active.has(id));
};

/** Record an answer. Mutates and returns `p`. */
export function recordAnswer(p: Progress, id: string, correct: boolean, now = new Date()): Progress {
  const s = { ...speciesProgress(p, id) };
  s.seen += 1;
  s.lastSeen = now.toISOString();
  if (correct) {
    s.correct += 1;
    s.box = Math.min(MAX_BOX, s.box + 1) as Box;
  } else {
    s.box = 1;
  }
  p.species[id] = s;
  p.stats.totalAnswered += 1;
  if (correct) p.stats.totalCorrect += 1;
  return p;
}

/** Unlock the next species if the active set is mostly solid. Returns the new id, or null. */
export function maybeUnlock(p: Progress, allIds: string[]): string | null {
  const active = activeIds(p, allIds);
  const weak = active.filter((id) => speciesProgress(p, id).box < SOLID_BOX).length;
  if (weak > MAX_WEAK_TO_UNLOCK) return null;
  const next = allIds.find((id) => !active.includes(id));
  if (!next) return null;
  p.unlocked.push(next);
  return next;
}

/** Defensive parse of stored/imported data; throws on anything that isn't progress at all. */
export function normalizeProgress(raw: unknown): Progress {
  if (!raw || typeof raw !== 'object') throw new Error('not an object');
  const r = raw as Partial<Progress>;
  if (r.version !== 1) throw new Error(`unsupported version: ${String(r.version)}`);
  const p = emptyProgress();
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  for (const [id, s] of Object.entries(r.species ?? {})) {
    if (!s || typeof s !== 'object') continue;
    const box = Math.min(MAX_BOX, Math.max(1, num((s as SpeciesProgress).box) || 1)) as Box;
    const seen = num((s as SpeciesProgress).seen);
    p.species[id] = {
      box,
      seen,
      correct: Math.min(seen, num((s as SpeciesProgress).correct)),
      lastSeen: typeof (s as SpeciesProgress).lastSeen === 'string' ? (s as SpeciesProgress).lastSeen : null,
    };
  }
  p.unlocked = Array.isArray(r.unlocked) ? [...new Set(r.unlocked.filter((x) => typeof x === 'string'))] : [];
  p.stats.totalAnswered = num(r.stats?.totalAnswered);
  p.stats.totalCorrect = Math.min(p.stats.totalAnswered, num(r.stats?.totalCorrect));
  return p;
}

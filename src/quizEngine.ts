// Pure question-selection logic (no DOM) so it can be unit-tested.
import type { Recording, Species } from './types';

export type Rng = () => number;

export interface Question {
  species: Species;
  recording: Recording;
  /** Answer options in display order; always includes `species`. */
  choices: Species[];
}

export interface Answer {
  question: Question;
  picked: Species;
  correct: boolean;
}

export interface PickerOptions {
  /** Every species (used to fill distractors when the active set is small). */
  pool: Species[];
  /** Species that may be asked right now; re-read on every question. Defaults to the whole pool. */
  active?: () => string[];
  /** Relative sampling weight per species id; re-read on every question. Defaults to 1. */
  weight?: (id: string) => number;
  choiceCount?: number;
  rng?: Rng;
}

export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pick = <T>(items: readonly T[], rng: Rng): T => items[Math.floor(rng() * items.length)];

export function weightedPick<T>(items: readonly T[], weight: (item: T) => number, rng: Rng): T {
  const weights = items.map((i) => Math.max(0, weight(i)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return pick(items, rng);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

export class QuestionPicker {
  private lastSpeciesId: string | null = null;
  /** Recording ids already used per species in this session, to rotate through clips. */
  private usedClips = new Map<string, Set<string>>();
  private readonly pool: Species[];
  private readonly active: () => string[];
  private readonly weight: (id: string) => number;
  private readonly choiceCount: number;
  private readonly rng: Rng;

  constructor(opts: PickerOptions) {
    this.pool = opts.pool;
    this.active = opts.active ?? (() => this.pool.map((s) => s.id));
    this.weight = opts.weight ?? (() => 1);
    this.choiceCount = opts.choiceCount ?? 4;
    this.rng = opts.rng ?? Math.random;
    if (!this.pool.some((s) => s.recordings.length)) throw new Error('No species with recordings');
  }

  next(): Question {
    const activeSet = new Set(this.active());
    let playable = this.pool.filter((s) => s.recordings.length && activeSet.has(s.id));
    if (!playable.length) playable = this.pool.filter((s) => s.recordings.length);
    const candidates = playable.length > 1 ? playable.filter((s) => s.id !== this.lastSpeciesId) : playable;
    const species = weightedPick(candidates, (s) => this.weight(s.id), this.rng);
    this.lastSpeciesId = species.id;

    const recording = this.nextRecording(species);
    const want = Math.max(0, this.choiceCount - 1);
    // Distractors come from birds the learner already knows; top up from the rest if needed.
    const others = this.pool.filter((s) => s.id !== species.id);
    const known = shuffle(others.filter((s) => activeSet.has(s.id)), this.rng);
    const rest = shuffle(others.filter((s) => !activeSet.has(s.id)), this.rng);
    const distractors = [...known, ...rest].slice(0, want);
    const choices = shuffle([species, ...distractors], this.rng);
    return { species, recording, choices };
  }

  private nextRecording(species: Species): Recording {
    let used = this.usedClips.get(species.id);
    if (!used || used.size >= species.recordings.length) {
      used = new Set();
      this.usedClips.set(species.id, used);
    }
    const fresh = species.recordings.filter((r) => !used!.has(r.id));
    const rec = pick(fresh, this.rng);
    used.add(rec.id);
    return rec;
  }
}

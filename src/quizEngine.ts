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

export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pick = <T>(items: readonly T[], rng: Rng): T => items[Math.floor(rng() * items.length)];

export class QuestionPicker {
  private lastSpeciesId: string | null = null;
  /** Recording ids already used per species in this session, to rotate through clips. */
  private usedClips = new Map<string, Set<string>>();

  constructor(
    private readonly pool: Species[],
    private readonly choiceCount = 4,
    private readonly rng: Rng = Math.random,
  ) {
    if (!pool.some((s) => s.recordings.length)) throw new Error('No species with recordings');
  }

  next(): Question {
    const playable = this.pool.filter((s) => s.recordings.length);
    const candidates = playable.length > 1 ? playable.filter((s) => s.id !== this.lastSpeciesId) : playable;
    const species = pick(candidates, this.rng);
    this.lastSpeciesId = species.id;

    const recording = this.nextRecording(species);
    const distractors = shuffle(
      this.pool.filter((s) => s.id !== species.id),
      this.rng,
    ).slice(0, Math.max(0, this.choiceCount - 1));
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

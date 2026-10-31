import { describe, expect, test } from 'bun:test';
import { QuestionPicker, shuffle } from './quizEngine';
import type { Species } from './types';

const sp = (id: string, clips = 2): Species => ({
  id, namePl: id, nameEn: id, nameLatin: id, family: 'F', habitat: [], similarTo: [], note: '', image: null,
  recordings: Array.from({ length: clips }, (_, i) => ({
    id: `${id}-r${i}`, src: '', type: 'song', durationSec: 12, recordist: '', license: '', sourceUrl: '',
  })),
});

// Deterministic PRNG (mulberry32)
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pool = ['a', 'b', 'c', 'd', 'e'].map((id) => sp(id));

describe('QuestionPicker', () => {
  test('choices: 4 unique, include the answer', () => {
    const p = new QuestionPicker(pool, 4, rng(1));
    for (let i = 0; i < 200; i++) {
      const q = p.next();
      expect(q.choices).toHaveLength(4);
      expect(new Set(q.choices.map((c) => c.id)).size).toBe(4);
      expect(q.choices).toContain(q.species);
      expect(q.species.recordings).toContain(q.recording);
    }
  });

  test('never the same species twice in a row', () => {
    const p = new QuestionPicker(pool, 4, rng(2));
    let prev = '';
    for (let i = 0; i < 500; i++) {
      const id = p.next().species.id;
      expect(id).not.toBe(prev);
      prev = id;
    }
  });

  test('rotates through all recordings of a species before repeating', () => {
    const p = new QuestionPicker([sp('a', 3), sp('b', 1)], 2, rng(3));
    const seen: string[] = [];
    while (seen.length < 3) {
      const q = p.next();
      if (q.species.id === 'a') seen.push(q.recording.id);
    }
    expect(new Set(seen).size).toBe(3);
  });

  test('every species gets asked', () => {
    const p = new QuestionPicker(pool, 4, rng(4));
    const ids = new Set(Array.from({ length: 100 }, () => p.next().species.id));
    expect(ids.size).toBe(5);
  });

  test('small pools: fewer choices than requested', () => {
    const p = new QuestionPicker([sp('a'), sp('b')], 4, rng(5));
    expect(p.next().choices).toHaveLength(2);
  });

  test('skips species without recordings as answers', () => {
    const p = new QuestionPicker([sp('a'), sp('b', 0), sp('c')], 3, rng(6));
    for (let i = 0; i < 50; i++) expect(p.next().species.id).not.toBe('b');
  });
});

test('shuffle keeps all items', () => {
  expect(shuffle([1, 2, 3, 4, 5], rng(7)).sort()).toEqual([1, 2, 3, 4, 5]);
});

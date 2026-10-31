import { describe, expect, test } from 'bun:test';
import { pickDistractors, QuestionPicker, shuffle, weightedPick } from './quizEngine';
import type { Species } from './types';

const sp = (id: string, clips = 2, extra: Partial<Species> = {}): Species => ({
  id, namePl: id, nameEn: id, nameLatin: id, family: 'F', habitat: [], similarTo: [], note: '', image: null, ...extra,
  recordings: Array.from({ length: clips }, (_, i) => ({
    id: `${id}-r${i}`, src: '', type: 'song', durationSec: 12, recordist: '', license: '', sourceUrl: '',
  })),
  ...extra,
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
    const p = new QuestionPicker({ pool, rng: rng(1) });
    for (let i = 0; i < 200; i++) {
      const q = p.next();
      expect(q.choices).toHaveLength(4);
      expect(new Set(q.choices.map((c) => c.id)).size).toBe(4);
      expect(q.choices).toContain(q.species);
      expect(q.species.recordings).toContain(q.recording);
    }
  });

  test('never the same species twice in a row', () => {
    const p = new QuestionPicker({ pool, rng: rng(2) });
    let prev = '';
    for (let i = 0; i < 500; i++) {
      const id = p.next().species.id;
      expect(id).not.toBe(prev);
      prev = id;
    }
  });

  test('rotates through all recordings of a species before repeating', () => {
    const p = new QuestionPicker({ pool: [sp('a', 3), sp('b', 1)], choiceCount: 2, rng: rng(3) });
    const seen: string[] = [];
    while (seen.length < 3) {
      const q = p.next();
      if (q.species.id === 'a') seen.push(q.recording.id);
    }
    expect(new Set(seen).size).toBe(3);
  });

  test('every species gets asked', () => {
    const p = new QuestionPicker({ pool, rng: rng(4) });
    const ids = new Set(Array.from({ length: 100 }, () => p.next().species.id));
    expect(ids.size).toBe(5);
  });

  test('small pools: fewer choices than requested', () => {
    const p = new QuestionPicker({ pool: [sp('a'), sp('b')], rng: rng(5) });
    expect(p.next().choices).toHaveLength(2);
  });

  test('skips species without recordings as answers', () => {
    const p = new QuestionPicker({ pool: [sp('a'), sp('b', 0), sp('c')], choiceCount: 3, rng: rng(6) });
    for (let i = 0; i < 50; i++) expect(p.next().species.id).not.toBe('b');
  });
});

describe('weighting and active set', () => {
  test('only active species are asked', () => {
    const p = new QuestionPicker({ pool, active: () => ['a', 'b', 'c'], rng: rng(8) });
    for (let i = 0; i < 200; i++) expect(['a', 'b', 'c']).toContain(p.next().species.id);
  });

  test('distractors prefer active species, topped up from the rest', () => {
    const p = new QuestionPicker({ pool, active: () => ['a', 'b'], rng: rng(9) });
    for (let i = 0; i < 100; i++) {
      const q = p.next();
      expect(q.choices).toHaveLength(4);
      const otherActive = ['a', 'b'].find((x) => x !== q.species.id)!;
      expect(q.choices.map((c) => c.id)).toContain(otherActive);
    }
  });

  test('active set changes are picked up on the next question', () => {
    let active = ['a', 'b'];
    const p = new QuestionPicker({ pool, active: () => active, rng: rng(10) });
    p.next();
    active = ['d', 'e'];
    for (let i = 0; i < 50; i++) expect(['d', 'e']).toContain(p.next().species.id);
  });

  test('heavier species are asked more often (8:1)', () => {
    const counts: Record<string, number> = {};
    const r = rng(11);
    for (let i = 0; i < 20000; i++) {
      const x = weightedPick(['heavy', 'light'], (id) => (id === 'heavy' ? 8 : 1), r);
      counts[x] = (counts[x] ?? 0) + 1;
    }
    const ratio = counts.heavy / counts.light;
    expect(ratio).toBeGreaterThan(7);
    expect(ratio).toBeLessThan(9);
  });

  test('zero total weight falls back to uniform', () => {
    expect(['x', 'y']).toContain(weightedPick(['x', 'y'], () => 0, rng(12)));
  });
});

test('shuffle keeps all items', () => {
  expect(shuffle([1, 2, 3, 4, 5], rng(7)).sort()).toEqual([1, 2, 3, 4, 5]);
});

describe('hard mode distractors', () => {
  const crow = sp('crow', 2, { family: 'Corvidae', habitat: ['city'], similarTo: ['rook'] });
  const hard = [
    crow,
    sp('rook', 2, { family: 'Corvidae', habitat: ['city'] }),
    sp('jackdaw', 2, { family: 'Corvidae', habitat: ['city'], similarTo: ['crow'] }), // reverse link
    sp('magpie', 2, { family: 'Corvidae', habitat: ['park'] }),
    sp('raven', 2, { family: 'Corvidae', habitat: ['forest'] }),
    sp('sparrow', 2, { family: 'Passeridae', habitat: ['city'] }),
    sp('robin', 2, { family: 'Muscicapidae', habitat: ['forest'] }),
    sp('duck', 2, { family: 'Anatidae', habitat: ['wetland'] }),
  ];
  const all = new Set(hard.map((s) => s.id));

  test('look-alikes (both directions) come first, then family', () => {
    for (let seed = 1; seed < 30; seed++) {
      const d = pickDistractors(crow, hard, all, 'hard', 3, rng(seed)).map((s) => s.id);
      expect(d.slice(0, 2).sort()).toEqual(['jackdaw', 'rook']);
      expect(['magpie', 'raven']).toContain(d[2]);
    }
  });

  test('then same habitat, then anything', () => {
    const d = pickDistractors(crow, hard, all, 'hard', 7, rng(3)).map((s) => s.id);
    expect(d[4]).toBe('sparrow'); // after 4 corvids: the only non-corvid sharing 'city'
    expect(d.slice(5).sort()).toEqual(['duck', 'robin']);
    expect(new Set(d).size).toBe(7);
  });

  test('within a tier, known birds come before locked ones', () => {
    const active = new Set(['crow', 'raven']);
    for (let seed = 1; seed < 20; seed++) {
      const d = pickDistractors(crow, hard, active, 'hard', 3, rng(seed)).map((s) => s.id);
      expect(d[2]).toBe('raven'); // family tier: raven (known) before magpie (locked)
    }
  });

  test('easy mode ignores similarity', () => {
    const active = new Set(['crow', 'duck', 'robin', 'sparrow']);
    const d = pickDistractors(crow, hard, active, 'easy', 3, rng(4)).map((s) => s.id);
    expect(d.sort()).toEqual(['duck', 'robin', 'sparrow']);
  });

  test('picker uses the difficulty getter on every question', () => {
    let mode: 'easy' | 'hard' = 'hard';
    const p = new QuestionPicker({ pool: hard, active: () => ['crow', 'robin', 'duck', 'sparrow'], difficulty: () => mode, rng: rng(5) });
    for (let i = 0; i < 50; i++) {
      const q = p.next();
      if (q.species.id === 'crow') expect(q.choices.map((c) => c.id)).toContain('rook');
    }
    mode = 'easy';
    for (let i = 0; i < 50; i++) {
      const q = p.next();
      if (q.species.id === 'crow') expect(q.choices.map((c) => c.id).sort()).toEqual(['crow', 'duck', 'robin', 'sparrow']);
    }
  });
});

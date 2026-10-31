import { describe, expect, test } from 'bun:test';
import {
  activeIds, emptyProgress, INITIAL_ACTIVE, isLearned, isStruggling, lockedIds, maybeUnlock,
  normalizeProgress, recordAnswer, speciesProgress, weightOf,
} from './progress';

const ids = Array.from({ length: 10 }, (_, i) => `s${i}`);

describe('Leitner boxes', () => {
  test('new species start in box 1 with top weight', () => {
    const p = emptyProgress();
    expect(speciesProgress(p, 's0').box).toBe(1);
    expect(weightOf(p, 's0')).toBe(8);
  });

  test('correct moves up (max 4), wrong goes back to 1', () => {
    const p = emptyProgress();
    for (let i = 0; i < 6; i++) recordAnswer(p, 's0', true);
    expect(speciesProgress(p, 's0').box).toBe(4);
    expect(isLearned(p, 's0')).toBe(true);
    expect(weightOf(p, 's0')).toBe(1);
    recordAnswer(p, 's0', false);
    expect(speciesProgress(p, 's0')).toMatchObject({ box: 1, seen: 7, correct: 6 });
    expect(isStruggling(p, 's0')).toBe(true);
    expect(p.stats).toEqual({ totalAnswered: 7, totalCorrect: 6 });
  });

  test('unseen species are not "struggling"', () => {
    expect(isStruggling(emptyProgress(), 's0')).toBe(false);
  });
});

describe('gradual unlocking', () => {
  test('starts with the first INITIAL_ACTIVE species in data order', () => {
    const p = emptyProgress();
    expect(activeIds(p, ids)).toEqual(ids.slice(0, INITIAL_ACTIVE));
    expect(lockedIds(p, ids)).toEqual(ids.slice(INITIAL_ACTIVE));
  });

  test('no unlock while most active birds are weak', () => {
    const p = emptyProgress();
    activeIds(p, ids);
    expect(maybeUnlock(p, ids)).toBeNull();
    // 3 of 6 solid -> 3 weak, still too many
    for (const id of ['s0', 's1', 's2']) { recordAnswer(p, id, true); recordAnswer(p, id, true); }
    expect(maybeUnlock(p, ids)).toBeNull();
  });

  test('unlocks the next species once at most 2 are weak', () => {
    const p = emptyProgress();
    activeIds(p, ids);
    for (const id of ['s0', 's1', 's2', 's3']) { recordAnswer(p, id, true); recordAnswer(p, id, true); }
    expect(maybeUnlock(p, ids)).toBe('s6');
    // s6 is new (weak) -> now 3 weak, so no further unlock yet
    expect(maybeUnlock(p, ids)).toBeNull();
    expect(activeIds(p, ids)).toContain('s6');
  });

  test('nothing to unlock when all are active', () => {
    const p = emptyProgress();
    const few = ['a', 'b', 'c'];
    activeIds(p, few);
    for (const id of few) for (let i = 0; i < 4; i++) recordAnswer(p, id, true);
    expect(maybeUnlock(p, few)).toBeNull();
  });

  test('species removed from the data drop out; set is refilled', () => {
    const p = emptyProgress();
    p.unlocked = ['gone', 's0'];
    expect(activeIds(p, ids)).toEqual(['s0', 's1', 's2', 's3', 's4', 's5']);
  });
});

describe('normalizeProgress', () => {
  test('round-trips valid progress', () => {
    const p = emptyProgress();
    activeIds(p, ids);
    recordAnswer(p, 's1', true, new Date('2026-10-31T10:00:00Z'));
    expect(normalizeProgress(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  test('clamps garbage values', () => {
    const p = normalizeProgress({
      version: 1,
      species: { a: { box: 9, seen: -3, correct: 5, lastSeen: 42 }, b: null },
      unlocked: ['a', 'a', 7],
      stats: { totalAnswered: 2, totalCorrect: 10 },
    });
    expect(p.species.a).toEqual({ box: 4, seen: 0, correct: 0, lastSeen: null });
    expect(p.species.b).toBeUndefined();
    expect(p.unlocked).toEqual(['a']);
    expect(p.stats).toEqual({ totalAnswered: 2, totalCorrect: 2 });
  });

  test('rejects non-progress data', () => {
    expect(() => normalizeProgress(null)).toThrow();
    expect(() => normalizeProgress({ version: 2 })).toThrow();
    expect(() => normalizeProgress([1, 2])).toThrow();
  });
});

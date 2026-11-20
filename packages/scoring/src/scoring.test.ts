import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSkillScore, overall, round1, responsePercent, componentFromSlots, mcqPercent, compareCards, ratingPercent, type CardForComparison } from './index.ts';

test('skill score matches the worked example (81.0)', () => {
  assert.equal(round1(calculateSkillScore({ mcq: 80, viva: 70, mutation: 90 })!), 81);
});
test('missing component is never zero and never renormalised', () => {
  assert.equal(calculateSkillScore({ mcq: 80, viva: null, mutation: 90 }), null);
  assert.equal(calculateSkillScore({ mcq: 80, viva: 70, mutation: null }), null);
});
test('overall is an equal average only when every skill is complete', () => {
  assert.equal(round1(overall([81, 75, 72])!), 76);
  assert.equal(overall([81, null, 72]), null);
  assert.equal(overall([]), null);
});
test('ratings convert 0..4 to percent and reject out-of-range', () => {
  assert.equal(ratingPercent(3), 75);
  assert.throws(() => ratingPercent(5));
});
test('criterion weights (40/30/20/10) average correctly', () => {
  const p = responsePercent([{ rating: 4, weight: 40 }, { rating: 2, weight: 30 }, { rating: 4, weight: 20 }, { rating: 0, weight: 10 }]);
  assert.equal(p, (100 * 40 + 50 * 30 + 100 * 20 + 0) / 100);
});
test('topic slots: follow-ups in one slot do not add weight', () => {
  assert.equal(componentFromSlots([[100, 0], [50]]), 50);
  assert.equal(componentFromSlots([[100], []]), null);
});
test('mcq percent', () => { assert.equal(mcqPercent(8, 10), 80); assert.equal(mcqPercent(0, 0), null); });

const card = (label: string, skills: CardForComparison['skills'], over: Partial<CardForComparison> = {}): CardForComparison =>
  ({ label, policyVersion: 'p1', rubricVersion: 'r1', scorerVersion: 's1', skills, ...over });

test('comparison: shared React only, A wins 81.0 vs 77.5 from stronger mutation', () => {
  const a = card('A', [{ skill: 'React', complete: true, mcq: 80, viva: 70, mutation: 90 }, { skill: 'JavaScript', complete: true, mcq: 70, viva: 70, mutation: 70 }]);
  const b = card('B', [{ skill: 'React', complete: true, mcq: 90, viva: 80, mutation: 70 }, { skill: 'SQL', complete: true, mcq: 70, viva: 70, mutation: 70 }]);
  const r = compareCards(a, b);
  assert.equal(r.status, 'COMPARABLE');
  assert.deepEqual(r.common, ['React']);
  assert.equal(r.winner, 'A');
  assert.equal(round1(r.averageA!), 81);
  assert.equal(round1(r.averageB!), 77.5);
  assert.deepEqual(r.unmatchedA, ['JavaScript']);
  assert.deepEqual(r.unmatchedB, ['SQL']);
});
test('comparison: incomplete common skill withholds a winner', () => {
  const a = card('A', [{ skill: 'React', complete: true, mcq: 80, viva: 70, mutation: 90 }]);
  const b = card('B', [{ skill: 'React', complete: false, mcq: 90, viva: null, mutation: null }]);
  const r = compareCards(a, b);
  assert.equal(r.status, 'WITHHELD');
  assert.equal(r.winner, null);
});
test('comparison: policy mismatch withholds, no common skill is not comparable, tie is a tie', () => {
  const s = [{ skill: 'React', complete: true, mcq: 80, viva: 70, mutation: 90 }];
  assert.equal(compareCards(card('A', s), card('B', s, { rubricVersion: 'r2' })).status, 'WITHHELD');
  assert.equal(compareCards(card('A', s), card('B', [{ ...s[0], skill: 'SQL' }])).status, 'NOT_COMPARABLE');
  assert.equal(compareCards(card('A', s), card('B', s)).winner, 'TIE');
});

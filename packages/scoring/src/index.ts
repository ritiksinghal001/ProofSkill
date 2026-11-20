// Pure, deterministic scoring. Identical saved validated inputs always give identical results.
import type { ComparisonResult, Parts } from '@proof/contracts';

export const SCORER_VERSION = 'scorer-1.0.0';
export const WEIGHTS = { mcq: 0.2, viva: 0.35, mutation: 0.45 } as const;

export const round1 = (n: number) => Math.round(n * 10) / 10;

/** 0-4 rubric rating to percent. */
export function ratingPercent(rating: number): number {
  if (!Number.isFinite(rating) || rating < 0 || rating > 4) throw new RangeError(`rating ${rating} outside 0..4`);
  return (rating / 4) * 100;
}

/** Weighted average of criterion percentages. Weights are fixed in the published rubric, then normalised. */
export function responsePercent(criteria: { rating: number; weight: number }[]): number {
  const total = criteria.reduce((s, c) => s + c.weight, 0);
  if (criteria.length === 0 || total <= 0) throw new RangeError('rubric has no weight');
  return criteria.reduce((s, c) => s + ratingPercent(c.rating) * c.weight, 0) / total;
}

/** Equal weight per topic slot; several questions in one slot are averaged so follow-ups add no weight. */
export function componentFromSlots(slots: number[][]): number | null {
  if (slots.length === 0 || slots.some((s) => s.length === 0)) return null;
  const slotMeans = slots.map((s) => s.reduce((a, b) => a + b, 0) / s.length);
  return slotMeans.reduce((a, b) => a + b, 0) / slotMeans.length;
}

export function mcqPercent(correct: number, assigned: number): number | null {
  return assigned > 0 ? (correct / assigned) * 100 : null;
}

/** Returns null unless all three components are present. Missing is never treated as zero and weights are never renormalised. */
export function calculateSkillScore(c: { mcq: number | null; viva: number | null; mutation: number | null }): number | null {
  if (c.mcq == null || c.viva == null || c.mutation == null) return null;
  return WEIGHTS.mcq * c.mcq + WEIGHTS.viva * c.viva + WEIGHTS.mutation * c.mutation;
}

/** Equal average, only when every assessed skill is complete. */
export function overall(scores: (number | null)[]): number | null {
  if (scores.length === 0 || scores.some((s) => s == null)) return null;
  return (scores as number[]).reduce((a, b) => a + b, 0) / scores.length;
}

export function formulaText(c: { mcq: number; viva: number; mutation: number }): string {
  const f = calculateSkillScore(c)!;
  const p = (w: number, v: number) => round1(w * v).toFixed(1);
  return `0.20×${round1(c.mcq)} + 0.35×${round1(c.viva)} + 0.45×${round1(c.mutation)} = ${p(0.2, c.mcq)} + ${p(0.35, c.viva)} + ${p(0.45, c.mutation)} = ${round1(f).toFixed(1)}`;
}

// ---- comparison ----
export interface CardSkill { skill: string; complete: boolean; mcq: number | null; viva: number | null; mutation: number | null }
export interface CardForComparison { label: string; policyVersion: string; rubricVersion: string; scorerVersion: string; skills: CardSkill[] }

export function compareCards(a: CardForComparison, b: CardForComparison): ComparisonResult {
  const names = (c: CardForComparison) => c.skills.map((s) => s.skill);
  const common = names(a).filter((n) => names(b).includes(n)).sort();
  const base = {
    common,
    unmatchedA: names(a).filter((n) => !common.includes(n)),
    unmatchedB: names(b).filter((n) => !common.includes(n)),
    perSkill: [] as ComparisonResult['perSkill'], averageA: null, averageB: null, winner: null,
    reasons: [] as string[],
    limitations: ['Not a hiring recommendation. A small gap does not show a real difference in ability.'],
  };
  if (common.length === 0) {
    return { ...base, status: 'NOT_COMPARABLE', headline: 'Not comparable: no common assessed skill', reasons: ['The two cards share no assessed skill.'] };
  }
  const get = (c: CardForComparison, n: string) => c.skills.find((s) => s.skill === n)!;
  const incomplete = common.filter((n) => !get(a, n).complete || !get(b, n).complete);
  const mismatch: string[] = [];
  if (a.policyVersion !== b.policyVersion) mismatch.push('scoring policy versions differ');
  if (a.rubricVersion !== b.rubricVersion) mismatch.push('rubric versions differ');
  if (a.scorerVersion !== b.scorerVersion) mismatch.push('scorer versions differ');
  if (incomplete.length || mismatch.length) {
    const reasons = [
      ...(incomplete.length ? [`Incomplete on a common skill: ${incomplete.join(', ')}.`] : []),
      ...(mismatch.length ? [`Not compatible: ${mismatch.join('; ')}.`] : []),
    ];
    return { ...base, status: 'WITHHELD', headline: 'Insufficient comparable results', reasons: [...reasons, 'No winner is shown until this is resolved.'] };
  }
  const perSkill = common.map((n) => {
    const x = get(a, n), y = get(b, n);
    const pa: Parts = { mcq: x.mcq!, viva: x.viva!, mutation: x.mutation!, final: calculateSkillScore(x as never)! };
    const pb: Parts = { mcq: y.mcq!, viva: y.viva!, mutation: y.mutation!, final: calculateSkillScore(y as never)! };
    return { skill: n, a: pa, b: pb, diff: pa.final - pb.final };
  });
  const avgA = perSkill.reduce((s, p) => s + p.a.final, 0) / perSkill.length;
  const avgB = perSkill.reduce((s, p) => s + p.b.final, 0) / perSkill.length;
  const winner = round1(avgA) === round1(avgB) ? 'TIE' : avgA > avgB ? 'A' : 'B';
  const reasons: string[] = [];
  for (const p of perSkill) {
    const comp = (['mcq', 'viva', 'mutation'] as const).map((k) => ({ k, d: p.a[k] - p.b[k], w: WEIGHTS[k] }));
    const lead = [...comp].sort((m, n) => Math.abs(n.d * n.w) - Math.abs(m.d * m.w))[0];
    if (round1(p.diff) === 0) reasons.push(`${p.skill}: effectively tied at one decimal.`);
    else reasons.push(`${p.skill}: ${p.diff > 0 ? 'A' : 'B'} leads by ${round1(Math.abs(p.diff)).toFixed(1)}. The biggest weighted gap is ${lead.k} (${round1(Math.abs(lead.d)).toFixed(0)} points at ${Math.round(lead.w * 100)}% weight).`);
  }
  const skillsText = common.join(', ');
  const headline = winner === 'TIE' ? `Tied on comparable skills (${skillsText})`
    : `${winner === 'A' ? 'Card A' : 'Card B'} has better assessed performance on ${skillsText} in this comparison`;
  return { ...base, perSkill, averageA: avgA, averageB: avgB, winner, status: 'COMPARABLE', headline, reasons };
}

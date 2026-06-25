/*
 * Public analysis entry point. `analyzeHand` turns one immutable HandRecord into
 * the coaching payload the post-hand panel renders: per-decision grades, leak
 * flags, the hero's equity at each decision (for a sparkline), and a one-line
 * headline. Deterministic — equity MC is seeded from the record id.
 */

import { mulberry32, type Rng } from '../engine/rng';
import type { Street } from '../engine/types';
import { gradeHand, verdictLabel, type DecisionGrade } from './decision';
import { detectHandLeaks, type Leak } from './leaks';
import type { HandRecord } from './record';

export type { DecisionGrade, Verdict } from './decision';
export { verdictLabel } from './decision';
export type { Leak, Severity, Strength } from './leaks';
export type { StatPanel, Ratio, Archetype } from './stats';
export { computeStats } from './stats';
export { detectAggregateLeaks, detectStrengths } from './leaks';

export interface EquityPoint {
  readonly street: Street;
  readonly equity: number;
}

export interface HandAnalysis {
  readonly record: HandRecord;
  readonly grades: readonly DecisionGrade[];
  readonly leaks: readonly Leak[];
  readonly tag: 'red' | 'blue' | 'none';
  readonly equityLine: readonly EquityPoint[];
  readonly summary: string;
}

export function analyzeHand(record: HandRecord, rng: Rng = mulberry32(hashSeed(record.id))): HandAnalysis {
  const grades = gradeHand(record, rng);
  const leaks = detectHandLeaks(record, grades);
  const equityLine = grades.map(g => ({ street: g.snapshot.street, equity: g.hindsightEquity }));
  return {
    record,
    grades,
    leaks,
    tag: record.outcome.line,
    equityLine,
    summary: summarize(record, grades, leaks),
  };
}

function summarize(record: HandRecord, grades: readonly DecisionGrade[], leaks: readonly Leak[]): string {
  const severe = leaks.find(l => l.severity === 'severe');
  if (severe) return severe.title;
  const worst = [...grades].sort((a, b) => b.evLossBb - a.evLossBb)[0];
  if (worst && worst.evLossBb >= 0.5) {
    const cost = Math.round(worst.evLossBb * record.config.bigBlind);
    return `Your biggest slip: a ${verdictLabel(worst.verdict).toLowerCase()} that cost you about $${cost}.`;
  }
  const net = record.outcome.heroNet;
  if (net > 0) return `Nice — you won $${net}${record.outcome.line === 'red' ? ' because everyone folded.' : '.'}`;
  if (net < 0) return `You lost $${Math.abs(net)}, but no clear mistakes — that's poker.`;
  return 'Nothing notable this hand.';
}

/** Cheap deterministic string hash → seed, so analysis is reproducible. */
function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

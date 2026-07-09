/*
 * Public analysis entry point. `analyzeHand` turns one immutable HandRecord into
 * the coaching payload the post-hand panel renders: per-decision grades, leak
 * flags, the hero's hand strength at each decision (for a sparkline), and a
 * one-line headline. Fully deterministic — everything is judged from the info
 * the player had, so there's no randomness (no opponent-card equity) involved.
 */

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
  /** 0-1 strength of the hero's hand at this decision (their view, not equity vs cards). */
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

export function analyzeHand(record: HandRecord): HandAnalysis {
  const grades = gradeHand(record);
  const leaks = detectHandLeaks(record, grades);
  const equityLine = grades.map(g => ({ street: g.snapshot.street, equity: g.handStrength }));
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

/*
 * Leak detectors — the part that names *why* a hand went wrong, beyond win/loss.
 * Per-hand detectors run on one record + its decision grades; aggregate
 * detectors run on lifetime stats. Each leak is a coachable sentence the panel
 * and dashboard surface verbatim.
 *
 * The headline detectors map directly to the user's asks:
 *   stayedTooLong   → "you went too far with no business being there"
 *   bluffWinNotMerit→ "you won only because they folded, not on merit"
 *   falseSecurity   → "false sense of security — overcommitted one pair"
 *   chasedDraw      → "you chased a draw without the odds"
 */

import { evaluate } from '../engine/evaluator';
import { outsToEquity, requiredEquity } from '../engine/odds';
import { drawOuts } from './draws';
import type { DecisionGrade } from './decision';
import type { DecisionSnapshot } from './recorder';
import type { HandRecord } from './record';
import type { StatPanel } from './stats';

export type Severity = 'info' | 'warn' | 'severe';

export interface Leak {
  readonly code: string;
  readonly severity: Severity;
  readonly title: string;
  readonly explanation: string;
}

export function detectHandLeaks(record: HandRecord, grades: readonly DecisionGrade[]): Leak[] {
  const leaks: Leak[] = [];
  const flagged = new Set<DecisionSnapshot>();

  for (const g of grades) {
    const chase = chasedDraw(record, g);
    if (chase) {
      leaks.push(chase);
      flagged.add(g.snapshot);
    }
  }
  for (const g of grades) {
    if (flagged.has(g.snapshot)) continue;
    const stayed = stayedTooLong(g);
    if (stayed) leaks.push(stayed);
  }
  for (const g of grades) {
    const fs = falseSecurity(record, g);
    if (fs) leaks.push(fs);
  }

  const bluff = bluffWinNotMerit(record, grades);
  if (bluff) leaks.push(bluff);

  return leaks;
}

export function detectAggregateLeaks(records: readonly HandRecord[], stats: StatPanel): Leak[] {
  const leaks: Leak[] = [];
  if (stats.archetype === 'calling-station') {
    leaks.push({
      code: 'calling-station', severity: 'severe', title: 'Calling station tendencies',
      explanation: `You reach showdown ${pctOf(stats.wtsd.pct)} of the time but only win ${pctOf(stats.wssd.pct)} there — you're paying off too often with hands that can't win. Fold more rivers.`,
    });
  }
  if (stats.archetype === 'loose-passive') {
    leaks.push({
      code: 'loose-passive', severity: 'warn', title: 'Loose-passive',
      explanation: `You play ${pctOf(stats.vpip.pct)} of hands but raise only ${pctOf(stats.pfr.pct)} — too much calling, not enough initiative. Tighten up and bet your strong hands.`,
    });
  }
  if (stats.archetype === 'nit') {
    leaks.push({
      code: 'nit', severity: 'info', title: 'Very tight',
      explanation: `At ${pctOf(stats.vpip.pct)} VPIP you're folding a lot of profitable spots and getting no action when you do play. Open up, especially in late position.`,
    });
  }
  if (stats.archetype === 'maniac') {
    leaks.push({
      code: 'maniac', severity: 'warn', title: 'Over-aggression',
      explanation: `Very high aggression and looseness — you're spewing chips with too many bluffs. Pick better spots.`,
    });
  }
  if (stats.hands >= 50 && stats.redLineBb < -50 && (stats.af === undefined || stats.af < 1.2)) {
    leaks.push({
      code: 'red-line-bleed', severity: 'warn', title: 'Bleeding the non-showdown line',
      explanation: `You're down ${Math.abs(stats.redLineBb)}bb in pots that never reached showdown — too passive, surrendering pots you could take with well-timed aggression.`,
    });
  }
  return leaks;
}

// ── per-hand detectors ──────────────────────────────────────────────────────

function stayedTooLong(g: DecisionGrade): Leak | undefined {
  const s = g.snapshot;
  if (s.action.kind !== 'call') return undefined;
  const gap = g.requiredEquity - g.hindsightEquity;
  if (s.street === 'river' && gap > 0.1 && g.hindsightEquity < 0.4) {
    return {
      code: 'stayed-too-long', severity: 'severe', title: 'Called the river behind',
      explanation: `On the river you called needing ${pct(g.requiredEquity)} but were only ${pct(g.hindsightEquity)} — a pure crying call. This is the "no business being here" spot.`,
    };
  }
  if (s.street === 'turn' && gap > 0.12 && g.hindsightEquity < 0.28) {
    return {
      code: 'stayed-too-long', severity: 'warn', title: 'Floated the turn too light',
      explanation: `You called the turn with only ${pct(g.hindsightEquity)} equity needing ${pct(g.requiredEquity)} — drawing too thin to continue.`,
    };
  }
  return undefined;
}

function chasedDraw(record: HandRecord, g: DecisionGrade): Leak | undefined {
  const s = g.snapshot;
  if (s.action.kind !== 'call') return undefined;
  if (s.street !== 'flop' && s.street !== 'turn') return undefined;
  const hole = record.holeCards[record.config.humanId] ?? [];
  if (hole.length < 2 || s.board.length < 3) return undefined;
  const made = evaluate([...hole, ...s.board]).category;
  if (made !== 'high-card' && made !== 'pair') return undefined; // already have a real hand
  const outs = drawOuts([...hole, ...s.board]);
  if (outs === 0) return undefined;
  const streetsToCome = s.effectiveStack === 0 ? (s.street === 'flop' ? 2 : 1) : 1;
  const drawEquity = outsToEquity(outs, streetsToCome);
  if (drawEquity >= g.requiredEquity - 0.05) return undefined; // odds were fine
  return {
    code: 'chased-draw', severity: 'warn', title: 'Chased a draw without odds',
    explanation: `You called the ${s.street} on a ~${outs}-out draw (≈${pct(drawEquity)} to get there) but the price needed ${pct(g.requiredEquity)}. The pot odds weren't there.`,
  };
}

function falseSecurity(record: HandRecord, g: DecisionGrade): Leak | undefined {
  const s = g.snapshot;
  const committedBig = s.action.kind === 'allin' || s.amountPutIn >= 0.33 * s.effectiveStack;
  if (!committedBig || s.amountPutIn <= 0) return undefined;
  const hole = record.holeCards[record.config.humanId] ?? [];
  if (hole.length < 2 || s.board.length < 3) return undefined;
  if (evaluate([...hole, ...s.board]).category !== 'pair') return undefined; // one pair only
  const risky = s.spr > 3 || s.numActivePlayers >= 3;
  if (!risky) return undefined;
  const allIn = s.action.kind === 'allin' || s.amountPutIn >= s.effectiveStack;
  const reason = s.numActivePlayers >= 3 ? `${s.numActivePlayers}-way` : `at an SPR of ${s.spr.toFixed(1)}`;
  return {
    code: 'false-security', severity: allIn ? 'severe' : 'warn',
    title: 'Overcommitted with one pair',
    explanation: `You put in a big chunk ${reason} holding only one pair — a classic false sense of security. One pair rarely wants to play a big pot, especially multiway or deep.`,
  };
}

function bluffWinNotMerit(record: HandRecord, grades: readonly DecisionGrade[]): Leak | undefined {
  if (record.outcome.line !== 'red') return undefined; // only non-showdown wins
  const aggressive = grades.filter(g => {
    const k = g.snapshot.action.kind;
    return k === 'bet' || k === 'raise' || k === 'allin';
  });
  const last = aggressive[aggressive.length - 1];
  if (!last || last.hindsightEquity >= 0.4) return undefined;
  return {
    code: 'bluff-win-not-merit', severity: 'info', title: 'Won on a fold, not on merit',
    explanation: `You took this pot without showdown while only ${pct(last.hindsightEquity)} to win at the time — the chips came from fold equity, not a better hand. Great if intentional; a warning sign if you thought you were ahead.`,
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function pctOf(fraction: number | undefined): string {
  return fraction === undefined ? '—' : `${Math.round(fraction * 100)}%`;
}

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
      code: 'calling-station', severity: 'severe', title: 'You call too much',
      explanation: `You go to showdown ${pctOf(stats.wtsd.pct)} of the time but only win there ${pctOf(stats.wssd.pct)} — you're paying people off with hands that can't win. Fold more often when someone bets big on the river.`,
    });
  }
  if (stats.archetype === 'loose-passive') {
    leaks.push({
      code: 'loose-passive', severity: 'warn', title: 'Too many hands, not enough betting',
      explanation: `You play ${pctOf(stats.vpip.pct)} of your hands but raise only ${pctOf(stats.pfr.pct)} of them — lots of calling, not enough taking the lead. Play fewer hands, and bet your strong ones instead of just calling.`,
    });
  }
  if (stats.archetype === 'nit') {
    leaks.push({
      code: 'nit', severity: 'info', title: 'You play very few hands',
      explanation: `You only play ${pctOf(stats.vpip.pct)} of hands — you're folding a lot of spots that make money, and you get no action when you finally do play. Loosen up, especially in late position.`,
    });
  }
  if (stats.archetype === 'maniac') {
    leaks.push({
      code: 'maniac', severity: 'warn', title: 'Too wild',
      explanation: `You bet and raise a ton, often with weak hands — that bleeds chips. Pick better spots to apply pressure.`,
    });
  }
  if (stats.hands >= 50 && stats.redLineBb < -50 && (stats.af === undefined || stats.af < 1.2)) {
    leaks.push({
      code: 'red-line-bleed', severity: 'warn', title: 'You give up too many pots',
      explanation: `You're down a lot in pots nobody showed down — you fold too often and don't fight back. A few well-timed bets to take pots others have given up on would help.`,
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
      code: 'stayed-too-long', severity: 'severe', title: 'Called the river when beaten',
      explanation: `On the river you called with only about a ${pct(g.hindsightEquity)} chance to win, but you needed ${pct(g.requiredEquity)} for it to be worth it. This is the classic "I had a bad feeling but called anyway" spot — the one to cut out.`,
    };
  }
  if (s.street === 'turn' && gap > 0.12 && g.hindsightEquity < 0.28) {
    return {
      code: 'stayed-too-long', severity: 'warn', title: 'Chased too far on the turn',
      explanation: `You called the turn with only about a ${pct(g.hindsightEquity)} chance to win (you needed ${pct(g.requiredEquity)}) — too little to keep going.`,
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
    code: 'chased-draw', severity: 'warn', title: 'Chased a draw that wasn’t worth it',
    explanation: `You called the ${s.street} hoping to complete a draw — about ${outs} cards would help you (~${pct(drawEquity)} chance), but the price needed ${pct(g.requiredEquity)}. Not worth the chase.`,
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
  const reason = s.numActivePlayers >= 3 ? `against ${s.numActivePlayers} players` : `with a lot of chips still to lose`;
  return {
    code: 'false-security', severity: allIn ? 'severe' : 'warn',
    title: 'Overplayed one pair',
    explanation: `You committed a big chunk of chips ${reason} holding just one pair. One pair usually isn't strong enough to play a big pot — especially against several players or when stacks are deep. A classic false sense of security.`,
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
    code: 'bluff-win-not-merit', severity: 'info', title: 'You won — but only because they folded',
    explanation: `You took this pot without a showdown while your hand had only about a ${pct(last.hindsightEquity)} chance to win if called. The chips came from them folding, not from having the best hand — great if you meant to bluff, a warning sign if you thought you were ahead.`,
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function pctOf(fraction: number | undefined): string {
  return fraction === undefined ? '—' : `${Math.round(fraction * 100)}%`;
}

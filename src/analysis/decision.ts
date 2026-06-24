/*
 * Per-decision grading. For each of the hero's actions we reconstruct what it
 * faced (price, pot) and compute the hero's equity *against the opponents'
 * actual cards that were still live* — a hindsight, cards-known verdict. This
 * is exactly the lens the user asked for ("did I have any business being
 * there?"), so every note is explicit that it's hindsight, not a claim about
 * what was knowable at the time.
 *
 * Calls and folds get a clean EV-vs-fold grade (fold = 0 EV reference). Bets
 * and raises depend on fold equity, which hindsight can't price, so they get a
 * lighter value/bluff read here and the heavier judgement is left to leaks.ts.
 */

import { equity } from '../engine/equity';
import { evCall, requiredEquity } from '../engine/odds';
import type { Rng } from '../engine/rng';
import type { Card } from '../engine/types';
import type { DecisionSnapshot } from './recorder';
import type { HandRecord } from './record';

export type Verdict = 'correct' | 'marginal' | 'mistake' | 'blunder';

export interface DecisionGrade {
  readonly snapshot: DecisionSnapshot;
  /** Hero equity vs the opponents' actual cards still live at this moment. */
  readonly hindsightEquity: number;
  /** Break-even equity the price demanded (0 when checking). */
  readonly requiredEquity: number;
  /** EV of the chosen action in chips (net vs folding). */
  readonly evChips: number;
  /** Big blinds lost vs the best alternative — drives the verdict. */
  readonly evLossBb: number;
  readonly verdict: Verdict;
  readonly note: string;
}

export function gradeHand(record: HandRecord, rng: Rng): DecisionGrade[] {
  const heroId = record.config.humanId;
  return record.snapshots
    .filter(s => s.actorId === heroId)
    .map(s => gradeDecision(s, record, rng));
}

function gradeDecision(snap: DecisionSnapshot, record: HandRecord, rng: Rng): DecisionGrade {
  const eq = heroEquity(snap, record, rng);
  const toCall = Math.min(snap.betFaced, snap.effectiveStack);
  const reqEq = snap.betFaced > 0 ? requiredEquity(toCall, snap.potBefore) : 0;
  const bb = record.config.bigBlind;
  const kind = snap.action.kind;

  if (kind === 'fold') return gradeFold(snap, eq, reqEq, toCall, bb);
  if (kind === 'check') return gradeCheck(snap, eq, reqEq);
  if (kind === 'call' || (kind === 'allin' && snap.amountPutIn <= snap.betFaced)) {
    return gradeCall(snap, eq, reqEq, bb);
  }
  return gradeAggressive(snap, eq, reqEq);
}

// ── branches ────────────────────────────────────────────────────────────────

function gradeCall(snap: DecisionSnapshot, eq: number, reqEq: number, bb: number): DecisionGrade {
  const toCall = Math.min(snap.betFaced, snap.effectiveStack);
  const ev = evCall(eq, snap.potBefore, toCall);
  const evLossBb = Math.max(0, -ev) / bb;
  const note = ev >= 0
    ? `Profitable call in hindsight — ${pct(eq)} equity vs the ${pct(reqEq)} the price needed.`
    : `Called ${toCall} needing ${pct(reqEq)} but had only ${pct(eq)} (hindsight) — you were behind.`;
  return { snapshot: snap, hindsightEquity: eq, requiredEquity: reqEq, evChips: ev, evLossBb, verdict: verdictFor(evLossBb), note };
}

function gradeFold(snap: DecisionSnapshot, eq: number, reqEq: number, toCall: number, bb: number): DecisionGrade {
  const wouldHaveBeen = evCall(eq, snap.potBefore, toCall);
  const evLossBb = Math.max(0, wouldHaveBeen) / bb;
  const note = wouldHaveBeen > 0
    ? `Folded a call that was +EV in hindsight (${pct(eq)} vs ${pct(reqEq)} needed) — too tight here.`
    : `Sound fold — ${pct(eq)} equity didn't justify the ${pct(reqEq)} price.`;
  return { snapshot: snap, hindsightEquity: eq, requiredEquity: reqEq, evChips: 0, evLossBb, verdict: verdictFor(evLossBb), note };
}

function gradeCheck(snap: DecisionSnapshot, eq: number, reqEq: number): DecisionGrade {
  const note = eq > 0.8 && snap.board.length >= 3
    ? `Checked a very strong hand (${pct(eq)}) — likely missed value.`
    : `Check.`;
  return { snapshot: snap, hindsightEquity: eq, requiredEquity: reqEq, evChips: 0, evLossBb: 0, verdict: 'correct', note };
}

function gradeAggressive(snap: DecisionSnapshot, eq: number, reqEq: number): DecisionGrade {
  // Fold equity isn't priceable from hindsight cards, so we don't assign an
  // EV loss here — we label intent. leaks.ts catches reckless bluffs.
  let note: string;
  let verdict: Verdict = 'correct';
  if (eq >= 0.6) note = `Value bet/raise — ${pct(eq)} ahead in hindsight.`;
  else if (eq < 0.3) {
    note = `Bluff (${pct(eq)} equity) — profit depends entirely on folds.`;
    verdict = 'marginal';
  } else note = `Thin bet/raise — ${pct(eq)} equity, a value-bluff mix.`;
  return { snapshot: snap, hindsightEquity: eq, requiredEquity: reqEq, evChips: 0, evLossBb: 0, verdict, note };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function heroEquity(snap: DecisionSnapshot, record: HandRecord, rng: Rng): number {
  const heroId = record.config.humanId;
  const heroHole = record.holeCards[heroId];
  if (!heroHole || heroHole.length < 2) return 0;
  const opponents = snap.liveOpponentIds
    .map(id => ({ id, hole: record.holeCards[id] ?? [] }))
    .filter(o => o.hole.length === 2) as { id: string; hole: readonly Card[] }[];
  if (opponents.length === 0) return 1; // uncontested
  const result = equity({ players: [{ id: heroId, hole: heroHole }, ...opponents], board: snap.board, rng });
  return result.equities.find(e => e.playerId === heroId)?.equity ?? 0;
}

function verdictFor(evLossBb: number): Verdict {
  if (evLossBb < 0.1) return 'correct';
  if (evLossBb < 0.5) return 'marginal';
  if (evLossBb <= 2) return 'mistake';
  return 'blunder';
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

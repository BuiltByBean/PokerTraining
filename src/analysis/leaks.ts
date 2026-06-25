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

/** Something the player does well — the inverse of a leak. */
export interface Strength {
  readonly code: string;
  readonly title: string;
  readonly explanation: string;
}

const SEVERITY_RANK: Record<Severity, number> = { severe: 0, warn: 1, info: 2 };

/**
 * All the things to work on, each detected independently from the stats (not a
 * single archetype label) so every glaring issue shows up, most serious first.
 * Each check only fires once its stat has cleared its minimum sample.
 */
export function detectAggregateLeaks(records: readonly HandRecord[], stats: StatPanel): Leak[] {
  const out: Leak[] = [];
  const { vpip, pfr, vpipPfrGap, af, wtsd, wssd } = stats;

  if (def(wtsd) && def(wssd) && (wtsd.pct as number) > 0.38 && (wssd.pct as number) < 0.47) {
    out.push({
      code: 'station', severity: 'severe', title: 'You call too much after the flop',
      explanation: `You reach showdown ${pctOf(wtsd.pct)} of the time but win only ${pctOf(wssd.pct)} of those — you're paying people off with hands that can't win. Fold more when you're likely beaten.`,
    });
  }
  if (def(vpip) && (vpip.pct as number) > 0.40) {
    out.push({
      code: 'too-loose', severity: 'warn', title: 'You play too many hands',
      explanation: `You play ${pctOf(vpip.pct)} of your hands. Folding more weak starting hands before the flop will stop you bleeding chips in tough spots.`,
    });
  }
  if (vpipPfrGap !== undefined && vpipPfrGap > 0.18 && def(vpip) && (vpip.pct as number) > 0.22) {
    out.push({
      code: 'passive-pre', severity: 'warn', title: 'You call too much before the flop',
      explanation: `You play ${pctOf(vpip.pct)} of hands but raise only ${pctOf(pfr.pct)} — too much limping/calling. Raising takes the lead; calling lets opponents control the hand.`,
    });
  }
  if (def(vpip) && (vpip.pct as number) < 0.14) {
    out.push({
      code: 'too-tight', severity: 'info', title: 'You fold too many hands',
      explanation: `You only play ${pctOf(vpip.pct)} of hands — you're missing profitable spots and getting no action when you finally do play. Open up, especially in late position.`,
    });
  }
  if (af !== undefined && af < 1.0) {
    out.push({
      code: 'passive-post', severity: 'warn', title: 'You don’t bet or raise enough',
      explanation: `After the flop you mostly check and call (aggression ${af.toFixed(1)}×). Betting your strong hands wins more, and the odd bet steals pots others give up on.`,
    });
  }
  if (af !== undefined && af > 4 && def(vpip) && (vpip.pct as number) > 0.35) {
    out.push({
      code: 'over-aggro', severity: 'warn', title: 'You may be too wild',
      explanation: `Lots of hands played and very high aggression (${af.toFixed(1)}×) — you're probably bluffing too often. Pick better spots to apply pressure.`,
    });
  }
  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** Things the player is doing well — same sample gating as the leaks. */
export function detectStrengths(stats: StatPanel): Strength[] {
  const out: Strength[] = [];
  const { vpip, pfr, vpipPfrGap, af, wtsd, wssd, wwsf } = stats;

  if (def(vpip) && (vpip.pct as number) >= 0.15 && (vpip.pct as number) <= 0.30) {
    out.push({ code: 'good-selection', title: 'Good starting-hand selection',
      explanation: `You play ${pctOf(vpip.pct)} of hands — a healthy, disciplined range.` });
  }
  if (def(pfr) && vpipPfrGap !== undefined && (pfr.pct as number) >= 0.13 && vpipPfrGap <= 0.10) {
    out.push({ code: 'takes-lead', title: 'You take the lead',
      explanation: `You raise (${pctOf(pfr.pct)}) rather than limping in — proactive, aggressive poker.` });
  }
  if (af !== undefined && af >= 1.5 && af <= 3.5) {
    out.push({ code: 'good-aggro', title: 'Healthy aggression',
      explanation: `Your bet/raise rate after the flop (${af.toFixed(1)}×) is right in the sweet spot.` });
  }
  if (def(wssd) && (wssd.pct as number) >= 0.52) {
    out.push({ code: 'strong-showdowns', title: 'You win at showdown',
      explanation: `When you reach the end you win ${pctOf(wssd.pct)} of the time — you show up with strong hands.` });
  }
  if (def(wtsd) && (wtsd.pct as number) >= 0.25 && (wtsd.pct as number) <= 0.34) {
    out.push({ code: 'good-discipline', title: 'Good showdown discipline',
      explanation: `You go to showdown ${pctOf(wtsd.pct)} of the time — not too sticky, not too nitty.` });
  }
  if (def(wwsf) && (wwsf.pct as number) >= 0.45) {
    out.push({ code: 'wins-postflop', title: 'You win after the flop',
      explanation: `You take ${pctOf(wwsf.pct)} of the pots you see a flop in.` });
  }
  return out;
}

function def(r: { pct: number | undefined }): boolean {
  return r.pct !== undefined;
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

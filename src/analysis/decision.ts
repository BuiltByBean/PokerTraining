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
import { evaluate } from '../engine/evaluator';
import { evCall, requiredEquity } from '../engine/odds';
import { preflopStrength } from '../bots/strength';
import type { Rng } from '../engine/rng';
import type { Card, Rank, Suit } from '../engine/types';
import { drawOuts } from './draws';
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
  // Who the equity was measured against, so the % is verifiable in the note.
  const vs = describeOpponents(snap, record);

  if (kind === 'fold') return gradeFold(snap, eq, reqEq, toCall, bb, vs, hadContinuingMerit(snap, record));
  if (kind === 'check') return gradeCheck(snap, eq, reqEq);
  if (kind === 'call' || (kind === 'allin' && snap.amountPutIn <= snap.betFaced)) {
    return gradeCall(snap, eq, reqEq, bb, vs);
  }
  return gradeAggressive(snap, eq, reqEq, record, vs);
}

// ── branches ────────────────────────────────────────────────────────────────

function gradeCall(snap: DecisionSnapshot, eq: number, reqEq: number, bb: number, vs: string): DecisionGrade {
  const toCall = Math.min(snap.betFaced, snap.effectiveStack);
  const ev = evCall(eq, snap.potBefore, toCall);
  const evLossBb = Math.max(0, -ev) / bb;
  const against = vs ? ` against ${vs}` : '';
  const note = ev >= 0
    ? `Good call — about a ${pct(eq)} chance to win${against}, and you only needed ${pct(reqEq)} for the call to be worth it.`
    : `Loose call — you put in ${toCall} chips with about a ${pct(eq)} chance to win${against}, but needed roughly ${pct(reqEq)}. You were behind.`;
  return { snapshot: snap, hindsightEquity: eq, requiredEquity: reqEq, evChips: ev, evLossBb, verdict: verdictFor(evLossBb), note };
}

function gradeFold(
  snap: DecisionSnapshot, eq: number, reqEq: number, toCall: number, bb: number, vs: string, hadMerit: boolean,
): DecisionGrade {
  const wouldHaveBeen = evCall(eq, snap.potBefore, toCall);
  const against = vs ? ` against ${vs}` : '';
  const grade = (evLossBb: number, note: string): DecisionGrade =>
    ({ snapshot: snap, hindsightEquity: eq, requiredEquity: reqEq, evChips: 0, evLossBb, verdict: verdictFor(evLossBb), note });

  if (snap.betFaced === 0) {
    return grade(Math.max(0, wouldHaveBeen) / bb,
      `You folded a hand you could have seen for free — nobody had bet, so checking cost nothing. Never fold when you can check.`);
  }
  if (wouldHaveBeen <= 0) {
    return grade(0, `Good fold — only about a ${pct(eq)} chance to win${against}, not enough to call the ${pct(reqEq)} price.`);
  }
  if (hadMerit) {
    return grade(wouldHaveBeen / bb,
      `Too tight — calling would have made money. You had about a ${pct(eq)} chance to win${against}, and only needed ${pct(reqEq)} to call.`);
  }
  // +EV only in hindsight, but a weak hand with nothing to continue on: folding
  // to a bet is standard — you simply ran into a bluff this time. Grading it a
  // mistake would be "resulting" (punishing a good decision for a bad-luck result).
  return grade(0,
    `Fine fold — folding a weak hand to a bet is standard. In hindsight you were ahead${against} (~${pct(eq)} to win) because they were bluffing, but you can't profitably call here without a real hand or draw.`);
}

function gradeCheck(snap: DecisionSnapshot, eq: number, reqEq: number): DecisionGrade {
  const note = eq > 0.8 && snap.board.length >= 3
    ? `You checked a strong hand (~${pct(eq)} chance to win) — betting probably would have won you more.`
    : `Checked.`;
  return { snapshot: snap, hindsightEquity: eq, requiredEquity: reqEq, evChips: 0, evLossBb: 0, verdict: 'correct', note };
}

function gradeAggressive(
  snap: DecisionSnapshot, eq: number, reqEq: number, record: HandRecord, vs: string,
): DecisionGrade {
  // Fold equity isn't priceable from hindsight cards, so we don't assign an
  // EV loss — we label intent. leaks.ts catches reckless bluffs.
  const against = vs ? ` against ${vs}` : '';
  const hole = record.holeCards[record.config.humanId] ?? [];
  const mk = (verdict: Verdict, note: string): DecisionGrade =>
    ({ snapshot: snap, hindsightEquity: eq, requiredEquity: reqEq, evChips: 0, evLossBb: 0, verdict, note });

  // Preflop: a raise is an open/3-bet. Judge it by starting-hand quality, not by
  // hindsight equity (which is naturally low multiway) — and never call it a bluff.
  if (snap.board.length < 3) {
    const strong = hole.length === 2 && preflopStrength(hole).score >= 0.5;
    return strong
      ? mk('correct', `Raise — a fine hand to open with. (In hindsight just ${pct(eq)} to win${against}, but preflop pots are often multiway, so that number is naturally low.)`)
      : mk('marginal', `Light raise — a weak hand to be raising (about ${pct(eq)} to win${against}). Fine as an occasional steal, risky as a habit.`);
  }

  if (eq >= 0.6) {
    return mk('correct', `Strong bet — you likely had the best hand (~${pct(eq)} to win${against}), betting to get paid.`);
  }
  const hasDraw = hole.length === 2 && drawOuts([...hole, ...snap.board]) > 0;
  if (eq < 0.3) {
    return hasDraw
      ? mk('correct', `A semi-bluff — behind for now (~${pct(eq)} to win${against}) but you have a draw that can improve, and it also wins if they fold.`)
      : mk('marginal', `A bluff — only about a ${pct(eq)} chance to win${against}, so this only works if they fold.`);
  }
  return mk('correct', `A thin bet — roughly a coin flip (~${pct(eq)} to win${against})${hasDraw ? ', with a draw to back it up' : ''}; part value, part bluff.`);
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

/**
 * Did the hero actually have something to continue with? Used so we don't grade
 * folding air as a "mistake" just because the opponent turned out to be bluffing.
 * Postflop: any made hand (pair+) or a real draw. Preflop: a genuinely strong
 * starting hand (a pair or two broadway cards) — folding trash is never a leak.
 */
function hadContinuingMerit(snap: DecisionSnapshot, record: HandRecord): boolean {
  const hole = record.holeCards[record.config.humanId] ?? [];
  if (hole.length < 2) return false;
  if (snap.board.length >= 3) {
    const cards = [...hole, ...snap.board];
    if (evaluate(cards).category !== 'high-card') return true;
    return drawOuts(cards) > 0;
  }
  const a = hole[0] as Card;
  const b = hole[1] as Card;
  return a.rank === b.rank || (Math.min(a.rank, b.rank) >= 10);
}

function verdictFor(evLossBb: number): Verdict {
  if (evLossBb < 0.1) return 'correct';
  if (evLossBb < 0.5) return 'marginal';
  if (evLossBb <= 2) return 'mistake';
  return 'blunder';
}

const VERDICT_LABEL: Record<Verdict, string> = {
  correct: 'Good',
  marginal: 'Borderline',
  mistake: 'Mistake',
  blunder: 'Big mistake',
};

/** Plain-English label for a verdict, for the UI chips. */
export function verdictLabel(v: Verdict): string {
  return VERDICT_LABEL[v];
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

const RANK_TEXT: Record<Rank, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};
const SUIT_TEXT: Record<Suit, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };

function cardText(c: Card): string {
  return `${RANK_TEXT[c.rank]}${SUIT_TEXT[c.suit]}`;
}

/**
 * Who the hero's equity was measured against, named so the % is verifiable.
 * Heads-up shows the opponent's actual hand ("Hedy's 5♦3♣"); multiway just
 * counts them (listing every hand would be noise).
 */
function describeOpponents(snap: DecisionSnapshot, record: HandRecord): string {
  const ids = snap.liveOpponentIds;
  if (ids.length === 0) return '';
  if (ids.length === 1) {
    const id = ids[0] as string;
    const name = record.config.names[id] ?? 'them';
    const hole = record.holeCards[id];
    return hole && hole.length === 2 ? `${name}’s ${cardText(hole[0] as Card)}${cardText(hole[1] as Card)}` : name;
  }
  return `the ${ids.length} players still in`;
}

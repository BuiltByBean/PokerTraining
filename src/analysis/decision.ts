/*
 * Per-decision coaching — judged ONLY on the information the player actually had
 * at the table: their hole cards, the board, the price (pot odds), their draw
 * outs, position, and how many players are in. It deliberately does NOT look at
 * the opponents' cards. Grading a fold a "mistake" because the villain turned
 * out to be bluffing is "resulting" — it teaches nothing, because you never have
 * that information when you act. The goal is to help the player make better
 * decisions with what's knowable, not to score luck.
 *
 * So: draws are judged by outs vs. price, made hands by their strength and the
 * board, preflop calls/raises by hand quality and position. Every note is
 * phrased in those terms.
 */

import { evaluate, type Category } from '../engine/evaluator';
import { requiredEquity, outsToEquity } from '../engine/odds';
import { preflopStrength, postflopStrength } from '../bots/strength';
import { drawOuts, hasFlushDraw, hasOpenEnder, hasGutshot } from './draws';
import type { Rng } from '../engine/rng';
import type { Card, Rank } from '../engine/types';
import type { DecisionSnapshot } from './recorder';
import type { HandRecord } from './record';

export type Verdict = 'correct' | 'marginal' | 'mistake' | 'blunder';

export interface DecisionGrade {
  readonly snapshot: DecisionSnapshot;
  /** 0-1 strength of the hero's hand from THEIR view (cards + board only). */
  readonly handStrength: number;
  /** Break-even equity the price demanded (0 when checking). */
  readonly requiredEquity: number;
  /** Estimated big blinds given up vs. the better play — drives verdict + cost. */
  readonly evLossBb: number;
  readonly verdict: Verdict;
  readonly note: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- rng kept for API symmetry
export function gradeHand(record: HandRecord, _rng?: Rng): DecisionGrade[] {
  const heroId = record.config.humanId;
  return record.snapshots.filter(s => s.actorId === heroId).map(s => gradeDecision(s, record));
}

function gradeDecision(snap: DecisionSnapshot, record: HandRecord): DecisionGrade {
  const read = decisionRead(snap, record);
  const kind = snap.action.kind;
  if (kind === 'fold') return gradeFold(snap, read);
  if (kind === 'check') return gradeCheck(snap, read);
  if (kind === 'call' || (kind === 'allin' && snap.amountPutIn <= snap.betFaced)) return gradeCall(snap, read);
  return gradeAggressive(snap, read);
}

// ── what the hero could see ──────────────────────────────────────────────────

interface DecisionRead {
  readonly preflop: boolean;
  readonly strength: number;      // 0-1, from hero cards + board only
  readonly reqEq: number;         // pot-odds price to continue
  readonly outs: number;          // draw outs (0 if none / preflop)
  readonly drawPhrase: string;    // "a flush draw", "an open-ended straight draw"…
  readonly improveByRiver: number;// chance the draw completes by the river
  readonly madePhrase: string;    // hero's made hand IF it uses their cards, else ''
  readonly playingBoard: boolean; // "made" hand is entirely on the board
  readonly players: number;       // contenders still in, incl. hero
}

function decisionRead(snap: DecisionSnapshot, record: HandRecord): DecisionRead {
  const hole = record.holeCards[record.config.humanId] ?? [];
  const preflop = snap.board.length < 3;
  const known = hole.length === 2;
  const strength = known ? (preflop ? preflopStrength(hole).score : postflopStrength(hole, snap.board).score) : 0;
  const toCall = Math.min(snap.betFaced, snap.effectiveStack);
  const cards = [...hole, ...snap.board];
  const outs = preflop || !known ? 0 : drawOuts(cards);
  const hand = heroHand(snap, record);
  return {
    preflop,
    strength,
    reqEq: snap.betFaced > 0 ? requiredEquity(toCall, snap.potBefore) : 0,
    outs,
    drawPhrase: preflop ? '' : drawPhrase(cards),
    improveByRiver: outs > 0 ? outsToEquity(outs, snap.street === 'flop' ? 2 : 1) : 0,
    madePhrase: hand.phrase,
    playingBoard: hand.playingBoard,
    players: snap.numActivePlayers,
  };
}

// ── branches ─────────────────────────────────────────────────────────────────

function gradeFold(snap: DecisionSnapshot, read: DecisionRead): DecisionGrade {
  const price = pct(read.reqEq);
  if (snap.betFaced === 0) {
    return mk(snap, read, 0.6, `You folded for free — nobody had bet, so checking cost nothing. Never fold when you can just check.`);
  }
  if (read.preflop) {
    return read.strength >= 0.85
      ? mk(snap, read, 0.5, `Too tight — that's a premium hand; folding it before the flop gives up a clear edge.`)
      : mk(snap, read, 0, `Good fold — not a hand worth continuing with before the flop.`);
  }
  if (read.madePhrase && read.strength >= 0.62) {
    return mk(snap, read, 1, `Too tight — you folded ${read.madePhrase}, a strong hand. Facing a ${price} price that's usually a call or a raise, not a fold.`);
  }
  if (read.outs >= 8) {
    return mk(snap, read, 0.3, `A bit tight — you folded ${read.drawPhrase} (~${read.outs} outs, about ${pct(read.improveByRiver)} to complete by the river). A draw that big is usually worth continuing for a ${price} price.`);
  }
  if (read.playingBoard) {
    return mk(snap, read, 0, `Fine fold — the pair was on the board, so you were only playing the board (no piece of your own). Folding that to a bet is standard.`);
  }
  return mk(snap, read, 0, `Good fold — ${held(read)} isn't worth continuing for a ${price} price against ${oppText(read.players)}.`);
}

function gradeCall(snap: DecisionSnapshot, read: DecisionRead): DecisionGrade {
  const price = pct(read.reqEq);
  if (read.preflop) {
    return read.strength >= 0.4
      ? mk(snap, read, 0, `Reasonable call — ${preflopTier(read.strength)} is fine to continue with for this price.`)
      : mk(snap, read, 0.3, `Loose call — ${preflopTier(read.strength)} is loose to call a raise with, especially ${posText(snap)}. Hands like this quietly bleed chips.`);
  }
  if (read.madePhrase && read.strength >= 0.55) {
    return mk(snap, read, 0, `Good call — you had ${read.madePhrase}, strong enough to continue for a ${price} price.`);
  }
  if (read.outs >= 8) {
    const priced = read.improveByRiver >= read.reqEq;
    return mk(snap, read, priced ? 0 : 0.3,
      `${priced ? 'Good call' : 'Thin call'} — ${read.drawPhrase} (~${read.outs} outs, about ${pct(read.improveByRiver)} to complete). You needed ${price}${priced ? ', so the price was right.' : ' — a touch rich, but a draw this big is fine to peel.'}`);
  }
  if (read.outs > 0 && read.improveByRiver >= read.reqEq) {
    return mk(snap, read, 0, `Okay call — ${read.drawPhrase} priced in (about ${pct(read.improveByRiver)} to hit vs. the ${price} you needed).`);
  }
  return mk(snap, read, 1, `Loose call — you called ${snap.betFaced} with ${held(read)}, needing about ${price}. That's not enough to continue — fold these.`);
}

function gradeCheck(snap: DecisionSnapshot, read: DecisionRead): DecisionGrade {
  const note = read.strength >= 0.7 && snap.board.length >= 3
    ? `You checked ${read.madePhrase || 'a strong hand'} — betting for value probably wins you more.`
    : `Checked.`;
  return { snapshot: snap, handStrength: read.strength, requiredEquity: read.reqEq, evLossBb: 0, verdict: 'correct', note };
}

function gradeAggressive(snap: DecisionSnapshot, read: DecisionRead): DecisionGrade {
  const g = (verdict: Verdict, note: string): DecisionGrade =>
    ({ snapshot: snap, handStrength: read.strength, requiredEquity: read.reqEq, evLossBb: 0, verdict, note });
  if (read.preflop) {
    return read.strength >= 0.5
      ? g('correct', `Raise — a fine hand to open or 3-bet with.`)
      : g('marginal', `Light raise — ${preflopTier(read.strength)} to be raising. Fine as an occasional steal, risky as a habit.`);
  }
  if (read.madePhrase && read.strength >= 0.6) {
    return g('correct', `Strong bet — you had ${read.madePhrase}, betting to get value.`);
  }
  if (read.outs >= 8) {
    return g('correct', `A semi-bluff — ${read.drawPhrase} that can still improve, and it wins right now if they fold. A good spot to apply pressure.`);
  }
  if (read.strength < 0.3) {
    return g('marginal', `A bluff — not much of a hand (${held(read)}), so this only works if they fold. Pick your spots.`);
  }
  return g('correct', `A thin bet — a middling hand${read.outs > 0 ? ', with a draw to back it up' : ''}; part value, part pressure.`);
}

// ── phrasing helpers ─────────────────────────────────────────────────────────

function mk(snap: DecisionSnapshot, read: DecisionRead, evLossBb: number, note: string): DecisionGrade {
  return { snapshot: snap, handStrength: read.strength, requiredEquity: read.reqEq, evLossBb, verdict: verdictFor(evLossBb), note };
}

/** Best short description of what the hero was holding, from their own view. */
function held(read: DecisionRead): string {
  if (read.madePhrase && read.drawPhrase) return `${read.madePhrase} with ${read.drawPhrase}`;
  if (read.madePhrase) return read.madePhrase;
  if (read.drawPhrase) return read.drawPhrase;
  if (read.playingBoard) return 'only the board (no pair of your own)';
  return 'just high card';
}

function preflopTier(strength: number): string {
  if (strength >= 0.62) return 'a strong starting hand';
  if (strength >= 0.4) return 'a playable starting hand';
  return 'a weak starting hand';
}

function posText(snap: DecisionSnapshot): string {
  return snap.inPosition ? 'in position' : 'out of position';
}

function oppText(players: number): string {
  const n = Math.max(0, players - 1);
  return `${n} opponent${n === 1 ? '' : 's'}`;
}

/** Name the draw(s) the hero holds, from their cards + board. */
function drawPhrase(cards: readonly Card[]): string {
  const parts: string[] = [];
  if (hasFlushDraw(cards)) parts.push('a flush draw');
  if (hasOpenEnder(cards)) parts.push('an open-ended straight draw');
  else if (hasGutshot(cards)) parts.push('a gutshot straight draw');
  return parts.join(' plus ');
}

// ── made-hand detection (uses the hero's cards, not the board's) ──────────────

interface HeroHand {
  readonly phrase: string;        // '' if no made hand of the hero's own
  readonly playingBoard: boolean; // a made hand that's entirely on the board
}

/** What the hero actually made, honest about "playing the board". */
function heroHand(snap: DecisionSnapshot, record: HandRecord): HeroHand {
  const hole = record.holeCards[record.config.humanId] ?? [];
  if (hole.length < 2 || snap.board.length < 3) return { phrase: '', playingBoard: false };
  const category = evaluate([...hole, ...snap.board]).category;
  if (category === 'high-card') return { phrase: '', playingBoard: false };
  if (madeUsesHole(hole, snap.board)) return { phrase: HAND_PHRASE[category], playingBoard: false };
  return { phrase: '', playingBoard: drawOuts([...hole, ...snap.board]) === 0 };
}

/** Does the hero's best hand actually use their hole cards, or is it just the board? */
function madeUsesHole(hole: readonly Card[], board: readonly Card[]): boolean {
  const { category, best5 } = evaluate([...hole, ...board]);
  if (category === 'high-card') return false;
  if (category === 'flush' || category === 'straight' || category === 'straight-flush' || category === 'royal-flush') {
    const holeKeys = new Set(hole.map(cardKey));
    return best5.some((c: Card) => holeKeys.has(cardKey(c))); // a hole card is in the winning five
  }
  // Pair family: the hero must hold a card of one of the paired/tripped/quad ranks.
  const counts = new Map<Rank, number>();
  for (const c of best5 as Card[]) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  const holeRanks = new Set(hole.map(c => c.rank));
  for (const [rank, n] of counts) if (n >= 2 && holeRanks.has(rank)) return true;
  return false;
}

function cardKey(c: Card): string {
  return `${c.rank}${c.suit}`;
}

// Plain-English name for a hand category, so notes can say what you held.
const HAND_PHRASE: Record<Category, string> = {
  'royal-flush': 'a royal flush',
  'straight-flush': 'a straight flush',
  'four-of-a-kind': 'four of a kind',
  'full-house': 'a full house',
  flush: 'a flush',
  straight: 'a straight',
  'three-of-a-kind': 'three of a kind',
  'two-pair': 'two pair',
  pair: 'a pair',
  'high-card': 'just high card',
};

// ── verdict ──────────────────────────────────────────────────────────────────

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

/*
 * Draw detection, shared by the bots' hand-strength heuristic and the leak
 * analyzer so the two never disagree about what counts as a flush draw. All
 * functions take a single combined card array (hole + board) and are pure.
 *
 * These are heuristics for *unmade* draws — a completed flush is not a "flush
 * draw." Out counts are best-effort (they don't subtract tainted outs against a
 * specific opponent); the analyzer prefers exact hindsight equity where it can,
 * and uses these only as a secondary, explanatory signal.
 */

import type { Card, Suit } from '../engine/types';

/** The suit of a four-flush (a draw), or undefined. 5+ is a made flush, not a draw. */
export function flushDrawSuit(cards: readonly Card[]): Suit | undefined {
  const counts = new Map<Suit, number>();
  for (const c of cards) counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
  for (const [suit, n] of counts) if (n === 4) return suit;
  return undefined;
}

export function hasFlushDraw(cards: readonly Card[]): boolean {
  return flushDrawSuit(cards) !== undefined;
}

/** Open-ended straight draw: four to a straight open on both ends. */
export function hasOpenEnder(cards: readonly Card[]): boolean {
  const ranks = rankSet(cards);
  // lo capped at 10 so the run lo..lo+3 has room to extend on the high side.
  for (let lo = 2; lo <= 10; lo++) {
    if (ranks.has(lo) && ranks.has(lo + 1) && ranks.has(lo + 2) && ranks.has(lo + 3)) return true;
  }
  return false;
}

/** Gutshot (inside) straight draw: four of five consecutive ranks, one gap. */
export function hasGutshot(cards: readonly Card[]): boolean {
  if (hasOpenEnder(cards)) return false; // an OESD is the stronger label
  const ranks = rankSet(cards);
  for (let lo = 1; lo <= 10; lo++) {
    let present = 0;
    for (let r = lo; r <= lo + 4; r++) if (ranks.has(r)) present += 1;
    if (present === 4) return true;
  }
  return false;
}

/**
 * Best-effort out count for an unmade drawing hand. Flush draw ≈ 9, OESD ≈ 8,
 * gutshot ≈ 4; a combo draw stacks but is capped. Returns 0 with no draw.
 */
export function drawOuts(cards: readonly Card[]): number {
  let outs = 0;
  if (hasFlushDraw(cards)) outs += 9;
  if (hasOpenEnder(cards)) outs += 8;
  else if (hasGutshot(cards)) outs += 4;
  return Math.min(outs, 15);
}

function rankSet(cards: readonly Card[]): Set<number> {
  const ranks = new Set<number>();
  for (const c of cards) ranks.add(c.rank);
  if (ranks.has(14)) ranks.add(1); // ace plays low for wheel draws
  return ranks;
}

/*
 * Cheap hand-strength estimator for bots. NOT a real equity calculator —
 * those need Monte Carlo simulation and we don't want to ship 10k rollouts
 * per decision in v1. This is a heuristic that's "good enough to feel real":
 *
 *   - Preflop: classify hole cards into tiers (premium / strong / playable
 *     / weak), modulated by suited and connected.
 *   - Postflop: best 5-card category from hole+board, with adjustments for
 *     position, kicker, and the most obvious draws (flush, OESD).
 *
 * The bot uses this score directly: above 0.7 = "I should play big", below
 * 0.3 = "I should mostly fold". The thresholds are tuned by feel, not theory.
 */

import { evaluate } from '../engine/evaluator';
import { hasFlushDraw, hasOpenEnder } from '../analysis/draws';
import type { Card, Rank } from '../engine/types';

export interface Strength {
  /** 0..1, higher is better. */
  readonly score: number;
  /** Categorical label, useful for debugging + future training overlays. */
  readonly label: 'trash' | 'weak' | 'playable' | 'strong' | 'premium';
}

export function preflopStrength(hole: readonly Card[]): Strength {
  if (hole.length !== 2) return { score: 0.2, label: 'weak' };
  const a = hole[0] as Card;
  const b = hole[1] as Card;
  const hi = Math.max(a.rank, b.rank) as Rank;
  const lo = Math.min(a.rank, b.rank) as Rank;
  const suited = a.suit === b.suit;
  const pair = a.rank === b.rank;
  const gap = hi - lo;

  // Pairs.
  if (pair) {
    if (hi >= 12) return { score: 0.92, label: 'premium' }; // QQ+
    if (hi >= 9)  return { score: 0.78, label: 'strong' };  // 99-JJ
    if (hi >= 6)  return { score: 0.62, label: 'playable' };// 66-88
    return { score: 0.5, label: 'playable' };               // small pairs
  }

  // High-card hands.
  if (hi === 14 && lo >= 10) return { score: suited ? 0.88 : 0.78, label: 'strong' }; // AT+
  if (hi === 14)             return { score: suited ? 0.6  : 0.4 , label: suited ? 'playable' : 'weak' };
  if (hi === 13 && lo >= 10) return { score: suited ? 0.78 : 0.66, label: 'strong' };
  if (hi >= 11 && lo >= 10)  return { score: suited ? 0.72 : 0.58, label: 'playable' };

  // Suited connectors.
  if (suited && gap <= 2 && lo >= 6) return { score: 0.55, label: 'playable' };
  if (suited && gap === 1)           return { score: 0.45, label: 'weak' };

  // Connectors / low cards.
  if (gap === 1 && lo >= 8) return { score: 0.42, label: 'weak' };

  return { score: 0.18, label: 'trash' };
}

export function postflopStrength(
  hole: readonly Card[],
  board: readonly Card[],
): Strength {
  const made = evaluate([...hole, ...board]);
  let score: number;
  switch (made.category) {
    case 'royal-flush':
    case 'straight-flush':
    case 'four-of-a-kind':
    case 'full-house':         score = 0.98; break;
    case 'flush':              score = 0.9;  break;
    case 'straight':           score = 0.85; break;
    case 'three-of-a-kind':    score = 0.78; break;
    case 'two-pair':           score = 0.65; break;
    case 'pair':               score = pairScore(hole, board, made.best5); break;
    case 'high-card':          score = 0.18; break;
  }

  // Draw bonuses, only on flop/turn (river has no draws).
  if (board.length < 5) {
    if (hasFlushDraw([...hole, ...board])) score = Math.max(score, 0.55);
    if (hasOpenEnder([...hole, ...board])) score = Math.max(score, 0.5);
  }

  return { score, label: labelFor(score) };
}

function labelFor(s: number): Strength['label'] {
  if (s >= 0.85) return 'premium';
  if (s >= 0.65) return 'strong';
  if (s >= 0.4)  return 'playable';
  if (s >= 0.25) return 'weak';
  return 'trash';
}

/**
 * Differentiate "top pair good kicker" from "bottom pair" — both score as
 * `pair` in the evaluator but their realised equity is wildly different.
 */
function pairScore(hole: readonly Card[], board: readonly Card[], best5: readonly Card[]): number {
  const pairRank = pairRankIn(best5);
  if (pairRank === undefined) return 0.45;
  const topBoardRank = Math.max(...board.map(c => c.rank));
  const hasOverpair = hole.every(c => c.rank === pairRank) && pairRank > topBoardRank;
  if (hasOverpair) return 0.78;
  if (pairRank === topBoardRank) {
    // Top pair. Kicker matters.
    const kicker = hole.find(c => c.rank !== pairRank)?.rank ?? 0;
    if (kicker >= 12) return 0.72;
    if (kicker >= 9)  return 0.62;
    return 0.55;
  }
  // Middle / bottom pair.
  return 0.42;
}

function pairRankIn(cards: readonly Card[]): Rank | undefined {
  const seen = new Map<Rank, number>();
  for (const c of cards) seen.set(c.rank, (seen.get(c.rank) ?? 0) + 1);
  for (const [r, n] of seen) if (n === 2) return r;
  return undefined;
}


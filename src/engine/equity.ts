/*
 * Hot-and-cold equity. Given each contender's hole cards and the current board,
 * what fraction of random run-outs does each win? This app is unusual in that we
 * KNOW everyone's cards, so most of the time we can compute equity exactly —
 * Monte Carlo is only needed preflop where the run-out space is huge.
 *
 * Exactness by street (remaining = 5 - board.length):
 *   river  (0 to come): one evaluation, exact.
 *   turn   (1 to come): enumerate ~44 cards, exact.
 *   flop   (2 to come): enumerate C(~45,2) ≈ 1000, exact and cheap.
 *   preflop(5 to come): Monte Carlo with the seeded RNG.
 *
 * Purity: no Math.random — randomness comes only from the injected Rng, so a
 * given seed reproduces the same numbers (tests depend on this).
 */

import { evaluate } from './evaluator';
import { freshDeck } from './deck';
import type { Card } from './types';
import type { Rng } from './rng';

const DEFAULT_MC_SAMPLES = 4000;

export interface PlayerEquity {
  readonly playerId: string;
  /** Fraction of run-outs won outright. */
  readonly win: number;
  /** Fraction of run-outs tied (pot shared). */
  readonly tie: number;
  /** Overall share of the pot expected: win + tie split among the tied. */
  readonly equity: number;
}

export interface EquityResult {
  readonly equities: readonly PlayerEquity[];
  readonly samples: number;
  readonly method: 'exact' | 'monte-carlo';
}

export interface EquityContender {
  readonly id: string;
  readonly hole: readonly Card[];
}

export interface EquityInput {
  readonly players: readonly EquityContender[];
  readonly board: readonly Card[];
  readonly rng: Rng;
  readonly maxSamples?: number;
}

/** Equity of each contender given known hole cards. Exact where feasible. */
export function equity(input: EquityInput): EquityResult {
  const { players, board, rng } = input;
  if (players.length === 0) return { equities: [], samples: 0, method: 'exact' };

  const known = [...board, ...players.flatMap(p => p.hole)];
  const residual = freshDeck().filter(c => !includesCard(known, c));
  const remaining = 5 - board.length;

  const tally = players.map(() => ({ sole: 0, tied: 0, share: 0 }));
  let runs = 0;
  const score = (runout: readonly Card[]): void => {
    runs += 1;
    scoreRunout(players, board, runout, tally);
  };

  let method: EquityResult['method'] = 'exact';
  if (remaining <= 0) {
    score([]);
  } else if (remaining === 1) {
    for (const c of residual) score([c]);
  } else if (remaining === 2) {
    for (let i = 0; i < residual.length; i++)
      for (let j = i + 1; j < residual.length; j++)
        score([residual[i] as Card, residual[j] as Card]);
  } else {
    method = 'monte-carlo';
    const samples = input.maxSamples ?? DEFAULT_MC_SAMPLES;
    for (let s = 0; s < samples; s++) score(rng.shuffle(residual.slice()).slice(0, remaining));
  }

  const equities: PlayerEquity[] = players.map((p, i) => {
    const t = tally[i] as { sole: number; tied: number; share: number };
    return { playerId: p.id, win: t.sole / runs, tie: t.tied / runs, equity: t.share / runs };
  });
  return { equities, samples: runs, method };
}

export interface RangeEquityInput {
  readonly hero: readonly Card[];
  /** Candidate opponent hands; combos colliding with known cards are skipped. */
  readonly villainRange: readonly (readonly [Card, Card])[];
  readonly board: readonly Card[];
  readonly rng: Rng;
  readonly maxSamples?: number;
}

/**
 * Hero equity against a RANGE of opponent hands (averaged uniformly over the
 * combos that don't collide with known cards). Used for decision-quality
 * grading — "would this call be right against a reasonable continuing range?"
 */
export function equityVsRange(input: RangeEquityInput): { readonly equity: number; readonly combos: number } {
  const blocked = [...input.board, ...input.hero];
  let sum = 0;
  let combos = 0;
  for (const villain of input.villainRange) {
    if (includesCard(blocked, villain[0]) || includesCard(blocked, villain[1])) continue;
    if (sameCard(villain[0], villain[1])) continue;
    const result = equity({
      players: [
        { id: 'hero', hole: input.hero },
        { id: 'villain', hole: villain },
      ],
      board: input.board,
      rng: input.rng,
      ...(input.maxSamples !== undefined ? { maxSamples: input.maxSamples } : {}),
    });
    sum += result.equities[0]?.equity ?? 0;
    combos += 1;
  }
  return { equity: combos === 0 ? 0 : sum / combos, combos };
}

// ── internals ───────────────────────────────────────────────────────────────

function scoreRunout(
  players: readonly EquityContender[],
  board: readonly Card[],
  runout: readonly Card[],
  tally: { sole: number; tied: number; share: number }[],
): void {
  const full = [...board, ...runout];
  let best = -1;
  const winners: number[] = [];
  for (let i = 0; i < players.length; i++) {
    const p = players[i] as EquityContender;
    const s = evaluate([...p.hole, ...full]).score;
    if (s > best) {
      best = s;
      winners.length = 0;
      winners.push(i);
    } else if (s === best) {
      winners.push(i);
    }
  }
  const splitShare = 1 / winners.length;
  for (const w of winners) {
    const t = tally[w] as { sole: number; tied: number; share: number };
    t.share += splitShare;
    if (winners.length === 1) t.sole += 1;
    else t.tied += 1;
  }
}

function sameCard(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

function includesCard(cards: readonly Card[], c: Card): boolean {
  return cards.some(x => sameCard(x, c));
}

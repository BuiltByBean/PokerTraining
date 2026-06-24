/*
 * Pure poker math. These are the building blocks the analysis layer uses to
 * decide whether a call/bet/fold was justified. Every function is unit-tested
 * against hand-computed values — a wrong formula here silently mis-grades every
 * decision downstream.
 *
 * Conventions:
 *  - "equity" is a win probability in [0, 1], NOT a percentage.
 *  - chip amounts are in whatever unit the caller passes (chips or bb); the
 *    functions are unit-agnostic.
 *  - `potBeforeCall` / `potBeforeBet` means everything already in the middle
 *    BEFORE the hero puts their own chips in (it includes a villain's bet).
 */

/** Break-even equity needed to profitably call. `call / (pot + call)`. */
export function requiredEquity(toCall: number, potBeforeCall: number): number {
  const total = potBeforeCall + toCall;
  return total <= 0 ? 0 : toCall / total;
}

/** Pot odds as a ratio (e.g. 3 means "3:1"): chips you can win per chip risked. */
export function potOdds(toCall: number, potBeforeCall: number): number {
  return toCall <= 0 ? Infinity : potBeforeCall / toCall;
}

/**
 * EV of calling vs folding, in chips. Net relative to folding (which is 0):
 * win the pot already in the middle with probability `equity`, otherwise lose
 * the call. Assumes no further betting (true for a river or all-in call; an
 * approximation otherwise — implied odds handle the rest).
 */
export function evCall(equity: number, potBeforeCall: number, toCall: number): number {
  return equity * potBeforeCall - (1 - equity) * toCall;
}

/** Folding is the reference action. Always 0 — here for symmetry/readability. */
export function evFold(): number {
  return 0;
}

/**
 * EV of a pure (zero-equity-when-called) bluff, in chips. Gain the pot when
 * they fold; lose the bet when they don't.
 */
export function evBluff(foldProb: number, potBeforeBet: number, bet: number): number {
  return foldProb * potBeforeBet - (1 - foldProb) * bet;
}

/** Chips gained purely from the chance the opponent folds. */
export function foldEquity(foldProb: number, potBeforeBet: number): number {
  return foldProb * potBeforeBet;
}

/**
 * Minimum Defense Frequency: the share of the time you must continue vs a bet
 * to stop a pure bluff from being automatically profitable. `pot / (pot + bet)`.
 */
export function mdf(bet: number, potBeforeBet: number): number {
  const total = potBeforeBet + bet;
  return total <= 0 ? 1 : potBeforeBet / total;
}

/**
 * Alpha: the fold frequency a bluff needs to break even. `bet / (pot + bet)`.
 * Equals `1 - mdf`. Half-pot → 0.33, pot → 0.5, 2× overbet → 0.67.
 */
export function breakEvenBluffPct(bet: number, potBeforeBet: number): number {
  const total = potBeforeBet + bet;
  return total <= 0 ? 0 : bet / total;
}

/** Stack-to-pot ratio. Low SPR commits you to one pair; high SPR doesn't. */
export function spr(effectiveStack: number, pot: number): number {
  return pot <= 0 ? Infinity : effectiveStack / pot;
}

/**
 * Equity estimate from outs (Rule of 2 and 4). `streetsToCome` is 1 (turn OR
 * river to come) or 2 (both, only valid when the money's already all-in — when
 * there's betting behind, use 1). The classic Rule of 4 overcounts past 8
 * outs, so we subtract the excess: 9 outs over two streets → 35%, not 36%.
 */
export function outsToEquity(outs: number, streetsToCome: number): number {
  if (streetsToCome >= 2) {
    const base = outs * 4;
    const corrected = outs > 8 ? base - (outs - 8) : base;
    return corrected / 100;
  }
  return (outs * 2) / 100;
}

/**
 * Extra chips you must expect to win on later streets to justify a call that
 * pot odds alone don't cover. `(1/equity)·call − (pot + call)`. Returns 0 when
 * pot odds already suffice (no implied odds required).
 */
export function impliedOddsNeeded(toCall: number, potBeforeCall: number, equity: number): number {
  if (equity <= 0) return Infinity;
  const needed = (1 / equity) * toCall - (potBeforeCall + toCall);
  return Math.max(0, needed);
}

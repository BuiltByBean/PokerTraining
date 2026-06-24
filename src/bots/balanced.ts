/*
 * The "Balanced" bot. The only v1 personality — solid TAG (tight-aggressive)
 * that won't embarrass us. It:
 *
 *   - Folds trash, calls/raises good hands.
 *   - Pays attention to pot odds when facing a bet.
 *   - Sizes value bets in proportion to pot, not stack.
 *   - Bluffs occasionally on the turn/river when checked to.
 *
 * Improvements waiting in the wings (later difficulties):
 *   - Position-aware preflop ranges (LP plays wider).
 *   - Opponent modelling from the action log (3-bet less vs. nits).
 *   - Bet-sizing tells (block bets, polarised river sizes).
 */

import { postflopStrength, preflopStrength, type Strength } from './strength';
import type { Action, BotView } from '../engine/types';
import type { Bot, BotContext } from './types';

export const balancedBot: Bot = (ctx: BotContext): Action => {
  const v = ctx.view;
  const strength: Strength =
    v.street === 'preflop'
      ? preflopStrength(v.self.hole)
      : postflopStrength(v.self.hole, v.board);

  if (v.toCall === 0) return openOrCheck(v, strength, ctx);
  return faceBet(v, strength, ctx);
};

/** Nobody has bet this street — open / check. */
function openOrCheck(v: BotView, s: Strength, ctx: BotContext): Action {
  // Postflop: bet for value with strong+, bluff a small % with trash on later streets.
  if (v.street !== 'preflop') {
    if (s.score >= 0.65) {
      const size = clampToStack(v, betSizing(v.pot, 0.66));
      return { kind: 'bet', amount: size };
    }
    if (s.score <= 0.25 && (v.street === 'turn' || v.street === 'river')) {
      // ~15% bluff frequency on the turn/river when checked to.
      if (ctx.rng.next() < 0.15) {
        const size = clampToStack(v, betSizing(v.pot, 0.5));
        return { kind: 'bet', amount: size };
      }
    }
    return { kind: 'check', amount: 0 };
  }
  // Preflop with no one in: open the pot.
  if (s.score >= 0.6) {
    const size = clampToStack(v, Math.max(v.bigBlind * 3, v.minRaise + v.bigBlind));
    return { kind: 'raise', amount: size };
  }
  return { kind: 'check', amount: 0 };
}

/** Facing a bet — fold / call / raise based on strength + pot odds. */
function faceBet(v: BotView, s: Strength, ctx: BotContext): Action {
  const potOdds = v.toCall / (v.pot + v.toCall);
  const target = v.self.betThisStreet + v.toCall;

  // Premium: raise for value.
  if (s.score >= 0.85) {
    if (v.self.stack > v.toCall * 2) {
      const newTotal = clampToStack(v, target + Math.max(v.minRaise, Math.floor(v.pot * 0.75)));
      if (newTotal > target) return { kind: 'raise', amount: newTotal };
    }
    return { kind: 'call', amount: target };
  }

  // Strong: usually call, sometimes raise.
  if (s.score >= 0.65) {
    if (ctx.rng.next() < 0.3 && v.self.stack > v.toCall * 2) {
      const newTotal = clampToStack(v, target + Math.max(v.minRaise, Math.floor(v.pot * 0.5)));
      if (newTotal > target) return { kind: 'raise', amount: newTotal };
    }
    return { kind: 'call', amount: target };
  }

  // Playable: call only if pot odds justify it.
  if (s.score >= 0.4) {
    // Need ~30% equity-ish. preflopStrength of 0.4 ≈ ~40% equity, good enough.
    if (potOdds < 0.4) return { kind: 'call', amount: target };
    return { kind: 'fold', amount: 0 };
  }

  // Weak/trash: only call if it's nearly free.
  if (potOdds < 0.15 && s.score >= 0.25) {
    return { kind: 'call', amount: target };
  }
  return { kind: 'fold', amount: 0 };
}

/** Round a fraction-of-pot bet to a sensible chip amount. */
function betSizing(pot: number, fraction: number): number {
  const raw = Math.round(pot * fraction);
  return Math.max(2, raw); // never below 1 BB; SB-only pots get a min open.
}

function clampToStack(v: BotView, target: number): number {
  const cap = v.self.betThisStreet + v.self.stack;
  return Math.min(target, cap);
}

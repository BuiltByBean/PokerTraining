/*
 * The skill-driven bot. One decision function whose thresholds are read from a
 * SkillProfile (set by the table's 1-10 difficulty), so the same code spans a
 * loose-passive calling station (L1) to a tough TAG/LAG (L10). It still sees
 * only a BotView — no peeking at hole cards.
 *
 * Dials in play:
 *   tightness        → how strong a hand it needs to play/continue
 *   aggression       → bet/raise vs call/check, and bet sizing
 *   bluffFreq        → how often it fires with air
 *   potOddsAdherence → whether it folds when the price is wrong (low = station)
 *   mistakeRate      → chance of a spew (call instead of fold, stab instead of check)
 *   sizingNoise      → randomness in bet sizes
 */

import { postflopStrength, preflopStrength, type Strength } from './strength';
import type { Action, BotView } from '../engine/types';
import type { Bot, BotContext } from './types';

export const balancedBot: Bot = (ctx: BotContext): Action => {
  const { view: v, skill } = ctx;
  const s: Strength = v.street === 'preflop'
    ? preflopStrength(v.self.hole)
    : postflopStrength(v.self.hole, v.board);
  const base = v.toCall === 0 ? openOrCheck(v, s, ctx) : faceBet(v, s, ctx);
  return maybeMistake(base, v, ctx);
};

/** No bet to us — open/bet for value, occasionally bluff, else check. */
function openOrCheck(v: BotView, s: Strength, ctx: BotContext): Action {
  const k = ctx.skill;
  if (v.street !== 'preflop') {
    const valueCut = 0.7 - k.aggression * 0.2; // aggressive bots value-bet thinner
    if (s.score >= valueCut) return bet(v, ctx, 0.5 + k.aggression * 0.3);
    const lateStreet = v.street === 'turn' || v.street === 'river';
    if (s.score <= 0.3 && (lateStreet || k.aggression > 0.7) && ctx.rng.next() < k.bluffFreq) {
      return bet(v, ctx, 0.5);
    }
    return { kind: 'check', amount: 0 };
  }
  const openCut = 0.5 + k.tightness * 0.18; // tighter bots open a narrower range
  if (s.score >= openCut) {
    const size = clampToStack(v, Math.max(v.bigBlind * 3, v.minRaise + v.bigBlind));
    return { kind: 'raise', amount: size };
  }
  return { kind: 'check', amount: 0 };
}

/** Facing a bet — fold/call/raise by strength, pot odds, and discipline. */
function faceBet(v: BotView, s: Strength, ctx: BotContext): Action {
  const k = ctx.skill;
  const potOdds = v.toCall / (v.pot + v.toCall);
  const target = v.self.betThisStreet + v.toCall;
  const canRaise = v.self.stack > v.toCall * 2;

  if (s.score >= 0.85) {
    return canRaise && ctx.rng.next() < 0.4 + k.aggression * 0.5
      ? raise(v, ctx, target, 0.75) : { kind: 'call', amount: target };
  }
  if (s.score >= 0.62) {
    return canRaise && ctx.rng.next() < k.aggression * 0.5
      ? raise(v, ctx, target, 0.5) : { kind: 'call', amount: target };
  }
  if (s.score >= 0.42) {
    if (potOdds < 0.45) return { kind: 'call', amount: target };
    // Wrong price: a disciplined bot folds; a station calls anyway.
    return ctx.rng.next() < k.potOddsAdherence ? { kind: 'fold', amount: 0 } : { kind: 'call', amount: target };
  }
  // Trash: occasionally bluff-raise; stations still call cheap; everyone else folds.
  if (canRaise && ctx.rng.next() < k.bluffFreq * 0.5) return raise(v, ctx, target, 0.6);
  if (potOdds < 0.35 && ctx.rng.next() > k.potOddsAdherence) return { kind: 'call', amount: target };
  return { kind: 'fold', amount: 0 };
}

/** Spew valve — low-skill bots punt: call instead of fold, stab instead of check. */
function maybeMistake(action: Action, v: BotView, ctx: BotContext): Action {
  if (ctx.rng.next() >= ctx.skill.mistakeRate) return action;
  if (action.kind === 'fold' && v.toCall > 0 && v.toCall <= v.self.stack) {
    return { kind: 'call', amount: v.self.betThisStreet + v.toCall };
  }
  if (action.kind === 'check' && v.self.stack > 0) return bet(v, ctx, 0.5);
  return action;
}

// ── sizing ───────────────────────────────────────────────────────────────────

function bet(v: BotView, ctx: BotContext, fraction: number): Action {
  return { kind: 'bet', amount: clampToStack(v, sized(v.pot, fraction, ctx)) };
}

function raise(v: BotView, ctx: BotContext, target: number, fraction: number): Action {
  const newTotal = clampToStack(v, target + Math.max(v.minRaise, sized(v.pot, fraction, ctx)));
  return newTotal > target ? { kind: 'raise', amount: newTotal } : { kind: 'call', amount: target };
}

function sized(pot: number, fraction: number, ctx: BotContext): number {
  const noise = 1 + (ctx.rng.next() - 0.5) * ctx.skill.sizingNoise; // ±sizingNoise/2
  return Math.max(2, Math.round(pot * fraction * noise));
}

function clampToStack(v: BotView, target: number): number {
  return Math.min(target, v.self.betThisStreet + v.self.stack);
}

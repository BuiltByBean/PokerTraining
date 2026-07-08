/*
 * The skill-driven bot. One decision function whose thresholds come from a
 * SkillProfile (the table's 1-10 difficulty, coloured per seat by an archetype),
 * a read on the human (exploit.ts), and table position. It still sees only a
 * BotView — no peeking at opponents' hole cards; every "read" is inferred from
 * the human's *own* history, exactly as a real reg would after playing you.
 *
 * Card sense (heuristic, not a solver, but "getting there"):
 *   - preflop opens are position-aware (tight EP, wide BTN, steal the blinds);
 *   - postflop continues respect pot odds and draw equity (rule of 2/4);
 *   - the exploit layer nudges every threshold toward attacking the human.
 */

import { postflopStrength, preflopStrength, type Strength } from './strength';
import { drawOuts } from '../analysis/draws';
import { outsToEquity, requiredEquity } from '../engine/odds';
import { exploitFor, type Exploit } from './exploit';
import type { Action, BotView, Position } from '../engine/types';
import type { Bot, BotContext } from './types';

export const balancedBot: Bot = (ctx: BotContext): Action => {
  const v = ctx.view;
  const ex = exploitFor(ctx);
  const s: Strength = v.street === 'preflop'
    ? preflopStrength(v.self.hole)
    : postflopStrength(v.self.hole, v.board);
  const base = v.street === 'preflop'
    ? preflop(v, s, ctx, ex)
    : v.toCall === 0 ? postflopOpen(v, s, ctx, ex) : postflopFace(v, s, ctx, ex);
  return maybeMistake(base, v, ctx);
};

// ── preflop ──────────────────────────────────────────────────────────────────

function preflop(v: BotView, s: Strength, ctx: BotContext, ex: Exploit): Action {
  const currentBet = v.self.betThisStreet + v.toCall;
  const facingRaise = currentBet > v.bigBlind;
  return facingRaise ? preflopVsRaise(v, s, ctx, ex) : preflopOpen(v, s, ctx, ex);
}

/** Unopened pot: raise a position-based range, occasionally limp, else fold/check. */
function preflopOpen(v: BotView, s: Strength, ctx: BotContext, ex: Exploit): Action {
  const cut = openCutFor(v.position, ctx.skill.tightness) - ex.stealCut;
  if (s.score >= cut) return raiseTo(v, Math.round(v.bigBlind * (2.5 + ctx.skill.aggression)));
  const loose = 1 - ctx.skill.tightness;
  if (v.toCall > 0 && s.score >= cut - 0.12 && ctx.rng.next() < loose * 0.3) {
    return { kind: 'call', amount: v.self.betThisStreet + v.toCall }; // speculative limp
  }
  return v.toCall === 0 ? { kind: 'check', amount: 0 } : { kind: 'fold', amount: 0 };
}

/** Facing a raise: 3-bet premiums, mix in light 3-bets, flat by price, else fold. */
function preflopVsRaise(v: BotView, s: Strength, ctx: BotContext, ex: Exploit): Action {
  const k = ctx.skill;
  const target = v.self.betThisStreet + v.toCall;
  const price = requiredEquity(v.toCall, v.pot);
  const canReraise = v.self.stack > v.toCall;
  const threeBetTo = Math.round(target * 2.6);

  if (s.score >= 0.85 && canReraise && ctx.rng.next() < 0.55 + k.aggression * 0.4) return raiseTo(v, threeBetTo);
  // Light 3-bet: playable hands, more from aggressive seats and vs a folder.
  if (canReraise && s.score >= 0.34 && ctx.rng.next() < k.aggression * 0.16 + ex.threeBet) return raiseTo(v, threeBetTo);
  // Flat by price, loose seats calling wider (peel scales down with tightness);
  // the blinds defend a touch wider since they already have chips in the pot.
  const inBlinds = v.position === 'SB' || v.position === 'BB';
  const peel = 0.42 - k.tightness * 0.14 + ex.callCut + (inBlinds ? 0.07 : 0);
  if (s.score >= 0.62 && price < 0.52) return { kind: 'call', amount: target };
  if (s.score >= 0.5 && price < peel) return { kind: 'call', amount: target };
  if (s.score >= 0.42 && price < peel - 0.12) return { kind: 'call', amount: target };
  return { kind: 'fold', amount: 0 };
}

// ── postflop ───────────────────────────────────────────────────────────────

/** No bet to us: value-bet, stab/barrel as the read allows, else check. */
function postflopOpen(v: BotView, s: Strength, ctx: BotContext, ex: Exploit): Action {
  const k = ctx.skill;
  const valueCut = 0.62 - k.aggression * 0.15 - ex.valueCut;
  if (s.score >= valueCut) return bet(v, ctx, 0.5 + k.aggression * 0.25);
  const late = v.street === 'turn' || v.street === 'river';
  const stab = k.bluffFreq * ex.bluffScale + (late ? ex.barrelBonus : 0);
  if (s.score <= 0.42 && (late || k.aggression > 0.7 || ex.bluffScale > 1.2) && ctx.rng.next() < stab) {
    return bet(v, ctx, 0.5);
  }
  return { kind: 'check', amount: 0 };
}

/** Facing a bet: raise value, continue on price/draws, exploit-tune the marginal spots. */
function postflopFace(v: BotView, s: Strength, ctx: BotContext, ex: Exploit): Action {
  const k = ctx.skill;
  const target = v.self.betThisStreet + v.toCall;
  const price = requiredEquity(v.toCall, v.pot);
  const canRaise = v.self.stack > v.toCall * 2;

  if (s.score >= 0.82) {
    return canRaise && ctx.rng.next() < 0.4 + k.aggression * 0.5 ? raise(v, ctx, target, 0.7) : { kind: 'call', amount: target };
  }
  if (s.score >= 0.6) {
    return canRaise && ctx.rng.next() < k.aggression * 0.4 ? raise(v, ctx, target, 0.5) : { kind: 'call', amount: target };
  }
  const draw = drawContinue(v, ctx, target, price);
  if (draw) return draw;
  // A decent pair calls a fair price; a marginal one (weak/bottom pair) needs a
  // good price, and tighter/higher-skill seats fold it more readily.
  if (s.score >= 0.5) {
    if (price < 0.42 + ex.callCut - ex.foldBias) return { kind: 'call', amount: target };
    return ctx.rng.next() < k.potOddsAdherence ? { kind: 'fold', amount: 0 } : { kind: 'call', amount: target };
  }
  if (s.score >= 0.4) {
    const peel = 0.3 - k.tightness * 0.14 + ex.callCut - ex.foldBias;
    if (price < peel) return { kind: 'call', amount: target };
    return ctx.rng.next() < k.potOddsAdherence ? { kind: 'fold', amount: 0 } : { kind: 'call', amount: target };
  }
  if (canRaise && ctx.rng.next() < k.bluffFreq * ex.bluffScale * 0.5) return raise(v, ctx, target, 0.6);
  if (price < 0.22 + ex.callCut && ctx.rng.next() > k.potOddsAdherence) return { kind: 'call', amount: target };
  return { kind: 'fold', amount: 0 };
}

/** Unmade hand with a draw: continue when the price (or lack of discipline) says so. */
function drawContinue(v: BotView, ctx: BotContext, target: number, price: number): Action | undefined {
  if (v.street === 'river') return undefined; // nothing left to draw to
  const outs = drawOuts([...v.self.hole, ...v.board]);
  if (outs === 0) return undefined;
  const equity = outsToEquity(outs, 1);
  const priced = equity >= price;
  if (!priced && ctx.rng.next() <= ctx.skill.drawDiscipline) return { kind: 'fold', amount: 0 };
  if (outs >= 8 && v.self.stack > v.toCall * 2 && ctx.rng.next() < ctx.skill.aggression * 0.35) {
    return raise(v, ctx, target, 0.6); // semi-bluff a big draw
  }
  return { kind: 'call', amount: target };
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

const POS_ADJ: Record<Position, number> = { EP: 0.12, MP: 0.06, CO: -0.02, BTN: -0.12, SB: -0.06, BB: -0.04 };

/** Position-aware opening threshold: tight up front, wide on the button. The
 *  strong tightness coefficient is what spreads a maniac's range from a rock's. */
export function openCutFor(pos: Position | undefined, tightness: number): number {
  return 0.3 + tightness * 0.5 + POS_ADJ[pos ?? 'MP'];
}

/** Raise (or bet, if unopened) to an absolute total, respecting min-raise + stack. */
function raiseTo(v: BotView, totalTo: number): Action {
  const target = v.self.betThisStreet + v.toCall;
  const floorAmt = v.toCall > 0 ? target + v.minRaise : v.self.betThisStreet + Math.max(v.bigBlind, v.minRaise);
  const amount = clampToStack(v, Math.max(totalTo, floorAmt));
  if (amount <= target) return { kind: 'call', amount: target };
  return { kind: v.toCall > 0 ? 'raise' : 'bet', amount };
}

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

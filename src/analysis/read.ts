/*
 * A read on one player, built from stored hand history — the raw material the
 * bots use to exploit the human. Unlike stats.ts (which grades the hero for the
 * dashboard), this exposes the *exploitable tendencies* a thinking opponent
 * would target: how often they fold to a bet (bluff them), whether they call
 * down too light (value them, never bluff), how passive/aggressive they are,
 * and how they react to steals and 3-bets.
 *
 * Every rate stays `undefined` until it clears a modest sample, and a single
 * `confidence` (0-1) tells the exploit layer how much to trust the whole read.
 * Showdown reach/win are only computable for the hero (we store the hero's net,
 * not each player's), so those fields populate only when `playerId` is the human.
 */

import type { HandRecord } from './record';
import type { DecisionSnapshot } from './recorder';

export interface PlayerRead {
  readonly playerId: string;
  readonly hands: number;
  /** 0-1 trust in this read, ramping with sample size. */
  readonly confidence: number;
  /** Voluntarily-played-hands rate (looseness) preflop. */
  readonly vpip: number | undefined;
  /** Fold rate when facing any postflop bet — the headline bluff target. */
  readonly foldToBet: number | undefined;
  /** Fold rate facing a turn bet (double-barrel target). */
  readonly foldTurn: number | undefined;
  /** Fold rate facing a river bet (triple-barrel target). */
  readonly foldRiver: number | undefined;
  /** Bet+raise share of postflop chip-in actions (0 = passive, 1 = aggressive). */
  readonly aggression: number | undefined;
  /** Went-to-showdown rate (hero only). */
  readonly wtsd: number | undefined;
  /** Won-at-showdown rate (hero only). */
  readonly wssd: number | undefined;
  /** Fold rate in the blinds facing a raise (blind-steal target). */
  readonly foldToSteal: number | undefined;
  /** Fold rate after opening, facing a re-raise (3-bet-bluff target). */
  readonly foldToThreeBet: number | undefined;
}

const MIN_PRE = 15;
const MIN_FACE = 10;
const MIN_STREET = 6;
const MIN_SD = 8;
const MIN_STEAL = 8;
const MIN_3BET = 6;
const MIN_POST = 12;
const FULL_CONF_AT = 60;

interface Counters {
  hands: number; vpip: number;
  faceBet: number; foldBet: number;
  faceTurn: number; foldTurnC: number; faceRiver: number; foldRiverC: number;
  aggr: number; callN: number;
  sawFlop: number; sd: number; sdWin: number;
  stealFace: number; stealFold: number;
  threeFace: number; threeFold: number;
}

export function buildPlayerRead(records: readonly HandRecord[], playerId: string): PlayerRead {
  const c = newCounters();
  for (const r of records) accumulate(c, r, playerId);

  const rate = (h: number, o: number, min: number) => (o >= min ? h / o : undefined);
  return {
    playerId,
    hands: c.hands,
    confidence: clamp((c.hands - MIN_PRE) / (FULL_CONF_AT - MIN_PRE), 0, 1),
    vpip: rate(c.vpip, c.hands, MIN_PRE),
    foldToBet: rate(c.foldBet, c.faceBet, MIN_FACE),
    foldTurn: rate(c.foldTurnC, c.faceTurn, MIN_STREET),
    foldRiver: rate(c.foldRiverC, c.faceRiver, MIN_STREET),
    aggression: c.aggr + c.callN >= MIN_POST ? c.aggr / (c.aggr + c.callN) : undefined,
    wtsd: rate(c.sd, c.sawFlop, MIN_SD),
    wssd: rate(c.sdWin, c.sd, MIN_SD),
    foldToSteal: rate(c.stealFold, c.stealFace, MIN_STEAL),
    foldToThreeBet: rate(c.threeFold, c.threeFace, MIN_3BET),
  };
}

// ── accumulation ──────────────────────────────────────────────────────────

function accumulate(c: Counters, r: HandRecord, id: string): void {
  if ((r.holeCards[id]?.length ?? 0) !== 2) return; // not dealt in
  c.hands += 1;
  const mine = r.snapshots.filter(s => s.actorId === id);
  const pre = mine.filter(s => s.street === 'preflop');
  accPreflop(c, r, pre);
  accPostflop(c, mine.filter(isPostflop));
  if (id === r.config.humanId) accShowdown(c, r, pre);
}

function accPreflop(c: Counters, r: HandRecord, pre: readonly DecisionSnapshot[]): void {
  if (pre.some(isVoluntary)) c.vpip += 1;

  const inBlinds = pre.some(s => s.position === 'SB' || s.position === 'BB');
  const facedRaise = pre.some(s => s.currentBet > r.config.bigBlind);
  if (inBlinds && facedRaise) {
    c.stealFace += 1;
    if (last(pre)?.action.kind === 'fold') c.stealFold += 1;
  }

  const raiseIdx = pre.findIndex(isRaise);
  if (raiseIdx >= 0) {
    const after = pre.slice(raiseIdx + 1);
    if (after.some(s => s.betFaced > 0)) {
      c.threeFace += 1;
      if (after.some(s => s.action.kind === 'fold' && s.betFaced > 0)) c.threeFold += 1;
    }
  }
}

function accPostflop(c: Counters, post: readonly DecisionSnapshot[]): void {
  for (const s of post) {
    if (isAggressive(s)) c.aggr += 1;
    else if (s.action.kind === 'call') c.callN += 1;
    if (s.betFaced <= 0) continue;
    c.faceBet += 1;
    const folded = s.action.kind === 'fold';
    if (folded) c.foldBet += 1;
    if (s.street === 'turn') { c.faceTurn += 1; if (folded) c.foldTurnC += 1; }
    if (s.street === 'river') { c.faceRiver += 1; if (folded) c.foldRiverC += 1; }
  }
}

function accShowdown(c: Counters, r: HandRecord, pre: readonly DecisionSnapshot[]): void {
  const foldedPre = pre.some(s => s.action.kind === 'fold');
  if (!foldedPre && r.board.length >= 3) c.sawFlop += 1;
  if (r.outcome.heroWentToShowdown) {
    c.sd += 1;
    if (r.outcome.heroNet > 0) c.sdWin += 1;
  }
}

// ── predicates / helpers ────────────────────────────────────────────────────

function isPostflop(s: DecisionSnapshot): boolean {
  return s.street === 'flop' || s.street === 'turn' || s.street === 'river';
}

function isVoluntary(s: DecisionSnapshot): boolean {
  const k = s.action.kind;
  return k === 'call' || k === 'bet' || k === 'raise' || k === 'allin';
}

function isRaise(s: DecisionSnapshot): boolean {
  return s.action.kind === 'bet' || s.action.kind === 'raise'
    || (s.action.kind === 'allin' && s.amountPutIn > s.betFaced);
}

function isAggressive(s: DecisionSnapshot): boolean {
  return s.action.kind === 'bet' || s.action.kind === 'raise' || s.action.kind === 'allin';
}

function last<T>(arr: readonly T[]): T | undefined {
  return arr[arr.length - 1];
}

function newCounters(): Counters {
  return {
    hands: 0, vpip: 0, faceBet: 0, foldBet: 0, faceTurn: 0, foldTurnC: 0,
    faceRiver: 0, foldRiverC: 0, aggr: 0, callN: 0, sawFlop: 0, sd: 0, sdWin: 0,
    stealFace: 0, stealFold: 0, threeFace: 0, threeFold: 0,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

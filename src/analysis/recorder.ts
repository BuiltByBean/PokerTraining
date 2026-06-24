/*
 * The recorder snapshots the table state *immediately before each action* so
 * the analyzer can later reconstruct what every decision actually faced — pot
 * size, price to call, position, who was the aggressor, which opponents were
 * still live. It reads only what `getState()` already exposes, so the engine
 * stays pure and unaware of analysis. (Putting this inside the engine would
 * drag equity/RNG into the hot path and break the deterministic replay.)
 *
 * Capture is per-actor (every player's every action); the analyzer later filters
 * to the human's decisions. Folded opponents are excluded from `liveOpponentIds`
 * so equity is computed against only the players actually still in the hand.
 */

import { spr as sprOf } from '../engine/odds';
import { positionOf, isInPosition, type Position } from '../engine/positions';
import type { Action, Card, GameState, Player, Street } from '../engine/types';

export interface DecisionSnapshot {
  readonly handNumber: number;
  readonly actorId: string;
  readonly street: Street;
  readonly action: Action;
  /** Chips in the middle before this action. */
  readonly potBefore: number;
  /** Price to call before acting (0 if checking is allowed). */
  readonly betFaced: number;
  /** Chips this action actually commits. */
  readonly amountPutIn: number;
  readonly position: Position | undefined;
  readonly inPosition: boolean;
  /** Chips behind the actor before acting. */
  readonly effectiveStack: number;
  readonly spr: number;
  readonly currentBet: number;
  /** Contenders still in the hand (folded/sitting-out excluded), incl. the actor. */
  readonly numActivePlayers: number;
  readonly aggressorId: string | undefined;
  /** Non-folded opponents at this moment — who equity is computed against. */
  readonly liveOpponentIds: readonly string[];
  readonly board: readonly Card[];
}

export interface Recorder {
  capture(state: GameState, playerId: string, action: Action): void;
  snapshots(): readonly DecisionSnapshot[];
}

export function newRecorder(): Recorder {
  const out: DecisionSnapshot[] = [];
  return {
    capture(state, playerId, action) {
      const snap = snapshot(state, playerId, action);
      if (snap) out.push(snap);
    },
    snapshots: () => out,
  };
}

// ── internals ───────────────────────────────────────────────────────────────

function snapshot(state: GameState, playerId: string, action: Action): DecisionSnapshot | undefined {
  const actor = state.players.find(p => p.id === playerId);
  if (!actor) return undefined;

  const potBefore = state.players.reduce((s, p) => s + p.totalCommitted, 0);
  const betFaced = Math.max(0, state.currentBet - actor.betThisStreet);
  const effectiveStack = actor.stack;
  const contenders = state.players.filter(isContender);

  return {
    handNumber: state.handNumber,
    actorId: playerId,
    street: state.street,
    action,
    potBefore,
    betFaced,
    amountPutIn: chipsCommitted(actor, action, betFaced),
    position: positionOf(state.players, state.dealerIndex, playerId),
    inPosition: isInPosition(state.players, state.dealerIndex, playerId, isContender),
    effectiveStack,
    spr: sprOf(effectiveStack, potBefore),
    currentBet: state.currentBet,
    numActivePlayers: contenders.length,
    aggressorId: streetAggressor(state),
    liveOpponentIds: contenders.filter(p => p.id !== playerId).map(p => p.id),
    board: state.board,
  };
}

/** Still in the hand: dealt in and not folded. */
function isContender(p: Player): boolean {
  return p.status === 'active' || p.status === 'allin';
}

function chipsCommitted(actor: Player, action: Action, betFaced: number): number {
  switch (action.kind) {
    case 'fold':
    case 'check': return 0;
    case 'call':  return Math.min(betFaced, actor.stack);
    case 'allin': return actor.stack;
    case 'bet':
    case 'raise': return Math.min(action.amount - actor.betThisStreet, actor.stack);
  }
}

/** Last player to bet/raise/all-in on the current street, if any. */
function streetAggressor(state: GameState): string | undefined {
  let aggressor: string | undefined;
  for (const entry of state.log) {
    if (entry.street !== state.street) continue;
    if (entry.action.kind === 'bet' || entry.action.kind === 'raise' || entry.action.kind === 'allin') {
      aggressor = entry.playerId;
    }
  }
  return aggressor;
}

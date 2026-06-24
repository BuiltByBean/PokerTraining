/*
 * The immutable, JSON-serializable record of one played hand — the unit of
 * storage and the input to every analysis. Built once at hand end from data
 * the engine already exposes, then never mutated. Because we know every
 * player's hole cards, a record is a complete, replayable description of the
 * hand.
 */

import type { ShowdownResult } from '../engine/game';
import type { Card, GameState, Player } from '../engine/types';
import type { DecisionSnapshot } from './recorder';

export const HAND_RECORD_VERSION = 1;

export interface HandConfig {
  readonly playerCount: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly difficulty: number;
  readonly dealerIndex: number;
  readonly humanId: string;
  /** id → display name, for the dashboard/replay without re-deriving personas. */
  readonly names: Readonly<Record<string, string>>;
}

export interface HandOutcome {
  /** Main-pot winners (the headline result). */
  readonly winners: readonly string[];
  readonly wentToShowdown: boolean;
  readonly heroWentToShowdown: boolean;
  readonly heroNet: number;
  readonly heroNetBb: number;
  /** How a hero win was earned: 'blue' = at showdown, 'red' = opponents folded. */
  readonly line: 'red' | 'blue' | 'none';
}

export interface HandRecord {
  readonly version: number;
  readonly id: string;
  readonly playedAt: number;
  readonly config: HandConfig;
  /** Every player's hole cards (we know them all). */
  readonly holeCards: Readonly<Record<string, readonly Card[]>>;
  readonly board: readonly Card[];
  readonly snapshots: readonly DecisionSnapshot[];
  readonly outcome: HandOutcome;
}

export interface BuildHandRecordArgs {
  readonly id: string;
  readonly playedAt: number;
  readonly config: HandConfig;
  /** Engine state after the hand is complete. */
  readonly finalState: GameState;
  readonly result: ShowdownResult;
  readonly snapshots: readonly DecisionSnapshot[];
  /** Stacks at the START of the hand, to compute net. */
  readonly startStacks: Readonly<Record<string, number>>;
}

export function buildHandRecord(args: BuildHandRecordArgs): HandRecord {
  const { config, finalState, result } = args;
  const hero = finalState.players.find(p => p.id === config.humanId);

  const holeCards: Record<string, readonly Card[]> = {};
  for (const p of finalState.players) holeCards[p.id] = p.hole;

  // A real showdown happened iff any pot was awarded by hand strength (eval set);
  // a fold-around leaves eval undefined.
  const wentToShowdown = result.awards.some(a => a.eval !== undefined);
  const heroWentToShowdown = wentToShowdown && hero?.status !== 'folded';

  const startStack = args.startStacks[config.humanId] ?? 0;
  const endStack = result.finalStacks.get(config.humanId) ?? startStack;
  const heroNet = endStack - startStack;

  return {
    version: HAND_RECORD_VERSION,
    id: args.id,
    playedAt: args.playedAt,
    config,
    holeCards,
    board: finalState.board,
    snapshots: args.snapshots,
    outcome: {
      winners: result.awards[0]?.winners ?? [],
      wentToShowdown,
      heroWentToShowdown: heroWentToShowdown ?? false,
      heroNet,
      heroNetBb: heroNet / config.bigBlind,
      line: lineFor(heroNet, wentToShowdown),
    },
  };
}

function lineFor(heroNet: number, wentToShowdown: boolean): HandOutcome['line'] {
  if (heroNet <= 0) return 'none';
  return wentToShowdown ? 'blue' : 'red';
}

/** Convenience: contenders (non-folded) at hand end, by id. */
export function survivors(finalState: GameState): Player[] {
  return finalState.players.filter(p => p.status === 'active' || p.status === 'allin');
}

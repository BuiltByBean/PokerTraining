/*
 * Engine-wide types. Kept in one file so the whole engine speaks the same
 * vocabulary without circular imports. Nothing here imports from anywhere
 * else inside the engine.
 */

export type Suit = 'c' | 'd' | 'h' | 's';

/**
 * Rank as integer for cheap comparison. 14 = Ace; the Ace also plays as 1 in
 * the wheel (A-2-3-4-5), which the evaluator handles explicitly so we never
 * need a second representation.
 */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';

export type PlayerStatus = 'active' | 'folded' | 'allin' | 'sittingout';

export interface Player {
  readonly id: string;
  readonly name: string;
  /** True for the human; false for bots. The engine treats both the same. */
  readonly isHuman: boolean;
  stack: number;
  /** Empty until cards are dealt; cleared at hand end. */
  hole: readonly Card[];
  status: PlayerStatus;
  /** Total chips committed by this player THIS street (resets each street). */
  betThisStreet: number;
  /** Total chips this player has committed to the hand across all streets. */
  totalCommitted: number;
}

export type ActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export interface Action {
  readonly kind: ActionKind;
  /** Total bet amount FOR THE STREET after this action — not the delta.
   *  For check/fold, this is unused (0). */
  readonly amount: number;
}

export interface PotShare {
  readonly amount: number;
  /** Player ids eligible for this pot (i.e. matched at least its level). */
  readonly eligible: readonly string[];
}

export interface GameState {
  readonly handNumber: number;
  readonly bigBlind: number;
  readonly smallBlind: number;
  readonly players: readonly Player[];
  /** Index into players[]; rotates one seat each hand. */
  readonly dealerIndex: number;
  readonly board: readonly Card[];
  readonly street: Street;
  /** Current bet to call this street (the highest betThisStreet). */
  readonly currentBet: number;
  /** Min increment for the next raise, per NL rules. */
  readonly minRaise: number;
  /** Whose turn is it? Undefined while between hands / at showdown. */
  readonly toAct: string | undefined;
  /** All pots resolved at hand end. Empty during play. */
  readonly pots: readonly PotShare[];
  /** Per-hand action log; UI uses this for speech bubbles + replays. */
  readonly log: readonly LogEntry[];
}

export interface LogEntry {
  readonly playerId: string;
  readonly action: Action;
  readonly street: Street;
}

/**
 * A "view" of the game from a single player's perspective. Bots only ever
 * receive this — never the raw GameState — so they physically can't peek at
 * opponents' hole cards. The shape is the same as GameState minus the cards
 * we'd hide at a real table.
 */
export interface BotView {
  readonly self: Player;
  readonly opponents: readonly Omit<Player, 'hole'>[];
  readonly board: readonly Card[];
  readonly street: Street;
  readonly pot: number;
  readonly toCall: number;
  readonly minRaise: number;
  readonly bigBlind: number;
}

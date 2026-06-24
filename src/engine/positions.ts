/*
 * Seat → position math, shared by the table UI (D / SB / BB badges) and the
 * analysis recorder (position context per decision). Pure, so it can be unit
 * tested across heads-up and 3-9 handed without spinning up a game.
 *
 * "Dealt in" = a player who was given cards this hand (status !== 'sittingout').
 * Blinds are posted at the start of the hand, so badges reflect dealt-in seats
 * and stay put even after a player later folds.
 */

import type { Player } from './types';

export type Position = 'BTN' | 'SB' | 'BB' | 'EP' | 'MP' | 'CO';

export interface BlindSeats {
  readonly dealer: number;
  readonly sb: number;
  readonly bb: number;
}

/** Seat indices of the dealer, small blind, and big blind. */
export function blindSeats(players: readonly Player[], dealerIndex: number): BlindSeats {
  const ring = dealtInRing(players, dealerIndex);
  if (ring.length < 2) {
    return { dealer: dealerIndex, sb: dealerIndex, bb: dealerIndex };
  }
  // Heads-up: the button is the small blind; the other seat is the big blind.
  if (ring.length === 2) {
    return { dealer: dealerIndex, sb: dealerIndex, bb: ring[1] as number };
  }
  return { dealer: dealerIndex, sb: ring[1] as number, bb: ring[2] as number };
}

/**
 * Position label for every seat, indexed by seat. Seats not dealt in are
 * `undefined`. The ring runs BTN, SB, BB, then UTG…CO back around to the button.
 */
export function positionsBySeat(players: readonly Player[], dealerIndex: number): (Position | undefined)[] {
  const out: (Position | undefined)[] = players.map(() => undefined);
  const ring = dealtInRing(players, dealerIndex);
  if (ring.length === 0) return out;
  if (ring.length === 2) {
    out[ring[0] as number] = 'BTN';
    out[ring[1] as number] = 'BB';
    return out;
  }
  out[ring[0] as number] = 'BTN';
  out[ring[1] as number] = 'SB';
  out[ring[2] as number] = 'BB';
  // Seats after the BB up to (but not including) the button: UTG…CO.
  const middle = ring.slice(3);
  middle.forEach((seat, j) => {
    out[seat] = middlePosition(j, middle.length);
  });
  return out;
}

/** Position label for one player, or undefined if not dealt in. */
export function positionOf(players: readonly Player[], dealerIndex: number, playerId: string): Position | undefined {
  const seat = players.findIndex(p => p.id === playerId);
  if (seat < 0) return undefined;
  return positionsBySeat(players, dealerIndex)[seat];
}

/**
 * Is `playerId` in position — i.e. last to act postflop among players still in
 * the hand? Postflop action runs clockwise from the small blind, so the last
 * live player in that order has position on everyone.
 */
export function isInPosition(
  players: readonly Player[],
  dealerIndex: number,
  playerId: string,
  isLive: (p: Player) => boolean,
): boolean {
  const order = dealtInRing(players, dealerIndex)
    .map(seat => players[seat] as Player)
    .filter(isLive);
  // Postflop order starts at SB (one past the dealer), so rotate the BTN-first
  // ring by one. The last element acts last → in position.
  const postflop = order.length > 1 ? [...order.slice(1), order[0] as Player] : order;
  const last = postflop[postflop.length - 1];
  return last?.id === playerId;
}

// ── internals ───────────────────────────────────────────────────────────────

/** Dealt-in seat indices, clockwise from the dealer (dealer first). */
function dealtInRing(players: readonly Player[], dealerIndex: number): number[] {
  const n = players.length;
  const ring: number[] = [];
  for (let i = 0; i < n; i++) {
    const seat = (dealerIndex + i) % n;
    const p = players[seat];
    if (p && p.status !== 'sittingout') ring.push(seat);
  }
  return ring;
}

/** Bucket the non-blind, non-button seats into EP / MP / CO by lateness. */
function middlePosition(index: number, count: number): Position {
  if (index === count - 1) return 'CO';
  return index < count / 2 ? 'EP' : 'MP';
}

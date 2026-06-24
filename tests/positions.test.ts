import { describe, expect, it } from 'vitest';
import { blindSeats, positionsBySeat, isInPosition } from '../src/engine/positions';
import type { Player } from '../src/engine/types';

function seats(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `P${i}`, name: `P${i}`, isHuman: i === 0, stack: 1000, hole: [], status: 'active' as const,
    betThisStreet: 0, totalCommitted: 0,
  }));
}

describe('blindSeats', () => {
  it('heads-up: the button is the small blind', () => {
    const b = blindSeats(seats(2), 0);
    expect(b.dealer).toBe(0);
    expect(b.sb).toBe(0); // dealer posts SB heads-up
    expect(b.bb).toBe(1);
  });

  it('3-handed: SB left of button, BB next', () => {
    const b = blindSeats(seats(3), 0);
    expect(b.dealer).toBe(0);
    expect(b.sb).toBe(1);
    expect(b.bb).toBe(2);
  });

  it('wraps around when the dealer is the last seat', () => {
    const b = blindSeats(seats(6), 5);
    expect(b.dealer).toBe(5);
    expect(b.sb).toBe(0);
    expect(b.bb).toBe(1);
  });

  it('skips sitting-out players', () => {
    const s = seats(4);
    (s[1] as Player).status = 'sittingout';
    const b = blindSeats(s, 0);
    expect(b.sb).toBe(2); // P1 sat out, so SB is P2
    expect(b.bb).toBe(3);
  });
});

describe('positionsBySeat', () => {
  it('labels the standard 6-max ring', () => {
    const pos = positionsBySeat(seats(6), 0);
    expect(pos[0]).toBe('BTN');
    expect(pos[1]).toBe('SB');
    expect(pos[2]).toBe('BB');
    expect(pos[5]).toBe('CO'); // seat right before the button
  });

  it('heads-up is just BTN and BB', () => {
    const pos = positionsBySeat(seats(2), 0);
    expect(pos[0]).toBe('BTN');
    expect(pos[1]).toBe('BB');
  });
});

describe('isInPosition', () => {
  it('the button has position on the blinds', () => {
    const players = seats(3);
    const live = () => true;
    expect(isInPosition(players, 0, 'P0', live)).toBe(true); // BTN acts last postflop
    expect(isInPosition(players, 0, 'P1', live)).toBe(false); // SB acts first
  });
});

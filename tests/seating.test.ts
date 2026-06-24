import { describe, expect, it } from 'vitest';
import { seatPositions, seatScale } from '../src/ui/seating';

describe('seatPositions', () => {
  it('returns one position per seat for 2-9 players', () => {
    for (let n = 2; n <= 9; n++) {
      expect(seatPositions(n)).toHaveLength(n);
    }
  });

  it('pins the hero (index 0) to bottom-center', () => {
    for (let n = 2; n <= 9; n++) {
      const hero = seatPositions(n)[0];
      expect(hero?.xPct).toBeCloseTo(50, 1);
      expect(hero?.yPct).toBeGreaterThan(85); // near the bottom
    }
  });

  it('keeps every seat within the felt bounds', () => {
    for (let n = 2; n <= 9; n++) {
      for (const p of seatPositions(n)) {
        expect(p.xPct).toBeGreaterThanOrEqual(0);
        expect(p.xPct).toBeLessThanOrEqual(100);
        expect(p.yPct).toBeGreaterThanOrEqual(0);
        expect(p.yPct).toBeLessThanOrEqual(100);
      }
    }
  });

  it('never overlaps two seats', () => {
    for (let n = 2; n <= 9; n++) {
      const seats = seatPositions(n);
      const keys = new Set(seats.map(s => `${s.xPct},${s.yPct}`));
      expect(keys.size).toBe(n);
    }
  });

  it('heads-up puts the opponent across the top', () => {
    const opp = seatPositions(2)[1];
    expect(opp?.xPct).toBeCloseTo(50, 1);
    expect(opp?.yPct).toBeLessThan(15);
  });
});

describe('seatScale', () => {
  it('is full size up to 6 and shrinks past it', () => {
    expect(seatScale(6)).toBe(1);
    expect(seatScale(9)).toBeLessThan(seatScale(7));
    expect(seatScale(9)).toBeGreaterThan(0.5);
  });
});

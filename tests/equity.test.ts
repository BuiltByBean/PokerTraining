import { describe, expect, it } from 'vitest';
import { cards } from '../src/engine/deck';
import { equity, equityVsRange } from '../src/engine/equity';
import { mulberry32 } from '../src/engine/rng';
import type { Card } from '../src/engine/types';

/** Parse a two-card string into a tuple for villainRange. */
function combo(s: string): readonly [Card, Card] {
  const [a, b] = cards(s);
  return [a as Card, b as Card];
}

function heroEquity(hole: string, villain: string, board: string) {
  const result = equity({
    players: [
      { id: 'hero', hole: cards(hole) },
      { id: 'villain', hole: cards(villain) },
    ],
    board: cards(board),
    rng: mulberry32(1),
  });
  return result;
}

describe('equity — exactness by street', () => {
  it('river is exact (no cards to come)', () => {
    // Hero has a set of kings, villain a pair of aces; full board, hero wins.
    const r = heroEquity('Kh Kd', 'Ac Ad', 'Ks 7c 2d 9h 3s');
    expect(r.method).toBe('exact');
    expect(r.equities[0]?.equity).toBe(1);
    expect(r.equities[1]?.equity).toBe(0);
  });

  it('turn enumerates exactly (1 card to come)', () => {
    const r = heroEquity('As Ks', 'Qh Qd', 'Ah 7s 2c 5d');
    expect(r.method).toBe('exact');
    // Hero has top pair top kicker; villain needs running help / a queen.
    expect(r.equities[0]?.equity).toBeGreaterThan(0.8);
  });

  it('flop enumerates exactly (2 cards to come)', () => {
    const r = heroEquity('As Ks', 'Qh Qd', 'Ah 7s 2c');
    expect(r.method).toBe('exact');
    expect(r.equities[0]?.equity).toBeGreaterThan(0.7);
  });

  it('preflop uses Monte Carlo', () => {
    const r = heroEquity('As Ad', 'Kc Kd', '');
    expect(r.method).toBe('monte-carlo');
  });
});

describe('equity — textbook matchups', () => {
  it('AA vs KK preflop ≈ 82% / 18%', () => {
    const r = equity({
      players: [
        { id: 'hero', hole: cards('As Ah') },
        { id: 'villain', hole: cards('Kc Kd') },
      ],
      board: [],
      rng: mulberry32(12345),
      maxSamples: 8000,
    });
    expect(r.equities[0]?.equity).toBeGreaterThan(0.78);
    expect(r.equities[0]?.equity).toBeLessThan(0.86);
  });

  it('set over set is crushing', () => {
    // Hero set of 8s, villain set of 5s, on a dry board.
    const r = heroEquity('8h 8d', '5c 5d', '8s 5h Kc');
    expect(r.equities[0]?.equity).toBeGreaterThan(0.9);
  });

  it('coin-flip pair vs two overcards is roughly even', () => {
    const r = equity({
      players: [
        { id: 'hero', hole: cards('Ts Td') },
        { id: 'villain', hole: cards('Ah Ks') },
      ],
      board: [],
      rng: mulberry32(999),
      maxSamples: 8000,
    });
    const e = r.equities[0]?.equity ?? 0;
    expect(e).toBeGreaterThan(0.45);
    expect(e).toBeLessThan(0.6);
  });
});

describe('equity — ties', () => {
  it('split pot: identical playing the board', () => {
    // Both players' hole cards are dead; the board is a straight both play.
    const r = heroEquity('2c 3d', '4h 6s', 'Ts Js Qs Ks As');
    // Royal-ish broadway straight on board → both chop.
    expect(r.equities[0]?.tie).toBe(1);
    expect(r.equities[0]?.equity).toBeCloseTo(0.5, 5);
    expect(r.equities[1]?.equity).toBeCloseTo(0.5, 5);
  });
});

describe('equity — 7-high ahead of a bluff (the "84%" sanity check)', () => {
  it('7-high is a big favourite over a weaker no-draw hand on the turn', () => {
    // Hero 76, villain 53 on a dry K Q J 2 board (no straight/flush draws):
    // villain can only catch up by pairing the 5 or 3 (~6 outs), so hero is a
    // heavy favourite. This is the "you folded the best hand to a bluff" spot.
    const r = heroEquity('7c 6h', '5d 3c', 'Ks Qh Jd 2s');
    expect(r.method).toBe('exact');
    expect(r.equities[0]?.equity).toBeGreaterThan(0.8);
  });

  it('but the same 7-high is crushed by top pair', () => {
    const r = heroEquity('7c 6h', 'Qd 9h', 'Ks Qh Jd 2s');
    expect(r.equities[0]?.equity).toBeLessThan(0.15);
  });

  it('8-high on the flop is well ahead of a worse bluff (two cards to come)', () => {
    // Hero 86, villain 72 (both whiff A-K-J): villain only ~6 outs over two
    // cards, so hero is the hindsight favourite even though folding is correct.
    const r = heroEquity('8h 6h', '7d 2c', 'Jd Ac Ks');
    expect(r.method).toBe('exact'); // flop → enumerate turn+river
    expect(r.equities[0]?.equity).toBeGreaterThan(0.6);
  });
});

describe('equity — multiway', () => {
  it('three contenders equities sum to 1', () => {
    const r = equity({
      players: [
        { id: 'a', hole: cards('As Ks') },
        { id: 'b', hole: cards('Qh Qd') },
        { id: 'c', hole: cards('7c 2d') },
      ],
      board: cards('Ah 7s 2c'),
      rng: mulberry32(7),
    });
    const sum = r.equities.reduce((s, e) => s + e.equity, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});

describe('equityVsRange', () => {
  it('skips combos that collide with known cards', () => {
    // Range includes AcAd but hero holds Ac → that combo is skipped.
    const r = equityVsRange({
      hero: cards('Ac Kc'),
      villainRange: [combo('Ac Ad'), combo('Qh Qd')],
      board: cards('Kh 7s 2c'),
      rng: mulberry32(3),
    });
    expect(r.combos).toBe(1); // only QhQd is legal
    expect(r.equity).toBeGreaterThan(0); // top pair vs an overpair, some equity
  });
});

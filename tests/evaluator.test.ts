import { describe, expect, it } from 'vitest';
import { cards } from '../src/engine/deck';
import { evaluate } from '../src/engine/evaluator';

describe('evaluator — category detection', () => {
  it('royal flush', () => {
    const e = evaluate(cards('As Ks Qs Js Ts 2c 3d'));
    expect(e.category).toBe('royal-flush');
  });

  it('straight flush', () => {
    const e = evaluate(cards('9h 8h 7h 6h 5h 2c Ad'));
    expect(e.category).toBe('straight-flush');
  });

  it('straight flush wheel (A-2-3-4-5 suited)', () => {
    const e = evaluate(cards('Ah 2h 3h 4h 5h Kc Qd'));
    expect(e.category).toBe('straight-flush');
  });

  it('four of a kind', () => {
    const e = evaluate(cards('7c 7d 7h 7s 2c 3d Kh'));
    expect(e.category).toBe('four-of-a-kind');
  });

  it('full house picks best trip + best pair', () => {
    const e = evaluate(cards('Ks Kd Kh 7c 7d 2c 2h'));
    expect(e.category).toBe('full-house');
    // K-over-7, not K-over-2.
    expect(e.name).toBe('Full House');
  });

  it('flush', () => {
    const e = evaluate(cards('As 9s 7s 5s 2s Kc Qd'));
    expect(e.category).toBe('flush');
  });

  it('straight (Broadway)', () => {
    const e = evaluate(cards('Ac Kd Qh Js Tc 2c 3d'));
    expect(e.category).toBe('straight');
  });

  it('straight (wheel)', () => {
    const e = evaluate(cards('Ac 2d 3h 4s 5c 9d Kh'));
    expect(e.category).toBe('straight');
  });

  it('three of a kind', () => {
    const e = evaluate(cards('Qs Qd Qh 9c 7d 2c 3h'));
    expect(e.category).toBe('three-of-a-kind');
  });

  it('two pair', () => {
    const e = evaluate(cards('Ks Kd 7h 7c 4d 2c 3h'));
    expect(e.category).toBe('two-pair');
  });

  it('one pair', () => {
    const e = evaluate(cards('Ks Kd 9h 7c 4d 2c 3h'));
    expect(e.category).toBe('pair');
  });

  it('high card', () => {
    const e = evaluate(cards('Ks Qd 9h 7c 4d 2c 3h'));
    expect(e.category).toBe('high-card');
  });
});

describe('evaluator — ordering', () => {
  it('royal flush beats straight flush', () => {
    const royal = evaluate(cards('As Ks Qs Js Ts'));
    const sf = evaluate(cards('Kh Qh Jh Th 9h'));
    expect(royal.score).toBeGreaterThan(sf.score);
  });

  it('four of a kind beats full house', () => {
    const quads = evaluate(cards('2c 2d 2h 2s 3c'));
    const boat = evaluate(cards('Ac Ad Ah Kc Kd'));
    expect(quads.score).toBeGreaterThan(boat.score);
  });

  it('flush beats straight', () => {
    const flush = evaluate(cards('2s 5s 7s 9s Ks'));
    const straight = evaluate(cards('9c 8d 7h 6s 5c'));
    expect(flush.score).toBeGreaterThan(straight.score);
  });

  it('higher straight beats lower straight (Broadway > wheel)', () => {
    const broadway = evaluate(cards('Ac Kd Qh Js Tc'));
    const wheel = evaluate(cards('Ac 2d 3h 4s 5c'));
    expect(broadway.score).toBeGreaterThan(wheel.score);
  });

  it('two pair: higher top pair wins', () => {
    const kk77 = evaluate(cards('Kc Kd 7h 7s 2c'));
    const qqJJ = evaluate(cards('Qc Qd Jh Js 2c'));
    expect(kk77.score).toBeGreaterThan(qqJJ.score);
  });

  it('two pair: same top pair, higher second pair wins', () => {
    const kk88 = evaluate(cards('Kc Kd 8h 8s 2c'));
    const kk77 = evaluate(cards('Kc Kd 7h 7s 2c'));
    expect(kk88.score).toBeGreaterThan(kk77.score);
  });

  it('two pair: same pairs, higher kicker wins', () => {
    const kk77A = evaluate(cards('Kc Kd 7h 7s Ac'));
    const kk77J = evaluate(cards('Kc Kd 7h 7s Jc'));
    expect(kk77A.score).toBeGreaterThan(kk77J.score);
  });

  it('pair: higher kicker wins', () => {
    const aaK = evaluate(cards('Ac Ad Kh 7s 2c'));
    const aaQ = evaluate(cards('Ac Ad Qh 7s 2c'));
    expect(aaK.score).toBeGreaterThan(aaQ.score);
  });

  it('high card by sequential kickers', () => {
    const aHigh = evaluate(cards('Ac Kd Qh Js 9c'));
    const kHigh = evaluate(cards('Kc Qd Jh Ts 8c'));
    expect(aHigh.score).toBeGreaterThan(kHigh.score);
  });
});

describe('evaluator — input validation', () => {
  it('rejects fewer than 5 cards', () => {
    expect(() => evaluate(cards('Ac Kd Qh Js'))).toThrow();
  });
  it('rejects more than 7 cards', () => {
    expect(() => evaluate(cards('Ac Kd Qh Js Tc 9c 8c 7c'))).toThrow();
  });
});

describe('evaluator — 7-card picks best', () => {
  it('picks the flush ignoring an off-suit straight', () => {
    // Cards form both a straight (9-T-J-Q-K) and a flush in spades (As Js 8s 5s 2s)
    const e = evaluate(cards('As Js 8s 5s 2s Kh Qd'));
    expect(e.category).toBe('flush');
  });

  it('picks the better full house (kings full beats sevens full)', () => {
    // Both KK trip and 77 trip available; KK7 wins.
    const e = evaluate(cards('Kc Kd Kh 7c 7d 7s 2c'));
    expect(e.category).toBe('full-house');
    // best5 should contain three kings and two sevens, not three sevens.
    const ranks = e.best5.map(c => c.rank).sort((a, b) => b - a);
    expect(ranks.filter(r => r === 13).length).toBe(3);
    expect(ranks.filter(r => r === 7).length).toBe(2);
  });
});

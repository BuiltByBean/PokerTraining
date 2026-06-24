import { describe, expect, it } from 'vitest';
import {
  breakEvenBluffPct,
  evBluff,
  evCall,
  foldEquity,
  impliedOddsNeeded,
  mdf,
  outsToEquity,
  potOdds,
  requiredEquity,
  spr,
} from '../src/engine/odds';

describe('requiredEquity', () => {
  it('half-pot bet needs 25%', () => {
    // Pot is 100, villain bets 50 → you call 50 into a pot of 150.
    expect(requiredEquity(50, 150)).toBeCloseTo(0.25, 5);
  });
  it('pot-sized bet needs 33.3%', () => {
    expect(requiredEquity(100, 200)).toBeCloseTo(1 / 3, 5);
  });
  it('zero call needs zero equity', () => {
    expect(requiredEquity(0, 100)).toBe(0);
  });
});

describe('potOdds (ratio)', () => {
  it('100 to call into 200 is 2:1', () => {
    expect(potOdds(100, 200)).toBe(2);
  });
  it('free call is infinite odds', () => {
    expect(potOdds(0, 50)).toBe(Infinity);
  });
});

describe('evCall', () => {
  it('break-even when equity equals pot odds', () => {
    // Pot is 150 before your call (villain's 50 already in it); you call 50.
    // Required equity = 50/200 = 25%, so EV at 25% equity is 0.
    expect(evCall(0.25, 150, 50)).toBeCloseTo(0, 5);
  });
  it('positive when ahead of pot odds', () => {
    expect(evCall(0.5, 100, 50)).toBeGreaterThan(0);
  });
  it('certain win returns the pot', () => {
    expect(evCall(1, 100, 50)).toBeCloseTo(100, 5);
  });
});

describe('evBluff', () => {
  it('break-even at alpha fold frequency', () => {
    // Pot 100, bet 50 → alpha = 50/150 = 0.333. At that fold%, EV ≈ 0.
    expect(evBluff(1 / 3, 100, 50)).toBeCloseTo(0, 5);
  });
});

describe('foldEquity', () => {
  it('is fold prob times the pot', () => {
    expect(foldEquity(0.4, 100)).toBeCloseTo(40, 5);
  });
});

describe('mdf / breakEvenBluffPct', () => {
  it('half-pot: MDF 0.667, alpha 0.333', () => {
    expect(mdf(50, 100)).toBeCloseTo(2 / 3, 5);
    expect(breakEvenBluffPct(50, 100)).toBeCloseTo(1 / 3, 5);
  });
  it('pot-sized: both 0.5', () => {
    expect(mdf(100, 100)).toBeCloseTo(0.5, 5);
    expect(breakEvenBluffPct(100, 100)).toBeCloseTo(0.5, 5);
  });
  it('they sum to 1', () => {
    expect(mdf(75, 100) + breakEvenBluffPct(75, 100)).toBeCloseTo(1, 5);
  });
});

describe('spr', () => {
  it('100 stack into 25 pot is SPR 4', () => {
    expect(spr(100, 25)).toBe(4);
  });
});

describe('outsToEquity (rule of 2 and 4)', () => {
  it('flush draw, one card to come ≈ 18%', () => {
    expect(outsToEquity(9, 1)).toBeCloseTo(0.18, 5);
  });
  it('flush draw, two cards to come ≈ 35% (with >8 correction)', () => {
    // Raw rule of 4 would say 36%; the correction subtracts (9-8)=1.
    expect(outsToEquity(9, 2)).toBeCloseTo(0.35, 5);
  });
  it('8 outs (OESD), two cards ≈ 32% (no correction at the boundary)', () => {
    expect(outsToEquity(8, 2)).toBeCloseTo(0.32, 5);
  });
  it('4 outs (gutshot), one card ≈ 8%', () => {
    expect(outsToEquity(4, 1)).toBeCloseTo(0.08, 5);
  });
});

describe('impliedOddsNeeded', () => {
  it('zero when pot odds already suffice', () => {
    // 50% equity calling 50 into 100 — pot odds alone are fine.
    expect(impliedOddsNeeded(50, 100, 0.5)).toBe(0);
  });
  it('positive when drawing thin', () => {
    // 20% equity calling 50 into 100: need (1/0.2)*50 - 150 = 250 - 150 = 100.
    expect(impliedOddsNeeded(50, 100, 0.2)).toBeCloseTo(100, 5);
  });
});

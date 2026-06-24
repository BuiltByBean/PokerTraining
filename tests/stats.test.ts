import { describe, expect, it } from 'vitest';
import { computeStats } from '../src/analysis/stats';
import type { DecisionSnapshot } from '../src/analysis/recorder';
import type { HandRecord, HandOutcome } from '../src/analysis/record';
import type { Action } from '../src/engine/types';

interface Spec {
  pre: 'fold' | 'call' | 'raise';
  facedOpen: boolean;
  sawFlop: boolean;
  showdown: boolean;
  won: boolean;
  netBb: number;
  postAggr: number;
  postCalls: number;
}

function preSnap(spec: Spec): DecisionSnapshot {
  const action: Action =
    spec.pre === 'fold' ? { kind: 'fold', amount: 0 }
      : spec.pre === 'raise' ? { kind: 'raise', amount: 6 }
        : { kind: 'call', amount: 2 };
  return {
    handNumber: 1, actorId: 'P0', street: 'preflop', action,
    potBefore: 3, betFaced: spec.facedOpen ? 6 : 2, amountPutIn: spec.pre === 'fold' ? 0 : 6,
    position: 'CO', inPosition: false, effectiveStack: 200, spr: 50, currentBet: spec.facedOpen ? 6 : 2,
    numActivePlayers: 3, aggressorId: spec.facedOpen ? 'P1' : undefined, liveOpponentIds: ['P1'], board: [],
  };
}

function postSnaps(spec: Spec): DecisionSnapshot[] {
  const out: DecisionSnapshot[] = [];
  const base = { handNumber: 1, actorId: 'P0', street: 'flop' as const, potBefore: 20, betFaced: 0,
    amountPutIn: 10, position: 'CO' as const, inPosition: true, effectiveStack: 180, spr: 9, currentBet: 0,
    numActivePlayers: 2, aggressorId: undefined, liveOpponentIds: ['P1'], board: [] };
  for (let i = 0; i < spec.postAggr; i++) out.push({ ...base, action: { kind: 'bet', amount: 10 } });
  for (let i = 0; i < spec.postCalls; i++) out.push({ ...base, action: { kind: 'call', amount: 10 } });
  return out;
}

function build(spec: Spec, i: number): HandRecord {
  const outcome: HandOutcome = {
    winners: spec.won ? ['P0'] : ['P1'],
    wentToShowdown: spec.showdown,
    heroWentToShowdown: spec.showdown,
    heroNet: spec.netBb * 2,
    heroNetBb: spec.netBb,
    line: spec.won ? (spec.showdown ? 'blue' : 'red') : 'none',
  };
  return {
    version: 1, id: `h${i}`, playedAt: i,
    config: { playerCount: 3, smallBlind: 1, bigBlind: 2, difficulty: 5, dealerIndex: 0, humanId: 'P0', names: {} },
    holeCards: {},
    board: spec.sawFlop ? [{ rank: 2, suit: 'c' }, { rank: 7, suit: 'd' }, { rank: 9, suit: 'h' }] : [],
    snapshots: [preSnap(spec), ...(spec.sawFlop ? postSnaps(spec) : [])],
    outcome,
  };
}

/** 40 hands engineered to known stat targets. */
function corpus(): HandRecord[] {
  const specs: Spec[] = [];
  for (let i = 0; i < 40; i++) {
    const voluntary = i < 24;
    const raise = i < 16;
    specs.push({
      pre: !voluntary ? 'fold' : raise ? 'raise' : 'call',
      facedOpen: i < 20,
      sawFlop: i < 20,
      showdown: i < 16,
      won: i < 10,
      netBb: i < 10 ? 10 : -5,
      postAggr: i < 20 ? 2 : 0,
      postCalls: i < 20 ? 1 : 0,
    });
  }
  return specs.map(build);
}

describe('computeStats', () => {
  const stats = computeStats(corpus());

  it('VPIP / PFR / gap with correct denominators', () => {
    expect(stats.hands).toBe(40);
    expect(stats.vpip.pct).toBeCloseTo(24 / 40, 5);
    expect(stats.pfr.pct).toBeCloseTo(16 / 40, 5);
    expect(stats.vpipPfrGap).toBeCloseTo(0.2, 5);
  });

  it('3-bet uses faced-an-open as the denominator', () => {
    expect(stats.threeBet.opps).toBe(20);
    expect(stats.threeBet.pct).toBeCloseTo(16 / 20, 5);
  });

  it('WTSD over saw-flop, W$SD over showdowns', () => {
    expect(stats.wtsd.pct).toBeCloseTo(16 / 20, 5); // 16 showdowns / 20 saw flop
    expect(stats.wssd.pct).toBeCloseTo(10 / 16, 5); // 10 winners (i<10) among 16 showdowns
  });

  it('aggression factor = bets/calls postflop', () => {
    expect(stats.af).toBeCloseTo((20 * 2) / (20 * 1), 5); // 2.0
  });

  it('red/blue lines split by showdown', () => {
    // Showdown hands (i<16): i<10 won +10, 10..15 lost -5 → blue = 10*10 + 6*(-5) = 70
    expect(stats.blueLineBb).toBeCloseTo(70, 1);
    // Non-showdown hands (i>=16): all lost -5 → red = 24*(-5) = -120
    expect(stats.redLineBb).toBeCloseTo(-120, 1);
  });

  it('gates stats under the minimum sample', () => {
    const tiny = computeStats(corpus().slice(0, 10));
    expect(tiny.vpip.pct).toBeUndefined();
    expect(tiny.archetype).toBeUndefined();
  });

  it('classifies an archetype once samples clear', () => {
    expect(stats.archetype).toBeDefined();
  });
});

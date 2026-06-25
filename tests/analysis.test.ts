import { describe, expect, it } from 'vitest';
import { cards } from '../src/engine/deck';
import { mulberry32 } from '../src/engine/rng';
import { gradeHand } from '../src/analysis/decision';
import { detectHandLeaks } from '../src/analysis/leaks';
import { analyzeHand } from '../src/analysis/index';
import type { DecisionSnapshot } from '../src/analysis/recorder';
import type { HandConfig, HandOutcome, HandRecord } from '../src/analysis/record';
import type { Action, Card, Street } from '../src/engine/types';

const rng = () => mulberry32(7);

function snap(o: Partial<DecisionSnapshot> & { action: Action; street: Street; board: readonly Card[] }): DecisionSnapshot {
  return {
    handNumber: 1,
    actorId: 'P0',
    potBefore: 100,
    betFaced: 0,
    amountPutIn: 0,
    position: 'BTN',
    inPosition: true,
    effectiveStack: 500,
    spr: 5,
    currentBet: 0,
    numActivePlayers: 2,
    aggressorId: undefined,
    liveOpponentIds: ['P1'],
    ...o,
  };
}

function record(o: {
  hole: Record<string, string>;
  board: string;
  snapshots: readonly DecisionSnapshot[];
  outcome?: Partial<HandOutcome>;
  config?: Partial<HandConfig>;
}): HandRecord {
  const holeCards: Record<string, readonly Card[]> = {};
  for (const [id, s] of Object.entries(o.hole)) holeCards[id] = cards(s);
  const config: HandConfig = {
    playerCount: 2, smallBlind: 1, bigBlind: 2, difficulty: 5, dealerIndex: 0,
    humanId: 'P0', names: { P0: 'You', P1: 'Villain' }, ...o.config,
  };
  const outcome: HandOutcome = {
    winners: ['P1'], wentToShowdown: true, heroWentToShowdown: true,
    heroNet: 0, heroNetBb: 0, line: 'none', ...o.outcome,
  };
  return { version: 1, id: 'h1', playedAt: 1, config, holeCards, board: cards(o.board), snapshots: o.snapshots, outcome };
}

describe('decision grading', () => {
  it('flags a hopeless river call as a blunder', () => {
    const r = record({
      hole: { P0: '2c 3d', P1: 'Ac Ad' },
      board: 'Ks Qh 7d 4s 9c',
      snapshots: [snap({ action: { kind: 'call', amount: 50 }, street: 'river', board: cards('Ks Qh 7d 4s 9c'), potBefore: 150, betFaced: 50, amountPutIn: 50, currentBet: 50 })],
    });
    const [g] = gradeHand(r, rng());
    expect(g?.hindsightEquity).toBe(0);
    expect(g?.requiredEquity).toBeCloseTo(0.25, 2);
    expect(g?.verdict).toBe('blunder');
  });

  it('rewards a correct value call', () => {
    const r = record({
      hole: { P0: 'Ah Ad', P1: 'Kc Qc' },
      board: 'As Kd 7h 2c 9s',
      snapshots: [snap({ action: { kind: 'call', amount: 20 }, street: 'river', board: cards('As Kd 7h 2c 9s'), potBefore: 100, betFaced: 20, amountPutIn: 20, currentBet: 20 })],
    });
    const [g] = gradeHand(r, rng());
    expect(g?.hindsightEquity).toBe(1); // top set crushes a pair of kings
    expect(g?.verdict).toBe('correct');
  });

  it('flags folding a hugely +EV call as a mistake', () => {
    const r = record({
      hole: { P0: 'Ah Ad', P1: '2c 7d' },
      board: 'As 9h 4c 5s Jd',
      snapshots: [snap({ action: { kind: 'fold', amount: 0 }, street: 'river', board: cards('As 9h 4c 5s Jd'), potBefore: 100, betFaced: 10, amountPutIn: 0, currentBet: 10 })],
    });
    const [g] = gradeHand(r, rng());
    expect(g?.verdict === 'mistake' || g?.verdict === 'blunder').toBe(true);
    expect(g?.note.toLowerCase()).toContain('too tight');
    // The matchup is named so the equity claim is verifiable.
    expect(g?.note).toContain('against');
    expect(g?.note).toContain('Villain');
  });

  it('calls out folding a hand that could be checked for free', () => {
    const r = record({
      hole: { P0: 'Ah Ad', P1: '2c 7d' },
      board: 'As 9h 4c 5s Jd',
      snapshots: [snap({ action: { kind: 'fold', amount: 0 }, street: 'river', board: cards('As 9h 4c 5s Jd'), potBefore: 100, betFaced: 0, amountPutIn: 0, currentBet: 0 })],
    });
    const [g] = gradeHand(r, rng());
    expect(g?.note.toLowerCase()).toContain('for free');
  });
});

describe('leak detection', () => {
  it('detects "stayed too long" on a behind river call', () => {
    const r = record({
      hole: { P0: '2c 3d', P1: 'Ac Ad' },
      board: 'Ks Qh 7d 4s 9c',
      snapshots: [snap({ action: { kind: 'call', amount: 50 }, street: 'river', board: cards('Ks Qh 7d 4s 9c'), potBefore: 150, betFaced: 50, amountPutIn: 50, currentBet: 50 })],
    });
    const leaks = detectHandLeaks(r, gradeHand(r, rng()));
    expect(leaks.some(l => l.code === 'stayed-too-long' && l.severity === 'severe')).toBe(true);
  });

  it('detects chasing a flush draw without odds', () => {
    const board = 'Qs 7s 2h';
    const r = record({
      hole: { P0: 'As Ks', P1: '7h 7d' }, // hero flush draw vs a set
      board,
      snapshots: [snap({ action: { kind: 'call', amount: 60 }, street: 'flop', board: cards(board), potBefore: 60, betFaced: 60, amountPutIn: 60, currentBet: 60 })],
    });
    const leaks = detectHandLeaks(r, gradeHand(r, rng()));
    expect(leaks.some(l => l.code === 'chased-draw')).toBe(true);
  });

  it('detects false security overcommitting one pair multiway', () => {
    const board = 'Ks Qs Js';
    const r = record({
      hole: { P0: 'Ah Ad', P1: 'Kc Kd', P2: 'Ts 9s' },
      board,
      config: { playerCount: 3, names: { P0: 'You', P1: 'A', P2: 'B' } },
      snapshots: [snap({
        action: { kind: 'allin', amount: 500 }, street: 'flop', board: cards(board),
        potBefore: 100, betFaced: 0, amountPutIn: 500, effectiveStack: 500, numActivePlayers: 3,
        liveOpponentIds: ['P1', 'P2'],
      })],
    });
    const leaks = detectHandLeaks(r, gradeHand(r, rng()));
    expect(leaks.some(l => l.code === 'false-security' && l.severity === 'severe')).toBe(true);
  });

  it('detects winning on a bluff, not on merit', () => {
    const board = 'Ks Qh 7d 4s 9c';
    const r = record({
      hole: { P0: '2c 3d', P1: 'Ac Ad' },
      board,
      outcome: { line: 'red', wentToShowdown: false, heroWentToShowdown: false, heroNet: 100, heroNetBb: 50, winners: ['P0'] },
      snapshots: [snap({ action: { kind: 'bet', amount: 80 }, street: 'river', board: cards(board), potBefore: 100, betFaced: 0, amountPutIn: 80, currentBet: 0 })],
    });
    const leaks = detectHandLeaks(r, gradeHand(r, rng()));
    expect(leaks.some(l => l.code === 'bluff-win-not-merit')).toBe(true);
  });
});

describe('analyzeHand', () => {
  it('produces grades, leaks, an equity line, and a summary deterministically', () => {
    const board = 'Ks Qh 7d 4s 9c';
    const r = record({
      hole: { P0: '2c 3d', P1: 'Ac Ad' },
      board,
      snapshots: [snap({ action: { kind: 'call', amount: 50 }, street: 'river', board: cards(board), potBefore: 150, betFaced: 50, amountPutIn: 50, currentBet: 50 })],
    });
    const a = analyzeHand(r);
    expect(a.grades).toHaveLength(1);
    expect(a.leaks.length).toBeGreaterThan(0);
    expect(a.equityLine[0]?.equity).toBe(0);
    expect(a.summary.length).toBeGreaterThan(0);
    // Deterministic: same input → same summary.
    expect(analyzeHand(r).summary).toBe(a.summary);
  });
});

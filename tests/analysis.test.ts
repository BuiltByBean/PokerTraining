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
  it('flags calling a river bet with a weak hand as a mistake (your hand, not theirs)', () => {
    const r = record({
      hole: { P0: '2c 3d', P1: 'Ac Ad' },
      board: 'Ks Qh 7d 4s 9c',
      snapshots: [snap({ action: { kind: 'call', amount: 50 }, street: 'river', board: cards('Ks Qh 7d 4s 9c'), potBefore: 150, betFaced: 50, amountPutIn: 50, currentBet: 50 })],
    });
    const [g] = gradeHand(r);
    expect(g?.handStrength).toBeLessThan(0.3); // just high card
    expect(g?.requiredEquity).toBeCloseTo(0.25, 2);
    expect(g?.verdict).toBe('mistake');
    expect(g?.note.toLowerCase()).toContain('loose call');
    expect(g?.note.toLowerCase()).not.toContain('ac'); // never references villain's cards
  });

  it('rewards a strong value call', () => {
    const r = record({
      hole: { P0: 'Ah Ad', P1: 'Kc Qc' },
      board: 'As Kd 7h 2c 9s',
      snapshots: [snap({ action: { kind: 'call', amount: 20 }, street: 'river', board: cards('As Kd 7h 2c 9s'), potBefore: 100, betFaced: 20, amountPutIn: 20, currentBet: 20 })],
    });
    const [g] = gradeHand(r);
    expect(g?.handStrength).toBeGreaterThan(0.6); // a set of aces
    expect(g?.verdict).toBe('correct');
    expect(g?.note.toLowerCase()).toContain('three of a kind');
  });

  it('flags folding a strong made hand as too tight (from your own hand)', () => {
    const r = record({
      hole: { P0: 'Ah Ad', P1: '2c 7d' },
      board: 'As 9h 4c 5s Jd',
      snapshots: [snap({ action: { kind: 'fold', amount: 0 }, street: 'river', board: cards('As 9h 4c 5s Jd'), potBefore: 100, betFaced: 10, amountPutIn: 0, currentBet: 10 })],
    });
    const [g] = gradeHand(r);
    expect(g?.verdict).toBe('mistake');
    expect(g?.note.toLowerCase()).toContain('too tight');
    expect(g?.note.toLowerCase()).toContain('three of a kind'); // names YOUR hand
    expect(g?.note.toLowerCase()).not.toContain('against'); // not vs their cards
  });

  it('does not call a normal preflop raise a "bluff"', () => {
    const r = record({
      hole: { P0: 'Kh Td', P1: 'Ah As' }, // KTo open; low hindsight equity vs aces
      board: '',
      snapshots: [snap({ action: { kind: 'raise', amount: 6 }, street: 'preflop', board: [], potBefore: 3, betFaced: 2, amountPutIn: 6, currentBet: 2 })],
    });
    const [g] = gradeHand(r, rng());
    expect(g?.note.toLowerCase()).not.toContain('bluff');
    expect(g?.note.toLowerCase()).toContain('raise');
  });

  it('labels a bet with a big draw a "semi-bluff", not a pure bluff', () => {
    const board = 'Js 5s 2c';
    const r = record({
      hole: { P0: 'Ks Qs', P1: 'Jd Js' }, // flush draw, no pair
      board,
      snapshots: [snap({ action: { kind: 'bet', amount: 64 }, street: 'flop', board: cards(board), potBefore: 100, betFaced: 0, amountPutIn: 64, currentBet: 0 })],
    });
    const [g] = gradeHand(r);
    expect(g?.note.toLowerCase()).toContain('semi-bluff');
    expect(g?.note.toLowerCase()).toContain('flush draw'); // names YOUR draw
  });

  it('does not punish folding a weak hand (judged on your hand, not theirs)', () => {
    // Hero 8-high, no pair, no draw — folding the flop to a bet is standard,
    // regardless of what the villain turned out to have.
    const board = 'Jd Ac Ks';
    const r = record({
      hole: { P0: '8h 6h', P1: '7d 2c' },
      board,
      snapshots: [snap({ action: { kind: 'fold', amount: 0 }, street: 'flop', board: cards(board), potBefore: 40, betFaced: 10, amountPutIn: 0, currentBet: 10 })],
    });
    const [g] = gradeHand(r);
    expect(g?.verdict).toBe('correct');
    expect(g?.note.toLowerCase()).toContain('good fold');
    expect(g?.note.toLowerCase()).toContain('high card');
  });

  it('names your made hand when you fold a winner (you folded a flush!)', () => {
    // K♦5♦ makes a K-high flush — folding it is too tight, and the note should
    // say YOU had a flush (never mentioning the opponent's cards).
    const board = '6c 2d 8h Jd 8d';
    const r = record({
      hole: { P0: 'Kd 5d', P1: '6h Tc' },
      board,
      snapshots: [snap({ action: { kind: 'fold', amount: 0 }, street: 'river', board: cards(board), potBefore: 100, betFaced: 30, amountPutIn: 0, currentBet: 30 })],
    });
    const [g] = gradeHand(r);
    expect(g?.verdict).toBe('mistake');
    expect(g?.note.toLowerCase()).toContain('flush');    // what you had
    expect(g?.note.toLowerCase()).toContain('too tight');
    expect(g?.note.toLowerCase()).not.toContain('two pair'); // never their hand
  });

  it('does NOT flag folding when the pair is on the board (playing the board)', () => {
    // A♠5♠ on 6♣2♣J♠6♦ — the pair of sixes is the board's, shared by everyone;
    // hero is playing the board with an ace kicker. Folding a turn bet here is
    // standard — NOT a mistake — and the review must not reference the opponent.
    const board = '6c 2c Js 6d';
    const r = record({
      hole: { P0: 'As 5s', P1: '9d 5c' },
      board: '6c 2c Js 6d 3h',
      snapshots: [snap({ action: { kind: 'fold', amount: 0 }, street: 'turn', board: cards(board), potBefore: 18, betFaced: 8, amountPutIn: 0, currentBet: 8 })],
    });
    const [g] = gradeHand(r);
    expect(g?.verdict).toBe('correct');              // folding is standard
    expect(g?.note.toLowerCase()).toContain('board'); // explains you played the board
    expect(g?.note.toLowerCase()).not.toContain('too tight');
  });

  it('still flags folding a real made hand as too tight', () => {
    // Hero flopped top two pair and folds to a bet — a genuine, available-info leak.
    const board = 'Ah Kd 4c';
    const r = record({
      hole: { P0: 'Ac Kc', P1: '7d 2h' },
      board,
      snapshots: [snap({ action: { kind: 'fold', amount: 0 }, street: 'flop', board: cards(board), potBefore: 40, betFaced: 10, amountPutIn: 0, currentBet: 10 })],
    });
    const [g] = gradeHand(r);
    expect(g?.verdict).toBe('mistake');
    expect(g?.note.toLowerCase()).toContain('two pair');
  });

  it('flags a big draw folded for a good price as a bit tight', () => {
    // Nut flush draw + gutshot on the flop, folded to a small bet — folding a
    // draw this big is too passive, explained via YOUR outs, not their cards.
    const board = '7s 5s 4d';
    const r = record({
      hole: { P0: 'As 2s', P1: 'Qs Ts' },
      board,
      snapshots: [snap({ action: { kind: 'fold', amount: 0 }, street: 'flop', board: cards(board), potBefore: 30, betFaced: 10, amountPutIn: 0, currentBet: 10 })],
    });
    const [g] = gradeHand(r);
    expect(g?.note.toLowerCase()).toContain('outs');
    expect(g?.note.toLowerCase()).toContain('draw');
    expect(g?.note.toLowerCase()).not.toContain('big mistake');
  });

  it('calls out folding a hand that could be checked for free', () => {
    const r = record({
      hole: { P0: 'Ah Ad', P1: '2c 7d' },
      board: 'As 9h 4c 5s Jd',
      snapshots: [snap({ action: { kind: 'fold', amount: 0 }, street: 'river', board: cards('As 9h 4c 5s Jd'), potBefore: 100, betFaced: 0, amountPutIn: 0, currentBet: 0 })],
    });
    const [g] = gradeHand(r);
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
    expect(a.equityLine[0]?.equity).toBeLessThan(0.3); // hand strength (high card), not vs their cards
    expect(a.summary.length).toBeGreaterThan(0);
    // Deterministic: same input → same summary.
    expect(analyzeHand(r).summary).toBe(a.summary);
  });
});

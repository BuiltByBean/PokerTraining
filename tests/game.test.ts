import { describe, expect, it } from 'vitest';
import { Hand } from '../src/engine/game';
import { mulberry32 } from '../src/engine/rng';
import type { Player } from '../src/engine/types';

function seat(id: string, stack = 1000): Player {
  return {
    id,
    name: id,
    isHuman: false,
    stack,
    hole: [],
    status: 'active',
    betThisStreet: 0,
    totalCommitted: 0,
  };
}

function newHand(stacks: number[] = [1000, 1000, 1000, 1000, 1000]): Hand {
  return new Hand({
    handNumber: 1,
    players: stacks.map((s, i) => seat(`P${i}`, s)),
    dealerIndex: 0,
    smallBlind: 1,
    bigBlind: 2,
    rng: mulberry32(42),
  });
}

describe('Hand — setup', () => {
  it('posts blinds and deals 2 cards each', () => {
    const h = newHand();
    const s = h.getState();
    expect(s.street).toBe('preflop');
    expect(s.players[1]?.totalCommitted).toBe(1); // SB
    expect(s.players[2]?.totalCommitted).toBe(2); // BB
    expect(s.currentBet).toBe(2);
    expect(s.minRaise).toBe(2);
    expect(s.players[0]?.hole).toHaveLength(2);
    expect(s.toAct).toBe('P3'); // UTG = seat after BB
  });

  it('heads-up posts SB on the dealer (button)', () => {
    const h = new Hand({
      handNumber: 1,
      players: [seat('A'), seat('B')],
      dealerIndex: 0,
      smallBlind: 1,
      bigBlind: 2,
      rng: mulberry32(1),
    });
    const s = h.getState();
    expect(s.players[0]?.totalCommitted).toBe(1); // dealer = SB
    expect(s.players[1]?.totalCommitted).toBe(2);
    expect(s.toAct).toBe('A'); // SB acts first preflop heads-up
  });
});

describe('Hand — fold-around win', () => {
  it('BB wins blinds when everyone folds', () => {
    const h = newHand();
    // Pre-flop, action goes UTG (P3) → P4 → P0 → SB (P1).
    h.applyAction('P3', { kind: 'fold', amount: 0 });
    h.applyAction('P4', { kind: 'fold', amount: 0 });
    h.applyAction('P0', { kind: 'fold', amount: 0 });
    h.applyAction('P1', { kind: 'fold', amount: 0 });
    expect(h.isComplete()).toBe(true);
    const r = h.resolve();
    // BB started at 1000, posted 2, wins the 3-chip pot → net +1.
    expect(r.finalStacks.get('P2')).toBe(1001);
    expect(r.finalStacks.get('P1')).toBe(999); // SB lost their 1
    // Folded players unchanged.
    expect(r.finalStacks.get('P0')).toBe(1000);
    expect(r.finalStacks.get('P3')).toBe(1000);
    expect(r.finalStacks.get('P4')).toBe(1000);
  });
});

describe('Hand — full hand to showdown', () => {
  it('plays a deterministic hand all the way through', () => {
    const h = newHand();

    // Preflop: everyone limps, BB checks.
    h.applyAction('P3', { kind: 'call', amount: 2 });
    h.applyAction('P4', { kind: 'call', amount: 2 });
    h.applyAction('P0', { kind: 'call', amount: 2 });
    h.applyAction('P1', { kind: 'call', amount: 2 });
    h.applyAction('P2', { kind: 'check', amount: 0 });

    let s = h.getState();
    expect(s.street).toBe('flop');
    expect(s.board).toHaveLength(3);
    expect(s.toAct).toBe('P1'); // first active left of dealer

    // Everyone checks the flop.
    h.applyAction('P1', { kind: 'check', amount: 0 });
    h.applyAction('P2', { kind: 'check', amount: 0 });
    h.applyAction('P3', { kind: 'check', amount: 0 });
    h.applyAction('P4', { kind: 'check', amount: 0 });
    h.applyAction('P0', { kind: 'check', amount: 0 });

    s = h.getState();
    expect(s.street).toBe('turn');
    expect(s.board).toHaveLength(4);

    // Turn checks through.
    h.applyAction('P1', { kind: 'check', amount: 0 });
    h.applyAction('P2', { kind: 'check', amount: 0 });
    h.applyAction('P3', { kind: 'check', amount: 0 });
    h.applyAction('P4', { kind: 'check', amount: 0 });
    h.applyAction('P0', { kind: 'check', amount: 0 });

    s = h.getState();
    expect(s.street).toBe('river');
    expect(s.board).toHaveLength(5);

    // River checks through → showdown.
    h.applyAction('P1', { kind: 'check', amount: 0 });
    h.applyAction('P2', { kind: 'check', amount: 0 });
    h.applyAction('P3', { kind: 'check', amount: 0 });
    h.applyAction('P4', { kind: 'check', amount: 0 });
    h.applyAction('P0', { kind: 'check', amount: 0 });

    expect(h.isComplete()).toBe(true);
    const r = h.resolve();
    expect(r.awards).toHaveLength(1);
    expect(r.awards[0]?.winners.length).toBeGreaterThan(0);
    // Total pot: 5 players × $2 = $10, distributed.
    const totalAfter = [...r.finalStacks.values()].reduce((a, b) => a + b, 0);
    expect(totalAfter).toBe(5 * 1000); // chips conserved
  });
});

describe('Hand — raising', () => {
  it('respects min-raise', () => {
    const h = newHand();
    // UTG raises to 6 (min raise = BB to 4; raise to 6 is fine).
    h.applyAction('P3', { kind: 'raise', amount: 6 });
    expect(h.getState().currentBet).toBe(6);
    expect(h.getState().minRaise).toBe(4); // (6 - 2 = 4)

    // P4 tries to re-raise to 7 — illegal (min raise to 10).
    expect(() => h.applyAction('P4', { kind: 'raise', amount: 7 })).toThrow(/min raise/i);
  });

  it('a raise reopens action for prior callers', () => {
    const h = newHand();
    h.applyAction('P3', { kind: 'call', amount: 2 });
    h.applyAction('P4', { kind: 'call', amount: 2 });
    h.applyAction('P0', { kind: 'raise', amount: 8 });
    // Action should come back around to P3.
    h.applyAction('P1', { kind: 'fold', amount: 0 });
    h.applyAction('P2', { kind: 'fold', amount: 0 });
    expect(h.getState().toAct).toBe('P3');
  });
});

describe('Hand — all-in + side pot', () => {
  it('produces correct side pots when a short stack busts', () => {
    // 3 players. A=1000, B=50, C=1000.
    const h = new Hand({
      handNumber: 1,
      players: [seat('A', 1000), seat('B', 50), seat('C', 1000)],
      dealerIndex: 0,
      smallBlind: 1,
      bigBlind: 2,
      rng: mulberry32(7),
    });
    // Preflop: A is UTG (3-player game, A=button, B=SB, C=BB), action starts at A.
    // Actually with 3 players: dealer=A; SB=B, BB=C, UTG=A.
    expect(h.getState().toAct).toBe('A');
    h.applyAction('A', { kind: 'raise', amount: 100 });
    h.applyAction('B', { kind: 'allin', amount: 0 }); // shoves remaining 49 (total 50)
    h.applyAction('C', { kind: 'call', amount: 100 });
    // B is all-in for 50; A & C continue with 100 committed each.

    // Streets run automatically? No — actionable players (A, C) still need to act.
    let s = h.getState();
    expect(s.street).toBe('flop');
    expect(s.toAct).toBe('C'); // after dealer (A), first active is B (all-in, skipped), then C

    h.applyAction('C', { kind: 'check', amount: 0 });
    h.applyAction('A', { kind: 'check', amount: 0 });
    s = h.getState();
    expect(s.street).toBe('turn');

    h.applyAction('C', { kind: 'check', amount: 0 });
    h.applyAction('A', { kind: 'check', amount: 0 });
    s = h.getState();
    expect(s.street).toBe('river');

    h.applyAction('C', { kind: 'check', amount: 0 });
    h.applyAction('A', { kind: 'check', amount: 0 });
    expect(h.isComplete()).toBe(true);

    const r = h.resolve();
    expect(r.pots).toHaveLength(2);
    // Main pot: 50*3 = 150, eligible A/B/C.
    expect(r.pots[0]?.amount).toBe(150);
    expect([...(r.pots[0]?.eligible ?? [])].sort()).toEqual(['A', 'B', 'C']);
    // Side pot: 50*2 = 100, eligible A/C.
    expect(r.pots[1]?.amount).toBe(100);
    expect([...(r.pots[1]?.eligible ?? [])].sort()).toEqual(['A', 'C']);

    const total = [...r.finalStacks.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(2050); // chips conserved
  });
});

describe('Hand — illegal action rejection', () => {
  it('rejects action from wrong player', () => {
    const h = newHand();
    expect(() => h.applyAction('P0', { kind: 'fold', amount: 0 })).toThrow(/turn/i);
  });

  it('rejects check when there is a bet to call', () => {
    const h = newHand();
    expect(() => h.applyAction('P3', { kind: 'check', amount: 0 })).toThrow();
  });
});

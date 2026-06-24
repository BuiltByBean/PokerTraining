import { describe, expect, it } from 'vitest';
import { Hand } from '../src/engine/game';
import { mulberry32 } from '../src/engine/rng';
import { newRecorder } from '../src/analysis/recorder';
import { buildHandRecord, type HandConfig } from '../src/analysis/record';
import type { Action, Player } from '../src/engine/types';

function seat(id: string, stack = 1000): Player {
  return { id, name: id, isHuman: id === 'P0', stack, hole: [], status: 'active', betThisStreet: 0, totalCommitted: 0 };
}

function newHand() {
  const players = [seat('P0'), seat('P1'), seat('P2')];
  const startStacks = Object.fromEntries(players.map(p => [p.id, p.stack]));
  const hand = new Hand({
    handNumber: 1, players, dealerIndex: 0, smallBlind: 1, bigBlind: 2, rng: mulberry32(42),
  });
  return { hand, startStacks };
}

/** Capture snapshots while applying a (possibly partial) action sequence. */
function recordSnapshots(hand: Hand, actions: Array<[string, Action]>) {
  const recorder = newRecorder();
  for (const [id, action] of actions) {
    recorder.capture(hand.getState(), id, action);
    hand.applyAction(id, action);
  }
  return recorder;
}

const CONFIG: HandConfig = {
  playerCount: 3, smallBlind: 1, bigBlind: 2, difficulty: 5, dealerIndex: 0,
  humanId: 'P0', names: { P0: 'You', P1: 'Bot1', P2: 'Bot2' },
};

describe('recorder', () => {
  it('captures one snapshot per decision with correct context', () => {
    // 3-handed: dealer/BTN P0, SB P1, BB P2. UTG preflop is the BTN (P0).
    const { hand } = newHand();
    const recorder = recordSnapshots(hand, [
      ['P0', { kind: 'call', amount: 2 }],
      ['P1', { kind: 'call', amount: 2 }],
      ['P2', { kind: 'check', amount: 0 }],
      ['P1', { kind: 'check', amount: 0 }],
      ['P2', { kind: 'check', amount: 0 }],
      ['P0', { kind: 'check', amount: 0 }],
    ]);
    const snaps = recorder.snapshots();
    expect(snaps.length).toBe(6);

    const utg = snaps[0];
    expect(utg?.actorId).toBe('P0');
    expect(utg?.street).toBe('preflop');
    expect(utg?.betFaced).toBe(2);
    expect(utg?.amountPutIn).toBe(2);
    expect(utg?.potBefore).toBe(3); // SB(1) + BB(2)
    expect(utg?.numActivePlayers).toBe(3);
    expect(utg?.position).toBe('BTN');
  });

  it('records the aggressor and price after a raise', () => {
    const { hand } = newHand();
    const recorder = recordSnapshots(hand, [
      ['P0', { kind: 'raise', amount: 6 }],
      ['P1', { kind: 'fold', amount: 0 }],
      ['P2', { kind: 'fold', amount: 0 }],
    ]);
    const facingRaise = recorder.snapshots().find(s => s.actorId === 'P1');
    expect(facingRaise?.aggressorId).toBe('P0');
    expect(facingRaise?.betFaced).toBe(5); // SB had 1 in, facing a raise to 6
  });
});

describe('buildHandRecord', () => {
  it('tags a fold-around result and keeps all hole cards', () => {
    const { hand, startStacks } = newHand();
    const recorder = recordSnapshots(hand, [
      ['P0', { kind: 'fold', amount: 0 }],
      ['P1', { kind: 'fold', amount: 0 }],
    ]);
    const record = buildHandRecord({
      id: 'h1', playedAt: 1000, config: CONFIG, finalState: hand.getState(),
      result: hand.resolve(), snapshots: recorder.snapshots(), startStacks,
    });
    expect(record.outcome.wentToShowdown).toBe(false);
    expect(record.outcome.winners).toContain('P2');
    // Hero is the BTN, posts no blind, folds → net 0, no line credited.
    expect(record.outcome.heroNet).toBe(0);
    expect(record.outcome.line).toBe('none');
    expect(record.holeCards.P0?.length).toBe(2);
    expect(record.holeCards.P2?.length).toBe(2);
  });

  it('captures the full board and showdown at hand end', () => {
    const { hand, startStacks } = newHand();
    const recorder = recordSnapshots(hand, [
      ['P0', { kind: 'call', amount: 2 }], ['P1', { kind: 'call', amount: 2 }], ['P2', { kind: 'check', amount: 0 }],
      ['P1', { kind: 'check', amount: 0 }], ['P2', { kind: 'check', amount: 0 }], ['P0', { kind: 'check', amount: 0 }],
      ['P1', { kind: 'check', amount: 0 }], ['P2', { kind: 'check', amount: 0 }], ['P0', { kind: 'check', amount: 0 }],
      ['P1', { kind: 'check', amount: 0 }], ['P2', { kind: 'check', amount: 0 }], ['P0', { kind: 'check', amount: 0 }],
    ]);
    const record = buildHandRecord({
      id: 'h2', playedAt: 2000, config: CONFIG, finalState: hand.getState(),
      result: hand.resolve(), snapshots: recorder.snapshots(), startStacks,
    });
    expect(record.board.length).toBe(5);
    expect(record.outcome.wentToShowdown).toBe(true);
    expect(Object.keys(record.holeCards)).toHaveLength(3);
  });
});

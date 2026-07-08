import { describe, expect, it } from 'vitest';
import { cards } from '../src/engine/deck';
import { mulberry32 } from '../src/engine/rng';
import { buildPlayerRead, type PlayerRead } from '../src/analysis/read';
import { exploitFor } from '../src/bots/exploit';
import { applyArchetype } from '../src/bots/archetype';
import { balancedBot, openCutFor } from '../src/bots/balanced';
import { profileForLevel } from '../src/bots/skill';
import type { BotArchetype } from '../src/bots/archetype';
import type { BotContext } from '../src/bots/types';
import type { DecisionSnapshot } from '../src/analysis/recorder';
import type { HandRecord } from '../src/analysis/record';
import type { Action, BotView, Card, Player, PlayerStatus, Street } from '../src/engine/types';

// ── fixtures ─────────────────────────────────────────────────────────────────

function pfSnap(action: Action, o: Partial<DecisionSnapshot> = {}): DecisionSnapshot {
  return {
    handNumber: 1, actorId: 'P0', street: 'preflop', action, potBefore: 6, betFaced: 0,
    amountPutIn: 0, position: 'BTN', inPosition: true, effectiveStack: 1000, spr: 100,
    currentBet: 2, numActivePlayers: 2, aggressorId: undefined, liveOpponentIds: ['P1'], board: [], ...o,
  };
}

function postSnap(street: Street, action: Action, o: Partial<DecisionSnapshot> = {}): DecisionSnapshot {
  return {
    handNumber: 1, actorId: 'P0', street, action, potBefore: 40, betFaced: 20, amountPutIn: 0,
    position: 'BTN', inPosition: true, effectiveStack: 500, spr: 5, currentBet: 20,
    numActivePlayers: 2, aggressorId: 'P1', liveOpponentIds: ['P1'], board: cards('Ks Qh 7d'), ...o,
  };
}

function rec(snapshots: readonly DecisionSnapshot[], o: Partial<HandRecord> = {}): HandRecord {
  return {
    version: 1, id: 'h', playedAt: 1,
    config: { playerCount: 2, smallBlind: 1, bigBlind: 2, difficulty: 5, dealerIndex: 0, humanId: 'P0', names: { P0: 'You', P1: 'Bot' } },
    holeCards: { P0: cards('Ah Kd'), P1: cards('2c 7h') },
    board: cards('Ks Qh 7d 4s 9c'),
    snapshots,
    outcome: { winners: ['P1'], wentToShowdown: true, heroWentToShowdown: false, heroNet: -20, heroNetBb: -10, line: 'none' },
    ...o,
  };
}

const READ_BASE: PlayerRead = {
  playerId: 'P0', hands: 60, confidence: 1, vpip: 0.3, foldToBet: 0.45, foldTurn: 0.45,
  foldRiver: 0.45, aggression: 0.5, wtsd: 0.28, wssd: 0.5, foldToSteal: 0.5, foldToThreeBet: 0.5,
};

function opp(id: string, status: PlayerStatus): Omit<Player, 'hole'> {
  return { id, name: id, isHuman: id === 'P0', stack: 1000, status, betThisStreet: 0, totalCommitted: 0 };
}

function botCtx(o: {
  read?: PlayerRead | undefined; exploit?: number; archetype?: BotArchetype;
  hole?: readonly Card[]; street?: Street; board?: readonly Card[]; toCall?: number;
  opponents?: readonly Omit<Player, 'hole'>[]; rng?: number;
}): BotContext {
  const self: Player = {
    id: 'P9', name: 'Bot', isHuman: false, stack: 1000, hole: o.hole ?? cards('Ah Kh'),
    status: 'active', betThisStreet: 0, totalCommitted: 0,
  };
  const view: BotView = {
    self, opponents: o.opponents ?? [opp('P0', 'active')], board: o.board ?? [],
    street: o.street ?? 'preflop', pot: 40, toCall: o.toCall ?? 0, minRaise: 2, bigBlind: 2,
    position: 'BTN', inPosition: true,
  };
  return {
    view, rng: mulberry32(o.rng ?? 1), skill: profileForLevel(6),
    read: 'read' in o ? o.read : READ_BASE, exploit: o.exploit ?? 1, archetype: o.archetype ?? 'balanced',
  };
}

// ── player read ──────────────────────────────────────────────────────────────

describe('buildPlayerRead', () => {
  it('scores a fold-happy human as folding to every bet', () => {
    const records = Array.from({ length: 20 }, () =>
      rec([pfSnap({ kind: 'call', amount: 2 }), postSnap('flop', { kind: 'fold', amount: 0 })]));
    const read = buildPlayerRead(records, 'P0');
    expect(read.hands).toBe(20);
    expect(read.foldToBet).toBe(1);
    expect(read.confidence).toBeGreaterThan(0);
  });

  it('scores a calling station as passive and never folding', () => {
    const records = Array.from({ length: 20 }, () =>
      rec([pfSnap({ kind: 'call', amount: 2 }), postSnap('flop', { kind: 'call', amount: 20 })]));
    const read = buildPlayerRead(records, 'P0');
    expect(read.foldToBet).toBe(0);
    expect(read.aggression).toBe(0);
  });

  it('leaves rates undefined below the sample minimum', () => {
    const read = buildPlayerRead([rec([pfSnap({ kind: 'fold', amount: 0 })])], 'P0');
    expect(read.foldToBet).toBeUndefined();
    expect(read.confidence).toBe(0);
  });
});

// ── exploit adjustments ──────────────────────────────────────────────────────

describe('exploitFor', () => {
  it('is neutral with no read or zero intensity', () => {
    expect(exploitFor(botCtx({ read: undefined })).bluffScale).toBe(1);
    expect(exploitFor(botCtx({ exploit: 0 })).bluffScale).toBe(1);
  });

  it('is neutral once the human has folded out of the pot', () => {
    const ex = exploitFor(botCtx({ read: { ...READ_BASE, foldToBet: 0.85 }, opponents: [opp('P0', 'folded')] }));
    expect(ex.weight).toBe(0);
    expect(ex.bluffScale).toBe(1);
  });

  it('bluffs more and value-bets thinner vs a folder', () => {
    const ex = exploitFor(botCtx({ read: { ...READ_BASE, foldToBet: 0.85 }, archetype: 'lag' }));
    expect(ex.bluffScale).toBeGreaterThan(1.2);
    expect(ex.valueCut).toBeGreaterThan(0);
  });

  it('stops bluffing but keeps value-betting vs a station', () => {
    const ex = exploitFor(botCtx({ read: { ...READ_BASE, foldToBet: 0.2, wtsd: 0.45, wssd: 0.4 } }));
    expect(ex.bluffScale).toBeLessThan(1);
    expect(ex.valueCut).toBeGreaterThan(0);
  });

  it('3-bet-bluffs and steals more vs a human who folds too much preflop', () => {
    const ex = exploitFor(botCtx({ read: { ...READ_BASE, foldToThreeBet: 0.8, foldToSteal: 0.8 }, archetype: 'lag' }));
    expect(ex.threeBet).toBeGreaterThan(0);
    expect(ex.stealCut).toBeGreaterThan(0);
  });
});

// ── personalities ────────────────────────────────────────────────────────────

describe('applyArchetype', () => {
  const base = profileForLevel(6);

  it('makes the maniac looser and more aggressive', () => {
    const m = applyArchetype(base, 'maniac');
    expect(m.aggression).toBeGreaterThan(base.aggression);
    expect(m.tightness).toBeLessThan(base.tightness);
  });

  it('makes the rock tighter and more passive', () => {
    const r = applyArchetype(base, 'rock');
    expect(r.tightness).toBeGreaterThan(base.tightness);
    expect(r.aggression).toBeLessThan(base.aggression);
  });

  it('leaves the balanced archetype untouched', () => {
    expect(applyArchetype(base, 'balanced')).toEqual(base);
  });
});

// ── position-aware opening ───────────────────────────────────────────────────

describe('openCutFor', () => {
  it('opens tighter up front and wider on the button', () => {
    const t = 0.5;
    expect(openCutFor('EP', t)).toBeGreaterThan(openCutFor('MP', t));
    expect(openCutFor('MP', t)).toBeGreaterThan(openCutFor('CO', t));
    expect(openCutFor('CO', t)).toBeGreaterThan(openCutFor('BTN', t));
  });

  it('opens tighter the tighter the profile', () => {
    expect(openCutFor('BTN', 0.8)).toBeGreaterThan(openCutFor('BTN', 0.2));
  });
});

// ── end-to-end bot behaviour ─────────────────────────────────────────────────

const KINDS: Action['kind'][] = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];

describe('balancedBot', () => {
  it('always returns a legal action kind', () => {
    for (const street of ['preflop', 'flop', 'river'] as Street[]) {
      const board = street === 'preflop' ? [] : cards('Ks Qh 7d');
      const a = balancedBot(botCtx({ street, board, toCall: street === 'preflop' ? 2 : 0 }));
      expect(KINDS).toContain(a.kind);
    }
  });

  it('stabs with air far more often when the read says the human folds', () => {
    const airBoard = cards('Ks Qh Td');
    const air = cards('2c 7h');
    const count = (read: PlayerRead | undefined) => {
      let bets = 0;
      for (let i = 0; i < 300; i++) {
        const a = balancedBot(botCtx({ read, archetype: 'lag', hole: air, board: airBoard, street: 'flop', toCall: 0, rng: i * 7 + 1 }));
        if (a.kind === 'bet') bets += 1;
      }
      return bets;
    };
    // The baseline isn't zero — the mistakeRate spew valve turns the odd check
    // into a bet — but a fold-happy read should stab meaningfully more often.
    const folderBets = count({ ...READ_BASE, foldToBet: 0.85 });
    const neutralBets = count(undefined);
    expect(folderBets).toBeGreaterThan(neutralBets + 12);
  });
});

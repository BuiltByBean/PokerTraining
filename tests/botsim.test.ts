/*
 * Headless bot simulation — the tuning yardstick. Plays many hands with each
 * personality seated and measures the resulting stat lines with the same
 * buildPlayerRead the bots use on the human, so we can see the bots play like
 * distinct, non-dumb opponents (and catch regressions in their ranges).
 */

import { describe, expect, it } from 'vitest';
import { Hand } from '../src/engine/game';
import { mulberry32, type Rng } from '../src/engine/rng';
import { positionOf, isInPosition } from '../src/engine/positions';
import { newRecorder } from '../src/analysis/recorder';
import { buildHandRecord, type HandRecord } from '../src/analysis/record';
import { buildPlayerRead, type PlayerRead } from '../src/analysis/read';
import { profileForLevel, jitter, type SkillProfile } from '../src/bots/skill';
import { applyArchetype, type BotArchetype } from '../src/bots/archetype';
import { balancedBot } from '../src/bots/balanced';
import type { Action, BotView, GameState, Player } from '../src/engine/types';

const SEATS: readonly BotArchetype[] = ['tag', 'lag', 'maniac', 'rock', 'station', 'balanced'];

function mkSeat(i: number): Player {
  return { id: `P${i}`, name: SEATS[i] ?? `P${i}`, isHuman: false, stack: 1000, hole: [], status: 'active', betThisStreet: 0, totalCommitted: 0 };
}

function buildView(state: GameState, playerId: string): BotView {
  const self = state.players.find(p => p.id === playerId) as Player;
  const isLive = (p: Player) => p.status === 'active' || p.status === 'allin';
  const opponents = state.players.filter(p => p.id !== playerId).map(({ hole: _h, ...rest }) => rest);
  const pot = state.players.reduce((s, p) => s + p.totalCommitted, 0);
  return {
    self, opponents, board: state.board, street: state.street, pot,
    toCall: Math.max(0, state.currentBet - self.betThisStreet), minRaise: state.minRaise, bigBlind: state.bigBlind,
    position: positionOf(state.players, state.dealerIndex, playerId),
    inPosition: isInPosition(state.players, state.dealerIndex, playerId, isLive),
  };
}

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function simulate(hands: number, difficulty: number, rng: Rng): PlayerRead[] {
  const seats = SEATS.map((_, i) => mkSeat(i));
  const skills = seats.map(s => applyArchetype(jitter(profileForLevel(difficulty), hashSeed(s.id)), archetypeOf(s.id)));
  const records: HandRecord[] = [];
  let dealer = 0;

  for (let n = 0; n < hands; n++) {
    for (const s of seats) if (s.stack <= 0) s.stack = 1000;
    dealer = (dealer + 1) % seats.length;
    const startStacks = Object.fromEntries(seats.map(s => [s.id, s.stack]));
    const hand = new Hand({ handNumber: n + 1, players: seats, dealerIndex: dealer, smallBlind: 1, bigBlind: 2, rng });
    const recorder = newRecorder();
    playOut(hand, recorder, skills as SkillProfile[], rng);
    const result = hand.resolve();
    for (const ep of hand.getState().players) { const s = seats.find(x => x.id === ep.id); if (s) s.stack = ep.stack; }
    records.push(buildHandRecord({
      id: `sim-${n}`, playedAt: n, config: cfg(seats, dealer), finalState: hand.getState(), result,
      snapshots: recorder.snapshots(), startStacks,
    }));
  }
  return seats.map(s => buildPlayerRead(records, s.id));
}

function playOut(hand: Hand, recorder: ReturnType<typeof newRecorder>, skills: SkillProfile[], rng: Rng): void {
  let guard = 0;
  while (!hand.isComplete() && guard++ < 400) {
    const st = hand.getState();
    const id = st.toAct;
    if (!id) break;
    const skill = skills[Number(id.slice(1))] as SkillProfile;
    const action = balancedBot({ view: buildView(st, id), rng, skill, read: undefined, exploit: 0, archetype: archetypeOf(id) });
    recorder.capture(st, id, action);
    try { hand.applyAction(id, action); } catch { hand.applyAction(id, { kind: 'fold', amount: 0 }); }
  }
}

function archetypeOf(id: string): BotArchetype {
  return SEATS[Number(id.slice(1))] ?? 'balanced';
}

function cfg(seats: readonly Player[], dealer: number) {
  const names: Record<string, string> = {};
  for (const s of seats) names[s.id] = s.name;
  return { playerCount: seats.length, smallBlind: 1, bigBlind: 2, difficulty: 8, dealerIndex: dealer, humanId: 'P0', names };
}

function pct(n: number | undefined): string {
  return n === undefined ? '  —' : `${Math.round(n * 100)}%`.padStart(4);
}

describe('bot simulation', () => {
  it('personalities produce distinct, sane stat lines', () => {
    const reads = simulate(1200, 8, mulberry32(2024));
    // eslint-disable-next-line no-console
    console.log('\narch      hands  vpip  fold→bet  aggr  fold→steal  fold→3bet');
    reads.forEach((r, i) => {
      // eslint-disable-next-line no-console
      console.log(
        `${(SEATS[i] ?? '').padEnd(9)} ${String(r.hands).padStart(5)}  ${pct(r.vpip)}  ${pct(r.foldToBet).padStart(6)}   ${pct(r.aggression)}   ${pct(r.foldToSteal).padStart(7)}   ${pct(r.foldToThreeBet).padStart(6)}`,
      );
    });

    const read = (a: BotArchetype): PlayerRead => reads[SEATS.indexOf(a)] as PlayerRead;
    const num = (v: number | undefined): number => { expect(v).toBeDefined(); return v as number; };

    // Every seat plays a sane, non-degenerate range and folds a real fraction.
    for (const r of reads) {
      expect(r.hands).toBeGreaterThan(400);
      expect(num(r.vpip)).toBeGreaterThan(0.1);
      expect(num(r.vpip)).toBeLessThan(0.6);
      expect(num(r.foldToBet)).toBeGreaterThan(0.2); // not a calling station
    }

    // Personalities are actually distinct: loose vs tight, aggressive vs passive.
    expect(num(read('maniac').vpip) - num(read('rock').vpip)).toBeGreaterThan(0.12);
    expect(num(read('station').vpip)).toBeGreaterThan(num(read('rock').vpip));
    expect(num(read('rock').foldToBet) - num(read('station').foldToBet)).toBeGreaterThan(0.04);
    expect(num(read('maniac').aggression) - num(read('station').aggression)).toBeGreaterThan(0.1);
  });

  it('difficulty still matters: low plays looser and calls down more', () => {
    const easy = simulate(700, 3, mulberry32(7));
    const hard = simulate(700, 9, mulberry32(7));
    const avg = (rs: PlayerRead[], f: 'vpip' | 'foldToBet'): number =>
      rs.reduce((s, r) => s + (r[f] ?? 0), 0) / rs.length;
    expect(avg(easy, 'vpip')).toBeGreaterThan(avg(hard, 'vpip'));       // looser at low difficulty
    expect(avg(hard, 'foldToBet')).toBeGreaterThan(avg(easy, 'foldToBet')); // more disciplined at high
  });
});

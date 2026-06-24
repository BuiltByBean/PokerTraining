/*
 * Hand state machine. One instance per hand. The engine is event-sourced:
 * external callers (UI, bot) push Actions in via applyAction(); the game
 * never reaches out. After every applied action, the caller inspects state
 * (current street, who's to act, pots) and decides what to do next — deal
 * the next street, request the next action, or resolve showdown.
 *
 * Why a class and not a reducer? Hold'em has a lot of interlocking little
 * fields (currentBet, minRaise, betThisStreet on each player, lastAggressor)
 * that all change together every action. A class with private mutation is
 * easier to read than 200 lines of `{...state, players: state.players.map(...)}`.
 * The CALLER still treats the engine as read-only via getState().
 */

import { evaluate, type HandEval } from './evaluator';
import type { Rng } from './rng';
import { buildSidePots } from './sidepots';
import { deal, freshDeck, shuffled } from './deck';
import type {
  Action,
  Card,
  GameState,
  LogEntry,
  Player,
  PlayerStatus,
  PotShare,
  Street,
} from './types';

export interface NewHandConfig {
  readonly handNumber: number;
  readonly players: readonly Player[];
  readonly dealerIndex: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly rng: Rng;
}

export interface ShowdownResult {
  readonly pots: readonly PotShare[];
  /** For each pot, the winners and per-pot winning eval(s). */
  readonly awards: readonly PotAward[];
  /** Final stacks after pots distributed. */
  readonly finalStacks: ReadonlyMap<string, number>;
}

export interface PotAward {
  readonly pot: PotShare;
  readonly winners: readonly string[];
  readonly eval: HandEval | undefined;
}

export class Hand {
  private state: GameStateInternal;
  private readonly deck: Card[];

  constructor(cfg: NewHandConfig) {
    this.deck = shuffled(freshDeck(), cfg.rng);

    // Reset per-hand player fields without mutating caller's array.
    const players: PlayerInternal[] = cfg.players.map(p => ({
      ...p,
      hole: [],
      status: p.stack > 0 ? 'active' : 'sittingout',
      betThisStreet: 0,
      totalCommitted: 0,
    }));

    this.state = {
      handNumber: cfg.handNumber,
      bigBlind: cfg.bigBlind,
      smallBlind: cfg.smallBlind,
      players,
      dealerIndex: cfg.dealerIndex,
      board: [],
      street: 'preflop',
      currentBet: 0,
      minRaise: cfg.bigBlind,
      toAct: undefined,
      pots: [],
      log: [],
      lastAggressor: undefined,
      streetOpenerIndex: -1,
    };

    this.postBlinds();
    this.dealHoleCards();
    this.state.toAct = this.firstToActPreflop();
  }

  // ── public API ────────────────────────────────────────────────────────────

  getState(): GameState {
    // Strip internal-only fields before exposing to the outside world.
    const { lastAggressor: _l, streetOpenerIndex: _s, ...rest } = this.state;
    return rest;
  }

  /** True when there's nothing left to do — pots assigned, hand over. */
  isComplete(): boolean {
    return this.state.street === 'complete';
  }

  /** Active players who are not all-in and still have chips. */
  private actionablePlayers(): PlayerInternal[] {
    return this.state.players.filter(p => p.status === 'active' && p.stack > 0);
  }

  /** Players still in the hand (active or all-in). */
  private liveContenders(): PlayerInternal[] {
    return this.state.players.filter(p => p.status === 'active' || p.status === 'allin');
  }

  /**
   * Apply an action from the current player. Throws on illegal action so
   * caller bugs surface immediately rather than silently corrupting state.
   */
  applyAction(playerId: string, action: Action): void {
    if (this.state.toAct !== playerId) {
      throw new Error(`Not ${playerId}'s turn (it's ${this.state.toAct ?? 'nobody'}'s)`);
    }
    const player = this.requirePlayer(playerId);
    const legal = legalActions(this.state, player);
    if (!legal.has(action.kind)) {
      throw new Error(`Illegal action ${action.kind} for ${player.name} (legal: ${[...legal].join(',')})`);
    }

    switch (action.kind) {
      case 'fold':    this.doFold(player); break;
      case 'check':   this.doCheck(player); break;
      case 'call':    this.doCall(player); break;
      case 'bet':     this.doBetOrRaise(player, action.amount); break;
      case 'raise':   this.doBetOrRaise(player, action.amount); break;
      case 'allin':   this.doAllIn(player); break;
    }
    this.state.log = [...this.state.log, { playerId, action, street: this.state.street }];
    this.advance();
  }

  /** Returns the showdown result. Only meaningful after isComplete() is true. */
  resolve(): ShowdownResult {
    if (this.state.street !== 'complete') {
      throw new Error('Hand not complete');
    }
    return this.state.lastResult as ShowdownResult;
  }

  /** Returns the legal action kinds for the player currently to act. */
  legal(): ReadonlySet<Action['kind']> {
    if (!this.state.toAct) return new Set();
    return legalActions(this.state, this.requirePlayer(this.state.toAct));
  }

  /** Public view of the current pot total (committed across all streets). */
  potTotal(): number {
    return this.state.players.reduce((sum, p) => sum + p.totalCommitted, 0);
  }

  // ── setup ─────────────────────────────────────────────────────────────────

  private postBlinds(): void {
    const active = this.actionablePlayers();
    // Heads-up special: SB is on the button, BB is the other player.
    if (active.length === 2) {
      const sb = this.state.players[this.state.dealerIndex] as PlayerInternal;
      const bb = this.nextActiveAfter(this.state.dealerIndex);
      this.commitChips(sb, this.state.smallBlind);
      this.commitChips(bb, this.state.bigBlind);
    } else {
      const sb = this.nextActiveAfter(this.state.dealerIndex);
      const bb = this.nextActiveAfterPlayer(sb);
      this.commitChips(sb, this.state.smallBlind);
      this.commitChips(bb, this.state.bigBlind);
    }
    this.state.currentBet = this.state.bigBlind;
    this.state.minRaise = this.state.bigBlind;
  }

  private dealHoleCards(): void {
    const active = this.state.players.filter(p => p.status === 'active');
    // Two passes — one card to each player at a time, dealer-clockwise.
    for (let pass = 0; pass < 2; pass++) {
      for (const p of active) {
        const [c] = deal(this.deck, 1);
        if (!c) throw new Error('Deck exhausted dealing hole cards');
        p.hole = [...p.hole, c];
      }
    }
  }

  private firstToActPreflop(): string | undefined {
    const active = this.actionablePlayers();
    if (active.length < 2) return undefined;
    if (active.length === 2) {
      // Heads-up: SB (dealer) acts first preflop.
      return (this.state.players[this.state.dealerIndex] as PlayerInternal).id;
    }
    // Otherwise: under-the-gun = player after BB.
    const sb = this.nextActiveAfter(this.state.dealerIndex);
    const bb = this.nextActiveAfterPlayer(sb);
    const utg = this.nextActiveAfterPlayer(bb);
    this.state.streetOpenerIndex = this.indexOf(utg);
    return utg.id;
  }

  // ── action handlers ───────────────────────────────────────────────────────

  private doFold(p: PlayerInternal): void {
    p.status = 'folded';
  }

  private doCheck(p: PlayerInternal): void {
    if (p.betThisStreet !== this.state.currentBet) {
      throw new Error('Cannot check when there is a bet to call');
    }
  }

  private doCall(p: PlayerInternal): void {
    const owed = this.state.currentBet - p.betThisStreet;
    const pay = Math.min(owed, p.stack);
    this.commitChips(p, pay);
    if (p.stack === 0) p.status = 'allin';
  }

  private doBetOrRaise(p: PlayerInternal, target: number): void {
    // `target` is the player's NEW betThisStreet level (their total street bet
    // after the action), matching the Action.amount convention in types.ts.
    const owed = target - p.betThisStreet;
    if (owed <= 0) throw new Error('Raise must be greater than current bet');
    if (owed > p.stack) throw new Error('Not enough chips');
    const raiseSize = target - this.state.currentBet;
    if (raiseSize < this.state.minRaise && owed < p.stack) {
      throw new Error(`Min raise is ${this.state.minRaise}`);
    }
    this.commitChips(p, owed);
    this.state.minRaise = Math.max(this.state.minRaise, raiseSize);
    this.state.currentBet = target;
    this.state.lastAggressor = p.id;
    if (p.stack === 0) p.status = 'allin';
  }

  private doAllIn(p: PlayerInternal): void {
    const target = p.betThisStreet + p.stack;
    if (target > this.state.currentBet) {
      // All-in counts as a raise; min-raise updates if it meets the threshold.
      const raiseSize = target - this.state.currentBet;
      if (raiseSize >= this.state.minRaise) {
        this.state.minRaise = raiseSize;
        this.state.lastAggressor = p.id;
      }
      this.state.currentBet = target;
    }
    this.commitChips(p, p.stack);
    p.status = 'allin';
  }

  private commitChips(p: PlayerInternal, amount: number): void {
    if (amount <= 0) return;
    if (amount > p.stack) amount = p.stack;
    p.stack -= amount;
    p.betThisStreet += amount;
    p.totalCommitted += amount;
  }

  // ── state advance ─────────────────────────────────────────────────────────

  private advance(): void {
    // Hand ends immediately when only one contender remains (everyone else folded).
    const contenders = this.liveContenders();
    if (contenders.length <= 1) {
      this.finishWithoutShowdown(contenders);
      return;
    }

    if (this.isStreetClosed()) {
      this.completeStreet();
    } else {
      this.state.toAct = this.nextToActIdFrom(this.state.toAct as string);
    }
  }

  /**
   * A street closes when every still-active player (not all-in, not folded)
   * has matched currentBet AND has acted at least once this street.
   */
  private isStreetClosed(): boolean {
    const live = this.actionablePlayers();
    if (live.length === 0) return true;

    for (const p of live) {
      if (p.betThisStreet !== this.state.currentBet) return false;
      if (!this.hasActedThisStreet(p)) return false;
    }
    return true;
  }

  private hasActedThisStreet(p: PlayerInternal): boolean {
    return this.state.log.some(e => e.playerId === p.id && e.street === this.state.street);
  }

  private completeStreet(): void {
    // Carry over: reset per-street bets but keep totalCommitted for pot calc.
    for (const p of this.state.players) p.betThisStreet = 0;
    this.state.currentBet = 0;
    this.state.minRaise = this.state.bigBlind;
    this.state.lastAggressor = undefined;

    const next = nextStreet(this.state.street);
    this.state.street = next;

    if (next === 'flop') this.burnAndDeal(3);
    else if (next === 'turn' || next === 'river') this.burnAndDeal(1);

    if (next === 'showdown') {
      this.runShowdown();
      return;
    }

    // If only one or zero players can still act voluntarily, deal remaining
    // streets without prompting — the all-in players just see the cards.
    if (this.actionablePlayers().length <= 1) {
      this.state.toAct = undefined;
      this.completeStreet();
      return;
    }

    this.state.toAct = this.firstToActPostflop();
  }

  private burnAndDeal(n: number): void {
    deal(this.deck, 1); // burn
    const cards = deal(this.deck, n);
    this.state.board = [...this.state.board, ...cards];
  }

  private firstToActPostflop(): string | undefined {
    // First active player clockwise from the dealer.
    const start = (this.state.dealerIndex + 1) % this.state.players.length;
    for (let i = 0; i < this.state.players.length; i++) {
      const idx = (start + i) % this.state.players.length;
      const p = this.state.players[idx] as PlayerInternal;
      if (p.status === 'active' && p.stack > 0) {
        this.state.streetOpenerIndex = idx;
        return p.id;
      }
    }
    return undefined;
  }

  private finishWithoutShowdown(contenders: readonly PlayerInternal[]): void {
    // Single winner scoops the whole pot regardless of best hand.
    const pots = buildSidePots(this.state.players);
    const winnerId = contenders[0]?.id;
    if (!winnerId) {
      // Pathological — no contenders. Just refund.
      this.state.pots = pots;
      this.state.street = 'complete';
      this.state.lastResult = { pots, awards: [], finalStacks: this.stacksSnapshot() };
      return;
    }
    const awards: PotAward[] = pots.map(pot => ({
      pot,
      winners: pot.eligible.includes(winnerId) ? [winnerId] : [],
      eval: undefined,
    }));
    this.payouts(awards);
    this.state.pots = pots;
    this.state.street = 'complete';
    this.state.toAct = undefined;
    this.state.lastResult = { pots, awards, finalStacks: this.stacksSnapshot() };
  }

  private runShowdown(): void {
    const pots = buildSidePots(this.state.players);
    const evals = new Map<string, HandEval>();
    for (const p of this.state.players) {
      if (p.status === 'folded') continue;
      const seven = [...p.hole, ...this.state.board];
      evals.set(p.id, evaluate(seven));
    }
    const awards: PotAward[] = pots.map(pot => {
      const ranked = pot.eligible
        .map(id => ({ id, e: evals.get(id) }))
        .filter((x): x is { id: string; e: HandEval } => !!x.e)
        .sort((a, b) => b.e.score - a.e.score);
      if (ranked.length === 0) return { pot, winners: [], eval: undefined };
      const top = ranked[0]?.e.score ?? 0;
      const winners = ranked.filter(r => r.e.score === top).map(r => r.id);
      return { pot, winners, eval: ranked[0]?.e };
    });
    this.payouts(awards);
    this.state.pots = pots;
    this.state.street = 'complete';
    this.state.toAct = undefined;
    this.state.lastResult = { pots, awards, finalStacks: this.stacksSnapshot() };
  }

  private payouts(awards: readonly PotAward[]): void {
    for (const a of awards) {
      if (a.winners.length === 0) continue;
      const share = Math.floor(a.pot.amount / a.winners.length);
      const remainder = a.pot.amount - share * a.winners.length;
      a.winners.forEach((id, i) => {
        const p = this.requirePlayer(id);
        // Convention: odd chip goes to the first eligible winner clockwise
        // from the dealer. For our purposes "first in winners array" is
        // sufficient — players are stored in seat order.
        p.stack += share + (i === 0 ? remainder : 0);
      });
    }
  }

  private stacksSnapshot(): Map<string, number> {
    const m = new Map<string, number>();
    for (const p of this.state.players) m.set(p.id, p.stack);
    return m;
  }

  // ── seat math ─────────────────────────────────────────────────────────────

  private nextActiveAfter(index: number): PlayerInternal {
    const n = this.state.players.length;
    for (let i = 1; i <= n; i++) {
      const p = this.state.players[(index + i) % n] as PlayerInternal;
      if (p.status === 'active') return p;
    }
    throw new Error('No active players');
  }

  private nextActiveAfterPlayer(p: PlayerInternal): PlayerInternal {
    return this.nextActiveAfter(this.indexOf(p));
  }

  private nextToActIdFrom(currentId: string): string | undefined {
    const start = this.state.players.findIndex(p => p.id === currentId);
    const n = this.state.players.length;
    for (let i = 1; i <= n; i++) {
      const p = this.state.players[(start + i) % n] as PlayerInternal;
      if (p.status === 'active' && p.stack > 0) return p.id;
    }
    return undefined;
  }

  private indexOf(p: PlayerInternal): number {
    return this.state.players.findIndex(x => x.id === p.id);
  }

  private requirePlayer(id: string): PlayerInternal {
    const p = this.state.players.find(x => x.id === id);
    if (!p) throw new Error(`No player ${id}`);
    return p as PlayerInternal;
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function nextStreet(s: Street): Street {
  switch (s) {
    case 'preflop': return 'flop';
    case 'flop':    return 'turn';
    case 'turn':    return 'river';
    case 'river':   return 'showdown';
    default:        return s;
  }
}

/**
 * Compute the legal action kinds for `p`, given the current state. Pure —
 * exported so the UI can grey out the action bar buttons consistently.
 */
export function legalActions(state: GameState, p: Player): Set<Action['kind']> {
  const out = new Set<Action['kind']>();
  if (p.status !== 'active') return out;
  const owed = state.currentBet - p.betThisStreet;
  out.add('fold');
  if (owed === 0) {
    out.add('check');
    if (p.stack > 0) out.add('bet');
  } else {
    if (p.stack > 0) out.add('call');
    if (p.stack > owed) out.add('raise');
  }
  if (p.stack > 0) out.add('allin');
  return out;
}

// ── internal types ────────────────────────────────────────────────────────

type PlayerInternal = Player & { status: PlayerStatus };

interface GameStateInternal extends GameState {
  players: PlayerInternal[];
  log: LogEntry[];
  board: Card[];
  street: Street;
  currentBet: number;
  minRaise: number;
  toAct: string | undefined;
  pots: PotShare[];
  lastAggressor: string | undefined;
  /** Seat index of the player who opened action this street; the street ends
   *  when action wraps back to them without a new raise. */
  streetOpenerIndex: number;
  lastResult?: ShowdownResult;
}

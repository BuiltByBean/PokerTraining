/*
 * App bootstrap + game loop.
 *
 * The loop is event-driven, not on a setInterval. After each rendered frame
 * we check whose turn it is:
 *   - human → wait for them to click an action; the action handler triggers
 *     the next frame.
 *   - bot → schedule the bot's decision on a short timeout (so the player
 *     can read what's happening), then advance.
 *
 * Hand boundaries are explicit: when the engine reports `isComplete()` we
 * show the showdown overlay and wait for the user to dismiss it before
 * starting the next hand.
 */

import { Hand } from './engine/game';
import { cryptoSeed, mulberry32, type Rng } from './engine/rng';
import type { Action, Card, GameState, Player } from './engine/types';
import { PERSONAS } from './bots/registry';
import { renderActionBar, renderBetSlider } from './ui/actions';
import { cardSetKey, renderTable } from './ui/table';
import { renderShowdown, renderWelcome } from './ui/overlay';
import { clearSave, loadRecord, loadSave, saveRecord, saveSave } from './persistence/save';

interface AppState {
  readonly humanId: string;
  readonly seats: Player[];
  hand?: Hand | undefined;
  dealerIndex: number;
  handNumber: number;
  rng: Rng;
  /** Player id → last action label, cleared at start of each street. */
  bubbles: Map<string, string>;
  /** Cards (rank-suit key) that belong to the winning hand at showdown. */
  winningCards: Set<string>;
  /** Player ids whose hole cards should be revealed at showdown. */
  revealedHole: Set<string>;
  /** Currently-shown overlay: 'none' | 'welcome' | 'showdown'. */
  overlay: 'none' | 'welcome' | 'showdown';
  /** True while the slider is replacing the action bar. */
  sliderOpen: boolean;
  /** Pending bot timeout id, so we can cancel on hand end. */
  botTimer?: number | undefined;
  record: number;
}

const STARTING_STACK = 1000;
const BB = 2;
const SB = 1;
const BOT_THINK_MIN = 600;
const BOT_THINK_MAX = 1100;
const BUBBLE_LINGER_MS = 1400;

const stage = document.getElementById('stage') as HTMLElement;
const recordEl = document.getElementById('record') as HTMLElement;

const seats: Player[] = [
  buildPlayer('P0', 'You', true),
  ...PERSONAS.map((p, i) => buildPlayer(`P${i + 1}`, p.name, false)),
];

const app: AppState = {
  humanId: 'P0',
  seats,
  dealerIndex: 0,
  handNumber: 0,
  rng: mulberry32(cryptoSeed()),
  bubbles: new Map(),
  winningCards: new Set(),
  revealedHole: new Set(),
  overlay: 'welcome',
  sliderOpen: false,
  record: loadRecord(),
};

bootstrap();

// ── lifecycle ─────────────────────────────────────────────────────────────

function bootstrap(): void {
  hydrateFromSave();
  // Initial label only — don't promote the starting stack to a "record".
  recordEl.textContent = `Record $${app.record.toLocaleString()}`;
  render();

  // Slider open request flows through a document event so the action bar
  // (which doesn't own the slider's parent) can request it.
  document.addEventListener('pt:open-slider', () => {
    app.sliderOpen = true;
    render();
  });
}

function hydrateFromSave(): void {
  const save = loadSave();
  if (Object.keys(save.stacks).length === 0) return;
  for (const seat of app.seats) {
    const s = save.stacks[seat.id];
    if (typeof s === 'number' && s >= 0) seat.stack = s;
  }
  app.dealerIndex = save.dealerIndex;
  app.handNumber = save.handNumber;
}

function startNewSession(): void {
  for (const seat of app.seats) seat.stack = STARTING_STACK;
  app.dealerIndex = 0;
  app.handNumber = 0;
  clearSave();
  dealNextHand();
}

function dealNextHand(): void {
  // Anyone busted gets staked back. Casual game, not a tournament.
  for (const seat of app.seats) {
    if (seat.stack <= 0) seat.stack = STARTING_STACK;
  }
  app.handNumber += 1;
  app.dealerIndex = nextDealer(app.dealerIndex);
  app.bubbles = new Map();
  app.winningCards = new Set();
  app.revealedHole = new Set();
  app.overlay = 'none';
  app.sliderOpen = false;
  app.hand = new Hand({
    handNumber: app.handNumber,
    players: app.seats,
    dealerIndex: app.dealerIndex,
    smallBlind: SB,
    bigBlind: BB,
    rng: app.rng,
  });
  persist();
  render();
  scheduleNextTurn();
}

function nextDealer(idx: number): number {
  return (idx + 1) % app.seats.length;
}

// ── turn handling ─────────────────────────────────────────────────────────

function scheduleNextTurn(): void {
  if (!app.hand) return;
  if (app.hand.isComplete()) {
    finishHand();
    return;
  }
  const state = app.hand.getState();
  if (!state.toAct) return;

  if (state.toAct === app.humanId) {
    // Human's turn — just render and wait for click.
    render();
    return;
  }

  // Bot turn — render so the player sees the table, then think.
  render();
  const thinkMs = BOT_THINK_MIN + Math.floor(app.rng.next() * (BOT_THINK_MAX - BOT_THINK_MIN));
  app.botTimer = window.setTimeout(() => takeBotTurn(state.toAct as string), thinkMs);
}

function takeBotTurn(playerId: string): void {
  if (!app.hand || app.hand.isComplete()) return;
  const persona = PERSONAS.find(p => p.name === seatById(playerId).name);
  if (!persona) return;
  const view = buildBotView(app.hand.getState(), playerId);
  const action = persona.bot({ view, rng: app.rng });
  applyAction(playerId, action);
}

function applyAction(playerId: string, action: Action): void {
  if (!app.hand) return;
  try {
    app.hand.applyAction(playerId, action);
  } catch (err) {
    // If a bot returns an illegal action, fall back to fold/check so we
    // never deadlock. (Indicates a bug — log it loudly.)
    console.error('Illegal action, falling back:', err);
    const safe: Action = action.kind === 'check' || action.kind === 'fold'
      ? action
      : { kind: 'fold', amount: 0 };
    if (action !== safe) app.hand.applyAction(playerId, safe);
  }
  showBubble(playerId, labelForAction(action));
  scheduleNextTurn();
}

function showBubble(playerId: string, text: string): void {
  app.bubbles.set(playerId, text);
  // Clear after a brief delay so the bubble doesn't stick the entire street.
  window.setTimeout(() => {
    if (app.bubbles.get(playerId) === text) {
      app.bubbles.delete(playerId);
      render();
    }
  }, BUBBLE_LINGER_MS);
}

function labelForAction(a: Action): string {
  switch (a.kind) {
    case 'fold':  return 'Fold';
    case 'check': return 'Check';
    case 'call':  return 'Call';
    case 'bet':   return `Bet $${a.amount}`;
    case 'raise': return `Raise $${a.amount}`;
    case 'allin': return 'All-in';
  }
}

function finishHand(): void {
  if (!app.hand) return;
  const result = app.hand.resolve();
  const state = app.hand.getState();

  // Sync stacks back from the engine — the engine works on a clone of the
  // player objects, so without this step app.seats sees stale stacks and the
  // record never updates.
  for (const enginePlayer of state.players) {
    const seat = app.seats.find(s => s.id === enginePlayer.id);
    if (seat) seat.stack = enginePlayer.stack;
  }

  // Reveal cards for any player still live at the river.
  app.revealedHole = new Set(state.players
    .filter(p => p.status !== 'folded' && state.street === 'complete' && state.board.length === 5)
    .map(p => p.id));

  // Highlight the winning 5 cards from the main pot.
  const mainEval = result.awards[0]?.eval;
  if (mainEval) app.winningCards = cardSetKey(mainEval.best5);

  app.overlay = 'showdown';
  updateRecord();
  persist();
  render();
}

function continueAfterShowdown(): void {
  if (app.botTimer) window.clearTimeout(app.botTimer);
  dealNextHand();
}

// ── persistence ───────────────────────────────────────────────────────────

function persist(): void {
  const stacks: Record<string, number> = {};
  for (const s of app.seats) stacks[s.id] = s.stack;
  saveSave({ stacks, dealerIndex: app.dealerIndex, handNumber: app.handNumber });
}

function updateRecord(): void {
  const human = seatById(app.humanId);
  if (human.stack > app.record) {
    app.record = human.stack;
    saveRecord(app.record);
  }
  recordEl.textContent = `Record $${app.record.toLocaleString()}`;
}

// ── render ────────────────────────────────────────────────────────────────

function render(): void {
  const children: HTMLElement[] = [];

  if (app.hand) {
    const state = app.hand.getState();
    children.push(renderTable(state, {
      humanId: app.humanId,
      bubbles: app.bubbles,
      winningCards: app.winningCards,
      revealHole: app.revealedHole,
    }));
    if (state.toAct === app.humanId && !app.sliderOpen && app.overlay === 'none') {
      children.push(renderActionBar({ humanId: app.humanId, state }, {
        onAction: a => applyAction(app.humanId, a),
      }));
    }
    if (app.sliderOpen && state.toAct === app.humanId) {
      children.push(renderBetSlider({ humanId: app.humanId, state }, {
        onConfirm: a => {
          app.sliderOpen = false;
          applyAction(app.humanId, a);
        },
        onCancel: () => {
          app.sliderOpen = false;
          render();
        },
      }));
    }
    if (app.overlay === 'showdown') {
      children.push(renderShowdown({
        result: app.hand.resolve(),
        humanId: app.humanId,
        nameFor: id => seatById(id).name,
        onContinue: continueAfterShowdown,
      }));
    }
  }

  if (app.overlay === 'welcome') {
    const save = loadSave();
    const hasSave = Object.keys(save.stacks).length > 0;
    children.push(renderWelcome({
      hasSave,
      ...(hasSave ? { savedStack: save.stacks[app.humanId] ?? STARTING_STACK } : {}),
      onNewGame: startNewSession,
      ...(hasSave ? {
        onResume: () => {
          app.overlay = 'none';
          dealNextHand();
        },
      } : {}),
    }));
  }

  stage.replaceChildren(...children);
}

// ── helpers ───────────────────────────────────────────────────────────────

function buildPlayer(id: string, name: string, isHuman: boolean): Player {
  return {
    id,
    name,
    isHuman,
    stack: STARTING_STACK,
    hole: [],
    status: 'active',
    betThisStreet: 0,
    totalCommitted: 0,
  };
}

function seatById(id: string): Player {
  const p = app.seats.find(s => s.id === id);
  if (!p) throw new Error(`No seat ${id}`);
  return p;
}

function buildBotView(state: GameState, playerId: string) {
  const self = state.players.find(p => p.id === playerId);
  if (!self) throw new Error(`Bot ${playerId} not seated`);
  const opponents = state.players
    .filter(p => p.id !== playerId)
    .map(({ hole: _h, ...rest }) => rest);
  const pot = state.players.reduce((s, p) => s + p.totalCommitted, 0);
  const toCall = Math.max(0, state.currentBet - self.betThisStreet);
  return {
    self,
    opponents,
    board: state.board,
    street: state.street,
    pot,
    toCall,
    minRaise: state.minRaise,
    bigBlind: state.bigBlind,
  };
}

// Unused import guard: 'Card' is imported only for type reference in JSDoc.
export type { Card };

/*
 * App bootstrap + game loop + screen router.
 *
 * Three screens share one stage: 'setup' (choose table), 'game' (play), and
 * 'dashboard'/'review' (analysis). A plain `screen` discriminator routes
 * render() — no router lib. The game loop is event-driven: after each action we
 * inspect whose turn it is and either wait for the human, schedule a bot on a
 * short timer, or finish the hand.
 *
 * Every hand is recorded (an external observer reading getState(), so the
 * engine stays pure), analyzed for leaks, and appended to capped history.
 */

import { Hand } from './engine/game';
import { cryptoSeed, mulberry32, type Rng } from './engine/rng';
import type { Action, GameState, Player } from './engine/types';
import { PERSONAS } from './bots/registry';
import { profileForLevel, jitter } from './bots/skill';
import { newRecorder, type Recorder } from './analysis/recorder';
import { buildHandRecord, type HandConfig, type HandRecord } from './analysis/record';
import { analyzeHand, type HandAnalysis } from './analysis/index';
import { appendHand, getAllHands, clearHistory, exportHands } from './persistence/history';
import {
  loadConfig, saveConfig, loadRecord, saveRecord, loadSave, saveSave, clearSave,
  type GameConfig,
} from './persistence/save';
import { renderActionBar, renderBetSlider } from './ui/actions';
import { cardSetKey, renderTable } from './ui/table';
import { renderShowdown } from './ui/overlay';
import { renderSetup } from './ui/setup';
import { renderDashboard } from './ui/dashboard';
import { renderHandReview } from './ui/replay';
import { renderAnalysisPanel } from './ui/analysisPanel';

type Screen = 'setup' | 'game' | 'dashboard' | 'review';

interface AppState {
  screen: Screen;
  config: GameConfig;
  readonly humanId: string;
  seats: Player[];
  hand: Hand | undefined;
  dealerIndex: number;
  handNumber: number;
  rng: Rng;
  recorder: Recorder | undefined;
  startStacks: Record<string, number>;
  bubbles: Map<string, string>;
  winningCards: Set<string>;
  /** Opponents the player chose to peek at this hand (reset each hand). */
  manualReveals: Set<string>;
  /** Hero folded/busted but the hand plays on — we watch. */
  spectating: boolean;
  overlay: 'none' | 'showdown';
  analysis: HandAnalysis | undefined;
  analysisOpen: boolean;
  reviewRecord: HandRecord | undefined;
  historyCache: readonly HandRecord[];
  sliderOpen: boolean;
  botTimer: number | undefined;
  record: number;
}

const STARTING_STACK = 1000;
const SB = 1;
const BB = 2;
const BOT_THINK_MIN = 550;
const BOT_THINK_MAX = 1050;
const BUBBLE_LINGER_MS = 1500;

const stage = document.getElementById('stage') as HTMLElement;
const recordEl = document.getElementById('record') as HTMLElement;

const app: AppState = {
  screen: 'setup',
  config: loadConfig(),
  humanId: 'P0',
  seats: [],
  hand: undefined,
  dealerIndex: 0,
  handNumber: 0,
  rng: mulberry32(cryptoSeed()),
  recorder: undefined,
  startStacks: {},
  bubbles: new Map(),
  winningCards: new Set(),
  manualReveals: new Set(),
  spectating: false,
  overlay: 'none',
  analysis: undefined,
  analysisOpen: false,
  reviewRecord: undefined,
  historyCache: [],
  sliderOpen: false,
  botTimer: undefined,
  record: loadRecord(),
};

bootstrap();

// ── lifecycle ─────────────────────────────────────────────────────────────

function bootstrap(): void {
  recordEl.textContent = `Record $${app.record.toLocaleString()}`;
  wireNav();
  document.addEventListener('pt:open-slider', () => { app.sliderOpen = true; render(); });
  render();
}

function wireNav(): void {
  byId('nav-table').addEventListener('click', goToGame);
  byId('nav-stats').addEventListener('click', goToDashboard);
  byId('nav-setup').addEventListener('click', goToSetup);
}

function goToSetup(): void {
  clearTimers();
  app.screen = 'setup';
  render();
}

function goToGame(): void {
  clearTimers();
  // No table set up yet (e.g. opened straight to Stats) → go pick a table
  // instead of trying to deal a hand with zero players.
  if (app.seats.length === 0) { goToSetup(); return; }
  app.screen = 'game';
  if (!app.hand) { dealNextHand(); return; }
  render();
  // A hand was mid-flight when we navigated away; its bot timer was cleared, so
  // resume the loop. (isComplete guard avoids re-finishing a finished hand.)
  if (app.overlay === 'none' && !app.hand.isComplete()) scheduleNextTurn();
}

async function goToDashboard(): Promise<void> {
  clearTimers();
  app.screen = 'dashboard';
  render(); // switch immediately (with whatever's cached), then refresh
  app.historyCache = await getAllHands();
  if (app.screen === 'dashboard') render();
}

function startSession(config: GameConfig, resume: boolean): void {
  saveConfig(config);
  app.config = config;
  app.seats = buildSeats(config.playerCount);
  if (resume) hydrateFromSave();
  else { app.dealerIndex = 0; app.handNumber = 0; clearSave(); }
  app.screen = 'game';
  dealNextHand();
}

function buildSeats(count: number): Player[] {
  const seats: Player[] = [mkPlayer('P0', 'You', true)];
  for (let i = 1; i < count; i++) {
    const persona = PERSONAS[(i - 1) % PERSONAS.length];
    seats.push(mkPlayer(`P${i}`, persona?.name ?? `Bot ${i}`, false));
  }
  return seats;
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

function dealNextHand(): void {
  for (const seat of app.seats) if (seat.stack <= 0) seat.stack = STARTING_STACK;
  app.handNumber += 1;
  app.dealerIndex = (app.dealerIndex + 1) % app.seats.length;
  app.bubbles = new Map();
  app.winningCards = new Set();
  app.manualReveals = new Set();
  app.spectating = false;
  app.overlay = 'none';
  app.analysis = undefined;
  app.analysisOpen = false;
  app.sliderOpen = false;
  app.recorder = newRecorder();
  app.startStacks = Object.fromEntries(app.seats.map(s => [s.id, s.stack]));
  app.hand = new Hand({
    handNumber: app.handNumber, players: app.seats, dealerIndex: app.dealerIndex,
    smallBlind: SB, bigBlind: BB, rng: app.rng,
  });
  persist();
  render();
  scheduleNextTurn();
}

// ── turn handling ───────────────────────────────────────────────────────────

function scheduleNextTurn(): void {
  if (app.screen !== 'game' || !app.hand) return;
  if (app.hand.isComplete()) { finishHand(); return; }
  const state = app.hand.getState();
  if (!state.toAct) return;
  render();
  if (state.toAct === app.humanId) return; // wait for the human's click
  const think = BOT_THINK_MIN + Math.floor(app.rng.next() * (BOT_THINK_MAX - BOT_THINK_MIN));
  app.botTimer = window.setTimeout(() => takeBotTurn(state.toAct as string), think);
}

function takeBotTurn(playerId: string): void {
  if (app.screen !== 'game' || !app.hand || app.hand.isComplete()) return;
  const action = botAction(playerId);
  applyAction(playerId, action);
}

function botAction(playerId: string): Action {
  if (!app.hand) return { kind: 'fold', amount: 0 };
  const skill = jitter(profileForLevel(app.config.difficulty), hashSeed(playerId));
  return PERSONAS.find(p => p.name === seatById(playerId).name)?.bot({
    view: buildBotView(app.hand.getState(), playerId), rng: app.rng, skill,
  }) ?? { kind: 'fold', amount: 0 };
}

function applyAction(playerId: string, action: Action): void {
  if (!app.hand) return;
  app.recorder?.capture(app.hand.getState(), playerId, action);
  try {
    app.hand.applyAction(playerId, action);
  } catch (err) {
    console.error('Illegal action, folding instead:', err);
    app.hand.applyAction(playerId, { kind: 'fold', amount: 0 });
  }
  showBubble(playerId, labelForAction(action));
  if (playerId === app.humanId && action.kind === 'fold' && !app.hand.isComplete()) {
    app.spectating = true; // watch the rest play out
  }
  scheduleNextTurn();
}

/** Fast-forward the remaining bot action when the hero is spectating. */
function skipToResult(): void {
  clearTimers();
  let guard = 0;
  while (app.hand && !app.hand.isComplete() && guard++ < 200) {
    const id = app.hand.getState().toAct;
    if (!id || id === app.humanId) break;
    applyActionSilently(id, botAction(id));
  }
  if (app.hand?.isComplete()) finishHand();
}

function applyActionSilently(playerId: string, action: Action): void {
  if (!app.hand) return;
  app.recorder?.capture(app.hand.getState(), playerId, action);
  try { app.hand.applyAction(playerId, action); }
  catch { app.hand.applyAction(playerId, { kind: 'fold', amount: 0 }); }
}

function showBubble(playerId: string, text: string): void {
  app.bubbles.set(playerId, text);
  window.setTimeout(() => {
    if (app.bubbles.get(playerId) === text) { app.bubbles.delete(playerId); render(); }
  }, BUBBLE_LINGER_MS);
}

function finishHand(): void {
  if (!app.hand) return;
  const result = app.hand.resolve();
  const state = app.hand.getState();
  for (const ep of state.players) {
    const seat = app.seats.find(s => s.id === ep.id);
    if (seat) seat.stack = ep.stack;
  }
  const mainEval = result.awards[0]?.eval;
  if (mainEval) app.winningCards = cardSetKey(mainEval.best5);
  app.overlay = 'showdown';

  const record = buildHandRecord({
    id: `${Date.now()}-${app.handNumber}`, playedAt: Date.now(), config: handConfig(),
    finalState: state, result, snapshots: app.recorder?.snapshots() ?? [], startStacks: app.startStacks,
  });
  app.analysis = analyzeHand(record);
  app.analysisOpen = true;
  void appendHand(record);

  updateRecord();
  persist();
  render();
}

function continueAfterShowdown(): void {
  clearTimers();
  dealNextHand();
}

function clearTimers(): void {
  if (app.botTimer !== undefined) { window.clearTimeout(app.botTimer); app.botTimer = undefined; }
}

// ── persistence ───────────────────────────────────────────────────────────

function persist(): void {
  const stacks: Record<string, number> = {};
  for (const s of app.seats) stacks[s.id] = s.stack;
  saveSave({ stacks, dealerIndex: app.dealerIndex, handNumber: app.handNumber });
}

function updateRecord(): void {
  const human = seatById(app.humanId);
  if (human.stack > app.record) { app.record = human.stack; saveRecord(app.record); }
  recordEl.textContent = `Record $${app.record.toLocaleString()}`;
}

// ── render ────────────────────────────────────────────────────────────────

function render(): void {
  if (app.screen === 'setup') return renderSetupScreen();
  if (app.screen === 'dashboard') return renderDashboardScreen();
  if (app.screen === 'review') return renderReviewScreen();
  renderGameScreen();
}

function renderSetupScreen(): void {
  const save = loadSave();
  const hasSave = Object.keys(save.stacks).length > 0;
  const savedStack = save.stacks[app.humanId];
  stage.replaceChildren(renderSetup({
    initial: app.config,
    hasSave,
    ...(savedStack !== undefined ? { savedStack } : {}),
    onStart: startSession,
  }));
}

function renderDashboardScreen(): void {
  stage.replaceChildren(renderDashboard({
    records: app.historyCache,
    onBack: goToGame,
    onReplay: r => { app.reviewRecord = r; app.screen = 'review'; render(); },
    onClear: () => { void clearHistory().then(() => { app.historyCache = []; render(); }); },
    onExport: exportHistoryFile,
  }));
}

function renderReviewScreen(): void {
  if (!app.reviewRecord) return goToDashboard() as unknown as void;
  stage.replaceChildren(renderHandReview({
    record: app.reviewRecord,
    onBack: () => { app.screen = 'dashboard'; render(); },
  }));
}

function renderGameScreen(): void {
  if (!app.hand) { renderSetupScreen(); return; }
  const state = app.hand.getState();
  const children: HTMLElement[] = [
    renderTable(state, {
      humanId: app.humanId,
      bubbles: app.bubbles,
      winningCards: app.winningCards,
      revealHole: revealedSet(state),
      // Only at hand end do hidden opponents get a per-seat Reveal button.
      ...(app.overlay === 'showdown' ? { onReveal: revealPlayer } : {}),
    }),
  ];

  if (state.toAct === app.humanId && app.overlay === 'none' && !app.sliderOpen) {
    children.push(renderActionBar({ humanId: app.humanId, state }, { onAction: a => applyAction(app.humanId, a) }));
  }
  if (app.sliderOpen && state.toAct === app.humanId) {
    children.push(renderBetSlider({ humanId: app.humanId, state }, {
      onConfirm: a => { app.sliderOpen = false; applyAction(app.humanId, a); },
      onCancel: () => { app.sliderOpen = false; render(); },
    }));
  }
  if (app.spectating && app.overlay === 'none') {
    children.push(el('button', 'spectate-skip', 'Spectating — skip to result', skipToResult));
  }
  if (app.overlay === 'showdown') {
    children.push(renderShowdown({
      result: app.hand.resolve(), humanId: app.humanId,
      nameFor: id => seatById(id).name, onContinue: continueAfterShowdown,
    }));
    if (app.analysis && app.analysisOpen) {
      children.push(renderAnalysisPanel({ analysis: app.analysis, onClose: () => { app.analysisOpen = false; render(); } }));
    }
  }
  stage.replaceChildren(...children);
}

/**
 * Whose hole cards are face-up. During play, nobody's (real poker). At a
 * genuine multiway showdown the players who got there are shown automatically;
 * everyone else stays hidden until the player clicks their Reveal button
 * (tracked in manualReveals). A fold-around isn't a showdown, so nobody is
 * auto-revealed — every opponent gets a Reveal button instead.
 */
function revealedSet(state: GameState): Set<string> {
  const out = new Set<string>();
  const contenders = state.players.filter(p => p.status === 'active' || p.status === 'allin');
  const wasShowdown = app.overlay === 'showdown' && contenders.length >= 2;
  for (const p of state.players) {
    if (p.id === app.humanId) continue;
    if (app.manualReveals.has(p.id)) out.add(p.id);
    else if (wasShowdown && (p.status === 'active' || p.status === 'allin')) out.add(p.id);
  }
  return out;
}

function revealPlayer(id: string): void {
  app.manualReveals.add(id);
  render();
}

// ── helpers ───────────────────────────────────────────────────────────────

function exportHistoryFile(): void {
  void exportHands().then(json => {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'poker-training-hands.json';
    a.click();
    URL.revokeObjectURL(url);
  });
}

function handConfig(): HandConfig {
  const names: Record<string, string> = {};
  for (const s of app.seats) names[s.id] = s.name;
  return {
    playerCount: app.seats.length, smallBlind: SB, bigBlind: BB,
    difficulty: app.config.difficulty, dealerIndex: app.dealerIndex, humanId: app.humanId, names,
  };
}

function mkPlayer(id: string, name: string, isHuman: boolean): Player {
  return { id, name, isHuman, stack: STARTING_STACK, hole: [], status: 'active', betThisStreet: 0, totalCommitted: 0 };
}

function seatById(id: string): Player {
  const p = app.seats.find(s => s.id === id);
  if (!p) throw new Error(`No seat ${id}`);
  return p;
}

function buildBotView(state: GameState, playerId: string) {
  const self = state.players.find(p => p.id === playerId);
  if (!self) throw new Error(`Bot ${playerId} not seated`);
  const opponents = state.players.filter(p => p.id !== playerId).map(({ hole: _h, ...rest }) => rest);
  const pot = state.players.reduce((s, p) => s + p.totalCommitted, 0);
  return {
    self, opponents, board: state.board, street: state.street, pot,
    toCall: Math.max(0, state.currentBet - self.betThisStreet),
    minRaise: state.minRaise, bigBlind: state.bigBlind,
  };
}

function labelForAction(a: Action): string {
  switch (a.kind) {
    case 'fold': return 'Fold';
    case 'check': return 'Check';
    case 'call': return 'Call';
    case 'bet': return `Bet $${a.amount}`;
    case 'raise': return `Raise $${a.amount}`;
    case 'allin': return 'All-in';
  }
}

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

/** Minimal button helper for the one-off spectate-skip control. */
function el(tag: 'button', className: string, text: string, onclick: () => void): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  node.addEventListener('click', onclick);
  return node;
}

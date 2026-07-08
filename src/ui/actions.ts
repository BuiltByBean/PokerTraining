/*
 * Action bar UI. Two visual modes:
 *   1) The 3-button bar (Fold / Check-or-Call / Raise) shown by default.
 *   2) A slider replacing the bar when the human chooses to raise/bet.
 *
 * The bar is a controlled component: it takes a snapshot of legal actions +
 * a callback, and emits Action via the callback. It owns no game state.
 */

import { legalActions } from '../engine/game';
import type { Action, GameState, Player } from '../engine/types';
import { el, fmtMoney } from './dom';

export interface ActionBarCallbacks {
  onAction(a: Action): void;
}

export interface ActionBarOptions {
  readonly humanId: string;
  readonly state: GameState;
}

export function renderActionBar(opts: ActionBarOptions, cb: ActionBarCallbacks): HTMLElement {
  const me = opts.state.players.find(p => p.id === opts.humanId);
  if (!me || opts.state.toAct !== opts.humanId) {
    return el('div', { class: 'action-bar', 'aria-hidden': 'true' });
  }
  const legal = legalActions(opts.state, me);
  const owed = opts.state.currentBet - me.betThisStreet;

  const foldBtn = el('button', {
    class: 'action-btn action-btn--danger',
    disabled: !legal.has('fold'),
    onclick: () => cb.onAction({ kind: 'fold', amount: 0 }),
  }, 'Fold');

  const checkOrCall = owed === 0
    ? el('button', {
        class: 'action-btn',
        disabled: !legal.has('check'),
        onclick: () => cb.onAction({ kind: 'check', amount: 0 }),
      }, 'Check')
    : el('button', {
        class: 'action-btn',
        disabled: !legal.has('call'),
        onclick: () => cb.onAction({
          kind: 'call',
          amount: me.betThisStreet + Math.min(owed, me.stack),
        }),
      }, owed >= me.stack ? `Call ${fmtMoney(me.stack)} (All-in)` : `Call ${fmtMoney(owed)}`);

  // Raise/bet button — opens the sizing slider rather than committing.
  const canRaise = (owed === 0 && legal.has('bet')) || (owed > 0 && legal.has('raise'));
  const raiseLabel = owed === 0 ? 'Bet' : 'Raise';
  const raiseBtn = el('button', {
    class: 'action-btn action-btn--primary',
    disabled: !canRaise,
    onclick: () => openSlider(opts, cb),
  }, raiseLabel);

  return el('div', { class: 'action-bar' }, foldBtn, checkOrCall, raiseBtn);
}

function openSlider(opts: ActionBarOptions, cb: ActionBarCallbacks): void {
  // The slider mounts itself into the same place the action bar lived. We
  // dispatch a CustomEvent the host listens for; this keeps the bar
  // component from needing a ref to the slider's parent.
  document.dispatchEvent(new CustomEvent('pt:open-slider', { detail: opts }));
}

export interface SliderOptions {
  readonly humanId: string;
  readonly state: GameState;
}

export interface SliderCallbacks {
  onConfirm(a: Action): void;
  onCancel(): void;
}

export function renderBetSlider(opts: SliderOptions, cb: SliderCallbacks): HTMLElement {
  const me = opts.state.players.find(p => p.id === opts.humanId) as Player;
  const bb = opts.state.bigBlind;
  const owed = opts.state.currentBet - me.betThisStreet;
  const isOpening = owed === 0;
  const isPreflop = opts.state.board.length === 0;
  const kind: Action['kind'] = isOpening ? 'bet' : 'raise';

  // Min and max are expressed in the SAME units as Action.amount: the player's
  // new total betThisStreet (not the delta).
  const min = isOpening
    ? me.betThisStreet + Math.max(bb, opts.state.minRaise)
    : Math.min(me.betThisStreet + me.stack, opts.state.currentBet + opts.state.minRaise);
  const max = me.betThisStreet + me.stack;
  const pot = opts.state.players.reduce((s, p) => s + p.totalCommitted, 0);
  const clampAmt = (n: number) => Math.max(min, Math.min(max, Math.round(n)));

  let current = clampAmt(isPreflop ? bb * 2.5 : isOpening ? Math.floor(pot * 0.66) : min);

  const range = el('input', {
    type: 'range', min: String(min), max: String(max), value: String(current), step: '1',
    class: 'bet-slider__range',
  }) as HTMLInputElement;
  const amountInput = el('input', {
    type: 'number', min: String(min), max: String(max), value: String(current), step: '1',
    class: 'bet-slider__amount', 'aria-label': 'Bet amount',
  }) as HTMLInputElement;

  const setTo = (n: number, keepInput = false): void => {
    current = clampAmt(n);
    range.value = String(current);
    if (!keepInput) amountInput.value = String(current);
  };
  range.addEventListener('input', () => setTo(Number(range.value)));
  amountInput.addEventListener('input', () => {
    const n = Number(amountInput.value);
    if (Number.isFinite(n)) setTo(n, true); // don't fight the typist mid-entry
  });
  amountInput.addEventListener('change', () => { amountInput.value = String(current); });

  const presets = el('div', { class: 'bet-slider__presets' }, ...presetButtons(isPreflop, me.betThisStreet, bb, pot, max, clampAmt, setTo));

  const step = Math.max(1, bb);
  const controls = el(
    'div', { class: 'bet-slider__controls' },
    el('button', { class: 'bet-slider__nudge', onclick: () => setTo(current - step) }, '−'),
    range,
    el('button', { class: 'bet-slider__nudge', onclick: () => setTo(current + step) }, '+'),
    amountInput,
  );

  const cancel = el('button', { class: 'bet-slider__cancel', onclick: () => cb.onCancel() }, 'Back');
  const ok = el('button', { class: 'bet-slider__ok', onclick: () => cb.onConfirm({ kind, amount: current }) }, 'Confirm');

  return el('div', { class: 'bet-slider' }, cancel, el('div', { class: 'bet-slider__body' }, presets, controls), ok);
}

/**
 * PokerStars-style quick-bet chips: big-blind multiples preflop (2×, 2.5×, …),
 * pot fractions postflop (⅓, ½, ⅔, ¾, Pot), plus Min and All-in. Amounts are
 * clamped to the legal range and de-duped so a short stack doesn't show the same
 * value twice.
 */
function presetButtons(
  isPreflop: boolean, betThisStreet: number, bb: number, pot: number, max: number,
  clampAmt: (n: number) => number, setTo: (n: number) => void,
): HTMLElement[] {
  const potTotal = betThisStreet + pot;
  const defs: ReadonlyArray<[string, number]> = isPreflop
    ? [['Min', 0], ['2×BB', bb * 2], ['2.5×BB', bb * 2.5], ['3×BB', bb * 3], ['4×BB', bb * 4], ['Pot', potTotal], ['All-in', max]]
    : [['Min', 0], ['⅓', betThisStreet + pot / 3], ['½', betThisStreet + pot * 0.5], ['⅔', betThisStreet + pot * 2 / 3], ['¾', betThisStreet + pot * 0.75], ['Pot', potTotal], ['All-in', max]];

  const seen = new Set<number>();
  const btns: HTMLElement[] = [];
  for (const [label, raw] of defs) {
    const val = clampAmt(raw);
    if (seen.has(val)) continue;
    seen.add(val);
    btns.push(el('button', { class: 'bet-slider__preset', onclick: () => setTo(val) }, label));
  }
  return btns;
}

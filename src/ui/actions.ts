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
  const owed = opts.state.currentBet - me.betThisStreet;
  const isOpening = owed === 0;
  const kind: Action['kind'] = isOpening ? 'bet' : 'raise';

  // Min and max are expressed in the SAME units as Action.amount: the player's
  // new total betThisStreet (not the delta).
  const min = isOpening
    ? me.betThisStreet + Math.max(opts.state.bigBlind, opts.state.minRaise)
    : Math.min(me.betThisStreet + me.stack, opts.state.currentBet + opts.state.minRaise);
  const max = me.betThisStreet + me.stack;
  const pot = opts.state.players.reduce((s, p) => s + p.totalCommitted, 0);

  let current = Math.max(min, Math.min(max, isOpening ? Math.max(min, Math.floor(pot * 0.66)) : min));

  const amountLabel = el('div', { class: 'bet-slider__amount' }, fmtMoney(current));

  const range = el('input', {
    type: 'range',
    min: String(min),
    max: String(max),
    value: String(current),
    step: '1',
    class: 'bet-slider__range',
    oninput: (e: Event) => {
      current = Number((e.target as HTMLInputElement).value);
      amountLabel.textContent = fmtMoney(current);
    },
  }) as HTMLInputElement;

  const setTo = (n: number) => {
    const v = Math.max(min, Math.min(max, n));
    range.value = String(v);
    current = v;
    amountLabel.textContent = fmtMoney(current);
  };

  const shortcuts = el(
    'div',
    { class: 'bet-slider__shortcuts' },
    el('button', { class: 'bet-slider__shortcut', onclick: () => setTo(me.betThisStreet + Math.floor(pot * 0.5)) }, '½ Pot'),
    el('button', { class: 'bet-slider__shortcut', onclick: () => setTo(me.betThisStreet + Math.floor(pot * 0.75)) }, '¾ Pot'),
    el('button', { class: 'bet-slider__shortcut', onclick: () => setTo(me.betThisStreet + pot) }, 'Pot'),
    el('button', { class: 'bet-slider__shortcut', onclick: () => setTo(max) }, 'All-in'),
  );

  const cancel = el('button', {
    class: 'bet-slider__cancel',
    onclick: () => cb.onCancel(),
  }, 'Back');

  const ok = el('button', {
    class: 'bet-slider__ok',
    onclick: () => cb.onConfirm({ kind, amount: current }),
  }, 'Confirm');

  return el(
    'div',
    { class: 'bet-slider' },
    cancel,
    el('div', { class: 'bet-slider__row' }, range, shortcuts),
    amountLabel,
    ok,
  );
}

/*
 * End-of-hand showdown overlay + welcome modal.
 */

import type { ShowdownResult } from '../engine/game';
import { el, fmtMoney } from './dom';

export interface ShowdownOptions {
  readonly result: ShowdownResult;
  readonly humanId: string;
  /** Player id → name lookup for the headline. */
  readonly nameFor: (id: string) => string;
  /** Called on click anywhere. */
  readonly onContinue: () => void;
}

export function renderShowdown(opts: ShowdownOptions): HTMLElement {
  const main = opts.result.awards[0];
  if (!main || main.winners.length === 0) {
    return el('div', { class: 'overlay', onclick: opts.onContinue },
      el('div', { class: 'overlay__card' },
        el('h2', { class: 'overlay__headline' }, 'Hand Over'),
        el('div', { class: 'overlay__hint' }, 'Press anywhere to continue'),
      ),
    );
  }

  const totalWonByHuman = opts.result.awards.reduce((sum, a) => {
    if (!a.winners.includes(opts.humanId)) return sum;
    return sum + Math.floor(a.pot.amount / a.winners.length);
  }, 0);

  const headline = headlineFor(main.winners, opts.humanId, opts.nameFor);
  const handName = main.eval?.name ?? '';
  const potTotal = opts.result.pots.reduce((s, p) => s + p.amount, 0);

  return el(
    'div',
    { class: 'overlay', onclick: opts.onContinue },
    el(
      'div',
      { class: 'overlay__card' },
      el('h2', { class: 'overlay__headline' }, headline),
      el('div', { class: 'overlay__pot' }, fmtMoney(totalWonByHuman || potTotal)),
      handName ? el('div', { class: 'overlay__hand' }, handName) : null,
      el('div', { class: 'overlay__hint' }, 'Press anywhere to continue'),
    ),
  );
}

function headlineFor(winners: readonly string[], humanId: string, nameFor: (id: string) => string): string {
  if (winners.length > 1) return 'Split Pot!';
  if (winners[0] === humanId) return 'You Win!';
  return `${nameFor(winners[0] as string)} Wins`;
}

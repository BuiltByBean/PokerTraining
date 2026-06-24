/*
 * Card → DOM. Pure functions; the caller decides where the node goes.
 */

import type { Card, Rank, Suit } from '../engine/types';
import { el } from './dom';

const RANK_LABEL: Record<Rank, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

const SUIT_GLYPH: Record<Suit, string> = {
  c: '♣',
  d: '♦',
  h: '♥',
  s: '♠',
};

export interface CardRenderOpts {
  readonly small?: boolean;
  /** Mark this card as part of the winning 5 at showdown. */
  readonly highlight?: boolean;
  /** Dim out (losing cards, folded). */
  readonly dim?: boolean;
}

export function renderCard(card: Card, opts: CardRenderOpts = {}): HTMLElement {
  const classes = ['card'];
  if (opts.small) classes.push('card--small');
  if (opts.highlight) classes.push('card--win');
  if (opts.dim) classes.push('card--dim');
  return el(
    'div',
    { class: classes.join(' '), 'data-suit': card.suit, 'data-rank': card.rank },
    el('span', { class: 'card__rank' }, RANK_LABEL[card.rank]),
    el('span', { class: 'card__suit' }, SUIT_GLYPH[card.suit]),
  );
}

export function renderCardBack(opts: { small?: boolean } = {}): HTMLElement {
  const classes = ['card', 'card--back'];
  if (opts.small) classes.push('card--small');
  return el('div', { class: classes.join(' '), 'aria-hidden': 'true' });
}

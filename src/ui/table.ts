/*
 * Table renderer. Takes a GameState + per-hand visual annotations
 * (last-bubble per seat, winning cards set, etc.) and returns a fresh DOM
 * tree. We re-render the whole table on every change — it's tiny (< 100
 * nodes), runs at 60fps trivially, and lets us treat the renderer as a pure
 * function.
 *
 * If perf ever bites, the seat sub-trees memoize cleanly because they're
 * indexed by seat number — but don't add that until measurement proves it.
 */

import type { Card, GameState, Player } from '../engine/types';
import { el, fmtMoney } from './dom';
import { renderCard, renderCardBack } from './cards';

export interface TableViewOptions {
  readonly humanId: string;
  /** Seat-index → last action label shown as a speech bubble. */
  readonly bubbles: ReadonlyMap<string, string>;
  /** Cards (by string key "rank-suit") that contributed to the winning hand. */
  readonly winningCards: ReadonlySet<string>;
  /** Player ids whose hole cards should be revealed (showdown). */
  readonly revealHole: ReadonlySet<string>;
  /** Show pot label even when 0 (during between-hand state). */
  readonly showZeroPot?: boolean;
}

export function renderTable(state: GameState, opts: TableViewOptions): HTMLElement {
  const seats = state.players.map((p, i) => renderSeat(p, i, state, opts));

  const board = el(
    'div',
    { class: 'board' },
    ...state.board.map(c => renderCard(c, {
      highlight: opts.winningCards.has(cardKey(c)),
      dim: opts.winningCards.size > 0 && !opts.winningCards.has(cardKey(c)),
    })),
  );

  const potTotal = totalCommitted(state);
  const showPot = potTotal > 0 || opts.showZeroPot;

  return el(
    'div',
    { class: 'table' },
    el(
      'div',
      { class: 'table__felt' },
      el(
        'div',
        { class: 'table__center' },
        el(
          'div',
          { class: 'pot' },
          showPot ? el('div', { class: 'pot__label' }, fmtMoney(potTotal)) : null,
          board,
        ),
      ),
      ...seats,
    ),
  );
}

function renderSeat(
  p: Player,
  seatIdx: number,
  state: GameState,
  opts: TableViewOptions,
): HTMLElement {
  const isYou = p.id === opts.humanId;
  const isToAct = state.toAct === p.id;
  const isDealer = state.players[state.dealerIndex]?.id === p.id;

  const classes = ['seat', `seat--${seatIdx}`];
  if (isYou)             classes.push('seat--you');
  if (isToAct)           classes.push('seat--toact');
  if (p.status === 'folded') classes.push('seat--folded');

  const showFaceUp = isYou || opts.revealHole.has(p.id);
  const holeCards = p.hole.length
    ? p.hole.map(c =>
        showFaceUp
          ? renderCard(c, {
              highlight: opts.winningCards.has(cardKey(c)),
              dim: opts.winningCards.size > 0 && !opts.winningCards.has(cardKey(c)),
            })
          : renderCardBack(),
      )
    : [];

  const bubbleText = opts.bubbles.get(p.id);

  const commitChip = p.betThisStreet > 0
    ? el('div', { class: 'seat__commit' }, fmtMoney(p.betThisStreet))
    : null;

  return el(
    'div',
    { class: classes.join(' ') },
    el('div', { class: 'seat__cards' }, ...holeCards),
    el(
      'div',
      { class: 'seat__plate' },
      el('div', { class: 'seat__name' }, p.name),
      el('div', { class: 'seat__stack' }, fmtMoney(p.stack)),
      isDealer ? el('div', { class: 'seat__dealer' }, 'D') : null,
    ),
    commitChip,
    bubbleText
      ? el('div', { class: 'seat__bubble seat__bubble--show' }, bubbleText)
      : el('div', { class: 'seat__bubble' }, ''),
  );
}

function totalCommitted(state: GameState): number {
  return state.players.reduce((s, p) => s + p.totalCommitted, 0);
}

function cardKey(c: Card): string {
  return `${c.rank}-${c.suit}`;
}

export function cardSetKey(cards: readonly Card[]): Set<string> {
  return new Set(cards.map(cardKey));
}

/*
 * Table renderer. Takes a GameState + per-hand visual annotations (last-bubble
 * per seat, winning cards, revealed hole cards) and returns a fresh DOM tree.
 * We re-render the whole table on every change — it's tiny and lets the
 * renderer stay a pure function of state.
 *
 * Seat geometry is computed (seatPositions) rather than hardcoded so any count
 * 2-9 lays out cleanly, hero pinned bottom-center. Each seat shows its
 * dealer/SB/BB badge derived from the engine's blind logic.
 */

import type { Card, GameState, Player } from '../engine/types';
import { blindSeats } from '../engine/positions';
import { el, fmtMoney } from './dom';
import { renderCard, renderCardBack } from './cards';
import { seatPositions, seatScale, type SeatPos } from './seating';

export interface TableViewOptions {
  readonly humanId: string;
  readonly bubbles: ReadonlyMap<string, string>;
  readonly winningCards: ReadonlySet<string>;
  readonly revealHole: ReadonlySet<string>;
  readonly showZeroPot?: boolean;
}

export function renderTable(state: GameState, opts: TableViewOptions): HTMLElement {
  const positions = seatPositions(state.players.length);
  const blinds = blindSeats(state.players, state.dealerIndex);
  const small = state.players.length > 6;
  const seats = state.players.map((p, i) =>
    renderSeat(p, positions[i] as SeatPos, blindBadge(i, blinds, state.players.length), state, opts, small));

  const potTotal = totalCommitted(state);
  const showPot = potTotal > 0 || opts.showZeroPot;
  const board = el('div', { class: 'board' }, ...state.board.map(c => renderBoardCard(c, opts)));

  return el(
    'div',
    { class: 'table', style: `--seat-scale:${seatScale(state.players.length)}` },
    el(
      'div',
      { class: 'table__felt' },
      el('div', { class: 'table__center' },
        el('div', { class: 'pot' },
          showPot ? el('div', { class: 'pot__label' }, fmtMoney(potTotal)) : null,
          board)),
      ...seats,
    ),
  );
}

type Badge = 'D' | 'SB' | 'BB' | 'D/SB' | undefined;

function blindBadge(seat: number, blinds: { dealer: number; sb: number; bb: number }, count: number): Badge {
  if (count === 2 && seat === blinds.dealer) return 'D/SB'; // heads-up button posts the SB
  if (seat === blinds.dealer) return 'D';
  if (seat === blinds.sb) return 'SB';
  if (seat === blinds.bb) return 'BB';
  return undefined;
}

function renderSeat(
  p: Player,
  pos: SeatPos,
  badge: Badge,
  state: GameState,
  opts: TableViewOptions,
  small: boolean,
): HTMLElement {
  const isYou = p.id === opts.humanId;
  const classes = ['seat'];
  if (isYou) classes.push('seat--you');
  if (state.toAct === p.id) classes.push('seat--toact');
  if (p.status === 'folded') classes.push('seat--folded');
  if (p.status === 'sittingout') classes.push('seat--out');

  const showFaceUp = isYou || opts.revealHole.has(p.id);
  const holeCards = p.hole.map(c =>
    showFaceUp ? renderCard(c, { small, ...holeHighlight(c, opts) }) : renderCardBack({ small }));

  return el(
    'div',
    { class: classes.join(' '), style: `left:${pos.xPct}%;top:${pos.yPct}%` },
    el('div', { class: 'seat__cards' }, ...holeCards),
    el('div', { class: 'seat__plate' },
      el('div', { class: 'seat__name' }, p.name),
      el('div', { class: 'seat__stack' }, fmtMoney(p.stack)),
      badge ? el('div', { class: `seat__badge seat__badge--${badgeClass(badge)}` }, badge) : null),
    p.betThisStreet > 0 ? el('div', { class: 'seat__commit' }, fmtMoney(p.betThisStreet)) : null,
    bubble(opts.bubbles.get(p.id)),
  );
}

function badgeClass(badge: Exclude<Badge, undefined>): string {
  if (badge === 'SB') return 'sb';
  if (badge === 'BB') return 'bb';
  return 'd';
}

function bubble(text: string | undefined): HTMLElement {
  return text
    ? el('div', { class: 'seat__bubble seat__bubble--show' }, text)
    : el('div', { class: 'seat__bubble' }, '');
}

function renderBoardCard(c: Card, opts: TableViewOptions): HTMLElement {
  return renderCard(c, holeHighlight(c, opts));
}

function holeHighlight(c: Card, opts: TableViewOptions): { highlight?: boolean; dim?: boolean } {
  if (opts.winningCards.size === 0) return {};
  return opts.winningCards.has(cardKey(c)) ? { highlight: true } : { dim: true };
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

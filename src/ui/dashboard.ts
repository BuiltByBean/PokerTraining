/*
 * Stats & leaks dashboard. Aggregates every stored hand into the HUD stats a
 * tracker would show, names the player's archetype, lists their biggest leaks,
 * and offers a scrollable history that opens any hand for review. Pure render
 * from records the caller loads (async) and passes in.
 */

import { computeStats, detectAggregateLeaks, type Ratio, type StatPanel } from '../analysis/index';
import type { HandRecord } from '../analysis/record';
import type { Card } from '../engine/types';
import { renderCard } from './cards';
import { el } from './dom';

export interface DashboardOptions {
  readonly records: readonly HandRecord[];
  onBack(): void;
  onReplay(record: HandRecord): void;
  onClear(): void;
  onExport(): void;
}

const ARCHETYPE_LABEL: Record<string, string> = {
  nit: 'Nit (very tight)', tag: 'TAG (tight-aggressive)', lag: 'LAG (loose-aggressive)',
  'calling-station': 'Calling station', maniac: 'Maniac', 'loose-passive': 'Loose-passive',
  balanced: 'Balanced',
};

export function renderDashboard(opts: DashboardOptions): HTMLElement {
  const stats = computeStats(opts.records);
  const leaks = detectAggregateLeaks(opts.records, stats);

  return el('div', { class: 'dashboard' },
    el('div', { class: 'dashboard__head' },
      el('button', { class: 'modal__btn', onclick: opts.onBack }, '← Back to table'),
      el('h2', { class: 'dashboard__title' }, 'Your Stats'),
      el('div', { class: 'dashboard__archetype' },
        stats.archetype ? (ARCHETYPE_LABEL[stats.archetype] ?? stats.archetype) : `Need ${30 - stats.hands} more hands`)),
    tiles(stats),
    leaks.length
      ? el('section', { class: 'dashboard__leaks' },
          el('h3', { class: 'dashboard__subtitle' }, 'Your biggest leaks'),
          ...leaks.map(l => el('div', { class: `leak leak--${l.severity}` },
            el('div', { class: 'leak__title' }, l.title),
            el('div', { class: 'leak__body' }, l.explanation))))
      : el('p', { class: 'dashboard__none' }, 'No clear leaks yet — keep playing to build the sample.'),
    history(opts),
    el('div', { class: 'dashboard__foot' },
      el('button', { class: 'modal__btn', onclick: opts.onExport }, 'Export hands'),
      el('button', { class: 'modal__btn modal__btn--danger', onclick: opts.onClear }, 'Clear history')),
  );
}

function tiles(s: StatPanel): HTMLElement {
  return el('div', { class: 'dashboard__tiles' },
    tile('Hands', String(s.hands), 'Total hands played'),
    tile('Net (bb)', signed(s.netBb), 'Overall winnings, in big blinds'),
    tile('VPIP', pct(s.vpip), 'How often you play a hand instead of folding'),
    tile('PFR', pct(s.pfr), 'How often you raise before the flop'),
    tile('3-Bet', pct(s.threeBet), 'How often you re-raise before the flop'),
    tile('AF', s.af === undefined ? '—' : s.af.toFixed(1), 'How aggressive you are after the flop (bets+raises per call)'),
    tile('WTSD', pct(s.wtsd), 'How often you reach showdown after seeing the flop'),
    tile('W$SD', pct(s.wssd), 'How often you win once you reach showdown'),
    tile('WWSF', pct(s.wwsf), 'How often you win after seeing the flop'),
    tile('Red line', signed(s.redLineBb), 'Money won/lost in pots that never reached showdown'),
    tile('Blue line', signed(s.blueLineBb), 'Money won/lost in pots that did reach showdown'),
  );
}

function tile(label: string, value: string, hint: string): HTMLElement {
  return el('div', { class: 'tile', title: hint },
    el('div', { class: 'tile__value' }, value),
    el('div', { class: 'tile__label' }, label));
}

function history(opts: DashboardOptions): HTMLElement {
  if (opts.records.length === 0) {
    return el('p', { class: 'dashboard__none' }, 'No hands recorded yet.');
  }
  const rows = [...opts.records].reverse().slice(0, 200).map(r => historyRow(r, opts));
  return el('section', { class: 'dashboard__history' },
    el('h3', { class: 'dashboard__subtitle' }, 'Recent hands'),
    el('div', { class: 'history' }, ...rows));
}

function historyRow(r: HandRecord, opts: DashboardOptions): HTMLElement {
  const hole = (r.holeCards[r.config.humanId] ?? []) as Card[];
  const net = r.outcome.heroNetBb;
  const cls = net > 0 ? 'history__net--win' : net < 0 ? 'history__net--loss' : '';
  return el('div', { class: 'history__row', onclick: () => opts.onReplay(r) },
    el('div', { class: 'history__cards board' }, ...hole.map(c => renderCard(c, { small: true }))),
    el('span', { class: `history__tag history__tag--${r.outcome.line}` }, r.outcome.line),
    el('span', { class: `history__net ${cls}` }, `${net > 0 ? '+' : ''}${net.toFixed(1)}bb`),
    el('span', { class: 'history__open' }, 'review →'));
}

function pct(r: Ratio): string {
  return r.pct === undefined ? '—' : `${Math.round(r.pct * 100)}%`;
}

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
}

/*
 * Stats & history dashboard, written for a human, not a HUD. Money is shown in
 * dollars (not big blinds), and every stat has a plain-English name + one-line
 * explanation instead of poker shorthand (VPIP, PFR, AF, WTSD…). Percentages
 * show as soon as there's any sample; the header notes when there are still too
 * few hands to read them as a reliable "style."
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
  nit: 'Very tight player', tag: 'Tight & aggressive (solid)', lag: 'Loose & aggressive',
  'calling-station': 'Calls too much', maniac: 'Very wild', 'loose-passive': 'Plays a lot, rarely raises',
  balanced: 'Well balanced',
};

const RELIABLE_AT = 30;

export function renderDashboard(opts: DashboardOptions): HTMLElement {
  const stats = computeStats(opts.records);
  const leaks = detectAggregateLeaks(opts.records, stats);
  const money = moneyTotals(opts.records);

  return el('div', { class: 'dashboard' },
    el('div', { class: 'dashboard__head' },
      el('button', { class: 'modal__btn', onclick: opts.onBack }, '← Back to table'),
      el('h2', { class: 'dashboard__title' }, 'Your Stats'),
      el('div', { class: 'dashboard__archetype' },
        stats.archetype ? `Your style: ${ARCHETYPE_LABEL[stats.archetype] ?? stats.archetype}`
          : `${Math.max(0, RELIABLE_AT - stats.hands)} more hands to read your style`)),

    overview(stats.hands, money),
    style(stats),

    leaks.length
      ? el('section', { class: 'dashboard__leaks' },
          el('h3', { class: 'dashboard__subtitle' }, 'What to work on'),
          ...leaks.map(l => el('div', { class: `leak leak--${l.severity}` },
            el('div', { class: 'leak__title' }, l.title),
            el('div', { class: 'leak__body' }, l.explanation))))
      : el('p', { class: 'dashboard__none' }, 'Keep playing — once there’s enough data, your habits to fix will show up here.'),

    history(opts),
    el('div', { class: 'dashboard__foot' },
      el('button', { class: 'modal__btn', onclick: opts.onExport }, 'Export hands'),
      el('button', { class: 'modal__btn modal__btn--danger', onclick: opts.onClear }, 'Clear history')),
  );
}

// ── overview (always meaningful) ──────────────────────────────────────────

interface Money { net: number; showdown: number; steal: number; }

function moneyTotals(records: readonly HandRecord[]): Money {
  let net = 0, showdown = 0;
  for (const r of records) {
    net += r.outcome.heroNet;
    if (r.outcome.heroWentToShowdown) showdown += r.outcome.heroNet;
  }
  return { net, showdown, steal: net - showdown };
}

function overview(hands: number, m: Money): HTMLElement {
  return el('section', { class: 'dashboard__overview' },
    bigTile('Hands played', String(hands), ''),
    bigTile('Total won / lost', dollars(m.net), '', m.net),
    bigTile('From showdowns', dollars(m.showdown), 'hands you took to the end', m.showdown),
    bigTile('From folds / steals', dollars(m.steal), 'pots won without a showdown (or lost folding)', m.steal),
  );
}

function bigTile(label: string, value: string, sub: string, signedVal = 0): HTMLElement {
  const cls = signedVal > 0 ? 'tile__value tile__value--win' : signedVal < 0 ? 'tile__value tile__value--loss' : 'tile__value';
  return el('div', { class: 'tile' },
    el('div', { class: cls }, value),
    el('div', { class: 'tile__label' }, label),
    sub ? el('div', { class: 'tile__sub' }, sub) : null);
}

// ── playing style (percentages, plain-language) ───────────────────────────

function style(s: StatPanel): HTMLElement {
  const rows = [
    statRow('How often you play a hand', pctRaw(s.vpip), 'You enter the pot instead of folding before the flop.'),
    statRow('How often you raise first', pctRaw(s.pfr), 'You’re the first to raise before the flop, rather than just calling.'),
    statRow('How often you re-raise', pctRaw(s.threeBet), 'You raise back at someone who already raised before the flop.'),
    statRow('How aggressive you are', s.af === undefined ? '—' : `${s.af.toFixed(1)}×`, 'Bets & raises vs. calls after the flop — higher means more aggressive.'),
    statRow('How often you go to the end', pctRaw(s.wtsd), 'You stay in until cards are shown (a showdown).'),
    statRow('How often you win at the end', pctRaw(s.wssd), 'When you reach a showdown, how often you win it.'),
    statRow('How often you win after the flop', pctRaw(s.wwsf), 'Once you’ve seen the flop, how often you take the pot.'),
  ];
  return el('section', { class: 'dashboard__style' },
    el('h3', { class: 'dashboard__subtitle' }, 'How you play'),
    el('div', { class: 'statlist' }, ...rows));
}

function statRow(name: string, value: string, desc: string): HTMLElement {
  return el('div', { class: 'statrow' },
    el('div', { class: 'statrow__main' },
      el('span', { class: 'statrow__name' }, name),
      el('span', { class: 'statrow__value' }, value)),
    el('div', { class: 'statrow__desc' }, desc));
}

// ── recent hands ──────────────────────────────────────────────────────────

const TAG_LABEL: Record<string, string> = {
  blue: 'won at showdown',
  red: 'won — they folded',
  none: '',
};

function history(opts: DashboardOptions): HTMLElement {
  if (opts.records.length === 0) {
    return el('p', { class: 'dashboard__none' }, 'No hands recorded yet.');
  }
  const rows = [...opts.records].reverse().slice(0, 200).map(r => historyRow(r, opts));
  return el('section', { class: 'dashboard__history' },
    el('h3', { class: 'dashboard__subtitle' }, 'Recent hands (click to review)'),
    el('div', { class: 'history' }, ...rows));
}

function historyRow(r: HandRecord, opts: DashboardOptions): HTMLElement {
  const hole = (r.holeCards[r.config.humanId] ?? []) as Card[];
  const net = r.outcome.heroNet;
  const cls = net > 0 ? 'history__net--win' : net < 0 ? 'history__net--loss' : '';
  const tag = TAG_LABEL[r.outcome.line];
  return el('div', { class: 'history__row', onclick: () => opts.onReplay(r) },
    el('div', { class: 'history__cards board' }, ...hole.map(c => renderCard(c, { small: true }))),
    tag ? el('span', { class: `history__tag history__tag--${r.outcome.line}` }, tag) : el('span', {}),
    el('span', { class: `history__net ${cls}` }, dollars(net)),
    el('span', { class: 'history__open' }, 'review →'));
}

// ── formatting ────────────────────────────────────────────────────────────

/** Percentage straight from hits/opps so something shows even with few hands. */
function pctRaw(r: Ratio): string {
  return r.opps > 0 ? `${Math.round((r.hits / r.opps) * 100)}%` : '—';
}

function dollars(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString()}`;
}

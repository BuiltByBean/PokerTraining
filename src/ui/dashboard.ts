/*
 * Play-style analytics — NOT a money tracker. No dollar amounts here: the point
 * is to show HOW you play and where your wins come from, in plain language.
 * Every stat has a human name + one-line explanation, and percentages show as
 * soon as there's any sample (the header notes when there are too few hands to
 * trust them as a "style").
 */

import {
  computeStats, detectAggregateLeaks, detectStrengths,
  type Leak, type Ratio, type StatPanel, type Strength,
} from '../analysis/index';
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

const RELIABLE_AT = 20;

export function renderDashboard(opts: DashboardOptions): HTMLElement {
  const stats = computeStats(opts.records);
  const leaks = detectAggregateLeaks(opts.records, stats);
  const strengths = detectStrengths(stats);

  return el('div', { class: 'dashboard' },
    el('div', { class: 'dashboard__head' },
      el('button', { class: 'modal__btn', onclick: opts.onBack }, '← Back to table'),
      el('div', { class: 'dashboard__heading' },
        el('h2', { class: 'dashboard__title' }, 'Your Play Style'),
        el('div', { class: 'dashboard__count' }, `Based on ${stats.hands} hand${stats.hands === 1 ? '' : 's'}`)),
      el('div', { class: 'dashboard__archetype' },
        stats.archetype ? `Your style: ${ARCHETYPE_LABEL[stats.archetype] ?? stats.archetype}`
          : `${Math.max(0, RELIABLE_AT - stats.hands)} more hands to read your style`)),

    workOn(leaks, stats.hands),
    goodAt(strengths, stats.hands),
    winSource(opts.records),
    style(stats),
    history(opts),

    el('div', { class: 'dashboard__foot' },
      el('button', { class: 'modal__btn', onclick: opts.onExport }, 'Export hands'),
      el('button', { class: 'modal__btn modal__btn--danger', onclick: opts.onClear }, 'Clear history')),
  );
}

// ── what to work on / what you're good at ──────────────────────────────────

function workOn(leaks: readonly Leak[], hands: number): HTMLElement {
  const body = leaks.length
    ? leaks.map(l => insightCard(`leak leak--${l.severity}`, l.title, l.explanation))
    : [el('p', { class: 'dashboard__none' }, hands < RELIABLE_AT
        ? `Play ${RELIABLE_AT - hands} more hands and the things to fix will show up here.`
        : 'Nothing glaring right now — nicely played. 👍')];
  return el('section', { class: 'dashboard__leaks' },
    el('h3', { class: 'dashboard__subtitle' }, 'What to work on'), ...body);
}

function goodAt(strengths: readonly Strength[], hands: number): HTMLElement {
  const body = strengths.length
    ? strengths.map(s => insightCard('strength', s.title, s.explanation))
    : [el('p', { class: 'dashboard__none' }, hands < RELIABLE_AT
        ? `Play ${RELIABLE_AT - hands} more hands and your strengths will show up here.`
        : 'Keep building — your strengths will firm up as you play more.')];
  return el('section', { class: 'dashboard__strengths' },
    el('h3', { class: 'dashboard__subtitle' }, 'What you’re good at'), ...body);
}

function insightCard(cls: string, title: string, body: string): HTMLElement {
  return el('div', { class: cls },
    el('div', { class: 'leak__title' }, title),
    el('div', { class: 'leak__body' }, body));
}

// ── where your wins come from (skill vs. fold equity), as % of wins ────────

function winSource(records: readonly HandRecord[]): HTMLElement {
  const wins = records.filter(r => r.outcome.heroNet > 0);
  const body = wins.length === 0
    ? el('p', { class: 'dashboard__none' }, 'No wins yet — this fills in once you start taking pots.')
    : el('div', { class: 'statlist' },
        statRow('Won by having the best hand', sharePct(wins, 'blue', wins.length),
          'You went to the end and won the showdown — winning on merit.'),
        statRow('Won because everyone folded', sharePct(wins, 'red', wins.length),
          'You took the pot without a showdown — bluffs and steals, not necessarily the best hand.'));
  return el('section', { class: 'dashboard__winsrc' },
    el('h3', { class: 'dashboard__subtitle' }, 'Where your wins come from'),
    body);
}

function sharePct(wins: readonly HandRecord[], line: 'blue' | 'red', total: number): string {
  const n = wins.filter(w => w.outcome.line === line).length;
  return `${Math.round((n / total) * 100)}%`;
}

// ── how you play (behavioral percentages) ──────────────────────────────────

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
  const result = net > 0 ? 'Won' : net < 0 ? 'Lost' : 'Folded';
  const cls = net > 0 ? 'history__net--win' : net < 0 ? 'history__net--loss' : '';
  const tag = TAG_LABEL[r.outcome.line];
  return el('div', { class: 'history__row', onclick: () => opts.onReplay(r) },
    el('div', { class: 'history__cards board' }, ...hole.map(c => renderCard(c, { small: true }))),
    tag ? el('span', { class: `history__tag history__tag--${r.outcome.line}` }, tag) : el('span', {}),
    el('span', { class: `history__net ${cls}` }, result),
    el('span', { class: 'history__open' }, 'review →'));
}

/** Percentage straight from hits/opps so something shows even with few hands. */
function pctRaw(r: Ratio): string {
  return r.opps > 0 ? `${Math.round((r.hits / r.opps) * 100)}%` : '—';
}

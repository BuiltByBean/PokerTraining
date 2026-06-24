/*
 * Post-hand coaching panel — a non-blocking slide-in from the right. It never
 * gates starting the next hand; the player can read it or dismiss it. Content
 * comes straight from analyzeHand(): the red/blue tag, per-decision verdicts,
 * an equity strip, and the leak flags.
 */

import type { HandAnalysis } from '../analysis/index';
import type { DecisionGrade } from '../analysis/decision';
import type { Leak } from '../analysis/leaks';
import { el } from './dom';

export interface AnalysisPanelOptions {
  readonly analysis: HandAnalysis;
  onClose(): void;
}

const TAG_LABEL: Record<HandAnalysis['tag'], string> = {
  red: 'Won without showdown (fold equity)',
  blue: 'Won at showdown',
  none: 'No pot won',
};

export function renderAnalysisPanel(opts: AnalysisPanelOptions): HTMLElement {
  const a = opts.analysis;
  return el('aside', { class: 'panel panel--open' },
    el('div', { class: 'panel__head' },
      el('h3', { class: 'panel__title' }, 'Hand Review'),
      el('button', { class: 'panel__close', onclick: opts.onClose, 'aria-label': 'Close' }, '✕')),
    el('div', { class: 'panel__body' },
      el('div', { class: `panel__tag panel__tag--${a.tag}` }, TAG_LABEL[a.tag]),
      el('p', { class: 'panel__summary' }, a.summary),
      equityStrip(a),
      section('Your decisions', a.grades.map(decisionRow)),
      a.leaks.length
        ? section('Leaks flagged', a.leaks.map(leakRow))
        : el('p', { class: 'panel__clean' }, 'No leaks flagged this hand. 👍'),
    ),
  );
}

function equityStrip(a: HandAnalysis): HTMLElement {
  if (a.equityLine.length === 0) return el('div', {});
  const bars = a.equityLine.map(pt =>
    el('div', { class: 'eqbar', title: `${pt.street}: ${Math.round(pt.equity * 100)}%` },
      el('div', { class: 'eqbar__fill', style: `height:${Math.round(pt.equity * 100)}%` })));
  return el('div', { class: 'panel__equity' },
    el('div', { class: 'panel__equity-label' }, 'Your equity at each decision'),
    el('div', { class: 'eqstrip' }, ...bars));
}

function decisionRow(g: DecisionGrade): HTMLElement {
  const s = g.snapshot;
  const act = s.action.kind === 'bet' || s.action.kind === 'raise'
    ? `${s.action.kind} ${s.action.amount}` : s.action.kind;
  return el('div', { class: 'decision' },
    el('div', { class: 'decision__head' },
      el('span', { class: 'decision__street' }, s.street),
      el('span', { class: 'decision__act' }, act),
      el('span', { class: `verdict verdict--${g.verdict}` }, g.verdict)),
    el('div', { class: 'decision__note' }, g.note));
}

function leakRow(l: Leak): HTMLElement {
  return el('div', { class: `leak leak--${l.severity}` },
    el('div', { class: 'leak__title' }, l.title),
    el('div', { class: 'leak__body' }, l.explanation));
}

function section(title: string, rows: HTMLElement[]): HTMLElement {
  return el('section', { class: 'panel__section' },
    el('h4', { class: 'panel__subtitle' }, title), ...rows);
}

/*
 * Hand review. Opens a stored hand and shows everything that was hidden during
 * play: the full board, every player's hole cards, and the analysis (per-decision
 * verdicts, leaks, equity). It's a static review built from the immutable record
 * plus analyzeHand — no engine re-run needed, so it works for any saved hand.
 */

import { analyzeHand, verdictLabel } from '../analysis/index';
import type { HandRecord } from '../analysis/record';
import type { Card } from '../engine/types';
import { renderCard } from './cards';
import { el, fmtMoney } from './dom';

export interface ReplayOptions {
  readonly record: HandRecord;
  onBack(): void;
}

export function renderHandReview(opts: ReplayOptions): HTMLElement {
  const r = opts.record;
  const a = analyzeHand(r);
  const winners = new Set(r.outcome.winners);

  return el('div', { class: 'review' },
    el('div', { class: 'review__head' },
      el('button', { class: 'modal__btn', onclick: opts.onBack }, '← Back'),
      el('h2', { class: 'review__title' }, describeResult(r))),
    el('div', { class: 'review__board' },
      el('div', { class: 'review__board-label' }, 'Board'),
      el('div', { class: 'board' }, ...r.board.map(c => renderCard(c, { small: true })))),
    el('div', { class: 'review__seats' }, ...seatRows(r, winners)),
    el('div', { class: 'review__analysis' }, panelContent(a)),
  );
}

function seatRows(r: HandRecord, winners: ReadonlySet<string>): HTMLElement[] {
  return Object.entries(r.holeCards).map(([id, hole]) => {
    const name = r.config.names[id] ?? id;
    const isHero = id === r.config.humanId;
    const cls = ['review__seat'];
    if (isHero) cls.push('review__seat--hero');
    if (winners.has(id)) cls.push('review__seat--winner');
    return el('div', { class: cls.join(' ') },
      el('div', { class: 'board' }, ...(hole as Card[]).map(c => renderCard(c, { small: true }))),
      el('span', { class: 'review__seat-name' }, isHero ? `${name} (you)` : name),
      winners.has(id) ? el('span', { class: 'review__win' }, 'won') : null);
  });
}

/** Reuse the analysis panel's shape inline (without the slide-in chrome). */
function panelContent(a: ReturnType<typeof analyzeHand>): HTMLElement {
  const grades = a.grades.map(g =>
    el('div', { class: 'decision' },
      el('div', { class: 'decision__head' },
        el('span', { class: 'decision__street' }, g.snapshot.street),
        el('span', { class: 'decision__act' }, g.snapshot.action.kind),
        el('span', { class: `verdict verdict--${g.verdict}` }, verdictLabel(g.verdict))),
      el('div', { class: 'decision__note' }, g.note)));
  const leaks = a.leaks.map(l =>
    el('div', { class: `leak leak--${l.severity}` },
      el('div', { class: 'leak__title' }, l.title),
      el('div', { class: 'leak__body' }, l.explanation)));
  return el('div', { class: 'panel__body' },
    el('p', { class: 'panel__summary' }, a.summary),
    el('h4', { class: 'panel__subtitle' }, 'Your decisions'), ...grades,
    leaks.length ? el('h4', { class: 'panel__subtitle' }, 'What to watch for') : null, ...leaks);
}

function describeResult(r: HandRecord): string {
  const net = r.outcome.heroNet;
  if (net > 0) return `You won ${fmtMoney(net)}`;
  if (net < 0) return `You lost ${fmtMoney(-net)}`;
  return 'Break-even hand';
}

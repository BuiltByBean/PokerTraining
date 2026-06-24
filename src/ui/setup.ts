/*
 * Pre-game setup. Lets the player choose table size (2-9), difficulty (1-10),
 * and whether to reveal opponents' cards (a training aid). Like the bet slider,
 * it owns its widget state locally and only emits a finished GameConfig — the
 * app config isn't mutated mid-edit.
 */

import type { GameConfig } from '../persistence/save';
import { el } from './dom';

export interface SetupOptions {
  readonly initial: GameConfig;
  readonly hasSave: boolean;
  readonly savedStack?: number;
  onStart(config: GameConfig, resume: boolean): void;
}

const DIFFICULTY_WORDS = [
  'Calling station', 'Very loose', 'Loose', 'Casual', 'Balanced',
  'Solid', 'Tough', 'Strong', 'Shark', 'Crusher',
];

export function renderSetup(opts: SetupOptions): HTMLElement {
  // Mutable working copy; we emit a frozen GameConfig only on start.
  const draft = { ...opts.initial };

  const playersValue = el('span', { class: 'setup__value' }, String(draft.playerCount));
  const diffValue = el('span', { class: 'setup__value' }, String(draft.difficulty));
  const diffWord = el('span', { class: 'setup__word' }, DIFFICULTY_WORDS[draft.difficulty - 1] ?? '');

  const players = stepper(draft.playerCount, 2, 9, n => {
    draft.playerCount = n;
    playersValue.textContent = String(n);
  });

  const difficulty = slider(draft.difficulty, 1, 10, n => {
    draft.difficulty = n;
    diffValue.textContent = String(n);
    diffWord.textContent = DIFFICULTY_WORDS[n - 1] ?? '';
  });

  const actions = el('div', { class: 'setup__actions' },
    opts.hasSave
      ? el('button', { class: 'modal__btn modal__btn--primary', onclick: () => opts.onStart(draft, true) },
          `Resume${opts.savedStack !== undefined ? ` ($${opts.savedStack.toLocaleString()})` : ''}`)
      : null,
    el('button', { class: opts.hasSave ? 'modal__btn' : 'modal__btn modal__btn--primary', onclick: () => opts.onStart(draft, false) }, 'New Game'),
  );

  return el('div', { class: 'modal' },
    el('div', { class: 'modal__card setup' },
      el('h2', { class: 'modal__title' }, 'Poker Training'),
      field('Players', el('div', { class: 'setup__row' }, players, playersValue)),
      field('Difficulty', el('div', { class: 'setup__row' }, difficulty,
        el('div', { class: 'setup__diff' }, diffValue, diffWord))),
      actions,
    ),
  );
}

// ── widgets ──────────────────────────────────────────────────────────────────

function field(label: string, control: HTMLElement): HTMLElement {
  return el('div', { class: 'setup__field' }, el('label', { class: 'setup__label' }, label), control);
}

function stepper(value: number, min: number, max: number, onChange: (n: number) => void): HTMLElement {
  let v = value;
  const out = el('div', { class: 'setup__stepper' });
  const dec = el('button', { class: 'setup__step', onclick: () => set(Math.max(min, v - 1)) }, '−');
  const inc = el('button', { class: 'setup__step', onclick: () => set(Math.min(max, v + 1)) }, '+');
  function set(n: number) { v = n; onChange(n); }
  out.append(dec, inc);
  return out;
}

function slider(value: number, min: number, max: number, onChange: (n: number) => void): HTMLElement {
  return el('input', {
    type: 'range', min: String(min), max: String(max), value: String(value), step: '1',
    class: 'bet-slider__range setup__slider',
    oninput: (e: Event) => onChange(Number((e.target as HTMLInputElement).value)),
  });
}

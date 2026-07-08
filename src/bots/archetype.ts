/*
 * Bot personalities. The table's difficulty sets a base SkillProfile; an
 * archetype then *colours* it — nudging the dials so some seats play loose and
 * aggressive while others are tight and timid — and sets how the bot prefers to
 * exploit the human (bluff-heavy vs. value/trap-heavy).
 *
 * Deltas are deliberately modest: difficulty still decides how *good* a bot is;
 * the archetype decides how it *feels*. A "maniac" at level 3 is a spewy fish;
 * the same archetype at level 9 is a tough, fearless LAG.
 */

import type { SkillProfile } from './skill';

export type BotArchetype = 'tag' | 'lag' | 'maniac' | 'rock' | 'station' | 'balanced';

type Deltas = Partial<Record<keyof SkillProfile, number>>;

// Additive nudges on top of the difficulty base, clamped to [0, 1].
const DIAL_DELTAS: Record<BotArchetype, Deltas> = {
  tag:      { tightness: 0.14, aggression: 0.12, bluffFreq: 0.02 },
  lag:      { tightness: -0.14, aggression: 0.2, bluffFreq: 0.06 },
  maniac:   { tightness: -0.3, aggression: 0.28, bluffFreq: 0.12, potOddsAdherence: -0.12, mistakeRate: 0.04 },
  rock:     { tightness: 0.22, aggression: -0.24, bluffFreq: -0.05 },
  station:  { tightness: -0.16, aggression: -0.22, potOddsAdherence: -0.28, bluffFreq: -0.06, drawDiscipline: -0.15 },
  balanced: {},
};

export function applyArchetype(base: SkillProfile, arch: BotArchetype | undefined): SkillProfile {
  if (!arch) return base;
  const deltas = DIAL_DELTAS[arch];
  const out = { ...base } as Record<keyof SkillProfile, number>;
  for (const key of Object.keys(deltas) as (keyof SkillProfile)[]) {
    out[key] = clamp01(base[key] + (deltas[key] ?? 0));
  }
  return out as unknown as SkillProfile;
}

/**
 * How this personality prefers to attack a weak human — multipliers on the
 * three exploit levers. Bluffers lean on fold-happy opponents; timid seats
 * (rock/station) barely bluff and instead value-bet and trap harder.
 */
export interface ExploitLeans {
  readonly bluff: number;
  readonly value: number;
  readonly trap: number;
}

const LEANS: Record<BotArchetype, ExploitLeans> = {
  tag:      { bluff: 1.0, value: 1.1, trap: 0.8 },
  lag:      { bluff: 1.3, value: 1.0, trap: 0.9 },
  maniac:   { bluff: 1.5, value: 0.9, trap: 0.7 },
  rock:     { bluff: 0.6, value: 1.2, trap: 1.2 },
  station:  { bluff: 0.5, value: 1.3, trap: 1.3 },
  balanced: { bluff: 1.0, value: 1.0, trap: 1.0 },
};

export function archetypeLeans(arch: BotArchetype | undefined): ExploitLeans {
  return LEANS[arch ?? 'balanced'];
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

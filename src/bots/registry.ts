/*
 * Bot roster — up to 8 named opponents (a 9-handed table is hero + 8). They all
 * run the same skill-driven decision function; the table's difficulty level sets
 * their SkillProfile (jittered per seat in main.ts), and each persona's
 * archetype colours it — a spread of aggressive (lag/maniac) and timid
 * (rock/station) styles so the table doesn't feel like eight clones.
 */

import { balancedBot } from './balanced';
import type { BotPersona } from './types';

export const PERSONAS: readonly BotPersona[] = [
  { name: 'Einstein', bot: balancedBot, archetype: 'tag' },
  { name: 'Grace', bot: balancedBot, archetype: 'lag' },
  { name: 'Ada', bot: balancedBot, archetype: 'balanced' },
  { name: 'Hedy', bot: balancedBot, archetype: 'station' },
  { name: 'Turing', bot: balancedBot, archetype: 'rock' },
  { name: 'Lovelace', bot: balancedBot, archetype: 'maniac' },
  { name: 'Hopper', bot: balancedBot, archetype: 'lag' },
  { name: 'Knuth', bot: balancedBot, archetype: 'tag' },
];

export function botFor(name: string): BotPersona | undefined {
  return PERSONAS.find(p => p.name === name);
}

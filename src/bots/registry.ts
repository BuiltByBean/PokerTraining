/*
 * Bot roster — up to 8 named opponents (a 9-handed table is hero + 8). They all
 * run the same skill-driven decision function; the table's difficulty level sets
 * their SkillProfile (jittered per seat in main.ts), so there's no per-persona
 * difficulty here anymore. Names are just flavour.
 */

import { balancedBot } from './balanced';
import type { BotPersona } from './types';

export const PERSONAS: readonly BotPersona[] = [
  { name: 'Einstein', bot: balancedBot },
  { name: 'Grace', bot: balancedBot },
  { name: 'Ada', bot: balancedBot },
  { name: 'Hedy', bot: balancedBot },
  { name: 'Turing', bot: balancedBot },
  { name: 'Lovelace', bot: balancedBot },
  { name: 'Hopper', bot: balancedBot },
  { name: 'Knuth', bot: balancedBot },
];

export function botFor(name: string): BotPersona | undefined {
  return PERSONAS.find(p => p.name === name);
}

/*
 * Bot roster. Adding a new personality means: write the bot, register it
 * here, and it shows up in the difficulty picker. No other file needs to
 * change.
 */

import { balancedBot } from './balanced';
import type { BotPersona } from './types';

export const PERSONAS: readonly BotPersona[] = [
  { name: 'Einstein', difficulty: 'medium', bot: balancedBot },
  { name: 'Grace',    difficulty: 'medium', bot: balancedBot },
  { name: 'Ada',      difficulty: 'medium', bot: balancedBot },
  { name: 'Hedy',     difficulty: 'medium', bot: balancedBot },
];

export function botFor(name: string): BotPersona | undefined {
  return PERSONAS.find(p => p.name === name);
}

/*
 * Bot interface. A "bot" is just a function from view → action; everything
 * else (personality, difficulty, opponent modelling) lives behind it.
 *
 * Why a function and not a class? Bots have no state. Anything they "remember"
 * about an opponent should live in the engine's log (which they receive via
 * BotView), so we can replay any hand deterministically by re-applying the
 * same actions in order — there's nothing hidden inside the bot.
 */

import type { Action, BotView } from '../engine/types';
import type { Rng } from '../engine/rng';

export interface BotContext {
  readonly view: BotView;
  readonly rng: Rng;
}

export type Bot = (ctx: BotContext) => Action;

export interface BotPersona {
  readonly name: string;
  readonly difficulty: 'easy' | 'medium' | 'hard' | 'expert';
  readonly bot: Bot;
}

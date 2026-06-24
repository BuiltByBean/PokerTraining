/*
 * Difficulty 1-10 → a SkillProfile the bot reads instead of hardcoded cutoffs.
 * One table-wide level drives the feel; each seat gets a little jitter so the
 * bots aren't clones. Every field is a 0-1 dial:
 *
 *   level 1  ≈ loose-passive calling station: plays everything, never folds to
 *             a price, lots of random mistakes, no bluffs.
 *   level 5  ≈ the original balanced bot.
 *   level 10 ≈ tough TAG/LAG: tight-aggressive, respects pot odds, bluffs with
 *             discipline, almost never punts.
 *
 * Fields are interpolated linearly between the level-1 and level-10 anchors, so
 * each dial is monotonic in level (verified by tests).
 */

import { mulberry32 } from '../engine/rng';

export interface SkillProfile {
  /** Higher = folds more weak hands. */
  readonly tightness: number;
  /** Higher = bets/raises rather than calls/checks. */
  readonly aggression: number;
  /** Probability of firing a bluff when checked to / with air. */
  readonly bluffFreq: number;
  /** Higher = only continues on draws with the right price. */
  readonly drawDiscipline: number;
  /** Higher = respects pot odds when facing a bet (low = calling station). */
  readonly potOddsAdherence: number;
  /** Probability of a random suboptimal (but legal) action. */
  readonly mistakeRate: number;
  /** Bet-sizing randomness, 0 = textbook sizes. */
  readonly sizingNoise: number;
}

interface Anchor {
  readonly key: keyof SkillProfile;
  readonly atLevel1: number;
  readonly atLevel10: number;
}

// Direction of each dial across the 1→10 range (rises unless noted).
const ANCHORS: readonly Anchor[] = [
  { key: 'tightness', atLevel1: 0.15, atLevel10: 0.6 },
  { key: 'aggression', atLevel1: 0.15, atLevel10: 0.8 },
  { key: 'bluffFreq', atLevel1: 0.0, atLevel10: 0.13 },
  { key: 'drawDiscipline', atLevel1: 0.1, atLevel10: 0.95 },
  { key: 'potOddsAdherence', atLevel1: 0.05, atLevel10: 0.97 },
  { key: 'mistakeRate', atLevel1: 0.32, atLevel10: 0.02 }, // falls with level
  { key: 'sizingNoise', atLevel1: 0.6, atLevel10: 0.1 }, // falls with level
];

export function profileForLevel(level: number): SkillProfile {
  const t = (clamp(level, 1, 10) - 1) / 9;
  const p = {} as Record<keyof SkillProfile, number>;
  for (const a of ANCHORS) p[a.key] = round2(a.atLevel1 + (a.atLevel10 - a.atLevel1) * t);
  return p as unknown as SkillProfile;
}

/** Per-seat variation so bots at the same level don't act identically. */
export function jitter(profile: SkillProfile, seed: number): SkillProfile {
  const rng = mulberry32(seed >>> 0);
  const out = {} as Record<keyof SkillProfile, number>;
  for (const a of ANCHORS) {
    const delta = (rng.next() - 0.5) * 0.12; // ±0.06
    out[a.key] = clamp(round2(profile[a.key] + delta), 0, 1);
  }
  return out as unknown as SkillProfile;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

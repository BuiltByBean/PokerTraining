/*
 * Side-pot construction. The hard case: A bets 100, B (stack 60) calls
 * all-in, C calls 100. The main pot is 60*3=180 (A+B+C eligible), the side
 * pot is 40*2=80 (A+C eligible). B can win only the main pot even if she has
 * the best hand.
 *
 * Algorithm: walk the unique commitment levels low → high; each level "peels
 * off" min(level, remaining) from every player still in. Eligibility = the
 * players who contributed at that level.
 *
 * This works for any number of side pots and any combination of folds —
 * folded players' chips are included in the pot at the level they reached
 * before folding, but they cannot win.
 */

import type { Player, PotShare } from './types';

interface Contribution {
  playerId: string;
  amount: number;
  folded: boolean;
}

export function buildSidePots(players: readonly Player[]): PotShare[] {
  const contribs: Contribution[] = players
    .filter(p => p.totalCommitted > 0)
    .map(p => ({
      playerId: p.id,
      amount: p.totalCommitted,
      folded: p.status === 'folded',
    }));

  if (contribs.length === 0) return [];

  const pots: PotShare[] = [];
  let lastLevel = 0;
  const levels = uniqueSortedAmounts(contribs);

  for (const level of levels) {
    const slice = level - lastLevel;
    const contributors = contribs.filter(c => c.amount >= level);
    const eligible = contributors
      .filter(c => !c.folded)
      .map(c => c.playerId);
    const amount = slice * contributors.length;
    if (amount > 0 && eligible.length > 0) {
      pots.push({ amount, eligible });
    } else if (amount > 0 && eligible.length === 0) {
      // Everyone at this level folded — collapse into the previous pot.
      // (Rare; happens with dead money from a player who later folded.)
      const prev = pots[pots.length - 1];
      if (prev) pots[pots.length - 1] = { amount: prev.amount + amount, eligible: prev.eligible };
    }
    lastLevel = level;
  }

  return pots;
}

function uniqueSortedAmounts(contribs: readonly Contribution[]): number[] {
  const set = new Set<number>();
  for (const c of contribs) set.add(c.amount);
  return [...set].sort((a, b) => a - b);
}

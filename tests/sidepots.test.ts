import { describe, expect, it } from 'vitest';
import { buildSidePots } from '../src/engine/sidepots';
import type { Player } from '../src/engine/types';

function p(id: string, committed: number, folded = false): Player {
  return {
    id,
    name: id,
    isHuman: false,
    stack: 0,
    hole: [],
    status: folded ? 'folded' : 'active',
    betThisStreet: 0,
    totalCommitted: committed,
  };
}

describe('side pots', () => {
  it('single pot when everyone commits the same', () => {
    const pots = buildSidePots([p('A', 100), p('B', 100), p('C', 100)]);
    expect(pots).toEqual([{ amount: 300, eligible: ['A', 'B', 'C'] }]);
  });

  it('one all-in creates a side pot', () => {
    // A bets 100, B has 60 (all-in), C calls 100.
    const pots = buildSidePots([p('A', 100), p('B', 60), p('C', 100)]);
    expect(pots).toHaveLength(2);
    expect(pots[0]).toEqual({ amount: 180, eligible: ['A', 'B', 'C'] });
    expect(pots[1]).toEqual({ amount: 80, eligible: ['A', 'C'] });
  });

  it('three all-ins create three pots', () => {
    const pots = buildSidePots([p('A', 30), p('B', 60), p('C', 90), p('D', 90)]);
    expect(pots).toHaveLength(3);
    expect(pots[0]).toEqual({ amount: 120, eligible: ['A', 'B', 'C', 'D'] });
    expect(pots[1]).toEqual({ amount: 90, eligible: ['B', 'C', 'D'] });
    expect(pots[2]).toEqual({ amount: 60, eligible: ['C', 'D'] });
  });

  it('folded players forfeit eligibility but their chips stay in the pot', () => {
    // A folds at 50 (dead money), B & C contest 100 each.
    const pots = buildSidePots([p('A', 50, true), p('B', 100), p('C', 100)]);
    expect(pots).toHaveLength(2);
    expect(pots[0]).toEqual({ amount: 150, eligible: ['B', 'C'] });
    expect(pots[1]).toEqual({ amount: 100, eligible: ['B', 'C'] });
  });

  it('zero-commitment players are ignored', () => {
    const pots = buildSidePots([p('A', 0), p('B', 100), p('C', 100)]);
    expect(pots).toEqual([{ amount: 200, eligible: ['B', 'C'] }]);
  });

  it('no contribution → no pots', () => {
    expect(buildSidePots([p('A', 0), p('B', 0)])).toEqual([]);
  });
});

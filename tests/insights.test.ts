import { describe, expect, it } from 'vitest';
import { detectAggregateLeaks, detectStrengths } from '../src/analysis/index';
import type { Ratio, StatPanel } from '../src/analysis/index';

function ratio(pct: number | undefined): Ratio {
  return { hits: 0, opps: 100, pct };
}

function panel(o: Partial<StatPanel>): StatPanel {
  return {
    hands: 100,
    vpip: ratio(undefined), pfr: ratio(undefined), vpipPfrGap: undefined,
    threeBet: ratio(undefined), af: undefined,
    wtsd: ratio(undefined), wssd: ratio(undefined), wwsf: ratio(undefined),
    redLineBb: 0, blueLineBb: 0, netBb: 0, archetype: undefined,
    ...o,
  };
}

describe('detectAggregateLeaks — flags every issue, not just one', () => {
  it('surfaces multiple weaknesses at once, worst first', () => {
    const leaks = detectAggregateLeaks([], panel({
      vpip: ratio(0.5),       // too loose
      pfr: ratio(0.15),
      vpipPfrGap: 0.35,        // calls too much preflop
      af: 0.5,                 // too passive postflop
      wtsd: ratio(0.45),       // \
      wssd: ratio(0.4),        // /  calling station (severe)
    }));
    const codes = leaks.map(l => l.code);
    expect(codes).toContain('station');
    expect(codes).toContain('too-loose');
    expect(codes).toContain('passive-pre');
    expect(codes).toContain('passive-post');
    expect(leaks.length).toBeGreaterThanOrEqual(4);
    expect(leaks[0]?.severity).toBe('severe'); // most serious first
  });

  it('stays quiet on a solid profile', () => {
    const leaks = detectAggregateLeaks([], panel({
      vpip: ratio(0.22), pfr: ratio(0.18), vpipPfrGap: 0.04, af: 2.2,
      wtsd: ratio(0.3), wssd: ratio(0.55), wwsf: ratio(0.48),
    }));
    expect(leaks).toHaveLength(0);
  });
});

describe('detectStrengths', () => {
  it('lists what a solid player does well', () => {
    const strengths = detectStrengths(panel({
      vpip: ratio(0.22), pfr: ratio(0.18), vpipPfrGap: 0.04, af: 2.2,
      wtsd: ratio(0.3), wssd: ratio(0.55), wwsf: ratio(0.48),
    }));
    const codes = strengths.map(s => s.code);
    expect(codes).toContain('good-selection');
    expect(codes).toContain('takes-lead');
    expect(codes).toContain('good-aggro');
    expect(codes).toContain('strong-showdowns');
    expect(strengths.length).toBeGreaterThanOrEqual(4);
  });

  it('finds nothing to praise in a bad profile', () => {
    const strengths = detectStrengths(panel({
      vpip: ratio(0.5), pfr: ratio(0.05), vpipPfrGap: 0.45, af: 0.4,
      wtsd: ratio(0.45), wssd: ratio(0.4), wwsf: ratio(0.3),
    }));
    expect(strengths).toHaveLength(0);
  });
});

/*
 * Lifetime stat aggregation across stored hands. The cardinal rule (per the
 * research): every percentage needs the right *opportunity* denominator —
 * 3-bet% is over hands where you FACED an open, WTSD is over hands you SAW A
 * FLOP, not hands dealt. Getting the denominator wrong is the classic bug.
 *
 * Each Ratio stays `undefined` until it clears a minimum sample so the UI never
 * screams "leak!" off 20 noisy hands. The archetype only resolves once the
 * gating stats are populated.
 */

import type { HandRecord } from './record';
import type { DecisionSnapshot } from './recorder';

export interface Ratio {
  readonly hits: number;
  readonly opps: number;
  /** hits/opps, or undefined until `opps` clears the minimum sample. */
  readonly pct: number | undefined;
}

export type Archetype =
  | 'nit'
  | 'tag'
  | 'lag'
  | 'calling-station'
  | 'maniac'
  | 'loose-passive'
  | 'balanced';

export interface StatPanel {
  readonly hands: number;
  readonly vpip: Ratio;
  readonly pfr: Ratio;
  readonly vpipPfrGap: number | undefined;
  readonly threeBet: Ratio;
  readonly af: number | undefined;
  readonly wtsd: Ratio;
  readonly wssd: Ratio;
  readonly wwsf: Ratio;
  readonly redLineBb: number;
  readonly blueLineBb: number;
  readonly netBb: number;
  readonly archetype: Archetype | undefined;
}

const MIN_HANDS = 30;
const MIN_OPP = 20;
const MIN_SHOWDOWN = 15;
const MIN_POSTFLOP = 15;

export function computeStats(records: readonly HandRecord[]): StatPanel {
  const c = newCounters();
  for (const r of records) accumulate(c, r);

  const vpip = ratio(c.vpip, c.hands, MIN_HANDS);
  const pfr = ratio(c.pfr, c.hands, MIN_HANDS);
  const wtsd = ratio(c.showdowns, c.sawFlop, MIN_SHOWDOWN);
  const wssd = ratio(c.wonShowdown, c.showdowns, MIN_SHOWDOWN);
  const af = c.postflopCalls + c.postflopAggr >= MIN_POSTFLOP && c.postflopCalls > 0
    ? c.postflopAggr / c.postflopCalls
    : undefined;

  return {
    hands: c.hands,
    vpip,
    pfr,
    vpipPfrGap: vpip.pct !== undefined && pfr.pct !== undefined ? vpip.pct - pfr.pct : undefined,
    threeBet: ratio(c.threeBet, c.facedOpen, MIN_OPP),
    af,
    wtsd,
    wssd,
    wwsf: ratio(c.wonSawFlop, c.sawFlop, MIN_SHOWDOWN),
    redLineBb: round1(c.redLine),
    blueLineBb: round1(c.blueLine),
    netBb: round1(c.redLine + c.blueLine),
    archetype: classify(vpip, pfr, af, wtsd, wssd),
  };
}

// ── accumulation ──────────────────────────────────────────────────────────

interface Counters {
  hands: number; vpip: number; pfr: number; facedOpen: number; threeBet: number;
  sawFlop: number; showdowns: number; wonShowdown: number; wonSawFlop: number;
  postflopAggr: number; postflopCalls: number; redLine: number; blueLine: number;
}

function newCounters(): Counters {
  return {
    hands: 0, vpip: 0, pfr: 0, facedOpen: 0, threeBet: 0, sawFlop: 0, showdowns: 0,
    wonShowdown: 0, wonSawFlop: 0, postflopAggr: 0, postflopCalls: 0, redLine: 0, blueLine: 0,
  };
}

function accumulate(c: Counters, r: HandRecord): void {
  const heroId = r.config.humanId;
  const pre = r.snapshots.filter(s => s.actorId === heroId && s.street === 'preflop');
  const post = r.snapshots.filter(s => s.actorId === heroId && s.street !== 'preflop');

  c.hands += 1;
  if (pre.some(s => isVoluntary(s))) c.vpip += 1;
  if (pre.some(s => isRaise(s))) c.pfr += 1;
  if (pre.some(s => s.aggressorId !== undefined)) {
    c.facedOpen += 1;
    if (pre.some(s => s.aggressorId !== undefined && isRaise(s))) c.threeBet += 1;
  }

  const foldedPreflop = pre.some(s => s.action.kind === 'fold');
  const sawFlop = !foldedPreflop && r.board.length >= 3;
  if (sawFlop) {
    c.sawFlop += 1;
    if (r.outcome.heroNet > 0) c.wonSawFlop += 1;
  }
  if (r.outcome.heroWentToShowdown) {
    c.showdowns += 1;
    if (r.outcome.heroNet > 0) c.wonShowdown += 1;
  }

  for (const s of post) {
    if (isAggressive(s)) c.postflopAggr += 1;
    else if (s.action.kind === 'call') c.postflopCalls += 1;
  }

  if (r.outcome.heroWentToShowdown) c.blueLine += r.outcome.heroNetBb;
  else c.redLine += r.outcome.heroNetBb;
}

function isVoluntary(s: DecisionSnapshot): boolean {
  const k = s.action.kind;
  return k === 'call' || k === 'bet' || k === 'raise' || k === 'allin';
}

function isRaise(s: DecisionSnapshot): boolean {
  return s.action.kind === 'bet' || s.action.kind === 'raise' || (s.action.kind === 'allin' && s.amountPutIn > s.betFaced);
}

function isAggressive(s: DecisionSnapshot): boolean {
  return s.action.kind === 'bet' || s.action.kind === 'raise' || s.action.kind === 'allin';
}

// ── helpers ─────────────────────────────────────────────────────────────────

function ratio(hits: number, opps: number, minOpps: number): Ratio {
  return { hits, opps, pct: opps >= minOpps ? hits / opps : undefined };
}

function classify(
  vpip: Ratio, pfr: Ratio, af: number | undefined, wtsd: Ratio, wssd: Ratio,
): Archetype | undefined {
  const v = vpip.pct;
  const p = pfr.pct;
  if (v === undefined || p === undefined) return undefined;
  if (wtsd.pct !== undefined && wssd.pct !== undefined && wtsd.pct > 0.4 && wssd.pct < 0.45) {
    return 'calling-station';
  }
  if (v < 0.14) return 'nit';
  if (v > 0.4 && (af ?? 0) > 3) return 'maniac';
  if (v > 0.3 && p < 0.12) return 'loose-passive';
  if (v > 0.28 && p > 0.22) return 'lag';
  if (v >= 0.17 && v <= 0.28 && p >= 0.13 && v - p <= 0.08) return 'tag';
  return 'balanced';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

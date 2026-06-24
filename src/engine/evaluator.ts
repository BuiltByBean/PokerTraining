/*
 * 7-card poker hand evaluator. Given 5–7 cards, returns the best 5-card hand
 * and a single integer score so two hands can be compared with `>`.
 *
 * Design choice: brute force over the (max) C(7,5)=21 combinations rather than
 * a lookup-table approach. It's ~microseconds per eval — completely fine for a
 * single-table game where we evaluate <10 hands per showdown. Lookup tables
 * (Cactus Kev etc.) are a worthwhile optimisation when you're evaluating
 * millions of hands for an equity calculator; not for v1.
 *
 * Score format: a single 32-bit-friendly integer
 *   category * 10^10  +  kicker chain
 * The kicker chain packs the 5 contributing ranks (each 0–14, 4 bits) into
 * 20 bits so ties break by the highest unique kicker. Higher score = better.
 */

import type { Card, Rank } from './types';

export type Category =
  | 'high-card'
  | 'pair'
  | 'two-pair'
  | 'three-of-a-kind'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'four-of-a-kind'
  | 'straight-flush'
  | 'royal-flush';

const CATEGORY_RANK: Record<Category, number> = {
  'high-card': 1,
  pair: 2,
  'two-pair': 3,
  'three-of-a-kind': 4,
  straight: 5,
  flush: 6,
  'full-house': 7,
  'four-of-a-kind': 8,
  'straight-flush': 9,
  'royal-flush': 10,
};

const HUMAN_NAME: Record<Category, string> = {
  'high-card': 'High Card',
  pair: 'Pair',
  'two-pair': 'Two Pair',
  'three-of-a-kind': 'Three of a Kind',
  straight: 'Straight',
  flush: 'Flush',
  'full-house': 'Full House',
  'four-of-a-kind': 'Four of a Kind',
  'straight-flush': 'Straight Flush',
  'royal-flush': 'Royal Flush',
};

export interface HandEval {
  /** Higher = better. Always positive. */
  readonly score: number;
  readonly category: Category;
  /** The 5 cards (subset of the input) that make the best hand. */
  readonly best5: readonly Card[];
  readonly name: string;
}

/** Public entry point. Cards must be 5..7 unique cards. */
export function evaluate(cards: readonly Card[]): HandEval {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`evaluate expects 5..7 cards, got ${cards.length}`);
  }
  const combos = combinationsOf5(cards);
  let best: HandEval | undefined;
  for (const five of combos) {
    const e = score5(five);
    if (!best || e.score > best.score) best = e;
  }
  // Safe: combos is non-empty (≥1 from any 5..7 cards).
  return best as HandEval;
}

export function categoryName(c: Category): string {
  return HUMAN_NAME[c];
}

// ── internals ───────────────────────────────────────────────────────────────

/** All C(n,5) subsets, returned as flat arrays. n=5..7. */
function combinationsOf5(cards: readonly Card[]): Card[][] {
  const out: Card[][] = [];
  const n = cards.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++)
            out.push([cards[a] as Card, cards[b] as Card, cards[c] as Card, cards[d] as Card, cards[e] as Card]);
  return out;
}

function pack(category: Category, kickers: readonly number[]): number {
  // 5 kicker slots * 4 bits each = 20 bits. Category lifted above so a higher
  // category always wins even when kickers underflow.
  let chain = 0;
  for (const k of kickers) chain = (chain << 4) | (k & 0xf);
  return CATEGORY_RANK[category] * 0x100000 + chain;
}

/** Score a fixed 5-card hand. */
function score5(hand: readonly Card[]): HandEval {
  // Sort descending by rank — most evaluators below depend on this order.
  const sorted = [...hand].sort((a, b) => b.rank - a.rank);

  const flushSuit = onlySuit(sorted);
  const straightHigh = straightHighCard(sorted);

  // Straight flush / royal — both need flush + straight on the SAME 5 cards.
  if (flushSuit && straightHigh) {
    const cat: Category = straightHigh === 14 ? 'royal-flush' : 'straight-flush';
    return {
      score: pack(cat, [straightHigh]),
      category: cat,
      best5: sorted,
      name: HUMAN_NAME[cat],
    };
  }

  // Group by rank for the made-hand checks. Buckets are sorted by (count desc,
  // then rank desc) so the first bucket is the quad/trip/highest-pair.
  const buckets = bucketsByRank(sorted);

  if (buckets[0] && buckets[0].count === 4) {
    const quad = buckets[0].rank;
    const kicker = (buckets[1]?.rank ?? 0);
    return {
      score: pack('four-of-a-kind', [quad, kicker]),
      category: 'four-of-a-kind',
      best5: sorted,
      name: HUMAN_NAME['four-of-a-kind'],
    };
  }

  if (buckets[0] && buckets[0].count === 3 && buckets[1] && buckets[1].count >= 2) {
    return {
      score: pack('full-house', [buckets[0].rank, buckets[1].rank]),
      category: 'full-house',
      best5: sorted,
      name: HUMAN_NAME['full-house'],
    };
  }

  if (flushSuit) {
    return {
      score: pack('flush', sorted.map(c => c.rank)),
      category: 'flush',
      best5: sorted,
      name: HUMAN_NAME.flush,
    };
  }

  if (straightHigh) {
    return {
      score: pack('straight', [straightHigh]),
      category: 'straight',
      best5: sorted,
      name: HUMAN_NAME.straight,
    };
  }

  if (buckets[0] && buckets[0].count === 3) {
    const trip = buckets[0].rank;
    const kickers = sorted.filter(c => c.rank !== trip).map(c => c.rank).slice(0, 2);
    return {
      score: pack('three-of-a-kind', [trip, ...kickers]),
      category: 'three-of-a-kind',
      best5: sorted,
      name: HUMAN_NAME['three-of-a-kind'],
    };
  }

  if (buckets[0] && buckets[0].count === 2 && buckets[1] && buckets[1].count === 2) {
    const hi = buckets[0].rank;
    const lo = buckets[1].rank;
    const kicker = sorted.find(c => c.rank !== hi && c.rank !== lo)?.rank ?? 0;
    return {
      score: pack('two-pair', [hi, lo, kicker]),
      category: 'two-pair',
      best5: sorted,
      name: HUMAN_NAME['two-pair'],
    };
  }

  if (buckets[0] && buckets[0].count === 2) {
    const pair = buckets[0].rank;
    const kickers = sorted.filter(c => c.rank !== pair).map(c => c.rank).slice(0, 3);
    return {
      score: pack('pair', [pair, ...kickers]),
      category: 'pair',
      best5: sorted,
      name: HUMAN_NAME.pair,
    };
  }

  return {
    score: pack('high-card', sorted.map(c => c.rank)),
    category: 'high-card',
    best5: sorted,
    name: HUMAN_NAME['high-card'],
  };
}

/** If all 5 cards share a suit, return it; else undefined. */
function onlySuit(hand: readonly Card[]): Card['suit'] | undefined {
  const s = hand[0]?.suit;
  if (!s) return undefined;
  return hand.every(c => c.suit === s) ? s : undefined;
}

/**
 * Highest card of the straight (e.g. 5 for A-2-3-4-5 wheel; 14 for T-J-Q-K-A
 * Broadway). Returns undefined when there's no straight. Input must be 5 cards
 * sorted high → low; duplicates are allowed (we de-dupe by rank internally
 * because evaluator is called from score5 only with 5 cards, but two of the
 * same rank obviously can't form a straight).
 */
function straightHighCard(hand: readonly Card[]): Rank | undefined {
  const ranks = uniqueRanksDesc(hand);
  if (ranks.length < 5) return undefined;
  for (let i = 0; i <= ranks.length - 5; i++) {
    const top = ranks[i] as Rank;
    if (
      ranks[i + 1] === top - 1 &&
      ranks[i + 2] === top - 2 &&
      ranks[i + 3] === top - 3 &&
      ranks[i + 4] === top - 4
    ) {
      return top;
    }
  }
  // The wheel: A-2-3-4-5. Ace already at index 0 if present (rank 14).
  if (ranks[0] === 14 && ranks.includes(5 as Rank) && ranks.includes(4 as Rank) && ranks.includes(3 as Rank) && ranks.includes(2 as Rank)) {
    return 5 as Rank;
  }
  return undefined;
}

function uniqueRanksDesc(hand: readonly Card[]): Rank[] {
  const seen = new Set<Rank>();
  const out: Rank[] = [];
  for (const c of hand) {
    if (!seen.has(c.rank)) {
      seen.add(c.rank);
      out.push(c.rank);
    }
  }
  return out.sort((a, b) => b - a);
}

interface Bucket { rank: Rank; count: number }

/** Group by rank, return buckets sorted by count desc, then rank desc. */
function bucketsByRank(hand: readonly Card[]): Bucket[] {
  const counts = new Map<Rank, number>();
  for (const c of hand) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  const buckets: Bucket[] = [];
  for (const [rank, count] of counts) buckets.push({ rank, count });
  buckets.sort((a, b) => b.count - a.count || b.rank - a.rank);
  return buckets;
}

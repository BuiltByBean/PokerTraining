import type { Card, Rank, Suit } from './types';
import type { Rng } from './rng';

const SUITS: readonly Suit[] = ['c', 'd', 'h', 's'];
const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/** A fresh, sorted, unshuffled 52-card deck. Always returns a new array. */
export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

/** Shuffle a deck in place and return it. */
export function shuffled(deck: Card[], rng: Rng): Card[] {
  return rng.shuffle(deck);
}

/**
 * Pop n cards off the top of the deck (mutates). The "top" is the END of the
 * array — pushing/popping is O(1) where shift would be O(n). Order is preserved
 * for the caller, e.g. dealing alternates so the first popped card goes to the
 * first player.
 */
export function deal(deck: Card[], n: number): Card[] {
  if (n > deck.length) {
    throw new Error(`Cannot deal ${n} from deck of ${deck.length}`);
  }
  const out: Card[] = [];
  for (let i = 0; i < n; i++) {
    out.push(deck.pop() as Card);
  }
  return out;
}

const RANK_TO_CHAR: Record<Rank, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

const CHAR_TO_RANK: Record<string, Rank> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
};

/** "As" — Ace of spades. Used in tests + log readability. */
export function cardToString(c: Card): string {
  return `${RANK_TO_CHAR[c.rank]}${c.suit}`;
}

/** Parse "As" / "Tc" / "2h". Throws on garbage so a typo in a test fails loudly. */
export function cardFromString(s: string): Card {
  if (s.length !== 2) throw new Error(`Bad card '${s}'`);
  const r = CHAR_TO_RANK[s[0] as string];
  const suit = s[1] as Suit;
  if (r === undefined) throw new Error(`Bad rank in '${s}'`);
  if (suit !== 'c' && suit !== 'd' && suit !== 'h' && suit !== 's') {
    throw new Error(`Bad suit in '${s}'`);
  }
  return { rank: r, suit };
}

/** Convenience for tests: cards("As Kd 2c") → [A♠, K♦, 2♣]. */
export function cards(s: string): Card[] {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map(cardFromString);
}

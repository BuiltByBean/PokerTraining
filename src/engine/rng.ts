/*
 * Seeded RNG. Tests must be deterministic; using Math.random in the engine
 * would make every test flake. mulberry32 is small, fast, and has good
 * distribution for our purposes — we're not running a casino.
 *
 * In production, main.ts seeds from crypto.getRandomValues(); tests pass an
 * explicit seed and replay the same hand exactly.
 */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, max). */
  int(max: number): number;
  /** Fisher-Yates in place. Returns the input for chaining. */
  shuffle<T>(arr: T[]): T[];
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(max) {
      // We accept the tiny modulo bias — for max < 2^20 it's invisible and we
      // never deal more than 52 cards.
      return Math.floor(next() * max);
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = arr[i] as typeof arr[number];
        arr[i] = arr[j] as typeof arr[number];
        arr[j] = tmp;
      }
      return arr;
    },
  };
}

/**
 * Production seed source. Pulled out so tests can stub it without monkey-
 * patching crypto.
 */
export function cryptoSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] ?? Date.now();
}

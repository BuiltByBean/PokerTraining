/*
 * Hand-history storage. Keeps the most recent MAX_HANDS hands in a ring buffer
 * (oldest pruned), backed by localStorage. The API is async-shaped even though
 * localStorage is synchronous, so a future swap to IndexedDB needs no caller
 * changes.
 *
 * Like the rest of persistence/, every function is defensive: if storage is
 * blocked or corrupt, reads return [] and writes no-op — the game never breaks
 * because analytics couldn't save.
 */

import type { HandRecord } from '../analysis/record';

const KEY = 'pt.history.v1';
export const MAX_HANDS = 1000;
const EXPORT_VERSION = 1;

/** Append a hand, pruning oldest beyond MAX_HANDS. */
export async function appendHand(record: HandRecord): Promise<void> {
  const all = readAll();
  all.push(record);
  const trimmed = all.length > MAX_HANDS ? all.slice(all.length - MAX_HANDS) : all;
  write(trimmed);
}

/** All stored hands, oldest first. */
export async function getAllHands(): Promise<readonly HandRecord[]> {
  return readAll();
}

export async function countHands(): Promise<number> {
  return readAll().length;
}

export async function clearHistory(): Promise<void> {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Serialize all hands to a portable JSON string for the user to back up. */
export async function exportHands(): Promise<string> {
  return JSON.stringify({ version: EXPORT_VERSION, records: readAll() });
}

// ── internals ───────────────────────────────────────────────────────────────

function readAll(): HandRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as HandRecord[]) : [];
  } catch {
    return [];
  }
}

function write(records: readonly HandRecord[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    /* quota exceeded / private mode — drop silently, game continues */
  }
}

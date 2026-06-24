/*
 * Single chokepoint for localStorage. Schema-versioned so we can evolve the
 * shape later without nuking saves; v0 just stores stacks + record.
 *
 * Failure mode: if localStorage is blocked (private mode, quota exceeded),
 * read returns the default and write is a no-op. The game still runs — it
 * just won't persist. We never throw out of this module; callers don't need
 * to wrap it in try/catch.
 */

const KEY = 'pt.save.v0';
const RECORD_KEY = 'pt.record.v0';

export interface SaveData {
  /** Per-player stacks keyed by player id (P0..P4). */
  readonly stacks: Record<string, number>;
  /** Index of the dealer last hand; next hand rotates +1. */
  readonly dealerIndex: number;
  readonly handNumber: number;
}

const DEFAULT: SaveData = { stacks: {}, dealerIndex: 0, handNumber: 0 };

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as unknown;
    if (!isSaveData(parsed)) return DEFAULT;
    return parsed;
  } catch {
    return DEFAULT;
  }
}

export function saveSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch { /* ignore — game still runs without persistence */ }
}

export function clearSave(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function loadRecord(): number {
  try {
    const raw = localStorage.getItem(RECORD_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveRecord(n: number): void {
  try { localStorage.setItem(RECORD_KEY, String(Math.max(0, Math.floor(n)))); } catch { /* ignore */ }
}

function isSaveData(v: unknown): v is SaveData {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.stacks === 'object' && r.stacks !== null &&
    typeof r.dealerIndex === 'number' &&
    typeof r.handNumber === 'number'
  );
}

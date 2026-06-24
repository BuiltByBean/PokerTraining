import { beforeEach, describe, expect, it } from 'vitest';
import { appendHand, clearHistory, countHands, exportHands, getAllHands, MAX_HANDS } from '../src/persistence/history';
import type { HandRecord } from '../src/analysis/record';

/** Minimal in-memory localStorage so the node test env can exercise storage. */
function installFakeStorage(): void {
  const map = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

function fakeRecord(n: number): HandRecord {
  return {
    version: 1,
    id: `h${n}`,
    playedAt: n,
    config: { playerCount: 2, smallBlind: 1, bigBlind: 2, difficulty: 5, dealerIndex: 0, humanId: 'P0', names: {} },
    holeCards: {},
    board: [],
    snapshots: [],
    outcome: { winners: [], wentToShowdown: false, heroWentToShowdown: false, heroNet: n, heroNetBb: n / 2, line: 'none' },
  };
}

beforeEach(() => {
  installFakeStorage();
});

describe('history ring buffer', () => {
  it('round-trips appended hands oldest-first', async () => {
    await appendHand(fakeRecord(1));
    await appendHand(fakeRecord(2));
    const all = await getAllHands();
    expect(all.map(r => r.id)).toEqual(['h1', 'h2']);
    expect(await countHands()).toBe(2);
  });

  it('prunes oldest beyond the cap', async () => {
    for (let i = 1; i <= MAX_HANDS + 5; i++) await appendHand(fakeRecord(i));
    const all = await getAllHands();
    expect(all.length).toBe(MAX_HANDS);
    // First 5 should have been pruned; oldest kept is h6, newest h1005.
    expect(all[0]?.id).toBe('h6');
    expect(all[all.length - 1]?.id).toBe(`h${MAX_HANDS + 5}`);
  });

  it('clear empties the store', async () => {
    await appendHand(fakeRecord(1));
    await clearHistory();
    expect(await countHands()).toBe(0);
  });

  it('export produces parseable JSON with all records', async () => {
    await appendHand(fakeRecord(1));
    await appendHand(fakeRecord(2));
    const json = await exportHands();
    const parsed = JSON.parse(json) as { version: number; records: HandRecord[] };
    expect(parsed.version).toBe(1);
    expect(parsed.records).toHaveLength(2);
  });

  it('survives corrupt storage by returning empty', async () => {
    localStorage.setItem('pt.history.v1', '{not valid json');
    expect(await getAllHands()).toEqual([]);
  });
});

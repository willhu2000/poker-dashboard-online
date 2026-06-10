import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { idbAvailable, idbGetAll, idbPut, idbPutMany, idbDelete, idbClear } from './idb.js';
import { initSessions, saveSession, loadSessions, deleteSession, isDuplicate, hasOutdatedSessions, exportAllSessions, importSessions } from './sessions.js';
import { analyseLog } from './stats.js';
import { SPLIT_AND_SOLO } from './testFixtures.js';

// Fresh fake-indexeddb global per test file (Vitest isolates files), so the
// store starts empty here.

describe('sessions storage (IndexedDB-backed cache)', () => {
  it('saves, lists, dedups, and deletes through the cache', async () => {
    await initSessions(); // empty store
    expect(loadSessions()).toEqual([]);

    const stats = analyseLog(SPLIT_AND_SOLO);
    const id = saveSession('fixture', stats, new Date(2026, 1, 11), 'hash123', 'Alice', 'raw,csv\n');

    const sessions = loadSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(id);
    expect(sessions[0].fileName).toBe('fixture');
    expect(sessions[0].contentHash).toBe('hash123');
    expect(sessions[0].handCount).toBe(2);
    // rawLog is kept out of the in-memory cache (IndexedDB only).
    expect(sessions[0].rawLog).toBeUndefined();

    expect(isDuplicate('hash123')).toBe(true);
    expect(isDuplicate('nope')).toBe(false);
    expect(hasOutdatedSessions()).toBe(false); // saved at current schema

    deleteSession(id);
    expect(loadSessions()).toEqual([]);
  });

  it('returns independent deep clones (no shared mutation of the cache)', async () => {
    const stats = analyseLog(SPLIT_AND_SOLO);
    saveSession('fixture2', stats, new Date(2026, 1, 11), 'h2', 'Alice', null);
    const a = loadSessions();
    a[0].fileName = 'mutated';
    expect(loadSessions()[0].fileName).toBe('fixture2'); // unchanged
  });
});

describe('backup export / import', () => {
  it('round-trips sessions (incl. rawLog) and skips duplicates on import', async () => {
    await initSessions();
    const stats = analyseLog(SPLIT_AND_SOLO);
    const id = saveSession('backup-me', stats, new Date(2026, 1, 11), 'bkhash', 'Alice', 'raw,csv\n');

    const backup = await exportAllSessions();
    expect(backup.app).toBe('poker-dashboard-backup');
    const exported = backup.sessions.find(s => s.id === id);
    expect(exported).toBeTruthy();
    expect(exported.rawLog).toBe('raw,csv\n'); // full record, not the lite cache copy

    // Importing the same backup is a no-op (everything already present).
    const again = await importSessions(backup);
    expect(again.imported).toBe(0);
    expect(again.skipped).toBeGreaterThanOrEqual(1);

    // After deleting, the backup restores the session.
    deleteSession(id);
    expect(loadSessions().some(s => s.id === id)).toBe(false);
    const restored = await importSessions(backup);
    expect(restored.imported).toBe(1);
    expect(loadSessions().some(s => s.id === id)).toBe(true);
  });

  it('rejects files that are not backups', async () => {
    await expect(importSessions({ nope: true })).rejects.toThrow(/backup/);
  });
});

describe('idb low-level round-trip', () => {
  beforeEach(async () => { await idbClear(); });

  it('is available under fake-indexeddb', () => {
    expect(idbAvailable()).toBe(true);
  });

  it('puts, reads, deletes and clears', async () => {
    await idbPut({ id: 'a', n: 1 });
    await idbPutMany([{ id: 'b', n: 2 }, { id: 'c', n: 3 }]);
    expect((await idbGetAll()).map(r => r.id).sort()).toEqual(['a', 'b', 'c']);

    await idbDelete('b');
    expect((await idbGetAll()).map(r => r.id).sort()).toEqual(['a', 'c']);

    await idbClear();
    expect(await idbGetAll()).toEqual([]);
  });
});

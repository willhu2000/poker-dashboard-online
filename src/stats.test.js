import { describe, it, expect } from 'vitest';
import { analyseLog } from './stats.js';
import { SPLIT_AND_SOLO } from './testFixtures.js';

describe('analyseLog — show actions carry the shown cards', () => {
  it('records the cards on the show action-log entry', () => {
    const { handActionLogs } = analyseLog(SPLIT_AND_SOLO);
    const shows = handActionLogs[1].filter(a => a.action === 'show');
    expect(shows.length).toBe(2); // Alice and Bob both showed
    expect(shows[0].cards).toEqual([{ rank: 'A', suit: 'c' }, { rank: 'A', suit: 'd' }]);
  });
});

describe('analyseLog — split vs solo pots', () => {
  const { players, handCount } = analyseLog(SPLIT_AND_SOLO);
  const alice = players['Alice'];
  const bob = players['Bob'];
  const aliceH1 = alice.handsHistory.find(h => h.num === 1);
  const aliceH2 = alice.handsHistory.find(h => h.num === 2);
  const bobH1 = bob.handsHistory.find(h => h.num === 1);

  it('counts both hands', () => {
    expect(handCount).toBe(2);
    expect(alice.handsDealt).toBe(2);
    expect(bob.handsDealt).toBe(2);
  });

  it('flags the shared pot as a split for both players', () => {
    expect(aliceH1.isSplit).toBe(true);
    expect(bobH1.isSplit).toBe(true);
    expect(aliceH1.splitWith).toEqual(['Bob']);
    expect(bobH1.splitWith).toEqual(['Alice']);
    expect(alice.handsSplit).toBe(1);
    expect(bob.handsSplit).toBe(1);
  });

  it('records take-home wonAmount (not the full pot) on a split', () => {
    expect(aliceH1.potSize).toBe(20);   // total pot
    expect(aliceH1.wonAmount).toBe(10);  // this player's share
    expect(bobH1.wonAmount).toBe(10);
  });

  it('treats the solo win as a non-split win for the full amount', () => {
    expect(aliceH2.won).toBe(true);
    expect(aliceH2.isSplit).toBe(false);
    expect(aliceH2.wonAmount).toBe(50);
  });

  it('counts wins including splits, and splits separately', () => {
    expect(alice.handsWon).toBe(2); // split + solo
    expect(bob.handsWon).toBe(1);   // split only
  });

  it('captures per-hand stack snapshots for the chip graph', () => {
    expect(aliceH1.stack).toBe(1000);
    expect(aliceH2.stack).toBe(1000);
  });

  it('tracks preflop VPIP and PFR', () => {
    // Alice: called (h1) + raised (h2) → VPIP 2, PFR 1 (the raise).
    expect(alice.vpipHands).toBe(2);
    expect(alice.pfrHands).toBe(1);
    // Bob only checked the BB / folded → no voluntary money in.
    expect(bob.vpipHands).toBe(0);
  });
});

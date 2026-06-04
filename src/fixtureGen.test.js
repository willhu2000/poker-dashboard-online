import { describe, it, expect } from 'vitest';
import { analyseLog } from './stats.js';
import { generateSession } from './fixtureGen.js';

describe('generateSession', () => {
  it('produces the requested number of hands', () => {
    const rows = generateSession({ players: ['Will', 'Bob', 'Cara'], seed: 1, hands: 20 });
    const { handCount } = analyseLog(rows);
    expect(handCount).toBe(20);
  });

  it('is deterministic for a given seed', () => {
    const a = generateSession({ players: ['Will', 'Bob'], seed: 5, hands: 12 });
    const b = generateSession({ players: ['Will', 'Bob'], seed: 5, hands: 12 });
    expect(a).toEqual(b);
  });

  it('conserves chips — net is zero-sum', () => {
    const rows = generateSession({ players: ['Will', 'Bob', 'Cara', 'Dee'], seed: 9, hands: 20 });
    const { players } = analyseLog(rows);
    const sum = Object.values(players).reduce((s, p) => s + p.netChips, 0);
    expect(sum).toBe(0);
  });

  it('deals every player into every hand and produces real action', () => {
    const rows = generateSession({ players: ['Will', 'Bob', 'Cara'], seed: 2, hands: 20 });
    const { players } = analyseLog(rows);
    for (const p of Object.values(players)) {
      expect(p.handsDealt).toBe(20);
    }
    // Across a full session there should be voluntary money in and some raises.
    const totalVpip = Object.values(players).reduce((s, p) => s + p.vpipHands, 0);
    const totalPfr = Object.values(players).reduce((s, p) => s + p.pfrHands, 0);
    expect(totalVpip).toBeGreaterThan(0);
    expect(totalPfr).toBeGreaterThan(0);
  });
});

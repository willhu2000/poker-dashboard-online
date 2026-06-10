import { describe, it, expect } from 'vitest';
import { analyseLog } from './stats.js';
import { buildReplayFrames } from './replayEngine.js';
import { UNCALLED_BET_HAND, LEAD_LOST_HAND } from './testFixtures.js';

describe('buildReplayFrames', () => {
  it('balances pot and stacks on a fold-out with an uncalled bet', () => {
    const { handActionLogs } = analyseLog(UNCALLED_BET_HAND);
    const { frames } = buildReplayFrames(handActionLogs[1], 'Alice', null);
    const last = frames[frames.length - 1];

    expect(last.pot).toBe(0); // everything collected, nothing stranded
    const alice = last.players.find(p => p.name === 'Alice');
    const bob = last.players.find(p => p.name === 'Bob');
    expect(alice.stack).toBe(1030); // matches the quit line in the fixture
    expect(bob.stack).toBe(970);
    expect(bob.folded).toBe(true);
  });

  it('tracks pot growth and collection through a full showdown hand', () => {
    const { handActionLogs } = analyseLog(LEAD_LOST_HAND);
    const { frames, meta } = buildReplayFrames(handActionLogs[1], 'Bob', null);

    expect(meta.dealer).toBe('Bob');
    const last = frames[frames.length - 1];
    expect(last.pot).toBe(0);
    expect(last.players.find(p => p.name === 'Alice').stack).toBe(1230);
    expect(last.players.find(p => p.name === 'Bob').stack).toBe(770);
    // Pot peaks at 460 just before the collect.
    expect(Math.max(...frames.map(f => f.pot))).toBe(460);
  });
});

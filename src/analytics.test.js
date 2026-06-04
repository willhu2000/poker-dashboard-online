import { describe, it, expect } from 'vitest';
import { analyseLog } from './stats.js';
import { POSITIONS_HAND, MULTIWAY_SHOWDOWN } from './testFixtures.js';

describe('analyseLog — advanced analytics', () => {
  const { players } = analyseLog(POSITIONS_HAND);
  const alice = players['Alice']; // SB
  const bob = players['Bob'];     // BB
  const carol = players['Carol']; // BTN (dealer)

  it('assigns positions from seat order + dealer', () => {
    expect(alice.posStats.SB.h).toBe(1);
    expect(bob.posStats.BB.h).toBe(1);
    expect(carol.posStats.BTN.h).toBe(1);
    // No mislabeling onto other positions.
    expect(alice.posStats.BTN.h).toBe(0);
  });

  it('tracks per-position vpip/pfr/wins', () => {
    expect(alice.posStats.SB.v).toBe(1); // called preflop
    expect(alice.posStats.SB.p).toBe(0); // never raised
    expect(alice.posStats.SB.w).toBe(1); // won the hand
    expect(bob.posStats.BB.p).toBe(1);   // raised (3-bet)
    expect(carol.posStats.BTN.p).toBe(1); // opened
  });

  it('credits 3-bet opportunities and actions', () => {
    expect(alice.threeBetOpp).toBe(1); // faced the open, just called
    expect(alice.threeBets).toBe(0);
    expect(bob.threeBetOpp).toBe(1);
    expect(bob.threeBets).toBe(1);     // re-raised the open
    expect(carol.threeBets).toBe(0);   // the opener isn't 3-betting
  });

  it('credits the continuation bet to the preflop aggressor', () => {
    expect(bob.cbetOpp).toBe(1);
    expect(bob.cbets).toBe(1);          // bet first on the flop
    expect(carol.cbetOpp).toBe(0);
  });

  it('tracks the showdown funnel (saw flop / WTSD / W$SD)', () => {
    expect(alice.sawFlopHands).toBe(1);
    expect(bob.sawFlopHands).toBe(1);
    expect(carol.sawFlopHands).toBe(1); // called pre, folded flop — still saw it
    expect(alice.wtsdHands).toBe(1);
    expect(carol.wtsdHands).toBe(0);    // folded before showdown
    expect(alice.wsdHands).toBe(1);     // won at showdown
    expect(bob.wsdHands).toBe(0);       // shown but lost
  });

  it('records head-to-head showdown results', () => {
    expect(alice.vsOpponents['Bob']).toEqual({ w: 1, l: 0 });
    expect(bob.vsOpponents['Alice']).toEqual({ w: 0, l: 1 });
    expect(carol.vsOpponents).toEqual({}); // didn't show
  });

  it('records the big-blind size for bb/100', () => {
    expect(alice.bbCounts).toEqual({ 10: 1 });
  });
});

describe('analyseLog — multiway head-to-head', () => {
  it('records a loss vs every co-shown opponent when a third player scoops', () => {
    const { players } = analyseLog(MULTIWAY_SHOWDOWN);
    const { Alice, Bob, Carol } = players;
    // Carol won, so she beats both.
    expect(Carol.vsOpponents['Alice']).toEqual({ w: 1, l: 0 });
    expect(Carol.vsOpponents['Bob']).toEqual({ w: 1, l: 0 });
    // Alice and Bob both lost the pot — each records a loss vs BOTH opponents
    // (the previous bug skipped the co-loser).
    expect(Alice.vsOpponents['Bob']).toEqual({ w: 0, l: 1 });
    expect(Alice.vsOpponents['Carol']).toEqual({ w: 0, l: 1 });
    expect(Bob.vsOpponents['Alice']).toEqual({ w: 0, l: 1 });
    expect(Bob.vsOpponents['Carol']).toEqual({ w: 0, l: 1 });
  });
});

describe('analyseLog — replayer player meta', () => {
  it('leads each hand log with seats, stacks and positions', () => {
    const { handActionLogs } = analyseLog(POSITIONS_HAND);
    const meta = handActionLogs[1][0];
    expect(meta.type).toBe('players');
    expect(meta.dealer).toBe('Carol');
    const carol = meta.players.find(p => p.name === 'Carol');
    expect(carol).toMatchObject({ seat: 3, stack: 1000, pos: 'BTN' });
    // The meta entry isn't an action, so action consumers skip it.
    expect(meta.action).toBeUndefined();
  });
});

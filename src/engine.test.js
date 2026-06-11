import { describe, it, expect } from 'vitest';
import { analyseLog } from './stats.js';
import { MONEY_SESSION, STAND_UP_SESSION, AF_HAND, BAD_BEAT_HAND, SIDE_POT_HAND, UNCALLED_BET_HAND, LEAD_LOST_HAND, DEAD_BLIND_HAND, VIEWER_MUCK_HAND } from './testFixtures.js';

describe('analyseLog — money / standings', () => {
  const { players } = analyseLog(MONEY_SESSION);
  const { Alice, Bob, Carol } = players;

  it('sums buy-ins, including rebuys', () => {
    expect(Alice.buyIns).toBe(1000);
    expect(Bob.buyIns).toBe(1000);
    expect(Carol.buyIns).toBe(2000); // bought in twice
  });

  it('uses the end-of-final-hand stack for a player still seated at the end', () => {
    // Alice never quit → effectiveCashOut = last stack snapshot (1245) plus
    // her final hand's net (+5: BB 10, SB folds, 5 returned, collects 10).
    expect(Alice.effectiveCashOut).toBe(1250);
    expect(Alice.netChips).toBe(250);
  });

  it('uses the cash-out amount for a player who quit', () => {
    expect(Bob.cashOut).toBe(800);
    expect(Bob.effectiveCashOut).toBe(800);
    expect(Bob.netChips).toBe(-200);
  });

  it('treats a rebuy after busting as still seated (cash-out + final stack)', () => {
    // Carol: quit for 500, rebought for 1000, entered the last hand with 1300
    // and lost her 5 SB in it → 1295 still on the table.
    expect(Carol.effectiveCashOut).toBe(1795); // 500 cashed + 1295 on the table
    expect(Carol.netChips).toBe(-205);          // 1795 out − 2000 in
  });

  it('counts hands dealt only when the player is in the stacks snapshot', () => {
    expect(Alice.handsDealt).toBe(2);
    expect(Bob.handsDealt).toBe(1); // sat out hand #2
    expect(Carol.handsDealt).toBe(2);
  });
});

describe('analyseLog — newer PokerNow log format', () => {
  const { players, handActionLogs } = analyseLog(STAND_UP_SESSION);
  const { Alice, Bob, Cam } = players;

  it('strips "@ tag" from ids containing a hyphen', () => {
    expect(Cam).toBeDefined();
    expect(players['Cam @ -c1']).toBeUndefined();
  });

  it('does not count stand-up/sit-back re-joins as buy-ins', () => {
    expect(Cam.buyIns).toBe(700);   // 500 initial + 200 top-up while standing
    expect(Cam.cashOut).toBe(685);
    expect(Cam.netChips).toBe(-15);
    expect(Alice.netChips).toBe(-10);
    expect(Bob.netChips).toBe(25);
  });

  it('parses the dealer from the inline "(dealer: ...)" hand-start format', () => {
    expect(Cam.posStats.BTN.h).toBe(2);
    expect(Alice.posStats.SB.h).toBe(2);
    expect(Bob.posStats.BB.h).toBe(2);
  });

  it('logs missing/missed blind posts without overwriting the real blinds', () => {
    const meta = handActionLogs[2].find(en => en.type === 'players');
    expect(meta.sb).toBe('Alice');
    expect(meta.bb).toBe('Bob');
    // Missed big blind is live (post-bb); missing small blind is dead money.
    const camPosts = handActionLogs[2].filter(en => en.player === 'Cam' && en.action?.startsWith('post'));
    expect(camPosts.map(en => [en.action, en.amount])).toEqual([['post-dead-sb', 5], ['post-bb', 10]]);
  });
});

describe('analyseLog — aggression factor', () => {
  const { players } = analyseLog(AF_HAND);

  it('computes AF as (bets + raises) / calls across streets', () => {
    expect(players['Aggro'].af).toBe(3);    // 3 bets/raises, 1 call
    expect(players['Callie'].af).toBe(0.5); // 1 raise, 2 calls
  });
});

describe('analyseLog — bad beat / suck-out / cooler detection', () => {
  const { players } = analyseLog(BAD_BEAT_HAND);
  const { Alice, Bob } = players;

  it('records a bad beat for the loser with a strong hand', () => {
    expect(Bob.badBeats).toHaveLength(1);
    expect(Bob.badBeats[0].myHandRank).toBe(3);  // set of kings
    expect(Bob.badBeats[0].oppName).toBe('Alice');
    expect(Bob.badBeats[0].oppHandName).toBe('Flush');
  });

  it('records a suck-out for the winner', () => {
    expect(Alice.suckOuts).toHaveLength(1);
    expect(Alice.suckOuts[0].oppHandRank).toBe(3); // beat a set
    expect(Alice.suckOuts[0].wonAmount).toBe(760);
  });

  it('records a cooler for both players (winner had trips or better)', () => {
    expect(Alice.coolers).toHaveLength(1);
    expect(Bob.coolers).toHaveLength(1);
    expect(Alice.coolers[0].won).toBe(true);
    expect(Bob.coolers[0].won).toBe(false);
  });
});

describe('analyseLog — per-street lead on bad beats', () => {
  it('marks the loser ahead on flop & turn when the winner rivers a flush', () => {
    const { players } = analyseLog(LEAD_LOST_HAND);
    expect(players['Bob'].badBeats[0].aheadOn).toEqual(['flop', 'turn']);
    expect(players['Alice'].suckOuts[0].behindOn).toEqual(['flop', 'turn']);
  });

  it('marks a flopped winner as never overtaken (loser never ahead)', () => {
    // BAD_BEAT_HAND: Alice flops the flush, so set-of-kings Bob is never ahead.
    const { players } = analyseLog(BAD_BEAT_HAND);
    expect(players['Bob'].badBeats[0].aheadOn).toEqual([]);
  });
});

describe('analyseLog — exact per-hand net', () => {
  it('records collects minus contributions for each hand-history entry', () => {
    const { players } = analyseLog(LEAD_LOST_HAND);
    // Alice: 5 (SB) + 5 (complete) + 20 + 50 + 150 in, 460 collected → +230.
    expect(players['Alice'].handsHistory[0].net).toBe(230);
    // Bob: 10 (BB) + 20 + 50 + 150 in, nothing back → −230.
    expect(players['Bob'].handsHistory[0].net).toBe(-230);
  });

  it('credits returned uncalled bets back to the bettor', () => {
    const { players } = analyseLog(UNCALLED_BET_HAND);
    // Alice: 5 + 25 + 60 in, 60 returned + 60 collected → +30.
    expect(players['Alice'].handsHistory[0].net).toBe(30);
    expect(players['Bob'].handsHistory[0].net).toBe(-30);
  });
});

describe('analyseLog — uncalled bet returned', () => {
  const { players, handActionLogs } = analyseLog(UNCALLED_BET_HAND);

  it('records a `return` action so replay pot math balances', () => {
    const log = handActionLogs[1];
    const ret = log.find(a => a.action === 'return');
    expect(ret).toMatchObject({ player: 'Alice', amount: 60, street: 'flop' });
    // Chips actually contested: blinds + the called 30s = 60. Returned 60 must
    // not inflate the pot the winner collected.
    expect(players['Alice'].handsHistory[0].potSize).toBe(60);
  });
});

describe('analyseLog — dead missing small blind', () => {
  const { players, handActionLogs } = analyseLog(DEAD_BLIND_HAND);

  it('keeps the dead blind out of the call price (full call still owed)', () => {
    // Cam: 5 dead + 10 live bb + 20 to call the raise to 30 = 35 in.
    expect(players['Cam'].handsHistory[0].net).toBe(-35);
    expect(players['Alice'].handsHistory[0].net).toBe(45);
    expect(players['Bob'].handsHistory[0].net).toBe(-10);
  });

  it('hand nets are zero-sum', () => {
    const sum = Object.values(players).reduce((s, p) => s + p.handsHistory[0].net, 0);
    expect(sum).toBe(0);
  });

  it('logs the dead post as post-dead-sb', () => {
    const dead = handActionLogs[1].find(en => en.action === 'post-dead-sb');
    expect(dead).toMatchObject({ player: 'Cam', amount: 5, street: 'preflop' });
  });
});

describe('analyseLog — viewer mucked showdown', () => {
  const { players } = analyseLog(VIEWER_MUCK_HAND, 'Will');
  const will = players['Will'];

  it('detects a bad beat / cooler from the viewer\'s dealt cards', () => {
    expect(will.badBeats).toHaveLength(1);
    expect(will.badBeats[0].myHandName).toBe('Flush');
    expect(will.badBeats[0].oppHandName).toBe('Four of a Kind');
    expect(will.coolers).toHaveLength(1);
    expect(will.coolers[0].won).toBe(false);
  });

  it('records the actual chips lost (net), not the pot, on key-hand entries', () => {
    expect(will.badBeats[0].net).toBe(-140);
    expect(will.coolers[0].net).toBe(-140);
    const bob = players['Bob'];
    expect(bob.suckOuts[0].net).toBe(140);
    expect(bob.coolers[0]).toMatchObject({ net: 140, wonAmount: 280 });
  });

  it('fills hand names in the history entry even though the viewer mucked', () => {
    const h = will.handsHistory[0];
    expect(h.wasShown).toBe(false);
    expect(h.myHandName).toBe('Flush');
    expect(h.winnerHandName).toBe('Four of a Kind');
    expect(h.isBadBeat).toBe(true);
    expect(h.net).toBe(-140);
  });
});

describe('analyseLog — side pots are not splits', () => {
  const { players } = analyseLog(SIDE_POT_HAND);
  const alice = players['Alice'];
  const h = alice.handsHistory.find(x => x.num === 1);

  it('counts a single win and sums take-home across main + side pots', () => {
    expect(alice.handsWon).toBe(1);   // one win, not two
    expect(alice.handsSplit).toBe(0); // a single distinct winner → not a split
    expect(h.isSplit).toBe(false);
    expect(h.wonAmount).toBe(450);    // 300 + 150
    expect(h.potSize).toBe(450);
  });
});

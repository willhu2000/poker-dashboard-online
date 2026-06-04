import { describe, it, expect } from 'vitest';
import { analyseLog } from './stats.js';
import { MONEY_SESSION, AF_HAND, BAD_BEAT_HAND, SIDE_POT_HAND } from './testFixtures.js';

describe('analyseLog — money / standings', () => {
  const { players } = analyseLog(MONEY_SESSION);
  const { Alice, Bob, Carol } = players;

  it('sums buy-ins, including rebuys', () => {
    expect(Alice.buyIns).toBe(1000);
    expect(Bob.buyIns).toBe(1000);
    expect(Carol.buyIns).toBe(2000); // bought in twice
  });

  it('uses the last seen stack for a player still seated at the end', () => {
    // Alice never quit → effectiveCashOut = last stack snapshot (1245).
    expect(Alice.effectiveCashOut).toBe(1245);
    expect(Alice.netChips).toBe(245);
  });

  it('uses the cash-out amount for a player who quit', () => {
    expect(Bob.cashOut).toBe(800);
    expect(Bob.effectiveCashOut).toBe(800);
    expect(Bob.netChips).toBe(-200);
  });

  it('treats a rebuy after busting as still seated (cash-out + final stack)', () => {
    // Carol: quit for 500, rebought, ended with 1300 on the table.
    expect(Carol.effectiveCashOut).toBe(1800); // 500 cashed + 1300 still on table
    expect(Carol.netChips).toBe(-200);          // 1800 out − 2000 in
  });

  it('counts hands dealt only when the player is in the stacks snapshot', () => {
    expect(Alice.handsDealt).toBe(2);
    expect(Bob.handsDealt).toBe(1); // sat out hand #2
    expect(Carol.handsDealt).toBe(2);
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

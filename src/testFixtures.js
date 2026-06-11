// Shared synthetic-log builders for tests. Rows mimic parsed PokerNow output
// ({ entry, order, at }) in chronological order so analyseLog can run on them.
import { generateSession } from './fixtureGen.js';

export function makeRows(entries) {
  return entries.map((entry, i) => ({
    entry,
    order: i + 1,
    at: '2026-02-11T20:00:00.000Z',
  }));
}

// Full 20-hand generated sessions (deterministic) — used by the fixture
// dashboard to preview richer, realistic data. Not used by unit assertions.
export const GEN_6MAX = generateSession({ players: ['Will', 'Maya', 'Dan', 'Priya', 'Theo', 'Liam'], seed: 7, hands: 20 });
export const GEN_4MAX = generateSession({ players: ['Will', 'Ben', 'Ana', 'Cyrus'], seed: 3, hands: 20 });
export const GEN_HEADSUP = generateSession({ players: ['Will', 'Rival'], seed: 11, hands: 20 });
export const GEN_100HAND = generateSession({ players: ['Will', 'Maya', 'Dan', 'Priya', 'Theo', 'Liam'], seed: 42, hands: 100, startStack: 1000, rebuys: true });

// Hand #1: Alice and Bob split a 20 pot. Hand #2: Alice wins 50 solo.
export const SPLIT_AND_SOLO = makeRows([
  'The player "Alice @ a" joined the game with a stack of 1000',
  'The player "Bob @ b" joined the game with a stack of 1000',
  '-- starting hand #1 (id: h1)',
  'Player stacks: #1 "Alice @ a" (1000) | #2 "Bob @ b" (1000)',
  '"Alice @ a" posts a small blind of 5',
  '"Bob @ b" posts a big blind of 10',
  '"Alice @ a" calls 10',
  '"Bob @ b" checks',
  'Flop:  [A♠, K♥, 2♦]',
  '"Alice @ a" checks',
  '"Bob @ b" checks',
  'Turn:  [A♠, K♥, 2♦, 7♣]',
  '"Alice @ a" checks',
  '"Bob @ b" checks',
  'River:  [A♠, K♥, 2♦, 7♣, 3♥]',
  '"Alice @ a" checks',
  '"Bob @ b" checks',
  '"Alice @ a" shows a A♣, A♦.',
  '"Bob @ b" shows a A♥, A♠.',
  '"Alice @ a" collected 10 from pot',
  '"Bob @ b" collected 10 from pot',
  '-- ending hand #1 --',
  '-- starting hand #2 (id: h2)',
  'Player stacks: #1 "Alice @ a" (1000) | #2 "Bob @ b" (1000)',
  '"Alice @ a" posts a small blind of 5',
  '"Bob @ b" posts a big blind of 10',
  '"Alice @ a" raises to 30',
  '"Bob @ b" folds',
  '"Alice @ a" collected 50 from pot',
  '-- ending hand #2 --',
  'The player "Alice @ a" quits the game with a stack of 1060',
  'The player "Bob @ b" quits the game with a stack of 940',
]);

// One 3-handed hand that exercises positions, 3-bet, c-bet, showdown funnel and
// head-to-head. Seats: Alice #1, Bob #2, Carol #3; Carol is the dealer, so
// Alice = SB, Bob = BB, Carol = BTN.
export const POSITIONS_HAND = makeRows([
  'The player "Alice @ a" joined the game with a stack of 1000',
  'The player "Bob @ b" joined the game with a stack of 1000',
  'The player "Carol @ c" joined the game with a stack of 1000',
  '-- starting hand #1 (id: p1)',
  'Player stacks: #1 "Alice @ a" (1000) | #2 "Bob @ b" (1000) | #3 "Carol @ c" (1000)',
  '"Carol @ c" is the dealer',
  '"Alice @ a" posts a small blind of 5',
  '"Bob @ b" posts a big blind of 10',
  '"Carol @ c" raises to 30',        // open (Carol = BTN aggressor so far)
  '"Alice @ a" calls 30',            // faces 1 raise → 3-bet opp, no 3-bet
  '"Bob @ b" raises to 90',          // faces 1 raise → 3-bet!
  '"Carol @ c" calls 90',
  '"Alice @ a" calls 90',
  'Flop:  [A♠, K♥, 2♦]',
  '"Alice @ a" checks',
  '"Bob @ b" bets 100',              // Bob is preflop aggressor → c-bet
  '"Carol @ c" folds',
  '"Alice @ a" calls 100',
  'Turn:  [A♠, K♥, 2♦, 7♣]',
  '"Alice @ a" checks',
  '"Bob @ b" checks',
  'River:  [A♠, K♥, 2♦, 7♣, 3♥]',
  '"Alice @ a" checks',
  '"Bob @ b" checks',
  '"Alice @ a" shows a A♣, A♦.',     // trip aces — wins
  '"Bob @ b" shows a K♠, K♦.',       // trip kings — loses
  '"Alice @ a" collected 380 from pot',
  '-- ending hand #1 --',
  'The player "Alice @ a" quits the game with a stack of 1200',
  'The player "Bob @ b" quits the game with a stack of 850',
  'The player "Carol @ c" quits the game with a stack of 950',
]);

// A 3-way showdown where Carol scoops and Alice + Bob both lose — exercises the
// multiway head-to-head fix (co-losers must each record a loss vs everyone).
export const MULTIWAY_SHOWDOWN = makeRows([
  'The player "Alice @ a" joined the game with a stack of 1000',
  'The player "Bob @ b" joined the game with a stack of 1000',
  'The player "Carol @ c" joined the game with a stack of 1000',
  '-- starting hand #1 (id: m1)',
  'Player stacks: #1 "Alice @ a" (1000) | #2 "Bob @ b" (1000) | #3 "Carol @ c" (1000)',
  '"Carol @ c" is the dealer',
  '"Alice @ a" posts a small blind of 5',
  '"Bob @ b" posts a big blind of 10',
  '"Carol @ c" calls 10',
  '"Alice @ a" calls 10',
  '"Bob @ b" checks',
  'Flop:  [A♠, K♥, 9♦]',
  '"Alice @ a" checks',
  '"Bob @ b" checks',
  '"Carol @ c" checks',
  'Turn:  [A♠, K♥, 9♦, 2♣]',
  '"Alice @ a" checks',
  '"Bob @ b" checks',
  '"Carol @ c" checks',
  'River:  [A♠, K♥, 9♦, 2♣, 3♥]',
  '"Alice @ a" checks',
  '"Bob @ b" checks',
  '"Carol @ c" checks',
  '"Alice @ a" shows a A♣, 7♦.',   // pair of aces
  '"Bob @ b" shows a K♠, Q♦.',     // pair of kings
  '"Carol @ c" shows a A♥, K♦.',   // two pair — wins
  '"Carol @ c" collected 30 from pot',
  '-- ending hand #1 --',
  'The player "Alice @ a" quits the game with a stack of 990',
  'The player "Bob @ b" quits the game with a stack of 990',
  'The player "Carol @ c" quits the game with a stack of 1020',
]);

// Newer PokerNow export format: dealer inline in the hand-start line (no
// separate `is the dealer` row), player ids containing "-", stand up /
// sit back / re-join sequences, and missing/missed blind posts.
// Cam stands up at 485 and re-joins (no new buy-in), then re-joins after a
// 200-chip top-up while away (only the 200 counts as a buy-in).
export const STAND_UP_SESSION = makeRows([
  'The player "Alice @ a" joined the game with a stack of 500.',
  'The player "Bob @ b" joined the game with a stack of 500.',
  'The player "Cam @ -c1" joined the game with a stack of 500.',
  `-- starting hand #1 (id: z1)  No Limit Texas Hold'em (dealer: "Cam @ -c1") --`,
  'Player stacks: #1 "Alice @ a" (500) | #2 "Bob @ b" (500) | #3 "Cam @ -c1" (500)',
  '"Alice @ a" posts a small blind of 5',
  '"Bob @ b" posts a big blind of 10',
  '"Cam @ -c1" folds',
  '"Alice @ a" folds',
  '"Bob @ b" collected 15 from pot',
  '-- ending hand #1 --',
  `-- starting hand #2 (id: z2)  No Limit Texas Hold'em (dealer: "Cam @ -c1") --`,
  'Player stacks: #1 "Alice @ a" (495) | #2 "Bob @ b" (505) | #3 "Cam @ -c1" (500)',
  '"Alice @ a" posts a small blind of 5',
  '"Bob @ b" posts a big blind of 10',
  '"Cam @ -c1" posts a missing small blind of 5',
  '"Cam @ -c1" posts a missed big blind of 10',
  '"Alice @ a" folds',
  '"Cam @ -c1" checks',
  '"Bob @ b" checks',
  'Flop:  [2♠, 7♥, 9♦]',
  '"Cam @ -c1" checks',
  '"Bob @ b" bets 10',
  '"Cam @ -c1" folds',
  'Uncalled bet of 10 returned to "Bob @ b"',
  '"Bob @ b" collected 30 from pot',
  '-- ending hand #2 --',
  'The player "Cam @ -c1" stand up with the stack of 485.',
  'The player "Cam @ -c1" sit back with the stack of 485.',
  'The player "Cam @ -c1" joined the game with a stack of 485.',
  'The player "Cam @ -c1" stand up with the stack of 485.',
  'The player "Cam @ -c1" sit back with the stack of 685.',
  'The player "Cam @ -c1" joined the game with a stack of 685.',
  'The player "Cam @ -c1" quits the game with a stack of 685.',
  'The player "Alice @ a" quits the game with a stack of 490.',
  'The player "Bob @ b" quits the game with a stack of 525.',
]);

// Money/standings: Alice stays to the end (still-seated → use last stack), Bob
// cashes out down, Carol rebuys after busting (buy-ins sum; rebuy is after the
// quit so she counts as still-seated).
export const MONEY_SESSION = makeRows([
  'The player "Alice @ a" joined the game with a stack of 1000',
  'The player "Bob @ b" joined the game with a stack of 1000',
  'The player "Carol @ c" joined the game with a stack of 1000',
  '-- starting hand #1 (id: g1)',
  'Player stacks: #1 "Alice @ a" (1200) | #2 "Bob @ b" (800) | #3 "Carol @ c" (500)',
  '"Carol @ c" is the dealer',
  '"Bob @ b" posts a small blind of 5',
  '"Carol @ c" posts a big blind of 10',
  '"Alice @ a" raises to 30',
  '"Bob @ b" folds',
  '"Carol @ c" folds',
  '"Alice @ a" collected 45 from pot',
  '-- ending hand #1 --',
  'The player "Carol @ c" quits the game with a stack of 500',
  'The player "Bob @ b" quits the game with a stack of 800',
  'The player "Carol @ c" joined the game with a stack of 1000',
  '-- starting hand #2 (id: g2)',
  'Player stacks: #1 "Alice @ a" (1245) | #3 "Carol @ c" (1300)',
  '"Alice @ a" is the dealer',
  '"Carol @ c" posts a small blind of 5',
  '"Alice @ a" posts a big blind of 10',
  '"Carol @ c" folds',
  'Uncalled bet of 5 returned to "Alice @ a"',
  '"Alice @ a" collected 10 from pot',
  '-- ending hand #2 --',
]);

// Aggression factor: Aggro raises/bets thrice and calls once (AF 3); Callie
// raises once and calls twice (AF 0.5). Counts span preflop + postflop.
export const AF_HAND = makeRows([
  'The player "Aggro @ x" joined the game with a stack of 1000',
  'The player "Callie @ y" joined the game with a stack of 1000',
  '-- starting hand #1 (id: af1)',
  'Player stacks: #1 "Aggro @ x" (1000) | #2 "Callie @ y" (1000)',
  '"Callie @ y" is the dealer',
  '"Aggro @ x" posts a small blind of 5',
  '"Callie @ y" posts a big blind of 10',
  '"Aggro @ x" raises to 30',       // Aggro bet/raise #1
  '"Callie @ y" calls 30',          // Callie call #1
  'Flop:  [2♠, 7♥, 9♦]',
  '"Aggro @ x" bets 40',            // Aggro #2
  '"Callie @ y" calls 40',          // Callie call #2
  'Turn:  [2♠, 7♥, 9♦, K♣]',
  '"Aggro @ x" bets 80',            // Aggro #3
  '"Callie @ y" raises to 200',     // Callie raise #1
  '"Aggro @ x" calls 200',          // Aggro call #1
  'River:  [2♠, 7♥, 9♦, K♣, 3♥]',
  '"Aggro @ x" checks',
  '"Callie @ y" checks',
  '"Aggro @ x" collected 460 from pot',
  '-- ending hand #1 --',
  'The player "Aggro @ x" quits the game with a stack of 1200',
  'The player "Callie @ y" quits the game with a stack of 800',
]);

// Bad beat / suck-out / cooler: Bob flops a set of kings and loses to Alice's
// flush by the river. Loser gets a badBeat, winner a suckOut, both a cooler.
export const BAD_BEAT_HAND = makeRows([
  'The player "Alice @ a" joined the game with a stack of 1000',
  'The player "Bob @ b" joined the game with a stack of 1000',
  '-- starting hand #1 (id: bb1)',
  'Player stacks: #1 "Alice @ a" (1000) | #2 "Bob @ b" (1000)',
  '"Bob @ b" is the dealer',
  '"Alice @ a" posts a small blind of 5',
  '"Bob @ b" posts a big blind of 10',
  '"Alice @ a" raises to 30',
  '"Bob @ b" calls 30',
  'Flop:  [A♠, K♠, 7♠]',
  '"Alice @ a" bets 50',
  '"Bob @ b" calls 50',
  'Turn:  [A♠, K♠, 7♠, 3♦]',
  '"Alice @ a" bets 100',
  '"Bob @ b" calls 100',
  'River:  [A♠, K♠, 7♠, 3♦, 2♣]',
  '"Alice @ a" bets 200',
  '"Bob @ b" calls 200',
  '"Alice @ a" shows a Q♠, J♠.',   // spade flush
  '"Bob @ b" shows a K♥, K♦.',     // set of kings
  '"Alice @ a" collected 760 from pot',
  '-- ending hand #1 --',
  'The player "Alice @ a" quits the game with a stack of 1380',
  'The player "Bob @ b" quits the game with a stack of 620',
]);

// Fold-out: Bob folds to Alice's flop bet, so PokerNow returns the uncalled
// bet before the collect. The action log must carry a `return` entry so the
// replayer's pot/stack math balances.
export const UNCALLED_BET_HAND = makeRows([
  'The player "Alice @ a" joined the game with a stack of 1000',
  'The player "Bob @ b" joined the game with a stack of 1000',
  '-- starting hand #1 (id: ub1)',
  'Player stacks: #1 "Alice @ a" (1000) | #2 "Bob @ b" (1000)',
  '"Bob @ b" is the dealer',
  '"Alice @ a" posts a small blind of 5',
  '"Bob @ b" posts a big blind of 10',
  '"Alice @ a" raises to 30',
  '"Bob @ b" calls 30',
  'Flop:  [A♠, K♥, 2♦]',
  '"Alice @ a" bets 60',
  '"Bob @ b" folds',
  'Uncalled bet of 60 returned to "Alice @ a"',
  '"Alice @ a" collected 60 from pot',
  '-- ending hand #1 --',
  'The player "Alice @ a" quits the game with a stack of 1030',
  'The player "Bob @ b" quits the game with a stack of 970',
]);

// Lead-lost bad beat: Bob flops a set of kings and is ahead on the flop and
// turn; Alice's runner-runner club flush arrives on the river. Exercises the
// per-street `aheadOn`/`behindOn` lead analysis.
export const LEAD_LOST_HAND = makeRows([
  'The player "Alice @ a" joined the game with a stack of 1000',
  'The player "Bob @ b" joined the game with a stack of 1000',
  '-- starting hand #1 (id: ll1)',
  'Player stacks: #1 "Alice @ a" (1000) | #2 "Bob @ b" (1000)',
  '"Bob @ b" is the dealer',
  '"Alice @ a" posts a small blind of 5',
  '"Bob @ b" posts a big blind of 10',
  '"Alice @ a" calls 10',
  '"Bob @ b" checks',
  'Flop:  [K♥, 7♣, 2♣]',
  '"Alice @ a" checks',
  '"Bob @ b" bets 20',
  '"Alice @ a" calls 20',
  'Turn:  [K♥, 7♣, 2♣, 8♦]',
  '"Alice @ a" checks',
  '"Bob @ b" bets 50',
  '"Alice @ a" calls 50',
  'River:  [K♥, 7♣, 2♣, 8♦, 4♣]',
  '"Alice @ a" bets 150',
  '"Bob @ b" calls 150',
  '"Alice @ a" shows a J♣, 9♣.',   // club flush (river)
  '"Bob @ b" shows a K♠, K♦.',     // set of kings
  '"Alice @ a" collected 460 from pot',
  '-- ending hand #1 --',
  'The player "Alice @ a" quits the game with a stack of 1230',
  'The player "Bob @ b" quits the game with a stack of 770',
]);

// Side pots: Alice (short stack) collects a main pot AND a side pot. Two
// `collected` lines for the same player is NOT a split — take-home sums them.
export const SIDE_POT_HAND = makeRows([
  'The player "Alice @ a" joined the game with a stack of 100',
  'The player "Bob @ b" joined the game with a stack of 1000',
  'The player "Carol @ c" joined the game with a stack of 1000',
  '-- starting hand #1 (id: sp1)',
  'Player stacks: #1 "Alice @ a" (100) | #2 "Bob @ b" (1000) | #3 "Carol @ c" (1000)',
  '"Carol @ c" is the dealer',
  '"Alice @ a" posts a small blind of 5',
  '"Bob @ b" posts a big blind of 10',
  '"Carol @ c" raises to 60',
  '"Alice @ a" calls 100',
  '"Bob @ b" calls 60',
  'Flop:  [A♣, 5♦, 9♠]',
  '"Bob @ b" checks',
  '"Carol @ c" checks',
  'Turn:  [A♣, 5♦, 9♠, 2♥]',
  '"Bob @ b" checks',
  '"Carol @ c" checks',
  'River:  [A♣, 5♦, 9♠, 2♥, K♦]',
  '"Bob @ b" checks',
  '"Carol @ c" checks',
  '"Alice @ a" shows a A♠, A♥.',
  '"Bob @ b" shows a K♠, Q♦.',
  '"Carol @ c" shows a 9♥, 9♦.',
  '"Alice @ a" collected 300 from pot',  // main pot
  '"Alice @ a" collected 150 from pot',  // side pot
  '-- ending hand #1 --',
  'The player "Alice @ a" quits the game with a stack of 450',
  'The player "Bob @ b" quits the game with a stack of 825',
  'The player "Carol @ c" quits the game with a stack of 825',
]);

// Dead blind chip math: Cam returns from sitting out and posts a live missed
// big blind (10) plus a DEAD missing small blind (5). The dead 5 goes in the
// pot but does not count toward calling — facing Alice's raise to 30, Cam owes
// 20 on top of his live 10. Cam total in: 5 + 10 + 20 = 35.
export const DEAD_BLIND_HAND = makeRows([
  'The player "Alice @ a" joined the game with a stack of 1000',
  'The player "Bob @ b" joined the game with a stack of 1000',
  'The player "Cam @ c" joined the game with a stack of 1000',
  '-- starting hand #1 (id: db1)',
  'Player stacks: #1 "Alice @ a" (1000) | #2 "Bob @ b" (1000) | #3 "Cam @ c" (1000)',
  '"Cam @ c" is the dealer',
  '"Alice @ a" posts a small blind of 5',
  '"Bob @ b" posts a big blind of 10',
  '"Cam @ c" posts a missing small blind of 5',
  '"Cam @ c" posts a missed big blind of 10',
  '"Alice @ a" raises to 30',
  '"Bob @ b" folds',
  '"Cam @ c" calls 30',
  'Flop:  [2♠, 7♥, 9♦]',
  '"Alice @ a" bets 40',
  '"Cam @ c" folds',
  'Uncalled bet of 40 returned to "Alice @ a"',
  '"Alice @ a" collected 75 from pot',
  '-- ending hand #1 --',
  'The player "Alice @ a" quits the game with a stack of 1045',
  'The player "Bob @ b" quits the game with a stack of 990',
  'The player "Cam @ c" quits the game with a stack of 965',
]);

// Viewer mucked showdown: Will (the viewer) calls down with a king-high flush
// and mucks when Bob shows quads — PokerNow only logs the winner's "shows"
// line, but the viewer's cards are known from "Your hand is". The loss must
// still register as a bad beat / cooler for Will.
export const VIEWER_MUCK_HAND = makeRows([
  'The player "Will @ w" joined the game with a stack of 1000',
  'The player "Bob @ b" joined the game with a stack of 1000',
  '-- starting hand #1 (id: vm1)',
  'Player stacks: #1 "Will @ w" (1000) | #2 "Bob @ b" (1000)',
  '"Bob @ b" is the dealer',
  '"Will @ w" posts a small blind of 5',
  '"Bob @ b" posts a big blind of 10',
  'Your hand is K♥, 9♥',
  '"Will @ w" calls 10',
  '"Bob @ b" checks',
  'Flop:  [4♥, 4♦, 4♠]',
  '"Will @ w" checks',
  '"Bob @ b" bets 10',
  '"Will @ w" calls 10',
  'Turn:  [4♥, 4♦, 4♠, J♥]',
  '"Will @ w" checks',
  '"Bob @ b" bets 20',
  '"Will @ w" calls 20',
  'River:  [4♥, 4♦, 4♠, J♥, 8♥]',
  '"Will @ w" checks',
  '"Bob @ b" bets 100',
  '"Will @ w" calls 100',
  '"Bob @ b" shows a 4♣, A♦.',
  '"Bob @ b" collected 280 from pot',
  '-- ending hand #1 --',
  'The player "Will @ w" quits the game with a stack of 860',
  'The player "Bob @ b" quits the game with a stack of 1140',
]);

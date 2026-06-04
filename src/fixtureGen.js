import { bestHand } from './handEval.js';

// Deterministic generator that produces a realistic multi-hand PokerNow-style
// log (as an array of rows, like the hand-written fixtures). Used to give the
// fixture dashboard fuller, more representative sessions to inspect. Seeded, so
// output is stable across runs. Chips are conserved (net is zero-sum).

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_CODE = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledDeck(rand) {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const parseCard = (str) => ({ rank: str.slice(0, -1), suit: SUIT_CODE[str.slice(-1)] });
const roundToBb = (x, bb) => Math.max(bb, Math.round(x / bb) * bb);

export function generateSession({
  players,
  seed = 1,
  hands = 20,
  sb = 5,
  bb = 10,
  startStack = 1500,
  idPrefix = 'gen',
} = {}) {
  const rand = mulberry32(seed);
  const n = players.length;
  const tag = (i) => `${players[i].slice(0, 2)}${i}${seed}`;
  const pname = (i) => `${players[i]} @ ${tag(i)}`;
  const stacks = players.map(() => startStack);
  const rows = [];
  const push = (line) => rows.push(line);

  for (let i = 0; i < n; i++) push(`The player "${pname(i)}" joined the game with a stack of ${startStack}`);

  for (let h = 1; h <= hands; h++) {
    const dealer = (h - 1) % n;
    const sbPos = n === 2 ? dealer : (dealer + 1) % n;
    const bbPos = n === 2 ? (dealer + 1) % n : (dealer + 2) % n;

    push(`-- starting hand #${h} (id: ${idPrefix}_${h})`);
    push('Player stacks: ' + players.map((_, i) => `#${i + 1} "${pname(i)}" (${stacks[i]})`).join(' | '));
    push(`"${pname(dealer)}" is the dealer`);

    const folded = players.map(() => false);
    const total = players.map(() => 0);   // total committed this hand
    let pot = 0;
    const putIn = (i, target) => {        // raise this player's committed-this-street to `target`
      const want = target - sc[i];
      const d = Math.min(Math.max(0, want), stacks[i]);
      stacks[i] -= d; total[i] += d; sc[i] += d; pot += d;
    };
    let sc = players.map(() => 0);        // committed this street

    putIn(sbPos, sb); push(`"${pname(sbPos)}" posts a small blind of ${sb}`);
    putIn(bbPos, bb); push(`"${pname(bbPos)}" posts a big blind of ${bb}`);

    const deck = shuffledDeck(rand);
    const hole = players.map((_, i) => [deck[i * 2], deck[i * 2 + 1]]);
    const board = deck.slice(n * 2, n * 2 + 5);

    // One betting round. `firstToAct` is a seat index; emits actions and keeps
    // chips consistent (every non-folded player ends matched or folded).
    const runBetting = (firstToAct, street) => {
      let betLevel = Math.max(0, ...sc);
      let raises = 0;
      const need = new Set();
      for (let i = 0; i < n; i++) if (!folded[i] && stacks[i] > 0) need.add(i);
      if (need.size < 2) return;
      let pos = firstToAct;
      let guard = 0;
      while (need.size > 0 && guard++ < 200) {
        if (!need.has(pos)) { pos = (pos + 1) % n; continue; }
        const toCall = betLevel - sc[pos];
        const r = rand();
        if (toCall === 0) {
          // Option to check or open a bet.
          if (raises < 2 && stacks[pos] > bb && r < 0.32) {
            const size = roundToBb((pot || bb) * (0.5 + rand() * 0.4), bb);
            putIn(pos, sc[pos] + size); betLevel = sc[pos]; raises++;
            push(`"${pname(pos)}" bets ${size}`);
            need.clear(); for (let i = 0; i < n; i++) if (i !== pos && !folded[i] && stacks[i] > 0) need.add(i);
          } else {
            push(`"${pname(pos)}" checks`); need.delete(pos);
          }
        } else if (r < 0.34 && !(street === 'preflop' && pos === bbPos && betLevel === bb)) {
          folded[pos] = true; need.delete(pos); push(`"${pname(pos)}" folds`);
        } else if (raises < 2 && stacks[pos] > toCall + bb && r > 0.82) {
          const target = street === 'preflop' && betLevel === bb ? 3 * bb : roundToBb(betLevel * 2.4, bb);
          putIn(pos, target); betLevel = sc[pos]; raises++;
          push(`"${pname(pos)}" raises to ${betLevel}`);
          need.clear(); for (let i = 0; i < n; i++) if (i !== pos && !folded[i] && stacks[i] > 0) need.add(i);
        } else {
          putIn(pos, betLevel); push(`"${pname(pos)}" calls ${betLevel}`); need.delete(pos);
        }
        pos = (pos + 1) % n;
      }
    };

    const activeCount = () => folded.filter(f => !f).length;
    const firstAfter = (seat) => (seat + 1) % n;

    runBetting(n === 2 ? sbPos : firstAfter(bbPos), 'preflop');

    const streets = [
      { name: 'Flop', cards: board.slice(0, 3) },
      { name: 'Turn', cards: board.slice(0, 4) },
      { name: 'River', cards: board.slice(0, 5) },
    ];
    let dealt = 0;
    for (const st of streets) {
      if (activeCount() < 2) break;
      sc = players.map(() => 0);
      push(`${st.name}:  [${st.cards.join(', ')}]`);
      dealt = st.cards.length;
      runBetting(firstAfter(dealer), st.name.toLowerCase());
    }

    // Resolve the pot.
    const live = players.map((_, i) => i).filter(i => !folded[i]);
    let winner;
    if (live.length === 1) {
      winner = live[0];
    } else {
      // Showdown: everyone live reveals; best hand wins (ties → first seat).
      let best = null;
      for (const i of live) {
        push(`"${pname(i)}" shows a ${hole[i][0]}, ${hole[i][1]}.`);
        const ev = bestHand(hole[i].map(parseCard), board.slice(0, Math.max(3, dealt)).map(parseCard));
        if (!best || (ev && ev.rank > best.rank)) { best = ev; winner = i; }
      }
    }
    stacks[winner] += pot;
    push(`"${pname(winner)}" collected ${pot} from pot`);
    push(`-- ending hand #${h} --`);
  }

  for (let i = 0; i < n; i++) push(`The player "${pname(i)}" quits the game with a stack of ${stacks[i]}`);

  // Wrap as parsed rows ({ entry, order, at }), the same shape makeRows produces,
  // so analyseLog can consume it directly. A per-seed date gives each generated
  // session a distinct game date.
  const at = new Date(2026, 0, 1 + (seed % 90)).toISOString();
  return rows.map((entry, i) => ({ entry, order: i + 1, at }));
}

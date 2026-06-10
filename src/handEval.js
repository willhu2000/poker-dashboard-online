const RANK_VAL = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };

function evalFive(cards) {
  const rv = cards.map(c => RANK_VAL[c.rank] || 0);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0] && s !== '?');

  const sorted = [...rv].sort((a, b) => a - b);
  const uniq = [...new Set(sorted)];
  let isStraight = uniq.length === 5 && (uniq[4] - uniq[0] === 4);
  let straightHigh = isStraight ? uniq[4] : 0;
  // Wheel: A-2-3-4-5 — plays as a 5-high straight.
  if (!isStraight && uniq.includes(14) && uniq.includes(2) && uniq.includes(3) && uniq.includes(4) && uniq.includes(5)) {
    isStraight = true;
    straightHigh = 5;
  }

  const cnt = {};
  for (const r of rv) cnt[r] = (cnt[r] || 0) + 1;
  // Ranks ordered by (count desc, rank desc) — exactly the kicker order poker
  // compares in: e.g. a full house compares trips rank then pair rank.
  const groups = Object.entries(cnt)
    .map(([r, c]) => ({ r: +r, c }))
    .sort((a, b) => b.c - a.c || b.r - a.r);
  const freqs = groups.map(g => g.c);
  const byGroup = groups.map(g => g.r);
  const desc = [...rv].sort((a, b) => b - a);

  let rank, name, tb;
  if (isFlush && isStraight) {
    const isRoyal = straightHigh === 14;
    rank = isRoyal ? 9 : 8;
    name = isRoyal ? 'Royal Flush' : 'Straight Flush';
    tb = [straightHigh];
  } else if (freqs[0] === 4)                    { rank = 7; name = 'Four of a Kind';  tb = byGroup; }
  else if (freqs[0] === 3 && freqs[1] === 2)    { rank = 6; name = 'Full House';      tb = byGroup; }
  else if (isFlush)                             { rank = 5; name = 'Flush';           tb = desc; }
  else if (isStraight)                          { rank = 4; name = 'Straight';        tb = [straightHigh]; }
  else if (freqs[0] === 3)                      { rank = 3; name = 'Three of a Kind'; tb = byGroup; }
  else if (freqs[0] === 2 && freqs[1] === 2)    { rank = 2; name = 'Two Pair';        tb = byGroup; }
  else if (freqs[0] === 2)                      { rank = 1; name = 'Pair';            tb = byGroup; }
  else                                          { rank = 0; name = 'High Card';       tb = desc; }

  // Pack rank + up to 5 tiebreak digits (each 0–14) into one comparable number,
  // so `a.score > b.score` ⇔ hand a beats hand b (kickers included).
  let score = rank;
  for (let i = 0; i < 5; i++) score = score * 15 + (tb[i] ?? 0);
  return { rank, name, score };
}

function pickCombos(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [h, ...t] = arr;
  return [
    ...pickCombos(t, k - 1).map(c => [h, ...c]),
    ...pickCombos(t, k),
  ];
}

// Returns the best 5-card hand from holeCards + board (needs ≥5 total valid cards).
// Returns { rank: 0–9, name: string, score: number } or null if not enough cards.
// `score` is kicker-aware: comparing scores compares full poker hand strength.
export function bestHand(holeCards, board) {
  const all = [...(holeCards || []), ...(board || [])].filter(c => c && c.rank && c.suit !== '?');
  if (all.length < 5) return null;
  let best = null;
  for (const combo of pickCombos(all, 5)) {
    const r = evalFive(combo);
    if (!best || r.score > best.score) best = r;
  }
  return best;
}

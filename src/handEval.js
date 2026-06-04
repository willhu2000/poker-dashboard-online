const RANK_VAL = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };

function evalFive(cards) {
  const rv = cards.map(c => RANK_VAL[c.rank] || 0);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0] && s !== '?');

  const sorted = [...rv].sort((a, b) => a - b);
  const uniq = [...new Set(sorted)];
  let isStraight = uniq.length === 5 && (uniq[4] - uniq[0] === 4);
  // Wheel: A-2-3-4-5
  if (!isStraight && uniq.includes(14) && uniq.includes(2) && uniq.includes(3) && uniq.includes(4) && uniq.includes(5)) {
    isStraight = true;
  }

  const cnt = {};
  for (const r of rv) cnt[r] = (cnt[r] || 0) + 1;
  const freqs = Object.values(cnt).sort((a, b) => b - a);

  if (isFlush && isStraight) {
    const isRoyal = uniq.length === 5 && uniq[4] - uniq[0] === 4 && uniq[4] === 14;
    return isRoyal ? { rank: 9, name: 'Royal Flush' } : { rank: 8, name: 'Straight Flush' };
  }
  if (freqs[0] === 4)              return { rank: 7, name: 'Four of a Kind' };
  if (freqs[0] === 3 && freqs[1] === 2) return { rank: 6, name: 'Full House' };
  if (isFlush)                     return { rank: 5, name: 'Flush' };
  if (isStraight)                  return { rank: 4, name: 'Straight' };
  if (freqs[0] === 3)              return { rank: 3, name: 'Three of a Kind' };
  if (freqs[0] === 2 && freqs[1] === 2) return { rank: 2, name: 'Two Pair' };
  if (freqs[0] === 2)              return { rank: 1, name: 'Pair' };
  return { rank: 0, name: 'High Card' };
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
// Returns { rank: 0–8, name: string } or null if not enough cards.
export function bestHand(holeCards, board) {
  const all = [...(holeCards || []), ...(board || [])].filter(c => c && c.rank && c.suit !== '?');
  if (all.length < 5) return null;
  let best = { rank: -1, name: 'High Card' };
  for (const combo of pickCombos(all, 5)) {
    const r = evalFive(combo);
    if (r.rank > best.rank) best = r;
  }
  return best.rank >= 0 ? best : null;
}

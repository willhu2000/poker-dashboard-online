// Pure frame builder for the hand replayer: walks an action log and produces
// one table snapshot per action (stacks, street bets, pot, board, who's
// acting). Kept JSX-free and separate from HandReplayer.jsx so it can be unit
// tested against analyseLog's action logs.

export function buildReplayFrames(log, heroName, heroCards) {
  const meta = (log || []).find(e => e.type === 'players');
  const order = meta ? meta.players.slice() : [];
  const state = {};
  for (const pm of order) {
    state[pm.name] = {
      name: pm.name, seat: pm.seat, pos: pm.pos,
      stack: pm.stack ?? 0, streetBet: 0, folded: false,
      cards: (heroName && pm.name === heroName && heroCards) ? heroCards.slice() : null,
      isHero: !!(heroName && pm.name === heroName),
    };
  }
  const ensure = (name) => state[name] ||
    (state[name] = { name, seat: null, pos: null, stack: 0, streetBet: 0, folded: false, cards: null, isHero: false });
  const cloneP = (p) => ({ ...p, cards: p.cards ? p.cards.slice() : null });

  const frames = [];
  let street = 'preflop', board = [], pot = 0;
  const order2 = order.length ? order.map(pm => pm.name) : null;

  for (const ev of log || []) {
    if (ev.type === 'players') continue;
    if (ev.type === 'street') {
      street = ev.street; board = ev.board || board;
      for (const s of Object.values(state)) s.streetBet = 0;
      continue;
    }
    if (ev.type !== 'action') continue;
    const s = ensure(ev.player);
    if (ev.action === 'fold') s.folded = true;
    else if (ev.action === 'show') { if (ev.cards?.length) s.cards = ev.cards.filter(c => c && c.rank); }
    else if (ev.action === 'collect') { s.stack += ev.amount || 0; pot = Math.max(0, pot - (ev.amount || 0)); }
    else if (ev.action === 'return') { s.stack += ev.amount || 0; s.streetBet = Math.max(0, s.streetBet - (ev.amount || 0)); pot = Math.max(0, pot - (ev.amount || 0)); }
    else if (ev.action === 'post-dead-sb') {
      // Dead money (missing small blind): into the pot, but it doesn't count
      // toward the poster's street bet — they still owe the full call amount.
      const amt = ev.amount || 0;
      s.stack -= amt; pot += amt;
    }
    else {
      let delta = 0;
      if (ev.action === 'post-sb' || ev.action === 'post-bb' || ev.action === 'bet') delta = ev.amount || 0;
      else if (ev.action === 'call' || ev.action === 'raise') delta = Math.max(0, (ev.amount || 0) - s.streetBet);
      if (delta > 0) { s.stack -= delta; s.streetBet += delta; pot += delta; }
    }
    const names = order2 || Object.keys(state);
    frames.push({
      street, board: board.slice(), pot, acting: ev.player, ev,
      players: names.map(n => cloneP(state[n])),
    });
  }
  return { frames, meta };
}

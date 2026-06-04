import { useState, useEffect, useMemo, useRef } from 'react';
import { playActionSound } from '../sounds.js';

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${m}-${d}-${y}`;
}

function CardBadge({ card }) {
  if (!card) return null;
  const suitMap = { s: '♠', h: '♥', d: '♦', c: '♣', '?': '?' };
  return (
    <span className={`card-badge ${card.suit}`}>
      {card.rank}{suitMap[card.suit] || card.suit}
    </span>
  );
}

const ACT_TEXT = {
  'post-sb': a => `posts small blind ${a.amount?.toLocaleString() ?? ''}`,
  'post-bb': a => `posts big blind ${a.amount?.toLocaleString() ?? ''}`,
  'fold': () => 'folds',
  'call': a => `calls ${a.amount?.toLocaleString() ?? ''}`,
  'raise': a => `raises to ${a.amount?.toLocaleString() ?? ''}`,
  'bet': a => `bets ${a.amount?.toLocaleString() ?? ''}`,
  'check': () => 'checks',
  'show': () => 'shows hand',
  'collect': a => `collects ${a.amount?.toLocaleString() ?? ''}`,
};

function actionVerb(ev) {
  const showCards = ev.action === 'show' && (ev.cards || []).filter(c => c && c.rank);
  if (showCards && showCards.length) {
    return <>shows {showCards.map((c, i) => <CardBadge key={i} card={c} />)}</>;
  }
  return ACT_TEXT[ev.action]?.(ev) ?? ev.action;
}

function buildReplayFrames(log, heroName, heroCards) {
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

function ReplaySeat({ p, angle, acting, isDealer }) {
  const x = 50 + 44 * Math.cos(angle);
  const y = 50 + 46 * Math.sin(angle);
  return (
    <div
      className={`rt-seat${acting ? ' acting' : ''}${p.folded ? ' folded' : ''}${p.isHero ? ' hero' : ''}`}
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <div className="rt-cards">
        {p.cards && p.cards.length
          ? p.cards.map((c, k) => <CardBadge key={k} card={c} />)
          : (!p.folded && <><span className="rt-cardback" /><span className="rt-cardback" /></>)}
      </div>
      <div className="rt-name">
        {isDealer && <span className="rt-dealer" title="Dealer">D</span>}
        {p.pos && <span className="rt-pos">{p.pos}</span>}
        <span className="rt-pname">{p.name}</span>
      </div>
      <div className="rt-stack">{Math.max(0, p.stack).toLocaleString()}</div>
      {p.streetBet > 0 && <div className="rt-bet">{p.streetBet.toLocaleString()}</div>}
    </div>
  );
}

export default function HandReplayer({ log, hand, heroName, heroCards, onClose }) {
  const { frames, meta } = useMemo(() => buildReplayFrames(log, heroName, heroCards), [log, heroName, heroCards]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;

  useEffect(() => {
    if (!playing) return undefined;
    if (i >= frames.length - 1) { setPlaying(false); return undefined; }
    const t = setTimeout(() => setI(x => Math.min(x + 1, frames.length - 1)), 1100);
    return () => clearTimeout(t);
  }, [playing, i, frames.length]);

  useEffect(() => {
    if (!soundRef.current) return;
    const ev = frames[Math.min(i, frames.length - 1)]?.ev;
    if (ev) playActionSound(ev.action);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  if (!frames.length) return null;
  const f = frames[Math.min(i, frames.length - 1)];

  const heroIdx = f.players.findIndex(p => p.isHero);
  const rot = heroIdx >= 0 ? heroIdx : 0;
  const n = f.players.length || 1;
  const seats = f.players.map((_, k) => f.players[(rot + k) % n]);

  return (
    <div className="replay-overlay" onClick={onClose}>
      <div className="replay-modal table" onClick={e => e.stopPropagation()}>
        <div className="replay-head">
          <span>▶ Replay — Hand #{hand?.num}{hand?.sessionDate ? ` · ${fmtDate(hand.sessionDate)}` : ''}</span>
          <button className="replay-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="rt-felt">
          {seats.map((p, k) => (
            <ReplaySeat
              key={p.name}
              p={p}
              angle={(90 + k * 360 / n) * Math.PI / 180}
              acting={p.name === f.acting}
              isDealer={meta?.dealer === p.name}
            />
          ))}
          <div className="rt-center">
            <div className="rt-board">
              {[0, 1, 2, 3, 4].map(k => (
                f.board[k]
                  ? <CardBadge key={k} card={f.board[k]} />
                  : <span key={k} className="rt-board-slot" />
              ))}
            </div>
            <div className="rt-pot">Pot {f.pot.toLocaleString()}</div>
          </div>
        </div>
        <div className="replay-current">
          <span className="rt-street-tag">{f.street.toUpperCase()}</span>
          <span className="al-player">{f.ev.player}</span>
          <span className="al-verb">{actionVerb(f.ev)}</span>
        </div>
        <div className="replay-controls">
          <button onClick={() => { setPlaying(false); setI(0); }} title="Restart">⏮</button>
          <button onClick={() => { setPlaying(false); setI(x => Math.max(0, x - 1)); }} disabled={i <= 0} title="Previous">◀</button>
          <button className="replay-play" onClick={() => setPlaying(p => !p)}>{playing ? '⏸ Pause' : '▶ Play'}</button>
          <button onClick={() => { setPlaying(false); setI(x => Math.min(frames.length - 1, x + 1)); }} disabled={i >= frames.length - 1} title="Next">▶</button>
          <button onClick={() => setSoundOn(s => !s)} title={soundOn ? 'Mute sound' : 'Unmute sound'}>{soundOn ? '🔊' : '🔇'}</button>
          <span className="replay-progress">{i + 1}/{frames.length}</span>
        </div>
      </div>
    </div>
  );
}

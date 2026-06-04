import { useState, useEffect, useMemo, useRef } from 'react';
import { bestHand } from '../handEval.js';
import { playActionSound } from '../sounds.js';
import CoachingReport from './CoachingReport.jsx';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  PieChart, Pie, Cell, Tooltip, Legend,
  LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine,
} from 'recharts';
import { PLAYER_COLORS } from '../colors.js';
const RANKS_DESC = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${m}-${d}-${y}`;
}

// ── Hand category label ───────────────────────────────────────────────────────
function categoryLabel(c1, c2) {
  if (!c1 || !c2) return '—';
  const RANK_ORDER = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const r1 = RANK_ORDER.indexOf(c1.rank);
  const r2 = RANK_ORDER.indexOf(c2.rank);
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
  const suited = c1.suit === c2.suit && c1.suit !== '?';
  const paired = r1 === r2;
  const gap = hi - lo;
  if (paired) {
    if (hi >= 12) return 'Premium Pair (AA/KK)';
    if (hi >= 10) return 'Strong Pair (QQ/JJ)';
    if (hi >= 7)  return 'Medium Pair (TT-88)';
    if (hi >= 4)  return 'Small Pair (77-55)';
    return 'Micro Pair (44-22)';
  }
  if (hi === 12 && lo === 11) return suited ? 'Premium (AKs)' : 'Premium (AKo)';
  if (hi === 12 && lo >= 10)  return suited ? 'Strong Ace (AQs/AJs)' : 'Strong Ace (AQo/AJo)';
  if (hi === 12 && lo >= 7)   return suited ? 'Medium Ace suited' : 'Medium Ace offsuit';
  if (hi === 12)               return suited ? 'Weak Ace suited' : 'Weak Ace offsuit';
  if (hi >= 10 && gap <= 2)   return suited ? 'Broadway suited' : 'Broadway offsuit';
  if (gap === 1 && lo >= 5)   return suited ? 'Suited Connector' : 'One-Gap Connector';
  if (gap <= 2 && lo >= 4 && suited) return 'Suited Connector';
  return 'Speculative / Trash';
}

// ── Premium hand detection ────────────────────────────────────────────────────
function isPremiumHand(c1, c2) {
  if (!c1 || !c2) return false;
  const RANK_V = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };
  const r1 = RANK_V[c1.rank] || 0, r2 = RANK_V[c2.rank] || 0;
  // AA, KK, QQ
  if (r1 === r2 && r1 >= 12) return true;
  // AKs
  if (((r1 === 14 && r2 === 13) || (r1 === 13 && r2 === 14)) && c1.suit === c2.suit) return true;
  return false;
}

function premiumLabel(c1, c2) {
  if (!c1 || !c2) return '';
  const RANK_V = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };
  const r1 = RANK_V[c1.rank] || 0, r2 = RANK_V[c2.rank] || 0;
  if (r1 === r2) return c1.rank + c1.rank;
  return 'AKs';
}

// ── Hand strength for sort ────────────────────────────────────────────────────
const RANK_VAL = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };

function handStrength(c1, c2) {
  if (!c1 || !c2) return -1;
  const r1 = RANK_VAL[c1.rank] || 0;
  const r2 = RANK_VAL[c2.rank] || 0;
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
  const suited = c1.suit === c2.suit && c1.suit !== '?';
  if (r1 === r2) return 500 + hi * 10;          // pairs top
  return hi * 15 + lo + (suited ? 1 : 0);       // hi card dominates, suited bonus
}

// ── Card query parser ─────────────────────────────────────────────────────────
const _RMAP = {
  'a':'A','ace':'A','aces':'A',
  'k':'K','king':'K','kings':'K',
  'q':'Q','queen':'Q','queens':'Q',
  'j':'J','jack':'J','jacks':'J',
  't':'10','ten':'10','tens':'10','10':'10',
  '9':'9','nine':'9','nines':'9','8':'8','eight':'8','eights':'8',
  '7':'7','seven':'7','sevens':'7','6':'6','six':'6','sixes':'6',
  '5':'5','five':'5','fives':'5','4':'4','four':'4','fours':'4',
  '3':'3','three':'3','threes':'3','2':'2','two':'2','twos':'2','deuce':'2','deuces':'2',
};
const _SMAP = { 's':'s','spade':'s','spades':'s','h':'h','heart':'h','hearts':'h','d':'d','diamond':'d','diamonds':'d','c':'c','club':'c','clubs':'c' };

function parseCardQuery(input) {
  const toks = input.toLowerCase().split(/[\s,]+/).filter(Boolean);
  const cards = [];
  let i = 0;
  while (i < toks.length && cards.length < 2) {
    const t = toks[i];
    // compact rank+suit: "as","kd","10h"
    const rs = t.match(/^(a|k|q|j|10|[2-9])(s|h|d|c)$/);
    if (rs) { cards.push({ rank: _RMAP[rs[1]], suit: _SMAP[rs[2]] }); i++; continue; }
    // pure rank word
    if (_RMAP[t]) {
      const rank = _RMAP[t];
      if (i+1 < toks.length && _SMAP[toks[i+1]]) { cards.push({ rank, suit: _SMAP[toks[i+1]] }); i+=2; }
      else { cards.push({ rank, suit: null }); i++; }
      continue;
    }
    // doubled single-char: "aa","kk","99"
    const dd = t.match(/^([akqjt2-9])\1$/);
    if (dd && _RMAP[dd[1]]) { const r = _RMAP[dd[1]]; cards.push({ rank:r,suit:null },{ rank:r,suit:null }); i++; continue; }
    // "1010"
    if (t === '1010') { cards.push({ rank:'10',suit:null },{ rank:'10',suit:null }); i++; continue; }
    // two-rank compact: "ak","qj","aks"
    const tr = t.match(/^([akqjt2-9])(10|[akqjt2-9])[so]?$/);
    if (tr && _RMAP[tr[1]] && _RMAP[tr[2]]) { cards.push({ rank:_RMAP[tr[1]],suit:null },{ rank:_RMAP[tr[2]],suit:null }); i++; continue; }
    i++;
  }
  return cards;
}

function cardMatchesDesc(card, desc) {
  if (!card || !desc) return false;
  if (desc.rank && card.rank !== desc.rank) return false;
  if (desc.suit && card.suit !== desc.suit) return false;
  return true;
}

function handMatchesCardQuery(c1, c2, descs) {
  if (!descs?.length) return true;
  if (descs.length === 1) return cardMatchesDesc(c1, descs[0]) || cardMatchesDesc(c2, descs[0]);
  const [d1, d2] = descs;
  return (cardMatchesDesc(c1,d1)&&cardMatchesDesc(c2,d2)) || (cardMatchesDesc(c1,d2)&&cardMatchesDesc(c2,d1));
}

function computeHandStrength(h) {
  const board = (h.board || []).filter(c => c && c.rank);
  if (h.c1 && h.c2) {
    if (board.length === 0) {
      // Preflop: only pair or high card
      return h.c1.rank === h.c2.rank ? { rank: 1, name: 'Pair' } : { rank: 0, name: 'High Card' };
    }
    return bestHand([h.c1, h.c2], board) ?? null;
  }
  // Unknown hole cards — evaluate board alone (needs ≥5 cards)
  if (board.length >= 5) return bestHand([], board) ?? null;
  return null;
}

function matchesSearch(h, query, col) {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  const chkHand = () => String(h.num).includes(q) || `#${h.num}`.includes(q);
  const chkCards = () => {
    const ds = parseCardQuery(query);
    return ds.length > 0 ? handMatchesCardQuery(h.c1, h.c2, ds) : categoryLabel(h.c1,h.c2).toLowerCase().includes(q);
  };
  const chkType = () => categoryLabel(h.c1,h.c2).toLowerCase().includes(q);
  const chkSess = () => fmtDate(h.sessionDate).toLowerCase().includes(q)||(h.sessionDate||'').includes(q);
  const chkRes  = () => (h.isCooler?'cooler':h.isBadBeat?'bad beat':h.isSuckOut?'suck-out':h.won?'won win':h.wasShown?'lost loss':'fold folded').includes(q);
  const chkPot      = () => String(h.potSize||0).includes(q);
  const chkStrength = () => (computeHandStrength(h)?.name ?? '').toLowerCase().includes(q);
  switch(col){
    case 'hand': return chkHand();
    case 'cards': return chkCards();
    case 'type': return chkType();
    case 'session': return chkSess();
    case 'result': return chkRes();
    case 'pot': return chkPot();
    case 'strength': return chkStrength();
    default: return chkHand()||chkCards()||chkType()||chkSess()||chkRes()||chkPot()||chkStrength();
  }
}

// ── Card badge ────────────────────────────────────────────────────────────────
function CardBadge({ card }) {
  if (!card) return null;
  const suitMap = { s: '♠', h: '♥', d: '♦', c: '♣', '?': '?' };
  return (
    <span className={`card-badge ${card.suit}`}>
      {card.rank}{suitMap[card.suit] || card.suit}
    </span>
  );
}

// ── Board cards with flop/turn/river separators ───────────────────────────────
function BoardCards({ board }) {
  if (!board?.length) return <span style={{ color:'var(--muted)' }}>—</span>;
  return (
    <div className="board-cards">
      {board.slice(0,3).map((c,i) => <CardBadge key={i} card={c}/>)}
      {board.length>3&&<><span className="board-sep">|</span><CardBadge card={board[3]}/></>}
      {board.length>4&&<><span className="board-sep">|</span><CardBadge card={board[4]}/></>}
    </div>
  );
}

// ── Action log ────────────────────────────────────────────────────────────────
const ACT_TEXT = {
  'post-sb': a=>`posts small blind ${a.amount?.toLocaleString()??''}`,
  'post-bb': a=>`posts big blind ${a.amount?.toLocaleString()??''}`,
  'fold': ()=>'folds',
  'call': a=>`calls ${a.amount?.toLocaleString()??''}`,
  'raise': a=>`raises to ${a.amount?.toLocaleString()??''}`,
  'bet': a=>`bets ${a.amount?.toLocaleString()??''}`,
  'check': ()=>'checks',
  'show': ()=>'shows hand',
  'collect': a=>`collects ${a.amount?.toLocaleString()??''}`,
};

function ActionLog({ log }) {
  if (!log?.length) return <p style={{color:'var(--muted)',fontSize:'0.78rem'}}>No action data (re-upload to capture).</p>;
  const groups = [];
  let cur = { street:'preflop', board:null, actions:[] };
  for (const ev of log) {
    if (ev.type==='street') { groups.push(cur); cur={street:ev.street,board:ev.board,actions:[]}; }
    else if (ev.type==='action') cur.actions.push(ev);
  }
  groups.push(cur);
  return (
    <div className="action-log">
      {groups.filter(g=>g.actions.length>0).map((g,gi)=>(
        <div key={gi} className="al-group">
          <div className="al-street-label">
            {g.street.toUpperCase()}
            {g.board?.length>0&&<span className="al-board">{g.board.map((c,i)=><CardBadge key={i} card={c}/>)}</span>}
          </div>
          {g.actions.map((act,ai)=>(
            <div key={ai} className="al-action">
              <span className="al-player">{act.player}</span>
              <span className="al-verb">{actionVerb(act)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Render an action's verb, expanding a "show" into "shows ♠♥" with the cards.
function actionVerb(ev) {
  const showCards = ev.action === 'show' && (ev.cards || []).filter(c => c && c.rank);
  if (showCards && showCards.length) {
    return <>shows {showCards.map((c, i) => <CardBadge key={i} card={c} />)}</>;
  }
  return ACT_TEXT[ev.action]?.(ev) ?? ev.action;
}

// Step a hand's action log into frames carrying a full table snapshot (every
// player's stack, current bet, fold state and cards) plus board + pot. Reads the
// leading `players` meta entry (seats / starting stacks / positions) when present.
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

// One seat around the table, positioned at `angle` (radians) on the ellipse.
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

// Step-through poker-table replay of a single hand, opened as a modal overlay.
function HandReplayer({ log, hand, heroName, heroCards, onClose }) {
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

  // Play the current action's sound effect whenever we step to a new frame.
  useEffect(() => {
    if (!soundRef.current) return;
    const ev = frames[Math.min(i, frames.length - 1)]?.ev;
    if (ev) playActionSound(ev.action);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  if (!frames.length) return null;
  const f = frames[Math.min(i, frames.length - 1)];

  // Order seats so the hero (or first player) sits at the bottom, then spread
  // the rest evenly around the ellipse going clockwise.
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

// Sortable table-header cell. Hoisted to module scope — defining it inside the
// component would create a fresh component type on every render.
function SortTh({ col, children, style, sortCol, sortDir, onSort }) {
  const active = sortCol === col;
  return (
    <th onClick={() => onSort(col)} className={`sortable${active ? ' sort-active' : ''}`} style={style}>
      {children} <span style={{ opacity: 0.5, fontSize: '0.7em' }}>{active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
    </th>
  );
}

// A clickable "biggest pot" row that expands to show the hand's play-by-play.
function BigPotCard({ kind, rank, h, isMerged, amountNode, extraDetails, expanded, onToggle, log, onReplay }) {
  return (
    <div
      className={`big-pot-card ${kind}${expanded ? ' expanded' : ''}`}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
    >
      <div className="bp-main">
        {rank != null && <div className="bp-rank">#{rank}</div>}
        <div className="bp-body">
          <div className="bp-header">
            <span className="bp-num">Hand #{h.num}{isMerged && h.sessionDate && <span style={{ color: 'var(--muted)', fontSize: '0.72rem', marginLeft: 6 }}>({fmtDate(h.sessionDate)})</span>}</span>
            {amountNode}
          </div>
          <div className="bp-details">
            {h.c1 && h.c2 ? <><CardBadge card={h.c1} /><CardBadge card={h.c2} /></> : <span className="mucked-cards">?? ??</span>}
            {h.board?.length > 0 && <span style={{ marginLeft: 8 }}><BoardCards board={h.board} /></span>}
            {h.myHandName && <span style={{ color: 'var(--muted)', fontSize: '0.78rem', marginLeft: 8 }}>{h.myHandName}</span>}
            {extraDetails}
          </div>
        </div>
        <span className="bp-chevron">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="bp-runout" onClick={(e) => e.stopPropagation()}>
          <div className="bp-runout-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Play by Play
            {onReplay && log?.length > 0 && <button className="replay-btn" onClick={onReplay}>▶ Replay</button>}
          </div>
          <ActionLog log={log} />
        </div>
      )}
    </div>
  );
}

// ── Range grid ────────────────────────────────────────────────────────────────
function handKey(c1, c2) {
  const toR = r => r === '10' ? 'T' : r;
  const r1 = toR(c1.rank), r2 = toR(c2.rank);
  const i1 = RANKS_DESC.indexOf(r1), i2 = RANKS_DESC.indexOf(r2);
  if (i1 === i2) return r1 + r2;
  const suited = c1.suit === c2.suit && c1.suit !== '?';
  const [hi, lo] = i1 < i2 ? [r1, r2] : [r2, r1];
  return hi + lo + (suited ? 's' : 'o');
}

// Quantized color stops: blue → purple → magenta → hot pink
const RANGE_STOPS = [
  [30, 80, 220],   // 0: blue
  [70, 60, 200],   // 1
  [110, 50, 190],  // 2
  [145, 40, 180],  // 3
  [175, 35, 165],  // 4
  [200, 30, 150],  // 5
  [220, 28, 130],  // 6
  [235, 30, 110],  // 7
  [245, 30, 90],   // 8
  [255, 40, 100],  // 9: hot pink
];

function cellBg(count, maxCount) {
  if (!count || !maxCount) return '#1e2035';
  if (maxCount <= 10) {
    // Quantized: pick a distinct stop for each count
    const idx = Math.min(count, RANGE_STOPS.length) - 1;
    const [r, g, b] = RANGE_STOPS[Math.round(idx * (RANGE_STOPS.length - 1) / Math.max(maxCount - 1, 1))];
    return `rgb(${r}, ${g}, ${b})`;
  }
  // Smooth interpolation for larger counts
  const t = Math.sqrt(count / maxCount);
  const r = Math.round(30 + t * (255 - 30));
  const g = Math.round(80 + t * (40 - 80));
  const b = Math.round(220 + t * (100 - 220));
  return `rgb(${r}, ${g}, ${b})`;
}

function RangeGrid({ rangeHands }) {
  // Click a "times played" key to highlight only the hands played that many
  // times (and dim the rest); click again to clear. Mirrors the pie's toggle.
  const [selectedCount, setSelectedCount] = useState(null);
  const toggleCount = (n) => setSelectedCount(prev => (prev === n ? null : n));

  const freq = {};
  for (const { c1, c2 } of rangeHands) {
    if (!c1 || !c2) continue;
    const k = handKey(c1, c2);
    freq[k] = (freq[k] || 0) + 1;
  }
  const maxCount = Math.max(1, ...Object.values(freq));
  return (
    <div className="range-grid-wrap">
      <div className="range-grid">
        {RANKS_DESC.map((rowR, i) => RANKS_DESC.map((colR, j) => {
          const key = i === j ? rowR + colR : i < j ? rowR + colR + 's' : colR + rowR + 'o';
          const count = freq[key] || 0;
          const label = i === j ? rowR + rowR : i < j ? rowR + colR + 's' : colR + rowR + 'o';
          const selecting = selectedCount != null;
          const isMatch = selecting && count === selectedCount;
          let opacity = count > 0 ? 0.35 + 0.65 * Math.sqrt(count / maxCount) : undefined;
          if (selecting && !isMatch) opacity = (opacity ?? 1) * 0.15;     // dim non-matching
          else if (isMatch) opacity = count > 0 ? Math.max(opacity, 0.92) : 0.85; // emphasize match
          return (
            <div key={key} title={`${label}: ${count} hand${count !== 1 ? 's' : ''}`}
              className={`range-cell${count > 0 ? ' played' : ''}${isMatch ? ' rc-match' : ''}`}
              style={{ background: cellBg(count, maxCount), opacity }}>
              {label}
            </div>
          );
        }))}
      </div>
      <div className="range-legend">
        {maxCount <= 10 ? (
          <div className="range-legend-steps">
            {Array.from({ length: maxCount + 1 }, (_, n) => (
              <div
                key={n}
                className={`range-step clickable${selectedCount === n ? ' selected' : ''}`}
                onClick={() => toggleCount(n)}
                role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCount(n); } }}
                title={`Highlight hands played ${n} time${n !== 1 ? 's' : ''}`}
              >
                <div className="range-swatch" style={{ background: n === 0 ? '#1e2035' : cellBg(n, maxCount) }} />
                <span>{n}</span>
              </div>
            ))}
            <span className="range-legend-caption">times played</span>
          </div>
        ) : (
          <div className="range-legend-bar">
            <span className="range-legend-label">0</span>
            <div className="range-legend-gradient" />
            <span className="range-legend-label">{maxCount}</span>
            <span className="range-legend-caption">times played</span>
          </div>
        )}
        <p className="range-legend-help">
          {maxCount <= 10 && <>Click a count to highlight those hands · </>}
          Suited upper-right · pairs diagonal · offsuit lower-left
        </p>
      </div>
    </div>
  );
}

// ── Radar info ────────────────────────────────────────────────────────────────
const RADAR_AXES = [
  { name: 'VPIP',       desc: 'How often you voluntarily put money in preflop (call or raise). Higher = looser hand selection.',                        scale: 'Direct %. 50% VPIP → 50 on chart.' },
  { name: 'PFR',        desc: 'How often you raise preflop. A PFR close to your VPIP means you rarely limp in.',                                       scale: 'Direct %. 30% PFR → 30 on chart.' },
  { name: 'Aggression', desc: 'Post-flop aggression factor: (Bets + Raises) ÷ Calls. Higher = more betting pressure, fewer passive calls.',            scale: 'AF × 20, capped at 100. An AF of 5 fills the axis.' },
  { name: 'Win Rate',   desc: 'Percentage of all dealt hands where you collected the pot.',                                                             scale: 'Direct %. 40% win rate → 40 on chart.' },
  { name: 'Tightness',  desc: 'Inverse of VPIP — how selectively you play hands. High score = tight range, low score = loose.',                        scale: '100 − VPIP. A 20% VPIP player scores 80.' },
  { name: 'Luckiness',  desc: '% of your observed hands that were premium (AA/KK/QQ/JJ/AK). Measures how often you\'ve been dealt strong cards.',      scale: '% × 2, capped at 100. 50% premium rate fills the axis.' },
];

// ── Style tags ────────────────────────────────────────────────────────────────
function styleTag(p) {
  const tags = [];
  if (p.vpip < 20) tags.push({ label: 'Tight', cls: 'tight' });
  else if (p.vpip > 50) tags.push({ label: 'Loose', cls: 'loose' });
  else tags.push({ label: 'Semi-Loose', cls: '' });
  if (p.af > 2) tags.push({ label: 'Aggressive', cls: 'agg' });
  else if (p.af < 1) tags.push({ label: 'Passive', cls: '' });
  else tags.push({ label: 'Balanced', cls: '' });
  return tags;
}

const PieTip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <div className="label">{payload[0]?.name}</div>
      <div style={{ color: payload[0]?.payload?.fill || '#fff' }}>{payload[0]?.value} hands</div>
    </div>
  );
};

// ── Severity helpers ──────────────────────────────────────────────────────────
const BB_SEVERITY  = ['', '', '💔', '💔', '💔💔', '💔💔', '💔💔💔', '💔💔💔', '💔💔💔💔'];
const SO_SEVERITY  = ['', '', '🎲', '🎲', '🎲🎲', '🎲🎲', '🎲🎲🎲', '🎲🎲🎲', '🎲🎲🎲🎲'];
const CL_SEVERITY  = ['', '', '', '⚔️', '⚔️', '⚔️⚔️', '⚔️⚔️', '⚔️⚔️⚔️', '⚔️⚔️⚔️', '⚔️⚔️⚔️⚔️'];

const OMINOUS = [
  'No bad beats on record. The poker gods smile upon you... for now.',
  'Zero bad beats. Either you run perfect or the real pain is still coming.',
  'Clean history. But variance always collects what it\'s owed.',
  'No suffering documented. The river has a long memory.',
  'Spotless record. In poker, there\'s no such thing as a free lunch.',
];
const SUCKOUT_NONE = [
  'No suck-outs on record. Your wins have been earned honestly.',
  'You haven\'t caught a lucky river yet. Pure skill, or just always ahead?',
  'No outdraws found. Either you\'re always ahead, or always behind.',
  'A clean conscience — you haven\'t stolen any pots from someone who deserved them.',
];

// ── Simple View stats ─────────────────────────────────────────────────────────
function SimpleStats({ player: p, biggestWins, biggestSplits, biggestLosses, badBeats, suckOuts, coolers }) {
  const chipsPerHand = p.handsDealt > 0 ? (p.netChips / p.handsDealt).toFixed(1) : 0;
  const showdownWins = (p.handsHistory || []).filter(h => h.wasShown && h.won).length;
  const showdownTotal = (p.handsHistory || []).filter(h => h.wasShown).length;
  const showdownPct = showdownTotal > 0 ? Math.round(showdownWins / showdownTotal * 100) : 0;
  const topWin = biggestWins[0];
  const topSplit = biggestSplits[0];
  const topLoss = biggestLosses[0];
  const foldPct = p.preflopFoldPct;

  return (
    <div className="simple-stats">
      <div className="detail-grid">
        <div className="detail-stat"><div className="ds-label">Hands Dealt</div><div className="ds-value">{p.handsDealt}</div></div>
        <div className="detail-stat"><div className="ds-label">Net Chips</div>
          <div className="ds-value" style={{ color: p.netChips >= 0 ? 'var(--win)' : 'var(--lose)' }}>
            {p.netChips >= 0 ? '+' : ''}{p.netChips}
          </div>
        </div>
        <div className="detail-stat"><div className="ds-label">Win Rate</div><div className="ds-value">{p.winRate}%</div></div>
        <div className="detail-stat"><div className="ds-label">VPIP</div><div className="ds-value">{p.vpip}%</div></div>
      </div>

      <div className="simple-fun-stats">
        <div className="fun-stat">
          <span className="fun-icon">📊</span>
          <span className="fun-label">Chips per Hand</span>
          <span className="fun-value" style={{ color: chipsPerHand >= 0 ? 'var(--win)' : 'var(--lose)' }}>
            {chipsPerHand >= 0 ? '+' : ''}{chipsPerHand}
          </span>
        </div>
        <div className="fun-stat">
          <span className="fun-icon">🎯</span>
          <span className="fun-label">Showdown Win Rate</span>
          <span className="fun-value">{showdownPct}% <span style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>({showdownWins}/{showdownTotal})</span></span>
        </div>
        <div className="fun-stat">
          <span className="fun-icon">🏆</span>
          <span className="fun-label">Biggest Pot Won</span>
          <span className="fun-value" style={{ color: 'var(--win)' }}>
            {topWin ? (topWin.wonAmount ?? topWin.potSize).toLocaleString() : '—'}
            {topWin?.myHandName && <span style={{ color: 'var(--muted)', fontSize: '0.72rem', marginLeft: 4 }}>({topWin.myHandName})</span>}
          </span>
        </div>
        <div className="fun-stat">
          <span className="fun-icon">🤝</span>
          <span className="fun-label">Biggest Pot Split</span>
          <span className="fun-value" style={{ color: 'var(--gold)' }}>
            {topSplit ? (topSplit.wonAmount ?? topSplit.potSize).toLocaleString() : '—'}
            {topSplit && <span style={{ color: 'var(--muted)', fontSize: '0.72rem', marginLeft: 4 }}>(of {topSplit.potSize.toLocaleString()})</span>}
          </span>
        </div>
        <div className="fun-stat">
          <span className="fun-icon">💸</span>
          <span className="fun-label">Biggest Pot Lost</span>
          <span className="fun-value" style={{ color: 'var(--lose)' }}>
            {topLoss ? topLoss.potSize.toLocaleString() : '—'}
            {topLoss?.myHandName && <span style={{ color: 'var(--muted)', fontSize: '0.72rem', marginLeft: 4 }}>({topLoss.myHandName})</span>}
          </span>
        </div>
        <div className="fun-stat">
          <span className="fun-icon">🃏</span>
          <span className="fun-label">Fold Preflop</span>
          <span className="fun-value">{foldPct}%</span>
        </div>
        <div className="fun-stat">
          <span className="fun-icon">💔</span>
          <span className="fun-label">Bad Beats</span>
          <span className="fun-value">{badBeats.length}</span>
        </div>
        <div className="fun-stat">
          <span className="fun-icon">🎲</span>
          <span className="fun-label">Suck-Outs</span>
          <span className="fun-value">{suckOuts.length}</span>
        </div>
        <div className="fun-stat">
          <span className="fun-icon">⚔️</span>
          <span className="fun-label">Coolers</span>
          <span className="fun-value">{coolers.length}</span>
        </div>
      </div>
    </div>
  );
}

// ── Advanced stats ────────────────────────────────────────────────────────────
const POS_ORDER = ['BTN', 'SB', 'BB', 'LP', 'MP', 'EP'];
const POS_LABEL = { BTN: 'Button', SB: 'Small Blind', BB: 'Big Blind', LP: 'Late (CO)', MP: 'Middle', EP: 'Early' };
const pctOf = (num, den) => (den > 0 ? +(num / den * 100).toFixed(1) : null);
const fmtPct = (v) => (v == null ? '—' : `${v}%`);

function modeBB(bbCounts) {
  let best = null, bestCnt = -1;
  for (const [size, cnt] of Object.entries(bbCounts || {})) {
    if (cnt > bestCnt) { bestCnt = cnt; best = +size; }
  }
  return best;
}

function AdvTile({ label, value, sub, color }) {
  return (
    <div className="adv-tile">
      <div className="adv-tile-label">{label}</div>
      <div className="adv-tile-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="adv-tile-sub">{sub}</div>}
    </div>
  );
}

function AdvancedStats({ player: p, isMerged = false, getLog, onReplay }) {
  const [openOpp, setOpenOpp] = useState(null); // expanded head-to-head opponent
  const [openHand, setOpenHand] = useState(null); // expanded H2H hand key
  const posRows = POS_ORDER
    .map(k => ({ k, ...(p.posStats?.[k] || { h: 0, v: 0, p: 0, w: 0 }) }))
    .filter(r => r.h > 0);
  const wtsd = pctOf(p.wtsdHands, p.sawFlopHands);
  const wsd = pctOf(p.wsdHands, p.wtsdHands);
  const threeBet = pctOf(p.threeBets, p.threeBetOpp);
  const cbet = pctOf(p.cbets, p.cbetOpp);
  const bb = modeBB(p.bbCounts);
  const bbPer100 = bb && p.handsDealt ? +((p.netChips / bb) / p.handsDealt * 100).toFixed(1) : null;
  const h2h = Object.entries(p.vsOpponents || {})
    .map(([name, r]) => ({ name, w: r.w || 0, l: r.l || 0, n: (r.w || 0) + (r.l || 0) }))
    .filter(o => o.n > 0)
    .sort((a, b) => b.n - a.n);

  const hasAny = posRows.length || wtsd != null || threeBet != null || cbet != null || bbPer100 != null || h2h.length;
  if (!hasAny) return null;

  return (
    <>
      <div className="section-title" style={{ fontSize: '0.9rem', marginTop: 16 }}>
        📐 Advanced Stats
        <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '0.78rem', marginLeft: 8 }}>
          — positional play, showdown funnel, 3-bet/c-bet, head-to-head
        </span>
      </div>

      <div className="adv-tiles">
        <AdvTile label="bb / 100" value={bbPer100 == null ? '—' : `${bbPer100 >= 0 ? '+' : ''}${bbPer100}`}
          color={bbPer100 == null ? undefined : (bbPer100 >= 0 ? 'var(--win)' : 'var(--lose)')}
          sub={bb ? `big blind = ${bb}` : 'win rate'} />
        <AdvTile label="WTSD" value={fmtPct(wtsd)} sub="went to showdown" />
        <AdvTile label="W$SD" value={fmtPct(wsd)} sub="won at showdown" />
        <AdvTile label="3-Bet" value={fmtPct(threeBet)} sub="preflop re-raise" />
        <AdvTile label="C-Bet" value={fmtPct(cbet)} sub="flop, as aggressor" />
      </div>

      {posRows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="adv-pos-table">
            <thead>
              <tr><th>Position</th><th>Hands</th><th>VPIP</th><th>PFR</th><th>Win %</th></tr>
            </thead>
            <tbody>
              {posRows.map(r => (
                <tr key={r.k}>
                  <td><strong>{POS_LABEL[r.k]}</strong></td>
                  <td>{r.h}</td>
                  <td>{fmtPct(pctOf(r.v, r.h))}</td>
                  <td>{fmtPct(pctOf(r.p, r.h))}</td>
                  <td>{fmtPct(pctOf(r.w, r.h))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {h2h.length > 0 && (
        <div className="adv-h2h">
          <div className="adv-h2h-label">
            Head-to-head at showdown
            <span style={{ textTransform: 'none', fontWeight: 400, marginLeft: 6 }}>— click an opponent to see the hands</span>
          </div>
          <div className="adv-h2h-list">
            {h2h.map(o => (
              <button
                key={o.name}
                className={`adv-h2h-item${openOpp === o.name ? ' active' : ''}`}
                onClick={() => { setOpenOpp(x => (x === o.name ? null : o.name)); setOpenHand(null); }}
              >
                vs {o.name}: <span className="pos">{o.w}W</span>–<span className="neg">{o.l}L</span>
                <span className="adv-h2h-chev">{openOpp === o.name ? ' ▾' : ' ▸'}</span>
              </button>
            ))}
          </div>
          {openOpp && (() => {
            const hands = (p.handsHistory || []).filter(h =>
              h.wasShown && (h.opponents || []).some(op => op.name === openOpp && op.c1));
            if (!hands.length) return <p className="cr-empty" style={{ marginTop: 8 }}>No showdown hands recorded vs {openOpp}.</p>;
            return (
              <div className="big-pot-list" style={{ marginTop: 8 }}>
                {hands.map((h, idx) => {
                  const key = `h2h-${idx}`;
                  const amt = (h.wonAmount ?? h.potSize).toLocaleString();
                  const amountNode = h.isSplit
                    ? <span className="bp-amount split">Split {amt}</span>
                    : h.won ? <span className="bp-amount pos">Won {amt}</span>
                      : <span className="bp-amount neg">Lost {h.potSize.toLocaleString()}</span>;
                  const oc = (h.opponents || []).find(op => op.name === openOpp);
                  return (
                    <BigPotCard
                      key={key} kind={h.isSplit ? 'split' : h.won ? 'win' : 'loss'} rank={null} h={h} isMerged={isMerged}
                      amountNode={amountNode}
                      extraDetails={oc && oc.c1 && <span style={{ color: 'var(--muted)', fontSize: '0.72rem', marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 2 }}>{openOpp}: <CardBadge card={oc.c1} /><CardBadge card={oc.c2} /></span>}
                      expanded={openHand === key} onToggle={() => setOpenHand(x => (x === key ? null : key))}
                      log={getLog ? getLog(h) : []} onReplay={onReplay ? () => onReplay(h) : null}
                    />
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}
    </>
  );
}

// ── Chip count / net profit over time ─────────────────────────────────────────
// Builds a chronological series of the player's stack entering each hand.
//   mode 'stack': the table stack, which resets to 0 between sessions (each
//     log-out / cash-out) — every session reads as its own segment.
//   mode 'net':   cumulative profit carried across sessions (no reset). Per
//     session, profit = stack − the first stack seen that session; the running
//     total carries forward. (Mid-session rebuys can distort this.)
function buildChipTimeline(handsHistory, mode) {
  const hands = handsHistory
    .filter(h => h.stack != null)
    .slice()
    .sort((a, b) =>
      ((a.sessionDate || '').localeCompare(b.sessionDate || '')) ||
      // Keep same-date sessions grouped (genId isn't chronological, but this
      // stops two same-day sessions from interleaving by hand number).
      String(a.sessionId ?? '').localeCompare(String(b.sessionId ?? '')) ||
      (a.num - b.num));
  if (!hands.length) return [];

  const points = [];
  let i = 0;

  if (mode === 'net') {
    let prevSession = null;
    let carried = 0;     // net banked from completed prior sessions
    let baseline = 0;    // first stack of the current session
    let sessionNet = 0;
    for (const h of hands) {
      const sid = h.sessionId ?? '_single';
      if (sid !== prevSession) {
        if (prevSession !== null) carried += sessionNet;
        baseline = h.stack;
        sessionNet = 0;
      }
      sessionNet = h.stack - baseline;
      points.push({ i: i++, value: carried + sessionNet, kind: 'net', hand: h.num, sessionDate: h.sessionDate });
      prevSession = sid;
    }
    return points;
  }

  let prevSession = null;
  let prevDate = null;
  for (const h of hands) {
    const sid = h.sessionId ?? '_single';
    if (prevSession !== null && sid !== prevSession) {
      // Logged out of the previous session → drop to 0 before the next buy-in.
      points.push({ i: i++, value: 0, reset: true, sessionDate: prevDate });
    }
    points.push({ i: i++, value: h.stack, hand: h.num, sessionDate: h.sessionDate });
    prevSession = sid;
    prevDate = h.sessionDate;
  }
  return points;
}

const ChipTip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (d.reset) return <div className="custom-tooltip"><div>Cashed out — stack reset to 0</div></div>;
  const v = d.value;
  const headline = d.kind === 'net'
    ? `${v >= 0 ? '+' : ''}${v.toLocaleString()} net`
    : `${v.toLocaleString()} chips`;
  return (
    <div className="custom-tooltip">
      <div className="label" style={d.kind === 'net' ? { color: v >= 0 ? 'var(--win)' : 'var(--lose)' } : undefined}>{headline}</div>
      <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
        Hand #{d.hand}{d.sessionDate ? ` · ${fmtDate(d.sessionDate)}` : ''}
      </div>
    </div>
  );
};

function ChipTimeline({ handsHistory, isViewer = false }) {
  const [mode, setMode] = useState('stack'); // 'stack' | 'net'
  const data = buildChipTimeline(handsHistory, mode);
  if (data.length < 2) return null;
  const sessionCount = new Set(
    handsHistory.filter(h => h.stack != null).map(h => h.sessionId ?? '_single')
  ).size;

  const who = isViewer ? 'your' : 'their';
  const subtitle = mode === 'net'
    ? `cumulative ${who} net profit (carries across sessions)`
    : `${who} stack entering each hand${sessionCount > 1 ? ', resets to 0 between sessions' : ''}`;

  return (
    <div className="chip-timeline">
      <div className="section-title" style={{ fontSize: '0.9rem', marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>📈 {mode === 'net' ? 'Net Profit Over Time' : 'Chip Count Over Time'}</span>
        <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '0.78rem' }}>— {subtitle}</span>
        <span className="chip-mode-toggle" style={{ marginLeft: 'auto' }}>
          <button className={mode === 'stack' ? 'active' : ''} onClick={() => setMode('stack')}>Stack</button>
          <button className={mode === 'net' ? 'active' : ''} onClick={() => setMode('net')}>Net profit</button>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 6 }}>
          <CartesianGrid stroke="#2e3350" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="i" tick={false} axisLine={{ stroke: '#2e3350' }} height={6} />
          <YAxis tick={{ fill: '#7c82a0', fontSize: 11 }} />
          <Tooltip content={<ChipTip />} />
          <ReferenceLine y={0} stroke="#3a3f5c" strokeDasharray="4 4" />
          <Line type="linear" dataKey="value" stroke={mode === 'net' ? '#00d4aa' : '#6c63ff'} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PlayerDetail({ player: p, isMerged = false, isViewer = false, handActionLogs = {}, onRename = null }) {
  const [showRadarInfo, setShowRadarInfo] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [handFilter, setHandFilter] = useState('all');
  const [expandedHand, setExpandedHand] = useState(null);
  const [detailMode, setDetailMode] = useState(false);
  const [sortCol, setSortCol] = useState('hand');
  const [sortDir, setSortDir] = useState('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCol, setSearchCol] = useState('all');
  // Which key-hand card (biggest pots / bad beats / suck-outs / coolers) is
  // expanded to show its play-by-play. Keyed `${section}-${index}`.
  const [expandedKeyHand, setExpandedKeyHand] = useState(null);
  const toggleKeyHand = (key) => setExpandedKeyHand(prev => (prev === key ? null : key));
  // Hand currently open in the replayer modal ({ log, hand }), or null.
  const [replay, setReplay] = useState(null);
  // Inline rename (only when an onRename handler is supplied).
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  function startRename() { setRenameValue(p.name); setRenaming(true); }
  function commitRename() { onRename?.(renameValue); setRenaming(false); }

  // Look up the action log for a hand entry. New sessions store logs in the
  // top-level handActionLogs map (keyed as `${sessionId}_${num}` when a sessionId
  // is available, plain `num` for un-merged single-session data). Old sessions
  // (pre-this-change) stored actionLog inline — fall back to that if present.
  function getActionLog(entry) {
    const key = entry.sessionId ? `${entry.sessionId}_${entry.num}` : entry.num;
    return handActionLogs[key] ?? entry.actionLog ?? [];
  }

  // Open the hand replayer for a hand entry, marking this player as the hero so
  // their hole cards are shown from the start.
  const openReplay = (entry) => setReplay({
    log: getActionLog(entry),
    hand: entry,
    heroName: p.name,
    heroCards: entry.c1 && entry.c2 ? [entry.c1, entry.c2] : null,
  });

  const tags = styleTag(p);

  const radarData = [
    { subject: 'VPIP',       value: Math.min(p.vpip, 100) },
    { subject: 'PFR',        value: Math.min(p.pfr, 100) },
    { subject: 'Aggression', value: Math.min(p.af * 20, 100) },
    { subject: 'Win Rate',   value: Math.min(p.winRate, 100) },
    { subject: 'Tightness',  value: p.tightness },
    { subject: 'Luckiness',  value: Math.min(p.luckiness * 2, 100) },
  ];

  const catData = Object.entries(p.handCategories)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const hasRange = (p.rangeHands || []).length > 0;

  // Category drill-down
  const handsHistory = p.handsHistory || [];
  const categoryHands = selectedCategory
    ? handsHistory.filter(h => h.c1 && h.c2 && categoryLabel(h.c1, h.c2) === selectedCategory)
    : [];

  function toggleCategory(name) {
    setSelectedCategory(prev => prev === name ? null : name);
  }

  // Bad beats, suck-outs & coolers
  const badBeats = [...(p.badBeats || [])].sort((a, b) => b.myHandRank - a.myHandRank);
  const suckOuts = [...(p.suckOuts || [])].sort((a, b) => b.oppHandRank - a.oppHandRank);
  const coolers = [...(p.coolers || [])].sort((a, b) => {
    const rA = Math.min(a.myHandRank, a.oppHandRank), rB = Math.min(b.myHandRank, b.oppHandRank);
    return rB - rA || b.potSize - a.potSize;
  });
  const ominousMsg   = OMINOUS[   (p.name.charCodeAt(0) || 0) % OMINOUS.length];
  const suckOutEmpty = SUCKOUT_NONE[(p.name.charCodeAt(0) || 0) % SUCKOUT_NONE.length];

  // Derived key-hands (not stored — computed at render).
  // Wins and splits both rank on take-home chips (`wonAmount`), not the total
  // pot — a 600 pot scooped solo outranks a 1000 pot split for 500.
  const takeHome = (h) => h.wonAmount ?? h.potSize;
  const biggestWins = [...handsHistory]
    .filter(h => h.won && !h.isSplit && takeHome(h) > 0)
    .sort((a, b) => takeHome(b) - takeHome(a))
    .slice(0, 5);
  const biggestSplits = [...handsHistory]
    .filter(h => h.won && h.isSplit && takeHome(h) > 0)
    .sort((a, b) => takeHome(b) - takeHome(a))
    .slice(0, 5);
  const biggestLosses = [...handsHistory]
    .filter(h => h.wasShown && !h.won && h.potSize > 0)
    .sort((a, b) => b.potSize - a.potSize)
    .slice(0, 5);
  const premiumShowdowns = handsHistory
    .filter(h => (h.wasShown || h.won) && isPremiumHand(h.c1, h.c2));
  const premiumRecord = {};
  for (const h of premiumShowdowns) {
    const lbl = premiumLabel(h.c1, h.c2);
    if (!premiumRecord[lbl]) premiumRecord[lbl] = { wins: 0, losses: 0 };
    if (h.won) premiumRecord[lbl].wins++; else premiumRecord[lbl].losses++;
  }

  // Hand history filters
  const FILTERS = [
    { key: 'all',       label: 'All' },
    { key: 'showdowns', label: 'Showdowns' },
    { key: 'wins',      label: 'Wins' },
    { key: 'splits',    label: 'Splits' },
    { key: 'losses',    label: 'Losses' },
    { key: 'badbeats',  label: 'Bad Beats' },
    { key: 'suckouts',  label: 'Suck-Outs' },
    { key: 'coolers',   label: 'Coolers' },
  ];

  function filterCount(key) {
    if (key === 'all')       return handsHistory.length;
    if (key === 'showdowns') return handsHistory.filter(h => h.wasShown).length;
    if (key === 'wins')      return handsHistory.filter(h => h.won && !h.isSplit).length;
    if (key === 'splits')    return handsHistory.filter(h => h.isSplit).length;
    if (key === 'losses')    return handsHistory.filter(h => h.wasShown && !h.won).length;
    if (key === 'badbeats')  return handsHistory.filter(h => h.isBadBeat).length;
    if (key === 'suckouts')  return handsHistory.filter(h => h.isSuckOut).length;
    if (key === 'coolers')   return handsHistory.filter(h => h.isCooler).length;
    return 0;
  }

  // Sort handler
  function handleSortClick(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir(col === 'hand' || col === 'strength' || col === 'pot' ? 'desc' : 'asc'); }
  }

  // Filtered + sorted hand list
  const filteredHands = (() => {
    let result = handsHistory.filter(h => {
      if (handFilter === 'showdowns') return h.wasShown;
      if (handFilter === 'wins')      return h.won && !h.isSplit;
      if (handFilter === 'splits')    return h.isSplit;
      if (handFilter === 'losses')    return h.wasShown && !h.won;
      if (handFilter === 'badbeats')  return h.isBadBeat;
      if (handFilter === 'suckouts')  return h.isSuckOut;
      if (handFilter === 'coolers')   return h.isCooler;
      return true;
    });
    if (searchQuery.trim()) result = result.filter(h => matchesSearch(h, searchQuery, searchCol));
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'hand')    cmp = ((a.sessionDate||'').localeCompare(b.sessionDate||'')) || a.num - b.num;
      else if (sortCol === 'pot')     cmp = (a.potSize||0) - (b.potSize||0);
      else if (sortCol === 'cards')   cmp = handStrength(a.c1, a.c2) - handStrength(b.c1, b.c2);
      else if (sortCol === 'type')    cmp = categoryLabel(a.c1, a.c2).localeCompare(categoryLabel(b.c1, b.c2));
      else if (sortCol === 'session') cmp = (a.sessionDate||'').localeCompare(b.sessionDate||'');
      else if (sortCol === 'result') {
        const rk = h => h.isCooler ? 6 : h.isBadBeat ? 5 : h.isSuckOut ? 4 : h.isSplit ? 3 : h.won ? 2 : h.wasShown ? 1 : 0;
        cmp = rk(a) - rk(b);
      }
      else if (sortCol === 'strength') {
        cmp = (computeHandStrength(a)?.rank ?? -1) - (computeHandStrength(b)?.rank ?? -1);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  })();

  return (
    <div className="player-detail">
      {/* Header row with name + detail mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        {renaming ? (
          <div className="pd-rename" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              className="pd-rename-input"
              type="text"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
              autoFocus
            />
            <button className="pd-rename-btn active" onClick={commitRename} title="Save name">OK</button>
            <button className="pd-rename-btn" onClick={() => setRenaming(false)} title="Cancel">✕</button>
          </div>
        ) : (
          <h2 style={{ margin: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            {p.name}
            {onRename && (
              <button className="pd-rename-pencil" onClick={startRename} title="Rename player" aria-label="Rename player">✎</button>
            )}
          </h2>
        )}
        <button
          className={`detail-toggle-btn${detailMode ? ' active' : ''}`}
          onClick={() => setDetailMode(d => !d)}
        >
          {detailMode ? 'Simple View' : 'Detailed Mode'}
        </button>
      </div>
      <div className="subtitle">
        {tags.map(t => (
          <span key={t.label} className={`tag ${t.cls}`} style={{ marginRight: 6 }}>{t.label}</span>
        ))}
      </div>

      {/* Stat grid */}
      {detailMode ? (
        <div className="detail-grid">
          <div className="detail-stat"><div className="ds-label">Hands Dealt</div><div className="ds-value">{p.handsDealt}</div></div>
          <div className="detail-stat"><div className="ds-label">Net Chips</div>
            <div className="ds-value" style={{ color: p.netChips >= 0 ? 'var(--win)' : 'var(--lose)' }}>
              {p.netChips >= 0 ? '+' : ''}{p.netChips}
            </div>
          </div>
          <div className="detail-stat"><div className="ds-label">VPIP</div><div className="ds-value">{p.vpip}%</div></div>
          <div className="detail-stat"><div className="ds-label">PFR</div><div className="ds-value">{p.pfr}%</div></div>
          <div className="detail-stat"><div className="ds-label">Preflop Fold</div><div className="ds-value">{p.preflopFoldPct}%</div></div>
          <div className="detail-stat"><div className="ds-label">Agg Factor</div><div className="ds-value">{p.af === 99 ? '∞' : p.af}</div></div>
          <div className="detail-stat"><div className="ds-label">Win Rate</div><div className="ds-value">{p.winRate}%</div></div>
          <div className="detail-stat"><div className="ds-label">Hands Won</div><div className="ds-value">{p.handsWon}</div></div>
          <div className="detail-stat"><div className="ds-label">Luckiness†</div><div className="ds-value">{p.luckiness}%</div></div>
          <div className="detail-stat"><div className="ds-label">Buy-ins</div><div className="ds-value">{p.buyIns}</div></div>
          <div className="detail-stat"><div className="ds-label">Cash Out</div><div className="ds-value">{p.cashOut}</div></div>
          <div className="detail-stat"><div className="ds-label">Showdowns</div><div className="ds-value">{p.shownHands.length}</div></div>
        </div>
      ) : (
        <SimpleStats player={p} biggestWins={biggestWins} biggestSplits={biggestSplits} biggestLosses={biggestLosses} badBeats={badBeats} suckOuts={suckOuts} coolers={coolers} />
      )}

      {/* Chip count over time — available for any player (stacks are recorded
          for everyone in each `Player stacks:` snapshot). */}
      <ChipTimeline handsHistory={handsHistory} isViewer={isViewer} />

      {/* Charts */}
      <div className="charts-grid" style={{ marginBottom: 0 }}>

        {/* Radar */}
        <div className="chart-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Player Profile</h3>
            <button className="radar-info-btn" onClick={() => setShowRadarInfo(s => !s)}>
              ⓘ {showRadarInfo ? 'Hide' : 'How it\'s scored'}
            </button>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <RadarChart data={radarData} outerRadius={80} cy="55%">
              <PolarGrid stroke="var(--border)" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: '#7c82a0', fontSize: 11 }} />
              <Radar dataKey="value" stroke="#6c63ff" fill="#6c63ff" fillOpacity={0.3} />
            </RadarChart>
          </ResponsiveContainer>
          {showRadarInfo && (
            <div className="radar-info-panel">
              {RADAR_AXES.map(a => (
                <div key={a.name} className="radar-info-row">
                  <div className="ri-name">{a.name}</div>
                  <div className="ri-body">
                    <div className="ri-desc">{a.desc}</div>
                    <div className="ri-scale">{a.scale}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hand categories — pie chart of shown/known hands */}
        {catData.length > 0 && (
          <div className="chart-card">
            <h3 style={{ margin: '0 0 8px' }}>Hand Categories (shown/known)</h3>
            <p style={{ color: 'var(--muted)', fontSize: '0.72rem', marginBottom: 6 }}>
              Click a slice or legend item to see all hands in that category.
            </p>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart margin={{ top: 24, right: 0, bottom: 0, left: 0 }}>
                <Pie
                  data={catData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="45%"
                  outerRadius={85}
                  onClick={(d) => toggleCategory(d.name)}
                  style={{ cursor: 'pointer' }}
                >
                  {catData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={PLAYER_COLORS[i % PLAYER_COLORS.length]}
                      opacity={selectedCategory && selectedCategory !== entry.name ? 0.35 : 1}
                      stroke={selectedCategory === entry.name ? '#fff' : 'transparent'}
                      strokeWidth={selectedCategory === entry.name ? 2 : 0}
                    />
                  ))}
                </Pie>
                <Tooltip content={<PieTip />} />
                <Legend
                  wrapperStyle={{ fontSize: 11, color: '#7c82a0', paddingTop: 14, cursor: 'pointer' }}
                  onClick={(d) => toggleCategory(d.value)}
                  formatter={(value) => (
                    <span style={{ color: selectedCategory === value ? 'var(--text)' : 'var(--muted)', fontWeight: selectedCategory === value ? 700 : 400 }}>
                      {value}
                    </span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Preflop range grid (independent card now — used to share a toggle with the pie) */}
        {hasRange && (
          <div className="chart-card">
            <h3 style={{ margin: '0 0 8px' }}>Preflop Range Grid</h3>
            <RangeGrid rangeHands={p.rangeHands || []} />
          </div>
        )}
      </div>

      {/* In simple mode, show a prompt to switch to detailed mode */}
      {!detailMode && (
        <div className="simple-mode-prompt" onClick={() => setDetailMode(true)}>
          <span className="smp-icon">🔍</span>
          <span className="smp-text">Open <strong>Detailed Mode</strong> for full hand history, key hands, coaching report, and more</span>
          <span className="smp-arrow">→</span>
        </div>
      )}

      {/* ── Coaching report (shown for every player; depth scales with how many
           hole cards we know — full for the viewer, showdowns-only for others) ── */}
      {detailMode && <CoachingReport player={p} isMerged={isMerged} isViewer={isViewer} handActionLogs={handActionLogs} />}

      {/* ── Everything below is detailed mode only ─────────────────────────── */}
      {detailMode && <>

      {/* ── Advanced stats (positions, showdown funnel, 3bet/cbet, H2H) ───────── */}
      <AdvancedStats player={p} isMerged={isMerged} getLog={getActionLog} onReplay={openReplay} />

      {/* ── Category drill-down ───────────────────────────────────────────────── */}
      {selectedCategory && (
        <div className="category-drilldown">
          <div className="cd-header">
            <span className="cd-title">{selectedCategory}</span>
            <span className="cd-count">{categoryHands.length} hand{categoryHands.length !== 1 ? 's' : ''}</span>
            <button className="cd-close" onClick={() => setSelectedCategory(null)}>✕ Clear</button>
          </div>
          {categoryHands.length === 0 ? (
            <p style={{ color: 'var(--muted)', padding: '12px 0', fontSize: '0.85rem' }}>No hand history available for this category.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="hand-table">
                <thead>
                  <tr><th>Hand #</th>{isMerged && <th>Session</th>}<th>Cards</th><th>Result</th><th>Board</th><th>Pot</th></tr>
                </thead>
                <tbody>
                  {[...categoryHands].reverse().map(h => (
                    <tr key={h.num} className={h.won ? 'won' : ''}>
                      <td>#{h.num}</td>
                      {isMerged && <td style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>{fmtDate(h.sessionDate)}</td>}
                      <td><CardBadge card={h.c1} /><CardBadge card={h.c2} /></td>
                      <td>
                        {h.isCooler
                          ? <span className="result-badge cooler">⚔️ Cooler</span>
                          : h.isBadBeat
                            ? <span className="result-badge bad-beat">💔 Bad Beat</span>
                            : h.isSuckOut
                              ? <span className="result-badge suck-out">🎲 Suck-Out</span>
                              : h.isSplit
                                ? <span className="result-badge split">🤝 Split</span>
                              : h.won
                                ? <span className="result-badge win">✓ Won</span>
                                : h.wasShown
                                  ? <span className="result-badge loss">✗ Lost</span>
                                  : <span className="result-badge fold">Folded</span>}
                      </td>
                      <td><BoardCards board={h.board} /></td>
                      <td style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
                        {h.potSize > 0 ? h.potSize.toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Biggest Pots Won ────────────────────────────────────────────────── */}
      {biggestWins.length > 0 && (
        <>
          <div className="section-title" style={{ fontSize: '0.9rem', marginTop: 20 }}>
            💰 Biggest Pots Won
            <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '0.78rem', marginLeft: 8 }}>
              — top {biggestWins.length} by chips won
            </span>
          </div>
          <div className="big-pot-list">
            {biggestWins.map((h, i) => {
              const key = `win-${i}`;
              return (
                <BigPotCard
                  key={key} kind="win" rank={i + 1} h={h} isMerged={isMerged}
                  amountNode={<span className="bp-amount pos">Won {(h.wonAmount ?? h.potSize).toLocaleString()}</span>}
                  expanded={expandedKeyHand === key} onToggle={() => toggleKeyHand(key)} log={getActionLog(h)} onReplay={() => openReplay(h)}
                />
              );
            })}
          </div>
        </>
      )}

      {/* ── Biggest Pots Split ───────────────────────────────────────────────── */}
      {biggestSplits.length > 0 && (
        <>
          <div className="section-title" style={{ fontSize: '0.9rem', marginTop: 16 }}>
            🤝 Biggest Pots Split
            <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '0.78rem', marginLeft: 8 }}>
              — top {biggestSplits.length} by chips taken home
            </span>
          </div>
          <div className="big-pot-list">
            {biggestSplits.map((h, i) => {
              const key = `split-${i}`;
              return (
                <BigPotCard
                  key={key} kind="split" rank={i + 1} h={h} isMerged={isMerged}
                  amountNode={<span className="bp-amount split">Took {(h.wonAmount ?? h.potSize).toLocaleString()} <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '0.74rem' }}>of {h.potSize.toLocaleString()}</span></span>}
                  extraDetails={h.splitWith?.length > 0 && <span style={{ color: 'var(--muted)', fontSize: '0.72rem', marginLeft: 8 }}>split with {h.splitWith.join(', ')}</span>}
                  expanded={expandedKeyHand === key} onToggle={() => toggleKeyHand(key)} log={getActionLog(h)} onReplay={() => openReplay(h)}
                />
              );
            })}
          </div>
        </>
      )}

      {/* ── Biggest Pots Lost ────────────────────────────────────────────────── */}
      {biggestLosses.length > 0 && (
        <>
          <div className="section-title" style={{ fontSize: '0.9rem', marginTop: 16 }}>
            📉 Biggest Pots Lost
            <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '0.78rem', marginLeft: 8 }}>
              — top {biggestLosses.length} showdown losses by pot size
            </span>
          </div>
          <div className="big-pot-list">
            {biggestLosses.map((h, i) => {
              const key = `loss-${i}`;
              return (
                <BigPotCard
                  key={key} kind="loss" rank={i + 1} h={h} isMerged={isMerged}
                  amountNode={<span className="bp-amount neg">Lost {h.potSize.toLocaleString()}</span>}
                  extraDetails={h.winnerHandName && <span style={{ color: 'var(--muted)', fontSize: '0.72rem', marginLeft: 4 }}>vs {h.winnerHandName}</span>}
                  expanded={expandedKeyHand === key} onToggle={() => toggleKeyHand(key)} log={getActionLog(h)} onReplay={() => openReplay(h)}
                />
              );
            })}
          </div>
        </>
      )}

      {/* ── Premium Showdowns ────────────────────────────────────────────────── */}
      {premiumShowdowns.length > 0 && (
        <>
          <div className="section-title" style={{ fontSize: '0.9rem', marginTop: 16 }}>
            👑 Premium Showdowns
            <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '0.78rem', marginLeft: 8 }}>
              — AA/KK/QQ/AKs at showdown
            </span>
          </div>
          <div className="premium-summary">
            {Object.entries(premiumRecord).map(([lbl, rec]) => (
              <span key={lbl} className="premium-tag">
                {lbl}: <span className="pos">{rec.wins}W</span>–<span className="neg">{rec.losses}L</span>
              </span>
            ))}
          </div>
          <div className="big-pot-list">
            {premiumShowdowns.map((h, i) => {
              const key = `premium-${i}`;
              return (
                <BigPotCard
                  key={key} kind={h.won ? 'win' : 'loss'} rank={null} h={h} isMerged={isMerged}
                  amountNode={<span className={`bp-amount ${h.won ? 'pos' : 'neg'}`}>{h.won ? `Won ${(h.wonAmount ?? h.potSize).toLocaleString()}` : `Lost ${h.potSize.toLocaleString()}`}</span>}
                  expanded={expandedKeyHand === key} onToggle={() => toggleKeyHand(key)} log={getActionLog(h)} onReplay={() => openReplay(h)}
                />
              );
            })}
          </div>
        </>
      )}

      {/* ── Suck-Outs ────────────────────────────────────────────────────────── */}
      <div className="section-title" style={{ fontSize: '0.9rem', marginTop: 20 }}>
        🎲 Suck-Outs
        {suckOuts.length > 0 && (
          <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '0.78rem', marginLeft: 8 }}>
            — hands where you came from behind to win, sorted by what you beat
          </span>
        )}
      </div>

      {suckOuts.length === 0 ? (
        <div className="bad-beat-empty suck-out-empty">{suckOutEmpty}</div>
      ) : (
        <div className="bad-beat-list">
          {suckOuts.map((so, i) => {
            const key = `suckout-${i}`;
            const expanded = expandedKeyHand === key;
            return (
            <div
              key={key}
              className={`bad-beat-card suck-out-card${expanded ? ' expanded' : ''}`}
              onClick={() => toggleKeyHand(key)}
              role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleKeyHand(key); } }}
            >
              <div className="bb-header">
                <span className="bb-num">Hand #{so.num}{isMerged && so.sessionDate && <span style={{ color: 'var(--muted)', fontSize: '0.72rem', marginLeft: 6 }}>({fmtDate(so.sessionDate)})</span>}</span>
                <span className="bb-severity">{SO_SEVERITY[so.oppHandRank] || ''}</span>
                <span className="bb-pot pos">Won {(so.wonAmount ?? so.potSize).toLocaleString()}</span>
                <span className="bp-chevron">{expanded ? '▾' : '▸'}</span>
              </div>
              <div className="bb-body">
                <div className="bb-side">
                  <div className="bb-label">Your Hand</div>
                  <div className="bb-cards"><CardBadge card={so.c1} /><CardBadge card={so.c2} /></div>
                  <div className="bb-hand-name" style={{ color: 'var(--win)' }}>{so.myHandName}</div>
                </div>
                <div className="bb-vs" style={{ borderColor: 'rgba(0,212,170,0.3)', color: 'var(--accent2)' }}>BEAT</div>
                <div className="bb-side">
                  <div className="bb-label">{so.oppName}</div>
                  <div className="bb-cards"><CardBadge card={so.oppC1} /><CardBadge card={so.oppC2} /></div>
                  <div className="bb-hand-name" style={{ color: 'var(--muted)' }}>{so.oppHandName}</div>
                </div>
              </div>
              {so.board?.length > 0 && (
                <div className="bb-board">
                  <span className="bb-board-label">Board: </span>
                  <BoardCards board={so.board} />
                </div>
              )}
              {expanded && (
                <div style={{marginTop:10}} onClick={(e) => e.stopPropagation()}>
                  <div style={{fontSize:'0.7rem',fontWeight:700,textTransform:'uppercase',color:'var(--muted)',marginBottom:4,display:'flex',alignItems:'center',gap:8}}>
                    Play by Play
                    {getActionLog(so).length > 0 && <button className="replay-btn" onClick={() => openReplay(so)}>▶ Replay</button>}
                  </div>
                  <ActionLog log={getActionLog(so)}/>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {/* ── Bad Beats ─────────────────────────────────────────────────────────── */}
      <div className="section-title" style={{ fontSize: '0.9rem', marginTop: 16 }}>
        💔 Bad Beats
        {badBeats.length > 0 && (
          <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '0.78rem', marginLeft: 8 }}>
            — showdown losses with Two Pair or better, sorted worst to least
          </span>
        )}
      </div>

      {badBeats.length === 0 ? (
        <div className="bad-beat-empty">{ominousMsg}</div>
      ) : (
        <div className="bad-beat-list">
          {badBeats.map((bb, i) => {
            const key = `badbeat-${i}`;
            const expanded = expandedKeyHand === key;
            return (
            <div
              key={key}
              className={`bad-beat-card${expanded ? ' expanded' : ''}`}
              onClick={() => toggleKeyHand(key)}
              role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleKeyHand(key); } }}
            >
              <div className="bb-header">
                <span className="bb-num">Hand #{bb.num}{isMerged && bb.sessionDate && <span style={{ color: 'var(--muted)', fontSize: '0.72rem', marginLeft: 6 }}>({fmtDate(bb.sessionDate)})</span>}</span>
                <span className="bb-severity">{BB_SEVERITY[bb.myHandRank] || ''}</span>
                <span className="bb-pot neg">Lost {bb.potSize.toLocaleString()}</span>
                <span className="bp-chevron">{expanded ? '▾' : '▸'}</span>
              </div>
              <div className="bb-body">
                <div className="bb-side">
                  <div className="bb-label">Your Hand</div>
                  <div className="bb-cards"><CardBadge card={bb.c1} /><CardBadge card={bb.c2} /></div>
                  <div className="bb-hand-name">{bb.myHandName}</div>
                </div>
                <div className="bb-vs">BEAT BY</div>
                <div className="bb-side">
                  <div className="bb-label">{bb.oppName}</div>
                  <div className="bb-cards"><CardBadge card={bb.oppC1} /><CardBadge card={bb.oppC2} /></div>
                  <div className="bb-hand-name">{bb.oppHandName}</div>
                </div>
              </div>
              {bb.board?.length > 0 && (
                <div className="bb-board">
                  <span className="bb-board-label">Board: </span>
                  <BoardCards board={bb.board} />
                </div>
              )}
              {expanded && (
                <div style={{marginTop:10}} onClick={(e) => e.stopPropagation()}>
                  <div style={{fontSize:'0.7rem',fontWeight:700,textTransform:'uppercase',color:'var(--muted)',marginBottom:4,display:'flex',alignItems:'center',gap:8}}>
                    Play by Play
                    {getActionLog(bb).length > 0 && <button className="replay-btn" onClick={() => openReplay(bb)}>▶ Replay</button>}
                  </div>
                  <ActionLog log={getActionLog(bb)}/>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {/* ── Coolers ──────────────────────────────────────────────────────────── */}
      <div className="section-title" style={{ fontSize: '0.9rem', marginTop: 16 }}>
        ⚔️ Coolers
        {coolers.length > 0 && (
          <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '0.78rem', marginLeft: 8 }}>
            — both players had strong hands, sorted by combined strength
          </span>
        )}
      </div>

      {coolers.length === 0 ? (
        <div className="bad-beat-empty" style={{ borderColor: 'rgba(108,99,255,0.15)' }}>No coolers detected. No unavoidable collisions yet.</div>
      ) : (
        <div className="bad-beat-list">
          {coolers.map((c, i) => {
            const key = `cooler-${i}`;
            const expanded = expandedKeyHand === key;
            return (
            <div
              key={key}
              className={`bad-beat-card cooler-card${expanded ? ' expanded' : ''}`}
              onClick={() => toggleKeyHand(key)}
              role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleKeyHand(key); } }}
            >
              <div className="bb-header">
                <span className="bb-num">Hand #{c.num}{isMerged && c.sessionDate && <span style={{ color: 'var(--muted)', fontSize: '0.72rem', marginLeft: 6 }}>({fmtDate(c.sessionDate)})</span>}</span>
                <span className="bb-severity">{CL_SEVERITY[Math.min(c.myHandRank, c.oppHandRank)] || ''}</span>
                <span className={`bb-pot ${c.won ? 'pos' : 'neg'}`}>
                  {c.won ? `Won ${c.potSize.toLocaleString()}` : `Lost ${c.potSize.toLocaleString()}`}
                </span>
                <span className="bp-chevron">{expanded ? '▾' : '▸'}</span>
              </div>
              <div className="bb-body">
                <div className="bb-side">
                  <div className="bb-label">Your Hand</div>
                  <div className="bb-cards"><CardBadge card={c.c1} /><CardBadge card={c.c2} /></div>
                  <div className="bb-hand-name" style={{ color: c.won ? 'var(--win)' : 'var(--lose)' }}>{c.myHandName}</div>
                </div>
                <div className="bb-vs" style={{ borderColor: 'rgba(108,99,255,0.3)', color: 'var(--accent)' }}>
                  {c.won ? 'BEAT' : 'LOST TO'}
                </div>
                <div className="bb-side">
                  <div className="bb-label">{c.oppName}</div>
                  <div className="bb-cards"><CardBadge card={c.oppC1} /><CardBadge card={c.oppC2} /></div>
                  <div className="bb-hand-name" style={{ color: 'var(--muted)' }}>{c.oppHandName}</div>
                </div>
              </div>
              {c.board?.length > 0 && (
                <div className="bb-board">
                  <span className="bb-board-label">Board: </span>
                  <BoardCards board={c.board} />
                </div>
              )}
              {expanded && (
                <div style={{marginTop:10}} onClick={(e) => e.stopPropagation()}>
                  <div style={{fontSize:'0.7rem',fontWeight:700,textTransform:'uppercase',color:'var(--muted)',marginBottom:4,display:'flex',alignItems:'center',gap:8}}>
                    Play by Play
                    {getActionLog(c).length > 0 && <button className="replay-btn" onClick={() => openReplay(c)}>▶ Replay</button>}
                  </div>
                  <ActionLog log={getActionLog(c)}/>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {/* ── Hand History ──────────────────────────────────────────────────────── */}
      <div className="section-title" style={{ fontSize: '0.9rem', marginTop: 16 }}>Hand History</div>

      {/* Search bar */}
      <div className="search-row">
        <input
          className="search-input"
          type="text"
          placeholder="Search hands…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        <select className="search-col-select" value={searchCol} onChange={e => setSearchCol(e.target.value)}>
          <option value="all">All columns</option>
          <option value="hand">Hand #</option>
          <option value="cards">Cards</option>
          <option value="type">Type</option>
          {isMerged && <option value="session">Session</option>}
          <option value="result">Result</option>
          <option value="pot">Pot</option>
          <option value="strength">Hand Strength</option>
        </select>
      </div>

      <div className="hand-filters">
        {FILTERS.map(f => (
          <button key={f.key} className={`filter-btn ${handFilter === f.key ? 'active' : ''}`}
            onClick={() => setHandFilter(f.key)}>
            {f.label} <span className="filter-count">({filterCount(f.key)})</span>
          </button>
        ))}
      </div>

      {handsHistory.length === 0 ? (
        <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '24px 0', fontSize: '0.85rem' }}>
          No hand history available — re-upload the session to populate this section.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="hand-table">
            <thead>
              <tr>
                <SortTh col="hand" sortCol={sortCol} sortDir={sortDir} onSort={handleSortClick}>Hand #</SortTh>
                {isMerged && <SortTh col="session" sortCol={sortCol} sortDir={sortDir} onSort={handleSortClick}>Session</SortTh>}
                <SortTh col="cards" sortCol={sortCol} sortDir={sortDir} onSort={handleSortClick}>Cards</SortTh>
                <SortTh col="type" sortCol={sortCol} sortDir={sortDir} onSort={handleSortClick}>Type</SortTh>
                <SortTh col="result" sortCol={sortCol} sortDir={sortDir} onSort={handleSortClick}>Result</SortTh>
                <SortTh col="strength" sortCol={sortCol} sortDir={sortDir} onSort={handleSortClick}>Hand Strength</SortTh>
                <SortTh col="pot" sortCol={sortCol} sortDir={sortDir} onSort={handleSortClick}>Pot</SortTh>
                <th style={{ width: 24 }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredHands.flatMap(h => {
                const rowKey = h.sessionId ? `${h.sessionId}-${h.num}` : String(h.num);
                const isExp = expandedHand === rowKey;
                const hasCards = h.c1 && h.c2;
                const rows = [
                  <tr key={rowKey}
                    className={`hand-row ${h.isCooler ? 'cooler-row' : h.isBadBeat ? 'bad-beat-row' : ''} ${h.isSuckOut && !h.isBadBeat && !h.isCooler ? 'suck-out-row' : ''} ${h.won && !h.isBadBeat && !h.isSuckOut && !h.isCooler ? 'won' : ''}`}
                    onClick={() => setExpandedHand(isExp ? null : rowKey)}
                    style={{ cursor: 'pointer' }}>
                    <td>#{h.num}</td>
                    {isMerged && <td style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>{fmtDate(h.sessionDate)}</td>}
                    <td>
                      {hasCards
                        ? <><CardBadge card={h.c1} /><CardBadge card={h.c2} /></>
                        : <span className="mucked-cards">?? ??</span>}
                    </td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                      {hasCards ? categoryLabel(h.c1, h.c2) : '—'}
                    </td>
                    <td>
                      {h.isCooler
                        ? <span className="result-badge cooler">⚔️ Cooler</span>
                        : h.isBadBeat
                          ? <span className="result-badge bad-beat">💔 Bad Beat</span>
                          : h.isSuckOut
                            ? <span className="result-badge suck-out">🎲 Suck-Out</span>
                            : h.isSplit
                              ? <span className="result-badge split">🤝 Split</span>
                            : h.won
                              ? <span className="result-badge win">✓ Won</span>
                              : h.wasShown
                                ? <span className="result-badge loss">✗ Lost</span>
                                : <span className="result-badge fold">Folded</span>}
                    </td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                      {computeHandStrength(h)?.name ?? '—'}
                    </td>
                    <td style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
                      {h.potSize > 0 ? h.potSize.toLocaleString() : '—'}
                    </td>
                    <td style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{isExp ? '▲' : '▼'}</td>
                  </tr>,
                ];

                if (isExp) {
                  rows.push(
                    <tr key={`${rowKey}-exp`} className="hand-expanded-row">
                      <td colSpan={6 + (isMerged ? 1 : 0) + 1} style={{ padding: 0 }}>
                        <div className="hand-detail-panel">
                          {h.board?.length > 0 && (
                            <div className="hd-row">
                              <span className="hd-label">Board</span>
                              <div className="hd-cards">
                                <BoardCards board={h.board} />
                              </div>
                            </div>
                          )}
                          {h.opponents?.length > 0 && (
                            <div className="hd-row">
                              <span className="hd-label">Shown</span>
                              <div className="hd-opponents">
                                {h.opponents.map((opp, i) => (
                                  <span key={i} className="hd-opp">
                                    <span style={{ color: 'var(--muted)', marginRight: 4 }}>{opp.name}:</span>
                                    {opp.c1 ? <CardBadge card={opp.c1} /> : <span className="mucked-cards" style={{ fontSize: '0.75rem' }}>??</span>}
                                    {opp.c2 ? <CardBadge card={opp.c2} /> : <span className="mucked-cards" style={{ fontSize: '0.75rem' }}>??</span>}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="hd-row">
                            <span className="hd-label">Result</span>
                            <span className={h.isSplit ? 'split-text' : h.won ? 'pos' : 'neg'}>
                              {h.isSplit
                                ? <>Split pot{h.wonAmount != null ? <strong> +{h.wonAmount.toLocaleString()}</strong> : ''} chips{h.splitWith?.length > 0 && <span style={{ color: 'var(--muted)', marginLeft: 6 }}>with {h.splitWith.join(', ')}</span>}{h.myHandName && <span style={{ color: 'var(--muted)', marginLeft: 6 }}>({h.myHandName})</span>}</>
                                : h.won
                                ? <>Won{h.wonAmount != null ? <strong> +{h.wonAmount.toLocaleString()}</strong> : ''} chips{h.myHandName && <span style={{ color: 'var(--muted)', marginLeft: 6 }}>with {h.myHandName}</span>}</>
                                : h.wasShown
                                  ? <>Lost at showdown{h.winnerHandName && <span style={{ color: 'var(--muted)', marginLeft: 6 }}>to {h.winnerHandName}</span>}{h.myHandName && <span style={{ color: 'var(--muted)', marginLeft: 6 }}>(your hand: {h.myHandName})</span>}</>
                                  : 'Folded'}
                            </span>
                          </div>
                          {detailMode && (h.dealer || h.sb || h.bb) && (
                            <div className="hd-row">
                              <span className="hd-label">Roles</span>
                              <span style={{fontSize:'0.8rem'}}>
                                {h.dealer && <><>D: </><strong>{h.dealer}</strong>&nbsp;&nbsp;</>}
                                {h.sb && <><>SB: </><strong>{h.sb}</strong>&nbsp;&nbsp;</>}
                                {h.bb && <><>BB: </><strong>{h.bb}</strong></>}
                              </span>
                            </div>
                          )}
                          {detailMode && getActionLog(h).length > 0 && (
                            <div className="hd-row" style={{flexDirection:'column',gap:4}}>
                              <span className="hd-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                Play by Play
                                <button className="replay-btn" onClick={(e) => { e.stopPropagation(); openReplay(h); }}>▶ Replay</button>
                              </span>
                              <ActionLog log={getActionLog(h)}/>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                }
                return rows;
              })}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ color: 'var(--muted)', fontSize: '0.75rem', marginTop: 16 }}>
        † Luckiness = % of observed hands that were premium (AA/KK/QQ/JJ/AK).
        VPIP/PFR/Fold% from preflop actions. AF = (Bets+Raises)/Calls post-flop.
        Bad beats = showdown losses with Two Pair or better. Suck-outs = the inverse.
      </p>

      </>}

      {replay && <HandReplayer log={replay.log} hand={replay.hand} heroName={replay.heroName} heroCards={replay.heroCards} onClose={() => setReplay(null)} />}
    </div>
  );
}

import { fmtDate } from '../format.js';

// Shared presentational pieces for rendering cards, boards, and hand action
// logs — used by PlayerDetail, HandReplayer, AdvancedStats, and the key-hand
// cards. Keep this file components-only (react-refresh constraint); plain
// string helpers live in ../format.js.

const SUIT_SYMBOL = { s: '♠', h: '♥', d: '♦', c: '♣', '?': '?' };

export function CardBadge({ card }) {
  if (!card) return null;
  return (
    <span className={`card-badge ${card.suit}`}>
      {card.rank}{SUIT_SYMBOL[card.suit] || card.suit}
    </span>
  );
}

// Board cards with flop | turn | river separators.
export function BoardCards({ board }) {
  if (!board?.length) return <span style={{ color: 'var(--muted)' }}>—</span>;
  return (
    <div className="board-cards">
      {board.slice(0, 3).map((c, i) => <CardBadge key={i} card={c} />)}
      {board.length > 3 && <><span className="board-sep">|</span><CardBadge card={board[3]} /></>}
      {board.length > 4 && <><span className="board-sep">|</span><CardBadge card={board[4]} /></>}
    </div>
  );
}

const ACT_TEXT = {
  'post-sb': a => `posts small blind ${a.amount?.toLocaleString() ?? ''}`,
  'post-bb': a => `posts big blind ${a.amount?.toLocaleString() ?? ''}`,
  'post-dead-sb': a => `posts dead small blind ${a.amount?.toLocaleString() ?? ''}`,
  'fold': () => 'folds',
  'call': a => `calls ${a.amount?.toLocaleString() ?? ''}`,
  'raise': a => `raises to ${a.amount?.toLocaleString() ?? ''}`,
  'bet': a => `bets ${a.amount?.toLocaleString() ?? ''}`,
  'check': () => 'checks',
  'show': () => 'shows hand',
  'collect': a => `collects ${a.amount?.toLocaleString() ?? ''}`,
  'return': a => `takes back uncalled bet of ${a.amount?.toLocaleString() ?? ''}`,
};

// An action's verb, expanding a "show" into "shows A♠ K♥" with the cards.
export function ActionVerb({ ev }) {
  const showCards = ev.action === 'show' && (ev.cards || []).filter(c => c && c.rank);
  if (showCards && showCards.length) {
    return <>shows {showCards.map((c, i) => <CardBadge key={i} card={c} />)}</>;
  }
  return ACT_TEXT[ev.action]?.(ev) ?? ev.action;
}

// Street-grouped play-by-play list for a hand's action log.
export function ActionLog({ log }) {
  if (!log?.length) return <p style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>No action data (re-upload to capture).</p>;
  const groups = [];
  let cur = { street: 'preflop', board: null, actions: [] };
  for (const ev of log) {
    if (ev.type === 'street') { groups.push(cur); cur = { street: ev.street, board: ev.board, actions: [] }; }
    else if (ev.type === 'action') cur.actions.push(ev);
  }
  groups.push(cur);
  return (
    <div className="action-log">
      {groups.filter(g => g.actions.length > 0).map((g, gi) => (
        <div key={gi} className="al-group">
          <div className="al-street-label">
            {g.street.toUpperCase()}
            {g.board?.length > 0 && <span className="al-board">{g.board.map((c, i) => <CardBadge key={i} card={c} />)}</span>}
          </div>
          {g.actions.map((act, ai) => (
            <div key={ai} className="al-action">
              <span className="al-player">{act.player}</span>
              <span className="al-verb"><ActionVerb ev={act} /></span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Sortable table-header cell. Module scope so the component type is stable
// across renders of whichever table uses it.
export function SortTh({ col, children, style, sortCol, sortDir, onSort }) {
  const active = sortCol === col;
  return (
    <th onClick={() => onSort(col)} className={`sortable${active ? ' sort-active' : ''}`} style={style}>
      {children} <span style={{ opacity: 0.5, fontSize: '0.7em' }}>{active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
    </th>
  );
}

// A clickable "key pot" row that expands to show the hand's play-by-play.
export function BigPotCard({ kind, rank, h, isMerged, amountNode, extraDetails, expanded, onToggle, log, onReplay }) {
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

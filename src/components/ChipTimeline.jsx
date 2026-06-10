import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { fmtDate } from '../format.js';

// Chronological ordering: session date, then session id (keeps two same-day
// sessions from interleaving), then hand number.
function chrono(a, b) {
  return ((a.sessionDate || '').localeCompare(b.sessionDate || '')) ||
    String(a.sessionId ?? '').localeCompare(String(b.sessionId ?? '')) ||
    (a.num - b.num);
}

// Builds a chronological series of the player's chips.
//   mode 'stack': the table stack entering each hand, which resets to 0 between
//     sessions — every session reads as its own segment.
//   mode 'net': cumulative profit carried across sessions. Uses the exact
//     per-hand `net` recorded by the analyser (v10+, rebuy-proof); for older
//     data without it, falls back to stack deltas against a per-session
//     baseline (which mid-session rebuys can distort).
function buildChipTimeline(handsHistory, mode) {
  if (mode === 'net') {
    const all = handsHistory.slice().sort(chrono);
    if (all.length && all.every(h => h.net != null)) {
      let total = 0;
      return all.map((h, idx) => {
        total += h.net;
        return { i: idx, value: total, kind: 'net', hand: h.num, sessionDate: h.sessionDate };
      });
    }
  }

  const hands = handsHistory.filter(h => h.stack != null).slice().sort(chrono);
  if (!hands.length) return [];

  const points = [];
  let i = 0;

  if (mode === 'net') {
    // Legacy fallback: stack − first stack seen that session, carried forward.
    let prevSession = null;
    let carried = 0;
    let baseline = 0;
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

export default function ChipTimeline({ handsHistory, isViewer = false }) {
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

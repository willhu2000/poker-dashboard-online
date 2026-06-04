import { useCallback, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid,
} from 'recharts';
import { resolveAlias, resolveDisplayName } from '../playerConfig.js';
import { PLAYER_COLORS } from '../colors.js';

const SMALL_SAMPLE_THRESHOLD = 20; // hands dealt per session below which a marker is "noisy"

const METRICS = [
  { key: 'vpip',     label: 'VPIP %',   domain: [0, 100], improveDir: 'down', why: 'Lower VPIP = tighter range. Most casual players bleed chips by playing too many hands.' },
  { key: 'pfr',      label: 'PFR %',    domain: [0, 100], improveDir: 'up',   why: 'Higher PFR (within VPIP) = more aggressive entries. Limping is generally weaker than raising.' },
  { key: 'af',       label: 'AF',       domain: [0, 'auto'], improveDir: 'up', why: 'Higher AF = more bets/raises vs calls postflop. Aggression wins pots without showdown.' },
  { key: 'winRate',  label: 'Win %',    domain: [0, 'auto'], improveDir: 'up', why: '% of dealt hands you collected the pot.' },
  { key: 'netChips', label: 'Net Chips', domain: ['auto', 'auto'], improveDir: 'up', why: 'Bottom line per session.' },
];

function fmtDate(iso) {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  return `${m}-${d}`;
}

function delta(first, last) {
  if (first == null || last == null) return null;
  return +(last - first).toFixed(2);
}

function arrow(delta, dir) {
  if (delta == null || delta === 0) return { sym: '→', color: 'var(--muted)' };
  const improving = (dir === 'up' && delta > 0) || (dir === 'down' && delta < 0);
  return improving
    ? { sym: delta > 0 ? '↑' : '↓', color: 'var(--win)' }
    : { sym: delta > 0 ? '↑' : '↓', color: 'var(--lose)' };
}

const Tip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  // Order players highest → lowest at this point (null/missing values sink to
  // the bottom) so the tooltip ranks them by their value at the hovered point.
  const rows = [...payload].sort((a, b) => {
    const av = a.value, bv = b.value;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });
  return (
    <div className="custom-tooltip">
      <div className="label">{label}</div>
      {rows.map(p => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.dataKey}: {p.value == null ? '—' : (typeof p.value === 'number' ? p.value.toFixed(p.value % 1 === 0 ? 0 : 1) : p.value)}
        </div>
      ))}
    </div>
  );
};

export default function TrendsView({ sessions, onBack, playerConfig }) {
  // Resolve a raw CSV name → display name (alias then rename). Memoised so it has
  // a stable identity across renders (only changes with playerConfig), letting the
  // memos below depend on it directly.
  const displayName = useCallback((raw) => {
    const canonical = resolveAlias(raw, playerConfig);
    return resolveDisplayName(canonical, playerConfig);
  }, [playerConfig]);

  // Sessions come newest-first from loadSessions(); sort ascending by gameDate.
  const orderedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const da = a.gameDate || a.uploadedAt;
      const db = b.gameDate || b.uploadedAt;
      return da.localeCompare(db);
    });
  }, [sessions]);

  // Aggregate hands-played per player across all sessions (using display names).
  const allPlayers = useMemo(() => {
    const totals = {};
    for (const s of orderedSessions) {
      for (const [rawName, sp] of Object.entries(s.stats?.players || {})) {
        const name = displayName(rawName);
        totals[name] = (totals[name] || 0) + (sp.handsDealt || 0);
      }
    }
    return Object.entries(totals)
      .map(([name, hands]) => ({ name, hands }))
      .sort((a, b) => b.hands - a.hands);
  }, [orderedSessions, displayName]);

  const [selected, setSelected] = useState(() => allPlayers.map(p => p.name));

  const togglePlayer = (name) => {
    setSelected(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  };

  // Build the per-session × per-metric series.
  // Result: rows[i] = { date, [displayName]: number, [`${name}__small`]: bool }
  const seriesByMetric = useMemo(() => {
    const out = {};
    for (const m of METRICS) {
      out[m.key] = orderedSessions.map(s => {
        const row = { date: fmtDate(s.gameDate), _date: s.gameDate };
        // Build a display-name → stats lookup for this session
        const byDisplay = {};
        for (const [rawName, sp] of Object.entries(s.stats?.players || {})) {
          const dn = displayName(rawName);
          // If multiple raw names map to the same display name, merge accumulators
          if (!byDisplay[dn]) byDisplay[dn] = { ...sp };
          else {
            byDisplay[dn].handsDealt = (byDisplay[dn].handsDealt || 0) + (sp.handsDealt || 0);
            byDisplay[dn][m.key] = sp[m.key] ?? byDisplay[dn][m.key];
          }
        }
        for (const name of selected) {
          const sp = byDisplay[name];
          if (!sp || (sp.handsDealt || 0) === 0) {
            row[name] = null;
          } else {
            row[name] = sp[m.key] ?? null;
            if ((sp.handsDealt || 0) < SMALL_SAMPLE_THRESHOLD) row[`${name}__small`] = true;
          }
        }
        return row;
      });
    }
    return out;
  }, [orderedSessions, selected, displayName]);

  // Running cumulative net chips per player across sessions.
  const cumulativeData = useMemo(() => {
    const running = {};
    for (const name of allPlayers.map(p => p.name)) running[name] = 0;
    return orderedSessions.map(s => {
      const row = { date: fmtDate(s.gameDate) };
      const byDisplay = {};
      for (const [rawName, sp] of Object.entries(s.stats?.players || {})) {
        const dn = displayName(rawName);
        byDisplay[dn] = (byDisplay[dn] ?? 0) + (sp.netChips ?? 0);
      }
      for (const name of selected) {
        if (byDisplay[name] != null) running[name] = (running[name] || 0) + byDisplay[name];
        row[name] = running[name] ?? 0;
      }
      return row;
    });
  }, [orderedSessions, selected, displayName, allPlayers]);

  // First→last delta per (player, metric), skipping sessions where the player wasn't dealt in.
  const movement = useMemo(() => {
    const rows = [];
    for (const name of selected) {
      const valuesByMetric = {};
      for (const m of METRICS) valuesByMetric[m.key] = [];
      for (const s of orderedSessions) {
        // Find this display-named player in the session's raw data
        const sp = Object.entries(s.stats?.players || {}).find(([raw]) => displayName(raw) === name)?.[1];
        if (!sp || (sp.handsDealt || 0) === 0) continue;
        for (const m of METRICS) {
          const v = sp[m.key];
          if (v != null && !Number.isNaN(v)) valuesByMetric[m.key].push(v);
        }
      }
      const deltas = {};
      let sessionsPlayed = 0;
      for (const m of METRICS) {
        const arr = valuesByMetric[m.key];
        deltas[m.key] = arr.length >= 2 ? delta(arr[0], arr[arr.length - 1]) : null;
        sessionsPlayed = Math.max(sessionsPlayed, arr.length);
      }
      rows.push({ name, sessionsPlayed, deltas });
    }
    return rows;
  }, [orderedSessions, selected, displayName]);

  if (orderedSessions.length < 2) {
    return (
      <div>
        <button className="btn btn-ghost" style={{ marginBottom: 16 }} onClick={onBack}>← Sessions</button>
        <h1>📈 Trends</h1>
        <p style={{ color: 'var(--muted)', marginTop: 14 }}>
          You need at least 2 saved sessions to see trends. Upload another CSV to start tracking improvement.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="dashboard-header">
        <div>
          <button className="btn btn-ghost" style={{ marginBottom: 8, fontSize: '0.82rem', padding: '6px 14px' }} onClick={onBack}>
            ← Sessions
          </button>
          <h1>📈 Trends Over Time</h1>
          <div className="meta">
            {orderedSessions.length} sessions · {selected.length} player{selected.length !== 1 ? 's' : ''} selected
          </div>
        </div>
      </div>

      <div className="trends-picker">
        <div className="trends-picker-label">Compare players:</div>
        <div className="trends-picker-chips">
          {allPlayers.map((p) => {
            const isSel = selected.includes(p.name);
            const color = PLAYER_COLORS[allPlayers.findIndex(x => x.name === p.name) % PLAYER_COLORS.length];
            return (
              <button
                key={p.name}
                className={`trend-chip ${isSel ? 'active' : ''}`}
                onClick={() => togglePlayer(p.name)}
                style={isSel ? { borderColor: color, background: `${color}22` } : {}}
              >
                <span className="trend-chip-dot" style={{ background: isSel ? color : 'transparent', borderColor: color }} />
                {p.name} <span style={{ color: 'var(--muted)', marginLeft: 6 }}>· {p.hands}h</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="charts-grid">
        {METRICS.map(m => (
          <div key={m.key} className="chart-card">
            <h3 style={{ margin: '0 0 4px' }}>{m.label}</h3>
            <p style={{ color: 'var(--muted)', fontSize: '0.72rem', marginBottom: 8 }}>{m.why}</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={seriesByMetric[m.key]} margin={{ top: 6, right: 12, left: -10, bottom: 6 }}>
                <CartesianGrid stroke="#2e3350" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#7c82a0', fontSize: 11 }} />
                <YAxis tick={{ fill: '#7c82a0', fontSize: 11 }} domain={m.domain} />
                <Tooltip content={<Tip />} />
                {m.key === 'netChips' && <ReferenceLine y={0} stroke="#3a3f5c" strokeDasharray="4 4" />}
                {selected.map((name) => {
                  const idx = allPlayers.findIndex(x => x.name === name);
                  const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
                  return (
                    <Line
                      key={name}
                      type="monotone"
                      dataKey={name}
                      stroke={color}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      connectNulls
                      isAnimationActive={false}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}

        <div className="chart-card">
          <h3 style={{ margin: '0 0 4px' }}>Cumulative Net Chips</h3>
          <p style={{ color: 'var(--muted)', fontSize: '0.72rem', marginBottom: 8 }}>
            Running total across all sessions — who&apos;s actually up overall?
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={cumulativeData} margin={{ top: 6, right: 12, left: -10, bottom: 6 }}>
              <CartesianGrid stroke="#2e3350" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#7c82a0', fontSize: 11 }} />
              <YAxis tick={{ fill: '#7c82a0', fontSize: 11 }} />
              <Tooltip content={<Tip />} />
              <ReferenceLine y={0} stroke="#3a3f5c" strokeDasharray="4 4" />
              {selected.map((name) => {
                const idx = allPlayers.findIndex(x => x.name === name);
                const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
                return (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={color}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                    isAnimationActive={false}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="chart-card" style={{ marginTop: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Movement (first session → last session)</h3>
        <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginBottom: 10 }}>
          Green = trending in the direction most players want (lower VPIP, higher PFR/AF/Win%/Net). Sessions with fewer than {SMALL_SAMPLE_THRESHOLD} hands dealt per player are noisy — read deltas with caution.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table className="hand-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Sessions</th>
                {METRICS.map(m => <th key={m.key}>Δ {m.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {movement.map(r => (
                <tr key={r.name}>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td style={{ color: 'var(--muted)' }}>{r.sessionsPlayed}</td>
                  {METRICS.map(m => {
                    const d = r.deltas[m.key];
                    if (d == null) return <td key={m.key} style={{ color: 'var(--muted)' }}>—</td>;
                    const a = arrow(d, m.improveDir);
                    return (
                      <td key={m.key} style={{ color: a.color, whiteSpace: 'nowrap' }}>
                        {a.sym} {d > 0 ? '+' : ''}{d}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

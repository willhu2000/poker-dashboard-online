import { useState, useRef, useCallback } from 'react';
import Leaderboard from './Leaderboard.jsx';
import PlayerDetail from './PlayerDetail.jsx';
import OverviewCharts from './OverviewCharts.jsx';
import { resolveCanonicalFromDisplay } from '../playerConfig.js';
import { playersToCsv, buildTextSummary, downloadFile, safeFileName } from '../exportSummary.js';

// Format a signed chip total: "+125" for wins, "-400" for losses, "0" for break-even.
// Avoids the "+-400" bug from naively prepending "+".
function formatNet(n) {
  if (n > 0) return `+${n}`;
  return `${n}`;
}

// Deterministic avatar color from the player name so the same player keeps the
// same swatch across renders (and across different cards on the same page).
const AVATAR_PALETTE = ['#6c63ff', '#00d4aa', '#ffd166', '#ff6b6b', '#a29bfe', '#74b9ff', '#fdcb6e', '#e17055'];
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}
function avatarInitials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
function HeroCard({ kind, label, player, valueText, sub }) {
  if (!player) {
    return (
      <div className={`hero-card ${kind}`}>
        <div className="hero-body">
          <div className="hero-label">{label}</div>
          <div className="hero-name">—</div>
        </div>
      </div>
    );
  }
  return (
    <div className={`hero-card ${kind}`}>
      <div className="hero-avatar" style={{ background: avatarColor(player.name) }}>
        {avatarInitials(player.name)}
      </div>
      <div className="hero-body">
        <div className="hero-label">{label}</div>
        <div className="hero-name" title={player.name}>{player.name}</div>
        <div className={`hero-value ${kind === 'win' ? 'pos' : 'neg'}`}>{valueText}</div>
        {sub && <div className="hero-sub">{sub}</div>}
      </div>
    </div>
  );
}
function MetaChip({ icon, label, value }) {
  return (
    <div className="meta-chip">
      <div className="meta-chip-icon" aria-hidden>{icon}</div>
      <div className="meta-chip-body">
        <div className="meta-chip-label">{label}</div>
        <div className="meta-chip-value" title={value}>{value}</div>
      </div>
    </div>
  );
}

const GLOSSARY = [
  { abbr: 'VPIP', full: 'Voluntarily Put $ In Pot', desc: '% of hands where a player called or raised preflop. Blinds excluded. High = loose range.' },
  { abbr: 'PFR', full: 'Preflop Raise %', desc: '% of hands with a preflop raise. Always ≤ VPIP. High = aggressive preflop player.' },
  { abbr: 'AF', full: 'Aggression Factor', desc: '(Bets + Raises) ÷ Calls post-flop. >2 = aggressive, 1–2 = balanced, <1 = passive.' },
  { abbr: 'Win%', full: 'Win Rate', desc: '% of dealt hands where the player collected the pot.' },
  { abbr: 'Fold%', full: 'Preflop Fold %', desc: '% of hands folded before seeing the flop.' },
  { abbr: 'Luck†', full: 'Luckiness Proxy', desc: '% of observed hands that were premium (AA/KK/QQ/JJ/AK). Higher = ran hot.' },
  { abbr: 'Tight', full: 'Tight (VPIP < 20%)', desc: 'Plays only strong hands, folds most hands preflop.' },
  { abbr: 'Loose', full: 'Loose (VPIP > 50%)', desc: 'Plays the majority of dealt hands preflop.' },
  { abbr: 'Semi', full: 'Semi-Loose (VPIP 20–50%)', desc: 'Plays a moderate range, in between tight and loose.' },
  { abbr: 'Passive', full: 'Passive (AF < 1)', desc: 'Prefers calling over betting/raising. Check-call tendency.' },
  { abbr: 'Agg', full: 'Aggressive (AF > 2)', desc: 'Frequently bets and raises, putting pressure on opponents.' },
  { abbr: 'Net Chips', full: 'Net Profit/Loss', desc: 'Cash-out minus total buy-ins across all sessions loaded.' },
];

function GlossaryPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="glossary-panel">
      <button className="glossary-toggle" onClick={() => setOpen(o => !o)}>
        📖 Glossary — what do these terms mean? {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="glossary-grid">
          {GLOSSARY.map(g => (
            <div key={g.abbr} className="glossary-item">
              <div className="g-abbr">{g.abbr}</div>
              <div className="g-full">{g.full}</div>
              <div className="g-desc">{g.desc}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ data, fileName, isMerged, sessionCount, selectedIds = [], allSessions = [], viewerNames = [], onBack, onViewMerged, onViewTrends, onUpdateSessions, onAddSession, playerConfig = null, onPlayerConfigChange, error }) {
  const { players, handCount } = data;
  const playerList = Object.values(players).sort((a, b) => b.netChips - a.netChips);
  const defaultPlayer = (viewerNames.length > 0 && playerList.find(p => viewerNames.includes(p.name)))?.name || playerList[0]?.name || null;
  const [selectedPlayer, setSelectedPlayer] = useState(defaultPlayer);
  const [showSelectorMenu, setShowSelectorMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const addInputRef = useRef(null);

  function handleExportCsv() {
    downloadFile(safeFileName(fileName, 'csv'), playersToCsv(playerList), 'text/csv');
  }

  async function handleCopySummary() {
    const text = buildTextSummary(playerList, fileName, handCount);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (e.g. insecure context) — fall back to a download.
      downloadFile(safeFileName(fileName, 'txt'), text, 'text/plain');
    }
  }

  const selected = players[selectedPlayer];

  // Rename a player from the deep-dive header. `displayName` is what the UI shows
  // (already alias/rename-resolved); map it back to the canonical name to set the
  // rename, then keep the current selection pointed at the new display name.
  function renamePlayer(displayName, rawNewName) {
    if (!onPlayerConfigChange) return;
    const newName = (rawNewName || '').trim();
    const canonical = resolveCanonicalFromDisplay(displayName, playerConfig);
    const renames = { ...(playerConfig?.renames || {}) };
    if (!newName || newName === canonical) delete renames[canonical];
    else renames[canonical] = newName;
    onPlayerConfigChange({ ...(playerConfig || {}), renames });
    const resultName = (!newName || newName === canonical) ? canonical : newName;
    if (selectedPlayer === displayName) setSelectedPlayer(resultName);
  }

  const handleSessionToggle = (sessionId, checked) => {
    let newIds;
    if (checked) {
      newIds = [...selectedIds, sessionId];
    } else {
      newIds = selectedIds.filter(id => id !== sessionId);
    }
    if (newIds.length > 0) {
      onUpdateSessions(newIds);
    }
  };

  const handleAddFile = useCallback((e) => {
    if (e.target.files?.length) onAddSession(e.target.files);
    e.target.value = '';
  }, [onAddSession]);

  return (
    <>
      <div className="dashboard-header">
        <div>
          <button className="btn btn-ghost" style={{ marginBottom: 8, fontSize: '0.82rem', padding: '6px 14px' }} onClick={onBack}>
            ← Sessions
          </button>
          <h1>♠ Poker Dashboard</h1>
          <div className="meta">
            {fileName} · {handCount} hands · {playerList.length} players
            {isMerged && <span className="tag" style={{ marginLeft: 10 }}>Merged</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', position: 'relative' }}>
          {isMerged && (
            <div style={{ position: 'relative' }}>
              <button className="btn btn-ghost" style={{ fontSize: '0.85rem' }} onClick={() => setShowSelectorMenu(m => !m)}>
                📋 Viewing {selectedIds.length} of {allSessions.length} ▼
              </button>
              {showSelectorMenu && (
                <div className="session-selector-menu">
                  {allSessions.map(s => (
                    <label key={s.id} style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      <input type="checkbox" checked={selectedIds.includes(s.id)} onChange={(e) => handleSessionToggle(s.id, e.target.checked)} style={{ marginRight: 8, cursor: 'pointer' }} />
                      <span style={{ fontSize: '0.85rem' }}>{s.fileName}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {!isMerged && sessionCount >= 2 && (
            <button className="btn btn-primary" style={{ fontSize: '0.85rem' }} onClick={onViewMerged}>
              ⚡ View All {sessionCount} Sessions
            </button>
          )}
          {sessionCount >= 2 && onViewTrends && (
            <button className="btn btn-ghost" style={{ fontSize: '0.85rem' }} onClick={onViewTrends}>
              📈 Trends
            </button>
          )}
          <button className="btn btn-ghost" style={{ fontSize: '0.85rem' }} onClick={() => addInputRef.current.click()}>
            + Add Session
          </button>
          <input ref={addInputRef} type="file" accept=".csv" multiple style={{ display: 'none' }} onChange={handleAddFile} />
          <button className="btn btn-ghost" style={{ fontSize: '0.85rem' }} onClick={handleExportCsv} title="Download per-player stats as CSV">
            ⬇ Export CSV
          </button>
          <button className="btn btn-ghost" style={{ fontSize: '0.85rem' }} onClick={handleCopySummary} title="Copy a text leaderboard to the clipboard">
            {copied ? '✓ Copied' : '📋 Copy Summary'}
          </button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--red)', marginBottom: 12 }}>{error}</p>}

      <GlossaryPanel />

      {/* Overview — hero cards (top/bottom finishers) + meta chips */}
      {(() => {
        const top = playerList[0]; // sorted by netChips desc
        const loser = playerList.length > 0 ? playerList[playerList.length - 1] : null;
        const mostAgg = [...playerList].sort((a, b) => b.af - a.af)[0];
        const tightest = [...playerList].filter(x => x.handsDealt >= 5).sort((a, b) => a.vpip - b.vpip)[0];
        const topIsWinner = top && top.netChips > 0;
        const heroSub = (p) => p ? `${p.handsDealt} hands · ${p.vpip}% VPIP` : null;
        return (
          <>
            <div className="hero-grid">
              <HeroCard
                kind={topIsWinner ? 'win' : 'lose'}
                label={topIsWinner ? 'Biggest Winner' : 'Top Finisher'}
                player={top}
                valueText={top ? formatNet(top.netChips) : '—'}
                sub={heroSub(top)}
              />
              <HeroCard
                kind="lose"
                label="Biggest Loser"
                player={loser}
                valueText={loser ? formatNet(loser.netChips) : '—'}
                sub={heroSub(loser)}
              />
            </div>
            <div className="meta-chip-row">
              <MetaChip icon="🃏" label="Hands Played" value={handCount} />
              <MetaChip icon="👥" label="Players" value={playerList.length} />
              <MetaChip
                icon="🔥"
                label="Most Aggressive"
                value={mostAgg ? `${mostAgg.name} · AF ${mostAgg.af}` : '—'}
              />
              <MetaChip
                icon="🛡️"
                label="Tightest Player"
                value={tightest ? `${tightest.name} · ${tightest.vpip}% VPIP` : '—'}
              />
            </div>
          </>
        );
      })()}

      {/* Overview charts */}
      <OverviewCharts players={playerList} />

      <hr className="divider" />

      {/* Player selector */}
      <div className="section-title">Player Deep Dive</div>
      <div className="player-tabs">
        {playerList.map(p => (
          <button
            key={p.name}
            className={`player-tab ${selectedPlayer === p.name ? 'active' : ''}`}
            onClick={() => setSelectedPlayer(p.name)}
          >
            {p.name}
          </button>
        ))}
      </div>

      {selected && <PlayerDetail player={selected} isMerged={isMerged} isViewer={viewerNames.includes(selected.name)} handActionLogs={data.handActionLogs || {}} onRename={onPlayerConfigChange ? (newName) => renamePlayer(selected.name, newName) : null} />}

      <hr className="divider" />

      {/* Leaderboard */}
      <div className="section-title">Leaderboard</div>
      <div className="chart-card">
        <Leaderboard players={playerList} onSelect={setSelectedPlayer} selected={selectedPlayer} />
      </div>
    </>
  );
}

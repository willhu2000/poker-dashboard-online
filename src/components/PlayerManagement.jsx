import { useState } from 'react';
import { getAllCanonicalPlayers, getAliasesFor, isViewer, isHidden, resolveDisplayName } from '../playerConfig.js';

export default function PlayerManagement({ sessions, config, onConfigChange }) {
  const [open, setOpen] = useState(false);
  const [mergeSelection, setMergeSelection] = useState(new Set());
  const [merging, setMerging] = useState(false);
  const [mergeName, setMergeName] = useState('');
  const [renamingPlayer, setRenamingPlayer] = useState(null); // canonical name being renamed
  const [renameValue, setRenameValue] = useState('');

  const allPlayers = getAllCanonicalPlayers(sessions, config);
  const visiblePlayers = allPlayers.filter(n => !isHidden(n, config));
  const hiddenPlayers = allPlayers.filter(n => isHidden(n, config));

  // Count sessions + hands per canonical player
  function playerStats(canonicalName) {
    let sessionCount = 0;
    let handCount = 0;
    const aliases = new Set([canonicalName, ...getAliasesFor(canonicalName, config)]);
    for (const s of sessions) {
      const found = s.playerNames.some(n => {
        const resolved = config?.aliases?.[n] || n;
        return resolved === canonicalName || aliases.has(n);
      });
      if (found) {
        sessionCount++;
        // Sum hands for this player in this session
        for (const rawName of s.playerNames) {
          const resolved = config?.aliases?.[rawName] || rawName;
          if (resolved === canonicalName && s.stats?.players?.[rawName]) {
            handCount += s.stats.players[rawName].handsDealt || 0;
          }
        }
      }
    }
    return { sessionCount, handCount };
  }

  function setViewerPlayer(name) {
    onConfigChange({ ...config, viewer: name });
  }

  function toggleHidden(name) {
    const hidden = [...(config?.hidden || [])];
    const idx = hidden.indexOf(name);
    if (idx >= 0) hidden.splice(idx, 1);
    else hidden.push(name);
    // If hiding the viewer, clear viewer
    const newViewer = hidden.includes(config?.viewer) ? null : config?.viewer;
    onConfigChange({ ...config, hidden, viewer: newViewer });
  }

  function toggleMergeSelect(name) {
    const next = new Set(mergeSelection);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setMergeSelection(next);
  }

  function startMerge() {
    if (mergeSelection.size < 2) return;
    setMerging(true);
    setMergeName([...mergeSelection][0]); // default to first selected name
  }

  function confirmMerge() {
    if (!mergeName.trim() || mergeSelection.size < 2) return;
    const canonical = mergeName.trim();
    const aliases = { ...(config?.aliases || {}) };

    // All selected names that aren't the canonical name become aliases
    for (const name of mergeSelection) {
      if (name !== canonical) {
        aliases[name] = canonical;
        // Also remap any existing aliases that pointed to merged names
        for (const [raw, target] of Object.entries(aliases)) {
          if (target === name) aliases[raw] = canonical;
        }
      }
    }

    // Update viewer if it was one of the merged names
    let viewer = config?.viewer;
    if (mergeSelection.has(viewer) && viewer !== canonical) {
      viewer = canonical;
    }

    onConfigChange({ ...config, aliases, viewer });
    setMerging(false);
    setMergeSelection(new Set());
    setMergeName('');
  }

  function cancelMerge() {
    setMerging(false);
    setMergeSelection(new Set());
    setMergeName('');
  }

  function unmergeName(rawAlias) {
    const aliases = { ...(config?.aliases || {}) };
    delete aliases[rawAlias];
    onConfigChange({ ...config, aliases });
  }

  function startRename(canonicalName) {
    setRenamingPlayer(canonicalName);
    setRenameValue(resolveDisplayName(canonicalName, config));
  }

  function confirmRename() {
    if (!renamingPlayer || !renameValue.trim()) return;
    const renames = { ...(config?.renames || {}) };
    const newName = renameValue.trim();
    if (newName === renamingPlayer) {
      // Revert to original — remove any rename
      delete renames[renamingPlayer];
    } else {
      renames[renamingPlayer] = newName;
    }
    // If the renamed player was the viewer, update viewer to the new display name
    let viewer = config?.viewer;
    if (viewer === renamingPlayer) viewer = renamingPlayer; // viewer stays as canonical
    onConfigChange({ ...config, renames, viewer });
    setRenamingPlayer(null);
    setRenameValue('');
  }

  function cancelRename() {
    setRenamingPlayer(null);
    setRenameValue('');
  }

  if (!sessions.length) return null;

  return (
    <div className="player-mgmt">
      <button className="player-mgmt-toggle" onClick={() => setOpen(o => !o)}>
        👥 Player Management {open ? '▲' : '▼'}
      </button>

      {open && (
        <div className="player-mgmt-body">
          {merging ? (
            <div className="merge-dialog">
              <div className="merge-title">Merge {mergeSelection.size} Players</div>
              <div className="merge-names">
                Combining: {[...mergeSelection].join(', ')}
              </div>
              <label className="merge-label">
                Display name:
                <input
                  className="merge-input"
                  type="text"
                  value={mergeName}
                  onChange={e => setMergeName(e.target.value)}
                  autoFocus
                />
              </label>
              <div className="merge-actions">
                <button className="btn btn-primary" onClick={confirmMerge} disabled={!mergeName.trim()}>
                  Merge
                </button>
                <button className="btn btn-ghost" onClick={cancelMerge}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <div className="player-mgmt-hint">
                Select your player, merge aliases, or hide players from views.
              </div>

              <div className="player-chips">
                {visiblePlayers.map(name => {
                  const isMe = isViewer(name, config);
                  const aliases = getAliasesFor(name, config);
                  const stats = playerStats(name);
                  const selected = mergeSelection.has(name);
                  const displayName = resolveDisplayName(name, config);
                  const isRenamed = displayName !== name;
                  const isRenaming = renamingPlayer === name;

                  return (
                    <div key={name} className={`player-chip${isMe ? ' viewer' : ''}${selected ? ' selected' : ''}`}>
                      <div className="pc-header">
                        {isRenaming ? (
                          <span className="pc-rename-wrap">
                            <input
                              className="pc-rename-input"
                              type="text"
                              value={renameValue}
                              onChange={e => setRenameValue(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') cancelRename(); }}
                              autoFocus
                            />
                            <button className="pc-btn active" onClick={confirmRename} title="Save">OK</button>
                            <button className="pc-btn" onClick={cancelRename} title="Cancel">X</button>
                          </span>
                        ) : (
                          <span className="pc-name" title={isRenamed ? `Original: ${name}` : name}>
                            {isMe && <span className="pc-star">★ </span>}
                            {displayName}
                            {isRenamed && <span className="pc-renamed-badge">renamed</span>}
                          </span>
                        )}
                        <span className="pc-stats">{stats.sessionCount}s · {stats.handCount}h</span>
                      </div>

                      {aliases.length > 0 && (
                        <div className="pc-aliases">
                          aka: {aliases.map((a, i) => (
                            <span key={a}>
                              {a}
                              <button className="pc-unmerge" onClick={() => unmergeName(a)} title={`Unmerge ${a}`}>x</button>
                              {i < aliases.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="pc-actions">
                        {!isMe && (
                          <button className="pc-btn" onClick={() => setViewerPlayer(name)}>
                            This is me
                          </button>
                        )}
                        <button className="pc-btn" onClick={() => startRename(name)}>Rename</button>
                        <button className="pc-btn" onClick={() => toggleHidden(name)}>Hide</button>
                        <button
                          className={`pc-btn${selected ? ' active' : ''}`}
                          onClick={() => toggleMergeSelect(name)}
                        >
                          {selected ? '✓ Selected' : 'Select'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {mergeSelection.size >= 2 && (
                <div className="merge-bar">
                  <span>{mergeSelection.size} players selected</span>
                  <button className="btn btn-primary" style={{ fontSize: '0.82rem' }} onClick={startMerge}>
                    Merge Selected
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: '0.82rem' }} onClick={() => setMergeSelection(new Set())}>
                    Clear
                  </button>
                </div>
              )}

              {hiddenPlayers.length > 0 && (
                <div className="hidden-players">
                  <span className="hp-label">Hidden:</span>
                  {hiddenPlayers.map(name => (
                    <button key={name} className="hp-tag" onClick={() => toggleHidden(name)}>
                      {name} ✕
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

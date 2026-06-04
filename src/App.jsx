import { useState, useEffect, lazy, Suspense } from 'react';
import './index.css';
import { parseLog, extractGameDate, extractPlayerNames, formatSessionName, hashContent } from './parser.js';
import { analyseLog } from './stats.js';
import { loadSessions, saveSession, deleteSession, mergeSessions, isDuplicate, initSessions } from './sessions.js';
import { loadPlayerConfig, savePlayerConfig, resolveAlias, resolveDisplayName } from './playerConfig.js';
import SessionsHome from './components/SessionsHome.jsx';
import ViewerPickerModal from './components/ViewerPickerModal.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

// Lazy-load the chart-heavy views so Recharts isn't in the initial (home) bundle.
const Dashboard = lazy(() => import('./components/Dashboard.jsx'));
const TrendsView = lazy(() => import('./components/TrendsView.jsx'));

// Auto-loaded sample logs (placed in /public). Loaded once on first launch
// when localStorage has no sessions yet.
const AUTO_LOAD_LOGS = ['/log1.csv', '/log2.csv'];

// The viewer is whichever player downloaded the log — the only person whose
// hole cards we see on every dealt hand. We persist the pick on each session,
// but older saves don't have it; fall back to the legacy "will*" heuristic so
// the coaching report still surfaces for the bundled samples / pre-v3 saves.
// When a global viewer is set in playerConfig, prefer that (resolving aliases).
function resolveViewerNames(sessions, stats, playerConfig = null) {
  // Global viewer from player management takes priority
  if (playerConfig?.viewer) {
    const canonical = playerConfig.viewer;
    // Check canonical name directly
    if (stats.players[canonical]) return [canonical];
    // Check renamed display name
    const display = resolveDisplayName(canonical, playerConfig);
    if (display !== canonical && stats.players[display]) return [display];
    // Check if any player in stats is an alias of the viewer
    const match = Object.keys(stats.players).find(n => resolveAlias(n, playerConfig) === canonical);
    if (match) return [match];
  }

  // Fall back to per-session viewerName
  const names = new Set();
  for (const s of sessions) {
    if (s.viewerName) names.add(s.viewerName);
  }
  if (names.size > 0) return [...names];
  const fallback = Object.keys(stats.players).find(n => n.toLowerCase().startsWith('will'));
  return fallback ? [fallback] : [];
}

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [ready, setReady] = useState(false); // becomes true once IndexedDB load finishes
  const [view, setView] = useState(null); // null | { type:'single', id } | { type:'merged', selectedIds:[] }
  const [error, setError] = useState(null);
  const [playerConfig, setPlayerConfig] = useState(() => loadPlayerConfig());
  // Queue of parsed uploads waiting for viewer-name selection (one modal at a
  // time). A file only lands here if we can't auto-detect the viewer from the
  // configured "this is me" player. Each item:
  //   { fileName, rows, text, gameDate, hash, playerNames, navigate: bool }
  const [pendingQueue, setPendingQueue] = useState([]);

  function handlePlayerConfigChange(newConfig) {
    savePlayerConfig(newConfig);
    setPlayerConfig(newConfig);
  }

  // Load persisted sessions from IndexedDB (self-healing any outdated ones via
  // their stored rawLog), then — only on a truly empty store — ingest the bundled
  // sample CSVs. Runs once on mount; the UI waits on `ready`.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initSessions();
        if (loadSessions().length === 0) {
          for (const url of AUTO_LOAD_LOGS) {
            const res = await fetch(url);
            if (!res.ok) continue;
            const text = await res.text();
            const hash = hashContent(text);
            if (isDuplicate(hash)) continue;
            const rows = parseLog(text);
            const gameDate = extractGameDate(rows) || new Date();
            // Bundled samples are Will's — let analyseLog use its built-in
            // "will*" heuristic by passing no explicit viewerName.
            const stats = analyseLog(rows);
            const sessionName = formatSessionName(gameDate);
            const viewer = Object.keys(stats.players).find(n => n.toLowerCase().startsWith('will')) || null;
            saveSession(sessionName, stats, gameDate, hash, viewer, text);
          }
        }
      } catch (err) {
        console.error('Startup load failed', err);
        if (!cancelled) setError('Failed to load saved sessions: ' + err.message);
      } finally {
        if (!cancelled) { setSessions(loadSessions()); setReady(true); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function refresh() {
    setSessions(loadSessions());
  }

  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(reader.error || new Error('could not read file'));
      reader.readAsText(file);
    });
  }

  // If a "this is me" viewer is configured and present in this file, return the
  // raw player name to attribute the log to; otherwise null (→ show the picker).
  function detectViewer(playerNames, config) {
    const viewer = config?.viewer;
    if (!viewer) return null;
    return playerNames.find(n => resolveAlias(n, config) === viewer) || null;
  }

  // Analyse + persist a staged upload for a chosen viewer, then optionally open it.
  function commitUpload(staged, viewerName) {
    const stats = analyseLog(staged.rows, viewerName);
    const id = saveSession(staged.fileName, stats, staged.gameDate, staged.hash, viewerName, staged.text);
    refresh();
    if (staged.navigate) setView({ type: 'single', id });
    return id;
  }

  // Read + parse one or more CSVs. Files whose viewer we can auto-detect are
  // saved straight away; the rest are queued for the viewer picker. `openOnSave`
  // (true from the home/empty state) opens the session only when it's a single
  // file. Skips duplicates and reports per-file errors.
  async function stageFiles(fileList, { openOnSave }) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    setError(null);
    const navigate = openOnSave && files.length === 1;
    const needPick = [];
    const errs = [];
    for (const file of files) {
      try {
        const text = await readFileText(file);
        const hash = hashContent(text);
        if (isDuplicate(hash)) { errs.push(`${file.name}: already uploaded`); continue; }
        const rows = parseLog(text);
        const gameDate = extractGameDate(rows) || new Date();
        const playerNames = extractPlayerNames(rows);
        const staged = { fileName: formatSessionName(gameDate), rows, text, gameDate, hash, playerNames, navigate };
        const auto = detectViewer(playerNames, playerConfig);
        if (auto) commitUpload(staged, auto);
        else needPick.push(staged);
      } catch (err) {
        console.error(err);
        errs.push(`${file.name}: ${err.message}`);
      }
    }
    if (errs.length) setError(errs.join(' · '));
    if (needPick.length) setPendingQueue(q => [...q, ...needPick]);
  }

  // The user picked their player in the modal — commit that file, then re-check
  // the rest of the queue against the now-known viewer so the same person's
  // other files in this batch save automatically.
  function handleViewerPicked(viewerName) {
    const [current, ...rest] = pendingQueue;
    if (!current) return;
    try { commitUpload(current, viewerName); }
    catch (err) { console.error(err); setError('Failed to save session: ' + err.message); }
    // Re-check the rest of the batch against the just-picked viewer so the same
    // person's other files save automatically.
    const stillNeed = [];
    for (const staged of rest) {
      const auto = staged.playerNames.find(n => n === viewerName)
        || (playerConfig?.viewer && staged.playerNames.find(n => resolveAlias(n, playerConfig) === playerConfig.viewer));
      if (auto) commitUpload(staged, auto);
      else stillNeed.push(staged);
    }
    setPendingQueue(stillNeed);
  }

  function handleCancelPicker() {
    setPendingQueue(queue => queue.slice(1)); // skip this file, move to the next
  }

  function handleNewFiles(files) {
    stageFiles(files, { openOnSave: true });
  }

  function handleAddSession(files) {
    stageFiles(files, { openOnSave: false });
  }

  function handleDelete(id) {
    deleteSession(id);
    refresh();
    if (view?.id === id) setView(null);
  }

  const pendingUpload = pendingQueue[0] || null;
  const modal = pendingUpload && (
    <ViewerPickerModal
      key={pendingUpload.hash}
      fileName={pendingUpload.fileName}
      playerNames={pendingUpload.playerNames}
      remaining={pendingQueue.length}
      onConfirm={handleViewerPicked}
      onCancel={handleCancelPicker}
    />
  );

  // Wait for IndexedDB to load before rendering (avoids a flash of the empty
  // state / spurious sample auto-load while the async read is in flight).
  if (!ready) {
    return (
      <div className="app">
        <div className="loading-screen">Loading sessions…</div>
      </div>
    );
  }

  // Fallback shown when a view throws during render — lets the user escape back
  // to the (always-safe) sessions list or reload, instead of a blank screen.
  const viewFallback = (err, reset) => (
    <div className="error-boundary">
      <h2>This view hit an error</h2>
      <p>{String(err?.message || err)}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button className="btn btn-primary" onClick={() => { reset(); setView(null); }}>Back to Sessions</button>
        <button className="btn btn-ghost" onClick={() => location.reload()}>Reload</button>
      </div>
    </div>
  );
  const ViewFallback = <div className="loading-screen">Loading…</div>;

  if (view?.type === 'trends') {
    const currentSessions = loadSessions();
    return (
      <div className="app">
        <ErrorBoundary key="trends" fallback={viewFallback}>
          <Suspense fallback={ViewFallback}>
            <TrendsView sessions={currentSessions} onBack={() => setView(null)} playerConfig={playerConfig} />
          </Suspense>
        </ErrorBoundary>
        {modal}
      </div>
    );
  }

  if (view) {
    const currentSessions = loadSessions();
    let data, label, selectedIds, viewerNames;
    if (view.type === 'single') {
      const session = currentSessions.find(s => s.id === view.id);
      if (!session) { setView(null); return null; }
      data = mergeSessions([session], playerConfig);
      label = session.fileName;
      selectedIds = [view.id];
      viewerNames = resolveViewerNames([session], data, playerConfig);
    } else {
      selectedIds = view.selectedIds && view.selectedIds.length > 0 ? view.selectedIds : currentSessions.map(s => s.id);
      const sessionsToMerge = currentSessions.filter(s => selectedIds.includes(s.id));
      data = mergeSessions(sessionsToMerge, playerConfig);
      label = `${selectedIds.length} of ${currentSessions.length} sessions merged`;
      viewerNames = resolveViewerNames(sessionsToMerge, data, playerConfig);
    }
    if (!data) { setView(null); return null; }

    return (
      <div className="app">
        <ErrorBoundary key={`dash-${selectedIds.join(',')}`} fallback={viewFallback}>
          <Suspense fallback={ViewFallback}>
            <Dashboard
              data={data}
              fileName={label}
              isMerged={view.type === 'merged'}
              sessionCount={currentSessions.length}
              selectedIds={selectedIds}
              allSessions={currentSessions}
              viewerNames={viewerNames}
              onBack={() => setView(null)}
              onViewMerged={() => setView({ type: 'merged', selectedIds: currentSessions.map(s => s.id) })}
              onViewTrends={() => setView({ type: 'trends' })}
              onUpdateSessions={(ids) => setView({ type: 'merged', selectedIds: ids })}
              onAddSession={handleAddSession}
              playerConfig={playerConfig}
              onPlayerConfigChange={handlePlayerConfigChange}
              error={error}
            />
          </Suspense>
        </ErrorBoundary>
        {modal}
      </div>
    );
  }

  return (
    <div className="app">
      <ErrorBoundary key="home" fallback={viewFallback}>
        <SessionsHome
          sessions={sessions}
          onView={(id) => setView({ type: 'single', id })}
          onViewMerged={() => setView({ type: 'merged', selectedIds: sessions.map(s => s.id) })}
          onViewTrends={() => setView({ type: 'trends' })}
          onDelete={handleDelete}
          onNewFiles={handleNewFiles}
          error={error}
          playerConfig={playerConfig}
          onPlayerConfigChange={handlePlayerConfigChange}
          viewerName={playerConfig?.viewer ? resolveDisplayName(playerConfig.viewer, playerConfig) : null}
        />
      </ErrorBoundary>
      {modal}
    </div>
  );
}

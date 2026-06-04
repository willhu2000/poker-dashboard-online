import { useState, useMemo } from 'react';
import { analyseLog } from './stats.js';
import { mergeSessions, STATS_SCHEMA_VERSION } from './sessions.js';
import * as fixtures from './testFixtures.js';
import Dashboard from './components/Dashboard.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

// Dev-only dashboard that renders each test fixture (src/testFixtures.js) through
// the real Dashboard/PlayerDetail — a living catalog of the mock log data and a
// visual sanity-check of what `analyseLog` produces. Reachable at /fixtures.html
// (dev: `npm run dev` then open it, or `npm run dev:fixtures`). It never touches
// IndexedDB or real sessions.

// Every array export in testFixtures.js is a fixture (the makeRows helper is a
// function and is skipped). `GEN_*` are the full 20-hand generated sessions;
// the rest are single-hand scenario fixtures used by the unit tests.
const ALL = Object.entries(fixtures).filter(([, v]) => Array.isArray(v));
const SESSIONS = ALL.filter(([name]) => name.startsWith('GEN_'));
const SCENARIOS = ALL.filter(([name]) => !name.startsWith('GEN_'));
const FIXTURES = [...SESSIONS, ...SCENARIOS];
const prettyLabel = (name) => name.replace(/^GEN_/, '').replace(/_/g, ' ').toLowerCase();

// Turn a fixture (array of log rows) into the `data` object Dashboard expects.
function fixtureToData(name, rows) {
  const stats = analyseLog(rows);
  const session = {
    id: name,
    fileName: name,
    gameDate: '2026-01-01',
    uploadedAt: new Date().toISOString(),
    handCount: stats.handCount,
    playerNames: Object.keys(stats.players),
    viewerName: null,
    schemaVersion: STATS_SCHEMA_VERSION,
    stats,
  };
  return mergeSessions([session], null);
}

const noop = () => {};

export default function FixturesApp() {
  // Build every fixture's data once (fresh analyseLog each, so mergeSessions
  // never re-processes the same stats object).
  const datas = useMemo(() => {
    const out = {};
    for (const [name, rows] of FIXTURES) {
      try { out[name] = { data: fixtureToData(name, rows) }; }
      catch (err) { out[name] = { error: err }; }
    }
    return out;
  }, []);

  const [selected, setSelected] = useState(FIXTURES[0]?.[0] ?? null);
  const entry = selected ? datas[selected] : null;

  const tabGroup = (list) => (
    <div className="fixtures-tabs">
      {list.map(([n]) => (
        <button
          key={n}
          className={`fixtures-tab${selected === n ? ' active' : ''}`}
          onClick={() => setSelected(n)}
        >
          {n.startsWith('GEN_') ? prettyLabel(n) : n}
        </button>
      ))}
    </div>
  );

  return (
    <div className="app">
      <div className="fixtures-bar">
        <span className="fixtures-title">🧪 Fixture dashboard</span>
        <span className="fixtures-hint">render the test fixtures through the real UI</span>
        {SESSIONS.length > 0 && (
          <div className="fixtures-group">
            <span className="fixtures-group-label">20-hand sessions</span>
            {tabGroup(SESSIONS)}
          </div>
        )}
        {SCENARIOS.length > 0 && (
          <div className="fixtures-group">
            <span className="fixtures-group-label">scenarios (1 hand)</span>
            {tabGroup(SCENARIOS)}
          </div>
        )}
      </div>

      {!entry && <div className="loading-screen">No fixtures found.</div>}
      {entry?.error && (
        <div className="error-boundary">
          <h2>{selected} failed to analyse</h2>
          <p>{String(entry.error?.message || entry.error)}</p>
        </div>
      )}
      {entry?.data && (
        <ErrorBoundary key={selected} fallback={(err) => (
          <div className="error-boundary"><h2>Render error</h2><p>{String(err?.message || err)}</p></div>
        )}>
          <Dashboard
            data={entry.data}
            fileName={selected}
            isMerged={false}
            sessionCount={1}
            selectedIds={[selected]}
            allSessions={[]}
            viewerNames={[]}
            onBack={noop}
            onViewMerged={noop}
            onViewTrends={noop}
            onUpdateSessions={noop}
            onAddSession={noop}
            playerConfig={null}
            onPlayerConfigChange={noop}
            error={null}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

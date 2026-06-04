import { resolveAlias, resolveDisplayName } from './playerConfig.js';
import { parseLog, extractGameDate, toLocalDateStr } from './parser.js';
import { analyseLog } from './stats.js';
import { idbAvailable, idbGetAll, idbPut, idbPutMany, idbDelete, idbClear } from './idb.js';

const KEY = 'poker-sessions'; // legacy localStorage key (data is migrated into IndexedDB)

// Bump when the shape of the saved `stats` payload changes in a way that affects
// derived numbers users see.
//   v1: original (broken Net Chips when player still seated at log end)
//   v2: tracks lastSeenStack / lastBuyInOrder / lastQuitOrder and effectiveCashOut
//   v3: per-hand `stack` (chip-count graph) + local game date; sessions now keep
//       the raw CSV (`rawLog`) so future bumps re-derive everything automatically.
//   v4: `show` action-log entries carry the shown cards (play-by-play renders the
//       actual hand instead of a generic "shows hand").
//   v5: advanced analytics — per-position counts, showdown funnel (WTSD/W$SD),
//       3-bet/c-bet, bb sizes, and head-to-head showdown records.
//   v6: action logs lead with a `players` meta entry (seats, stacks, positions,
//       blinds) so the hand replayer can draw a poker table.
//   v7: fix head-to-head — record each player's pot result vs every opponent at
//       showdown (multiway co-losers were previously skipped).
//
// Sessions that carry a `rawLog` self-heal on load (initSessions re-runs the
// parser/analyser via migrateRecords), so they NEVER need a manual re-upload
// again. Only legacy sessions saved without a rawLog can't auto-upgrade — those
// are what hasOutdatedSessions() flags. (Split fields are still back-filled from
// stored action logs for them too; see backfillSplitFields.)
export const STATS_SCHEMA_VERSION = 7;

// ── In-memory session cache ───────────────────────────────────────────────────
// IndexedDB is async, but the rest of the app expects synchronous reads. We keep
// a synchronous in-memory mirror (the cache) as the source of truth for the UI
// and persist changes to IndexedDB in the background. The cache holds "lite"
// sessions WITHOUT the bulky `rawLog` (that stays in IndexedDB only, read back
// just for schema self-healing at startup), so cloning the cache stays cheap.
let cache = [];
let usingIDB = true; // false → fall back to localStorage (IndexedDB unavailable)
let initPromise = null; // memoised so init runs exactly once (StrictMode-safe)

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const POS_KEYS = ['BTN', 'SB', 'BB', 'LP', 'MP', 'EP'];
function emptyPosStats() {
  const out = {};
  for (const k of POS_KEYS) out[k] = { h: 0, v: 0, p: 0, w: 0 };
  return out;
}

function byNewest(a, b) {
  return (b.uploadedAt || '').localeCompare(a.uploadedAt || '');
}

// Strip the heavy rawLog before a session goes into the in-memory cache.
function lite(session) {
  // eslint-disable-next-line no-unused-vars
  const { rawLog, ...rest } = session;
  return rest;
}

function readLegacyLocalStorage() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
  catch { return []; }
}

function writeLocalStorage() {
  // Fallback persistence when IndexedDB is unavailable. Stores lite sessions only.
  try { localStorage.setItem(KEY, JSON.stringify(cache)); return true; }
  catch { return false; }
}

// Re-analyse records that predate the current schema but kept their rawLog,
// mutating stats/date/schemaVersion in place. Returns the records that changed.
function migrateRecords(records) {
  const changed = [];
  for (const s of records) {
    if (!s.rawLog) continue;
    if ((s.schemaVersion || 1) >= STATS_SCHEMA_VERSION) continue;
    try {
      const rows = parseLog(s.rawLog);
      s.stats = analyseLog(rows, s.viewerName || null);
      s.handCount = s.stats.handCount;
      s.playerNames = Object.keys(s.stats.players);
      const gd = extractGameDate(rows);
      if (gd) s.gameDate = toLocalDateStr(gd);
      s.schemaVersion = STATS_SCHEMA_VERSION;
      changed.push(s);
    } catch (e) {
      console.error('Re-analysis failed for session', s.id, e);
    }
  }
  return changed;
}

// Load persisted sessions into the cache. Await this once at startup before the
// app reads sessions. Migrates legacy localStorage data into IndexedDB the first
// time, and self-heals outdated sessions from their stored rawLog. Memoised, so
// repeated calls (e.g. StrictMode's double-invoked effects) won't reset a cache
// that newer writes have already populated.
export function initSessions() {
  if (initPromise) return initPromise;
  initPromise = doInit();
  return initPromise;
}

async function doInit() {
  let records = [];
  if (idbAvailable()) {
    try {
      records = await idbGetAll();
      if (records.length === 0) {
        const legacy = readLegacyLocalStorage(); // one-time pre-IndexedDB migration
        if (legacy.length) {
          await idbPutMany(legacy);
          records = legacy;
          localStorage.removeItem(KEY); // now lives in IndexedDB
        }
      }
    } catch (e) {
      console.error('IndexedDB unavailable, falling back to localStorage', e);
      usingIDB = false;
      records = readLegacyLocalStorage();
    }
  } else {
    usingIDB = false;
    records = readLegacyLocalStorage();
  }

  const changed = migrateRecords(records);
  records.sort(byNewest);
  cache = records.map(lite);
  if (changed.length && usingIDB) {
    try { await idbPutMany(changed); } catch (e) { console.error('Persist migrated failed', e); }
  }
  if (!usingIDB) writeLocalStorage();
  return loadSessions();
}

// Synchronous snapshot of the cache. Returns deep clones so callers (e.g.
// mergeSessions, which tags hands in place) can't corrupt the cached originals.
export function loadSessions() {
  return cache.map(s => structuredClone(s));
}

export function hasOutdatedSessions() {
  return cache.some(s => (s.schemaVersion || 1) < STATS_SCHEMA_VERSION);
}

export function isDuplicate(contentHash) {
  return cache.some(s => s.contentHash === contentHash);
}

// `rawLog` (the original CSV) is persisted to IndexedDB so future schema changes
// can re-derive discarded data without a re-upload. It's kept out of the cache.
export function saveSession(fileName, stats, gameDate = null, contentHash = null, viewerName = null, rawLog = null) {
  const id = genId();
  const session = {
    id,
    fileName,
    gameDate: toLocalDateStr(gameDate || new Date()),
    uploadedAt: new Date().toISOString(),
    handCount: stats.handCount,
    playerNames: Object.keys(stats.players),
    viewerName,
    contentHash,
    schemaVersion: STATS_SCHEMA_VERSION,
    stats,
    rawLog,
  };
  cache.unshift(lite(session));
  if (usingIDB) {
    idbPut(session).catch(() => {
      // Likely a quota error from the large rawLog — retry without it.
      idbPut(lite(session)).catch(e => console.error('Failed to persist session', e));
    });
  } else {
    writeLocalStorage();
  }
  return id;
}

export function deleteSession(id) {
  cache = cache.filter(s => s.id !== id);
  if (usingIDB) idbDelete(id).catch(e => console.error('Failed to delete session', e));
  else writeLocalStorage();
}

export async function clearAllSessions() {
  cache = [];
  if (usingIDB) { try { await idbClear(); } catch (e) { console.error('Failed to clear sessions', e); } }
  else localStorage.removeItem(KEY);
}

// Reconstruct split-pot fields on a player's hand history for sessions saved
// before split tracking existed. Uses the stored per-hand action logs (each
// `collect` action carries the winner + amount), so older data gains split
// categorisation and true take-home `wonAmount` without a re-upload. Hands that
// already carry `isSplit` (newer uploads) are left untouched. Mutates in place —
// safe because loadSessions() returns a fresh parse on every call.
//   playerStats: a session player object; its `name` matches the `collect`
//                action's `player` field (both are raw extracted names).
//   logsByNum:   hand-number → actionLog (the session's original handActionLogs).
function backfillSplitFields(playerStats, logsByNum) {
  const handsHistory = playerStats.handsHistory || [];
  const playerName = playerStats.name;
  let backfilled = false;
  let splitCount = 0;
  for (const h of handsHistory) {
    if (h.isSplit !== undefined) { if (h.isSplit) splitCount++; continue; }
    backfilled = true;
    const log = logsByNum?.[h.num] || h.actionLog || [];
    const collects = log.filter(a => a.action === 'collect');
    const winners = [...new Set(collects.map(a => a.player))];
    const isSplit = !!h.won && winners.length >= 2;
    h.isSplit = isSplit;
    h.splitWith = isSplit ? winners.filter(n => n !== playerName) : [];
    if (isSplit) splitCount++;
    if (h.won) {
      const take = collects
        .filter(a => a.player === playerName)
        .reduce((s, a) => s + (a.amount || 0), 0);
      if (take > 0) h.wonAmount = take; // true take-home (sums any side pots)
    }
  }
  // Keep the accumulator in sync for sessions we just back-filled.
  if (backfilled) playerStats.handsSplit = splitCount;
}

export function mergeSessions(sessions, playerConfig = null) {
  if (!sessions.length) return null;
  if (sessions.length === 1) {
    const session = sessions[0];
    const stats = session.stats;
    // Tag hands with session metadata for single session too (for consistency).
    // `stats.handActionLogs` is still hand-number keyed here (re-keyed below), so
    // back-fill split fields before that happens.
    for (const player of Object.values(stats.players)) {
      backfillSplitFields(player, stats.handActionLogs);
      player.handsHistory.forEach(h => {
        h.sessionId = session.id;
        h.sessionDate = session.gameDate || session.uploadedAt?.split('T')[0];
      });
      player.badBeats.forEach(bb => {
        bb.sessionId = session.id;
        bb.sessionDate = session.gameDate || session.uploadedAt?.split('T')[0];
      });
      player.suckOuts.forEach(so => {
        so.sessionId = session.id;
        so.sessionDate = session.gameDate || session.uploadedAt?.split('T')[0];
      });
      (player.coolers || []).forEach(c => {
        c.sessionId = session.id;
        c.sessionDate = session.gameDate || session.uploadedAt?.split('T')[0];
      });
    }
    // Build session-prefixed action log map so PlayerDetail can look up by {sessionId}_{num}
    const handActionLogs = {};
    for (const [num, log] of Object.entries(stats.handActionLogs || {})) {
      handActionLogs[`${session.id}_${num}`] = log;
    }
    stats.handActionLogs = handActionLogs;
    // Apply renames in single-session path too
    if (playerConfig?.renames) {
      for (const canonical of Object.keys(stats.players)) {
        const display = resolveDisplayName(canonical, playerConfig);
        if (display !== canonical) {
          stats.players[display] = stats.players[canonical];
          stats.players[display].name = display;
          delete stats.players[canonical];
        }
      }
    }
    return stats;
  }

  const players = {};
  let handCount = 0;
  const handActionLogs = {};

  for (const session of sessions) {
    // Collect this session's action logs under session-prefixed keys to avoid
    // hand-number collisions between sessions (each session restarts from #1).
    for (const [num, log] of Object.entries(session.stats.handActionLogs || {})) {
      handActionLogs[`${session.id}_${num}`] = log;
    }
    const sessionDate = session.gameDate || session.uploadedAt?.split('T')[0];
    const sessionId = session.id;
    handCount += session.handCount;
    for (const [rawName, sp] of Object.entries(session.stats.players)) {
      // Reconstruct split fields for pre-split-tracking sessions before we read
      // handsSplit / handsHistory below. Uses this session's own (num-keyed) logs.
      backfillSplitFields(sp, session.stats.handActionLogs);
      const name = resolveAlias(rawName, playerConfig);
      if (!players[name]) {
        players[name] = {
          name,
          handsDealt: 0, vpipHands: 0, pfrHands: 0, preflopFolds: 0,
          totalBetsRaises: 0, totalCalls: 0, totalChecks: 0,
          shownHands: [], handCategories: {},
          netChips: 0, buyIns: 0, cashOut: 0, effectiveCashOut: 0,
          streetActions: { preflop: 0, flop: 0, turn: 0, river: 0 },
          premiumHandsShown: 0, allHandsShown: 0,
          handsWon: 0, handsSplit: 0, potsWon: 0,
          posStats: emptyPosStats(),
          sawFlopHands: 0, wtsdHands: 0, wsdHands: 0,
          threeBetOpp: 0, threeBets: 0, cbetOpp: 0, cbets: 0,
          bbCounts: {}, vsOpponents: {},
          rangeHands: [],
          handsHistory: [],
          badBeats: [],
          suckOuts: [],
          coolers: [],
        };
      }
      const p = players[name];
      p.handsDealt      += sp.handsDealt || 0;
      p.vpipHands       += sp.vpipHands || 0;
      p.pfrHands        += sp.pfrHands || 0;
      p.preflopFolds    += sp.preflopFolds || 0;
      p.totalBetsRaises += sp.totalBetsRaises || 0;
      p.totalCalls      += sp.totalCalls || 0;
      p.totalChecks     += sp.totalChecks || 0;
      p.allHandsShown   += sp.allHandsShown || 0;
      p.premiumHandsShown += sp.premiumHandsShown || 0;
      p.handsWon        += sp.handsWon || 0;
      p.handsSplit      += sp.handsSplit || 0;
      p.buyIns          += sp.buyIns || 0;
      p.cashOut         += sp.cashOut || 0;
      // effectiveCashOut from each session already includes that session's
      // still-seated final-stack fallback; just sum it. Fall back to cashOut for
      // pre-v2 stats payloads (handled separately by the outdated-session banner).
      p.effectiveCashOut += (sp.effectiveCashOut != null ? sp.effectiveCashOut : sp.cashOut) || 0;
      p.shownHands    = p.shownHands.concat(sp.shownHands || []);
      p.rangeHands    = p.rangeHands.concat(sp.rangeHands || []);
      // Tag hands with session metadata as we concat
      const taggedHistory = (sp.handsHistory || []).map(h => ({ ...h, sessionId, sessionDate }));
      const taggedBadBeats = (sp.badBeats || []).map(bb => ({ ...bb, sessionId, sessionDate }));
      const taggedSuckOuts = (sp.suckOuts || []).map(so => ({ ...so, sessionId, sessionDate }));
      const taggedCoolers = (sp.coolers || []).map(c => ({ ...c, sessionId, sessionDate }));
      p.handsHistory  = p.handsHistory.concat(taggedHistory);
      p.badBeats      = p.badBeats.concat(taggedBadBeats);
      p.suckOuts      = p.suckOuts.concat(taggedSuckOuts);
      p.coolers       = p.coolers.concat(taggedCoolers);
      for (const [cat, cnt] of Object.entries(sp.handCategories || {})) {
        p.handCategories[cat] = (p.handCategories[cat] || 0) + cnt;
      }
      for (const s of ['preflop', 'flop', 'turn', 'river']) {
        p.streetActions[s] += sp.streetActions?.[s] || 0;
      }
      // ── Advanced analytics accumulators ──────────────────────────────────────
      for (const pos of POS_KEYS) {
        const src = sp.posStats?.[pos];
        if (!src) continue;
        const dst = p.posStats[pos];
        dst.h += src.h || 0; dst.v += src.v || 0; dst.p += src.p || 0; dst.w += src.w || 0;
      }
      p.sawFlopHands += sp.sawFlopHands || 0;
      p.wtsdHands    += sp.wtsdHands || 0;
      p.wsdHands     += sp.wsdHands || 0;
      p.threeBetOpp  += sp.threeBetOpp || 0;
      p.threeBets    += sp.threeBets || 0;
      p.cbetOpp      += sp.cbetOpp || 0;
      p.cbets        += sp.cbets || 0;
      for (const [size, cnt] of Object.entries(sp.bbCounts || {})) {
        p.bbCounts[size] = (p.bbCounts[size] || 0) + cnt;
      }
      for (const [opp, rec] of Object.entries(sp.vsOpponents || {})) {
        const oppName = resolveAlias(opp, playerConfig); // group the same opponent across sessions
        const cur = p.vsOpponents[oppName] || (p.vsOpponents[oppName] = { w: 0, l: 0 });
        cur.w += rec.w || 0; cur.l += rec.l || 0;
      }
    }
  }

  // Remove hidden players
  const hiddenSet = new Set(playerConfig?.hidden || []);
  for (const name of Object.keys(players)) {
    if (hiddenSet.has(name)) delete players[name];
  }

  for (const p of Object.values(players)) {
    const h = p.handsDealt || 1;
    p.vpip           = +(p.vpipHands / h * 100).toFixed(1);
    p.pfr            = +(p.pfrHands / h * 100).toFixed(1);
    p.preflopFoldPct = +(p.preflopFolds / h * 100).toFixed(1);
    p.winRate        = +(p.handsWon / h * 100).toFixed(1);
    p.af = p.totalCalls > 0
      ? +(p.totalBetsRaises / p.totalCalls).toFixed(2)
      : p.totalBetsRaises > 0 ? 99 : 0;
    p.netChips  = p.effectiveCashOut - p.buyIns;
    p.luckiness = p.allHandsShown > 0
      ? +(p.premiumHandsShown / p.allHandsShown * 100).toFixed(1)
      : 0;
    p.tightness = Math.max(0, Math.min(100, Math.round(100 - p.vpip)));
  }

  // Apply renames: re-key players from canonical names to display names
  if (playerConfig?.renames) {
    for (const canonical of Object.keys(players)) {
      const display = resolveDisplayName(canonical, playerConfig);
      if (display !== canonical) {
        players[display] = players[canonical];
        players[display].name = display;
        delete players[canonical];
      }
    }
  }

  return { players, handCount, handActionLogs };
}

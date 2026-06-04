// Low-level IndexedDB wrapper for the sessions store. All indexedDB access lives
// inside functions (nothing at module load) so this file is safe to import in a
// non-browser environment (e.g. Vitest). One object store keyed by session id.

const DB_NAME = 'poker-dashboard';
const DB_VERSION = 1;
const STORE = 'sessions';

let dbPromise = null;

export function idbAvailable() {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function getDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Run `fn(store)` inside a transaction and resolve once the transaction commits.
function withStore(mode, fn) {
  return getDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then(r => { result = r; }).catch(reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  }));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function idbGetAll() {
  return withStore('readonly', store => reqToPromise(store.getAll()));
}

export function idbPut(session) {
  return withStore('readwrite', store => { store.put(session); });
}

export function idbPutMany(sessions) {
  return withStore('readwrite', store => { for (const s of sessions) store.put(s); });
}

export function idbDelete(id) {
  return withStore('readwrite', store => { store.delete(id); });
}

export function idbClear() {
  return withStore('readwrite', store => { store.clear(); });
}

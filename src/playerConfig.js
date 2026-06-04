const KEY = 'poker-player-config';

/**
 * Config shape:
 * {
 *   viewer: "Will",           // canonical name of "me" (null if unset)
 *   aliases: {                // raw CSV name → canonical display name
 *     "William": "Will",
 *     "Will H": "Will"
 *   },
 *   renames: {                // canonical name → custom display name
 *     "Will": "William the Great"
 *   },
 *   hidden: ["Bot"]           // canonical names to exclude from views
 * }
 */

export function loadPlayerConfig() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

export function savePlayerConfig(config) {
  localStorage.setItem(KEY, JSON.stringify(config));
}

/** Resolve a raw CSV name to its canonical name (alias resolution only). */
export function resolveAlias(rawName, config) {
  if (!config?.aliases) return rawName;
  return config.aliases[rawName] || rawName;
}

/** Resolve a canonical name to its display name (applies renames). */
export function resolveDisplayName(canonicalName, config) {
  if (!config?.renames) return canonicalName;
  return config.renames[canonicalName] || canonicalName;
}

/** Inverse of resolveDisplayName: given a shown display name, find the canonical
 * name it came from (the key used in `renames`). Falls back to the name itself
 * when it isn't a rename. Used to rename a player from views that only see the
 * already-resolved display name. */
export function resolveCanonicalFromDisplay(displayName, config) {
  const renames = config?.renames || {};
  for (const [canonical, display] of Object.entries(renames)) {
    if (display === displayName) return canonical;
  }
  return displayName;
}

/** Get all unique canonical player names across all sessions. */
export function getAllCanonicalPlayers(sessions, config) {
  const names = new Set();
  for (const s of sessions) {
    for (const name of (s.playerNames || [])) {
      names.add(resolveAlias(name, config));
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Get all raw aliases that map to a given canonical name. */
export function getAliasesFor(canonicalName, config) {
  if (!config?.aliases) return [];
  return Object.entries(config.aliases)
    .filter(([, canonical]) => canonical === canonicalName)
    .map(([raw]) => raw);
}

/** Check if a canonical name is the viewer. */
export function isViewer(canonicalName, config) {
  return config?.viewer === canonicalName;
}

/** Check if a canonical name is hidden. */
export function isHidden(canonicalName, config) {
  return (config?.hidden || []).includes(canonicalName);
}

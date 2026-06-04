// PokerNow CSV Log Parser
import Papa from 'papaparse';

export function hashContent(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function parseLog(csvText) {
  const result = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  const rows = result.data
    .map(row => ({ entry: row.entry, at: row.at, order: parseInt(row.order, 10) }))
    .filter(row => row.entry && !isNaN(row.order));
  rows.sort((a, b) => a.order - b.order);
  return rows;
}

// Extract player name from "Name @ tag" format
export function extractName(raw) {
  // Raw may have surrounding quotes already stripped
  const m = raw.match(/^(.+?)\s*@\s*\w+$/);
  return m ? m[1].trim() : raw.trim();
}

// Parse a card string like "A♠" or "10♥" into { rank, suit }
// PokerNow uses Unicode suit symbols: ♠ ♥ ♦ ♣
// Some exports may also contain the mojibake versions when mis-encoded.
export function normaliseCard(raw) {
  if (!raw) return null;
  raw = raw.trim();

  const rankMatch = raw.match(/^([2-9]|10|[JQKA])/);
  if (!rankMatch) return null;
  const rank = rankMatch[1];
  const rest = raw.slice(rank.length);

  let suit = '?';
  // Direct Unicode symbols (standard PokerNow UTF-8 export)
  if (rest.includes('♠')) suit = 's';
  else if (rest.includes('♥')) suit = 'h';
  else if (rest.includes('♦')) suit = 'd';
  else if (rest.includes('♣')) suit = 'c';
  // Mojibake variants (file read with wrong encoding)
  else if (rest.includes('â™ ') || rest.includes('â ')) suit = 's';
  else if (rest.includes('â™¥') || rest.includes('â¥')) suit = 'h';
  else if (rest.includes('â™¦') || rest.includes('â¦')) suit = 'd';
  else if (rest.includes('â™£') || rest.includes('â£')) suit = 'c';
  // Last-byte fallback
  else {
    const lastCode = rest.charCodeAt(rest.length - 1);
    if (lastCode === 0xa0) suit = 's';
    else if (lastCode === 0xa5) suit = 'h';
    else if (lastCode === 0xa6) suit = 'd';
    else if (lastCode === 0xa3) suit = 'c';
  }

  return { rank, suit };
}

export function cardToString(card) {
  if (!card) return '??';
  const suitSymbol = { s: '♠', h: '♥', d: '♦', c: '♣', '?': '?' };
  return card.rank + (suitSymbol[card.suit] || card.suit);
}

// Classify a two-card hand into a category
export function classifyHand(c1, c2) {
  if (!c1 || !c2) return 'Unknown';
  const RANK_ORDER = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const r1 = RANK_ORDER.indexOf(c1.rank);
  const r2 = RANK_ORDER.indexOf(c2.rank);
  const hi = Math.max(r1, r2);
  const lo = Math.min(r1, r2);
  const suited = c1.suit === c2.suit && c1.suit !== '?';
  const paired = r1 === r2;
  const gap = hi - lo;

  if (paired) {
    if (hi >= 12) return 'Premium Pair (AA/KK)';
    if (hi >= 10) return 'Strong Pair (QQ/JJ)';
    if (hi >= 7) return 'Medium Pair (TT-88)';
    if (hi >= 4) return 'Small Pair (77-55)';
    return 'Micro Pair (44-22)';
  }
  if (hi === 12 && lo === 11) return suited ? 'Premium (AKs)' : 'Premium (AKo)';
  if (hi === 12 && lo >= 10) return suited ? 'Strong Ace (AQs/AJs)' : 'Strong Ace (AQo/AJo)';
  if (hi === 12 && lo >= 7) return suited ? 'Medium Ace suited' : 'Medium Ace offsuit';
  if (hi === 12) return suited ? 'Weak Ace suited' : 'Weak Ace offsuit';
  if (hi >= 10 && gap <= 2) return suited ? 'Broadway suited' : 'Broadway offsuit';
  if (gap === 1 && lo >= 5) return suited ? 'Suited Connector' : 'One-Gap Connector';
  if (gap <= 2 && lo >= 4 && suited) return 'Suited Connector';
  return 'Speculative / Trash';
}

export function extractGameDate(rows) {
  for (const row of rows) {
    if (row.at) {
      const d = new Date(row.at);
      if (!isNaN(d)) return d;
    }
  }
  // Fallback: scan entry text for YYYY-MM-DD
  for (const row of rows) {
    const dateMatch = row.entry.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (dateMatch) {
      return new Date(dateMatch[1], parseInt(dateMatch[2]) - 1, dateMatch[3]);
    }
  }
  return null;
}

export function formatSessionName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date(date);
  return `poker-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()}`;
}

// Format a Date as YYYY-MM-DD using **local** calendar fields. PokerNow `at`
// timestamps are UTC, so an evening game in a negative-offset timezone falls on
// the next UTC day — using toISOString() here would store the date a day ahead
// of the real (local) game date. Always derive the stored date this way so it
// matches formatSessionName and what the player actually saw.
export function toLocalDateStr(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Scan parsed log rows for every player name that appears in the file.
// Pulls names from any quoted "name @ tag" token, which covers joins, stacks,
// dealer/blind announcements, actions, shows, and collects.
export function extractPlayerNames(rows) {
  const names = new Set();
  const re = /"([^"]+?\s*@\s*\w+)"/g;
  for (const row of rows) {
    let m;
    while ((m = re.exec(row.entry)) !== null) {
      const name = extractName(m[1]);
      if (name) names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

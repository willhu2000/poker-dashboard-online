// Build a CSV of per-player stats and a plain-text leaderboard summary, plus a
// helper to trigger a browser download. The string builders are pure (and unit
// tested); downloadFile touches the DOM and is only used in the browser.

const CSV_COLUMNS = [
  ['Player', p => p.name],
  ['Hands', p => p.handsDealt],
  ['Net Chips', p => p.netChips],
  ['VPIP %', p => p.vpip],
  ['PFR %', p => p.pfr],
  ['AF', p => (p.af === 99 ? 'Inf' : p.af)],
  ['Win %', p => p.winRate],
  ['Buy-ins', p => p.buyIns],
  ['Cash Out', p => (p.effectiveCashOut ?? p.cashOut)],
];

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function playersToCsv(players) {
  const sorted = [...players].sort((a, b) => b.netChips - a.netChips);
  const rows = [CSV_COLUMNS.map(c => c[0]).join(',')];
  for (const p of sorted) {
    rows.push(CSV_COLUMNS.map(([, fn]) => csvCell(fn(p))).join(','));
  }
  return rows.join('\n');
}

export function buildTextSummary(players, label, handCount) {
  const sorted = [...players].sort((a, b) => b.netChips - a.netChips);
  const lines = [`Poker — ${label} (${handCount} hands, ${players.length} players)`, ''];
  sorted.forEach((p, i) => {
    const net = (p.netChips >= 0 ? '+' : '') + p.netChips.toLocaleString();
    const af = p.af === 99 ? '∞' : p.af;
    lines.push(`${i + 1}. ${p.name}: ${net}  ·  VPIP ${p.vpip}% / PFR ${p.pfr}% / AF ${af} / Win ${p.winRate}%`);
  });
  return lines.join('\n');
}

export function safeFileName(label, ext) {
  const base = (label || 'poker-summary').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'poker-summary';
  return `${base}.${ext}`;
}

export function downloadFile(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

import { describe, it, expect } from 'vitest';
import { playersToCsv, buildTextSummary, safeFileName } from './exportSummary.js';

const players = [
  { name: 'Bob', handsDealt: 50, netChips: -400, vpip: 28, pfr: 12, af: 1.5, winRate: 14, buyIns: 1000, effectiveCashOut: 600 },
  { name: 'Alice, Jr', handsDealt: 60, netChips: 1250, vpip: 35, pfr: 22, af: 99, winRate: 20, buyIns: 1000, effectiveCashOut: 2250 },
];

describe('playersToCsv', () => {
  const csv = playersToCsv(players);
  const rows = csv.split('\n');

  it('has a header and one row per player, sorted by net chips desc', () => {
    expect(rows[0]).toBe('Player,Hands,Net Chips,VPIP %,PFR %,AF,Win %,Buy-ins,Cash Out');
    expect(rows[1]).toContain('"Alice, Jr"'); // highest net first, comma quoted
    expect(rows[2]).toContain('Bob');
  });

  it('renders the AF infinity sentinel as Inf', () => {
    expect(rows[1]).toContain(',Inf,');
  });
});

describe('buildTextSummary', () => {
  it('ranks players and includes key stats', () => {
    const text = buildTextSummary(players, 'poker-05-13-2026', 110);
    expect(text).toContain('poker-05-13-2026 (110 hands, 2 players)');
    expect(text).toContain('1. Alice, Jr: +1,250');
    expect(text).toContain('2. Bob: -400');
    expect(text).toContain('AF ∞');
  });
});

describe('safeFileName', () => {
  it('sanitizes labels into a safe filename', () => {
    expect(safeFileName('3 of 5 sessions merged', 'csv')).toBe('3-of-5-sessions-merged.csv');
    expect(safeFileName('', 'txt')).toBe('poker-summary.txt');
  });
});

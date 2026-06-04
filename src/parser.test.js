import { describe, it, expect } from 'vitest';
import {
  normaliseCard, classifyHand, hashContent, toLocalDateStr, formatSessionName, extractName,
} from './parser.js';

const c = (s) => ({ rank: s.slice(0, -1), suit: s.slice(-1) });

describe('normaliseCard', () => {
  it('parses Unicode suit symbols', () => {
    expect(normaliseCard('A♠')).toEqual({ rank: 'A', suit: 's' });
    expect(normaliseCard('10♥')).toEqual({ rank: '10', suit: 'h' });
    expect(normaliseCard('Q♦')).toEqual({ rank: 'Q', suit: 'd' });
    expect(normaliseCard('J♣')).toEqual({ rank: 'J', suit: 'c' });
  });

  it('returns null for empty/invalid input', () => {
    expect(normaliseCard('')).toBeNull();
    expect(normaliseCard('xyz')).toBeNull();
  });
});

describe('classifyHand', () => {
  it('classifies premium aces and big slick', () => {
    expect(classifyHand(c('As'), c('Ah'))).toBe('Premium Pair (AA/KK)');
    expect(classifyHand(c('As'), c('Ks'))).toBe('Premium (AKs)');
    expect(classifyHand(c('As'), c('Kh'))).toBe('Premium (AKo)');
  });

  it('classifies trash', () => {
    expect(classifyHand(c('7s'), c('2h'))).toBe('Speculative / Trash');
  });
});

describe('extractName', () => {
  it('strips the "@ tag" suffix', () => {
    expect(extractName('Alice @ aB3xZ')).toBe('Alice');
    expect(extractName('Bob')).toBe('Bob');
  });
});

describe('hashContent', () => {
  it('is deterministic and 8 hex chars', () => {
    const h = hashContent('hello world');
    expect(h).toBe(hashContent('hello world'));
    expect(h).toMatch(/^[0-9a-f]{8}$/);
  });

  it('differs for different content', () => {
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });
});

describe('toLocalDateStr', () => {
  it('formats using local calendar fields (no UTC shift)', () => {
    // Built from local fields, so this is timezone-independent.
    expect(toLocalDateStr(new Date(2026, 4, 13, 22, 30))).toBe('2026-05-13');
    expect(toLocalDateStr(new Date(2026, 0, 1))).toBe('2026-01-01');
  });
});

describe('formatSessionName', () => {
  it('builds poker-MM-DD-YYYY from local fields', () => {
    expect(formatSessionName(new Date(2026, 4, 13))).toBe('poker-05-13-2026');
  });
});

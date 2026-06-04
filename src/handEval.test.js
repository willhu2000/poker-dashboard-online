import { describe, it, expect } from 'vitest';
import { bestHand } from './handEval.js';

// Card helper: 'As' → {rank:'A', suit:'s'}, '10h' → {rank:'10', suit:'h'}
const c = (s) => ({ rank: s.slice(0, -1), suit: s.slice(-1) });
const hand = (hole, board) => bestHand(hole.map(c), board.map(c));

describe('bestHand', () => {
  it('detects a royal flush (rank 9)', () => {
    expect(hand(['Ah', 'Kh'], ['Qh', 'Jh', '10h'])).toEqual({ rank: 9, name: 'Royal Flush' });
  });

  it('detects a straight flush (rank 8)', () => {
    expect(hand(['9h', '8h'], ['7h', '6h', '5h']).rank).toBe(8);
  });

  it('keeps the wheel straight flush (A-2-3-4-5) as a straight flush, not royal', () => {
    expect(hand(['Ah', '2h'], ['3h', '4h', '5h'])).toEqual({ rank: 8, name: 'Straight Flush' });
  });

  it('detects four of a kind (rank 7)', () => {
    expect(hand(['As', 'Ah'], ['Ad', 'Ac', '2h']).rank).toBe(7);
  });

  it('detects a full house (rank 6)', () => {
    expect(hand(['As', 'Ah'], ['Ad', 'Kc', 'Kh']).rank).toBe(6);
  });

  it('detects a flush (rank 5)', () => {
    expect(hand(['Ah', '9h'], ['2h', '5h', '7h']).rank).toBe(5);
  });

  it('detects a straight (rank 4)', () => {
    expect(hand(['9s', '8h'], ['7d', '6c', '5h']).rank).toBe(4);
  });

  it('detects two pair (rank 2)', () => {
    expect(hand(['As', 'Ah'], ['Kc', 'Kh', '2d']).rank).toBe(2);
  });

  it('detects high card (rank 0)', () => {
    expect(hand(['As', '9h'], ['Kc', 'Qd', '2s']).rank).toBe(0);
  });

  it('returns null with fewer than five valid cards', () => {
    expect(bestHand([c('Ah'), c('Kh')], [])).toBeNull();
  });

  it('picks the best 5 of 7 cards', () => {
    // 7 cards: AAA + KK across hole+board → full house (rank 6).
    expect(hand(['As', 'Ad'], ['Ah', 'Kc', 'Kd', '2s', '3h']).rank).toBe(6);
    // A real 5-card heart flush drawn from 7 cards.
    expect(hand(['Ah', '5h'], ['Kh', 'Qh', '2h', '7c', '8d']).rank).toBe(5);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Leaderboard from './components/Leaderboard.jsx';

afterEach(cleanup);

function Boom() { throw new Error('kaboom'); }

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(<ErrorBoundary><div>safe content</div></ErrorBoundary>);
    expect(screen.getByText('safe content')).toBeTruthy();
  });

  it('shows the default fallback when a child throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {}); // silence React's error log
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('kaboom')).toBeTruthy();
    spy.mockRestore();
  });

  it('supports a custom fallback render prop', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary fallback={(e) => <div>custom: {e.message}</div>}><Boom /></ErrorBoundary>);
    expect(screen.getByText('custom: kaboom')).toBeTruthy();
    spy.mockRestore();
  });
});

describe('Leaderboard', () => {
  const players = [
    { name: 'Alice', handsDealt: 50, netChips: 500, vpip: 30, pfr: 20, preflopFoldPct: 60, af: 2.5, winRate: 22, luckiness: 10 },
    { name: 'Bob', handsDealt: 40, netChips: -200, vpip: 45, pfr: 10, preflopFoldPct: 40, af: 0.8, winRate: 12, luckiness: 5 },
  ];

  it('renders a row per player and fires onSelect when a row is clicked', () => {
    const onSelect = vi.fn();
    render(<Leaderboard players={players} onSelect={onSelect} selected={null} />);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    fireEvent.click(screen.getByText('Alice'));
    expect(onSelect).toHaveBeenCalledWith('Alice');
  });

  it('renders the infinite aggression factor as ∞', () => {
    render(<Leaderboard players={[{ ...players[0], af: 99 }]} onSelect={() => {}} selected={null} />);
    expect(screen.getByText('∞')).toBeTruthy();
  });
});

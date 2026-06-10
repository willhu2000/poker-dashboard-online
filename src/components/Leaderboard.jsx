import { useState } from 'react';
import { SortTh } from './cardUI.jsx';

// Sortable columns: [key, label]. '#' (rank) and Style aren't sortable.
const COLS = [
  ['handsDealt', 'Hands'],
  ['netChips', 'Net Chips'],
  ['vpip', 'VPIP'],
  ['pfr', 'PFR'],
  ['preflopFoldPct', 'Fold%'],
  ['af', 'AF'],
  ['winRate', 'Win%'],
  ['luckiness', 'Luck†'],
];

export default function Leaderboard({ players, onSelect, selected }) {
  const [sortCol, setSortCol] = useState('netChips');
  const [sortDir, setSortDir] = useState('desc');

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir(col === 'name' ? 'asc' : 'desc'); }
  }

  const sorted = [...players].sort((a, b) => {
    const cmp = sortCol === 'name'
      ? a.name.localeCompare(b.name)
      : (a[sortCol] ?? 0) - (b[sortCol] ?? 0);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return (
    <table className="lb-table">
      <thead>
        <tr>
          <th>#</th>
          <SortTh col="name" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Player</SortTh>
          {COLS.map(([key, label]) => (
            <SortTh key={key} col={key} sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>{label}</SortTh>
          ))}
          <th>Style</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p, i) => {
          const tight = p.vpip < 20; // matches the glossary + PlayerDetail style tags
          const loose = p.vpip > 50;
          const agg = p.af > 2;

          return (
            <tr
              key={p.name}
              style={{ cursor: 'pointer', background: selected === p.name ? 'var(--surface2)' : '' }}
              onClick={() => onSelect(p.name)}
            >
              <td className="rank">{i + 1}</td>
              <td><strong>{p.name}</strong></td>
              <td>{p.handsDealt}</td>
              <td className={p.netChips >= 0 ? 'pos' : 'neg'}>
                {p.netChips >= 0 ? '+' : ''}{p.netChips}
              </td>
              <td>
                <div className="range-bar-wrap">
                  <div className="range-bar" style={{ width: `${Math.min(p.vpip, 100)}%`, maxWidth: 60 }} />
                  <span className="range-label">{p.vpip}%</span>
                </div>
              </td>
              <td>{p.pfr}%</td>
              <td>{p.preflopFoldPct}%</td>
              <td>{p.af === 99 ? '∞' : p.af}</td>
              <td>{p.winRate}%</td>
              <td>{p.luckiness}%</td>
              <td>
                <span className={`tag ${tight ? 'tight' : loose ? 'loose' : ''}`} style={{ marginRight: 4 }}>
                  {tight ? 'Tight' : loose ? 'Loose' : 'Semi'}
                </span>
                <span className={`tag ${agg ? 'agg' : ''}`}>
                  {agg ? 'Agg' : p.af < 1 ? 'Passive' : 'Bal'}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function Leaderboard({ players, onSelect, selected }) {
  return (
    <table className="lb-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th>Hands</th>
          <th>Net Chips</th>
          <th>VPIP</th>
          <th>PFR</th>
          <th>Fold%</th>
          <th>AF</th>
          <th>Win%</th>
          <th>Luck†</th>
          <th>Style</th>
        </tr>
      </thead>
      <tbody>
        {players.map((p, i) => {
          const tight = p.vpip < 25;
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

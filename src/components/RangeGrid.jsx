import { useState } from 'react';

const RANKS_DESC = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];

function handKey(c1, c2) {
  const toR = r => r === '10' ? 'T' : r;
  const r1 = toR(c1.rank), r2 = toR(c2.rank);
  const i1 = RANKS_DESC.indexOf(r1), i2 = RANKS_DESC.indexOf(r2);
  if (i1 === i2) return r1 + r2;
  const suited = c1.suit === c2.suit && c1.suit !== '?';
  const [hi, lo] = i1 < i2 ? [r1, r2] : [r2, r1];
  return hi + lo + (suited ? 's' : 'o');
}

// Quantized color stops: blue → purple → magenta → hot pink
const RANGE_STOPS = [
  [30, 80, 220],   // 0: blue
  [70, 60, 200],   // 1
  [110, 50, 190],  // 2
  [145, 40, 180],  // 3
  [175, 35, 165],  // 4
  [200, 30, 150],  // 5
  [220, 28, 130],  // 6
  [235, 30, 110],  // 7
  [245, 30, 90],   // 8
  [255, 40, 100],  // 9: hot pink
];

function cellBg(count, maxCount) {
  if (!count || !maxCount) return '#1e2035';
  if (maxCount <= 10) {
    // Quantized: pick a distinct stop for each count
    const idx = Math.min(count, RANGE_STOPS.length) - 1;
    const [r, g, b] = RANGE_STOPS[Math.round(idx * (RANGE_STOPS.length - 1) / Math.max(maxCount - 1, 1))];
    return `rgb(${r}, ${g}, ${b})`;
  }
  // Smooth interpolation for larger counts
  const t = Math.sqrt(count / maxCount);
  const r = Math.round(30 + t * (255 - 30));
  const g = Math.round(80 + t * (40 - 80));
  const b = Math.round(220 + t * (100 - 220));
  return `rgb(${r}, ${g}, ${b})`;
}

export default function RangeGrid({ rangeHands }) {
  // Click a "times played" key to highlight only the hands played that many
  // times (and dim the rest); click again to clear. Mirrors the pie's toggle.
  const [selectedCount, setSelectedCount] = useState(null);
  const toggleCount = (n) => setSelectedCount(prev => (prev === n ? null : n));

  const freq = {};
  for (const { c1, c2 } of rangeHands) {
    if (!c1 || !c2) continue;
    const k = handKey(c1, c2);
    freq[k] = (freq[k] || 0) + 1;
  }
  const maxCount = Math.max(1, ...Object.values(freq));
  return (
    <div className="range-grid-wrap">
      <div className="range-grid">
        {RANKS_DESC.map((rowR, i) => RANKS_DESC.map((colR, j) => {
          const key = i === j ? rowR + colR : i < j ? rowR + colR + 's' : colR + rowR + 'o';
          const count = freq[key] || 0;
          const label = i === j ? rowR + rowR : i < j ? rowR + colR + 's' : colR + rowR + 'o';
          const selecting = selectedCount != null;
          const isMatch = selecting && count === selectedCount;
          let opacity = count > 0 ? 0.35 + 0.65 * Math.sqrt(count / maxCount) : undefined;
          if (selecting && !isMatch) opacity = (opacity ?? 1) * 0.15;     // dim non-matching
          else if (isMatch) opacity = count > 0 ? Math.max(opacity, 0.92) : 0.85; // emphasize match
          return (
            <div key={key} title={`${label}: ${count} hand${count !== 1 ? 's' : ''}`}
              className={`range-cell${count > 0 ? ' played' : ''}${isMatch ? ' rc-match' : ''}`}
              style={{ background: cellBg(count, maxCount), opacity }}>
              {label}
            </div>
          );
        }))}
      </div>
      <div className="range-legend">
        {maxCount <= 10 ? (
          <div className="range-legend-steps">
            {Array.from({ length: maxCount + 1 }, (_, n) => (
              <div
                key={n}
                className={`range-step clickable${selectedCount === n ? ' selected' : ''}`}
                onClick={() => toggleCount(n)}
                role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCount(n); } }}
                title={`Highlight hands played ${n} time${n !== 1 ? 's' : ''}`}
              >
                <div className="range-swatch" style={{ background: n === 0 ? '#1e2035' : cellBg(n, maxCount) }} />
                <span>{n}</span>
              </div>
            ))}
            <span className="range-legend-caption">times played</span>
          </div>
        ) : (
          <div className="range-legend-bar">
            <span className="range-legend-label">0</span>
            <div className="range-legend-gradient" />
            <span className="range-legend-label">{maxCount}</span>
            <span className="range-legend-caption">times played</span>
          </div>
        )}
        <p className="range-legend-help">
          {maxCount <= 10 && <>Click a count to highlight those hands · </>}
          Suited upper-right · pairs diagonal · offsuit lower-left
        </p>
      </div>
    </div>
  );
}

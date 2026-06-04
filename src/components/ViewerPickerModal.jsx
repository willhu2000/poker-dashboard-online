import { useEffect, useState } from 'react';

// Modal shown after a CSV is selected. The user picks which player at the
// table is them, so "Your hand is …" lines from the log get attributed to
// the right person rather than guessed from the player names.
export default function ViewerPickerModal({ fileName, playerNames, onConfirm, onCancel, remaining = 1 }) {
  const [selected, setSelected] = useState(playerNames[0] || '');

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && selected) onConfirm(selected);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, onConfirm, onCancel]);

  return (
    <div className="viewer-picker-overlay" onClick={onCancel}>
      <div className="viewer-picker-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Whose log is this?</h2>
        <p className="viewer-picker-sub">
          PokerNow records hole cards (<code>Your hand is …</code>) from the
          perspective of whoever downloaded the log. Pick that player so the
          cards land on the right person.
        </p>
        <div className="viewer-picker-file">
          📄 <strong>{fileName}</strong>
          {remaining > 1 && <span style={{ color: 'var(--muted)', marginLeft: 8 }}>· {remaining} files left</span>}
        </div>

        {playerNames.length === 0 ? (
          <p style={{ color: 'var(--red)' }}>No player names were found in this log.</p>
        ) : (
          <>
            <label className="viewer-picker-label" htmlFor="viewer-picker-select">I am…</label>
            <select
              id="viewer-picker-select"
              className="viewer-picker-select"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              autoFocus
            >
              {playerNames.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </>
        )}

        <div className="viewer-picker-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!selected}
            onClick={() => onConfirm(selected)}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

// Small shared formatting helpers (plain functions — JSX-free so component
// files can stay components-only for react-refresh).

// "YYYY-MM-DD" → "MM-DD-YYYY" (matches formatSessionName ordering).
export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${m}-${d}-${y}`;
}

// Given the streets a (losing) hand held the lead on (['flop','turn',...]),
// name the street where the opponent overtook it. Null when the list is empty
// (never ahead) or the lead held through the river (side-pot / chop edge case).
export function overtakenStreet(aheadOn) {
  if (!aheadOn || !aheadOn.length) return null;
  const last = aheadOn[aheadOn.length - 1];
  if (last === 'flop') return 'turn';
  if (last === 'turn') return 'river';
  return null;
}

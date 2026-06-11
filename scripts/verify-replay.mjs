// Check the replayer's pot math balances for every hand in a real log:
// after the last frame the pot must be fully distributed (0 left).
import { readFileSync } from 'node:fs';
import { parseLog } from '../src/parser.js';
import { analyseLog } from '../src/stats.js';
import { buildReplayFrames } from '../src/replayEngine.js';

const rows = parseLog(readFileSync(process.argv[2], 'utf8'));
const { handActionLogs } = analyseLog(rows, 'Will');
let bad = 0;
for (const [num, log] of Object.entries(handActionLogs)) {
  const { frames } = buildReplayFrames(log, null, null);
  const last = frames[frames.length - 1];
  if (!last) continue;
  if (last.pot !== 0) { console.log(`hand #${num}: leftover pot ${last.pot}`); bad++; }
}
console.log(bad === 0 ? 'ALL REPLAYS BALANCE' : `${bad} hands with leftover pot`);

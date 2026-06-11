// One-off verification: run the real parser/stats over a PokerNow CSV and
// cross-check per-hand nets against the next hand's "Player stacks:" snapshot.
import { readFileSync } from 'node:fs';
import { parseLog, extractName, cardToString } from '../src/parser.js';
import { analyseLog } from '../src/stats.js';

const file = process.argv[2];
const csv = readFileSync(file, 'utf8');
const rows = parseLog(csv);
const { players, handCount } = analyseLog(rows, 'Will');

console.log('hands:', handCount);

// ── Independent ground truth: stack snapshots + buy-in/quit events per hand ──
// Walk rows; record each hand's starting stacks; net(hand N) for player P
// should equal stacks[N+1][P] - stacks[N][P] minus any top-up between them.
const handStacks = []; // [{num, stacks: {name: stack}}]
const adjustments = {}; // name -> [{afterHand, amount}] buy-ins between hands
let curHandNum = null;
const buyinsBetween = {}; // name -> amount accumulated since last hand start
for (const row of rows) {
  const e = row.entry;
  const start = e.match(/^-- starting hand #(\d+) /);
  if (start) { curHandNum = parseInt(start[1], 10); continue; }
  const stacks = e.match(/^Player stacks: (.+)$/);
  if (stacks) {
    const map = {};
    for (const part of stacks[1].split(' | ')) {
      const m = part.match(/^#(\d+) "(.+)" \((\d+)\)$/);
      if (m) map[extractName(m[2])] = parseInt(m[3], 10);
    }
    handStacks.push({ num: curHandNum, stacks: map });
  }
}

// Per-hand nets from stats (handsHistory has net + stack per player per hand)
const handNets = {}; // num -> {name: net}
const handStackStats = {}; // num -> {name: stack as stored in stats}
for (const p of Object.values(players)) {
  for (const h of p.handsHistory) {
    (handNets[h.num] ||= {})[p.name] = h.net;
    (handStackStats[h.num] ||= {})[p.name] = h.stack;
  }
}

let mismatches = 0;
for (let i = 0; i < handStacks.length - 1; i++) {
  const cur = handStacks[i], next = handStacks[i + 1];
  if (next.num !== cur.num + 1) continue; // gap, skip
  for (const [name, stack] of Object.entries(cur.stacks)) {
    if (!(name in next.stacks)) continue; // left / stood up — can't verify
    const expected = next.stacks[name] - stack;
    const computed = handNets[cur.num]?.[name];
    if (computed === undefined) {
      console.log(`hand #${cur.num} ${name}: no net computed (expected ${expected})`);
      mismatches++;
    } else if (computed !== expected) {
      // top-ups between hands show as stack jumps; only flag if no obvious buy-in
      console.log(`hand #${cur.num} ${name}: computed net ${computed}, stack delta ${expected}`);
      mismatches++;
    }
  }
}
console.log(mismatches === 0 ? 'ALL HAND NETS MATCH STACK DELTAS' : `${mismatches} mismatches`);

// ── Pot conservation: per hand, sum of all nets should be 0 ──
for (const [num, nets] of Object.entries(handNets)) {
  const total = Object.values(nets).reduce((s, n) => s + n, 0);
  if (total !== 0) console.log(`hand #${num}: nets sum to ${total} (should be 0)`);
}

// ── Session nets vs buy-in/cash-out ──
console.log('\n— players —');
for (const p of Object.values(players)) {
  const sumHandNets = p.handsHistory.reduce((s, h) => s + h.net, 0);
  console.log(`${p.name}: netChips=${p.netChips} buyIns=${p.buyIns} cashOut=${p.cashOut} effCashOut=${p.effectiveCashOut} sumHandNets=${sumHandNets} dealt=${p.handsDealt} won=${p.handsWon}`);
}

// ── Key hands for the viewer ──
const will = players['Will'];
const fmt = (h) => `#${h.num} ${h.c1 ? cardToString(h.c1) + cardToString(h.c2) : '??'} pot=${h.potSize} won=${h.wonAmount ?? '-'} net=${h.net} split=${h.isSplit} shown=${h.wasShown}`;
const takeHome = (h) => h.wonAmount ?? h.potSize;
console.log('\n— Will biggest wins (solo) —');
[...will.handsHistory].filter(h => h.won && !h.isSplit && takeHome(h) > 0)
  .sort((a, b) => takeHome(b) - takeHome(a)).slice(0, 5).forEach(h => console.log(fmt(h)));
console.log('— Will biggest splits —');
[...will.handsHistory].filter(h => h.won && h.isSplit && takeHome(h) > 0)
  .sort((a, b) => takeHome(b) - takeHome(a)).slice(0, 5).forEach(h => console.log(fmt(h)));
console.log('— Will biggest losses (by chips lost) —');
[...will.handsHistory].filter(h => !h.won && h.net < 0)
  .sort((a, b) => a.net - b.net).slice(0, 5).forEach(h => console.log(fmt(h)));
console.log('— Will bad beats —');
will.badBeats.forEach(b => console.log(`#${b.num} ${cardToString(b.c1)}${cardToString(b.c2)} (${b.myHandName}) lost to ${b.oppName} ${cardToString(b.oppC1)}${cardToString(b.oppC2)} (${b.oppHandName}) pot=${b.potSize} net=${b.net} aheadOn=${b.aheadOn}`));
console.log('— Will suck-outs —');
will.suckOuts.forEach(s => console.log(`#${s.num} ${cardToString(s.c1)}${cardToString(s.c2)} (${s.myHandName}) beat ${s.oppName} ${cardToString(s.oppC1)}${cardToString(s.oppC2)} (${s.oppHandName}) pot=${s.potSize} won=${s.wonAmount}`));
console.log('— Will coolers —');
will.coolers.forEach(c => console.log(`#${c.num} ${cardToString(c.c1)}${cardToString(c.c2)} (${c.myHandName}) vs ${c.oppName} ${cardToString(c.oppC1)}${cardToString(c.oppC2)} (${c.oppHandName}) pot=${c.potSize} net=${c.net} won=${c.won}`));

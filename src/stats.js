import { extractName, normaliseCard, classifyHand } from './parser.js';
import { bestHand } from './handEval.js';

// ──────────────────────────────────────────────────────────────────────────────
// Hand-level state machine
// ──────────────────────────────────────────────────────────────────────────────

// Empty per-position counter: hands / vpip / pfr / wins.
function zPos() { return { h: 0, v: 0, p: 0, w: 0 }; }

function emptyHand() {
  return {
    id: null,
    number: null,
    players: {},          // { displayName: { seat, stack } }
    seats: {},            // { displayName: seatNumber } from the Player stacks line
    bbSize: null,         // big-blind size posted this hand
    preflopActions: {},   // { displayName: ['fold'|'call'|'raise'|'check'|'bet'] }
    street: 'preflop',
    shownCards: {},       // { displayName: [card1, card2] }
    winners: [],          // [{ name, amount }]
    board: [],            // up to 5 cards
    viewerCards: null,    // [card1, card2] for "Your hand is"
    pots: [],
    dealer: null,         // player name who is dealer
    sb: null,             // player name who is small blind
    bb: null,             // player name who is big blind
    actionLog: [],        // [{type:'action'|'street', street, player?, action?, amount?}, ...]
  };
}

// Assign a position label to each dealt player from seat order + the dealer.
// Returns { name: 'BTN'|'SB'|'BB'|'LP'|'MP'|'EP' } or {} if the dealer is unknown.
function positionsFor(hand) {
  const dealtNames = Object.keys(hand.players);
  if (!hand.dealer || !(hand.dealer in hand.seats)) return {};
  // Order players clockwise by physical seat number.
  const ordered = dealtNames
    .filter(n => hand.seats[n] != null)
    .sort((a, b) => hand.seats[a] - hand.seats[b]);
  const n = ordered.length;
  if (n < 2) return {};
  const dealerIdx = ordered.indexOf(hand.dealer);
  if (dealerIdx < 0) return {};
  const out = {};
  for (let i = 0; i < n; i++) {
    const offset = (i - dealerIdx + n) % n; // 0 = button, 1 = SB, 2 = BB, …
    let label;
    if (offset === 0) label = 'BTN';
    else if (offset === 1) label = n === 2 ? 'BTN' : 'SB'; // heads-up: button is SB
    else if (offset === 2) label = 'BB';
    else if (offset === n - 1) label = 'LP';               // cutoff
    else label = (offset - 3) < (n - 3) / 2 ? 'EP' : 'MP'; // split the middle
    out[ordered[i]] = label;
  }
  return out;
}

// Exact chips in/out per player for one hand, derived from the action log.
// `call`/`raise` amounts are "to" totals for the street, so deltas need
// per-street bet tracking (same model as the replayer). Returns name → net.
function chipDeltas(actionLog) {
  const streetBet = {};
  const net = {};
  for (const ev of actionLog) {
    if (ev.type === 'street') { for (const k of Object.keys(streetBet)) streetBet[k] = 0; continue; }
    if (ev.type !== 'action') continue;
    const amt = ev.amount || 0;
    const name = ev.player;
    if (!(name in net)) { net[name] = 0; streetBet[name] = 0; }
    if (ev.action === 'post-sb' || ev.action === 'post-bb' || ev.action === 'bet') {
      net[name] -= amt; streetBet[name] += amt;
    } else if (ev.action === 'post-dead-sb') {
      net[name] -= amt; // dead money: goes in the pot but doesn't count toward calling
    } else if (ev.action === 'call' || ev.action === 'raise') {
      const d = Math.max(0, amt - streetBet[name]);
      net[name] -= d; streetBet[name] += d;
    } else if (ev.action === 'return') {
      net[name] += amt; streetBet[name] = Math.max(0, streetBet[name] - amt);
    } else if (ev.action === 'collect') {
      net[name] += amt;
    }
  }
  return net;
}

// Streets (of those dealt) where `cards` beat `oppCards` outright — used to
// tell a true bad beat ("ahead until the river") from a hand that was never
// in front. Scores are kicker-aware via bestHand.
function streetsAhead(cards, oppCards, board) {
  const out = [];
  for (const [street, n] of [['flop', 3], ['turn', 4], ['river', 5]]) {
    if (board.length < n) break;
    const mine = bestHand(cards, board.slice(0, n));
    const theirs = bestHand(oppCards, board.slice(0, n));
    if (mine && theirs && mine.score > theirs.score) out.push(street);
  }
  return out;
}

// Walk a hand's action log to credit 3-bet (a preflop re-raise facing one open)
// and continuation-bet (the preflop aggressor making the first flop bet)
// opportunities + actions. Approximations suitable for a home-game tool.
function accumulatePreflopAggression(hand, getPlayer) {
  let preflopRaises = 0;        // raises/bets seen so far preflop
  let lastPreflopRaiser = null; // the preflop aggressor
  let firstFlopBettor = null;
  let flopDealt = false;

  for (const ev of hand.actionLog) {
    if (ev.type === 'street') { if (ev.street === 'flop') flopDealt = true; continue; }
    if (ev.type !== 'action') continue;
    if (ev.street === 'preflop') {
      if (ev.action === 'raise' || ev.action === 'bet') {
        if (preflopRaises === 1) { const p = getPlayer(ev.player); p.threeBetOpp++; p.threeBets++; }
        preflopRaises++;
        lastPreflopRaiser = ev.player;
      } else if (ev.action === 'call' || ev.action === 'fold') {
        if (preflopRaises === 1) getPlayer(ev.player).threeBetOpp++;
      }
    } else if (ev.street === 'flop' && firstFlopBettor === null && ev.action === 'bet') {
      firstFlopBettor = ev.player;
    }
  }

  if (lastPreflopRaiser && (flopDealt || hand.board.length >= 3)) {
    const agg = getPlayer(lastPreflopRaiser);
    agg.cbetOpp++;
    if (firstFlopBettor === lastPreflopRaiser) agg.cbets++;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Main analyser
// ──────────────────────────────────────────────────────────────────────────────

// `viewerName` (optional) is the name of the player who downloaded the log —
// PokerNow emits `Your hand is …` from that player's perspective. When omitted,
// we fall back to a heuristic that matches a player whose name starts with
// "will" (used for the bundled sample logs that ship with the app).
export function analyseLog(rows, viewerName = null) {
  const players = {};   // displayName → stats object
  let currentHand = null;
  let handCount = 0;
  const handActionLogs = {}; // hand number → actionLog (stored once, not per-player)

  function getPlayer(name) {
    if (!players[name]) {
      players[name] = {
        name,
        handsDealt: 0,
        // preflop
        vpipHands: 0,    // voluntarily put $ in preflop
        pfrHands: 0,     // preflop raise
        preflopFolds: 0,
        // aggression
        totalBetsRaises: 0,
        totalCalls: 0,
        totalChecks: 0,
        // showdown
        shownHands: [],          // [{c1,c2,won}] — kept for backwards compat
        handCategories: {},      // category → count
        // chip tracking
        netChips: 0,
        buyIns: 0,
        cashOut: 0,
        // Final standings need this when the log ends with the player still seated:
        // PokerNow only emits a `quits the game with stack of N` event when a player
        // actually leaves. For everyone else `cashOut` stays at 0 and net = -buyIns.
        // We snapshot `lastSeenStack` from each `Player stacks:` line and add it back
        // in `effectiveCashOut` if the player has not quit since their most recent buy-in.
        lastSeenStack: 0,
        lastBuyInOrder: -1,
        lastQuitOrder: -1,
        standUpStack: null,  // chips parked by "stand up", consumed by the re-join

        // street actions
        streetActions: { preflop: 0, flop: 0, turn: 0, river: 0 },
        // luck proxy: premium hands shown at showdown
        premiumHandsShown: 0,
        allHandsShown: 0,
        // wins
        handsWon: 0,
        handsSplit: 0,   // pots shared with ≥1 other winner
        // ── Advanced analytics accumulators ──────────────────────────────────
        // Per-position counts: { h: hands, v: vpipHands, p: pfrHands, w: wins }.
        posStats: { BTN: zPos(), SB: zPos(), BB: zPos(), LP: zPos(), MP: zPos(), EP: zPos() },
        // Showdown funnel (denominators for WTSD / W$SD).
        sawFlopHands: 0,   // didn't fold preflop and a flop was dealt
        wtsdHands: 0,      // of those, reached showdown
        wsdHands: 0,       // of those, won
        // Preflop 3-bet and flop continuation-bet opportunities/actions.
        threeBetOpp: 0, threeBets: 0,
        cbetOpp: 0, cbets: 0,
        // Big-blind sizes seen (size → hands), for a representative bb/100.
        bbCounts: {},
        // Head-to-head showdown record vs each opponent: { name: { w, l } }.
        vsOpponents: {},
        // preflop range tracking (all observed hole cards)
        rangeHands: [],
        // full hand history (all dealt hands, showdown or not)
        handsHistory: [],
        // detected bad beats (hands where this player lost with a strong hand)
        badBeats: [],
        // suck-outs (hands where this player won against a strong hand)
        suckOuts: [],
        // coolers (both players had strong hands at showdown)
        coolers: [],
      };
    }
    return players[name];
  }

  function commitHand(hand) {
    if (!hand || !hand.id) return;
    handCount++;

    const dealtNames = Object.keys(hand.players);
    const positions = positionsFor(hand);
    // Prepend a `players` meta entry (seats, starting stacks, positions, blinds)
    // so the hand replayer can draw the table. Consumers that walk the log for
    // actions ignore non-action entries.
    const playersMeta = {
      type: 'players',
      dealer: hand.dealer, sb: hand.sb, bb: hand.bb, bbSize: hand.bbSize,
      players: dealtNames.map(n => ({
        name: n,
        seat: hand.seats[n] ?? null,
        stack: hand.players[n]?.stack ?? null,
        pos: positions[n] ?? null,
      })),
    };
    handActionLogs[hand.number] = [playersMeta, ...hand.actionLog];

    const potSize = hand.winners.reduce((s, w) => s + w.amount, 0);
    const winnerSet = new Set(hand.winners.map(w => w.name));
    // A split pot has two or more *distinct* winners sharing the same showdown.
    // (Multiple `collected` lines for a single player are side pots, not a split.)
    const distinctWinners = [...winnerSet];
    const isSplitPot = distinctWinners.length >= 2;
    // The actual chips a player took home — sums every pot (main + side) they
    // collected. This is what the "biggest pot" stats rank on, not the total pot.
    const takeHome = (name) => hand.winners
      .filter(w => w.name === name)
      .reduce((s, w) => s + w.amount, 0);
    const viewerName = findViewerName(hand);

    // ── VPIP / PFR / fold + position + showdown-funnel tracking ────────────────
    const reachedFlop = hand.board.length >= 3;
    for (const name of dealtNames) {
      const p = getPlayer(name);
      p.handsDealt++;

      const actions = hand.preflopActions[name] || [];
      const firstVoluntary = actions.find(a => ['call', 'raise', 'bet'].includes(a));
      const raisedPreflop = actions.includes('raise') || actions.includes('bet');
      const foldedPreflop = actions.includes('fold');

      if (firstVoluntary) p.vpipHands++;
      if (raisedPreflop) p.pfrHands++;
      if (foldedPreflop) p.preflopFolds++;

      for (const a of actions) {
        if (a === 'raise' || a === 'bet') p.totalBetsRaises++;
        else if (a === 'call') p.totalCalls++;
        else if (a === 'check') p.totalChecks++;
      }

      // Per-position counts (hands / vpip / pfr / wins).
      const pos = positions[name];
      if (pos && p.posStats[pos]) {
        const ps = p.posStats[pos];
        ps.h++;
        if (firstVoluntary) ps.v++;
        if (raisedPreflop) ps.p++;
        if (winnerSet.has(name)) ps.w++;
      }

      // Showdown funnel: saw flop → reached showdown (WTSD) → won there (W$SD).
      if (reachedFlop && !foldedPreflop) {
        p.sawFlopHands++;
        if (hand.shownCards[name]) {
          p.wtsdHands++;
          if (winnerSet.has(name)) p.wsdHands++;
        }
      }

      // Big-blind size seen this hand (for a representative bb/100).
      if (hand.bbSize) p.bbCounts[hand.bbSize] = (p.bbCounts[hand.bbSize] || 0) + 1;
    }

    // ── 3-bet (preflop) and continuation-bet (flop) ───────────────────────────
    accumulatePreflopAggression(hand, getPlayer);

    // ── Head-to-head showdown records ─────────────────────────────────────────
    const shownDown = Object.keys(hand.shownCards).filter(n => {
      const c = hand.shownCards[n]; return c && c[0] && c[1];
    });
    // Iterate over every pair at showdown. Only record a result when exactly
    // one of the two players won — guarantees A's wins vs B always equals B's
    // losses vs A. Both won = chop (push). Neither won = a third player
    // scooped; no h2h result between these two.
    if (shownDown.length >= 2) {
      for (let i = 0; i < shownDown.length; i++) {
        for (let j = i + 1; j < shownDown.length; j++) {
          const a = shownDown[i], b = shownDown[j];
          const aWon = winnerSet.has(a), bWon = winnerSet.has(b);
          if (aWon === bWon) continue; // chop or third-party scoop — no result
          const winner = aWon ? a : b;
          const loser  = aWon ? b : a;
          const pw = getPlayer(winner);
          (pw.vsOpponents[loser] || (pw.vsOpponents[loser] = { w: 0, l: 0 })).w++;
          const pl = getPlayer(loser);
          (pl.vsOpponents[winner] || (pl.vsOpponents[winner] = { w: 0, l: 0 })).l++;
        }
      }
    }

    // ── Showdown cards ────────────────────────────────────────────────────────
    for (const [name, cards] of Object.entries(hand.shownCards)) {
      const p = getPlayer(name);
      const won = winnerSet.has(name);
      const [c1, c2] = cards;
      if (c1 && c2) {
        const cat = classifyHand(c1, c2);
        p.shownHands.push({ c1, c2, won, hand: hand.number });
        p.handCategories[cat] = (p.handCategories[cat] || 0) + 1;
        p.allHandsShown++;
        p.rangeHands.push({ c1, c2 });
        // Premium = AA/KK/QQ/JJ/AK (matches the glossary and the viewer-cards
        // branch below — keep both definitions identical or luckiness skews).
        if (cat.startsWith('Premium') || cat.startsWith('Strong Pair')) {
          p.premiumHandsShown++;
        }
      }
    }

    // ── Winners ───────────────────────────────────────────────────────────────
    // Iterate distinct names so a player who scoops a main + side pot only
    // counts as a single win.
    for (const name of distinctWinners) {
      const wp = getPlayer(name);
      wp.handsWon++;
      if (isSplitPot) wp.handsSplit++;
    }

    // ── Viewer cards (Will's hand — shown every hand) ─────────────────────────
    if (hand.viewerCards && viewerName) {
      const [c1, c2] = hand.viewerCards;
      if (c1 && c2) {
        const p = getPlayer(viewerName);
        const cat = classifyHand(c1, c2);
        if (!hand.shownCards[viewerName]) {
          p.allHandsShown++;
          p.handCategories[cat] = (p.handCategories[cat] || 0) + 1;
          p.rangeHands.push({ c1, c2 });
          if (cat.startsWith('Premium') || cat.startsWith('Strong Pair')) {
            p.premiumHandsShown++;
          }
        }
      }
    }

    // ── Bad beat detection ────────────────────────────────────────────────────
    // Uses every hand we know at showdown: players who showed, plus the
    // viewer's dealt cards when they reached showdown but mucked (PokerNow only
    // logs the winner's "shows" line, so the viewer's big showdown losses would
    // otherwise be invisible). A player who folded never reached showdown, so
    // their cards (even if voluntarily shown) don't count.
    const foldedSet = new Set(hand.actionLog
      .filter(ev => ev.type === 'action' && ev.action === 'fold')
      .map(ev => ev.player));
    const handNet = chipDeltas(hand.actionLog);
    const knownCards = { ...hand.shownCards };
    if (viewerName && !knownCards[viewerName] && !foldedSet.has(viewerName)
        && hand.viewerCards?.[0] && hand.viewerCards?.[1]) {
      knownCards[viewerName] = hand.viewerCards;
    }
    const shownNames = Object.keys(knownCards).filter(n => !foldedSet.has(n));
    if (shownNames.length >= 2 && hand.board.length >= 3) {
      for (const loserName of shownNames) {
        if (winnerSet.has(loserName)) continue;
        const lc = knownCards[loserName];
        if (!lc || !lc[0] || !lc[1]) continue;

        const loserEval = bestHand(lc, hand.board);
        if (!loserEval || loserEval.rank < 2) continue; // Two Pair minimum

        for (const winnerName of winnerSet) {
          const wc = knownCards[winnerName];
          if (!wc || !wc[0] || !wc[1]) continue;

          const winnerEval = bestHand(wc, hand.board);
          if (!winnerEval) continue;

          const entry = {
            num: hand.number,
            board: hand.board.slice(),
            potSize,
          };

          // Streets where the loser was genuinely in front — distinguishes
          // "ahead until the river" from "was never ahead" (closer to a cooler).
          const aheadOn = streetsAhead(lc, wc, hand.board);

          // Record on the loser as a bad beat. `net` is the loser's actual
          // chips lost this hand (negative) — pots are mostly other people's
          // money, so "Lost <pot>" overstated every loss.
          getPlayer(loserName).badBeats.push({
            ...entry,
            net: handNet[loserName] ?? null,
            c1: lc[0], c2: lc[1],
            myHandName: loserEval.name,
            myHandRank: loserEval.rank,
            oppName: winnerName,
            oppC1: wc[0], oppC2: wc[1],
            oppHandName: winnerEval.name,
            aheadOn,
          });

          // Record on the winner as a suck-out
          const winnerWonAmount = hand.winners.find(w => w.name === winnerName)?.amount ?? potSize;
          getPlayer(winnerName).suckOuts.push({
            ...entry,
            net: handNet[winnerName] ?? null,
            c1: wc[0], c2: wc[1],
            myHandName: winnerEval.name,
            myHandRank: winnerEval.rank,
            oppName: loserName,
            oppC1: lc[0], oppC2: lc[1],
            oppHandName: loserEval.name,
            oppHandRank: loserEval.rank, // severity = what we beat
            wonAmount: winnerWonAmount,
            behindOn: aheadOn, // streets the winner was trailing on
          });

          // Record cooler when both players had strong hands
          // (loser Two Pair+ already guaranteed, winner needs Trips+)
          if (winnerEval.rank >= 3) {
            const coolerBase = { num: hand.number, board: hand.board.slice(), potSize };
            getPlayer(loserName).coolers.push({
              ...coolerBase,
              net: handNet[loserName] ?? null,
              c1: lc[0], c2: lc[1],
              myHandName: loserEval.name, myHandRank: loserEval.rank,
              oppName: winnerName,
              oppC1: wc[0], oppC2: wc[1],
              oppHandName: winnerEval.name, oppHandRank: winnerEval.rank,
              won: false,
            });
            getPlayer(winnerName).coolers.push({
              ...coolerBase,
              net: handNet[winnerName] ?? null,
              wonAmount: winnerWonAmount,
              c1: wc[0], c2: wc[1],
              myHandName: winnerEval.name, myHandRank: winnerEval.rank,
              oppName: loserName,
              oppC1: lc[0], oppC2: lc[1],
              oppHandName: loserEval.name, oppHandRank: loserEval.rank,
              won: true,
            });
          }
        }
      }
    }

    // ── Hand history (all dealt hands, for the expandable table) ──────────────
    for (const name of dealtNames) {
      const p = getPlayer(name);
      const shownCards = hand.shownCards[name];

      let c1 = null, c2 = null;
      if (shownCards && shownCards[0] && shownCards[1]) {
        [c1, c2] = shownCards;
      } else if (name === viewerName && hand.viewerCards?.[0] && hand.viewerCards?.[1]) {
        [c1, c2] = hand.viewerCards;
      }

      const won = winnerSet.has(name);
      const wasShown = !!(shownCards && shownCards[0] && shownCards[1]);
      const wonAmount = won ? takeHome(name) : null;
      const isSplit = won && isSplitPot;
      const splitWith = isSplit ? distinctWinners.filter(n => n !== name) : [];
      const isBadBeat = p.badBeats.some(bb => bb.num === hand.number);
      const isSuckOut = p.suckOuts.some(so => so.num === hand.number);
      const isCooler = p.coolers.some(c => c.num === hand.number);

      const opponents = Object.entries(hand.shownCards)
        .filter(([n]) => n !== name)
        .map(([n, cards]) => ({ name: n, c1: cards[0] ?? null, c2: cards[1] ?? null }));

      // Evaluate final hand names for hands that reached showdown — shown
      // cards, or the viewer's known cards when they got there but mucked.
      let myHandName = null;
      let winnerHandName = null;
      if (c1 && c2 && knownCards[name] && hand.board.length >= 3) {
        const myEval = bestHand([c1, c2], hand.board);
        if (myEval) myHandName = myEval.name;
        if (!won) {
          for (const winnerName of winnerSet) {
            const wc = hand.shownCards[winnerName];
            if (wc && wc[0] && wc[1]) {
              const winnerEval = bestHand(wc, hand.board);
              if (winnerEval) { winnerHandName = winnerEval.name; break; }
            }
          }
        }
      }

      // Keep lastSeenStack current through the hand: stacks snapshots only
      // appear at hand *start*, so without this a player still seated when the
      // log ends would have their final hand's win/loss dropped from netChips.
      if (hand.players[name]?.stack != null) {
        p.lastSeenStack = hand.players[name].stack + (handNet[name] ?? 0);
      }

      p.handsHistory.push({
        num: hand.number,
        c1, c2,
        won,
        isSplit,
        splitWith,
        wasShown,
        wonAmount,
        potSize,
        // Exact chips won/lost this hand (collects + returns − contributions),
        // derived from the action log. Powers the rebuy-proof net timeline.
        net: handNet[name] ?? 0,
        // Stack entering this hand (from the `Player stacks:` snapshot), used to
        // plot chip count over time. Null if the player wasn't in that snapshot.
        stack: hand.players[name]?.stack ?? null,
        board: hand.board.slice(),
        opponents,
        isBadBeat,
        isSuckOut,
        isCooler,
        myHandName,
        winnerHandName,
        dealer: hand.dealer,
        sb: hand.sb,
        bb: hand.bb,
      });
    }
  }

  function findViewerName(hand) {
    if (viewerName && hand.players[viewerName]) return viewerName;
    if (viewerName) return null; // explicit pick that's not seated this hand
    return Object.keys(hand.players).find(n => n.toLowerCase().startsWith('will'));
  }

  // ── Process rows ──────────────────────────────────────────────────────────

  for (const row of rows) {
    const e = row.entry;

    // ── Hand start ──────────────────────────────────────────────────────────
    const handStart = e.match(/^-- starting hand #(\d+) \(id: ([^)]+)\)/);
    if (handStart) {
      if (currentHand) commitHand(currentHand);
      currentHand = emptyHand();
      currentHand.number = parseInt(handStart[1], 10);
      currentHand.id = handStart[2];
      // Newer PokerNow logs put the dealer inline here instead of emitting a
      // separate `"X" is the dealer` row. "(dead button)" hands keep dealer null.
      const inlineDealer = e.match(/\(dealer: "(.+?)"\)/);
      if (inlineDealer) currentHand.dealer = extractName(inlineDealer[1]);
      continue;
    }

    // ── Hand end ────────────────────────────────────────────────────────────
    if (e.match(/^-- ending hand #\d+ --/)) {
      if (currentHand) commitHand(currentHand);
      currentHand = null;
      continue;
    }

    // ── Buy-ins / cash-outs (can happen between hands, so check before guard) ──
    // "stand up" parks the player's chips at the table; the later "sit back" /
    // "joined the game" re-entry is NOT a new buy-in (only a top-up above the
    // parked stack would be). Without this, every sit-back inflates buyIns.
    const standMatch = e.match(/^The player "(.+?)" stand up with the stack of (\d+)/);
    if (standMatch) {
      getPlayer(extractName(standMatch[1])).standUpStack = parseInt(standMatch[2], 10);
      continue;
    }

    const joinMatch = e.match(/^The player "(.+?)" joined the game with a stack of (\d+)/);
    if (joinMatch) {
      const p = getPlayer(extractName(joinMatch[1]));
      const amount = parseInt(joinMatch[2], 10);
      if (p.standUpStack !== null) {
        p.buyIns += Math.max(0, amount - p.standUpStack);
        p.standUpStack = null;
      } else {
        p.buyIns += amount;
      }
      p.lastBuyInOrder = row.order;
      continue;
    }

    const quitMatch = e.match(/^The player "(.+?)" quits the game with a stack of (\d+)/);
    if (quitMatch) {
      const p = getPlayer(extractName(quitMatch[1]));
      p.cashOut += parseInt(quitMatch[2], 10);
      p.lastQuitOrder = row.order;
      p.standUpStack = null; // quitting while stood up cashes those chips out
      continue;
    }

    // ── Dealer detection (before guard, per-hand metadata) ──────────────────
    const dealerMatch = e.match(/^"(.+?)" is the dealer$/);
    if (dealerMatch && currentHand) {
      currentHand.dealer = extractName(dealerMatch[1]);
      continue;
    }

    if (!currentHand) continue;

    // ── Player stacks ───────────────────────────────────────────────────────
    const stacksMatch = e.match(/^Player stacks: (.+)$/);
    if (stacksMatch) {
      const parts = stacksMatch[1].split(' | ');
      for (const part of parts) {
        const m = part.match(/^#(\d+) "(.+)" \((\d+)\)$/);
        if (m) {
          const seat = parseInt(m[1], 10);
          const name = extractName(m[2]);
          const stack = parseInt(m[3], 10);
          currentHand.players[name] = { stack };
          currentHand.seats[name] = seat; // physical seat for position ordering
          // Snapshot for end-of-log "still seated" cash-out fallback (see field comment).
          const pl = getPlayer(name);
          pl.lastSeenStack = stack;
          pl.standUpStack = null; // dealt in again ⇒ any pending stand-up was consumed
        }
      }
      continue;
    }

    // ── Your hand is ────────────────────────────────────────────────────────
    const yourHand = e.match(/^Your hand is (.+)$/);
    if (yourHand) {
      const parts = yourHand[1].split(',').map(s => s.trim());
      currentHand.viewerCards = parts.map(normaliseCard);
      continue;
    }

    // ── Street changes + board card parsing ──────────────────────────────────
    const streetMatch = e.match(/^(Flop|Turn|River):/);
    if (streetMatch) {
      currentHand.street = streetMatch[1].toLowerCase();
      // Parse cards from bracket notation [A♠, K♥, ...] or bare list
      const bracket = e.match(/\[([^\]]+)\]/);
      const cardSrc = bracket
        ? bracket[1]
        : e.split(':').slice(1).join(':').split('(')[0];
      const cards = cardSrc.split(',')
        .map(s => normaliseCard(s.trim()))
        .filter(c => c && c.rank);
      // PokerNow has two formats:
      //   Cumulative: Turn shows all 4 cards → replace board
      //   Incremental: Turn shows only the 1 new card → append
      if (cards.length === 1 && currentHand.board.length >= 3) {
        currentHand.board.push(cards[0]);
      } else if (cards.length > 0) {
        currentHand.board = cards;
      }
      currentHand.actionLog.push({ type: 'street', street: currentHand.street, board: currentHand.board.slice() });
      continue;
    }

    // ── Player actions ───────────────────────────────────────────────────────
    const foldMatch = e.match(/^"(.+?)" folds$/);
    if (foldMatch) {
      const name = extractName(foldMatch[1]);
      if (currentHand.street === 'preflop') {
        currentHand.preflopActions[name] = currentHand.preflopActions[name] || [];
        currentHand.preflopActions[name].push('fold');
      }
      getPlayer(name).streetActions[currentHand.street]++;
      currentHand.actionLog.push({ type: 'action', street: currentHand.street, player: name, action: 'fold' });
      continue;
    }

    const callMatch = e.match(/^"(.+?)" calls (\d+)/);
    if (callMatch) {
      const name = extractName(callMatch[1]);
      const amount = parseInt(callMatch[2], 10);
      if (currentHand.street === 'preflop') {
        currentHand.preflopActions[name] = currentHand.preflopActions[name] || [];
        currentHand.preflopActions[name].push('call');
      }
      const p = getPlayer(name);
      p.streetActions[currentHand.street]++;
      if (currentHand.street !== 'preflop') p.totalCalls++;
      currentHand.actionLog.push({ type: 'action', street: currentHand.street, player: name, action: 'call', amount });
      continue;
    }

    const raiseMatch = e.match(/^"(.+?)" raises to (\d+)/);
    if (raiseMatch) {
      const name = extractName(raiseMatch[1]);
      const amount = parseInt(raiseMatch[2], 10);
      if (currentHand.street === 'preflop') {
        currentHand.preflopActions[name] = currentHand.preflopActions[name] || [];
        currentHand.preflopActions[name].push('raise');
      }
      const p = getPlayer(name);
      p.streetActions[currentHand.street]++;
      if (currentHand.street !== 'preflop') p.totalBetsRaises++;
      currentHand.actionLog.push({ type: 'action', street: currentHand.street, player: name, action: 'raise', amount });
      continue;
    }

    const betMatch = e.match(/^"(.+?)" bets (\d+)/);
    if (betMatch) {
      const name = extractName(betMatch[1]);
      const amount = parseInt(betMatch[2], 10);
      if (currentHand.street === 'preflop') {
        currentHand.preflopActions[name] = currentHand.preflopActions[name] || [];
        currentHand.preflopActions[name].push('bet');
      }
      const p = getPlayer(name);
      p.streetActions[currentHand.street]++;
      if (currentHand.street !== 'preflop') p.totalBetsRaises++;
      currentHand.actionLog.push({ type: 'action', street: currentHand.street, player: name, action: 'bet', amount });
      continue;
    }

    const checkMatch = e.match(/^"(.+?)" checks$/);
    if (checkMatch) {
      const name = extractName(checkMatch[1]);
      const p = getPlayer(name);
      p.streetActions[currentHand.street]++;
      if (currentHand.street !== 'preflop') p.totalChecks++;
      currentHand.actionLog.push({ type: 'action', street: currentHand.street, player: name, action: 'check' });
      continue;
    }

    // ── Blinds (not voluntary) ───────────────────────────────────────────────
    const blindMatch = e.match(/^"(.+?)" posts a (small|big) blind of (\d+)/);
    if (blindMatch) {
      const name = extractName(blindMatch[1]);
      const isSmall = blindMatch[2] === 'small';
      const amount = parseInt(blindMatch[3], 10);
      currentHand.preflopActions[name] = currentHand.preflopActions[name] || [];
      currentHand.preflopActions[name].push('blind');
      if (isSmall) currentHand.sb = name; else { currentHand.bb = name; currentHand.bbSize = amount; }
      currentHand.actionLog.push({ type: 'action', street: 'preflop', player: name, action: isSmall ? 'post-sb' : 'post-bb', amount });
      continue;
    }

    // A player returning after sitting out posts "missing"/"missed" blinds.
    // These are extra posts on top of the real blinds, so they must not
    // overwrite hand.sb/bb — but they do go into the pot. The missed BIG blind
    // is live (counts toward calling, like a normal BB); the missing SMALL
    // blind is dead money, so it gets its own action type that pot math must
    // add to the pot without counting toward the poster's street bet.
    const missedBlindMatch = e.match(/^"(.+?)" posts a miss(?:ing|ed) (small|big) blind of (\d+)/);
    if (missedBlindMatch) {
      const name = extractName(missedBlindMatch[1]);
      const amount = parseInt(missedBlindMatch[3], 10);
      currentHand.preflopActions[name] = currentHand.preflopActions[name] || [];
      currentHand.preflopActions[name].push('blind');
      currentHand.actionLog.push({ type: 'action', street: 'preflop', player: name, action: missedBlindMatch[2] === 'small' ? 'post-dead-sb' : 'post-bb', amount });
      continue;
    }

    // ── Shows a hand ────────────────────────────────────────────────────────
    const showMatch = e.match(/^"(.+?)" shows a (.+)\.$/);
    if (showMatch) {
      const name = extractName(showMatch[1]);
      const parts = showMatch[2].split(',').map(s => s.trim());
      const cards = parts.map(normaliseCard).filter(c => c && c.rank);
      if (parts.length === 2) {
        currentHand.shownCards[name] = parts.map(normaliseCard);
      } else if (parts.length === 1) {
        if (!currentHand.shownCards[name]) currentHand.shownCards[name] = [];
        currentHand.shownCards[name].push(normaliseCard(parts[0]));
      }
      // Carry the shown cards on the action-log entry so the play-by-play can
      // render the actual hand ("shows A♠ K♥") instead of a generic "shows hand".
      currentHand.actionLog.push({ type: 'action', street: currentHand.street, player: name, action: 'show', cards });
      continue;
    }

    // ── Uncalled bet returned ───────────────────────────────────────────────
    // Emitted when a bet/raise isn't called (e.g. everyone folds). The chips go
    // back to the bettor, so the replayer/pot math must subtract them — they
    // were never really in the pot.
    const returnMatch = e.match(/^Uncalled bet of (\d+) returned to "(.+?)"/);
    if (returnMatch) {
      const amount = parseInt(returnMatch[1], 10);
      const name = extractName(returnMatch[2]);
      currentHand.actionLog.push({ type: 'action', street: currentHand.street, player: name, action: 'return', amount });
      continue;
    }

    // ── Collected (winner) ──────────────────────────────────────────────────
    const collectedMatch = e.match(/^"(.+?)" collected (\d+) from pot/);
    if (collectedMatch) {
      const name = extractName(collectedMatch[1]);
      const amount = parseInt(collectedMatch[2], 10);
      currentHand.winners.push({ name, amount });
      currentHand.actionLog.push({ type: 'action', street: currentHand.street, player: name, action: 'collect', amount });
      continue;
    }
  }

  // Commit any open hand
  if (currentHand) commitHand(currentHand);

  // ── Compute derived metrics ───────────────────────────────────────────────
  for (const p of Object.values(players)) {
    const h = p.handsDealt || 1;
    p.vpip = +(p.vpipHands / h * 100).toFixed(1);
    p.pfr = +(p.pfrHands / h * 100).toFixed(1);
    p.preflopFoldPct = +(p.preflopFolds / h * 100).toFixed(1);
    p.winRate = +(p.handsWon / h * 100).toFixed(1);

    p.af = p.totalCalls > 0
      ? +((p.totalBetsRaises) / p.totalCalls).toFixed(2)
      : p.totalBetsRaises > 0 ? 99 : 0;

    const stillSeated = p.lastBuyInOrder > p.lastQuitOrder;
    p.effectiveCashOut = p.cashOut + (stillSeated ? p.lastSeenStack : 0);
    p.netChips = p.effectiveCashOut - p.buyIns;

    p.luckiness = p.allHandsShown > 0
      ? +(p.premiumHandsShown / p.allHandsShown * 100).toFixed(1)
      : 0;

    p.tightness = Math.max(0, Math.min(100, Math.round(100 - p.vpip)));
  }

  return { players, handCount, handActionLogs };
}

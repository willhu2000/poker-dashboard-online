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
        // street actions
        streetActions: { preflop: 0, flop: 0, turn: 0, river: 0 },
        // luck proxy: premium hands shown at showdown
        premiumHandsShown: 0,
        allHandsShown: 0,
        // wins
        handsWon: 0,
        handsSplit: 0,   // pots shared with ≥1 other winner
        potsWon: 0,
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
    // For each player at showdown, record their pot result (won solo / lost)
    // against *every* opponent who also reached showdown — so the W–L matches
    // the hands listed in the drill-down (incl. multiway pots a third player
    // scooped). Chops are pushes and don't count toward W or L.
    if (shownDown.length >= 2) {
      for (const a of shownDown) {
        const aWon = winnerSet.has(a);
        if (aWon && isSplitPot) continue; // a chopped — push, skip
        for (const b of shownDown) {
          if (a === b) continue;
          const pa = getPlayer(a);
          const rec = pa.vsOpponents[b] || (pa.vsOpponents[b] = { w: 0, l: 0 });
          if (aWon) rec.w++; else rec.l++;
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
        if (cat.startsWith('Premium') || cat.startsWith('Strong Pair') || cat === 'Strong Ace (AQs/AJs)') {
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
    // Requires both players to show cards and a board of ≥3 cards.
    const shownNames = Object.keys(hand.shownCards);
    if (shownNames.length >= 2 && hand.board.length >= 3) {
      for (const loserName of shownNames) {
        if (winnerSet.has(loserName)) continue;
        const lc = hand.shownCards[loserName];
        if (!lc || !lc[0] || !lc[1]) continue;

        const loserEval = bestHand(lc, hand.board);
        if (!loserEval || loserEval.rank < 2) continue; // Two Pair minimum

        for (const winnerName of winnerSet) {
          const wc = hand.shownCards[winnerName];
          if (!wc || !wc[0] || !wc[1]) continue;

          const winnerEval = bestHand(wc, hand.board);
          if (!winnerEval) continue;

          const entry = {
            num: hand.number,
            board: hand.board.slice(),
            potSize,
          };

          // Record on the loser as a bad beat
          getPlayer(loserName).badBeats.push({
            ...entry,
            c1: lc[0], c2: lc[1],
            myHandName: loserEval.name,
            myHandRank: loserEval.rank,
            oppName: winnerName,
            oppC1: wc[0], oppC2: wc[1],
            oppHandName: winnerEval.name,
          });

          // Record on the winner as a suck-out
          const winnerWonAmount = hand.winners.find(w => w.name === winnerName)?.amount ?? potSize;
          getPlayer(winnerName).suckOuts.push({
            ...entry,
            c1: wc[0], c2: wc[1],
            myHandName: winnerEval.name,
            myHandRank: winnerEval.rank,
            oppName: loserName,
            oppC1: lc[0], oppC2: lc[1],
            oppHandName: loserEval.name,
            oppHandRank: loserEval.rank, // severity = what we beat
            wonAmount: winnerWonAmount,
          });

          // Record cooler when both players had strong hands
          // (loser Two Pair+ already guaranteed, winner needs Trips+)
          if (winnerEval.rank >= 3) {
            const coolerBase = { num: hand.number, board: hand.board.slice(), potSize };
            getPlayer(loserName).coolers.push({
              ...coolerBase,
              c1: lc[0], c2: lc[1],
              myHandName: loserEval.name, myHandRank: loserEval.rank,
              oppName: winnerName,
              oppC1: wc[0], oppC2: wc[1],
              oppHandName: winnerEval.name, oppHandRank: winnerEval.rank,
              won: false,
            });
            getPlayer(winnerName).coolers.push({
              ...coolerBase,
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

      // Evaluate final hand names for showdown hands
      let myHandName = null;
      let winnerHandName = null;
      if (wasShown && c1 && c2 && hand.board.length >= 3) {
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

      p.handsHistory.push({
        num: hand.number,
        c1, c2,
        won,
        isSplit,
        splitWith,
        wasShown,
        wonAmount,
        potSize,
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
      continue;
    }

    // ── Hand end ────────────────────────────────────────────────────────────
    if (e.match(/^-- ending hand #\d+ --/)) {
      if (currentHand) commitHand(currentHand);
      currentHand = null;
      continue;
    }

    // ── Buy-ins / cash-outs (can happen between hands, so check before guard) ──
    const joinMatch = e.match(/^The player "(.+?)" joined the game with a stack of (\d+)/);
    if (joinMatch) {
      const p = getPlayer(extractName(joinMatch[1]));
      p.buyIns += parseInt(joinMatch[2], 10);
      p.lastBuyInOrder = row.order;
      continue;
    }

    const quitMatch = e.match(/^The player "(.+?)" quits the game with a stack of (\d+)/);
    if (quitMatch) {
      const p = getPlayer(extractName(quitMatch[1]));
      p.cashOut += parseInt(quitMatch[2], 10);
      p.lastQuitOrder = row.order;
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
          getPlayer(name).lastSeenStack = stack;
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

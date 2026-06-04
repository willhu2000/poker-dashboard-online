import { useState } from 'react';
import { classifyHand } from '../parser.js';
import { bestHand } from '../handEval.js';

// Coaching report rendered for every player in the Deep Dive. Findings
// (VPIP/PFR/AF/W$SD/etc.) work for everyone since they're derived from action
// data. Per-hand action analysis is richer for the viewer (we know hole cards
// on every dealt hand) and limited to showdowns for everyone else.
//
// Heuristics use textbook 6-9 handed cash-game guidance:
//   VPIP 18-28% / PFR 12-22% / VPIP-PFR gap ≤ 5 = standard TAG profile
//   AF 1.5-4 is healthy. <1 = passive, >5 = bluff-heavy.
//   W$SD ≥ 50% suggests good river discipline.
// These are rules of thumb for live home games, not GTO solver output.

const CATEGORY_TRASH = new Set([
  'Speculative / Trash',
  'Weak Ace offsuit',
  'Weak Ace suited',
  'One-Gap Connector',
]);

function categoryFromCards(c1, c2) {
  if (!c1 || !c2) return null;
  return classifyHand(c1, c2);
}

function styleArchetype(p) {
  const tight = p.vpip < 22;
  const loose = p.vpip > 30;
  const passive = p.af !== 99 && p.af < 1.5;
  const aggro   = p.af === 99 || p.af > 2.5;

  if (loose && passive) return {
    name: 'Loose Passive (Calling Station)',
    body: 'You see lots of flops and rarely apply pressure. This is the hardest archetype to win with — you pay off value bets and miss thin value yourself.',
  };
  if (tight && passive) return {
    name: 'Tight Passive (Rock)',
    body: 'You wait for premium hands but don\'t press the advantage when you get them. Opponents fold to your bets so you only get paid when they bluff.',
  };
  if (loose && aggro) return {
    name: 'Loose Aggressive (LAG)',
    body: 'You play many hands and play them fast. High variance but +EV if your hand reading keeps up. Stay disciplined when you get called.',
  };
  if (tight && aggro) return {
    name: 'Tight Aggressive (TAG)',
    body: 'The textbook winning profile — selective preflop, decisive postflop. Watch out for becoming predictable to observant opponents.',
  };
  return {
    name: 'Balanced / Unclassified',
    body: 'Your numbers sit between archetypes. Look at the findings below for the specific levers to pull.',
  };
}

function buildFindings(p) {
  const findings = [];
  const handsDealt = p.handsDealt || 0;

  // ── VPIP ──
  if (handsDealt >= 30) {
    if (p.vpip > 35) {
      findings.push({
        kind: 'leak',
        title: `VPIP ${p.vpip}% — too loose`,
        body: `You're voluntarily entering about ${Math.round(p.vpip)}% of dealt hands. Solid 6-9 handed play sits around 20-25%. Tightening up preflop is usually the single biggest +EV adjustment — fewer marginal entries means fewer "second-best" hands on showdown.`,
      });
    } else if (p.vpip < 14) {
      findings.push({
        kind: 'leak',
        title: `VPIP ${p.vpip}% — too tight`,
        body: 'A range this narrow is exploitable: observant opponents fold every time you raise. Adding suited broadways, suited aces, and pocket pairs from late position pushes you toward a balanced 20% without sacrificing edge.',
      });
    } else if (p.vpip >= 18 && p.vpip <= 28) {
      findings.push({
        kind: 'good',
        title: `VPIP ${p.vpip}% — solid range`,
        body: 'Right in the textbook 18-28% band for tight-aggressive play. You\'re playing the hands worth playing.',
      });
    }
  }

  // ── PFR / limp gap ──
  const gap = +(p.vpip - p.pfr).toFixed(1);
  if (handsDealt >= 30) {
    if (gap > 12) {
      findings.push({
        kind: 'leak',
        title: `Limping ~${Math.round(gap)}% of entries`,
        body: `Your VPIP (${p.vpip}%) is well above your PFR (${p.pfr}%) — that gap is hands you entered without raising. Limping caps your range, lets blinds see free flops, and forfeits the initiative. Raise-or-fold preflop closes this leak.`,
      });
    } else if (gap >= 0 && gap < 5 && p.vpip >= 15) {
      findings.push({
        kind: 'good',
        title: `PFR-VPIP gap ${gap}% — raising your range`,
        body: 'Almost every hand you play is raised first in, which is exactly right. You take initiative preflop and define your range before the flop.',
      });
    }
  }

  // ── PFR magnitude ──
  if (handsDealt >= 30) {
    if (p.pfr < 6) {
      findings.push({
        kind: 'leak',
        title: `PFR ${p.pfr}% — passive preflop`,
        body: 'A PFR this low telegraphs only premium holdings. Open-raising more from late position (suited broadways, pocket pairs, suited connectors) wins more pots uncontested and balances your range.',
      });
    } else if (p.pfr > 32) {
      findings.push({
        kind: 'leak',
        title: `PFR ${p.pfr}% — opening too wide`,
        body: 'Many open-raises with marginal holdings. Solid opponents will 3-bet you wide and put you in tough spots out of position. Tighten early-position opens.',
      });
    }
  }

  // ── Aggression Factor ──
  if (handsDealt >= 30 && p.totalCalls + p.totalBetsRaises >= 20) {
    if (p.af !== 99 && p.af < 1) {
      findings.push({
        kind: 'leak',
        title: `AF ${p.af} — too passive postflop`,
        body: 'You\'re calling more than you\'re betting or raising. Passive play gives up the initiative: you don\'t fold opponents out and you don\'t extract value from weaker hands. When you have a made hand or a strong draw, bet it.',
      });
    } else if (p.af !== 99 && p.af >= 1.5 && p.af <= 4) {
      findings.push({
        kind: 'good',
        title: `AF ${p.af} — healthy aggression`,
        body: 'Right in the 1.5-4 sweet spot. You\'re betting for value and folding when behind, instead of bluff-catching every street.',
      });
    } else if (p.af === 99 || p.af > 5) {
      findings.push({
        kind: 'leak',
        title: `AF ${p.af === 99 ? '∞' : p.af} — aggression overweighted`,
        body: 'You\'re betting/raising far more than calling. Once opponents catch on they\'ll start calling down lighter and trapping you. Mix in some check-calls with medium-strength hands to balance.',
      });
    }
  }

  // ── Trash hand frequency in observed range ──
  const totalKnown = Object.values(p.handCategories || {}).reduce((s, n) => s + n, 0);
  const trashCount = Object.entries(p.handCategories || {})
    .filter(([cat]) => CATEGORY_TRASH.has(cat))
    .reduce((s, [, n]) => s + n, 0);
  if (totalKnown >= 15 && trashCount / totalKnown > 0.3) {
    const pct = Math.round((trashCount / totalKnown) * 100);
    findings.push({
      kind: 'leak',
      title: `${pct}% of observed hands are speculative/trash`,
      body: 'Weak aces and offsuit junk become "second-best" hands on showdown and bleed chips. Fold these from early position and only play them in position with deep stacks and good implied odds.',
    });
  }

  // ── Showdown discipline (W$SD) ──
  const sdHands = (p.handsHistory || []).filter(h => h.wasShown);
  const sdWon   = sdHands.filter(h => h.won).length;
  if (sdHands.length >= 8) {
    const wsd = sdWon / sdHands.length;
    if (wsd < 0.4) {
      findings.push({
        kind: 'leak',
        title: `Showdowns won ${Math.round(wsd * 100)}% — paying off too often`,
        body: 'Showing down losing hands means you\'re calling rivers too light. Rule of thumb: if your hand isn\'t strong enough to value-bet, it usually isn\'t strong enough to call a big river bet.',
      });
    } else if (wsd >= 0.55) {
      findings.push({
        kind: 'good',
        title: `Showdowns won ${Math.round(wsd * 100)}% — good river discipline`,
        body: 'When you reach showdown, you usually win. That means you\'re folding weaker hands earlier rather than paying off river bets.',
      });
    }
  }

  // ── Variance note (lots of bad beats) ──
  const bb = (p.badBeats || []).length;
  const so = (p.suckOuts || []).length;
  if (bb >= 3 && bb > so + 1) {
    findings.push({
      kind: 'variance',
      title: `${bb} bad beats logged`,
      body: 'You\'ve been on the wrong side of variance more than the right side. These are not skill issues — they\'re the cost of getting your money in good. Don\'t adjust strategy off small samples of bad runs.',
    });
  }

  return findings;
}

// ─── Per-action analysis (pot odds + hand-strength heuristics) ──────────────
//
// Walk a hand's actionLog and reproduce the pot state at the moment of each
// decision the target player made. PokerNow's log format:
//   "calls N"     → player's TOTAL chips committed this street is now N
//   "raises to N" → player's TOTAL chips committed this street is now N
//   "bets N"      → first wager this street; delta is N
//   "posts a blind of N" → contributes N
// So delta for any action = (new total) − (prior contribution this street).

const STREET_LABEL = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };

function equityNeeded(toCall, potBefore) {
  if (toCall <= 0) return 0;
  return toCall / (potBefore + toCall);
}

function fmtOdds(toCall, potBefore) {
  if (toCall <= 0) return '';
  const ratio = potBefore / toCall;
  return `${ratio.toFixed(1)}:1`;
}

function fmtEqPct(toCall, potBefore) {
  return `${Math.round(equityNeeded(toCall, potBefore) * 100)}%`;
}

function preflopVerdict({ action, toCall, potBefore, facingRaise, holeCards }) {
  const cat = holeCards ? classifyHand(holeCards[0], holeCards[1]) : null;
  const premium = cat && (cat.startsWith('Premium') || cat === 'Strong Pair (QQ/JJ)');
  const strong  = premium || cat === 'Strong Ace (AQs/AJs)' || cat === 'Strong Ace (AQo/AJo)' || cat === 'Medium Pair (TT-88)';
  const trash   = cat === 'Speculative / Trash';
  const smallPair = cat === 'Small Pair (77-55)' || cat === 'Micro Pair (44-22)';
  const tag = cat ? ` (${cat})` : '';

  if (action === 'fold') {
    if (premium) return { tone: 'leak', text: `Folded${tag} preflop. Folding a premium is almost never correct — even facing a 4-bet you should at least flat.` };
    if (trash)   return { tone: 'good', text: `Folded${tag}. Disciplined — these hands lose money over time.` };
    return { tone: 'neutral', text: `Folded${tag}. Saves chips on a marginal holding.` };
  }
  if (action === 'check') {
    return { tone: 'neutral', text: 'Free flop in the BB.' };
  }
  if (action === 'call') {
    if (toCall === 0) {
      return { tone: 'neutral', text: `Limped${tag}. Modern theory prefers raise-or-fold — limping caps your range and surrenders preflop initiative.` };
    }
    const odds = fmtOdds(toCall, potBefore);
    const eq = fmtEqPct(toCall, potBefore);
    if (premium) return { tone: 'neutral', text: `Flat-called${tag} (pot odds ${odds}). Consider 3-betting instead — keeps your range strong and builds the pot when ahead.` };
    if (smallPair) return { tone: 'neutral', text: `Set-mining${tag} at pot odds ${odds}. Profitable only if effective stacks ≥ ~15× the call (implied odds).` };
    if (trash)   return { tone: 'leak', text: `Called a raise with${tag} (needs ${eq} equity). These rarely flop strong enough to continue — fold preflop.` };
    return { tone: 'neutral', text: `Called${tag}. Pot odds ${odds}, needs ${eq} equity to break even.` };
  }
  if (action === 'bet' || action === 'raise') {
    if (facingRaise) {
      if (premium) return { tone: 'good', text: `3-bet for value${tag}. Builds the pot when ahead and folds out weaker hands.` };
      if (strong)  return { tone: 'neutral', text: `3-bet${tag}. Reasonable for value/isolation; watch out for 4-bets that crush this range.` };
      if (trash)   return { tone: 'leak', text: `3-bet bluff${tag}. Rarely +EV unless the opponent folds way too often.` };
      return { tone: 'neutral', text: `3-bet${tag}. Polarised move — either value or a bluff with equity.` };
    }
    if (premium) return { tone: 'good', text: `Open-raised${tag} — standard value raise.` };
    if (strong)  return { tone: 'good', text: `Open-raised${tag}. Solid opening range.` };
    if (trash)   return { tone: 'leak', text: `Open-raised with${tag} — opens you up to 3-bets and dominated postflop spots.` };
    return { tone: 'neutral', text: `Open-raised${tag}.` };
  }
  return null;
}

function postflopVerdict({ board, action, delta, potBefore, toCall, holeCards }) {
  const ev = (holeCards && board?.length >= 3) ? bestHand(holeCards, board) : null;
  const rank = ev?.rank ?? -1;
  const name = ev?.name ?? null;

  if (action === 'check') {
    if (rank >= 3) return { tone: 'neutral', text: `Checked with ${name} — slow-playing. Risky on draw-heavy boards (gives free turns).` };
    if (rank === 2) return { tone: 'neutral', text: `Checked with ${name}. Pot-control / showdown-value play; fine out of position.` };
    if (rank === 1) return { tone: 'neutral', text: `Checked with ${name}. Reasonable for pot control or to induce a bluff.` };
    if (rank === 0) return { tone: 'neutral', text: `Checked with no made hand — free card or give-up.` };
    return { tone: 'neutral', text: 'Checked.' };
  }
  if (action === 'fold') {
    const odds = fmtOdds(toCall, potBefore);
    const eq = fmtEqPct(toCall, potBefore);
    if (rank >= 3) return { tone: 'leak', text: `Folded ${name} (pot odds ${odds}). Very rarely correct with a hand this strong.` };
    if (rank === 2) return { tone: 'neutral', text: `Folded ${name} (pot odds ${odds}). Reasonable on scary boards; sometimes too tight when getting a price.` };
    if (rank === 1) return { tone: 'neutral', text: `Folded ${name} (needs ${eq} equity). Right vs a polarised range that crushes you; wrong if opponent bluffs enough.` };
    if (rank === 0) return { tone: 'good', text: `Folded a weak hand (pot odds ${odds}). Disciplined escape — no need to bluff-catch with nothing.` };
    return { tone: 'good', text: `Folded (pot odds ${odds}).` };
  }
  if (action === 'call') {
    const odds = fmtOdds(toCall, potBefore);
    const eq = fmtEqPct(toCall, potBefore);
    if (rank >= 4) return { tone: 'leak', text: `Just called with ${name} (pot odds ${odds}). Raise for value — flat-calling lets opponents off the hook and leaves money on the table.` };
    if (rank === 3) return { tone: 'neutral', text: `Called with ${name}. Strong hand; consider raising for value unless trapping is part of the plan.` };
    if (rank === 2) return { tone: 'neutral', text: `Called with ${name} (pot odds ${odds}, needs ${eq}). Standard on dry boards; consider raising on draw-heavy ones.` };
    if (rank === 1) return { tone: 'neutral', text: `Called with ${name} (pot odds ${odds}, needs ${eq}). Bluff-catch — fine vs aggressive opponents, leaks vs tight ones.` };
    if (rank === 0) return { tone: 'neutral', text: `Called with no made hand (pot odds ${odds}, needs ${eq}). Only +EV with a strong draw or strong bluff-catcher read.` };
    return { tone: 'neutral', text: `Called (pot odds ${odds}, needs ${eq}).` };
  }
  if (action === 'bet' || action === 'raise') {
    const sizing = potBefore > 0 ? delta / potBefore : 1;
    const sizeStr = potBefore > 0 ? `${Math.round(sizing * 100)}% pot` : 'opening bet';
    const overbet = sizing > 1.05;
    const small = sizing < 0.4;
    const isRaise = action === 'raise';
    const verb = isRaise ? 'Raised' : 'Bet';

    if (rank >= 4) return { tone: 'good', text: `${verb} ${sizeStr} with ${name}. Big value — get chips in while you're ahead.` };
    if (rank === 3) return { tone: 'good', text: `${verb} ${sizeStr} with ${name}. Standard value bet — protect against draws and extract from worse pairs.` };
    if (rank === 2) return { tone: 'good', text: `${verb} ${sizeStr} with ${name}. Charge draws and thin value; size up on wet boards.` };
    if (rank === 1) {
      if (overbet) return { tone: 'neutral', text: `${verb} ${sizeStr} with ${name}. Overbetting one pair is polarised — strong if balanced with bluffs, leaky if always done with this strength.` };
      if (small)   return { tone: 'neutral', text: `${verb} ${sizeStr} with ${name}. Small sizing for thin value / range-bet — fine.` };
      return { tone: 'neutral', text: `${verb} ${sizeStr} with ${name}. Thin value / protection — risky if check-raised.` };
    }
    if (rank === 0) {
      if (small)   return { tone: 'neutral', text: `${verb} ${sizeStr} as a small bluff. Cheap to fold out air; loses value if called.` };
      return { tone: 'neutral', text: `${verb} ${sizeStr} as a ${isRaise ? 'bluff-raise' : 'bluff/semi-bluff'}. Needs fold equity to be +EV — pick boards your range hits hardest.` };
    }
    return { tone: 'neutral', text: `${verb} ${sizeStr}.` };
  }
  return null;
}

function verdictFor(ctx) {
  if (ctx.street === 'preflop') return preflopVerdict(ctx);
  return postflopVerdict(ctx);
}

function analyzeHandActions(hand, playerName, log = hand.actionLog) {
  if (!log) return [];
  const holeCards = (hand.c1 && hand.c2) ? [hand.c1, hand.c2] : null;

  const steps = [];
  let street = 'preflop';
  let streetBoard = [];
  let pot = 0;
  let betToMatch = 0;
  let contrib = {};        // player → chips committed this street
  let raisesThisStreet = 0;

  for (const e of log) {
    if (e.type === 'street') {
      street = e.street;
      streetBoard = e.board || [];
      betToMatch = 0;
      contrib = {};
      raisesThisStreet = 0;
      continue;
    }
    if (e.type !== 'action') continue;

    const isPlayer = e.player === playerName;
    const before = contrib[e.player] || 0;
    const potBefore = pot;
    const toCall = Math.max(0, betToMatch - before);
    const facingRaise = raisesThisStreet > 0;

    let delta;
    if (e.action === 'post-sb' || e.action === 'post-bb') {
      delta = e.amount || 0;
      betToMatch = Math.max(betToMatch, before + delta);
    } else if (e.action === 'check' || e.action === 'fold') {
      delta = 0;
    } else if (e.action === 'call') {
      delta = Math.max(0, (e.amount || 0) - before);
    } else if (e.action === 'bet') {
      delta = e.amount || 0;
      betToMatch = before + delta;
      raisesThisStreet++;
    } else if (e.action === 'raise') {
      delta = Math.max(0, (e.amount || 0) - before);
      betToMatch = e.amount || 0;
      raisesThisStreet++;
    } else {
      continue; // show / collect
    }

    if (isPlayer && ['call', 'fold', 'check', 'bet', 'raise'].includes(e.action)) {
      const verdict = verdictFor({
        street, board: streetBoard, action: e.action,
        delta, potBefore, toCall, facingRaise, holeCards,
      });
      steps.push({
        street, board: streetBoard.slice(),
        action: e.action, amount: e.amount, delta,
        potBefore, toCall, verdict,
      });
    }

    pot += delta;
    contrib[e.player] = before + delta;
  }

  return steps;
}

// Score each hand by impact and tag it with a coaching annotation. Only hands
// where we know the player's hole cards (c1/c2 set) are eligible — for the
// viewer that's every hand, for others it's showdowns only.
function rankKeyHands(p, getLog) {
  const hh = p.handsHistory || [];
  const scored = [];

  for (const h of hh) {
    if (!h.c1 || !h.c2) continue;
    if (!h.potSize) continue;

    const cat = categoryFromCards(h.c1, h.c2);
    const myActions = (getLog(h) || []).filter(a => a.player === p.name);
    const enteredVoluntarily = myActions.some(a => a.street === 'preflop' && ['call', 'raise', 'bet'].includes(a.action));
    const folded = !h.wasShown && !h.won;

    let score = h.potSize;
    const tags = [];

    if (h.isBadBeat) {
      score *= 1.3;
      tags.push({ kind: 'variance', text: 'Bad beat — chips lost to variance, not to a mistake. The math was on your side.' });
    } else if (h.isSuckOut) {
      score *= 1.05;
      tags.push({ kind: 'variance', text: 'Suck-out — you got there on a late street. Good result, but don\'t plan on it happening twice.' });
    } else if (h.isSplit) {
      tags.push({ kind: 'good', text: `Split the pot${h.wonAmount ? ` (+${h.wonAmount.toLocaleString()} chips)` : ''}${h.myHandName ? ` with ${h.myHandName}` : ''}.` });
    } else if (h.won) {
      tags.push({ kind: 'good', text: `Won the pot${h.wonAmount ? ` (+${h.wonAmount.toLocaleString()} chips)` : ''}${h.myHandName ? ` with ${h.myHandName}` : ''}.` });
    } else if (h.wasShown) {
      tags.push({ kind: 'leak', text: `Lost at showdown${h.winnerHandName ? ` to ${h.winnerHandName}` : ''}${h.myHandName ? ` (you held ${h.myHandName})` : ''}.` });
    }

    if (CATEGORY_TRASH.has(cat) && enteredVoluntarily && !h.isBadBeat) {
      score *= 1.35;
      tags.push({ kind: 'leak', text: `Entered preflop with ${cat}. These hands are -EV from most positions — fold preflop unless you're in late position with deep stacks.` });
    }

    if (h.wasShown && !h.won && (cat === 'Medium Pair (TT-88)' || cat === 'Small Pair (77-55)') && h.board?.length >= 3) {
      score *= 1.15;
      tags.push({ kind: 'leak', text: 'Middle pair beaten at showdown — when the pot gets big and the board has overcards, mid-pair is rarely good enough to call a river bet.' });
    }

    if (folded && enteredVoluntarily && h.potSize > 0) {
      tags.push({ kind: 'neutral', text: 'You folded after putting chips in. Sometimes correct, sometimes a spot to revisit — check the action log.' });
    }

    scored.push({ h, score, tags });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5);
}

function cardText(c) {
  if (!c) return '??';
  const suit = { s: '♠', h: '♥', d: '♦', c: '♣' }[c.suit] || '?';
  return `${c.rank}${suit}`;
}

function suitClass(c) { return c?.suit ? `cr-card cr-${c.suit}` : 'cr-card'; }

const ACTION_VERB = {
  fold: 'folded', check: 'checked', call: 'called',
  bet: 'bet', raise: 'raised to',
};

function actionLine(step) {
  const verb = ACTION_VERB[step.action] || step.action;
  if (step.action === 'fold' || step.action === 'check') return verb;
  return `${verb} ${(step.amount ?? step.delta ?? 0).toLocaleString()}`;
}

function StepRow({ step }) {
  const v = step.verdict;
  if (!v) return null;
  return (
    <li className={`cr-step cr-step-${v.tone}`}>
      <div className="cr-step-head">
        <span className="cr-step-street">{STREET_LABEL[step.street] || step.street}</span>
        <span className="cr-step-action">{actionLine(step)}</span>
        {step.toCall > 0 && step.action !== 'check' && (
          <span className="cr-step-context">
            facing {step.toCall.toLocaleString()} into {step.potBefore.toLocaleString()} pot
          </span>
        )}
        {step.toCall === 0 && (step.action === 'bet' || step.action === 'raise') && step.potBefore > 0 && (
          <span className="cr-step-context">into {step.potBefore.toLocaleString()} pot</span>
        )}
      </div>
      <div className="cr-step-text">{v.text}</div>
    </li>
  );
}

function KeyHandCard({ scored, isMerged, playerName, expanded, onToggle, getLog }) {
  const { h, tags } = scored;
  const steps = expanded ? analyzeHandActions(h, playerName, getLog(h)) : [];

  return (
    <div className="cr-hand-card">
      <button className="cr-hand-header cr-hand-header-btn" onClick={onToggle}>
        <span className="cr-hand-num">
          Hand #{h.num}
          {isMerged && h.sessionDate && <span className="cr-hand-date"> · {h.sessionDate}</span>}
        </span>
        <span className="cr-hand-pot">Pot: {h.potSize.toLocaleString()}</span>
        <span className="cr-hand-chevron">{expanded ? '▾' : '▸'}</span>
      </button>
      <div className="cr-hand-body">
        <div className="cr-hand-cards">
          <span className={suitClass(h.c1)}>{cardText(h.c1)}</span>
          <span className={suitClass(h.c2)}>{cardText(h.c2)}</span>
          {h.board?.length > 0 && (
            <>
              <span className="cr-hand-sep">·</span>
              {h.board.map((b, i) => (
                <span key={i} className={suitClass(b)}>{cardText(b)}</span>
              ))}
            </>
          )}
        </div>
        <ul className="cr-tag-list">
          {tags.map((t, i) => (
            <li key={i} className={`cr-tag cr-tag-${t.kind}`}>{t.text}</li>
          ))}
        </ul>
        {expanded && (
          steps.length > 0 ? (
            <div className="cr-steps-wrap">
              <div className="cr-steps-title">Action-by-action breakdown</div>
              <ul className="cr-step-list">
                {steps.map((s, i) => <StepRow key={i} step={s} />)}
              </ul>
              <p className="cr-steps-note">
                Pot odds and equity targets are exact; verdicts are heuristics from general TAG theory — they don't know your opponent or table dynamic.
              </p>
            </div>
          ) : (
            <p className="cr-empty" style={{ marginTop: 8 }}>
              No detailed action log captured for this hand.
            </p>
          )
        )}
      </div>
    </div>
  );
}

export default function CoachingReport({ player, isMerged = false, isViewer = false, handActionLogs = {} }) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedKeyHands, setExpandedKeyHands] = useState(false);
  const [expandedHandIdx, setExpandedHandIdx] = useState(null);

  // Action logs are stored in a top-level map keyed by `${sessionId}_${num}`
  // (older single-session data may key by plain hand number, and the oldest
  // inline-stored logs are read from the hand itself). Mirror PlayerDetail's
  // lookup so the per-hand breakdowns resolve.
  const getLog = (h) => handActionLogs[h.sessionId ? `${h.sessionId}_${h.num}` : h.num] ?? h.actionLog ?? [];

  const archetype = styleArchetype(player);
  const findings = buildFindings(player);
  const keyHands = rankKeyHands(player, getLog);
  const wins = findings.filter(f => f.kind === 'good');
  const leaks = findings.filter(f => f.kind === 'leak');
  const variance = findings.filter(f => f.kind === 'variance');

  const hasAnyKnownCards = keyHands.length > 0;

  // Header is always visible so the user can re-open after collapsing.
  const Header = (
    <div className="cr-header">
      <div className="section-title" style={{ fontSize: '0.9rem', margin: 0 }}>
        📚 Coaching Report
        <span className="cr-header-name" style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 8 }}>
          for {player.name}
        </span>
      </div>
      <button
        className="btn btn-ghost cr-collapse-btn"
        onClick={() => setCollapsed(c => !c)}
        aria-expanded={!collapsed}
      >
        {collapsed ? 'Show ▾' : 'Hide ▴'}
      </button>
    </div>
  );

  if (player.handsDealt < 10) {
    return (
      <div className="coaching-report">
        {Header}
        {!collapsed && (
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 8 }}>
            Not enough hands yet ({player.handsDealt} dealt). Coaching feedback needs at least 10 hands to be meaningful — play more or merge more sessions to populate this view.
          </p>
        )}
      </div>
    );
  }

  if (collapsed) {
    return <div className="coaching-report">{Header}</div>;
  }

  const visibleKeyHands = expandedKeyHands ? keyHands : keyHands.slice(0, 3);

  // Scope blurb: viewer sees every hand they were dealt, others only their
  // showdowns — make that explicit so the report's gaps make sense.
  const scopeBlurb = isViewer
    ? 'Every hand dealt to this player is in the dataset, so preflop entry decisions are graded too.'
    : 'Action-by-action breakdowns are only available for hands this player took to showdown — preflop folds don\'t reveal cards.';

  return (
    <div className="coaching-report">
      {Header}
      <p className="cr-subtitle">
        How {isViewer ? 'you' : player.name} played — and what poker theory says about it.
        {isMerged && <> Numbers are aggregated across the selected sessions.</>} {scopeBlurb}
      </p>

      <div className="cr-archetype">
        <div className="cr-archetype-label">{isViewer ? 'Your style' : 'Their style'}</div>
        <div className="cr-archetype-name">{archetype.name}</div>
        <div className="cr-archetype-body">{archetype.body}</div>
      </div>

      <div className="cr-findings-grid">
        <div className="cr-findings-col">
          <h4 className="cr-col-title cr-col-good">✓ What {isViewer ? 'you did' : 'they did'} well</h4>
          {wins.length === 0 ? (
            <p className="cr-empty">No clear strengths jumped out yet. With more hands the picture sharpens.</p>
          ) : (
            <ul className="cr-finding-list">
              {wins.map((f, i) => (
                <li key={i} className="cr-finding">
                  <div className="cr-finding-title">{f.title}</div>
                  <div className="cr-finding-body">{f.body}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="cr-findings-col">
          <h4 className="cr-col-title cr-col-leak">⚠ What to work on</h4>
          {leaks.length === 0 ? (
            <p className="cr-empty">No major leaks detected — numbers are within healthy bands. Focus on hand-reading and position from here.</p>
          ) : (
            <ul className="cr-finding-list">
              {leaks.map((f, i) => (
                <li key={i} className="cr-finding">
                  <div className="cr-finding-title">{f.title}</div>
                  <div className="cr-finding-body">{f.body}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {variance.length > 0 && (
        <div className="cr-variance">
          {variance.map((f, i) => (
            <div key={i} className="cr-variance-row">
              <div className="cr-finding-title">🎲 {f.title}</div>
              <div className="cr-finding-body">{f.body}</div>
            </div>
          ))}
        </div>
      )}

      {hasAnyKnownCards ? (
        <div className="cr-key-hands">
          <h4 className="cr-col-title">Key hands</h4>
          <p className="cr-empty" style={{ marginBottom: 8 }}>
            Highest-impact hands, weighted by pot size and misplays. Click a hand for the action-by-action breakdown with pot odds.
          </p>
          {visibleKeyHands.map((s, i) => (
            <KeyHandCard
              key={i}
              scored={s}
              isMerged={isMerged}
              playerName={player.name}
              getLog={getLog}
              expanded={expandedHandIdx === i}
              onToggle={() => setExpandedHandIdx(expandedHandIdx === i ? null : i)}
            />
          ))}
          {keyHands.length > 3 && (
            <button
              className="btn btn-ghost cr-more-btn"
              onClick={() => setExpandedKeyHands(v => !v)}
            >
              {expandedKeyHands ? 'Show fewer' : `Show ${keyHands.length - 3} more`}
            </button>
          )}
        </div>
      ) : (
        <div className="cr-key-hands">
          <h4 className="cr-col-title">Key hands</h4>
          <p className="cr-empty">No hands with known hole cards yet — {isViewer ? 'play more hands' : 'this player needs to reach showdown'} for a per-hand breakdown.</p>
        </div>
      )}
    </div>
  );
}

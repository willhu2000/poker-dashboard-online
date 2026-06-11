import { useState, useMemo } from 'react';
import { classifyHand } from '../parser.js';
import { bestHand } from '../handEval.js';
import { resolveAlias, resolveDisplayName } from '../playerConfig.js';
import HandReplayer from './HandReplayer.jsx';

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

  // ── 3-bet % ──
  if ((p.threeBetOpp ?? 0) >= 5) {
    const pct = Math.round(100 * (p.threeBets ?? 0) / p.threeBetOpp);
    if (pct < 3) {
      findings.push({
        kind: 'leak',
        title: `3-bet ${pct}% — rarely re-raising preflop`,
        body: `When you face an open raise, you 3-bet only ${pct}% of the time. A 5-10% rate keeps opponents from raising freely. Add re-raises with JJ+/AK for value and suited connectors from position as bluffs — this makes you much tougher to play against.`,
      });
    } else if (pct >= 5 && pct <= 12) {
      findings.push({
        kind: 'good',
        title: `3-bet ${pct}% — balanced re-raise frequency`,
        body: 'You\'re re-raising preflop at a healthy rate — enough to apply pressure with value hands while staying balanced. Hard to exploit.',
      });
    } else if (pct > 15) {
      findings.push({
        kind: 'leak',
        title: `3-bet ${pct}% — re-raising too frequently`,
        body: `3-betting ${pct}% means many of those re-raises are marginal hands. When called, you're often out of position with a thin range. Tighten from EP/MP and keep wider 3-bets reserved for the BTN and SB where you have positional cover.`,
      });
    }
  }

  // ── C-bet % ──
  if ((p.cbetOpp ?? 0) >= 5) {
    const pct = Math.round(100 * (p.cbets ?? 0) / p.cbetOpp);
    if (pct < 35) {
      findings.push({
        kind: 'leak',
        title: `C-bet ${pct}% — missing flop continuation bets`,
        body: `You only follow up preflop raises with a flop bet ${pct}% of the time. A 50-65% rate is standard — not betting enough signals weakness, lets opponents see free turn cards, and makes your c-bets easier to read when you do fire.`,
      });
    } else if (pct >= 50 && pct <= 70) {
      findings.push({
        kind: 'good',
        title: `C-bet ${pct}% — solid flop continuation betting`,
        body: 'You maintain initiative on most flops where you raised preflop — keeping opponents under pressure and picking up pots when they miss.',
      });
    } else if (pct > 80) {
      findings.push({
        kind: 'leak',
        title: `C-bet ${pct}% — auto-betting the flop`,
        body: `C-betting ${pct}% becomes mechanical and exploitable. Opponents will start floating or raising, knowing you bet regardless of the board. Check back on boards that miss your range (low, connected boards after EP opens) to keep opponents guessing.`,
      });
    }
  }

  // ── WTSD (went to showdown) ──
  if ((p.sawFlopHands ?? 0) >= 15) {
    const pct = Math.round(100 * (p.wtsdHands ?? 0) / p.sawFlopHands);
    if (pct > 38) {
      findings.push({
        kind: 'leak',
        title: `WTSD ${pct}% — calling down too often`,
        body: `You reach showdown ${pct}% of the time you see a flop. Above ~35% usually means calling multi-street bets with hands that won't win. When an opponent bets the turn and river, they typically have a strong holding — tighten your calling standards on later streets.`,
      });
    } else if (pct < 20 && (p.sawFlopHands ?? 0) >= 20) {
      findings.push({
        kind: 'leak',
        title: `WTSD ${pct}% — folding too easily postflop`,
        body: `Only ${pct}% of your seen flops make it to showdown. This low rate suggests opponents may be bluffing you off good hands with turn and river bets. Evaluate hand strength vs. pot odds before folding to aggression.`,
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

// Positional coaching — separate from the main findings so they can be
// shown as a dedicated section and fed into next-session focus independently.
function buildPositionalFindings(p) {
  const findings = [];
  const ps = p.posStats || {};
  const pct = (v, h) => (h ?? 0) >= 5 ? Math.round(100 * (v ?? 0) / h) : null;

  const epVpip  = pct(ps.EP?.v,  ps.EP?.h);
  const btnVpip = pct(ps.BTN?.v, ps.BTN?.h);
  const sbVpip  = pct(ps.SB?.v,  ps.SB?.h);

  if (epVpip !== null && epVpip > 22) {
    findings.push({
      kind: 'leak',
      title: `EP VPIP ${epVpip}% — playing too wide from early position`,
      body: `From early position you're out of position against most of the table for every street. Stick to your strongest hands (TT+, AK, AQs) and fold the rest. Playing ${epVpip}% from EP creates dominated spots on almost every flop.`,
    });
  }

  if (btnVpip !== null && (ps.BTN?.h ?? 0) >= 5) {
    const epRef = epVpip ?? 0;
    if (btnVpip < epRef + 12) {
      findings.push({
        kind: 'leak',
        title: `Button underused — VPIP only ${btnVpip}% (${Math.max(0, btnVpip - epRef)}% wider than EP)`,
        body: `You act last on every postflop street from the button, yet your VPIP is barely wider than from early position. Add suited connectors, small pairs, and suited aces to your BTN opening range — the positional advantage more than compensates for weaker cards.`,
      });
    } else if (btnVpip >= epRef + 18) {
      findings.push({
        kind: 'good',
        title: `Button well-utilised — VPIP ${btnVpip}% (${btnVpip - epRef}% wider than EP)`,
        body: 'You correctly widen up from the button, exploiting your positional advantage.',
      });
    }
  }

  if (sbVpip !== null && sbVpip > 45 && (ps.SB?.h ?? 0) >= 8) {
    findings.push({
      kind: 'leak',
      title: `SB VPIP ${sbVpip}% — completing too often from the small blind`,
      body: `The small blind is the worst seat — you're out of position postflop and have already committed half the BB. At ${sbVpip}% you're completing with too many marginal hands. Default to folding or 3-betting from the SB; avoid completing with hands that play poorly out of position.`,
    });
  }

  return findings;
}

// Extract this player's stats from each raw session object. Matches by
// display name with alias fallback so renames and multi-name players resolve.
function getPerSessionStats(sessions, playerName, playerConfig) {
  if (!sessions || !sessions.length) return [];
  const result = [];
  for (const s of sessions) {
    let sp = null;
    for (const [rawName, stats] of Object.entries(s.stats?.players || {})) {
      const canonical = resolveAlias(rawName, playerConfig);
      const display   = resolveDisplayName(canonical, playerConfig);
      if (rawName === playerName || canonical === playerName || display === playerName) {
        sp = stats;
        break;
      }
    }
    if (!sp || !sp.handsDealt) continue;
    const threeBetOpp = sp.threeBetOpp ?? 0;
    const cbetOpp     = sp.cbetOpp ?? 0;
    const sawFlop     = sp.sawFlopHands ?? 0;
    result.push({
      date:      s.gameDate,
      fileName:  s.fileName,
      id:        s.id,
      handsDealt: sp.handsDealt || 0,
      vpip:      sp.vpip      ?? null,
      pfr:       sp.pfr       ?? null,
      af:        sp.af        ?? null,
      netChips:  sp.netChips  ?? null,
      winRate:   sp.winRate   ?? null,
      threeBetPct: threeBetOpp > 3 ? Math.round(100 * (sp.threeBets ?? 0) / threeBetOpp) : null,
      cbetPct:     cbetOpp     > 3 ? Math.round(100 * (sp.cbets    ?? 0) / cbetOpp)     : null,
      wtsdPct:     sawFlop     > 3 ? Math.round(100 * (sp.wtsdHands ?? 0) / sawFlop)    : null,
    });
  }
  result.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return result;
}

// Compare the most-recent session against the prior average and generate
// coaching observations for notable stat shifts.
function buildSessionNarratives(sessionStats) {
  if (!sessionStats || sessionStats.length < 2) return [];
  const last = sessionStats[sessionStats.length - 1];
  const prev = sessionStats.slice(0, -1);
  const narratives = [];

  const avgOf = (key) => {
    const vals = prev.map(s => s[key]).filter(v => v != null && !Number.isNaN(v));
    return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
  };

  const enough = last.handsDealt >= 12;

  // VPIP shift
  if (enough && last.vpip != null) {
    const avg = avgOf('vpip');
    if (avg != null) {
      const diff = +(last.vpip - avg).toFixed(1);
      if (diff > 8) {
        narratives.push({
          kind: 'alert', metric: 'VPIP',
          title: `Played more hands last session: ${avg}% → ${last.vpip}% VPIP`,
          body: `You entered ${diff}% more pots than your average across previous sessions. This can signal tilt, boredom, or a read on table weakness — but also just variance. Ask: were those extra hands profitable, or did they put you in tough "second-best" spots?`,
          focus: `Aim to stay near your ${avg}% baseline. Before calling a preflop raise, make sure you'd also raise this hand yourself.`,
        });
      } else if (diff < -8) {
        narratives.push({
          kind: 'positive', metric: 'VPIP',
          title: `Tightened up last session: ${avg}% → ${last.vpip}% VPIP`,
          body: `You played ${Math.abs(diff)}% fewer hands than your average — a disciplined session. If it was intentional (aggressive table, out-of-position spots), that's quality adjustment. Check whether late-position steal opportunities were also passed up.`,
          focus: null,
        });
      }
    }
  }

  // Limping (VPIP-PFR gap)
  if (enough && last.vpip != null && last.pfr != null) {
    const lastGap = +(last.vpip - last.pfr).toFixed(1);
    const prevGaps = prev
      .filter(s => s.vpip != null && s.pfr != null)
      .map(s => +(s.vpip - s.pfr).toFixed(1));
    const avgGap = prevGaps.length
      ? +(prevGaps.reduce((a, b) => a + b, 0) / prevGaps.length).toFixed(1)
      : null;
    if (avgGap != null && lastGap - avgGap > 7) {
      narratives.push({
        kind: 'alert', metric: 'Limping',
        title: `More limping last session: VPIP-PFR gap ${avgGap}% → ${lastGap}%`,
        body: `The gap between how often you entered a pot and how often you raised grew by ${+(lastGap - avgGap).toFixed(1)}%. That extra gap is limps — entering pots passively. Limping gives up initiative, invites multi-way pots, and makes postflop play harder.`,
        focus: 'Default to raise-or-fold preflop. If a hand isn\'t worth raising, it\'s rarely worth calling.',
      });
    }
  }

  // AF drop
  if (enough && last.af != null && last.af !== 99) {
    const avg = avgOf('af');
    if (avg != null && avg !== 99) {
      const diff = +(last.af - avg).toFixed(2);
      if (diff < -1.2) {
        narratives.push({
          kind: 'alert', metric: 'Aggression',
          title: `Less aggressive postflop last session: AF ${avg} → ${last.af}`,
          body: `Your aggression factor dropped noticeably. This often means more calling and checking when you should be betting for value or protection. Passive play donates value — when you have a made hand, make your opponents pay to draw.`,
          focus: 'When you connect with the board, bet. Don\'t let opponents see free cards that could beat you.',
        });
      } else if (diff > 1.5) {
        narratives.push({
          kind: 'positive', metric: 'Aggression',
          title: `More aggressive last session: AF ${avg} → ${last.af}`,
          body: `You applied more pressure postflop. If backed by good hand reading this is a positive shift — just ensure you're mixing in some check-calls so you're not purely mechanical with your betting.`,
          focus: null,
        });
      }
    }
  }

  // C-bet shift
  if (enough && last.cbetPct != null) {
    const avg = avgOf('cbetPct');
    if (avg != null) {
      const diff = last.cbetPct - avg;
      if (diff < -20) {
        narratives.push({
          kind: 'alert', metric: 'C-bet',
          title: `C-bet dropped last session: ${avg}% → ${last.cbetPct}%`,
          body: `You continuation-bet significantly less often. If you were adjusting to opponents who call too much, that's a smart read. But a sharp drop usually means giving up initiative and letting opponents take pots with air after your preflop raises.`,
          focus: 'Follow up your preflop raises more consistently on flops that fit your range.',
        });
      } else if (diff > 20) {
        narratives.push({
          kind: 'positive', metric: 'C-bet',
          title: `C-bet increased last session: ${avg}% → ${last.cbetPct}%`,
          body: `You followed up preflop raises with more flop bets. More c-betting keeps opponents under pressure — just make sure you're picking good boards where your range has an advantage.`,
          focus: null,
        });
      }
    }
  }

  // WTSD shift
  if (enough && last.wtsdPct != null) {
    const avg = avgOf('wtsdPct');
    if (avg != null && last.wtsdPct - avg > 12) {
      narratives.push({
        kind: 'alert', metric: 'WTSD',
        title: `Went to showdown more last session: ${avg}% → ${last.wtsdPct}% WTSD`,
        body: `You reached showdown ${+(last.wtsdPct - avg).toFixed(0)}% more often than usual. This typically means calling more turn and river bets with marginal hands. When opponents fire multiple barrels, they usually have something — be more selective about which hands you take to showdown.`,
        focus: 'Ask yourself before calling a river bet: "Am I calling because I have a good hand, or because I can\'t let go?"',
      });
    }
  }

  // Net chips result
  if (enough && last.netChips != null && last.netChips < -400) {
    narratives.push({
      kind: 'alert', metric: 'Result',
      title: `Losing session: ${last.netChips.toLocaleString()} chips`,
      body: `Losing sessions happen to everyone — the key question is why. Bad beats and coolers are variance; calling down too light, playing too many hands, or missing value are decisions. Look at your key hands to separate the two before drawing conclusions.`,
      focus: 'After a big loss, review the 2-3 biggest pots you lost. Were they unavoidable, or were there earlier decision points you can improve?',
    });
  }

  return narratives;
}

// Pick the top 3 most actionable coaching items for the next session,
// prioritising session-specific alerts over chronic overall leaks.
function buildNextSessionFocus(findings, positionalFindings, sessionNarratives) {
  const items = [];

  // Session-specific alerts with a concrete action come first
  for (const n of sessionNarratives) {
    if (items.length >= 3) break;
    if (n.kind === 'alert' && n.focus) {
      items.push({ badge: n.metric, title: n.title, action: n.focus });
    }
  }

  // Fill remaining slots with top overall leaks
  const leaks = [...findings, ...positionalFindings].filter(f => f.kind === 'leak');
  for (const leak of leaks) {
    if (items.length >= 3) break;
    // Use the first sentence of the body as the action
    const action = leak.body.split('. ')[0].trim() + '.';
    items.push({ badge: 'Overall', title: leak.title, action });
  }

  return items.slice(0, 3);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—';
  const parts = iso.split('-');
  return parts.length >= 3 ? `${parts[1]}/${parts[2]}` : iso;
}

function SessionBreakdown({ sessionStats }) {
  if (!sessionStats || sessionStats.length < 2) return null;
  const fmtNet = (n) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toLocaleString()}`;
  const netColor = (n) => n == null ? 'var(--muted)' : n >= 0 ? 'var(--win)' : 'var(--lose)';

  return (
    <div className="cr-session-breakdown">
      <h4 className="cr-col-title">📅 Session by Session</h4>
      <p className="cr-empty" style={{ marginBottom: 10 }}>
        Your stats per session — spot trends and inconsistencies across dates.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="cr-session-table">
          <thead>
            <tr>
              <th>Session</th>
              <th>Hands</th>
              <th>VPIP</th>
              <th>PFR</th>
              <th>AF</th>
              <th>3-Bet</th>
              <th>C-Bet</th>
              <th>WTSD</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            {sessionStats.map((s, i) => {
              const isLast = i === sessionStats.length - 1;
              return (
                <tr key={s.id || i} className={isLast ? 'cr-session-last' : ''}>
                  <td className="cr-session-name">
                    <span title={s.date || ''}>{s.fileName || fmtDate(s.date)}</span>
                    {isLast && <span className="cr-session-badge">Latest</span>}
                  </td>
                  <td>{s.handsDealt}</td>
                  <td>{s.vpip != null ? `${s.vpip}%` : '—'}</td>
                  <td>{s.pfr  != null ? `${s.pfr}%`  : '—'}</td>
                  <td>{s.af   != null ? (s.af === 99 ? '∞' : s.af) : '—'}</td>
                  <td>{s.threeBetPct != null ? `${s.threeBetPct}%` : '—'}</td>
                  <td>{s.cbetPct    != null ? `${s.cbetPct}%`     : '—'}</td>
                  <td>{s.wtsdPct   != null ? `${s.wtsdPct}%`     : '—'}</td>
                  <td style={{ color: netColor(s.netChips), fontWeight: 600 }}>
                    {fmtNet(s.netChips)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SessionNarratives({ narratives }) {
  if (!narratives || !narratives.length) return null;
  return (
    <div className="cr-session-narratives">
      <h4 className="cr-col-title" style={{ marginBottom: 8 }}>What changed last session</h4>
      {narratives.map((n, i) => (
        <div key={i} className={`cr-session-narrative cr-session-narrative-${n.kind}`}>
          <div className="cr-sn-title">
            {n.kind === 'alert' ? '⚠ ' : '✓ '}{n.title}
          </div>
          <div className="cr-sn-body">{n.body}</div>
        </div>
      ))}
    </div>
  );
}

function FocusBox({ items }) {
  if (!items || !items.length) return null;
  return (
    <div className="cr-focus">
      <h4 className="cr-col-title" style={{ marginBottom: 10 }}>🎯 Focus for your next session</h4>
      <ol className="cr-focus-list">
        {items.map((item, i) => (
          <li key={i} className="cr-focus-item">
            <span className="cr-focus-num">{i + 1}</span>
            <div className="cr-focus-content">
              <div className="cr-focus-badge">{item.badge}</div>
              <div className="cr-focus-title">{item.title}</div>
              <div className="cr-focus-action">{item.action}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─── Per-action analysis (pot odds + hand-strength heuristics) ──────────────

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
  let contrib = {};
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
    } else if (e.action === 'return') {
      // Uncalled bet handed back — it was never matched, so it leaves the pot.
      pot = Math.max(0, pot - (e.amount || 0));
      contrib[e.player] = Math.max(0, before - (e.amount || 0));
      continue;
    } else if (e.action === 'post-dead-sb') {
      // Dead money (missing small blind): joins the pot but doesn't count
      // toward the poster's street contribution or the price to call.
      pot += e.amount || 0;
      continue;
    } else {
      continue;
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

// ─── Hand search ─────────────────────────────────────────────────────────────

const _RANK_ALIAS = { t: '10', T: '10' };
const normRank = (r) => _RANK_ALIAS[r] ?? r.toUpperCase();

// Parse the user's query into a typed descriptor. Supports:
//   "#42" / "42"   → hand number lookup
//   "AA" / "AKs"   → hole-card match (optional s/o suffix for suited/offsuit)
function parseHandQuery(raw) {
  const q = raw.trim();
  if (!q) return null;
  const numM = q.match(/^#?(\d{1,4})$/);
  if (numM) return { type: 'num', num: parseInt(numM[1], 10) };
  const RANK = '(10|[2-9TJQKAtjqka])';
  const cardM = q.match(new RegExp(`^${RANK}${RANK}(s|o)?$`, 'i'));
  if (cardM) return { type: 'cards', r1: normRank(cardM[1]), r2: normRank(cardM[2]), suitedness: cardM[3]?.toLowerCase() ?? null };
  return null;
}

function matchesHandQuery(h, parsed) {
  if (!parsed) return false;
  if (parsed.type === 'num') return h.num === parsed.num;
  if (parsed.type === 'cards') {
    if (!h.c1 || !h.c2) return false;
    const { r1, r2, suitedness } = parsed;
    const rankMatch = (h.c1.rank === r1 && h.c2.rank === r2) || (h.c1.rank === r2 && h.c2.rank === r1);
    if (!rankMatch) return false;
    const suited = h.c1.suit === h.c2.suit;
    if (suitedness === 's') return suited;
    if (suitedness === 'o') return !suited;
    return true;
  }
  return false;
}

// Build coaching tags for any hand (used by search results, which span the
// full history rather than just the top-ranked key hands).
function tagsForHand(h, playerName, getLog) {
  const cat = h.c1 && h.c2 ? categoryFromCards(h.c1, h.c2) : null;
  const log = getLog(h);
  const myPreflop = log.filter(e => e.type === 'action' && e.street === 'preflop' && e.player === playerName);
  const enteredVoluntarily = myPreflop.some(a => ['call', 'raise', 'bet'].includes(a.action));
  const tags = [];

  if (h.isBadBeat) {
    tags.push({ kind: 'variance', text: 'Bad beat — you got your money in good. Variance, not a mistake.' });
  } else if (h.isSuckOut) {
    tags.push({ kind: 'variance', text: 'Suck-out — you were behind and got there. Good result; don\'t rely on it repeating.' });
  } else if (h.isSplit) {
    tags.push({ kind: 'good', text: `Split the pot${h.wonAmount ? ` (+${h.wonAmount.toLocaleString()} chips)` : ''}${h.myHandName ? ` with ${h.myHandName}` : ''}.` });
  } else if (h.won) {
    tags.push({ kind: 'good', text: `Won${h.wonAmount ? ` +${h.wonAmount.toLocaleString()} chips` : ''}${h.myHandName ? ` with ${h.myHandName}` : ''}.` });
  } else if (h.wasShown) {
    tags.push({ kind: 'leak', text: `Lost at showdown${h.winnerHandName ? ` to ${h.winnerHandName}` : ''}${h.myHandName ? ` (held ${h.myHandName})` : ''}.` });
  } else if (enteredVoluntarily) {
    tags.push({ kind: 'neutral', text: 'Folded after entering the pot — either a disciplined laydown or a spot worth reviewing. Check the action below.' });
  } else {
    tags.push({ kind: 'neutral', text: 'Folded preflop — no chips invested.' });
  }

  if (cat && CATEGORY_TRASH.has(cat) && enteredVoluntarily && !h.isBadBeat) {
    tags.push({ kind: 'leak', text: `Entered preflop with ${cat} — a hand that bleeds chips from most positions.` });
  }
  if (h.wasShown && !h.won && (cat === 'Medium Pair (TT-88)' || cat === 'Small Pair (77-55)') && (h.board?.length ?? 0) >= 3) {
    tags.push({ kind: 'leak', text: 'Middle pair beaten at showdown — when facing multi-street bets with overcards on board, mid-pair rarely holds up.' });
  }
  if (!h.c1 || !h.c2) {
    tags.push({ kind: 'neutral', text: 'Hole cards not recorded for this hand — coaching is limited to the action log.' });
  }

  return tags;
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

function KeyHandCard({ scored, isMerged, playerName, expanded, onToggle, getLog, onReplay }) {
  const { h, tags } = scored;
  const steps = expanded ? analyzeHandActions(h, playerName, getLog(h)) : [];
  const log = getLog(h);

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
        {log.length > 0 && (
          <button className="replay-btn" style={{ marginTop: 6, alignSelf: 'flex-start' }} onClick={e => { e.stopPropagation(); onReplay(h, log); }}>
            ▶ Replay
          </button>
        )}
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

export default function CoachingReport({
  player,
  isMerged = false,
  isViewer = false,
  handActionLogs = {},
  sessions = [],
  playerConfig = null,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedKeyHands, setExpandedKeyHands] = useState(false);
  const [expandedHandIdx, setExpandedHandIdx] = useState(null);
  const [replay, setReplay] = useState(null);
  const [handSearch, setHandSearch] = useState('');
  const [expandedSearchIdx, setExpandedSearchIdx] = useState(null);

  const searchResults = useMemo(() => {
    const q = handSearch.trim();
    if (!q) return [];
    const parsed = parseHandQuery(q);
    if (!parsed) return [];
    return (player.handsHistory || []).filter(h => matchesHandQuery(h, parsed)).slice(0, 10);
  }, [handSearch, player.handsHistory]);

  const getLog = (h) => handActionLogs[h.sessionId ? `${h.sessionId}_${h.num}` : h.num] ?? h.actionLog ?? [];

  const perSessionStats    = getPerSessionStats(sessions, player.name, playerConfig);
  const hasSessionData     = perSessionStats.length >= 2;
  const archetype          = styleArchetype(player);
  const findings           = buildFindings(player);
  const positionalFindings = buildPositionalFindings(player);
  const sessionNarratives  = buildSessionNarratives(perSessionStats);
  const focusItems         = buildNextSessionFocus(findings, positionalFindings, sessionNarratives);

  const wins     = findings.filter(f => f.kind === 'good');
  const posWins  = positionalFindings.filter(f => f.kind === 'good');
  const leaks    = [...findings, ...positionalFindings].filter(f => f.kind === 'leak');
  const variance = findings.filter(f => f.kind === 'variance');
  const keyHands = rankKeyHands(player, getLog);
  const hasAnyKnownCards = keyHands.length > 0;

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

  const scopeBlurb = isViewer
    ? 'Every hand dealt to this player is in the dataset, so preflop entry decisions are graded too.'
    : 'Action-by-action breakdowns are only available for hands this player took to showdown — preflop folds don\'t reveal cards.';

  return (
    <div className="coaching-report">
      {replay && <HandReplayer log={replay.log} hand={replay.hand} heroName={replay.heroName} heroCards={replay.heroCards} onClose={() => setReplay(null)} />}
      {Header}
      <p className="cr-subtitle">
        How {isViewer ? 'you' : player.name} played — and what poker theory says about it.
        {isMerged && <> Numbers are aggregated across the selected sessions.</>} {scopeBlurb}
      </p>

      {/* Style archetype */}
      <div className="cr-archetype">
        <div className="cr-archetype-label">{isViewer ? 'Your style' : 'Their style'}</div>
        <div className="cr-archetype-name">{archetype.name}</div>
        <div className="cr-archetype-body">{archetype.body}</div>
      </div>

      {/* Next session focus — shown when there's something specific to work on */}
      {focusItems.length > 0 && <FocusBox items={focusItems} />}

      {/* Strengths / leaks grid */}
      <div className="cr-findings-grid">
        <div className="cr-findings-col">
          <h4 className="cr-col-title cr-col-good">✓ What {isViewer ? 'you did' : 'they did'} well</h4>
          {wins.length + posWins.length === 0 ? (
            <p className="cr-empty">No clear strengths jumped out yet. With more hands the picture sharpens.</p>
          ) : (
            <ul className="cr-finding-list">
              {[...wins, ...posWins].map((f, i) => (
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

      {/* Session-by-session breakdown — only in merged mode with ≥ 2 sessions */}
      {hasSessionData && (
        <div className="cr-session-section">
          <SessionBreakdown sessionStats={perSessionStats} />
          {sessionNarratives.length > 0 && (
            <SessionNarratives narratives={sessionNarratives} />
          )}
        </div>
      )}

      {/* Key hands */}
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
              onReplay={(h, log) => setReplay({ log, hand: h, heroName: player.name, heroCards: h.c1 && h.c2 ? [h.c1, h.c2] : null })}
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

      {/* Hand search */}
      <div className="cr-key-hands">
        <h4 className="cr-col-title">🔍 Search hand history</h4>
        <p className="cr-empty" style={{ marginBottom: 10 }}>
          Look up any hand by number or hole cards for a full coaching breakdown.
        </p>
        <div className="cr-search-row">
          <input
            className="cr-search-input"
            type="text"
            placeholder="Hand # (e.g. 42) · hole cards (e.g. AA, AKs, KQ)"
            value={handSearch}
            onChange={e => { setHandSearch(e.target.value); setExpandedSearchIdx(null); }}
          />
          {handSearch && (
            <button className="btn btn-ghost cr-search-clear" onClick={() => { setHandSearch(''); setExpandedSearchIdx(null); }}>✕</button>
          )}
        </div>
        {handSearch.trim() && parseHandQuery(handSearch.trim()) === null && (
          <p className="cr-empty" style={{ marginTop: 8 }}>
            Unrecognised query — try a hand number like <code>42</code>, or hole cards like <code>AA</code>, <code>AKs</code>, <code>KQ</code>.
          </p>
        )}
        {handSearch.trim() && parseHandQuery(handSearch.trim()) !== null && searchResults.length === 0 && (
          <p className="cr-empty" style={{ marginTop: 8 }}>No matching hands found.</p>
        )}
        {searchResults.map((h, i) => (
          <KeyHandCard
            key={`${h.sessionId ?? ''}_${h.num}`}
            scored={{ h, score: 0, tags: tagsForHand(h, player.name, getLog) }}
            isMerged={isMerged}
            playerName={player.name}
            getLog={getLog}
            expanded={expandedSearchIdx === i}
            onToggle={() => setExpandedSearchIdx(expandedSearchIdx === i ? null : i)}
            onReplay={(hand, log) => setReplay({ log, hand, heroName: player.name, heroCards: hand.c1 && hand.c2 ? [hand.c1, hand.c2] : null })}
          />
        ))}
      </div>
    </div>
  );
}

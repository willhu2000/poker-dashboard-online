import { useState } from 'react';
import { CardBadge, BigPotCard } from './cardUI.jsx';

const POS_ORDER = ['BTN', 'SB', 'BB', 'LP', 'MP', 'EP'];
const POS_LABEL = { BTN: 'Button', SB: 'Small Blind', BB: 'Big Blind', LP: 'Late (CO)', MP: 'Middle', EP: 'Early' };
const pctOf = (num, den) => (den > 0 ? +(num / den * 100).toFixed(1) : null);
const fmtPct = (v) => (v == null ? '—' : `${v}%`);

function modeBB(bbCounts) {
  let best = null, bestCnt = -1;
  for (const [size, cnt] of Object.entries(bbCounts || {})) {
    if (cnt > bestCnt) { bestCnt = cnt; best = +size; }
  }
  return best;
}

function AdvTile({ label, value, sub, color }) {
  return (
    <div className="adv-tile">
      <div className="adv-tile-label">{label}</div>
      <div className="adv-tile-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="adv-tile-sub">{sub}</div>}
    </div>
  );
}

export default function AdvancedStats({ player: p, isMerged = false, getLog, onReplay }) {
  const [openOpp, setOpenOpp] = useState(null); // expanded head-to-head opponent
  const [openHand, setOpenHand] = useState(null); // expanded H2H hand key
  const posRows = POS_ORDER
    .map(k => ({ k, ...(p.posStats?.[k] || { h: 0, v: 0, p: 0, w: 0 }) }))
    .filter(r => r.h > 0);
  const wtsd = pctOf(p.wtsdHands, p.sawFlopHands);
  const wsd = pctOf(p.wsdHands, p.wtsdHands);
  const threeBet = pctOf(p.threeBets, p.threeBetOpp);
  const cbet = pctOf(p.cbets, p.cbetOpp);
  const bb = modeBB(p.bbCounts);
  const bbPer100 = bb && p.handsDealt ? +((p.netChips / bb) / p.handsDealt * 100).toFixed(1) : null;
  const h2h = Object.entries(p.vsOpponents || {})
    .map(([name, r]) => ({ name, w: r.w || 0, l: r.l || 0, n: (r.w || 0) + (r.l || 0) }))
    .filter(o => o.n > 0)
    .sort((a, b) => b.n - a.n);

  const hasAny = posRows.length || wtsd != null || threeBet != null || cbet != null || bbPer100 != null || h2h.length;
  if (!hasAny) return null;

  return (
    <>
      <div className="section-title" style={{ fontSize: '0.9rem', marginTop: 16 }}>
        📐 Advanced Stats
        <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '0.78rem', marginLeft: 8 }}>
          — positional play, showdown funnel, 3-bet/c-bet, head-to-head
        </span>
      </div>

      <div className="adv-tiles">
        <AdvTile label="bb / 100" value={bbPer100 == null ? '—' : `${bbPer100 >= 0 ? '+' : ''}${bbPer100}`}
          color={bbPer100 == null ? undefined : (bbPer100 >= 0 ? 'var(--win)' : 'var(--lose)')}
          sub={bb ? `big blind = ${bb}` : 'win rate'} />
        <AdvTile label="WTSD" value={fmtPct(wtsd)} sub="went to showdown" />
        <AdvTile label="W$SD" value={fmtPct(wsd)} sub="won at showdown" />
        <AdvTile label="3-Bet" value={fmtPct(threeBet)} sub="preflop re-raise" />
        <AdvTile label="C-Bet" value={fmtPct(cbet)} sub="flop, as aggressor" />
      </div>

      {posRows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="adv-pos-table">
            <thead>
              <tr><th>Position</th><th>Hands</th><th>VPIP</th><th>PFR</th><th>Win %</th></tr>
            </thead>
            <tbody>
              {posRows.map(r => (
                <tr key={r.k}>
                  <td><strong>{POS_LABEL[r.k]}</strong></td>
                  <td>{r.h}</td>
                  <td>{fmtPct(pctOf(r.v, r.h))}</td>
                  <td>{fmtPct(pctOf(r.p, r.h))}</td>
                  <td>{fmtPct(pctOf(r.w, r.h))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {h2h.length > 0 && (
        <div className="adv-h2h">
          <div className="adv-h2h-label">
            Head-to-head at showdown
            <span style={{ textTransform: 'none', fontWeight: 400, marginLeft: 6 }}>— click an opponent to see the hands</span>
          </div>
          <div className="adv-h2h-list">
            {h2h.map(o => (
              <button
                key={o.name}
                className={`adv-h2h-item${openOpp === o.name ? ' active' : ''}`}
                onClick={() => { setOpenOpp(x => (x === o.name ? null : o.name)); setOpenHand(null); }}
              >
                vs {o.name}: <span className="pos">{o.w}W</span>–<span className="neg">{o.l}L</span>
                <span className="adv-h2h-chev">{openOpp === o.name ? ' ▾' : ' ▸'}</span>
              </button>
            ))}
          </div>
          {openOpp && (() => {
            const hands = (p.handsHistory || []).filter(h =>
              h.wasShown && (h.opponents || []).some(op => op.name === openOpp && op.c1));
            if (!hands.length) return <p className="cr-empty" style={{ marginTop: 8 }}>No showdown hands recorded vs {openOpp}.</p>;
            return (
              <div className="big-pot-list" style={{ marginTop: 8 }}>
                {hands.map((h, idx) => {
                  const key = `h2h-${idx}`;
                  const amt = (h.wonAmount ?? h.potSize).toLocaleString();
                  const amountNode = h.isSplit
                    ? <span className="bp-amount split">Split {amt}</span>
                    : h.won ? <span className="bp-amount pos">Won {amt}</span>
                      : <span className="bp-amount neg">Lost {(h.net != null ? -h.net : h.potSize).toLocaleString()}</span>;
                  const oc = (h.opponents || []).find(op => op.name === openOpp);
                  return (
                    <BigPotCard
                      key={key} kind={h.isSplit ? 'split' : h.won ? 'win' : 'loss'} rank={null} h={h} isMerged={isMerged}
                      amountNode={amountNode}
                      extraDetails={oc && oc.c1 && <span style={{ color: 'var(--muted)', fontSize: '0.72rem', marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 2 }}>{openOpp}: <CardBadge card={oc.c1} /><CardBadge card={oc.c2} /></span>}
                      expanded={openHand === key} onToggle={() => setOpenHand(x => (x === key ? null : key))}
                      log={getLog ? getLog(h) : []} onReplay={onReplay ? () => onReplay(h) : null}
                    />
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}
    </>
  );
}

import { useState, useEffect, useMemo, useRef } from 'react';
import { playActionSound } from '../sounds.js';
import { buildReplayFrames } from '../replayEngine.js';
import { CardBadge, ActionVerb } from './cardUI.jsx';
import { fmtDate } from '../format.js';

const SPEEDS = [1, 1.5, 2];
const BASE_DELAY_MS = 1100;

function ReplaySeat({ p, angle, acting, isDealer, isWinner }) {
  const x = 50 + 44 * Math.cos(angle);
  const y = 50 + 46 * Math.sin(angle);
  return (
    <div
      className={`rt-seat${acting ? ' acting' : ''}${p.folded ? ' folded' : ''}${p.isHero ? ' hero' : ''}${isWinner ? ' winner' : ''}`}
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <div className="rt-cards">
        {p.cards && p.cards.length
          ? p.cards.map((c, k) => <CardBadge key={k} card={c} />)
          : (!p.folded && <><span className="rt-cardback" /><span className="rt-cardback" /></>)}
      </div>
      <div className="rt-name">
        {isDealer && <span className="rt-dealer" title="Dealer">D</span>}
        {p.pos && <span className="rt-pos">{p.pos}</span>}
        <span className="rt-pname">{p.name}</span>
      </div>
      <div className="rt-stack">{Math.max(0, p.stack).toLocaleString()}</div>
      {p.streetBet > 0 && <div className="rt-bet">{p.streetBet.toLocaleString()}</div>}
    </div>
  );
}

export default function HandReplayer({ log, hand, heroName, heroCards, onClose }) {
  const { frames, meta } = useMemo(() => buildReplayFrames(log, heroName, heroCards), [log, heroName, heroCards]);
  // Pot collectors — highlighted as winners on the final frame.
  const winners = useMemo(() => new Set(
    (log || []).filter(e => e.type === 'action' && e.action === 'collect').map(e => e.player)
  ), [log]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [soundOn, setSoundOn] = useState(true);
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;

  useEffect(() => {
    if (!playing) return undefined;
    if (i >= frames.length - 1) { setPlaying(false); return undefined; }
    const t = setTimeout(() => setI(x => Math.min(x + 1, frames.length - 1)), BASE_DELAY_MS / speed);
    return () => clearTimeout(t);
  }, [playing, i, frames.length, speed]);

  useEffect(() => {
    if (!soundRef.current) return;
    const ev = frames[Math.min(i, frames.length - 1)]?.ev;
    if (ev) playActionSound(ev.action);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  // Keyboard: ←/→ step, space play/pause, Home restart, Escape closes.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setPlaying(false); setI(x => Math.max(0, x - 1)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setPlaying(false); setI(x => Math.min(frames.length - 1, x + 1)); }
      else if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p); }
      else if (e.key === 'Home') { e.preventDefault(); setPlaying(false); setI(0); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [frames.length, onClose]);

  if (!frames.length) return null;
  const f = frames[Math.min(i, frames.length - 1)];
  const isLastFrame = i >= frames.length - 1;

  const heroIdx = f.players.findIndex(p => p.isHero);
  const rot = heroIdx >= 0 ? heroIdx : 0;
  const n = f.players.length || 1;
  const seats = f.players.map((_, k) => f.players[(rot + k) % n]);

  return (
    <div className="replay-overlay" onClick={onClose}>
      <div className="replay-modal table" onClick={e => e.stopPropagation()}>
        <div className="replay-head">
          <span>▶ Replay — Hand #{hand?.num}{hand?.sessionDate ? ` · ${fmtDate(hand.sessionDate)}` : ''}</span>
          <button className="replay-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="rt-felt">
          {seats.map((p, k) => (
            <ReplaySeat
              key={p.name}
              p={p}
              angle={(90 + k * 360 / n) * Math.PI / 180}
              acting={p.name === f.acting}
              isDealer={meta?.dealer === p.name}
              isWinner={isLastFrame && winners.has(p.name)}
            />
          ))}
          <div className="rt-center">
            <div className="rt-board">
              {[0, 1, 2, 3, 4].map(k => (
                f.board[k]
                  ? <CardBadge key={k} card={f.board[k]} />
                  : <span key={k} className="rt-board-slot" />
              ))}
            </div>
            <div className="rt-pot">Pot {f.pot.toLocaleString()}</div>
            {isLastFrame && winners.size > 0 && (
              <div className="rt-winner-tag">🏆 {[...winners].join(' & ')}</div>
            )}
          </div>
        </div>
        <div className="replay-current">
          <span className="rt-street-tag">{f.street.toUpperCase()}</span>
          <span className="al-player">{f.ev.player}</span>
          <span className="al-verb"><ActionVerb ev={f.ev} /></span>
        </div>
        <div className="replay-controls">
          <button onClick={() => { setPlaying(false); setI(0); }} title="Restart (Home)">⏮</button>
          <button onClick={() => { setPlaying(false); setI(x => Math.max(0, x - 1)); }} disabled={i <= 0} title="Previous (←)">◀</button>
          <button className="replay-play" onClick={() => setPlaying(p => !p)} title="Play/pause (space)">{playing ? '⏸ Pause' : '▶ Play'}</button>
          <button onClick={() => { setPlaying(false); setI(x => Math.min(frames.length - 1, x + 1)); }} disabled={i >= frames.length - 1} title="Next (→)">▶</button>
          <button onClick={() => setSpeed(s => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])} title="Playback speed">{speed}×</button>
          <button onClick={() => setSoundOn(s => !s)} title={soundOn ? 'Mute sound' : 'Unmute sound'}>{soundOn ? '🔊' : '🔇'}</button>
          <span className="replay-progress">{i + 1}/{frames.length}</span>
        </div>
      </div>
    </div>
  );
}

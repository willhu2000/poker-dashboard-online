// Tiny Web Audio synth for the hand replayer — no audio files, everything is
// generated. All AudioContext access is lazy so importing this module is safe in
// non-browser environments (tests). The context is created/resumed on first play,
// which happens inside a user gesture (opening the replay / stepping).

let ctx = null;

function getCtx() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    try { ctx = new AC(); } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone({ freq = 440, type = 'sine', dur = 0.12, gain = 0.18, slideTo = null, delay = 0 }) {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

// Short filtered noise burst — used for chip/card sounds.
function noise({ dur = 0.09, gain = 0.14, delay = 0, hp = 1200 }) {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const n = Math.floor(c.sampleRate * dur);
  const buffer = c.createBuffer(1, n, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n); // decaying
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = hp;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(filter); filter.connect(g); g.connect(c.destination);
  src.start(t0);
}

// Play the sound matching a replay action. Unknown actions are silent.
export function playActionSound(action) {
  switch (action) {
    case 'check':
      tone({ freq: 200, type: 'sine', dur: 0.07, gain: 0.16 }); // knuckle tap
      break;
    case 'call':
      tone({ freq: 340, type: 'triangle', dur: 0.1, gain: 0.18 });
      break;
    case 'bet':
    case 'raise':
      noise({ dur: 0.05, gain: 0.1, hp: 2500 });               // chips clink
      tone({ freq: 620, type: 'square', dur: 0.05, gain: 0.1 });
      tone({ freq: 880, type: 'square', dur: 0.06, gain: 0.1, delay: 0.07 });
      break;
    case 'fold':
      tone({ freq: 180, type: 'sine', dur: 0.18, gain: 0.18, slideTo: 80 }); // muck slide
      break;
    case 'post-sb':
    case 'post-bb':
      tone({ freq: 520, type: 'triangle', dur: 0.07, gain: 0.1 });
      break;
    case 'show':
      noise({ dur: 0.11, gain: 0.13, hp: 900 });               // card flip
      break;
    case 'collect': {
      // Winning arpeggio C–E–G.
      tone({ freq: 523, dur: 0.1, gain: 0.16 });
      tone({ freq: 659, dur: 0.1, gain: 0.16, delay: 0.1 });
      tone({ freq: 784, dur: 0.18, gain: 0.18, delay: 0.2 });
      break;
    }
    default:
      break;
  }
}

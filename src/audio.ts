// Listens to what the TV speaker plays, for the background and visualizer.
//
// sendspin-js plays through its own AudioContext. Every node it connects to the speakers is
// rerouted through an output gain we own (so "visuals only" can silence the TV without telling
// Music Assistant), and also tapped by an analyser.

interface Tap {
  analyser: AnalyserNode;
  out: GainNode;
}

const taps = new WeakMap<BaseAudioContext, Tap>();
let current: Tap | null = null;
let muted = false;

export function installAudioTap(): void {
  const W = window as any;
  const proto: any = W.AudioNode && W.AudioNode.prototype;
  if (!proto || proto.__matvHooked) return;
  const connect = proto.connect;
  proto.connect = function (this: AudioNode, dest: any, ...rest: any[]) {
    try {
      if (dest && W.AudioDestinationNode && dest instanceof W.AudioDestinationNode && !(this as any).__matvOut) {
        let t = taps.get(this.context);
        if (!t) {
          const analyser = this.context.createAnalyser();
          analyser.fftSize = 2048;
          analyser.smoothingTimeConstant = 0.6;
          const out = this.context.createGain();
          (out as any).__matvOut = true;
          out.gain.value = muted ? 0 : 1;
          connect.call(out, dest);
          t = { analyser, out };
          taps.set(this.context, t);
        }
        connect.call(this, t.analyser);
        current = t;
        return connect.call(this, t.out, ...rest);
      }
    } catch {
      /* never let the visuals break playback */
    }
    return connect.call(this, dest, ...rest);
  };
  proto.__matvHooked = true;
}

/** Silences the TV's own output while keeping the analysis running (visuals only). */
export function setTvMuted(m: boolean): void {
  muted = m;
  if (current) current.out.gain.value = m ? 0 : 1;
}

export interface AudioFrame {
  active: boolean;
  bands: Float32Array; // 0..1 per band, log-spaced, smoothed for display
  bass: number; // 0..1
  mid: number;
  treble: number;
  level: number;
  beat: number; // 1 right on a detected beat, decaying to 0
}

export const BANDS = 96;
const frame: AudioFrame = {
  active: false,
  bands: new Float32Array(BANDS),
  bass: 0,
  mid: 0,
  treble: 0,
  level: 0,
  beat: 0,
};
let bins: Uint8Array | null = null;
let bassAvg = 0;
let lastBeat = 0;
let silentSince = 0;

/** Reads the analyser once per animation frame. */
export function readAudio(now: number, playing: boolean): AudioFrame {
  const a = current && current.analyser;
  if (!a || !playing) {
    frame.active = false;
    decay(0.9);
    return frame;
  }
  if (!bins || bins.length !== a.frequencyBinCount) bins = new Uint8Array(a.frequencyBinCount);
  a.getByteFrequencyData(bins as any);
  const n = bins.length;
  const nyq = a.context.sampleRate / 2;
  const binHz = nyq / n;
  // bands from 35 Hz to 16 kHz, log-spaced
  const f0 = 35;
  const f1 = 16000;
  let total = 0;
  for (let i = 0; i < BANDS; i++) {
    const lo = f0 * Math.pow(f1 / f0, i / BANDS);
    const hi = f0 * Math.pow(f1 / f0, (i + 1) / BANDS);
    const b0 = Math.max(1, Math.floor(lo / binHz));
    const b1 = Math.max(b0 + 1, Math.ceil(hi / binHz));
    let peak = 0;
    for (let j = b0; j < b1 && j < n; j++) if (bins[j] > peak) peak = bins[j];
    // lift the treble a little; it's naturally much quieter
    let v = (peak / 255) * (0.85 + 0.45 * (i / BANDS));
    v = Math.min(1, Math.max(0, (v - 0.12) / 0.88));
    const prev = frame.bands[i];
    frame.bands[i] = v > prev ? prev + (v - prev) * 0.6 : prev * 0.88 + v * 0.12;
    total += v;
  }
  const avg = (from: number, to: number) => {
    let s = 0;
    for (let i = from; i < to; i++) s += frame.bands[i];
    return s / (to - from);
  };
  frame.bass = avg(0, Math.round(BANDS * 0.16));
  frame.mid = avg(Math.round(BANDS * 0.16), Math.round(BANDS * 0.6));
  frame.treble = avg(Math.round(BANDS * 0.6), BANDS);
  frame.level = total / BANDS;
  frame.active = frame.level > 0.01;
  if (!frame.active) {
    if (!silentSince) silentSince = now;
  } else silentSince = 0;
  // beat: bass jumping well above its running average, at most ~4 per second
  const bassNow = avg(0, Math.round(BANDS * 0.1));
  bassAvg = bassAvg * 0.95 + bassNow * 0.05;
  if (bassNow > bassAvg * 1.35 + 0.06 && now - lastBeat > 240) {
    lastBeat = now;
    frame.beat = 1;
  } else frame.beat *= 0.88;
  return frame;
}

function decay(k: number): void {
  for (let i = 0; i < BANDS; i++) frame.bands[i] *= k;
  frame.bass *= k;
  frame.mid *= k;
  frame.treble *= k;
  frame.level *= k;
  frame.beat *= k;
}

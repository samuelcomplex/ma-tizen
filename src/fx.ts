// Visual effects: palette colors for the moving background, the audio visualizer and confetti.
// Everything here is cheap on purpose: TVs have slow CPUs, so movement is done with CSS
// transforms (GPU) and the canvases only draw while they have something to show.

// ------------------------------------------------------------------ palette

export function setBackdropColors(colors: string[]): void {
  const root = document.documentElement;
  colors.slice(0, 3).forEach((c, i) => root.style.setProperty(`--blob${i + 1}`, c));
}

// ------------------------------------------------------------------ visualizer

// sendspin-js plays through its own AudioContext. To see the audio, every node that connects to
// a context's speakers also gets connected to an analyser (which isn't connected onward, so it
// doesn't change what's heard).
const analysers = new WeakMap<BaseAudioContext, AnalyserNode>();
let lastAnalyser: AnalyserNode | null = null;

export function installAnalyserHook(): void {
  const proto: any = (window as any).AudioNode && (window as any).AudioNode.prototype;
  if (!proto || proto.__matvHooked) return;
  const connect = proto.connect;
  proto.connect = function (this: AudioNode, dest: any, ...rest: any[]) {
    const r = connect.call(this, dest, ...rest);
    try {
      if (dest && (window as any).AudioDestinationNode && dest instanceof (window as any).AudioDestinationNode) {
        let a = analysers.get(this.context);
        if (!a) {
          a = this.context.createAnalyser();
          a.fftSize = 512;
          a.smoothingTimeConstant = 0.78;
          analysers.set(this.context, a);
        }
        connect.call(this, a);
        lastAnalyser = a;
      }
    } catch {
      /* never let the visualizer break playback */
    }
    return r;
  };
  proto.__matvHooked = true;
}

const BARS = 56;

/** Draws spectrum bars on `canvas` while `active()` is true. */
export function startVisualizer(canvas: HTMLCanvasElement, active: () => boolean): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  let data: Uint8Array | null = null;
  const levels = new Float32Array(BARS);
  let shown = false;
  let lastFrame = 0;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    if (now - lastFrame < 33) return; // ~30 fps is plenty, and kind to the TV
    lastFrame = now;
    const on = active() && !!lastAnalyser;
    if (on !== shown) {
      shown = on;
      canvas.classList.toggle("on", on);
    }
    if (!on || !lastAnalyser) return;
    const a = lastAnalyser;
    if (!data || data.length !== a.frequencyBinCount) data = new Uint8Array(a.frequencyBinCount);
    a.getByteFrequencyData(data as any);
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#e8a33d";
    ctx.fillStyle = accent;
    // log-spaced bands from ~40 Hz up, so bass doesn't hog the left side
    const bins = data.length;
    const gap = 8;
    const bw = (w - gap * (BARS - 1)) / BARS;
    for (let i = 0; i < BARS; i++) {
      const lo = Math.floor(Math.pow(bins, i / BARS));
      const hi = Math.max(lo + 1, Math.floor(Math.pow(bins, (i + 1) / BARS)));
      let sum = 0;
      for (let j = lo; j < hi && j < bins; j++) sum += data[j];
      const v = sum / (hi - lo) / 255;
      levels[i] = Math.max(v, levels[i] * 0.86); // fall slowly
      const bh = Math.max(4, levels[i] * levels[i] * h);
      const x = i * (bw + gap);
      const r = Math.min(bw / 2, 6);
      ctx.globalAlpha = 0.35 + 0.5 * levels[i];
      roundRect(ctx, x, h - bh, bw, bh, r);
    }
    ctx.globalAlpha = 1;
  };
  requestAnimationFrame(frame);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.fill();
}

// ------------------------------------------------------------------ confetti

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
}

let confettiRunning = false;

/** A short burst of confetti from the top of the screen. */
export function confetti(canvas: HTMLCanvasElement, colors: string[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || confettiRunning) return;
  confettiRunning = true;
  const W = canvas.width;
  const H = canvas.height;
  const bits: Bit[] = [];
  for (let i = 0; i < 140; i++) {
    bits.push({
      x: W * (0.15 + Math.random() * 0.7),
      y: -20 - Math.random() * 200,
      vx: (Math.random() - 0.5) * 7,
      vy: 4 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      size: 10 + Math.random() * 12,
      color: colors[i % colors.length],
    });
  }
  canvas.classList.add("on");
  const start = performance.now();
  const step = (now: number) => {
    const t = now - start;
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    for (const b of bits) {
      b.vy += 0.12;
      b.vx *= 0.99;
      b.x += b.vx;
      b.y += b.vy;
      b.rot += b.vr;
      if (b.y < H + 40) alive++;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.globalAlpha = t > 3200 ? Math.max(0, 1 - (t - 3200) / 800) : 1;
      ctx.fillStyle = b.color;
      ctx.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2);
      ctx.restore();
    }
    if (alive && t < 4000) requestAnimationFrame(step);
    else {
      ctx.clearRect(0, 0, W, H);
      canvas.classList.remove("on");
      confettiRunning = false;
    }
  };
  requestAnimationFrame(step);
}

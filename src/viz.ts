// The music visualizer, drawn from the TV speaker's audio. Styles: bars along the bottom, a
// mirrored wave, or a ring around the album art.

import { AudioFrame, BANDS } from "./audio";

export type VizStyle = "bars" | "wave" | "ring" | "off";

function parseColor(c: string): [number, number, number] {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  if (m) return [+m[1], +m[2], +m[3]];
  const h = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (h) return [parseInt(h[1].slice(0, 2), 16), parseInt(h[1].slice(2, 4), 16), parseInt(h[1].slice(4, 6), 16)];
  return [232, 163, 61];
}

export class Visualizer {
  private ctx: CanvasRenderingContext2D;
  private peaks = new Float32Array(BANDS);
  private peakHold = new Float32Array(BANDS);
  private shown = false;
  private accent: [number, number, number] = [232, 163, 61];
  private accentStr = "";

  constructor(private canvas: HTMLCanvasElement, private artEl: HTMLElement) {
    // drawn at half size (a quarter of the pixels) and scaled up by the page; all the numbers
    // below are in 1920x1080 screen pixels
    canvas.width = 960;
    canvas.height = 540;
    this.ctx = canvas.getContext("2d")!;
    this.ctx.setTransform(0.5, 0, 0, 0.5, 0, 0);
  }

  draw(a: AudioFrame, style: VizStyle, now: number): void {
    const on = style !== "off" && a.active;
    const ctx = this.ctx;
    const W = 1920;
    const H = 1080;
    if (!on) {
      if (this.shown) {
        ctx.clearRect(0, 0, W, H);
        this.shown = false;
      }
      return;
    }
    this.shown = true;
    const acc = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    if (acc !== this.accentStr) {
      this.accentStr = acc;
      this.accent = parseColor(acc);
    }
    ctx.clearRect(0, 0, W, H);
    // peaks: hold briefly, then fall
    for (let i = 0; i < BANDS; i++) {
      const v = a.bands[i];
      if (v >= this.peaks[i]) {
        this.peaks[i] = v;
        this.peakHold[i] = now;
      } else if (now - this.peakHold[i] > 220) this.peaks[i] = Math.max(v, this.peaks[i] - 0.012);
    }
    if (style === "bars") this.bars(a, W, H);
    else if (style === "wave") this.wave(a, W, H, now);
    else this.ring(a, W, H);
  }

  private rgba(k: number, alpha: number): string {
    // k: 0 = accent, 1 = white
    const [r, g, b] = this.accent;
    return `rgba(${Math.round(r + (255 - r) * k)},${Math.round(g + (255 - g) * k)},${Math.round(b + (255 - b) * k)},${alpha})`;
  }

  /** Mirrored from the middle: bass in the center, treble at both edges. */
  private bars(a: AudioFrame, W: number, H: number): void {
    const ctx = this.ctx;
    const maxH = 300;
    const base = H - 30;
    const n = BANDS;
    const total = n * 2;
    const gap = 5;
    const bw = (W - 80 - gap * (total - 1)) / total;
    const grad = ctx.createLinearGradient(0, base - maxH, 0, base);
    grad.addColorStop(0, this.rgba(0.75, 0.95));
    grad.addColorStop(0.5, this.rgba(0.15, 0.85));
    grad.addColorStop(1, this.rgba(0, 0.35));
    for (let s = 0; s < 2; s++) {
      for (let i = 0; i < n; i++) {
        const v = a.bands[i];
        if (v < 0.02 && this.peaks[i] < 0.03) continue;
        const h = Math.max(3, Math.pow(v, 1.4) * maxH);
        const idx = s === 0 ? n - 1 - i : n + i;
        const x = 40 + idx * (bw + gap);
        ctx.fillStyle = grad;
        ctx.fillRect(x, base - h, bw, h);
        // reflection
        ctx.fillStyle = this.rgba(0, 0.12);
        ctx.fillRect(x, base + 4, bw, Math.min(26, h * 0.25));
        // peak cap
        if (this.peaks[i] > 0.03) {
          const ph = Math.pow(this.peaks[i], 1.4) * maxH;
          ctx.fillStyle = this.rgba(0.9, 0.9);
          ctx.fillRect(x, base - ph - 6, bw, 3);
        }
      }
    }
  }

  /** Two layered, mirrored waves rising from the bottom. */
  private wave(a: AudioFrame, W: number, H: number, now: number): void {
    const ctx = this.ctx;
    const base = H;
    const layers = [
      { amp: 360, alpha: 0.28, k: 0.0, shift: 0 },
      { amp: 250, alpha: 0.5, k: 0.35, shift: 0.6 },
    ];
    for (const L of layers) {
      const pts: number[] = [];
      const steps = 64;
      for (let j = 0; j <= steps; j++) {
        // mirrored: center = bass
        const f = Math.abs(j / steps - 0.5) * 2; // 0 center .. 1 edges
        const bi = Math.min(BANDS - 1, Math.floor(f * (BANDS - 1)));
        const wob = Math.sin(now / 900 + j * 0.35 + L.shift) * 0.04;
        pts.push(Math.max(0, a.bands[bi] + wob));
      }
      const grad = ctx.createLinearGradient(0, base - L.amp, 0, base);
      grad.addColorStop(0, this.rgba(L.k + 0.3, L.alpha + 0.25));
      grad.addColorStop(1, this.rgba(L.k, L.alpha * 0.3));
      ctx.beginPath();
      ctx.moveTo(0, base);
      const dx = W / steps;
      let px = 0;
      let py = base - pts[0] * L.amp;
      ctx.lineTo(px, py);
      for (let j = 1; j <= steps; j++) {
        const x = j * dx;
        const y = base - Math.pow(pts[j], 1.2) * L.amp;
        ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
        px = x;
        py = y;
      }
      ctx.lineTo(W, py);
      ctx.lineTo(W, base);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = this.rgba(0.8, L.alpha + 0.2);
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  /** Bars radiating around the album art. */
  private ring(a: AudioFrame, W: number, H: number): void {
    const ctx = this.ctx;
    const r = this.artEl.getBoundingClientRect();
    if (!r.width) return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // the art is round in this style (see style.css), so the ring hugs it
    const radius = r.width / 2 + 18 + a.beat * 8;
    const maxLen = Math.min(130, r.width * 0.24);
    const n = BANDS * 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(3, (2 * Math.PI * radius) / n - 4);
    for (let j = 0; j < n; j++) {
      // mirrored around the circle: bass at the top
      const i = j < BANDS ? j : n - 1 - j;
      const v = a.bands[i];
      const len = 6 + Math.pow(v, 1.3) * maxLen;
      const ang = (j / n) * Math.PI * 2 - Math.PI / 2;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      ctx.strokeStyle = this.rgba(0.2 + 0.6 * v, 0.45 + 0.5 * v);
      ctx.beginPath();
      ctx.moveTo(c * radius, s * radius);
      ctx.lineTo(c * (radius + len), s * (radius + len));
      ctx.stroke();
    }
    ctx.restore();
  }
}

// Small visual effects: palette colors for the simple background, and confetti.

// ------------------------------------------------------------------ palette

export function setBackdropColors(colors: string[]): void {
  const root = document.documentElement;
  colors.slice(0, 3).forEach((c, i) => root.style.setProperty(`--blob${i + 1}`, c));
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

/** Sparks bursting out from the middle of the screen (a drop). */
export function sparks(canvas: HTMLCanvasElement, colors: string[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || confettiRunning) return;
  confettiRunning = true;
  const W = canvas.width;
  const H = canvas.height;
  const pts: { x: number; y: number; vx: number; vy: number; life: number; c: string; s: number }[] = [];
  for (let i = 0; i < 220; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 6 + Math.random() * 22;
    pts.push({ x: W / 2, y: H / 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, life: 1, c: colors[i % colors.length], s: 2 + Math.random() * 5 });
  }
  canvas.classList.add("on");
  const step = () => {
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    for (const p of pts) {
      if (p.life <= 0) continue;
      alive++;
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.965;
      p.vy = p.vy * 0.965 + 0.18;
      p.life -= 0.012;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
      ctx.fill();
      // a short trail
      ctx.globalAlpha = Math.max(0, p.life) * 0.4;
      ctx.beginPath();
      ctx.arc(p.x - p.vx * 1.5, p.y - p.vy * 1.5, p.s * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (alive) requestAnimationFrame(step);
    else {
      ctx.clearRect(0, 0, W, H);
      canvas.classList.remove("on");
      confettiRunning = false;
    }
  };
  requestAnimationFrame(step);
}

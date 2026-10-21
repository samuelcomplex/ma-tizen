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

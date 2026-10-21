// The background: the album art, heavily blurred and slowly flowing like liquid, tinted with the
// art's palette and breathing with the music. Drawn by the GPU (WebGL) at a small resolution and
// a capped frame rate; it's so soft that upscaling doesn't show, and the TV's graphics chip is
// weak, so every pixel and every frame counts.

import { AudioFrame } from "./audio";

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Noise comes from a small random texture (one texture read instead of four hashes with sin),
// the album art is a tiny pre-blurred texture (one read each), and the flow field is three
// octaves deep.
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform sampler2D uNoise;
uniform float uFade;      // 0 = A, 1 = B
uniform float uHasArt;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform float uBass;
uniform float uLevel;
uniform float uBeat;

float noise(vec2 p) { return texture2D(uNoise, p * 0.015625).r; }
float fbm(vec2 p) {
  float v = 0.5 * noise(p);
  p = p * 2.03 + vec2(1.7, 9.2);
  v += 0.25 * noise(p);
  p = p * 2.03 + vec2(1.7, 9.2);
  v += 0.125 * noise(p);
  return v * 1.1428;
}
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float t = uTime * 0.045;

  // domain-warped flow field
  vec2 q = vec2(fbm(p * 1.1 + vec2(0.0, t)), fbm(p * 1.1 + vec2(5.2, -t * 0.8)));
  vec2 r = vec2(fbm(p * 1.6 + 2.2 * q + vec2(1.7, 9.2) + t * 0.9), fbm(p * 1.6 + 2.2 * q + vec2(8.3, 2.8) - t * 0.7));

  float zoom = 0.62 - 0.05 * uBass - 0.03 * uBeat;
  vec2 tuv = 0.5 + rot(p, t * 0.6) * zoom + (r - 0.5) * (0.55 + 0.35 * uLevel);

  vec3 pal = mix(mix(uC1, uC2, smoothstep(0.2, 0.8, r.x)), uC3, smoothstep(0.35, 0.9, q.y));
  vec3 col;
  if (uHasArt > 0.5) {
    col = mix(texture2D(uTexA, tuv).rgb, texture2D(uTexB, tuv).rgb, uFade);
    col = mix(col, pal, 0.22);
  } else {
    col = pal * 0.8;
  }

  // light streaks drifting across, brighter with the music
  float glow = smoothstep(0.55, 1.0, fbm(p * 2.4 + r * 1.5 + vec2(t * 1.5, 0.0)));
  col += glow * (0.06 + 0.22 * uLevel + 0.15 * uBeat) * mix(vec3(1.0), uC3, 0.5);

  // saturation boost, then keep it dark enough for white text
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, 1.35);
  col *= 0.62 + 0.18 * uLevel + 0.12 * uBeat;
  float vig = smoothstep(1.25, 0.25, length(p * vec2(0.85, 1.1)));
  col *= mix(0.45, 1.0, vig);
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Quality steps, best first: canvas size and the most frames per second to draw. */
export const GL_LEVELS = [
  { w: 320, h: 180, fps: 24 },
  { w: 256, h: 144, fps: 15 },
  { w: 192, h: 108, fps: 10 },
];

export class GlBackground {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private texA: WebGLTexture;
  private texB: WebGLTexture;
  private noiseTex: WebGLTexture;
  private fade = 1;
  private fadeFrom = 0;
  private hasArt = false;
  private colors: number[][] = [
    [0.23, 0.16, 0.33],
    [0.12, 0.25, 0.35],
    [0.35, 0.16, 0.23],
  ];
  private target: number[][] = this.colors.map((c) => c.slice());
  private u: Record<string, WebGLUniformLocation | null> = {};
  private start = performance.now();
  private lastDraw = -1e9;
  private minInterval = 1000 / GL_LEVELS[0].fps;
  level = 0;
  readonly canvas: HTMLCanvasElement;

  static create(canvas: HTMLCanvasElement, level = 0): GlBackground | null {
    try {
      const gl = (canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false }) ||
        canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
      if (!gl) return null;
      const g = new GlBackground(canvas, gl);
      g.setLevel(level);
      return g;
    } catch (e) {
      console.warn("WebGL background unavailable", e);
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link");
    this.prog = prog;
    gl.useProgram(prog);
    gl.disable(gl.DITHER);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ["uRes", "uTime", "uTexA", "uTexB", "uNoise", "uFade", "uHasArt", "uC1", "uC2", "uC3", "uBass", "uLevel", "uBeat"])
      this.u[n] = gl.getUniformLocation(prog, n);
    this.texA = this.makeArtTex();
    this.texB = this.makeArtTex();
    this.noiseTex = this.makeNoiseTex();
    gl.uniform1i(this.u.uTexA, 0);
    gl.uniform1i(this.u.uTexB, 1);
    gl.uniform1i(this.u.uNoise, 2);
  }

  /** Picks one of GL_LEVELS: a smaller canvas and fewer frames when the TV struggles. */
  setLevel(level: number): void {
    this.level = Math.max(0, Math.min(GL_LEVELS.length - 1, level));
    const L = GL_LEVELS[this.level];
    this.canvas.width = L.w;
    this.canvas.height = L.h;
    this.minInterval = 1000 / L.fps;
    this.lastDraw = -1e9;
  }

  private makeArtTex(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([30, 25, 40, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  private makeNoiseTex(): WebGLTexture {
    const gl = this.gl;
    const N = 64;
    const data = new Uint8Array(N * N * 4);
    // a fixed pseudo-random field, so the flow looks the same on every start
    let s = 1234567;
    for (let i = 0; i < data.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      data[i] = s >>> 24;
    }
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.activeTexture(gl.TEXTURE0);
    return t;
  }

  /** Cross-fades to new artwork (or to palette colors only, with null). */
  setArt(img: HTMLImageElement | null): void {
    const gl = this.gl;
    if (!img) {
      this.hasArt = false;
      return;
    }
    // a tiny copy (32x32, a power of two so it can mirror-wrap): shrinking in two steps is the blur
    const mid = document.createElement("canvas");
    mid.width = mid.height = 128;
    const mctx = mid.getContext("2d")!;
    mctx.drawImage(img, 0, 0, 128, 128);
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(mid, 0, 0, 32, 32);
    // the new art goes into whichever texture is currently hidden
    const showingB = this.fade >= 0.5;
    const tex = showingB ? this.texA : this.texB;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    try {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    } catch (e) {
      // cross-origin art the TV won't let us read: palette only
      console.warn("art texture", e);
      this.hasArt = false;
      return;
    }
    if (!this.hasArt) {
      // first art: show it directly in both slots
      this.hasArt = true;
      this.fade = showingB ? 0 : 1;
      this.fadeFrom = -1;
      return;
    }
    this.fadeFrom = performance.now();
    this.fadeTo = showingB ? 0 : 1;
  }
  private fadeTo = 1;

  setPalette(colors: number[][]): void {
    if (colors.length >= 3) this.target = colors.slice(0, 3).map((c) => c.map((v) => v / 255));
  }

  render(now: number, a: AudioFrame): void {
    // the picture moves slowly, so a handful of frames per second is plenty
    if (now - this.lastDraw < this.minInterval - 2) return;
    this.lastDraw = now;
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    if (this.fadeFrom > 0) {
      const k = Math.min(1, (now - this.fadeFrom) / 2200);
      const e = k * k * (3 - 2 * k);
      this.fade = this.fadeTo === 1 ? e : 1 - e;
      if (k >= 1) this.fadeFrom = 0;
    }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) this.colors[i][j] += (this.target[i][j] - this.colors[i][j]) * 0.04;
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texB);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
    gl.uniform2f(this.u.uRes, w, h);
    gl.uniform1f(this.u.uTime, (now - this.start) / 1000);
    gl.uniform1f(this.u.uFade, this.fade);
    gl.uniform1f(this.u.uHasArt, this.hasArt ? 1 : 0);
    gl.uniform3fv(this.u.uC1, this.colors[0]);
    gl.uniform3fv(this.u.uC2, this.colors[1]);
    gl.uniform3fv(this.u.uC3, this.colors[2]);
    gl.uniform1f(this.u.uBass, a.bass);
    gl.uniform1f(this.u.uLevel, a.level);
    gl.uniform1f(this.u.uBeat, a.beat);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Waits for the GPU to finish what was drawn; for measuring only. */
  finish(): void {
    this.gl.finish();
  }
}

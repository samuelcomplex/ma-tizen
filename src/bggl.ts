// The background: the album art, heavily blurred and slowly flowing like liquid, tinted with the
// art's palette and breathing with the music. Drawn by the GPU (WebGL) at a reduced resolution;
// it's so soft that upscaling doesn't show.

import { AudioFrame } from "./audio";

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform float uFade;      // 0 = A, 1 = B
uniform float uHasArt;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform float uBass;
uniform float uLevel;
uniform float uBeat;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

vec3 art(sampler2D tex, vec2 uv) {
  // a high mip level is a cheap, very smooth blur
  vec3 c = texture2D(tex, uv, 4.5).rgb * 0.55 + texture2D(tex, uv * 0.97 + 0.015, 6.0).rgb * 0.45;
  return c;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float t = uTime * 0.045;

  // domain-warped flow field
  vec2 q = vec2(fbm(p * 1.1 + vec2(0.0, t)), fbm(p * 1.1 + vec2(5.2, -t * 0.8)));
  vec2 r = vec2(fbm(p * 1.6 + 2.2 * q + vec2(1.7, 9.2) + t * 0.9), fbm(p * 1.6 + 2.2 * q + vec2(8.3, 2.8) - t * 0.7));

  float zoom = 0.62 - 0.05 * uBass - 0.03 * uBeat;
  vec2 tuv = 0.5 + rot(p, t * 0.6) * zoom + (r - 0.5) * (0.55 + 0.35 * uLevel);

  vec3 col;
  vec3 pal = mix(mix(uC1, uC2, smoothstep(0.2, 0.8, r.x)), uC3, smoothstep(0.35, 0.9, q.y));
  if (uHasArt > 0.5) {
    vec3 a = art(uTexA, tuv);
    vec3 b = art(uTexB, tuv);
    col = mix(a, b, uFade);
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
  // gentle dithering against banding on big gradients
  col += (hash(gl_FragCoord.xy + uTime) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

export class GlBackground {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private texA: WebGLTexture;
  private texB: WebGLTexture;
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
  readonly canvas: HTMLCanvasElement;

  static create(canvas: HTMLCanvasElement): GlBackground | null {
    try {
      const gl = (canvas.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: false }) ||
        canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
      if (!gl) return null;
      return new GlBackground(canvas, gl);
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
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ["uRes", "uTime", "uTexA", "uTexB", "uFade", "uHasArt", "uC1", "uC2", "uC3", "uBass", "uLevel", "uBeat"])
      this.u[n] = gl.getUniformLocation(prog, n);
    this.texA = this.makeTex();
    this.texB = this.makeTex();
    gl.uniform1i(this.u.uTexA, 0);
    gl.uniform1i(this.u.uTexB, 1);
  }

  private makeTex(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([30, 25, 40, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  /** Cross-fades to new artwork (or to palette colors only, with null). */
  setArt(img: HTMLImageElement | null): void {
    const gl = this.gl;
    if (!img) {
      this.hasArt = false;
      return;
    }
    // power-of-two copy so WebGL 1 can build mipmaps (the blur)
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, 512, 512);
    // the new art goes into whichever texture is currently hidden
    const showingB = this.fade >= 0.5;
    const tex = showingB ? this.texA : this.texB;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    try {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.generateMipmap(gl.TEXTURE_2D);
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
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) this.colors[i][j] += (this.target[i][j] - this.colors[i][j]) * 0.02;
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texB);
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
}

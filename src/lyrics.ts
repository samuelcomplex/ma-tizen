// Synced (LRC) lyrics: parsing, word timing and finding the current line.

export interface LyricWord {
  t: number; // seconds
  text: string;
}

export interface LyricLine {
  t: number; // seconds
  text: string;
  words?: LyricWord[]; // enhanced LRC <mm:ss.xx> word timing, when present
  gap?: boolean; // an instrumental break
}

const TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

function secs(m: string, s: string, frac?: string): number {
  return parseInt(m, 10) * 60 + parseInt(s, 10) + (frac ? parseInt(frac, 10) / Math.pow(10, frac.length) : 0);
}

/** Breaks longer than this (seconds) between two sung lines get a "• • •" line of their own. */
const GAP_MIN = 9;

export function parseLrc(lrc: string | null | undefined): LyricLine[] {
  if (!lrc) return [];
  let offset = 0;
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const off = /^\[offset:\s*([+-]?\d+)\s*\]/i.exec(raw);
    if (off) {
      offset = parseInt(off[1], 10) / 1000;
      continue;
    }
    const times: number[] = [];
    let m: RegExpExecArray | null;
    TIME.lastIndex = 0;
    let last = 0;
    while ((m = TIME.exec(raw))) {
      if (m.index !== last) break; // only leading time tags
      times.push(secs(m[1], m[2], m[3]));
      last = TIME.lastIndex;
    }
    if (!times.length) continue;
    const body = raw.slice(last);
    // enhanced LRC: "<00:12.10>Some <00:12.60>words"
    const words: LyricWord[] = [];
    WORD.lastIndex = 0;
    let wm: RegExpExecArray | null;
    const marks: { t: number; at: number; end: number }[] = [];
    while ((wm = WORD.exec(body))) marks.push({ t: secs(wm[1], wm[2], wm[3]), at: wm.index, end: WORD.lastIndex });
    for (let i = 0; i < marks.length; i++) {
      const text = body.slice(marks[i].end, i + 1 < marks.length ? marks[i + 1].at : body.length);
      if (text.trim()) words.push({ t: marks[i].t - offset, text });
    }
    const text = body.replace(WORD, "").replace(/\s+/g, " ").trim();
    for (const t of times) {
      const line: LyricLine = { t: Math.max(0, t - offset), text };
      if (words.length) line.words = words;
      if (!text) line.gap = true;
      lines.push(line);
    }
  }
  lines.sort((a, b) => a.t - b.t);
  // add a breather line for long instrumental breaks that the file doesn't mark itself
  const out: LyricLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    const next = lines[i + 1];
    if (next && lines[i].text && next.text && next.t - lines[i].t > GAP_MIN) {
      out.push({ t: lines[i].t + Math.min(5, (next.t - lines[i].t) / 3), text: "", gap: true });
    }
  }
  return out;
}

/** Index of the line being sung at `pos` seconds, or -1 before the first line. */
export function currentLine(lines: LyricLine[], pos: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= pos) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** 0..1: how far through line `i` the song is at `pos` (until the next line starts). */
export function lineProgress(lines: LyricLine[], i: number, pos: number, songEnd: number): number {
  if (i < 0 || i >= lines.length) return 0;
  const start = lines[i].t;
  const end = i + 1 < lines.length ? lines[i + 1].t : Math.max(start + 4, songEnd);
  // a line is usually sung in its first part; fill over at most 85% of the time to the next line
  const span = Math.max(0.6, Math.min(end - start, 8) * 0.85);
  return Math.max(0, Math.min(1, (pos - start) / span));
}

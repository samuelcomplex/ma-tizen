// Synced (LRC) lyrics: parsing and finding the current line.

export interface LyricLine {
  t: number; // seconds
  text: string;
}

const TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

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
      const frac = m[3] ? parseInt(m[3], 10) / Math.pow(10, m[3].length) : 0;
      times.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac);
      last = TIME.lastIndex;
    }
    if (!times.length) continue;
    // drop enhanced-LRC word timing tags like <00:12.34>
    const text = raw.slice(last).replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, "").trim();
    for (const t of times) lines.push({ t: Math.max(0, t - offset), text });
  }
  lines.sort((a, b) => a.t - b.t);
  return lines;
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

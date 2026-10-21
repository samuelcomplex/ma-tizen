// A small on-TV log, so "the sound stops after a few seconds" can be diagnosed from the couch:
// Menu > Settings > Speaker status shows the audio engine's state and the latest events.

const started = Date.now();
const lines: string[] = [];

const two = (n: number) => (n < 10 ? "0" : "") + n;

export function diagLog(msg: string): void {
  const s = Math.floor((Date.now() - started) / 1000);
  lines.push(two(Math.floor(s / 60)) + ":" + two(s % 60) + "  " + msg);
  if (lines.length > 60) lines.shift();
}

export function diagLines(): string[] {
  return lines;
}

/** Keeps the speaker library's own messages (and any warnings or errors) in the log. */
export function hookConsole(): void {
  const c: any = console;
  const wrap = (level: string) => {
    const orig = c[level];
    if (!orig) return;
    c[level] = function (...args: any[]) {
      try {
        const first = typeof args[0] === "string" ? args[0] : "";
        if (first.indexOf("Sendspin") >= 0 || level !== "log") {
          const text = args.map((a) => (typeof a === "string" ? a : a && a.message ? a.message : String(a))).join(" ");
          let t = text.replace(/^Sendspin:\s*/, "");
          const m = /^sync=(\S+) corr=(\S+) q=\d+\/([\d.]+)s resyncs=(\d+).*ctx=(\S+)/.exec(t);
          if (m) t = "sync " + m[1] + " · " + m[2] + " · " + m[3] + " s buffered · " + m[4] + " resyncs · " + m[5];
          diagLog((level === "log" ? "" : level + ": ") + t.slice(0, 110));
        }
      } catch {
        /* the log must never break anything */
      }
      return orig.apply(this, args);
    };
  };
  wrap("log");
  wrap("warn");
  wrap("error");
}

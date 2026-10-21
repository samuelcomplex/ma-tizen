// WLED light sync: the lights take the album art's color, follow the music's level and flash
// on the beat. Uses WLED's websocket JSON API (TV apps can't send the UDP packets WLED's own
// audio sync uses), so it works with any WLED build, no Sound Reactive firmware needed.

import { AudioFrame } from "./audio";

interface Light {
  host: string;
  ws: WebSocket | null;
  ready: boolean;
  saved: any; // the state before we took over, restored when sync stops
  retryAt: number;
  name: string;
}

export class WledSync {
  private lights: Light[] = [];
  private lastSend = 0;
  private lastBri = -1;
  private lastCol = "";
  private flash = 0;
  enabled = false;

  setHosts(hosts: string[]): void {
    const keep = this.lights.filter((l) => hosts.includes(l.host));
    for (const l of this.lights) if (!hosts.includes(l.host)) this.close(l, true);
    for (const h of hosts) if (!keep.some((l) => l.host === h)) keep.push({ host: h, ws: null, ready: false, saved: null, retryAt: 0, name: h });
    this.lights = keep;
  }

  status(): string {
    if (!this.lights.length) return "No lights added";
    const on = this.lights.filter((l) => l.ready).length;
    return `${on} of ${this.lights.length} connected`;
  }

  names(): string[] {
    return this.lights.map((l) => (l.ready ? l.name : l.host + " (not connected)"));
  }

  stop(): void {
    this.enabled = false;
    for (const l of this.lights) this.close(l, true);
  }

  private open(l: Light): void {
    l.retryAt = performance.now() + 5000;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://${l.host}/ws`);
    } catch {
      return;
    }
    l.ws = ws;
    ws.onmessage = (ev) => {
      // WLED answers a new connection with its full state
      try {
        const m = JSON.parse(ev.data);
        if (!l.ready && m.state) {
          l.saved = m.state;
          l.name = (m.info && m.info.name) || l.host;
          l.ready = true;
          // solid effect so our color shows; keep the user's segments as they are
          ws.send(JSON.stringify({ on: true, tt: 0, seg: { fx: 0 } }));
          this.lastBri = -1;
          this.lastCol = "";
        }
      } catch {
        /* binary live data etc. */
      }
    };
    ws.onclose = () => {
      if (l.ws === ws) {
        l.ws = null;
        l.ready = false;
      }
    };
    ws.onerror = () => ws.close();
  }

  private close(l: Light, restore: boolean): void {
    if (l.ws) {
      try {
        if (restore && l.ready && l.saved) {
          const s = l.saved;
          l.ws.send(JSON.stringify({ on: s.on, bri: s.bri, transition: 7, seg: s.seg }));
        }
      } catch {
        /* ignore */
      }
      const ws = l.ws;
      setTimeout(() => ws.close(), 300);
    }
    l.ws = null;
    l.ready = false;
  }

  /** Called every animation frame; sends at most ~20 updates a second. */
  update(a: AudioFrame, rgb: number[], strength: number, now: number): void {
    if (!this.enabled) return;
    for (const l of this.lights) if (!l.ws && now > l.retryAt) this.open(l);
    if (a.beat > 0.99) this.flash = 1;
    else this.flash *= 0.85;
    if (now - this.lastSend < 50) return;
    const base = a.active ? 40 + 140 * Math.min(1, a.level * 1.6) : 35;
    const bri = Math.round(Math.min(255, (base + 75 * this.flash) * strength));
    // on a beat, push the color toward white for a moment
    const w = 0.35 * this.flash;
    const col = rgb.map((v) => Math.round(v + (255 - v) * w));
    const colKey = col.join(",");
    if (Math.abs(bri - this.lastBri) < 4 && colKey === this.lastCol) return;
    this.lastSend = now;
    this.lastBri = bri;
    this.lastCol = colKey;
    const msg = JSON.stringify({ bri, tt: 0, seg: { col: [col] } });
    for (const l of this.lights) if (l.ready && l.ws && l.ws.bufferedAmount < 2048) l.ws.send(msg);
  }
}

/** Looks for WLED on the TV's subnet (WLED answers a websocket with its info). */
export async function findWled(base: string | null, onFound: (host: string, name: string) => void): Promise<void> {
  if (!base) return;
  const prefix = base.split(".").slice(0, 3).join(".");
  const hosts: string[] = [];
  for (let i = 1; i < 255; i++) hosts.push(`${prefix}.${i}`);
  hosts.push("wled.local");
  let next = 0;
  const worker = async () => {
    while (next < hosts.length) {
      const h = hosts[next++];
      await new Promise<void>((resolve) => {
        let ws: WebSocket;
        try {
          ws = new WebSocket(`ws://${h}/ws`);
        } catch {
          resolve();
          return;
        }
        const t = setTimeout(() => {
          ws.close();
          resolve();
        }, 1500);
        ws.onmessage = (ev) => {
          try {
            const m = JSON.parse(ev.data);
            if (m.info && (m.info.brand === "WLED" || m.info.ver)) onFound(h, m.info.name || h);
          } catch {
            /* not WLED */
          }
          clearTimeout(t);
          ws.close();
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(t);
          resolve();
        };
      });
    }
  };
  await Promise.all(Array.from({ length: 24 }, worker));
}

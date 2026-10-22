// LedFx control. LedFx does the audio analysis and the light effects itself: it joins Music
// Assistant as a Sendspin player (so it hears every speaker, not just the TV) and drives WLED and
// other lights. The TV's job is to tell it what is going on at the party by switching LedFx scenes:
// music playing, a drop, a dance-off, a quiz, nothing playing.
//
// LedFx REST API: GET /api/info, GET /api/scenes, PUT /api/scenes {id, action: "activate"}.

export interface LedFxScene {
  id: string;
  name: string;
}

/** What is going on, from least to most special. */
export type LedFxMoment = "idle" | "base" | "drop" | "dance" | "quiz";

export interface LedFxScenes {
  base: string; // music is playing
  drop: string;
  dance: string;
  quiz: string;
  idle: string; // nothing is playing
}

export const DEFAULT_PORT = 8888;

/** "192.168.1.30", "http://ledfx.local:8888/" → "192.168.1.30:8888", "ledfx.local:8888". */
export function normalizeHost(h: string): string {
  let s = (h || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (s && !/:\d+$/.test(s)) s += ":" + DEFAULT_PORT;
  return s;
}

interface Reply {
  status: number;
  json: any;
}

function request(host: string, method: string, path: string, body?: any, timeoutMs = 4000): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, "http://" + host + path, true);
    xhr.timeout = timeoutMs;
    if (body !== undefined) xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onload = () => {
      let json: any = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      resolve({ status: xhr.status, json });
    };
    xhr.onerror = () => reject(new Error("no answer"));
    xhr.ontimeout = () => reject(new Error("timed out"));
    xhr.send(body !== undefined ? JSON.stringify(body) : null);
  });
}

/** The reason LedFx gives for a refusal, for showing on the TV. */
function reasonOf(r: Reply): string {
  const p = r.json && r.json.payload;
  if (p && p.reason) return String(p.reason);
  return "LedFx answered " + r.status;
}

export class LedFx {
  host = "";
  enabled = false;
  connected = false;
  version = "";
  scenes: LedFxScene[] = [];
  lastError = "";
  private active = ""; // the scene we switched on last
  private retryAt = 0;
  private busy = false;

  setHost(h: string): void {
    const n = normalizeHost(h);
    if (n !== this.host) {
      this.host = n;
      this.connected = false;
      this.active = "";
      this.scenes = [];
    }
  }

  /** Reads the version and the scene list; fills `connected` and `lastError`. */
  async refresh(): Promise<void> {
    if (!this.host) {
      this.connected = false;
      this.lastError = "No address set";
      return;
    }
    try {
      const info = await request(this.host, "GET", "/api/info");
      if (info.status !== 200 || !info.json) {
        this.connected = false;
        this.lastError = info.status === 403 ? reasonOf(info) : "That is not LedFx (" + info.status + ")";
        return;
      }
      this.version = String(info.json.version || "");
      const sc = await request(this.host, "GET", "/api/scenes");
      if (sc.status !== 200 || !sc.json || !sc.json.scenes) {
        this.connected = false;
        this.lastError = reasonOf(sc);
        return;
      }
      const list: LedFxScene[] = [];
      for (const id of Object.keys(sc.json.scenes)) {
        const s = sc.json.scenes[id];
        list.push({ id, name: (s && s.name) || id });
        if (s && s.active) this.active = id;
      }
      list.sort((a, b) => a.name.localeCompare(b.name));
      this.scenes = list;
      this.connected = true;
      this.lastError = "";
    } catch (e: any) {
      this.connected = false;
      this.lastError = "Can't reach LedFx at " + this.host + ". Check the address; if it's right, add the TV (" + (location.origin || "file://") + ") to allowed_origins in LedFx's config.";
    }
  }

  /** Keeps the party's own scene changes away for a while (while someone tries a scene out). */
  hold(ms: number): void {
    this.retryAt = performance.now() + ms;
  }

  /** Switches a scene on. Returns an error text, or "" when it worked. */
  async activate(id: string): Promise<string> {
    try {
      const r = await request(this.host, "PUT", "/api/scenes", { id, action: "activate" });
      if (r.status === 200) {
        this.active = id;
        this.connected = true;
        this.lastError = "";
        return "";
      }
      this.lastError = r.status === 403 ? reasonOf(r) + " (the TV is “" + (location.origin || "file://") + "”)" : reasonOf(r);
    } catch {
      this.connected = false;
      this.lastError = "Can't reach LedFx at " + this.host;
    }
    return this.lastError;
  }

  /**
   * Called a few times a second with what is going on. The most special thing wins: a quiz, then a
   * dance-off, then a drop; otherwise the scene for "music playing" or "nothing playing". A moment
   * without a scene of its own leaves the lights on whatever the baseline scene is.
   */
  update(m: { playing: boolean; quiz: boolean; dance: boolean; drop: boolean }, scenes: LedFxScenes, now: number): void {
    if (!this.enabled || !this.host || this.busy || now < this.retryAt) return;
    const base = m.playing ? scenes.base : scenes.idle;
    const want = (m.quiz && scenes.quiz) || (m.dance && scenes.dance) || (m.drop && scenes.drop) || base;
    if (!want || want === this.active) return;
    this.busy = true;
    this.activate(want).then((err) => {
      this.busy = false;
      // when it fails, wait a while before trying again
      this.retryAt = performance.now() + (err ? 10000 : 400);
    });
  }
}

/** Looks for LedFx on the TV's subnet (and on the Music Assistant machine first). */
export async function findLedFx(base: string | null, maHost: string, onFound: (host: string, version: string) => void): Promise<void> {
  const hosts: string[] = [];
  if (maHost) hosts.push(maHost.replace(/^https?:\/\//, "").replace(/:\d+$/, ""));
  if (base) {
    const prefix = base.split(".").slice(0, 3).join(".");
    for (let i = 1; i < 255; i++) hosts.push(prefix + "." + i);
  }
  hosts.push("ledfx.local");
  const seen: Record<string, boolean> = {};
  const list = hosts.filter((h) => (seen[h] ? false : (seen[h] = true)));
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const h = list[next++];
      try {
        const r = await request(h + ":" + DEFAULT_PORT, "GET", "/api/info", undefined, 1500);
        if (r.status === 200 && r.json && /ledfx/i.test(String(r.json.name || "")) && r.json.version) onFound(h + ":" + DEFAULT_PORT, String(r.json.version));
      } catch {
        /* nothing there */
      }
    }
  };
  await Promise.all(Array.from({ length: 24 }, worker));
}

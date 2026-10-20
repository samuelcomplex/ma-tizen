// Music Assistant websocket API client: commands with promises, events, auth, reconnect.

export interface ServerInfo {
  server_id: string;
  server_version: string;
  schema_version: number;
  name?: string;
  base_url?: string;
  internal_url?: string;
  onboard_done?: boolean;
}

export interface MAEvent {
  event: string;
  object_id?: string;
  data?: any;
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; partial?: any[]; timer: any };

export class ApiError extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

/** Normalizes what a person types ("192.168.1.20", "ma.lan:8095", "http://x:8095/") to http://host:port. */
export function normalizeServer(input: string): string {
  let s = input.trim();
  if (!s) return "";
  if (!/^[a-z]+:\/\//i.test(s)) s = "http://" + s;
  s = s.replace(/^ws/i, "http");
  const m = /^(https?):\/\/([^/]+)/i.exec(s);
  if (!m) return "";
  let host = m[2];
  if (!/:\d+$/.test(host) && !/^\[.*\]$/.test(host)) host += ":8095";
  return m[1].toLowerCase() + "://" + host;
}

export class MAClient {
  readonly baseUrl: string;
  token: string | null;
  info: ServerInfo | null = null;
  authenticated = false;
  user: any = null;

  onEvent: (e: MAEvent) => void = () => {};
  onStatus: (status: "connecting" | "ready" | "auth_failed" | "disconnected") => void = () => {};

  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<string, Pending>();
  private closedByUs = false;
  private retryMs = 1000;
  private retryTimer: any = null;

  constructor(baseUrl: string, token: string | null) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN && !!this.info;
  }

  start(): void {
    this.closedByUs = false;
    this.open();
  }

  stop(): void {
    this.closedByUs = true;
    clearTimeout(this.retryTimer);
    if (this.ws) this.ws.close();
    this.ws = null;
  }

  private open(): void {
    this.onStatus("connecting");
    const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/ws";
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.info = null;
    this.authenticated = false;
    ws.onmessage = (ev) => this.handle(ev.data);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.info = null;
      this.authenticated = false;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("disconnected"));
      }
      this.pending.clear();
      this.onStatus("disconnected");
      if (!this.closedByUs) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.open(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 15000);
  }

  private async handle(raw: any): Promise<void> {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!this.info && msg.server_id) {
      this.info = msg as ServerInfo;
      this.retryMs = 1000;
      if (this.token) {
        try {
          const res = await this.send("auth", { token: this.token, device_name: "Samsung TV" });
          this.authenticated = !!(res && res.authenticated);
          this.user = res && res.user;
        } catch (e) {
          this.authenticated = false;
          this.onStatus("auth_failed");
          return;
        }
        this.onStatus(this.authenticated ? "ready" : "auth_failed");
      } else {
        this.onStatus("auth_failed");
      }
      return;
    }
    if (msg.event) {
      try {
        this.onEvent(msg as MAEvent);
      } catch (e) {
        console.error("event handler", e);
      }
      return;
    }
    if (msg.message_id === undefined) return;
    const p = this.pending.get(String(msg.message_id));
    if (!p) return;
    if (msg.error_code !== undefined) {
      this.pending.delete(String(msg.message_id));
      clearTimeout(p.timer);
      p.reject(new ApiError(msg.details || "error " + msg.error_code, msg.error_code));
      return;
    }
    if (msg.partial) {
      p.partial = (p.partial || []).concat(msg.result || []);
      return;
    }
    this.pending.delete(String(msg.message_id));
    clearTimeout(p.timer);
    p.resolve(p.partial ? p.partial.concat(msg.result || []) : msg.result);
  }

  /** Sends a command and resolves with its result. Works before auth for unauthenticated commands. */
  send<T = any>(command: string, args?: Record<string, any>, timeoutMs = 20000): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("not connected"));
    const id = String(this.nextId++);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("timeout: " + command));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ message_id: id, command, args: args || {} }));
    });
  }

  /** Builds a URL for an image (MediaItemImage) through Music Assistant's image proxy. */
  imageUrl(image: any, size = 512): string | null {
    if (!image) return null;
    if (image.proxy_id) return `${this.baseUrl}/imageproxy/${encodeURIComponent(image.proxy_id)}?size=${size}&fmt=jpeg`;
    if (image.remotely_accessible && /^https?:/.test(image.path)) return image.path;
    if (image.path && image.provider) {
      const path = encodeURIComponent(encodeURIComponent(image.path));
      return `${this.baseUrl}/imageproxy?path=${path}&provider=${encodeURIComponent(image.provider)}&size=${size}`;
    }
    return null;
  }
}

/** Logs in with a username and password; resolves with an access token. */
export function login(baseUrl: string, username: string, password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = new MAClient(baseUrl, null);
    let done = false;
    const finish = (err: Error | null, token?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      c.stop();
      if (err) reject(err);
      else resolve(token!);
    };
    const timer = setTimeout(() => finish(new Error("Music Assistant didn't answer")), 15000);
    c.onStatus = async (s) => {
      if (s === "auth_failed" && c.info) {
        try {
          const res = await c.send("auth/login", {
            username,
            password,
            provider_id: "builtin",
            device_name: "Samsung TV",
          });
          if (res && res.success && res.access_token) finish(null, res.access_token);
          else finish(new Error((res && res.error) || "Wrong username or password"));
        } catch (e: any) {
          finish(e instanceof Error ? e : new Error(String(e)));
        }
      } else if (s === "disconnected") {
        finish(new Error("Couldn't reach Music Assistant at " + baseUrl));
      }
    };
    c.start();
  });
}

/** Opens a websocket to host:port/ws and resolves with its server info, or null. */
export function probe(baseUrl: string, timeoutMs = 2000): Promise<ServerInfo | null> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(baseUrl.replace(/^http/, "ws") + "/ws");
    } catch {
      resolve(null);
      return;
    }
    const t = setTimeout(() => {
      ws.close();
      resolve(null);
    }, timeoutMs);
    ws.onmessage = (ev) => {
      clearTimeout(t);
      try {
        const m = JSON.parse(ev.data);
        resolve(m && m.server_id ? m : null);
      } catch {
        resolve(null);
      }
      ws.close();
    };
    ws.onerror = () => {
      clearTimeout(t);
      resolve(null);
    };
  });
}

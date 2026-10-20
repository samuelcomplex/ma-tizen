// The TV as a Music Assistant speaker, through the Sendspin protocol (sendspin-js).

import { SendspinPlayer } from "@sendspin/sendspin-js";
import { settings, saveSettings } from "./settings";

export class Speaker {
  player: SendspinPlayer | null = null;
  serverHost = "";
  onChange: () => void = () => {};
  lastError = "";

  get clientId(): string | null {
    try {
      return this.player ? this.player.clientId : null;
    } catch {
      return null;
    }
  }

  get connected(): boolean {
    return !!this.player && this.player.isConnected;
  }

  get playing(): boolean {
    return !!this.player && this.player.isPlaying;
  }

  /** Starts (or restarts) the speaker for the Music Assistant host in `baseUrl`. */
  async start(baseUrl: string): Promise<void> {
    this.stop();
    if (!settings.speakerEnabled) return;
    const host = baseUrl.replace(/^https?:\/\//, "").replace(/:\d+$/, "");
    this.serverHost = host;
    const p = new SendspinPlayer({
      baseUrl: `http://${host}:${settings.sendspinPort}`,
      clientName: settings.speakerName || "Samsung TV",
      productName: "Samsung TV (Music Assistant TV app)",
      // PCM first: no decoding work for the TV, and plenty of headroom on a home network
      codecs: ["pcm", "flac", "opus"],
      correctionMode: "sync",
      syncDelay: settings.syncDelayMs,
      onStateChange: () => this.onChange(),
      onDelayCommand: (ms: number) => {
        settings.syncDelayMs = ms;
        saveSettings();
        this.onChange();
      },
    } as any);
    this.player = p;
    try {
      await p.connect();
      this.lastError = "";
    } catch (e: any) {
      this.lastError = String((e && e.message) || e);
    }
    this.onChange();
  }

  stop(): void {
    if (this.player) {
      try {
        // "restart": Music Assistant keeps the TV in its group and puts it straight back in
        // when it reconnects (e.g. after the app was closed and opened again).
        this.player.disconnect("restart");
      } catch {
        /* ignore */
      }
    }
    this.player = null;
  }

  /** Audio needs a user gesture on some platforms; called on every key press until it works. */
  unlock(): void {
    if (!this.player) return;
    try {
      const r: any = (this.player as any).unlock();
      if (r && r.catch) r.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  setSyncDelay(ms: number): void {
    settings.syncDelayMs = Math.max(0, Math.min(5000, Math.round(ms)));
    saveSettings();
    if (this.player) this.player.setSyncDelay(settings.syncDelayMs);
  }

  info(): string {
    if (!this.player) return "off";
    const t: any = (this.player as any).timeSyncInfo;
    const parts = [this.player.isConnected ? "connected" : "connecting"];
    if (this.player.isPlaying) parts.push("playing");
    if (t && typeof t === "object" && t.synced !== undefined) parts.push(t.synced ? "clock synced" : "syncing clock");
    return parts.join(", ");
  }
}

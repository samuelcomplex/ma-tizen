// Party extras: small corner pop-ups (scan to add a song, party stats) and the up-next
// countdown at the end of a song. Pop-ups stay in a corner: on a big TV a small card is
// still easy to read, and the music stays the main thing on screen.

import qrcode from "qrcode-generator";
import { settings } from "./settings";

export interface ExtrasHost {
  queue(): any | null;
  upcoming(): any[];
  position(): number;
  duration(): number;
  partyUrl(): string | null;
  partyConfig(): any;
  view(): "now" | "party";
  imageUrl(item: any, size: number): string | null;
  title(item: any): string;
  artists(item: any): string;
}

interface Stats {
  startedAt: number;
  played: number;
  guest: number;
  boosted: number;
  artists: Record<string, number>;
  lastTitle: string;
}

const STATS_KEY = "ma-tv-party-stats";
const esc = (s: any) =>
  String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function freshStats(): Stats {
  return { startedAt: Date.now(), played: 0, guest: 0, boosted: 0, artists: {}, lastTitle: "" };
}

export class Extras {
  stats: Stats;
  private popEl: HTMLElement;
  private upEl: HTMLElement;
  private popUntil = 0;
  private nextPopAt = Date.now() + 3 * 60 * 1000;
  private popKind = "";
  private upShownFor = "";
  private qrFor = "";
  private qrSvg = "";

  constructor(private host: ExtrasHost, pop: HTMLElement, upnext: HTMLElement) {
    this.popEl = pop;
    this.upEl = upnext;
    let s: Stats | null = null;
    try {
      s = JSON.parse(localStorage.getItem(STATS_KEY) || "null");
    } catch {
      s = null;
    }
    // a party is one evening: start over after a long break
    this.stats = s && Date.now() - s.startedAt < 16 * 3600 * 1000 ? s : freshStats();
  }

  resetStats(): void {
    this.stats = freshStats();
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(this.stats));
    } catch {
      /* ignore */
    }
  }

  /** Called when a new song starts playing. */
  onTrackStart(item: any): void {
    if (!item) return;
    const ex = item.extra_attributes || {};
    this.stats.played++;
    if (ex.party_guest || ex.party_boosted) this.stats.guest++;
    if (ex.party_boosted) this.stats.boosted++;
    const a = this.host.artists(item);
    if (a) this.stats.artists[a] = (this.stats.artists[a] || 0) + 1;
    this.stats.lastTitle = this.host.title(item);
    this.save();
  }

  tick(now: number): void {
    const counting = this.upNext(now);
    if (counting) {
      this.hidePop();
      return;
    }
    if (this.popUntil && now > this.popUntil) this.hidePop();
    const url = this.host.partyUrl();
    // a nearly empty queue: keep the scan card up until someone adds songs
    const low = !!url && settings.scanPopups && this.host.view() !== "party" && !!this.host.queue() && this.host.upcoming().length <= 1;
    if (low) {
      if (this.popKind !== "scan") this.showScan("The queue is almost empty", 0);
      return;
    }
    if (this.popKind === "scan" && !this.popUntil) this.hidePop();
    if (this.popKind || now < this.nextPopAt) return;
    const choices: string[] = [];
    if (settings.scanPopups && url && this.host.view() !== "party") choices.push("scan");
    if (settings.statsPopups && this.stats.played >= 3) choices.push("stats");
    this.nextPopAt = now + (6 + Math.random() * 7) * 60 * 1000;
    if (!choices.length) return;
    const pick = choices[Math.floor(Math.random() * choices.length)];
    if (pick === "scan") this.showScan("Add a song!", 22000);
    else this.showStats(18000);
  }

  private qr(url: string): string {
    if (url === this.qrFor) return this.qrSvg;
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    this.qrFor = url;
    this.qrSvg = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true } as any);
    return this.qrSvg;
  }

  showScan(title: string, ms: number): void {
    const url = this.host.partyUrl();
    if (!url) return;
    const c = this.host.partyConfig() || {};
    this.popEl.className = "pop scan on";
    this.popEl.innerHTML = `<div class="pop-qr">${this.qr(url)}</div><div class="pop-txt"><b>${esc(title)}</b>${esc(
      c.qr_text || "Scan with your phone camera to pick the next songs",
    )}</div>`;
    this.popKind = "scan";
    this.popUntil = ms ? Date.now() + ms : 0;
  }

  showStats(ms: number): void {
    const s = this.stats;
    const mins = Math.max(1, Math.round((Date.now() - s.startedAt) / 60000));
    const dur = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
    const top = Object.entries(s.artists).sort((a, b) => b[1] - a[1])[0];
    const rows = [
      [String(s.played), s.played === 1 ? "song played" : "songs played"],
      [String(s.guest), s.guest === 1 ? "guest request" : "guest requests"],
    ];
    if (s.boosted) rows.push([String(s.boosted), "boosted"]);
    this.popEl.className = "pop stats on";
    this.popEl.innerHTML = `<div class="pop-head">Tonight so far</div><div class="stat-row">${rows
      .map(([n, l]) => `<div class="stat"><b>${esc(n)}</b>${esc(l)}</div>`)
      .join("")}</div>${top && top[1] > 1 ? `<div class="pop-line">Most played: <b>${esc(top[0])}</b> (${top[1]})</div>` : ""}<div class="pop-line">Partying for ${esc(dur)}</div>`;
    this.popKind = "stats";
    this.popUntil = Date.now() + ms;
  }

  private hidePop(): void {
    if (!this.popKind) return;
    this.popEl.classList.remove("on");
    this.popKind = "";
    this.popUntil = 0;
  }

  /** The last seconds of a song: what's next, with a countdown. Returns true while showing. */
  private upNext(now: number): boolean {
    const q = this.host.queue();
    const next = this.host.upcoming()[0];
    const dur = this.host.duration();
    const pos = this.host.position();
    const left = dur - pos;
    const show = settings.upNextCountdown && !!q && q.state === "playing" && !!next && dur > 30 && left > 0 && left <= 15;
    if (!show) {
      if (this.upShownFor) {
        this.upEl.classList.remove("on");
        this.upShownFor = "";
      }
      return false;
    }
    const id = next.queue_item_id || this.host.title(next);
    if (this.upShownFor !== id) {
      this.upShownFor = id;
      const ex = next.extra_attributes || {};
      const c = this.host.partyConfig() || {};
      const badge = ex.party_boosted
        ? `<span class="badge" style="background:${esc(c.boost_badge_color || "#f0c330")}">Boosted by a guest</span>`
        : ex.party_guest
          ? `<span class="badge" style="background:${esc(c.request_badge_color || "#3fb35a")}">Requested by a guest</span>`
          : "";
      const img = this.host.imageUrl(next, 256);
      this.upEl.innerHTML = `<div class="up-ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44"/><circle class="arc" cx="50" cy="50" r="44"/></svg><span class="up-n"></span></div>
        ${img ? `<img src="${esc(img)}">` : '<div class="noimg"></div>'}
        <div class="up-txt"><div class="up-label">Up next</div><div class="up-t">${esc(this.host.title(next))}</div><div class="up-a">${esc(
          this.host.artists(next),
        )}</div>${badge}</div>`;
      this.upEl.classList.add("on");
    }
    const n = this.upEl.querySelector(".up-n");
    if (n) n.textContent = String(Math.ceil(left));
    const arc = this.upEl.querySelector(".arc") as SVGCircleElement | null;
    if (arc) arc.style.strokeDashoffset = String(276.5 * (1 - left / 15));
    return true;
  }
}

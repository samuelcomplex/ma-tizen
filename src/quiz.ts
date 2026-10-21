// Music quiz, hosted from the TV with Music Assistant's Music Quiz plugin.
//
// Guests join on their phones (they pick their own name) and answer there; the TV shows the
// lobby, the rounds, the answers and the scores, and runs the game with the remote. The quiz
// plays its rounds on the party player and replaces that player's queue, so the TV saves the
// queue first and puts the party music back when the quiz is over.

import qrcode from "qrcode-generator";

export interface QuizHost {
  send(command: string, args?: Record<string, any>, timeoutMs?: number): Promise<any>;
  queueId(): string | null;
  position(): number;
  serverNow(): number; // seconds, server wall clock
  imageUrl(url: string | null): string | null;
  toast(text: string): void;
  onActive(active: boolean): void; // the TV switches to the quiz screen while true
  celebrate(): void;
}

interface Snapshot {
  queueId: string;
  uris: string[];
  index: number;
  position: number;
  playing: boolean;
}

const esc = (s: any) =>
  String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export class Quiz {
  state: any = null;
  private snapshot: Snapshot | null = null;
  private lobbyUntil = 0;
  private random = false;
  private finishedAt = 0;
  private revealAt = 0;
  private starting = false;
  private qrFor = "";
  private lastRender = "";
  songsSince = 0;

  constructor(private host: QuizHost, private el: HTMLElement, private card: HTMLElement) {}

  get active(): boolean {
    return !!this.state;
  }

  /** Full screen once the game runs; a lobby from "Sometimes" stays a corner card. */
  get fullScreen(): boolean {
    return !!this.state && !(this.random && this.state.phase === "lobby");
  }

  /** Starts a quiz: saves the party queue, creates the game and opens the lobby. */
  async start(opts: { random?: boolean; rounds?: number; lobbySeconds?: number } = {}): Promise<void> {
    if (this.state || this.starting) return;
    const qid = this.host.queueId();
    if (!qid) {
      this.host.toast("Start some music on a player first");
      return;
    }
    this.starting = true;
    try {
      const options = await this.host.send("music_quiz/playback_options");
      const venues: string[] = ((options && options.venue_players) || []).map((p: any) => (typeof p === "string" ? p : p.player_id));
      const venue = venues.includes(qid) ? qid : options && options.default_venue_player_id;
      if (!venue) {
        this.host.toast("The quiz can't play on this player");
        return;
      }
      this.snapshot = await this.takeSnapshot(qid);
      const sources = await this.sources(this.snapshot);
      const state = await this.host.send(
        "music_quiz/create",
        {
          quiz_type: "guess_the_song",
          name: "Music quiz",
          round_count: opts.rounds || 5,
          suggestion_count: 4,
          answer_duration: 20,
          source_uris: sources,
          playback_mode: "venue",
          venue_player_id: venue,
        },
        60000,
      );
      this.random = !!opts.random;
      this.lobbyUntil = Date.now() + (opts.lobbySeconds || 90) * 1000;
      this.finishedAt = 0;
      this.setState(state);
    } catch (e: any) {
      this.snapshot = null;
      const msg = String((e && e.message) || e);
      this.host.toast(/invalid command/i.test(msg) ? "Turn on the Music Quiz plugin in Music Assistant" : "Quiz: " + msg);
    } finally {
      this.starting = false;
    }
  }

  private async takeSnapshot(qid: string): Promise<Snapshot> {
    const q = await this.host.send("player_queues/get", { queue_id: qid });
    const items: any[] = [];
    for (let off = 0; off < 1000; off += 200) {
      const page = await this.host.send("player_queues/items", { queue_id: qid, limit: 200, offset: off });
      items.push(...(page || []));
      if (!page || page.length < 200) break;
    }
    const uris = items.map((it) => (it.media_item && it.media_item.uri) || null).filter(Boolean);
    return {
      queueId: qid,
      uris,
      index: (q && q.current_index) || 0,
      position: this.host.position(),
      playing: !!q && q.state === "playing",
    };
  }

  /** Tonight's songs make the best questions; the library fills up a short queue. */
  private async sources(s: Snapshot): Promise<string[]> {
    const set = new Set(s.uris.filter((u) => /track/.test(u)));
    if (set.size < 12) {
      try {
        const lib = await this.host.send("music/tracks/library_items", { limit: 60, order_by: "random" });
        for (const t of lib || []) if (t && t.uri) set.add(t.uri);
      } catch {
        /* the plugin falls back to what it has */
      }
    }
    return Array.from(set).slice(0, 200);
  }

  /** Music Assistant pushes game state as provider events. */
  onProviderEvent(data: any): void {
    if (!data) return;
    if (data.event === "game_updated" && data.state) {
      if (!this.state && !this.starting) return; // someone else's game
      this.setState(data.state);
    } else if (data.event === "game_removed" && this.state) {
      this.finish(false);
    }
  }

  private setState(s: any): void {
    const was = this.state ? this.state.phase : "";
    this.state = s;
    if (s.phase === "reveal" && was !== "reveal") this.revealAt = Date.now();
    if (s.phase === "finished" && !this.finishedAt) {
      this.finishedAt = Date.now();
      this.host.celebrate();
    }
    this.host.onActive(this.fullScreen);
    this.render();
  }

  /** OK on the remote: start now from the lobby, or skip ahead. */
  async ok(): Promise<void> {
    if (!this.state) return;
    const p = this.state.phase;
    try {
      if (p === "lobby") {
        if (!(this.state.players || []).length) {
          this.host.toast("Waiting for someone to join");
          return;
        }
        await this.host.send("music_quiz/start", {}, 30000);
      } else if (p === "answering") await this.host.send("music_quiz/reveal");
      else if (p === "reveal") await this.host.send("music_quiz/next", {}, 30000);
      else if (p === "finished") await this.finish(true);
    } catch (e: any) {
      this.host.toast(String((e && e.message) || e));
    }
  }

  /** Ends the game and gives the party its music back. */
  async finish(deleteGame = true): Promise<void> {
    const snap = this.snapshot;
    this.state = null;
    this.snapshot = null;
    this.random = false;
    this.lastRender = "";
    this.el.innerHTML = "";
    this.card.classList.remove("on");
    this.host.onActive(false);
    if (deleteGame) {
      try {
        await this.host.send("music_quiz/delete");
      } catch {
        /* already gone */
      }
    }
    this.songsSince = 0;
    if (!snap || !snap.uris.length) return;
    try {
      const rest = snap.uris.slice(snap.index);
      if (!rest.length) return;
      await this.host.send("player_queues/play_media", { queue_id: snap.queueId, media: rest, option: "replace" }, 60000);
      if (snap.position > 5) {
        setTimeout(() => this.host.send("player_queues/seek", { queue_id: snap.queueId, position: Math.round(snap.position) }).catch(() => {}), 2500);
      }
      if (!snap.playing) setTimeout(() => this.host.send("player_queues/pause", { queue_id: snap.queueId }).catch(() => {}), 3500);
      this.host.toast("Back to the party");
    } catch (e: any) {
      this.host.toast("Couldn't put the music back: " + String((e && e.message) || e));
    }
  }

  /** Every 100 ms: countdowns, the lobby timer, and moving on after the final scores. */
  tick(): void {
    const s = this.state;
    if (!s) return;
    const now = Date.now();
    if (s.phase === "lobby" && this.lobbyUntil && now > this.lobbyUntil) {
      this.lobbyUntil = 0;
      if ((s.players || []).length) this.host.send("music_quiz/start", {}, 30000).catch(() => {});
      else if (this.random) {
        // nobody joined: quietly carry on with the party, nothing was touched yet
        this.finish(true);
        return;
      } else this.lobbyUntil = now + 60000;
    }
    // the plugin can schedule the next round itself; if it doesn't, move on after a while
    const r = s.current_round || {};
    if (s.phase === "reveal" && !r.auto_advance_at && this.revealAt && now - this.revealAt > 12000) {
      this.revealAt = 0;
      this.host.send("music_quiz/next", {}, 30000).catch(() => {});
    }
    if (s.phase === "finished" && this.finishedAt && now - this.finishedAt > 30000) {
      this.finish(true);
      return;
    }
    this.renderTimers();
  }

  private qr(url: string, cell = 8): string {
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    this.qrFor = url;
    return qr.createSvgTag({ cellSize: cell, margin: 0, scalable: true } as any);
  }

  private secondsLeft(deadline: number | null | undefined): number {
    if (!deadline) return 0;
    return Math.max(0, deadline - this.host.serverNow());
  }

  private renderTimers(): void {
    const s = this.state;
    const r = s.current_round || {};
    const t = this.el.querySelector(".qz-time") as HTMLElement | null;
    const ring = this.el.querySelector(".qz-arc") as SVGCircleElement | null;
    const cardT = this.card.querySelector(".qz-time") as HTMLElement | null;
    if (s.phase === "lobby") {
      const left = Math.max(0, Math.ceil((this.lobbyUntil - Date.now()) / 1000));
      const txt = left ? `Starts in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "Starting…";
      if (t) t.textContent = txt;
      if (cardT) cardT.textContent = txt;
    } else if (s.phase === "answering") {
      const left = this.secondsLeft(r.deadline);
      if (t) t.textContent = String(Math.ceil(left));
      if (ring) ring.style.strokeDashoffset = String(276.5 * (1 - left / Math.max(1, s.answer_duration || 20)));
    } else if (s.phase === "reveal") {
      const left = r.auto_advance_at ? Math.ceil(this.secondsLeft(r.auto_advance_at)) : 0;
      if (t) t.textContent = left ? `Next round in ${left}` : "OK for the next round";
    } else if (s.phase === "finished" && t) {
      const left = Math.max(0, Math.ceil((30000 - (Date.now() - this.finishedAt)) / 1000));
      t.textContent = `Back to the music in ${left}`;
    }
  }

  private render(): void {
    const s = this.state;
    if (!s) return;
    const players: any[] = s.players || [];
    const r = s.current_round || {};
    const key = JSON.stringify([s.phase, players.map((p) => [p.name, p.score, p.answered]), r.round_index, r.correct_suggestion_id, s.join_url, this.random]);
    if (key === this.lastRender) return;
    this.lastRender = key;
    const url: string = s.join_url || "";

    // the corner card: a "Sometimes" quiz announcing itself
    if (this.random && s.phase === "lobby") {
      this.card.innerHTML = `${url ? `<div class="pop-qr">${this.qr(url, 6)}</div>` : ""}<div class="pop-txt"><b>Music quiz!</b>Scan to join, pick a name and guess the songs.<div class="qz-time"></div>${
        players.length ? `<div class="qz-names">${players.map((p) => `<span>${esc(p.name)}</span>`).join("")}</div>` : ""
      }</div>`;
      this.card.classList.add("on");
      this.el.innerHTML = "";
      return;
    }
    this.card.classList.remove("on");

    const total = s.round_count || 0;
    const roundNo = (r.round_index || 0) + 1;
    const chips = (withAnswered: boolean) =>
      players.length
        ? `<div class="qz-players">${players
            .map((p) => `<span class="${withAnswered && p.answered ? "done" : ""}">${esc(p.name)}${withAnswered && p.answered ? " ✓" : ""}</span>`)
            .join("")}</div>`
        : "";
    const board = () => {
      const sorted = players.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
      return `<div class="qz-board">${sorted
        .map((p, i) => `<div class="qz-row"><span class="qz-pos">${i + 1}</span><span class="qz-name">${esc(p.name)}</span><span class="qz-score">${p.score || 0}</span></div>`)
        .join("")}</div>`;
    };

    let html = "";
    if (s.phase === "lobby") {
      html = `<div class="qz-lobby">
        <div class="qz-qr">${url ? this.qr(url) : ""}</div>
        <div class="qz-side">
          <div class="qz-kicker">Music quiz</div>
          <h1>Scan to play</h1>
          <p>Join on your phone, pick a name, and guess the songs as they play. ${total} rounds.</p>
          ${players.length ? chips(false) : `<div class="qz-wait">Waiting for players…</div>`}
          <div class="qz-time"></div>
          <div class="qz-hint">OK to start now · Back to cancel</div>
        </div></div>`;
    } else if (s.phase === "answering") {
      const sug: any[] = r.suggestions || [];
      const answered = players.filter((p) => p.answered).length;
      html = `<div class="qz-head"><span class="qz-kicker">Round ${roundNo} of ${total}</span><span class="qz-count">${answered} of ${players.length} answered</span></div>
        <div class="qz-ask"><div class="qz-ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44"/><circle class="qz-arc" cx="50" cy="50" r="44"/></svg><span class="qz-time"></span></div>
        <h1>${esc((r.question && (r.question.text || r.question)) || "Name that song!")}</h1></div>
        <div class="qz-tiles">${sug.map((o, i) => `<div class="qz-tile"><b>${LETTERS[i] || ""}</b><span>${esc(o.label)}</span></div>`).join("")}</div>
        ${chips(true)}`;
    } else if (s.phase === "reveal") {
      const sug: any[] = r.suggestions || [];
      const img = this.host.imageUrl(r.image_url || null);
      html = `<div class="qz-head"><span class="qz-kicker">Round ${roundNo} of ${total}</span><span class="qz-time"></span></div>
        <div class="qz-reveal">
          <div class="qz-answer">${img ? `<img src="${esc(img)}">` : ""}<div><div class="qz-kicker">It was</div><h1>${esc(r.answer_label || "")}</h1></div></div>
          <div class="qz-tiles small">${sug
            .map((o, i) => `<div class="qz-tile ${o.suggestion_id === r.correct_suggestion_id ? "right" : "wrong"}"><b>${LETTERS[i] || ""}</b><span>${esc(o.label)}</span></div>`)
            .join("")}</div>
          ${board()}
        </div>`;
    } else if (s.phase === "finished") {
      const sorted = players.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
      const podium = [sorted[1], sorted[0], sorted[2]];
      const top = sorted[0] ? sorted[0].score || 0 : 0;
      const winners = sorted.filter((p) => (p.score || 0) === top);
      const headline = !sorted.length || !top ? "That's the quiz!" : winners.length > 1 ? "It's a tie!" : esc(sorted[0].name) + " wins!";
      html = `<div class="qz-final"><div class="qz-kicker">Music quiz</div><h1>${headline}</h1>
        <div class="qz-podium">${podium
          .map((p, i) => (p ? `<div class="qz-step s${i}"><div class="qz-name">${esc(p.name)}</div><div class="qz-block"><b>${[2, 1, 3][i]}</b><span>${p.score || 0}</span></div></div>` : `<div class="qz-step s${i} empty"></div>`))
          .join("")}</div>
        ${sorted.length > 3 ? board() : ""}<div class="qz-time"></div></div>`;
    }
    this.el.innerHTML = html;
    this.renderTimers();
  }
}

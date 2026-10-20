// Music Assistant TV: now playing, karaoke lyrics, party dashboard and a Sendspin speaker for
// Samsung (Tizen) TVs.

import qrcode from "qrcode-generator";
import { MAClient, MAEvent, login, normalizeServer } from "./api";
import { scan, FoundServer } from "./discover";
import { parseLrc, currentLine, lineProgress, LyricLine } from "./lyrics";
import { installAnalyserHook, startVisualizer, confetti, setBackdropColors } from "./fx";
import { settings, saveSettings } from "./settings";
import { Speaker } from "./speaker";

declare const tizen: any;
declare const webapis: any;
declare const APP_VERSION: string;

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: any) =>
  String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// ------------------------------------------------------------------ state

let client: MAClient | null = null;
const speaker = new Speaker();
const players = new Map<string, any>();
const queues = new Map<string, any>();
let followQueueId: string | null = null;
let lastPlayingQueueId: string | null = null;
let upcoming: any[] = [];
let recent: any[] = [];
let lyricLines: LyricLine[] = [];
let lyricsFor = "";
let castSession: { dashboard: string; player_id?: string | null } | null = null;
let party: { url: string | null; config: any; queueId: string | null; available: boolean } = {
  url: null,
  config: null,
  queueId: null,
  available: false,
};
// local clock minus server wall clock, ms (from queue updates); null until known
let clockOffset: number | null = null;
const offsetSamples: number[] = [];
let anchor: { elapsed: number; serverTs: number; speed: number; playing: boolean } | null = null;

// ------------------------------------------------------------------ helpers

function serverNow(): number {
  return (Date.now() - (clockOffset || 0)) / 1000;
}

function noteOffset(lastUpdated: number): void {
  if (!lastUpdated) return;
  const sample = Date.now() - lastUpdated * 1000;
  offsetSamples.push(sample);
  if (offsetSamples.length > 40) offsetSamples.shift();
  clockOffset = Math.min.apply(null, offsetSamples);
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return (h ? h + ":" : "") + mm + ":" + String(sec).padStart(2, "0");
}

let toastTimer: any;
function toast(text: string): void {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 1800);
}

let hintTimer: any;
function showHints(): void {
  document.body.classList.add("show-hints");
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => document.body.classList.remove("show-hints"), 6000);
}

function setStatus(text: string): void {
  const s = $("status");
  s.textContent = text;
  s.classList.toggle("on", !!text);
}

function artists(item: any): string {
  const mi = item && item.media_item;
  if (mi && mi.artists && mi.artists.length) return mi.artists.map((a: any) => a.name).join(", ");
  if (mi && mi.artist_str) return mi.artist_str;
  return "";
}

function itemImage(item: any): any {
  if (!item) return null;
  if (item.image) return item.image;
  const mi = item.media_item;
  const imgs = (mi && mi.metadata && mi.metadata.images) || (mi && mi.album && mi.album.metadata && mi.album.metadata.images);
  if (imgs && imgs.length) return imgs.find((i: any) => i.type === "thumb") || imgs[0];
  return null;
}

function itemTitle(item: any): string {
  return (item && ((item.media_item && item.media_item.name) || item.name)) || "";
}

function screenSaver(on: boolean): void {
  try {
    webapis.appcommon.setScreenSaver(
      on ? webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_ON : webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF,
    );
  } catch {
    /* not on a TV */
  }
}

// ------------------------------------------------------------------ connection

function connect(): void {
  if (client) client.stop();
  if (!settings.server || !settings.token) {
    showSetup();
    return;
  }
  const c = new MAClient(settings.server, settings.token);
  client = c;
  c.onStatus = (s) => {
    if (client !== c) return;
    if (s === "ready") {
      setStatus("");
      onReady();
    } else if (s === "auth_failed") {
      setStatus("");
      c.stop();
      settings.token = "";
      saveSettings();
      showSetup("Music Assistant asked to sign in again.");
    } else if (s === "disconnected") {
      setStatus("Reconnecting to Music Assistant…");
    } else if (s === "connecting" && !c.info) {
      setStatus("Connecting to Music Assistant…");
    }
  };
  c.onEvent = onEvent;
  c.start();
  if (settings.speakerEnabled) speaker.start(settings.server);
}

async function onReady(): Promise<void> {
  const c = client!;
  try {
    const [pl, qs] = await Promise.all([c.send("players/all"), c.send("player_queues/all")]);
    players.clear();
    for (const p of pl || []) players.set(p.player_id, p);
    queues.clear();
    for (const q of qs || []) {
      queues.set(q.queue_id, q);
      noteOffset(q.elapsed_time_last_updated);
    }
  } catch (e) {
    console.error(e);
  }
  try {
    await c.send("dashboard/register", {
      dashboard_id: settings.dashboardId,
      name: settings.speakerName || "Samsung TV",
      supported_types: ["now_playing", "party"],
    });
  } catch (e) {
    console.warn("dashboard/register", e); // older Music Assistant: no casting
  }
  refreshParty();
  resolveFollow();
}

function onEvent(e: MAEvent): void {
  switch (e.event) {
    case "player_added":
    case "player_updated":
      if (e.data && e.data.player_id) {
        const before = players.get(e.data.player_id);
        players.set(e.data.player_id, e.data);
        // show the volume when it changes on the player being shown (from here or anywhere else)
        if (
          before &&
          e.data.player_id === followQueueId &&
          (before.volume_level !== e.data.volume_level || before.group_volume !== e.data.group_volume)
        )
          showVolume(e.data.player_id);
      }
      scheduleResolve();
      break;
    case "player_removed":
      if (e.object_id) players.delete(e.object_id);
      scheduleResolve();
      break;
    case "queue_added":
    case "queue_updated":
      if (e.data && e.data.queue_id) {
        const prev = queues.get(e.data.queue_id);
        queues.set(e.data.queue_id, e.data);
        noteOffset(e.data.elapsed_time_last_updated);
        if (e.data.queue_id === followQueueId) {
          setAnchorFromQueue(e.data);
          const changed =
            !prev ||
            prev.current_index !== e.data.current_index ||
            (prev.current_item && prev.current_item.queue_item_id) !== (e.data.current_item && e.data.current_item.queue_item_id);
          renderQueue(changed);
        }
        scheduleResolve();
      }
      break;
    case "queue_time_updated":
      if (e.object_id === followQueueId && typeof e.data === "number") {
        const q = queues.get(e.object_id!);
        anchor = {
          elapsed: e.data,
          serverTs: serverNow(),
          speed: (q && q.playback_speed) || 1,
          playing: !!q && q.state === "playing",
        };
      }
      break;
    case "queue_items_updated":
      if (e.object_id === followQueueId) loadUpcoming();
      break;
    case "dashboard_show":
      if (e.object_id === settings.dashboardId && e.data) {
        castSession = { dashboard: e.data.dashboard, player_id: e.data.player_id };
        setView(e.data.dashboard === "party" ? "party" : "now", false);
        resolveFollow();
      }
      break;
    case "dashboard_hide":
      if (e.object_id === settings.dashboardId) {
        castSession = null;
        setView(settings.view, false);
        resolveFollow();
      }
      break;
    case "providers_updated":
      refreshParty();
      break;
  }
}

// ------------------------------------------------------------------ which queue to show

let resolveTimer: any = null;
function scheduleResolve(): void {
  if (resolveTimer) return;
  resolveTimer = setTimeout(() => {
    resolveTimer = null;
    resolveFollow();
  }, 400);
}

function tvPlayerId(): string | null {
  const id = speaker.clientId;
  if (id && players.has(id)) return id;
  if (!id) return null;
  // Music Assistant wraps a Sendspin client in its own player ("universal player"); the
  // Sendspin client id shows up as that player's output protocol.
  for (const p of players.values()) {
    if (p.player_id === id) return p.player_id;
    if ((p.output_protocols || []).some((o: any) => o.output_protocol_id === id)) return p.player_id;
  }
  return null;
}

/** The queue that plays on a player: its group's queue when it's grouped. */
function queueForPlayer(playerId: string | null | undefined): string | null {
  if (!playerId) return null;
  const p = players.get(playerId);
  if (p) {
    if (p.active_group && queues.has(p.active_group)) return p.active_group;
    if (p.synced_to && queues.has(p.synced_to)) return p.synced_to;
    if (p.active_source && queues.has(p.active_source)) return p.active_source;
  }
  return queues.has(playerId) ? playerId : null;
}

function pickAuto(): string | null {
  const tv = queueForPlayer(tvPlayerId());
  if (tv && queues.get(tv).state === "playing") return tv;
  const list = Array.from(queues.values()).filter((q) => q.available !== false && q.active !== false);
  const playing = list.filter((q) => q.state === "playing");
  if (lastPlayingQueueId && playing.some((q) => q.queue_id === lastPlayingQueueId)) return lastPlayingQueueId;
  if (playing.length) return playing[0].queue_id;
  if (followQueueId && queues.has(followQueueId) && queues.get(followQueueId).current_item) return followQueueId;
  if (tv && queues.get(tv).current_item) return tv;
  const paused = list.find((q) => q.state === "paused" && q.current_item);
  return paused ? paused.queue_id : null;
}

function resolveFollow(): void {
  let target: string | null;
  if (castSession && castSession.player_id) target = queueForPlayer(castSession.player_id);
  else if (currentView() === "party" && party.queueId) target = queueForPlayer(party.queueId) || party.queueId;
  else if (settings.follow === "tv") target = queueForPlayer(tvPlayerId());
  else if (settings.follow !== "auto") target = queueForPlayer(settings.follow) || pickAuto();
  else target = pickAuto();
  const q = target ? queues.get(target) : null;
  if (q && q.state === "playing") lastPlayingQueueId = q.queue_id;
  if (target !== followQueueId) {
    followQueueId = target;
    anchor = null;
    upcoming = [];
    recent = [];
    if (q) setAnchorFromQueue(q);
    renderQueue(true);
  }
}

function setAnchorFromQueue(q: any): void {
  anchor = {
    elapsed: q.elapsed_time || 0,
    serverTs: q.elapsed_time_last_updated || serverNow(),
    speed: q.playback_speed || 1,
    playing: q.state === "playing",
  };
}

function position(): number {
  if (!anchor) return 0;
  if (!anchor.playing) return anchor.elapsed;
  return anchor.elapsed + Math.max(0, serverNow() - anchor.serverTs) * anchor.speed;
}

// ------------------------------------------------------------------ rendering

let bgFlip = false;
let bgUrl = "";
function setBackground(url: string | null): void {
  if (url === bgUrl) return;
  bgUrl = url || "";
  const a = $(bgFlip ? "bg-a" : "bg-b");
  const b = $(bgFlip ? "bg-b" : "bg-a");
  bgFlip = !bgFlip;
  if (url) {
    const img = new Image();
    img.onload = () => {
      // blur once into a small canvas; the CSS only moves it around afterwards
      const c = a as HTMLCanvasElement;
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, c.width, c.height);
        try {
          (ctx as any).filter = "blur(18px) saturate(1.35) brightness(0.62)";
        } catch {
          /* older engines: the small canvas, scaled up, is soft enough */
        }
        const s = Math.max(c.width / img.width, c.height / img.height) * 1.15;
        const w = img.width * s;
        const h = img.height * s;
        ctx.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
        (ctx as any).filter = "none";
      }
      a.classList.add("on");
      b.classList.remove("on");
    };
    img.src = url;
  } else {
    a.classList.remove("on");
    b.classList.remove("on");
  }
}

let paletteFor = "";
async function applyPalette(image: any): Promise<void> {
  const id = image && image.proxy_id;
  if (!client || !id || id === paletteFor) return;
  paletteFor = id;
  try {
    const p = await client.send("metadata/get_image_palette", { image_id: id });
    if (p && paletteFor === id) {
      // colors arrive as [r, g, b]; "on_dark" is the one meant to be read on a dark background
      let c: number[] | null = p.on_dark || p.accent || p.primary || null;
      if (Array.isArray(c) && c.length >= 3) {
        // keep it bright enough to read from across the room
        const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
        if (lum < 0.45) {
          const k = (0.45 - lum) / (1 - lum);
          c = c.map((v) => Math.round(v + (255 - v) * k));
        }
        document.documentElement.style.setProperty("--accent", `rgb(${c[0]},${c[1]},${c[2]})`);
      }
      const rgb = (v: any, lift = 0) =>
        Array.isArray(v) ? `rgb(${v.map((x: number) => Math.round(x + (255 - x) * lift)).join(",")})` : null;
      const blobs = [rgb(p.accent, 0.1), rgb(p.primary, 0.15), rgb(p.on_dark || p.accent, 0)].filter(Boolean) as string[];
      if (blobs.length) setBackdropColors(blobs);
    }
  } catch {
    /* palette is optional */
  }
}

function renderQueue(trackChanged: boolean): void {
  const q = followQueueId ? queues.get(followQueueId) : null;
  const item = q && q.current_item;
  document.body.classList.toggle("idle", !item);
  if (!item) {
    document.body.classList.remove("paused");
    lastItemId = "";
  }
  const pname = q ? q.display_name : "";
  $("player-name").textContent = pname;
  if (!item) {
    $("idle-sub").textContent = idleText();
    setBackground(null);
    screenSaver(true);
    renderParty();
    return;
  }
  screenSaver(q.state !== "playing");
  // some players report a paused queue as "idle" with the song still loaded
  document.body.classList.toggle("paused", q.state !== "playing");
  const itemId = item.queue_item_id;
  if (itemId !== lastItemId) {
    const first = lastItemId === "";
    lastItemId = itemId;
    if (!first) {
      document.body.classList.remove("swap");
      void document.body.offsetWidth; // restart the animation
      document.body.classList.add("swap");
      clearTimeout(swapTimer);
      swapTimer = setTimeout(() => document.body.classList.remove("swap"), 1200);
      guestMoment(item);
    }
  }
  $("title").textContent = itemTitle(item);
  $("artist").textContent = artists(item);
  const mi = item.media_item;
  $("album").textContent = (mi && mi.album && mi.album.name) || "";
  const image = itemImage(item);
  const url = client ? client.imageUrl(image, 1024) : null;
  const art = $("art") as HTMLImageElement;
  if (trackChanged || art.dataset.src !== (url || "")) {
    art.dataset.src = url || "";
    art.classList.remove("on");
    if (url) {
      art.onload = () => art.classList.add("on");
      art.src = url;
    } else art.removeAttribute("src");
    setBackground(client ? client.imageUrl(image, 256) : null);
    applyPalette(image);
  }
  if (trackChanged) {
    loadUpcoming();
    loadLyrics(item);
  }
  renderUpnext();
  renderParty();
}

let lastItemId = "";
let swapTimer: any;
let bannerTimer: any;

/** A guest's song starting: a banner, and confetti when it was boosted. */
function guestMoment(item: any): void {
  const ex = (item && item.extra_attributes) || {};
  if (!ex.party_guest && !ex.party_boosted) return;
  const b = $("banner");
  b.textContent = ex.party_boosted ? "Boosted by a guest" : "Requested by a guest";
  b.classList.add("on");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove("on"), 6000);
  if (ex.party_boosted) {
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#e8a33d";
    confetti($("confetti") as HTMLCanvasElement, [accent, "#ffffff", "#f0c330", "#3fb35a", "#3b7be5", "#e5413b"]);
  }
}

function idleText(): string {
  if (!client || !client.connected) return "";
  if (settings.speakerEnabled && speaker.connected)
    return `Play something on “${settings.speakerName}” in Music Assistant to hear it here.`;
  return "Start something in Music Assistant.";
}

async function loadUpcoming(): Promise<void> {
  const q = followQueueId ? queues.get(followQueueId) : null;
  if (!client || !q) return;
  const qid = q.queue_id;
  const idx = q.current_index || 0;
  try {
    const items = await client.send("player_queues/items", { queue_id: qid, limit: 8, offset: Math.max(0, idx - 2) });
    if (qid !== followQueueId) return;
    const start = Math.max(0, idx - 2);
    recent = (items || []).filter((_: any, i: number) => start + i < idx);
    upcoming = (items || []).filter((_: any, i: number) => start + i > idx);
  } catch {
    upcoming = [];
    recent = [];
  }
  renderUpnext();
  renderParty();
}

function renderUpnext(): void {
  const n = upcoming[0];
  $("upnext").innerHTML = n ? `<span class="label">Up next</span><b>${esc(itemTitle(n))}</b>${artists(n) ? " · " + esc(artists(n)) : ""}` : "";
}

async function loadLyrics(item: any): Promise<void> {
  const mi = item && item.media_item;
  const key = (mi && mi.uri) || (item && item.queue_item_id) || "";
  lyricsFor = key;
  lyricLines = [];
  renderLyricsList();
  if (!client || !mi || mi.media_type !== "track") return;
  let lrc: string | null = (mi.metadata && mi.metadata.lrc_lyrics) || null;
  if (!lrc) {
    try {
      const res = await client.send("metadata/get_track_lyrics", { track: mi }, 30000);
      lrc = res && (res[1] || null);
    } catch {
      lrc = null;
    }
  }
  if (lyricsFor !== key) return;
  lyricLines = parseLrc(lrc);
  // a count-in before the first line, when the song has an intro
  if (lyricLines.length && lyricLines[0].t > 3) lyricLines.unshift({ t: 0, text: "", gap: true });
  renderLyricsList();
}

let shownLine = -2;
function renderLyricsList(): void {
  const inner = $("lyrics-inner");
  inner.innerHTML = lyricLines
    .map((l) => {
      if (l.gap) return `<div class="ly gap"><i></i><i></i><i></i></div>`;
      if (l.words) return `<div class="ly">${l.words.map((w) => `<span class="w">${esc(w.text)}</span>`).join("")}</div>`;
      return `<div class="ly">${esc(l.text)}</div>`;
    })
    .join("");
  shownLine = -2;
  updateKaraokeClass();
}

function karaokeOn(): boolean {
  if (!lyricLines.length) return false;
  if (currentView() === "party") return !!(party.config && party.config.karaoke_mode) || settings.lyrics;
  return settings.lyrics;
}

function updateKaraokeClass(): void {
  const on = karaokeOn() && !document.body.classList.contains("idle");
  document.body.classList.toggle("karaoke", on);
  $("party").classList.toggle("karaoke", on);
}

function tick(): void {
  const q = followQueueId ? queues.get(followQueueId) : null;
  const item = q && q.current_item;
  const dur = (item && (item.duration || (item.media_item && item.media_item.duration))) || 0;
  const pos = position();
  if (item) {
    $("pos").textContent = fmtTime(pos);
    $("dur").textContent = dur ? fmtTime(dur) : "";
    const pct = dur ? Math.min(100, (pos / dur) * 100) + "%" : "0";
    ($("fill") as HTMLElement).style.width = pct;
    const pbar = document.querySelector(".pitem.cur .bar i") as HTMLElement | null;
    if (pbar) pbar.style.width = pct;
  }
  if (lyricLines.length && document.body.classList.contains("karaoke")) {
    // highlight slightly ahead so the line is up before it's sung
    const ahead = party.config && party.config.highlight_ahead && currentView() === "party" ? 0.6 : 0.25;
    const idx = currentLine(lyricLines, pos + ahead);
    if (idx !== shownLine) {
      shownLine = idx;
      const els = $("lyrics-inner").children;
      for (let i = 0; i < els.length; i++) {
        const el = els[i] as HTMLElement;
        const l = lyricLines[i];
        el.className =
          "ly" + (l.gap ? " gap" : "") + (i === idx && !l.gap && !l.words ? " fill" : "") +
          (i < idx ? " past" : i === idx ? " cur" : i === idx + 1 ? " next" : "");
      }
      const target = els[Math.max(0, idx)] as HTMLElement | undefined;
      if (target) {
        const y = target.offsetTop - $("lyrics").clientHeight * 0.4 + target.offsetHeight / 2;
        ($("lyrics-inner") as HTMLElement).style.transform = `translateY(${-Math.max(-300, y)}px)`;
      }
    }
    fillLine(idx, pos + ahead, dur);
  }
  if (document.body.classList.contains("idle")) updateClock();
}

/** Fills the current lyric line as it's sung: word by word when the lyrics have word timing. */
function fillLine(idx: number, pos: number, dur: number): void {
  if (idx < 0) return;
  const el = $("lyrics-inner").children[idx] as HTMLElement | undefined;
  const l = lyricLines[idx];
  if (!el || !l) return;
  if (l.gap) {
    // dots light up over the last few seconds before the next line
    const next = lyricLines[idx + 1];
    const left = next ? next.t - pos : 99;
    const dots = el.children;
    for (let d = 0; d < dots.length; d++) (dots[d] as HTMLElement).classList.toggle("lit", left < 3.6 - d * 1.2 + 0.0001 && left < 3.6);
    return;
  }
  if (l.words) {
    const spans = el.children;
    for (let w = 0; w < spans.length; w++) {
      const word = l.words[w];
      const nextT = w + 1 < l.words.length ? l.words[w + 1].t : word.t + 0.6;
      const sp = spans[w] as HTMLElement;
      if (pos >= nextT) sp.className = "w done";
      else if (pos >= word.t) {
        sp.className = "w now";
        sp.style.setProperty("--p", Math.round(((pos - word.t) / Math.max(0.15, nextT - word.t)) * 100) + "%");
      } else sp.className = "w";
    }
    return;
  }
  el.style.setProperty("--p", Math.round(lineProgress(lyricLines, idx, pos, dur) * 100) + "%");
}

let clockText = "";
function updateClock(): void {
  const now = new Date();
  const t = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (t === clockText) return;
  clockText = t;
  $("clock").textContent = t;
  $("date").textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

// ------------------------------------------------------------------ party

async function refreshParty(): Promise<void> {
  if (!client || !client.connected) return;
  try {
    const [url, config, queueId] = await Promise.all([
      client.send("party/url"),
      client.send("party/config"),
      client.send("party/player"),
    ]);
    party = { url, config, queueId, available: true };
  } catch {
    party = { url: null, config: null, queueId: null, available: false };
  }
  renderQr();
  renderParty();
  if (currentView() === "party") resolveFollow();
}

function renderQr(): void {
  const box = $("party-qr");
  const card = $("party-qr-card");
  card.classList.toggle("no-qr", !party.url);
  if (!party.url) {
    // the plugin is on but guests can't join yet: say where to switch it on
    box.innerHTML = `<div class="qr-off">No QR code yet</div>`;
    $("party-name").textContent = (party.config && party.config.party_name) || "Party";
    $("party-qr-text").textContent = "In Music Assistant, open Settings, Plugins, Party and turn on “Enable Guest Access via QR Code”.";
    return;
  }
  const qr = qrcode(0, "M");
  qr.addData(party.url);
  qr.make();
  box.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 0, scalable: true } as any);
  const c = party.config || {};
  $("party-name").textContent = c.party_name || "Party";
  $("party-qr-text").textContent = c.qr_text || "Scan to add songs";
}

function renderParty(): void {
  const off = !party.available;
  document.body.classList.toggle("party-off", off && currentView() === "party");
  if (off) {
    $("party-off").innerHTML = "<b>Party mode isn't on</b>Turn on the Party plugin in Music Assistant: Settings, Plugins, Add a plugin.";
    return;
  }
  const q = followQueueId ? queues.get(followQueueId) : null;
  const cur = q && q.current_item;
  const c = party.config || {};
  const badge = (it: any) => {
    const ex = (it && it.extra_attributes) || {};
    if (ex.party_boosted) return `<span class="badge" style="background:${esc(c.boost_badge_color || "#f0c330")}">Boosted</span>`;
    if (ex.party_guest) return `<span class="badge" style="background:${esc(c.request_badge_color || "#3fb35a")}">Request</span>`;
    return "";
  };
  const row = (it: any, cls: string) => {
    const img = client ? client.imageUrl(itemImage(it), 256) : null;
    return `<div class="pitem ${cls}">${img ? `<img src="${esc(img)}">` : '<div class="noimg"></div>'}<div class="txt"><div class="t">${esc(
      itemTitle(it),
    )}${badge(it)}</div><div class="a">${esc(artists(it))}</div>${cls === "cur" && c.show_progress_bar !== false ? '<div class="bar"><i></i></div>' : ""}</div></div>`;
  };
  const html = [
    ...recent.slice(-1).map((it) => row(it, "past")),
    cur ? row(cur, "cur") : "",
    ...upcoming.slice(0, 4).map((it) => row(it, "")),
  ];
  renderTicker(cur);
  $("party-stack").innerHTML = cur
    ? html.join("")
    : `<div class="pempty"><b>Nothing playing yet</b>Scan the code with your phone to add the first song.</div>`;
}

let tickerHtml = "";
function renderTicker(cur: any): void {
  const c = party.config || {};
  const requests = upcoming.filter((it) => it && it.extra_attributes && (it.extra_attributes.party_guest || it.extra_attributes.party_boosted)).length;
  const parts: string[] = [];
  if (party.url) parts.push(`<span><b>●</b>${esc(c.qr_text || "Scan the code to add a song")}</span>`);
  if (requests) parts.push(`<span><b>●</b>${requests === 1 ? "1 guest request in the queue" : requests + " guest requests in the queue"}</span>`);
  if (upcoming[0]) parts.push(`<span><b>Up next</b>${esc(itemTitle(upcoming[0]))}${artists(upcoming[0]) ? " · " + esc(artists(upcoming[0])) : ""}</span>`);
  if (upcoming[1]) parts.push(`<span><b>Then</b>${esc(itemTitle(upcoming[1]))}</span>`);
  if (!parts.length && cur) parts.push(`<span><b>Now</b>${esc(itemTitle(cur))}</span>`);
  // twice, so the scroll loops without a jump
  const html = parts.length ? parts.join("") + parts.join("") : "";
  if (html === tickerHtml) return;
  tickerHtml = html;
  $("ticker-inner").innerHTML = html;
  $("ticker").style.display = html ? "" : "none";
}

// ------------------------------------------------------------------ views and controls

function currentView(): "now" | "party" {
  return document.body.classList.contains("view-party") ? "party" : "now";
}

function setView(v: "now" | "party", remember = true): void {
  document.body.classList.toggle("view-now", v === "now");
  document.body.classList.toggle("view-party", v === "party");
  if (remember) {
    settings.view = v;
    saveSettings();
  }
  if (v === "party") refreshParty();
  renderParty();
  updateKaraokeClass();
  shownLine = -2;
}

function followedPlayerId(): string | null {
  return followQueueId;
}

async function cmd(command: string, args: Record<string, any>): Promise<void> {
  if (!client || !client.connected) return;
  try {
    await client.send(command, args);
  } catch (e: any) {
    toast(String((e && e.message) || e));
  }
}

let volTimer: any;
function showVolume(pid: string): void {
  const p = players.get(pid);
  if (!p) return;
  const isGroup = (p.group_members && p.group_members.length > 1) || p.type === "group";
  const v = isGroup && p.group_volume != null ? p.group_volume : p.volume_level;
  if (v == null) return;
  $("vol-name").textContent = p.display_name || p.name || "";
  ($("vol-bar").firstElementChild as HTMLElement).style.height = Math.max(0, Math.min(100, v)) + "%";
  $("vol-num").textContent = String(Math.round(v));
  $("vol").classList.add("on");
  clearTimeout(volTimer);
  volTimer = setTimeout(() => $("vol").classList.remove("on"), 2500);
}

function volumeStep(dir: 1 | -1): void {
  const pid = followedPlayerId();
  if (!pid) return;
  const p = players.get(pid);
  const isGroup = p && ((p.group_members && p.group_members.length > 1) || p.type === "group");
  const command = isGroup ? (dir > 0 ? "players/cmd/group_volume_up" : "players/cmd/group_volume_down") : dir > 0 ? "players/cmd/volume_up" : "players/cmd/volume_down";
  showVolume(pid);
  cmd(command, { player_id: pid });
}

// ------------------------------------------------------------------ overlays (player picker, settings)

interface Row {
  label: string;
  sub?: string;
  value?: string;
  checked?: boolean;
  onOk?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
}

let overlayRows: Row[] = [];
let overlaySel = 0;
let overlayKind: "" | "players" | "settings" = "";
let overlayBuild: () => Row[] = () => [];

function openOverlay(kind: "players" | "settings", title: string, build: () => Row[], foot = ""): void {
  overlayKind = kind;
  overlayBuild = build;
  overlaySel = 0;
  $("overlay-title").textContent = title;
  $("overlay-foot").textContent = foot;
  $("overlay").classList.remove("hidden");
  renderOverlay();
  const firstChecked = overlayRows.findIndex((r) => r.checked);
  if (firstChecked >= 0) overlaySel = firstChecked;
  renderOverlay();
}

function closeOverlay(): void {
  overlayKind = "";
  $("overlay").classList.add("hidden");
}

function renderOverlay(): void {
  overlayRows = overlayBuild();
  overlaySel = Math.max(0, Math.min(overlaySel, overlayRows.length - 1));
  const first = Math.max(0, Math.min(overlaySel - 3, overlayRows.length - 8));
  $("overlay-list").innerHTML = overlayRows
    .slice(first, first + 8)
    .map(
      (r, i) =>
        `<div class="row${first + i === overlaySel ? " sel" : ""}"><div><div>${esc(r.label)}</div>${r.sub ? `<div class="sub">${esc(r.sub)}</div>` : ""}</div>${
          r.value != null ? `<div class="val">${esc(r.value)}</div>` : ""
        }${r.checked ? '<div class="chk">✓</div>' : ""}</div>`,
    )
    .join("");
}

function playerRows(): Row[] {
  const rows: Row[] = [];
  const choose = (v: string) => () => {
    settings.follow = v;
    saveSettings();
    castSession = null;
    closeOverlay();
    resolveFollow();
  };
  rows.push({ label: "Automatic", sub: "Whatever is playing", checked: settings.follow === "auto", onOk: choose("auto") });
  if (settings.speakerEnabled) rows.push({ label: "This TV", sub: settings.speakerName, checked: settings.follow === "tv", onOk: choose("tv") });
  const own = tvPlayerId();
  const list = Array.from(queues.values())
    .filter((q) => {
      const p = players.get(q.queue_id);
      return q.available !== false && p && p.available && !p.hide_in_ui && p.enabled !== false && q.queue_id !== own;
    })
    .sort((a, b) => (a.state === "playing" ? 0 : 1) - (b.state === "playing" ? 0 : 1) || a.display_name.localeCompare(b.display_name));
  for (const q of list) {
    const state = q.state === "playing" ? "▶ " + itemTitle(q.current_item) : q.state === "paused" ? "Paused" : "";
    rows.push({ label: q.display_name, sub: state, checked: settings.follow === q.queue_id, onOk: choose(q.queue_id) });
  }
  return rows;
}

function settingsRows(): Row[] {
  const rows: Row[] = [
    {
      label: "Play music on this TV",
      sub: settings.speakerEnabled ? "Shows in Music Assistant as “" + settings.speakerName + "”: " + speaker.info() : "Off: the TV only shows what's playing",
      value: settings.speakerEnabled ? "On" : "Off",
      onOk: () => {
        settings.speakerEnabled = !settings.speakerEnabled;
        saveSettings();
        if (settings.speakerEnabled) speaker.start(settings.server);
        else speaker.stop();
        renderOverlay();
      },
    },
  ];
  if (settings.speakerEnabled) {
    const step = (d: number) => () => {
      speaker.setSyncDelay(settings.syncDelayMs + d);
      renderOverlay();
    };
    rows.push({
      label: "Sync delay",
      sub: "◀ ▶ to change. Raise it if the TV plays late compared to other speakers",
      value: settings.syncDelayMs + " ms",
      onLeft: step(-10),
      onRight: step(10),
      onOk: step(50),
    });
  }
  rows.push({
    label: "Lyrics",
    sub: "Synced lyrics when Music Assistant has them",
    value: settings.lyrics ? "On" : "Off",
    onOk: () => {
      settings.lyrics = !settings.lyrics;
      saveSettings();
      updateKaraokeClass();
      renderOverlay();
    },
  });
  rows.push({
    label: "Music Assistant",
    sub: (client && client.info ? (client.info.name || "Server") + " " + client.info.server_version + ", " : "") + settings.server,
    value: "Sign out",
    onOk: () => {
      settings.token = "";
      saveSettings();
      closeOverlay();
      speaker.stop();
      if (client) client.stop();
      client = null;
      showSetup();
    },
  });
  rows.push({ label: "Version", value: typeof APP_VERSION !== "undefined" ? APP_VERSION : "dev" });
  return rows;
}

// ------------------------------------------------------------------ setup (first run)

interface Focusable {
  el: HTMLElement;
  ok: () => void;
}
let setupFocus: Focusable[] = [];
let setupSel = 0;
let scanning = false;
let found: FoundServer[] = [];

function showSetup(msg = ""): void {
  $("setup").classList.remove("hidden");
  $("setup-msg").textContent = msg;
  if (settings.server && !settings.token) renderLogin();
  else renderServerStep();
}

function hideSetup(): void {
  $("setup").classList.add("hidden");
  setupFocus = [];
}

function setFocus(i: number): void {
  if (!setupFocus.length) return;
  setupSel = Math.max(0, Math.min(i, setupFocus.length - 1));
  setupFocus.forEach((f, j) => f.el.classList.toggle("sel", j === setupSel));
  const el = setupFocus[setupSel].el;
  if (el.tagName !== "INPUT") (document.activeElement as HTMLElement | null)?.blur?.();
}

function collectFocus(): void {
  setupFocus = [];
  document.querySelectorAll("#setup-body [data-f]").forEach((n) => {
    const el = n as HTMLElement;
    setupFocus.push({
      el,
      ok: () => {
        if (el.tagName === "INPUT") (el as HTMLInputElement).focus();
        else el.click();
      },
    });
  });
  setFocus(0);
}

function renderServerStep(): void {
  const list = found
    .map((s, i) => `<div class="row" data-f data-i="${i}"><div><div>${esc(s.info.name || "Music Assistant")}</div><div class="sub">${esc(s.url.replace(/^http:\/\//, ""))} · ${esc(s.info.server_version)}</div></div></div>`)
    .join("");
  $("setup-body").innerHTML = `<h1>Find Music Assistant</h1>
    <p>${scanning ? "Searching your network…" : found.length ? "Pick your Music Assistant server." : "Not found automatically. Type its address, for example 192.168.1.20."}</p>
    ${list}
    <input class="field" data-f id="srv" placeholder="Address, e.g. 192.168.1.20" value="${esc(settings.server.replace(/^http:\/\//, "").replace(/:8095$/, ""))}">
    <div class="btn primary" data-f id="srv-next">Continue</div><div class="btn" data-f id="srv-scan">Search again</div>`;
  document.querySelectorAll("#setup-body .row").forEach((r) =>
    r.addEventListener("click", () => {
      const s = found[Number((r as HTMLElement).dataset.i)];
      settings.server = s.url;
      saveSettings();
      renderLogin();
    }),
  );
  $("srv-next").addEventListener("click", () => {
    const v = normalizeServer(($("srv") as HTMLInputElement).value);
    if (!v) {
      $("setup-msg").textContent = "Type Music Assistant's address first.";
      return;
    }
    settings.server = v;
    saveSettings();
    renderLogin();
  });
  $("srv-scan").addEventListener("click", startScan);
  bindInputs();
  collectFocus();
  if (!scanning && !found.length && !(window as any).__scanned) startScan();
}

function startScan(): void {
  if (scanning) return;
  scanning = true;
  (window as any).__scanned = true;
  renderServerStep();
  scan(
    (s) => {
      found.push(s);
      if (!$("setup").classList.contains("hidden") && !document.getElementById("user")) renderServerStep();
    },
  ).then(() => {
    scanning = false;
    if (!$("setup").classList.contains("hidden") && !document.getElementById("user")) renderServerStep();
  });
}

function renderLogin(): void {
  $("setup-msg").textContent = "";
  $("setup-body").innerHTML = `<h1>Sign in</h1>
    <p>Use your Music Assistant username and password. The TV stays signed in.<br><span style="font-size:24px">${esc(settings.server)}</span></p>
    <input class="field" data-f id="user" placeholder="Username" autocapitalize="off" autocomplete="off">
    <input class="field" data-f id="pass" type="password" placeholder="Password">
    <div class="btn primary" data-f id="do-login">Sign in</div><div class="btn" data-f id="back">Other server</div>`;
  $("do-login").addEventListener("click", doLogin);
  $("back").addEventListener("click", () => {
    settings.server = "";
    saveSettings();
    renderServerStep();
  });
  bindInputs();
  collectFocus();
}

function bindInputs(): void {
  document.querySelectorAll("#setup-body input").forEach((n) => {
    const el = n as HTMLInputElement;
    el.addEventListener("keydown", (e) => {
      // the TV keyboard's Done (65376) / Cancel (65385), or Enter on a PC keyboard
      if (e.keyCode === 65376 || e.keyCode === 13 || e.keyCode === 65385) {
        e.preventDefault();
        e.stopPropagation();
        el.blur();
        setFocus(setupSel + 1);
      }
    });
  });
}

async function doLogin(): Promise<void> {
  const user = ($("user") as HTMLInputElement).value.trim();
  const pass = ($("pass") as HTMLInputElement).value;
  if (!user || !pass) {
    $("setup-msg").textContent = "Fill in your username and password.";
    return;
  }
  $("setup-msg").textContent = "Signing in…";
  try {
    settings.token = await login(settings.server, user, pass);
    saveSettings();
    $("setup-msg").textContent = "";
    hideSetup();
    connect();
  } catch (e: any) {
    $("setup-msg").textContent = String((e && e.message) || e);
  }
}

// ------------------------------------------------------------------ keys

const KEYS = [
  "MediaPlayPause", "MediaPlay", "MediaPause", "MediaStop", "MediaTrackNext", "MediaTrackPrevious",
  "MediaFastForward", "MediaRewind", "ColorF0Red", "ColorF1Green", "ColorF2Yellow", "ColorF3Blue",
];

function registerKeys(): void {
  try {
    tizen.tvinputdevice.registerKeyBatch(KEYS);
  } catch {
    try {
      for (const k of KEYS) tizen.tvinputdevice.registerKey(k);
    } catch {
      /* not on a TV */
    }
  }
}

function keyName(e: KeyboardEvent): string {
  switch (e.keyCode) {
    case 37: return "left";
    case 38: return "up";
    case 39: return "right";
    case 40: return "down";
    case 13: return "ok";
    case 10009: case 27: case 8: return "back";
    case 10252: case 415: case 19: case 32: return "playpause";
    case 413: return "stop";
    case 10233: case 417: return "next";
    case 10232: case 412: return "prev";
    case 403: case 82: return "red";      // R on a PC keyboard
    case 404: case 71: return "green";    // G
    case 405: case 89: return "yellow";   // Y
    case 406: case 66: return "blue";     // B
  }
  return "";
}

function onKey(e: KeyboardEvent): void {
  speaker.unlock();
  const k = keyName(e);
  const inSetup = !$("setup").classList.contains("hidden");
  if (inSetup) {
    const active = document.activeElement as HTMLElement | null;
    if (active && active.tagName === "INPUT" && k !== "up" && k !== "down" && k !== "back") return; // typing
    if (k === "down" || k === "right") setFocus(setupSel + 1);
    else if (k === "up" || k === "left") setFocus(setupSel - 1);
    else if (k === "ok") setupFocus[setupSel] && setupFocus[setupSel].ok();
    else if (k === "back" && active && active.tagName === "INPUT") active.blur();
    else if (k === "back") exitApp();
    if (k) e.preventDefault();
    return;
  }
  if (!k) return;
  e.preventDefault();
  if (overlayKind) {
    const r = overlayRows[overlaySel];
    if (k === "down") overlaySel++;
    else if (k === "up") overlaySel--;
    else if (k === "ok" && r && r.onOk) r.onOk();
    else if (k === "left" && r && r.onLeft) r.onLeft();
    else if (k === "right" && r && r.onRight) r.onRight();
    else if (k === "back" || (k === "red" && overlayKind === "players") || (k === "blue" && overlayKind === "settings")) {
      closeOverlay();
      return;
    }
    if (overlayKind) renderOverlay();
    return;
  }
  showHints();
  const qid = followQueueId;
  switch (k) {
    case "ok":
    case "playpause":
      if (qid) cmd("player_queues/play_pause", { queue_id: qid });
      break;
    case "stop":
      if (qid) cmd("player_queues/stop", { queue_id: qid });
      break;
    case "right":
    case "next":
      if (qid) cmd("player_queues/next", { queue_id: qid }).then(() => toast("Next"));
      break;
    case "left":
    case "prev":
      if (qid) cmd("player_queues/previous", { queue_id: qid }).then(() => toast("Previous"));
      break;
    case "up":
      volumeStep(1);
      break;
    case "down":
      volumeStep(-1);
      break;
    case "red":
      openOverlay("players", "Show which player", playerRows, "OK to choose · Back to close");
      break;
    case "green":
      settings.lyrics = !settings.lyrics;
      saveSettings();
      updateKaraokeClass();
      toast(settings.lyrics ? (lyricLines.length ? "Lyrics on" : "Lyrics on (none for this song)") : "Lyrics off");
      break;
    case "yellow":
      castSession = null;
      setView(currentView() === "party" ? "now" : "party");
      resolveFollow();
      break;
    case "blue":
      openOverlay("settings", "Settings", settingsRows, "◀ ▶ to adjust · OK to change · Back to close");
      break;
    case "back":
      // Back twice to leave, so a stray press doesn't close the app mid-song
      if (Date.now() - lastBack < 2500) exitApp();
      else toast("Press Back again to close");
      lastBack = Date.now();
      break;
  }
}

let lastBack = 0;

function exitApp(): void {
  speaker.stop();
  try {
    tizen.application.getCurrentApplication().exit();
  } catch {
    /* not on a TV */
  }
}

// ------------------------------------------------------------------ anti burn-in

const SHIFTS = ["translate(0,0)", "translate(-24px,14px)", "translate(20px,-12px)", "translate(-12px,-18px)", "translate(16px,18px)"];
let shiftIdx = 0;
setInterval(() => {
  shiftIdx = (shiftIdx + 1) % SHIFTS.length;
  ($("stage") as HTMLElement).style.transform = SHIFTS[shiftIdx];
}, 4 * 60 * 1000);

// ------------------------------------------------------------------ start

speaker.onChange = () => {
  if (overlayKind === "settings") renderOverlay();
  scheduleResolve();
};

document.addEventListener("keydown", onKey);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) speaker.stop();
  else if (settings.speakerEnabled && settings.server && settings.token) speaker.start(settings.server);
});
window.addEventListener("beforeunload", () => speaker.stop());

installAnalyserHook();
startVisualizer($("viz") as HTMLCanvasElement, () => {
  if (!speaker.playing || !followQueueId) return false;
  const q = queues.get(followQueueId);
  return !!q && q.state === "playing" && queueForPlayer(tvPlayerId()) === followQueueId;
});
(window as any).__matv = { speaker, settings, players, queues, guestMoment };
registerKeys();
setView(settings.view, false);
setInterval(tick, 100);
setInterval(() => { if (currentView() === "party") refreshParty(); }, 2 * 60 * 1000);
showHints();
connect();

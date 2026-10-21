// Settings kept on the TV.

export interface Settings {
  server: string; // http://host:8095
  token: string;
  follow: string; // "auto" | "tv" | a queue/player id
  speakerEnabled: boolean;
  speakerName: string;
  sendspinPort: number;
  syncDelayMs: number;
  lyrics: boolean;
  view: "now" | "party";
  dashboardId: string;
  buttons: Buttons;
  tvMuted: boolean; // visuals only: the TV joins playback silently, for the visualizer
  vizStyle: "bars" | "wave" | "ring" | "off";
  bgStyle: "liquid" | "simple";
}

/** What the configurable buttons do. Pairs (◀ ▶, ▲ ▼, channel rocker) take a pair action. */
export type PairAction = "skip" | "volume" | "seek" | "view" | "none";
export type SingleAction = "playpause" | "lyrics" | "party" | "player" | "menu" | "none";
export interface Buttons {
  preset: string;
  leftRight: PairAction;
  upDown: PairAction;
  channel: PairAction;
  channelPress: SingleAction;
}

export const BUTTON_PRESETS: { id: string; name: string; desc: string; buttons: Omit<Buttons, "preset"> }[] = [
  {
    id: "standard",
    name: "Standard",
    desc: "◀ ▶ skip, ▲ ▼ volume, channel switches party mode",
    buttons: { leftRight: "skip", upDown: "volume", channel: "view", channelPress: "lyrics" },
  },
  {
    id: "fixed",
    name: "Fixed volume",
    desc: "For speakers with their own volume: ◀ ▶ skip, ▲ ▼ party mode, channel seeks",
    buttons: { leftRight: "skip", upDown: "view", channel: "seek", channelPress: "lyrics" },
  },
  {
    id: "channel",
    name: "Channel skips",
    desc: "Channel rocker skips songs, ◀ ▶ seek, ▲ ▼ party mode",
    buttons: { leftRight: "seek", upDown: "view", channel: "skip", channelPress: "playpause" },
  },
];

const KEY = "ma-tv-settings";

function defaults(): Settings {
  return {
    server: "",
    token: "",
    follow: "auto",
    speakerEnabled: true,
    speakerName: "Samsung TV",
    sendspinPort: 8927,
    syncDelayMs: 0,
    lyrics: true,
    view: "now",
    dashboardId: "tv-" + Math.random().toString(36).slice(2, 10),
    buttons: Object.assign({ preset: "standard" }, BUTTON_PRESETS[0].buttons),
    tvMuted: false,
    vizStyle: "bars",
    bgStyle: "liquid",
  };
}

export const settings: Settings = (() => {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return Object.assign(d, JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return d;
})();

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

saveSettings(); // keeps the generated dashboard id stable

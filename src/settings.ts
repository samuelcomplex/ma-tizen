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
}

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

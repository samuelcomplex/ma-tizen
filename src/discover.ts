// Finds Music Assistant on the local network by asking every address in the TV's /24 subnet.
// Tizen web apps have no mDNS, so this opens a websocket to port 8095 on each address; Music
// Assistant answers a new connection with its server info straight away.

import { probe, ServerInfo } from "./api";

declare const tizen: any;

export interface FoundServer {
  url: string;
  info: ServerInfo;
}

function getProperty(name: string): Promise<any> {
  return new Promise((resolve) => {
    try {
      tizen.systeminfo.getPropertyValue(name, (v: any) => resolve(v), () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

/** The TV's own IPv4 address, or null when it can't be read (e.g. in a desktop browser). */
export async function localAddress(): Promise<string | null> {
  try {
    const ip = (window as any).webapis.network.getIp();
    if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip) && ip !== "0.0.0.0") return ip;
  } catch {
    /* Samsung product API not available */
  }
  if (typeof tizen === "undefined") return null;
  for (const prop of ["ETHERNET_NETWORK", "WIFI_NETWORK"]) {
    const v = await getProperty(prop);
    if (v && v.ipAddress && /^\d+\.\d+\.\d+\.\d+$/.test(v.ipAddress) && v.ipAddress !== "0.0.0.0") {
      return v.ipAddress;
    }
  }
  return null;
}

/** Scans the subnet; calls onFound for each server as it answers. Resolves when done. */
export async function scan(
  onFound: (s: FoundServer) => void,
  opts: { base?: string; port?: number; concurrency?: number } = {},
): Promise<FoundServer[]> {
  const ip = opts.base || (await localAddress());
  const port = opts.port || 8095;
  const found: FoundServer[] = [];
  const seen = new Set<string>();
  const candidates: string[] = [];
  if (ip) {
    const prefix = ip.split(".").slice(0, 3).join(".");
    for (let i = 1; i < 255; i++) {
      const a = `${prefix}.${i}`;
      if (a !== ip) candidates.push(a);
    }
  }
  // Names that resolve on many home networks.
  candidates.push("homeassistant.local", "music-assistant.local", "homeassistant");
  let next = 0;
  const worker = async () => {
    while (next < candidates.length) {
      const host = candidates[next++];
      const url = `http://${host}:${port}`;
      const info = await probe(url, 1500);
      if (info && !seen.has(info.server_id)) {
        seen.add(info.server_id);
        const s = { url, info };
        found.push(s);
        onFound(s);
      }
    }
  };
  const n = opts.concurrency || 24;
  await Promise.all(Array.from({ length: n }, worker));
  return found;
}

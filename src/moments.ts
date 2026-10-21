// Drop moments and dance-offs, from the TV speaker's audio analysis.
//
// A drop: the music goes quiet for a few seconds (a build or break) and then the bass comes
// back in hard. A dance-off: a dance-tempo song (from Music Assistant's BPM when it has one,
// otherwise from the beats we hear) that has kept its energy up for a while.

import { AudioFrame } from "./audio";

export interface MomentEvents {
  drop(): void;
  danceOff(bpm: number): void;
}

export class Moments {
  private fast = 0; // ~0.5 s level
  private slow = 0; // ~4 s level
  private long = 0; // ~30 s level
  private lastDrop = 0;
  private lastDance = 0;
  private quietSince = 0;
  private beats: number[] = [];
  private lastBeatSeen = 0;
  private energeticSince = 0;
  private lastFrame = 0;
  songBpm: number | null = null;
  songStartedAt = 0;

  constructor(private on: MomentEvents) {}

  newSong(bpm: number | null): void {
    this.songBpm = bpm && bpm > 40 && bpm < 220 ? bpm : null;
    this.songStartedAt = performance.now();
    this.beats = [];
    this.energeticSince = 0;
  }

  /** Tempo from the last beats, folded into 80-160 BPM. */
  tempo(): number | null {
    if (this.songBpm) return this.songBpm;
    if (this.beats.length < 8) return null;
    const iv: number[] = [];
    for (let i = 1; i < this.beats.length; i++) iv.push(this.beats[i] - this.beats[i - 1]);
    iv.sort((a, b) => a - b);
    let bpm = 60000 / iv[Math.floor(iv.length / 2)];
    while (bpm < 80) bpm *= 2;
    while (bpm > 160) bpm /= 2;
    return bpm;
  }

  feed(a: AudioFrame, now: number, drops: boolean, dance: boolean): void {
    const dt = this.lastFrame ? Math.min(100, now - this.lastFrame) : 16;
    this.lastFrame = now;
    if (!a.active) {
      this.fast *= 0.95;
      return;
    }
    const k = (tau: number) => 1 - Math.exp(-dt / tau);
    this.fast += (a.level - this.fast) * k(500);
    this.slow += (a.level - this.slow) * k(4000);
    this.long += (a.level - this.long) * k(30000);
    if (a.beat > 0.99 && now - this.lastBeatSeen > 200) {
      this.lastBeatSeen = now;
      this.beats.push(now);
      if (this.beats.length > 24) this.beats.shift();
    }
    // drop: at least 3 s clearly below the song's usual level, then a hard bass return
    if (this.fast < this.long * 0.55) {
      if (!this.quietSince) this.quietSince = now;
    } else if (this.quietSince && now - this.quietSince > 3000 && a.bass > 0.45 && this.fast > this.long * 0.95) {
      this.quietSince = 0;
      if (drops && now - this.lastDrop > 45000 && now - this.songStartedAt > 15000) {
        this.lastDrop = now;
        this.on.drop();
      }
    } else if (this.fast >= this.long * 0.55) this.quietSince = 0;

    // dance-off: dance tempo, steady energy for 25 s, at most every 15 min
    const bpm = this.tempo();
    const danceable = bpm !== null && bpm >= 108 && bpm <= 135 && this.slow > 0.28;
    if (danceable) {
      if (!this.energeticSince) this.energeticSince = now;
      if (dance && now - this.energeticSince > 25000 && now - this.lastDance > 15 * 60000 && now - this.songStartedAt > 30000) {
        this.lastDance = now;
        this.on.danceOff(bpm!);
      }
    } else this.energeticSince = 0;
  }

  /** Lets a dance-off started from the menu reset the cooldown. */
  markDance(): void {
    this.lastDance = performance.now();
  }
}

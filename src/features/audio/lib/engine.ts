import type { SoundId } from "../model/catalog";
import { allSoundIds, soundCatalog, soundUrl } from "../model/catalog";

export type AudioChannel = "live" | "transport" | "preview";

export interface ScheduledCue {
  sound: SoundId;
  /** Seconds relative to the shared scheduling origin. */
  at: number;
  gain?: number;
  pan?: number;
}

export interface MissingAsset {
  id: SoundId;
  label: string;
  reason: string;
}

const clampPan = (p: number) => Math.max(-0.85, Math.min(0.85, p));

/** Rejects HTML error pages and truncated downloads before they reach the decoder. */
function looksLikeAudio(bytes: ArrayBuffer) {
  if (bytes.byteLength < 64) return false;
  const head = new Uint8Array(bytes, 0, 12);
  // RIFF....WAVE
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46)
    return true;
  // ID3 tag or MPEG frame sync
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return true;
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return true;
  // OggS
  if (head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53)
    return true;
  return false;
}

/**
 * Thin wrapper over Web Audio with three independent cancellation channels.
 *
 * Assets are fetched up front but only decoded after the first user gesture,
 * which is also when the AudioContext is created — this keeps browsers with
 * strict autoplay policies happy. Every source is scheduled against one
 * AudioContext clock, so live commands and archived replay share exactly the
 * same cue timing. Stopping a channel hard-stops already-scheduled sources,
 * which keeps a paused or reset battle from leaking sound into the next one.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private raw = new Map<SoundId, ArrayBuffer>();
  private buffers = new Map<SoundId, AudioBuffer>();
  private channels = new Map<AudioChannel, Set<AudioBufferSourceNode>>();
  private fetchPromise: Promise<MissingAsset[]> | null = null;
  private decodePromise: Promise<MissingAsset[]> | null = null;
  private missing: MissingAsset[] = [];
  private fetched = false;
  private volume = 0.8;

  get state(): AudioContextState | "uninitialized" {
    return this.ctx?.state ?? "uninitialized";
  }

  get isReady() {
    return !!this.ctx && this.ctx.state === "running";
  }

  get loadedCount() {
    return this.buffers.size;
  }

  get missingAssets() {
    return this.missing;
  }

  get fetchedCount() {
    return this.raw.size;
  }

  get total() {
    return allSoundIds.length;
  }

  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume ** 2, this.ctx.currentTime, 0.02);
    }
  }

  /** Downloads every asset and reports anything missing or obviously corrupt. */
  preload(): Promise<MissingAsset[]> {
    if (this.fetchPromise) return this.fetchPromise;
    this.fetchPromise = (async () => {
      const failures: MissingAsset[] = [];
      await Promise.all(
        allSoundIds.map(async (id) => {
          if (this.raw.has(id)) return;
          try {
            const res = await fetch(soundUrl(id), { cache: "no-cache" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const bytes = await res.arrayBuffer();
            if (!looksLikeAudio(bytes)) throw new Error("文件格式损坏");
            this.raw.set(id, bytes);
          } catch (error) {
            failures.push({
              id,
              label: soundCatalog[id].label,
              reason: (error as Error).message || "无法读取",
            });
          }
        }),
      );
      this.missing = failures;
      this.fetched = true;
      return failures;
    })();
    return this.fetchPromise;
  }

  /** Creates/resumes the AudioContext. Must run inside a user gesture. */
  async unlock(): Promise<boolean> {
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) return false;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume ** 2;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state !== "running") await this.ctx.resume();
      return this.ctx.state === "running";
    } catch {
      return false;
    }
  }

  /** Decodes fetched bytes; per-file failures become entries in the missing list. */
  decode(): Promise<MissingAsset[]> {
    if (this.decodePromise) return this.decodePromise;
    this.decodePromise = (async () => {
      await this.preload();
      const ctx = this.ctx;
      const failures: MissingAsset[] = [];
      if (!ctx) {
        // Do not cache this outcome: a later user gesture may create the context.
        this.decodePromise = null;
        this.missing = allSoundIds
          .filter((id) => !this.buffers.has(id))
          .map((id) => ({
            id,
            label: soundCatalog[id].label,
            reason: "音频上下文不可用",
          }));
        return this.missing;
      }
      await Promise.all(
        allSoundIds.map(async (id) => {
          if (this.buffers.has(id)) return;
          const bytes = this.raw.get(id);
          if (!bytes) return; // already recorded by preload
          try {
            const buffer = await ctx.decodeAudioData(bytes.slice(0));
            if (!buffer.length) throw new Error("音频长度为 0");
            this.buffers.set(id, buffer);
          } catch (error) {
            failures.push({
              id,
              label: soundCatalog[id].label,
              reason: (error as Error).message || "无法解码",
            });
          }
        }),
      );
      const seen = new Set(this.missing.map((m) => m.id));
      this.missing = [
        ...this.missing.filter((m) => !this.buffers.has(m.id)),
        ...failures.filter((f) => !seen.has(f.id)),
      ];
      return this.missing;
    })();
    return this.decodePromise;
  }

  /** Convenience: preload → unlock → decode. */
  async start(): Promise<MissingAsset[]> {
    const unlocked = await this.unlock();
    const missing = await this.decode();
    if (!unlocked) throw new Error("音频无法启动");
    return missing;
  }

  has(id: SoundId) {
    return this.buffers.has(id);
  }

  duration(id: SoundId) {
    return this.buffers.get(id)?.duration ?? 0;
  }

  missingReason(id: SoundId) {
    return this.missing.find((m) => m.id === id)?.reason ?? (this.fetched && !this.raw.has(id) ? "未获取" : undefined);
  }

  /** The same clock every cue is scheduled against. */
  now() {
    return this.ctx?.currentTime ?? performance.now() / 1000;
  }

  /**
   * Schedules a batch of cues for one channel. Skips any damaged asset.
   * Returns the shared origin (in AudioContext seconds) so callers can align
   * UI transitions with the audio clock instead of a separate timer.
   */
  schedule(channel: AudioChannel, cues: ScheduledCue[], lead = 0.06): number | null {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || ctx.state !== "running") return null;
    const origin = ctx.currentTime + lead;
    const set = this.channels.get(channel) ?? new Set<AudioBufferSourceNode>();
    this.channels.set(channel, set);
    for (const cue of cues) {
      const buffer = this.buffers.get(cue.sound);
      if (!buffer) continue;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = soundCatalog[cue.sound].gain * (cue.gain ?? 1);
      let tail: AudioNode = gain;
      if (typeof ctx.createStereoPanner === "function") {
        const panner = ctx.createStereoPanner();
        panner.pan.value = clampPan(cue.pan ?? 0);
        gain.connect(panner);
        tail = panner;
      }
      source.connect(gain);
      tail.connect(master);
      source.onended = () => {
        set.delete(source);
        source.disconnect();
        gain.disconnect();
        if (tail !== gain) tail.disconnect();
      };
      source.start(origin + Math.max(0, cue.at));
      set.add(source);
    }
    return origin;
  }

  /** Plays one cue immediately for offset auditioning. */
  preview(sound: SoundId, gain = 1, pan = 0) {
    this.schedule("preview", [{ sound, at: 0, gain, pan }], 0.02);
  }

  /** Hard-stops every scheduled source on a channel, cancelling future cues. */
  stopChannel(channel: AudioChannel) {
    const set = this.channels.get(channel);
    if (!set) return;
    for (const source of set) {
      try {
        source.stop();
      } catch {
        // already ended
      }
      try {
        source.disconnect();
      } catch {
        // ignore
      }
    }
    set.clear();
  }

  stopAll() {
    for (const channel of this.channels.keys()) this.stopChannel(channel);
  }
}

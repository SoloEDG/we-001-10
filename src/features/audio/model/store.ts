import { computed, reactive, ref } from "vue";
import type { BattleEvent, Point } from "../../../shared/types";
import type { SoundCue, CueOffsets } from "../model/cues";
import { composeCues, focusOf, panFor } from "../model/cues";
import type { SoundId } from "../model/catalog";
import type { AudioChannel, MissingAsset } from "../lib/engine";
import { SoundEngine } from "../lib/engine";

const OFFSET_STORE = "we001-audio-offsets";
const VOLUME_STORE = "we001-audio-volume";
export const STEP_INTERVAL = 0.19;

function loadOffsets(): CueOffsets {
  try {
    const raw = JSON.parse(localStorage.getItem(OFFSET_STORE) ?? "{}");
    if (!raw || typeof raw !== "object") return {};
    const clean: CueOffsets = {};
    for (const [k, v] of Object.entries(raw))
      if (typeof v === "number" && Number.isFinite(v))
        clean[k] = Math.max(-900, Math.min(900, v));
    return clean;
  } catch {
    return {};
  }
}

const engine = new SoundEngine();
const started = ref(false);
const preloading = ref(true);
const decoded = ref(0);
const total = engine.total;
const missing = ref<MissingAsset[]>([]);
const volume = ref(Number(localStorage.getItem(VOLUME_STORE) ?? 0.8));
const offsets = reactive<CueOffsets>(loadOffsets());
const contextBlocked = ref(false);
const playing = ref(false);
const lastVolume = ref(volume.value || 0.8);
let starting: Promise<boolean> | null = null;
let generation = 0;
let timers: number[] = [];
let frame = 0;

engine.setVolume(volume.value);
void engine.preload().finally(() => {
  preloading.value = false;
  missing.value = engine.missingAssets;
});

/**
 * Called from a real user gesture. Assets are already fetched; this is where
 * the AudioContext may be created and the bytes decoded.
 */
async function enable(): Promise<boolean> {
  if (started.value && engine.isReady) return true;
  if (starting) return starting;
  starting = doEnable();
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

async function doEnable(): Promise<boolean> {
  const ok = await engine.unlock();
  const assets = await engine.decode();
  missing.value = [...assets];
  decoded.value = engine.loadedCount;
  preloading.value = false;
  contextBlocked.value = !ok;
  if (!ok) {
    // Surfacing the real cause matters: with a blocked context every asset
    // would otherwise look "corrupt".
    const reason = engine.state === "suspended" ? "浏览器拦截了音频上下文" : "音频上下文不可用";
    missing.value = assets.map((a) =>
      a.reason === "音频上下文不可用" ? { ...a, reason } : a,
    );
    return false;
  }
  started.value = true;
  return true;
}

function clearTimers() {
  for (const id of timers) window.clearTimeout(id);
  timers = [];
  if (frame) window.cancelAnimationFrame(frame);
  frame = 0;
}

function isReady() {
  return started.value && engine.isReady;
}

/**
 * Runs audio work from inside a click handler: the click doubles as the user
 * gesture browsers require, so the very first live action is audible without
 * a separate "start" button press.
 */
function whenReady(task: () => void) {
  if (isReady()) {
    task();
    return;
  }
  void enable().then((ok) => {
    if (ok) task();
  });
}

const cueToScheduled = (c: SoundCue) => ({
  sound: c.sound,
  at: c.at,
  gain: c.gain,
  pan: c.pan,
});

function playCues(channel: AudioChannel, cues: SoundCue[], reset: boolean) {
  if (!isReady()) return false;
  if (reset) engine.stopChannel(channel);
  engine.schedule(channel, cues.map(cueToScheduled));
  return true;
}

/**
 * One recorded step, played as it happens. Live commands pass the event they
 * just produced; replay passes the same historical event. Same composer and
 * same offsets means the two tracks cannot diverge. Live steps layer onto the
 * live channel without cutting each other, so a quick follow-up command never
 * truncates the footsteps already playing; pause/reset cut them explicitly.
 */
function playStep(event: BattleEvent) {
  const cues = composeCues(event, offsets, STEP_INTERVAL);
  if (!isReady()) {
    whenReady(() => engine.schedule("live", cues.map(cueToScheduled)));
    return false;
  }
  return playCues("live", cues, false);
}

function stopLive() {
  engine.stopChannel("live");
}

/** Plays every phase of one step on the preview channel. */
function previewStep(event: BattleEvent) {
  stopTransport();
  const cues = composeCues(event, offsets, STEP_INTERVAL);
  if (!isReady()) {
    whenReady(() => {
      engine.stopChannel("preview");
      engine.schedule("preview", cues.map(cueToScheduled), 0.05);
    });
    return false;
  }
  return playCues("preview", cues, true);
}

function stopPreview() {
  engine.stopChannel("preview");
}

function stopTransport() {
  generation++;
  clearTimers();
  playing.value = false;
  engine.stopChannel("transport");
}

/**
 * Schedules the remaining archive from the recorded event timestamps, not from
 * UI clicks. Every cue is placed against one shared origin, so auto-play and
 * manual seeking produce musically identical results; the UI merely follows
 * the callback for each step.
 */
function startTransport(
  sessionEvents: BattleEvent[],
  from: number,
  onCursor: (cursor: number) => void,
  opts: { speed?: number; intro?: number } = {},
): boolean {
  stopTransport();
  const end = sessionEvents.length;
  if (!isReady() || from >= end) {
    onCursor(Math.max(0, Math.min(from, end)));
    return false;
  }
  const token = generation;
  playing.value = true;
  const lead = 0.08;
  const speed = Math.max(0.25, Math.min(4, opts.speed ?? 1));
  const cues: Array<{ at: number; cue: SoundCue }> = [];
  // Each entry is the moment (seconds from the shared origin) that step i+1
  // becomes current. The audio scheduler and the cursor share this table.
  const stepTimes: Array<{ at: number; cursor: number }> = [];
  let t = opts.intro ?? 0.15;
  for (let i = from; i < end; i++) {
    const event = sessionEvents[i];
    if (i > from) t += eventGap(sessionEvents[i - 1], event, speed);
    for (const cue of composeCues(event, offsets, STEP_INTERVAL))
      cues.push({ at: t + cue.at, cue });
    stepTimes.push({ at: t, cursor: i + 1 });
  }
  const tail = t + eventDuration(sessionEvents[end - 1]) / speed;
  const origin = engine.schedule(
    "transport",
    cues.map(({ at, cue }) => ({
      sound: cue.sound,
      at,
      gain: cue.gain,
      pan: cue.pan,
    })),
    lead,
  );
  if (origin == null) return false;

  // Drive the UI from the AudioContext clock, not a parallel timer: the map
  // marker advances on exactly the same tick as the sound it describes.
  let index = 0;
  const fallbackStart = window.performance?.now?.() ?? Date.now();
  const tick = () => {
    if (token !== generation) return;
    // Fall back to wall time if the audio clock is frozen (suspended context).
    const elapsed = Math.max(
      engine.now() - origin,
      ((window.performance?.now?.() ?? Date.now()) - fallbackStart) / 1000 -
        lead,
    );
    while (index < stepTimes.length && elapsed >= stepTimes[index].at - 1e-4) {
      onCursor(stepTimes[index].cursor);
      index++;
    }
    if (index >= stepTimes.length && elapsed >= tail) {
      playing.value = false;
      clearTimers();
      return;
    }
    frame = window.requestAnimationFrame(tick);
  };
  frame = window.requestAnimationFrame(tick);
  return true;
}

/** Gap between consecutive historical events, scaled to playback speed. */
export function eventGap(prev: BattleEvent, next: BattleEvent, speed = 1) {
  let gap = Math.max(0.55, Math.min(eventDuration(prev), 1.1));
  if (prev.at != null && next.at != null) {
    const delta = (next.at - prev.at) / 1000;
    if (delta > 0.2) gap = Math.min(4, Math.max(0.85, delta));
  }
  // Historical distance wins when it is longer; otherwise the step's own
  // choreography decides, so a rapid sequence still reads as separate steps.
  return gap / Math.max(0.25, speed);
}

export function eventDuration(event: BattleEvent, map: CueOffsets = offsets) {
  const cues = composeCues(event, map, STEP_INTERVAL);
  const tail = cues.reduce((max, c) => {
    const duration = engine.duration(c.sound) || 0.9;
    return Math.max(max, c.at + duration);
  }, 0);
  return Math.max(0.55, tail + 0.3);
}

function audition(cue: SoundCue) {
  if (!isReady()) {
    whenReady(() => audition(cue));
    return false;
  }
  stopPreview();
  engine.preview(cue.sound, cue.gain, cue.pan);
  return true;
}

/** Audition a whole step with its current offsets. */
function auditionStep(event: BattleEvent) {
  const cues = composeCues(event, offsets, STEP_INTERVAL);
  if (!isReady()) {
    whenReady(() => {
      stopPreview();
      engine.schedule("preview", cues.map(cueToScheduled), 0.05);
    });
    return false;
  }
  stopPreview();
  engine.schedule("preview", cues.map(cueToScheduled), 0.05);
  return true;
}

function setOffset(key: string, ms: number) {
  const value = Math.max(-900, Math.min(900, Math.round(ms)));
  if (value === 0) delete offsets[key];
  else offsets[key] = value;
  localStorage.setItem(OFFSET_STORE, JSON.stringify(offsets));
}

function resetOffsets() {
  for (const key of Object.keys(offsets)) delete offsets[key];
  localStorage.setItem(OFFSET_STORE, "{}");
}

function setVolume(value: number) {
  const next = Number.isFinite(value) ? value : 0;
  volume.value = Math.max(0, Math.min(1, next));
  if (volume.value > 0) lastVolume.value = volume.value;
  localStorage.setItem(VOLUME_STORE, String(volume.value));
  engine.setVolume(volume.value);
}

function mute() {
  setVolume(volume.value > 0 ? 0 : lastVolume.value);
}

/** Stops every channel and every pending UI callback. */
function stopAll() {
  generation++;
  clearTimers();
  playing.value = false;
  engine.stopAll();
}

function missingFor(sound: SoundId) {
  return engine.missingReason(sound);
}

const ready = computed(() => started.value && !preloading.value);

export function useAudio() {
  return {
    started,
    ready,
    preloading,
    decoded,
    total,
    missing,
    volume,
    offsets,
    playing,
    contextBlocked,
    enable,
    playStep,
    previewStep,
    stopPreview,
    stopLive,
    startTransport,
    stopTransport,
    stopAll,
    audition,
    auditionStep,
    setOffset,
    resetOffsets,
    setVolume,
    mute,
    compose: (event: BattleEvent) => composeCues(event, offsets, STEP_INTERVAL),
    focusOf,
    panFor,
    eventDuration,
    missingFor,
  };
}

export function audioFocus(events: BattleEvent[], cursor: number): Point | null {
  if (cursor <= 0) return null;
  const event = events[Math.min(cursor, events.length) - 1];
  return event ? focusOf(event) : null;
}

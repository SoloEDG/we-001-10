import { onUnmounted } from "vue";
import type { BattleEvent } from "../../../shared/types";
import { useAudio, eventGap } from "../../audio/model/store";

/**
 * Transport for the archive. It owns no timing of its own: the audio scheduler
 * places every cue against the recorded event clock and reports each step as
 * it becomes current, so auto-play and manual seeking produce the same track.
 *
 * The play button is itself the user gesture that unlocks audio on first use.
 * If unlocking fails, a silent timer walks the archive in the same order using
 * the same historical gaps.
 */
export function usePlayback(
  events: () => BattleEvent[],
  setCursor: (cursor: number) => void,
) {
  const audio = useAudio();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = undefined;
  }

  function stop() {
    clearTimer();
    // Release every scheduled voice on pause, including any live tail, so
    // nothing from this run bleeds into the next playback or a new battle.
    audio.stopTransport();
    audio.stopPreview();
    audio.stopLive();
    if (audio.playing.value) audio.playing.value = false;
  }

  async function play(start: number, speed = 1) {
    stop();
    const list = events();
    // Pressing play after the last step restarts the archive.
    const from =
      start >= list.length ? 0 : Math.max(0, Math.min(start, list.length));
    setCursor(from);
    if (!list.length) return;
    if (!audio.started.value) {
      const ok = await audio.enable();
      if (!ok) {
        silentWalk(list, from, speed);
        return;
      }
    }
    if (!audio.startTransport(list, from, setCursor, { speed }))
      silentWalk(list, from, speed);
  }

  /** Silent fallback: the same order and the same recorded gaps. */
  function silentWalk(list: BattleEvent[], from: number, speed: number) {
    if (from >= list.length) {
      setCursor(list.length);
      audio.playing.value = false;
      return;
    }
    audio.playing.value = true;
    let i = from;
    const schedule = (delay: number) => {
      timer = setTimeout(() => {
        if (i >= list.length) {
          audio.playing.value = false;
          return;
        }
        i++;
        setCursor(i);
        if (i >= list.length) {
          audio.playing.value = false;
          return;
        }
        schedule(eventGap(list[i - 1], list[i], speed) * 1000);
      }, delay);
    };
    schedule(
      from === 0
        ? 700
        : eventGap(list[from - 1], list[from], speed) * 1000,
    );
  }

  onUnmounted(stop);
  return { playing: audio.playing, play, stop };
}

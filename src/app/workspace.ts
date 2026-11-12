import { computed, reactive, ref } from "vue";
import type { Point, Terrain } from "../shared/types";
import { clone, findUnit, key } from "../shared/document";
import { reachable, terrainRules, paintTile } from "../features/terrain";
import { moveBudget, armorValue, tickStatuses } from "../features/roster";
import {
  getSkill,
  legalTargets,
  moveUnit,
  castSkill,
} from "../features/tactics";
import { finishTurn } from "../features/initiative";
import {
  record,
  frame,
  loadArchive,
  saveArchive,
  usePlayback,
} from "../features/replay";
import { useAudio, audioFocus } from "../features/audio";
import { newSession } from "./session";

export function useWorkspace() {
  const session = reactive(loadArchive() ?? newSession());
  const cursor = ref(-1),
    selected = ref(session.live.active),
    skill = ref(""),
    brush = ref<Terrain | null>(null),
    notice = ref("选择蓝色格移动，或选择技能指定目标。");
  const audio = useAudio();
  const playback = usePlayback(
    () => session.events,
    (n) => {
      cursor.value = n;
    },
  );
  const battle = computed(() => frame(session, cursor.value));
  const actor = computed(() => findUnit(battle.value, battle.value.active));
  const locked = computed(() => cursor.value >= 0 || !!session.live.ended);
  const routes = computed(() =>
    locked.value || actor.value.moved || actor.value.acted
      ? new Map()
      : reachable(session.live, actor.value, moveBudget(actor.value)),
  );
  const targets = computed(() => {
    const s = getSkill(actor.value.job, skill.value);
    return s ? legalTargets(battle.value, actor.value, s) : [];
  });
  /** Map marker and pan source for the step currently displayed. */
  const focus = computed(() => audioFocus(session.events, cursor.value));
  const currentEvent = computed(() =>
    cursor.value > 0 ? (session.events[cursor.value - 1] ?? null) : null,
  );
  /** In live play the panel follows the newest action so cues stay tunable. */
  const audioEvent = computed(
    () => currentEvent.value ?? (cursor.value < 0 ? session.events.at(-1) ?? null : null),
  );

  function cell(p: Point) {
    try {
      if (locked.value) throw new Error("回放只读，请返回实战");
      const before = clone(session.live),
        u = actor.value;
      let event;
      if (brush.value) {
        paintTile(session.live, p, brush.value);
        event = record(
          session,
          before,
          "terrain",
          `地形调整为${terrainRules[brush.value].name}`,
          { path: [p], focus: p, meta: { terrain: brush.value } },
        );
      } else if (skill.value) {
        const s = getSkill(u.job, skill.value)!;
        const t = session.live.units.find((t) => t.hp > 0 && key(t) === key(p));
        if (!t) throw new Error("请点击合法角色");
        const ground = session.live.tiles.find((v) => key(v) === key(t))!;
        const high =
          session.live.tiles.find((v) => key(v) === key(u))!.terrain ===
          "ridge";
        const value = castSkill(
          session.live,
          u.id,
          t.id,
          s,
          armorValue(t),
          terrainRules[ground.terrain].cover,
          high,
        );
        event = record(
          session,
          before,
          "skill",
          `${u.name} → ${t.name} · ${s.name} ${value}`,
          {
            focus: { x: t.x, y: t.y },
            meta: {
              skillId: s.id,
              skillName: s.name,
              targetId: t.id,
              targetName: t.name,
              value,
              status: s.status,
              elevated: high,
              armor: armorValue(t),
            },
          },
        );
        skill.value = "";
      } else {
        const route = routes.value.get(key(p));
        if (!route?.path.length)
          throw new Error("此格不可达，请检查地形与占位");
        moveUnit(session.live, u.id, route.path);
        event = record(
          session,
          before,
          "move",
          `${u.name}移动 · 消耗${route.cost}`,
          { path: route.path, focus: route.path.at(-1) ?? null },
        );
      }
      // Live sound is derived from the same recorded event replay will use.
      audio.playStep(event);
      saveArchive(session);
      notice.value = session.events.at(-1)!.label;
    } catch (e) {
      notice.value = (e as Error).message;
    }
  }

  function wait() {
    if (locked.value) return;
    const before = clone(session.live);
    const ending = findUnit(before, before.active);
    finishTurn(session.live, tickStatuses);
    const event = record(session, before, "wait", `${ending.name}结束行动`, {
      focus: { x: ending.x, y: ending.y },
    });
    audio.playStep(event);
    selected.value = session.live.active;
    skill.value = "";
    saveArchive(session);
    notice.value = session.events.at(-1)!.label;
  }

  /**
   * Scrubbing is silent and cancels everything already scheduled. Dragging the
   * slider repeatedly therefore never stacks old voices.
   */
  function scrub(n: number) {
    audio.stopTransport();
    audio.stopPreview();
    audio.stopLive();
    cursor.value = Math.max(-1, Math.min(n, session.events.length));
    skill.value = "";
    brush.value = null;
  }

  /**
   * Landing on a step: audition exactly that step once, from its own start.
   * Same composer the live commands and auto-play use, so the offset applied
   * to one cue is heard identically in every context.
   */
  function seek(n: number) {
    scrub(n);
    const event = currentEvent.value;
    if (event) {
      audio.previewStep(event);
      notice.value = event.label;
    } else {
      notice.value = cursor.value === 0 ? "已回到战斗开始" : "已返回实战";
    }
  }

  function reset() {
    // A fresh deployment must never inherit the previous battle's schedule:
    // cancel every pending callback and every scheduled voice first.
    audio.stopAll();
    playback.stop();
    cursor.value = -1;
    Object.assign(session, newSession());
    selected.value = session.live.active;
    skill.value = "";
    brush.value = null;
    saveArchive(session);
    notice.value = "新战斗已就绪";
  }

  const path = computed(() =>
    cursor.value > 0 ? (session.events[cursor.value - 1]?.path ?? []) : [],
  );
  return {
    session,
    cursor,
    selected,
    skill,
    brush,
    notice,
    battle,
    actor,
    locked,
    routes,
    targets,
    path,
    focus,
    currentEvent,
    audioEvent,
    playback,
    audio,
    cell,
    wait,
    scrub,
    seek,
    reset,
  };
}

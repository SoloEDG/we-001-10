import type { Battle, BattleEvent, EventKind, Point, Terrain, Unit } from "../../../shared/types";
import { key } from "../../../shared/document";
import type { SoundId } from "./catalog";
import { stepSound, castSound } from "./catalog";
import type { Profession } from "../../../shared/types";

export type CueRole =
  | "step"
  | "cast"
  | "impact"
  | "heal"
  | "status"
  | "turn"
  | "paint"
  | "victory";

export interface SoundCue {
  /** Stable identity for the offset editor: kind + role + sound. */
  key: string;
  sound: SoundId;
  role: CueRole;
  label: string;
  /** Seconds from the start of the event's own choreography. */
  baseAt: number;
  /** baseAt plus the user's stored offset. */
  at: number;
  offsetMs: number;
  /** -1..1 stereo position derived from the map cell actually touched. */
  pan: number;
  /** Optional multiplier on top of the catalog gain. */
  gain: number;
  step?: number;
}

export interface CueOffsets {
  [key: string]: number;
}

export const cueKey = (kind: EventKind, role: CueRole, sound: SoundId) =>
  `${kind}:${role}:${sound}`;

const TILE_W = 12;
export const panFor = (p: Point | null | undefined) =>
  p ? Math.max(-0.78, Math.min(0.78, (p.x / (TILE_W - 1) - 0.5) * 1.56)) : 0;

export function tileAt(b: Battle, p: Point) {
  return b.tiles.find((t) => key(t) === key(p));
}

export function focusOf(event: BattleEvent): Point | null {
  if (event.focus) return event.focus;
  if (event.kind === "move" && event.path.length)
    return event.path[event.path.length - 1];
  if (event.kind === "terrain") return event.path[0] ?? null;
  if (event.kind === "wait") {
    const u = event.before.units.find((v) => v.id === event.actor);
    return u ? { x: u.x, y: u.y } : null;
  }
  const target = changedUnits(event).find((id) => id !== event.actor) ?? event.actor;
  const u = event.after.units.find((v) => v.id === target);
  return u ? { x: u.x, y: u.y } : null;
}

/** Units whose hp or status set differs between the recorded before/after. */
export function changedUnits(event: BattleEvent) {
  return event.after.units
    .filter((a) => {
      const b = event.before.units.find((v) => v.id === a.id);
      if (!b) return true;
      return (
        a.hp !== b.hp ||
        a.statuses.length !== b.statuses.length ||
        a.statuses.some((s) => !b.statuses.some((v) => v.kind === s.kind))
      );
    })
    .map((u) => u.id);
}

function newStatus(event: BattleEvent, id: string) {
  const after = event.after.units.find((u) => u.id === id);
  const before = event.before.units.find((u) => u.id === id);
  if (!after) return undefined;
  return after.statuses.find(
    (s) => !before?.statuses.some((v) => v.kind === s.kind),
  )?.kind;
}

function actorOf(event: BattleEvent): Unit | undefined {
  return (
    event.before.units.find((u) => u.id === event.actor) ??
    event.after.units.find((u) => u.id === event.actor)
  );
}

function targetOf(event: BattleEvent) {
  const id = event.meta?.targetId ?? changedUnits(event)[0];
  if (!id) return undefined;
  return (
    event.after.units.find((u) => u.id === id) ??
    event.before.units.find((u) => u.id === id)
  );
}

/**
 * The single source of truth for "what does this historical step sound like".
 * Both live commands and replayed events call this with the recorded event, so
 * the two paths cannot drift apart. Cues derive only from the recorded
 * before/after snapshots, the path, and the structured outcome — never from
 * the current UI state.
 */
export function composeCues(
  event: BattleEvent,
  offsets: CueOffsets = {},
  stepInterval = 0.19,
): SoundCue[] {
  const push = (
    list: SoundCue[],
    spec: Omit<SoundCue, "key" | "offsetMs" | "at"> & { baseAt: number },
  ) => {
    const keyName = cueKey(event.kind, spec.role, spec.sound);
    const offsetMs = offsets[keyName] ?? 0;
    list.push({
      ...spec,
      key: keyName,
      offsetMs,
      at: Math.max(0, spec.baseAt + offsetMs / 1000),
    });
  };
  const cues: SoundCue[] = [];
  const actor = actorOf(event);
  const focus = focusOf(event);
  const pan = panFor(focus);

  if (event.kind === "move") {
    let at = 0.03;
    event.path.forEach((p, i) => {
      const terrain = tileAt(event.after, p)?.terrain ?? "plain";
      // Sound follows the ground actually crossed: water slows the stride,
      // forest and scree add their own interval.
      const weight =
        terrain === "water" ? 1.35 : terrain === "forest" ? 1.16 : terrain === "ridge" ? 0.9 : 1;
      push(cues, {
        sound: stepSound(terrain),
        role: "step",
        label: stepLabel(terrain),
        baseAt: at,
        pan: panFor(p),
        gain: 1,
        step: i,
      });
      at += stepInterval * weight;
    });
  } else if (event.kind === "skill") {
    const target = targetOf(event);
    const targetPan = panFor(target ? { x: target.x, y: target.y } : focus);
    const job: Profession = actor?.job ?? "guard";
    push(cues, {
      sound: castSound(job),
      role: "cast",
      label: `${actor?.name ?? "角色"} · ${event.meta?.skillName ?? "施法"}`,
      baseAt: 0.02,
      pan: targetPan,
      gain: 1,
    });
    const before = event.before.units.find((u) => u.id === target?.id);
    const after = event.after.units.find((u) => u.id === target?.id);
    const delta = (after?.hp ?? 0) - (before?.hp ?? 0);
    if (target && delta > 0) {
      push(cues, {
        sound: "heal",
        role: "heal",
        label: `${target.name} 回复 ${delta}`,
        baseAt: 0.24,
        pan: targetPan,
        gain: 1,
      });
    } else if (target && delta < 0) {
      const armored = (before?.armor ?? 0) >= 3;
      push(cues, {
        sound: armored ? "impact-metal" : "impact-flesh",
        role: "impact",
        label: `${target.name} 承受 ${-delta}${armored ? " · 护甲" : ""}`,
        baseAt: 0.2,
        pan: targetPan,
        gain: 1,
      });
    }
    // Only a status that actually landed produces a cue: a target killed by
    // the hit never receives the follow-up status, even if meta names one.
    // Meta also covers a refresh of a status the target already had, which the
    // before/after diff alone cannot see.
    const status =
      target && target.hp > 0
        ? newStatus(event, target.id) ?? event.meta?.status
        : undefined;
    if (status) {
      const sound =
        status === "burn" ? "status-burn" : status === "slow" ? "status-slow" : "status-guard";
      push(cues, {
        sound,
        role: "status",
        label: `${statusName(status)} · ${target?.name ?? actor?.name ?? "自身"}`,
        baseAt: delta < 0 ? 0.42 : 0.32,
        pan: targetPan,
        gain: 1,
      });
    }
  } else if (event.kind === "wait") {
    push(cues, {
      sound: "turn",
      role: "turn",
      label: "行动交接",
      baseAt: 0.02,
      pan,
      gain: 1,
    });
    const burned = actor?.statuses.some((s) => s.kind === "burn");
    if (burned) {
      push(cues, {
        sound: "status-burn",
        role: "status",
        label: `${actor!.name} 结算灼烧`,
        baseAt: 0.16,
        pan,
        gain: 1,
      });
    }
    if (event.after.ended && !event.before.ended) {
      push(cues, {
        sound: "victory",
        role: "victory",
        label: "战斗结束",
        baseAt: 0.34,
        pan: 0,
        gain: 1,
      });
    }
  } else if (event.kind === "terrain") {
    push(cues, {
      sound: "terrain-paint",
      role: "paint",
      label: `${terrainName(event.meta?.terrain)}改写`,
      baseAt: 0.01,
      pan,
      gain: 1,
    });
  }
  // Editing order is choreographic order; playback order is by absolute cue
  // time, which the scheduler sorts itself. Keeping the list stable prevents
  // rows from jumping while an offset slider is dragged.
  return cues;
}

export const statusName = (kind: string) =>
  ({ slow: "迟缓", burn: "灼烧", guard: "防御" })[kind] ?? kind;

export const terrainName = (terrain?: Terrain) =>
  terrain
    ? { plain: "草原", forest: "密林", water: "浅滩", ridge: "高地", wall: "断崖" }[terrain]
    : "地形";

const stepLabel = (terrain: Terrain) => `脚步 · ${terrainName(terrain)}`;

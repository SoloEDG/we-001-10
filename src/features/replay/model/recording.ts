import type {
  Battle,
  BattleEvent,
  EventKind,
  EventMeta,
  Point,
  Session,
} from "../../../shared/types";
import { clone } from "../../../shared/document";

export interface RecordExtras {
  path?: Point[];
  focus?: Point | null;
  meta?: EventMeta;
}

export function record(
  s: Session,
  before: Battle,
  kind: EventKind,
  label: string,
  extras: RecordExtras = {},
): BattleEvent {
  const startedAt = s.startedAt ?? (s.startedAt = Date.now());
  const event: BattleEvent = {
    id: s.events.length + 1,
    kind,
    actor: before.active,
    label,
    path: clone(extras.path ?? []),
    focus: extras.focus ? clone(extras.focus) : null,
    // Historical wall-clock stamp: replay scheduling is derived from this,
    // never from whichever button happened to fire the sound.
    at: Math.max(0, Date.now() - startedAt),
    meta: extras.meta ? clone(extras.meta) : undefined,
    before: clone(before),
    after: clone(s.live),
  };
  s.events.push(event);
  return event;
}
export function frame(s: Session, cursor: number) {
  return cursor < 0
    ? s.live
    : cursor === 0
      ? s.initial
      : s.events[Math.min(cursor, s.events.length) - 1].after;
}

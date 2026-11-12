export type Terrain = "plain" | "forest" | "water" | "ridge" | "wall";
export type Profession = "guard" | "ranger" | "mage" | "medic";
export interface Point {
  x: number;
  y: number;
}
export interface Tile extends Point {
  terrain: Terrain;
}
export interface Status {
  kind: "slow" | "burn" | "guard";
  turns: number;
}
export interface Unit extends Point {
  id: string;
  name: string;
  job: Profession;
  team: "azure" | "ember";
  hp: number;
  maxHp: number;
  power: number;
  armor: number;
  speed: number;
  move: number;
  statuses: Status[];
  moved: boolean;
  acted: boolean;
}
export interface Battle {
  tiles: Tile[];
  units: Unit[];
  round: number;
  queue: string[];
  active: string;
  ended: string | null;
}
export type EventKind = "move" | "skill" | "wait" | "terrain";
/** Structured outcome captured at record time so audio never has to guess. */
export interface EventMeta {
  skillId?: string;
  skillName?: string;
  targetId?: string;
  targetName?: string;
  value?: number;
  status?: Status["kind"];
  elevated?: boolean;
  armor?: number;
  terrain?: Terrain;
}
export interface BattleEvent {
  id: number;
  kind: EventKind;
  actor: string;
  label: string;
  path: Point[];
  /** Where the action actually landed; drives map marker and stereo pan. */
  focus?: Point | null;
  /** Milliseconds since the session started, used by the replay scheduler. */
  at?: number;
  meta?: EventMeta;
  before: Battle;
  after: Battle;
}
export interface Session {
  initial: Battle;
  live: Battle;
  events: BattleEvent[];
  /** Monotonic wall clock origin for event timestamps. */
  startedAt?: number;
}
export interface Skill {
  id: string;
  name: string;
  range: number;
  power: number;
  target: "enemy" | "ally" | "self";
  status?: Status["kind"];
  description: string;
}

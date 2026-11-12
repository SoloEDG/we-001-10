import type { Profession, Terrain } from "../../../shared/types";

export type SoundId =
  | "step-plain"
  | "step-forest"
  | "step-water"
  | "step-ridge"
  | "step-wall"
  | "cast-guard"
  | "cast-ranger"
  | "cast-mage"
  | "cast-medic"
  | "impact-metal"
  | "impact-flesh"
  | "heal"
  | "status-burn"
  | "status-slow"
  | "status-guard"
  | "terrain-paint"
  | "turn"
  | "victory";

export type SoundGroup = "step" | "cast" | "impact" | "status" | "utility";

export interface SoundSpec {
  id: SoundId;
  label: string;
  group: SoundGroup;
  /** Base playback gain before the master bus. */
  gain: number;
  description: string;
}

export const soundCatalog: Record<SoundId, SoundSpec> = {
  "step-plain": { id: "step-plain", label: "脚步 · 草原", group: "step", gain: 0.62, description: "松软草地的落地声" },
  "step-forest": { id: "step-forest", label: "脚步 · 密林", group: "step", gain: 0.62, description: "枯枝与落叶的碎裂声" },
  "step-water": { id: "step-water", label: "脚步 · 浅滩", group: "step", gain: 0.68, description: "涉水踩踏与回声" },
  "step-ridge": { id: "step-ridge", label: "脚步 · 高地", group: "step", gain: 0.66, description: "碎石与硬岩的脆响" },
  "step-wall": { id: "step-wall", label: "脚步 · 断崖", group: "step", gain: 0.6, description: "岩屑滚落的低沉声" },
  "cast-guard": { id: "cast-guard", label: "施法 · 重装卫士", group: "cast", gain: 0.78, description: "盾面撞击与金属泛音" },
  "cast-ranger": { id: "cast-ranger", label: "施法 · 游侠", group: "cast", gain: 0.8, description: "弓弦释放与破空声" },
  "cast-mage": { id: "cast-mage", label: "施法 · 秘术师", group: "cast", gain: 0.82, description: "高频泛音堆叠的火花" },
  "cast-medic": { id: "cast-medic", label: "施法 · 医师", group: "cast", gain: 0.76, description: "柔和钟体与气流" },
  "impact-metal": { id: "impact-metal", label: "命中 · 装甲", group: "impact", gain: 0.8, description: "护甲弹开的金属撞击" },
  "impact-flesh": { id: "impact-flesh", label: "命中 · 血肉", group: "impact", gain: 0.74, description: "沉闷的实体命中" },
  heal: { id: "heal", label: "治疗 · 生命回复", group: "impact", gain: 0.7, description: "上行三音的治疗音型" },
  "status-burn": { id: "status-burn", label: "状态 · 灼烧", group: "status", gain: 0.62, description: "持续燃烧的噼啪声" },
  "status-slow": { id: "status-slow", label: "状态 · 迟缓", group: "status", gain: 0.58, description: "下坠的拉长音" },
  "status-guard": { id: "status-guard", label: "状态 · 防御", group: "status", gain: 0.6, description: "护盾成形的上行和弦" },
  "terrain-paint": { id: "terrain-paint", label: "地形改写", group: "utility", gain: 0.55, description: "沙盘划过的扫风声" },
  turn: { id: "turn", label: "行动交接", group: "utility", gain: 0.52, description: "回合权移交的提示音" },
  victory: { id: "victory", label: "战斗结束", group: "utility", gain: 0.85, description: "胜负揭晓的和弦" },
};

export const stepSound = (t: Terrain): SoundId => `step-${t}` as SoundId;
export const castSound = (job: Profession): SoundId => `cast-${job}` as SoundId;
export const soundUrl = (id: SoundId) => `/audio/${id}.wav`;
export const allSoundIds = Object.keys(soundCatalog) as SoundId[];

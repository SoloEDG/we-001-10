<script setup lang="ts">
import { computed } from "vue";
import type { BattleEvent } from "../../../shared/types";
import type { SoundCue } from "../model/cues";
import { terrainName } from "../model/cues";
import { useAudio } from "../model/store";

const props = defineProps<{
  event: BattleEvent | null;
  cursor: number;
  blocked?: boolean;
}>();

defineEmits<{
  enable: [];
  auditionStep: [];
  volume: [value: number];
  offset: [key: string, ms: number];
}>();

const {
  started,
  preloading,
  decoded,
  total,
  missing,
  missingFor,
  volume,
  compose,
  resetOffsets,
  audition,
} = useAudio();

const cues = computed(() => (props.event ? compose(props.event) : []));
const span = computed(() =>
  Math.max(
    1.4,
    ...cues.value.map((c) => c.at + (c.role === "step" ? 0.24 : 0.9)),
  ),
);

const kindName = (kind: string) =>
  ({ move: "移动", skill: "技能结算", wait: "结束行动", terrain: "地形改写" })[
    kind
  ] ?? kind;

const roleLabel: Record<string, string> = {
  step: "脚步",
  cast: "施法",
  impact: "命中",
  heal: "治疗",
  status: "状态",
  turn: "交接",
  paint: "地形",
  victory: "结算",
};

const percent = (cue: SoundCue) =>
  Math.min(97, Math.max(2, (cue.at / span.value) * 100));
const blockWidth = (cue: SoundCue) =>
  cue.role === "step"
    ? Math.max(3.5, Math.min(18, 100 / Math.max(3, cues.value.length * 1.1)))
    : Math.max(5, Math.min(26, 100 / Math.max(2, cues.value.length)));

function auditionCue(cue: SoundCue) {
  audition(cue);
}
</script>

<template>
  <section class="panel audio-panel">
    <div class="eyebrow">05 / SOUND DESIGN</div>
    <h3>
      音效编排
      <small v-if="started">{{ decoded }}/{{ total }} 素材就绪</small>
      <small v-else-if="preloading">正在载入本地素材…</small>
      <small v-else>等待启动</small>
    </h3>

    <div class="audio-gate" v-if="!started">
      <p>
        浏览器要求先由用户操作启动音频。启动后，实战与回放都按历史事件时间线播放本地音效。
      </p>
      <button class="primary audio-start" @click="$emit('enable')">
        ♪ 启动音效
      </button>
      <p v-if="missing.length && !blocked" class="gate-missing">
        {{ missing.length }} 项素材缺失，将跳过对应音效。
      </p>
      <p v-if="blocked" class="gate-missing">
        音频上下文不可用，回放仍可按时间轴无声推进。
      </p>
    </div>

    <div class="audio-master" v-else>
      <span>主音量</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="volume"
        @input="$emit('volume', Number(($event.target as HTMLInputElement).value))"
      />
      <b>{{ Math.round(volume * 100) }}%</b>
    </div>

    <div v-if="missing.length" class="audio-missing" role="alert">
      <b>缺失 {{ missing.length }} 项素材，相关音效已跳过：</b>
      <span v-for="m in missing" :key="m.id" class="missing-row">
        <i>{{ m.label }}</i><small>{{ m.id }} · {{ m.reason }}</small>
      </span>
    </div>

    <div class="cue-head">
      <div class="cue-step" v-if="event">
        <span class="badge">{{ cursor > 0 ? String(cursor).padStart(2, "0") : "实" }}</span>
        <div>
          <b>{{ event.label }}</b>
          <small>
            {{ kindName(event.kind) }}
            <template v-if="event.meta?.terrain">
              · {{ terrainName(event.meta.terrain) }}
            </template>
            <template v-if="event.focus">
              · 定位 {{ event.focus.x + 1 }},{{ event.focus.y + 1 }}
            </template>
          </small>
        </div>
      </div>
      <div class="cue-step empty" v-else>
        <span class="badge">—</span>
        <div>
          <b>{{ cursor === 0 ? "战斗开始" : "实战指挥" }}</b>
          <small>执行任意动作后可在此微调其音效</small>
        </div>
      </div>
      <button
        v-if="event"
        class="audition-step"
        :disabled="!started"
        @click="$emit('auditionStep')"
      >
        ▶ 试听整步
      </button>
    </div>

    <div class="cue-timeline" v-if="event && cues.length">
      <div class="cue-lane">
        <i
          v-for="(cue, i) in cues"
          :key="cue.key + ':' + i"
          :class="['cue-block', 'role-' + cue.role]"
          :style="{ left: percent(cue) + '%', width: blockWidth(cue) + '%' }"
          :title="`${cue.label} @ ${cue.at.toFixed(2)}s`"
        />
      </div>
      <div class="cue-ruler">
        <span>0.0s</span><span>{{ span.toFixed(1) }}s</span>
      </div>
    </div>

    <div class="cue-list" v-if="event">
      <div
        v-for="(cue, i) in cues"
        :key="cue.key + ':' + i"
        class="cue-row"
        :class="{ damaged: !!missingFor(cue.sound) }"
      >
        <button
          class="cue-sound"
          :disabled="!started || !!missingFor(cue.sound)"
          :title="missingFor(cue.sound) || '按当前偏移试听'"
          @click="auditionCue(cue)"
        >
          <b>{{ roleLabel[cue.role] }}</b>
          <span>{{ cue.label }}</span>
          <small>{{ cue.at.toFixed(2) }}s</small>
        </button>
        <div class="cue-offset">
          <input
            type="range"
            min="-900"
            max="900"
            step="10"
            :value="cue.offsetMs"
            :disabled="!started || !!missingFor(cue.sound)"
            aria-label="音效偏移毫秒"
            @input="
              $emit(
                'offset',
                cue.key,
                Number(($event.target as HTMLInputElement).value),
              )
            "
            @change="auditionCue(cue)"
          />
          <span
            >{{ cue.offsetMs > 0 ? "+" : "" }}{{ cue.offsetMs }}ms</span
          >
        </div>
      </div>
      <div class="cue-footer">
        <small>偏移以“步骤类型 + 角色 + 音效”保存，实战与回放共用。</small>
        <button class="link" @click="resetOffsets()">重置</button>
      </div>
    </div>
  </section>
</template>

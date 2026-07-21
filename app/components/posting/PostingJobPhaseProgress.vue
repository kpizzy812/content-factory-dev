<script setup lang="ts">
/**
 * Визуализация 11 фаз YouTube poster (steps-vertical).
 *
 * Определение состояния каждой фазы:
 *   1. Если job.lastErrorPhase === phase → ошибка (error)
 *   2. Если найдена в job.lastErrorPhase или после неё → не выполнена (pending)
 *   3. Если фаза до lastErrorPhase → выполнена (done)
 *   4. Если job.status === 'published' → все done
 *   5. Fallback по job.status: queued/preparing/uploading/published.
 *
 * Для TikTok / Instagram фаз 8 (без details/made_for_kids/visibility) — но
 * компонент сейчас рендерит только YouTube. Платформа youtube проверяется в
 * родителе.
 */
import {
  YOUTUBE_PHASE_LABELS,
  YOUTUBE_PHASES,
  type YoutubePhase,
} from "~~/shared/types/posting-youtube"
import type { PostingJobDto } from "~~/shared/types/posting-job"

const props = defineProps<{
  job: PostingJobDto
}>()

type StepState = "done" | "current" | "error" | "pending"

const stepStates = computed<Record<YoutubePhase, StepState>>(() => {
  const states = {} as Record<YoutubePhase, StepState>
  const errorPhase = props.job.lastErrorPhase as YoutubePhase | undefined

  // Терминальный success — все done.
  if (props.job.status === "published") {
    for (const p of YOUTUBE_PHASES) states[p] = "done"
    return states
  }

  // Failed с известной phase — она error, до неё done, после неё pending.
  if (
    props.job.status === "failed"
    && errorPhase
    && (YOUTUBE_PHASES as readonly string[]).includes(errorPhase)
  ) {
    let reachedError = false
    for (const p of YOUTUBE_PHASES) {
      if (p === errorPhase) {
        states[p] = "error"
        reachedError = true
      } else if (!reachedError) {
        states[p] = "done"
      } else {
        states[p] = "pending"
      }
    }
    return states
  }

  // Fallback по job.status — приближённое отображение прогресса.
  const statusToPhase: Partial<Record<typeof props.job.status, YoutubePhase>> = {
    scheduled: "session_start",
    queued: "session_start",
    preparing: "session_start",
    uploading: "file_upload",
    retry_queued: "session_start",
    cancelled: "session_start",
    failed: "session_start",
  }
  const currentPhase = statusToPhase[props.job.status] ?? "session_start"
  let reachedCurrent = false
  for (const p of YOUTUBE_PHASES) {
    if (p === currentPhase) {
      states[p] = "current"
      reachedCurrent = true
    } else if (!reachedCurrent) {
      states[p] = "done"
    } else {
      states[p] = "pending"
    }
  }
  return states
})

const STEP_CLASS: Record<StepState, string> = {
  done: "step step-success",
  current: "step step-primary",
  error: "step step-error",
  pending: "step",
}
</script>

<template>
  <ul class="steps steps-vertical">
    <li
      v-for="phase in YOUTUBE_PHASES"
      :key="phase"
      :class="STEP_CLASS[stepStates[phase]]"
    >
      <span class="text-xs text-left">
        {{ YOUTUBE_PHASE_LABELS[phase] }}
        <span
          v-if="stepStates[phase] === 'error'"
          class="text-error font-medium ml-1"
        >
          (ошибка)
        </span>
      </span>
    </li>
  </ul>
</template>

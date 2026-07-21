<script setup lang="ts">
import type { StartFlowState } from "~/composables/useDeviceStartFlow"

/**
 * DeviceStartProgressStepper — визуализация прогресса старта device-профиля.
 *
 * DaisyUI `steps` компонент с 2-3 шагами:
 *   - "Запуск" (launcher_call) - всегда
 *   - "Загрузка ядра" (downloading_core) - conditional, появляется при первом
 *     получении state=downloading_core от server, остаётся видимым даже после
 *     перехода в running (чтобы оператор видел что был download)
 *   - "Готово" (running) - всегда
 *
 * Размеры (size prop):
 *   - 'sm' - compact для карточки в списке
 *   - 'md' - дефолт, для detail view
 *
 * Каждый шаг показывает: pending / active (spinner + секунды) / done (✓) / error (✗).
 */

const props = withDefaults(
  defineProps<{
    state: StartFlowState
    size?: "sm" | "md"
  }>(),
  { size: "md" },
)

const emit = defineEmits<{
  cancel: []
  /** Открыть error detail (для failed state) */
  errorDetail: []
}>()

// Показывать ли шаг "Загрузка ядра". True если уже был download или сейчас в нём.
const showDownloadStep = computed(
  () => props.state.hadDownload || props.state.step === "downloading_core",
)

const launcherStepClass = computed(() => {
  switch (props.state.step) {
    case "launcher_call":
      return "step-primary"
    case "downloading_core":
    case "running":
      return "step-success"
    case "failed":
      // Failed на launcher_call (без download) - red. Если был download - launcher_call успел.
      return props.state.hadDownload ? "step-success" : "step-error"
    default:
      return ""
  }
})

const downloadStepClass = computed(() => {
  switch (props.state.step) {
    case "downloading_core":
      return "step-primary"
    case "running":
      return "step-success"
    case "failed":
      return "step-error"
    default:
      return ""
  }
})

const runningStepClass = computed(() => {
  switch (props.state.step) {
    case "running":
      return "step-success"
    default:
      return ""
  }
})

function formatSeconds(ms: number): string {
  if (ms < 1000) return "0с"
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}с`
  const minutes = Math.floor(seconds / 60)
  const remSec = seconds % 60
  return `${minutes}м ${remSec}с`
}

const stepStyleSize = computed(() => (props.size === "sm" ? "text-xs" : "text-sm"))

// Title и иконка waiting step динамические по downloadingCode:
//   CORE_DOWNLOADING_STARTED - "Загрузка ядра" с download icon, ~2-5 мин
//   LOCK_PROFILE_ERROR - "Освобождение блокировки" с lock icon, ~до 15с
//   null/legacy - "Подготовка"
const waitingStepConfig = computed(() => {
  const code = props.state.downloadingCode
  if (code === "LOCK_PROFILE_ERROR") {
    return {
      label: "Освобождение блокировки",
      hint: "Браузер держит lock на профиле",
      icon: "mingcute:lock-line",
      retryInfo: `попытка ${props.state.lockRetries}/5`,
    }
  }
  return {
    label: "Загрузка ядра",
    hint: "Устройство загружает Chromium ~2-5 мин",
    icon: "mingcute:download-line",
    retryInfo: props.state.coreRetries > 1 ? `попытка ${props.state.coreRetries}/60` : "",
  }
})
</script>

<template>
  <div class="flex flex-col gap-2 w-full">
    <ul
      class="steps w-full"
      :class="[stepStyleSize]"
    >
      <!-- Шаг 1: Запуск -->
      <li class="step" :class="launcherStepClass">
        <div class="flex flex-col items-center gap-0.5">
          <span class="flex items-center gap-1">
            <span
              v-if="state.step === 'launcher_call'"
              class="loading loading-spinner loading-xs"
            />
            <Icon
              v-else-if="state.step === 'failed' && !state.hadDownload"
              name="mingcute:close-circle-line"
              class="text-error"
            />
            <Icon
              v-else-if="['downloading_core','running'].includes(state.step) || state.hadDownload"
              name="mingcute:check-circle-line"
              class="text-success"
            />
            <span>Запуск</span>
          </span>
          <span
            v-if="state.step === 'launcher_call'"
            class="text-[10px] opacity-70"
          >
            {{ formatSeconds(state.stepElapsedMs) }}
          </span>
        </div>
      </li>

      <!-- Шаг 2: Загрузка ядра / Освобождение блокировки (conditional, dynamic label) -->
      <li v-if="showDownloadStep" class="step" :class="downloadStepClass">
        <div class="flex flex-col items-center gap-0.5">
          <span class="flex items-center gap-1">
            <span
              v-if="state.step === 'downloading_core'"
              class="loading loading-spinner loading-xs"
            />
            <Icon
              v-else-if="state.step === 'running'"
              name="mingcute:check-circle-line"
              class="text-success"
            />
            <Icon
              v-else-if="state.step === 'failed'"
              name="mingcute:close-circle-line"
              class="text-error"
            />
            <span>{{ waitingStepConfig.label }}</span>
          </span>
          <span
            v-if="state.step === 'downloading_core'"
            class="text-[10px] opacity-70"
          >
            {{ formatSeconds(state.stepElapsedMs) }}
            <template v-if="waitingStepConfig.retryInfo">
              ({{ waitingStepConfig.retryInfo }})
            </template>
          </span>
        </div>
      </li>

      <!-- Шаг 3: Готово -->
      <li class="step" :class="runningStepClass">
        <div class="flex flex-col items-center gap-0.5">
          <span class="flex items-center gap-1">
            <Icon
              v-if="state.step === 'running'"
              name="mingcute:check-circle-line"
              class="text-success"
            />
            <span>Готово</span>
          </span>
          <span
            v-if="state.step === 'running' && state.port"
            class="text-[10px] opacity-70 font-mono"
          >
            :{{ state.port }}
          </span>
        </div>
      </li>
    </ul>

    <!-- Status line под stepper'ом - dynamic по downloadingCode -->
    <div
      v-if="state.step === 'downloading_core'"
      role="alert"
      class="alert alert-info alert-soft text-xs py-2"
    >
      <Icon :name="waitingStepConfig.icon" class="text-info" />
      <span v-if="state.downloadingCode === 'LOCK_PROFILE_ERROR'">
        <b>Устройство держит блокировку профиля</b> ({{ formatSeconds(state.stepElapsedMs) }},
        {{ waitingStepConfig.retryInfo }}). Освобождаем — обычно занимает до 15 секунд.
      </span>
      <span v-else>
        <b>Устройство загружает Chromium ядро</b> через ваш прокси
        ({{ formatSeconds(state.stepElapsedMs) }}). Это происходит однократно
        после перезапуска контейнера. Можно подождать здесь или закрыть страницу
        — устройство запустится автоматически.
      </span>
      <button class="btn btn-ghost btn-xs" @click="emit('cancel')">
        Отменить ожидание
      </button>
    </div>

    <div
      v-else-if="state.step === 'failed'"
      role="alert"
      class="alert alert-error alert-soft text-xs py-2"
    >
      <Icon name="mingcute:warning-line" />
      <span class="truncate">{{ state.error?.message ?? "Не удалось запустить" }}</span>
      <button class="btn btn-ghost btn-xs" @click="emit('errorDetail')">
        Подробнее
      </button>
    </div>

    <div
      v-else-if="state.step === 'running'"
      role="alert"
      class="alert alert-success text-sm py-3 font-semibold"
    >
      <Icon name="mingcute:check-2-fill" class="text-base" />
      <div class="flex-1">
        <div class="flex items-center gap-2">
          <span class="text-success">Успех! Профиль запущен.</span>
          <span class="badge badge-success badge-sm">{{ formatSeconds(state.elapsedMs) }}</span>
        </div>
        <div v-if="state.port" class="text-xs font-normal opacity-80 mt-0.5">
          WebDriver на порту <strong>{{ state.port }}</strong>
        </div>
        <div v-else class="text-xs font-normal opacity-80 mt-0.5">
          Устройство DuoPlus работает (standalone, без WebDriver).
        </div>
      </div>
    </div>
  </div>
</template>

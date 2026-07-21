<script setup lang="ts">
import type { DeviceTestPushResult } from "~~/shared/types/device-profile"

/**
 * DeviceWarmupForPostingButton — кнопка «Прогреть профиль» для постинга.
 *
 * Поднимает антидетект-профиль на серверном headless-агенте через тот же
 * useDeviceStartFlow, что и обычный Start, но всегда с automation:true. Это нужно,
 * чтобы poster-runner в фазе session_start нашёл профиль уже запущенным (Chromium
 * ядро скачано, lock снят) и не падал в indigo_unstable на свежем контейнере.
 *
 * Транспорт прогрева (automation:true → puppeteer/CDP) совпадает с постингом для
 * desktop-профилей. Для mobile-профилей постинг идёт через selenium, поэтому
 * кнопка прогрева скрыта для них (см. supported computed). Бэкенд /start уже
 * идемпотентен при already-running — повторный поллинг не плодит сессий.
 *
 * Состояния:
 *   - flow в idle → кнопка «Прогреть»
 *   - flow active/complete → встроенный stepper + кнопка «ОК» (reset)
 *
 * Emits:
 *   - warmed(port)    — прогрев успешно завершён (state=running)
 *   - updated         — нужно перечитать профиль (после успеха/остановки)
 *   - error-detail    — оператор хочет увидеть детали ошибки (raw response)
 */
const props = withDefaults(
  defineProps<{
    /**
     * Локальный id профиля (DeviceProfile.id, PK) — уходит в URL
     * POST /api/device-profiles/:id/start. ВАЖНО: это НЕ облачный indigoId
     * (тот — UUID; по нему findUnique вернёт null → 404 «Device-профиль не найден»).
     * Кнопка скрыта, если null/undefined.
     */
    profileId?: string | null
    /**
     * Запушен ли профиль в облако (есть cloud indigoId). Прогрев поднимает
     * облачный профиль на агенте — без облачной копии старт невозможен (та же
     * гейт-логика, что у обычного Start). Кнопка скрыта, если false.
     */
    pushedToCloud?: boolean
    /**
     * Тип платформы профиля. Для mobile_* прогрев через puppeteer не совпадёт с
     * selenium-постингом → кнопка скрывается. undefined ⇒ считаем поддерживаемым
     * (вызывающий не знает тип — лучше показать, чем скрыть).
     */
    platformType?: "desktop" | "mobile_android" | "mobile_ios" | null
    size?: "sm" | "md"
    /** Компактный режим: кнопка btn-xs, для встраивания в строку чек-листа. */
    compact?: boolean
  }>(),
  { profileId: null, pushedToCloud: false, platformType: null, size: "sm", compact: false },
)

const emit = defineEmits<{
  warmed: [port: number | null]
  updated: []
  errorDetail: [result: DeviceTestPushResult]
}>()

const {
  state: flowState,
  start: startFlow,
  cancel: cancelFlow,
  reset: resetFlow,
} = useDeviceStartFlow()

// Прогрев puppeteer/CDP совпадает с постингом только для desktop. Mobile постится
// через selenium — для него прогрев puppeteer бесполезен, кнопку скрываем.
// TODO(mobile): если поддержим selenium-прогрев — снять это ограничение.
const supported = computed(() => props.platformType !== "mobile_android" && props.platformType !== "mobile_ios")

const visible = computed(() => Boolean(props.profileId) && props.pushedToCloud && supported.value)

const btnSizeClass = computed(() => (props.compact ? "btn-xs" : props.size === "sm" ? "btn-sm" : ""))

async function handleWarmup() {
  if (!props.profileId) return
  await startFlow(props.profileId, true)
  if (flowState.value.step === "running") {
    emit("warmed", flowState.value.port)
    emit("updated")
  }
}

function handleErrorDetail() {
  const err = flowState.value.error
  if (!err) return
  emit("errorDetail", {
    ok: false,
    status: 0,
    // Прогрев — это start с automation:true под капотом; method union не имеет
    // отдельного "warmup", используем "start".
    method: "start",
    url: "",
    requestBody: { automation: true },
    responseBody: err.indigoBody ?? null,
    error: err.message,
    phase: err.phase,
  })
}
</script>

<template>
  <div v-if="visible" class="contents">
    <!-- idle: компактная кнопка-триггер -->
    <button
      v-if="flowState.step === 'idle'"
      type="button"
      class="btn btn-primary gap-1"
      :class="btnSizeClass"
      title="Поднять профиль на сервере заранее, чтобы постинг не падал на загрузке ядра"
      @click="handleWarmup"
    >
      <Icon name="mingcute:fire-line" class="text-sm" />
      Прогреть
    </button>

    <!-- active/complete: встроенный stepper в карточке -->
    <div
      v-else
      :class="[
        'rounded-box border border-base-300 bg-base-200/50 p-3',
        compact ? 'min-w-0' : 'w-full',
      ]"
    >
      <DeviceStartProgressStepper
        :state="flowState"
        :size="compact ? 'sm' : size"
        @cancel="cancelFlow"
        @error-detail="handleErrorDetail"
      />
      <div
        v-if="flowState.step === 'running' || flowState.step === 'failed'"
        class="mt-2 flex justify-end"
      >
        <button class="btn btn-xs btn-ghost" @click="resetFlow">ОК</button>
      </div>
    </div>
  </div>
</template>

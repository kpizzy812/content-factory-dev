<script setup lang="ts">
import type { DeviceProfileDto } from "~~/shared/types/device-profile"

const props = defineProps<{
  profile: DeviceProfileDto
}>()

function formatDate(iso: string | null): string {
  if (!iso) return "никогда"
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

const durationLabel = computed(() => {
  if (!props.profile.lastSessionStartedAt || !props.profile.lastSessionEndedAt) return null
  const start = new Date(props.profile.lastSessionStartedAt).getTime()
  const end = new Date(props.profile.lastSessionEndedAt).getTime()
  const diffMin = Math.max(0, Math.round((end - start) / 60_000))
  if (diffMin < 60) return `${diffMin} мин`
  const h = Math.floor(diffMin / 60)
  const m = diffMin % 60
  return `${h} ч ${m} мин`
})

const webdriverUrl = computed(() => {
  if (!props.profile.lastSessionPort) return null
  return `http://127.0.0.1:${props.profile.lastSessionPort}`
})

const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null
async function copyWebdriver() {
  if (!webdriverUrl.value) return
  try {
    await navigator.clipboard.writeText(webdriverUrl.value)
    copied.value = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // no-op
  }
}
onBeforeUnmount(() => {
  if (copyTimer) clearTimeout(copyTimer)
})
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <h3 class="font-semibold flex items-center gap-2">
        <Icon name="mingcute:time-line" />
        Сессии
      </h3>

      <div class="stats stats-vertical sm:stats-horizontal shadow-sm bg-base-200/50">
        <div class="stat py-3 px-4">
          <div class="stat-title text-xs">Всего</div>
          <div class="stat-value text-2xl">{{ profile.totalSessions }}</div>
        </div>
        <div class="stat py-3 px-4">
          <div class="stat-title text-xs">Последний старт</div>
          <div class="stat-value text-sm">{{ formatDate(profile.lastSessionStartedAt) }}</div>
        </div>
        <div class="stat py-3 px-4">
          <div class="stat-title text-xs">Завершилась</div>
          <div class="stat-value text-sm">
            {{ formatDate(profile.lastSessionEndedAt) }}
            <span v-if="durationLabel" class="text-xs text-base-content/60 block">
              длилась {{ durationLabel }}
            </span>
          </div>
        </div>
      </div>

      <!-- Running + port (automation_type=selenium): полный URL WebDriver -->
      <div
        v-if="profile.sessionState === 'running' && webdriverUrl"
        role="alert"
        class="alert alert-success alert-soft text-sm"
      >
        <Icon name="mingcute:play-circle-fill" />
        <div class="flex-1 min-w-0">
          <div>WebDriver слушает на порту <strong>{{ profile.lastSessionPort }}</strong></div>
          <code class="font-mono text-xs">{{ webdriverUrl }}</code>
        </div>
        <button
          class="btn btn-xs btn-ghost gap-1"
          @click="copyWebdriver"
        >
          <Icon :name="copied ? 'mingcute:check-line' : 'mingcute:copy-2-line'" />
          {{ copied ? "Скопировано" : "Копировать URL" }}
        </button>
      </div>

      <!-- Running без port (standalone non-automation): браузер работает,
           оператор взаимодействует через UI провайдера. См. computeSessionState -
           running когда lastSessionStartedAt > lastSessionEndedAt без port. -->
      <div
        v-else-if="profile.sessionState === 'running'"
        role="alert"
        class="alert alert-success alert-soft text-sm"
      >
        <Icon name="mingcute:play-circle-fill" />
        <span>
          Устройство DuoPlus запущено (standalone, без WebDriver).
          Взаимодействуйте через интерфейс устройства или включите Automation в Действиях
          для следующего запуска чтобы получить WebDriver port.
        </span>
      </div>

      <!-- Idle: не запущен, история не сохраняется (детальная история - backlog). -->
      <div v-else class="text-sm text-base-content/60 italic">
        Профиль не запущен. История завершённых сессий не сохраняется (это backlog item).
      </div>
    </div>
  </div>
</template>

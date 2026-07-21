<script setup lang="ts">
import type { DeviceProfileDto } from "~~/shared/types/device-profile"

defineProps<{
  profile: DeviceProfileDto
}>()

const emit = defineEmits<{
  back: []
}>()

const copied = ref<string | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | null = null

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = label
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copied.value = null }, 2000)
  } catch {
    // fallback no-op — clipboard может быть недоступен в HTTPS-less env
  }
}

onBeforeUnmount(() => {
  if (copyTimer) clearTimeout(copyTimer)
})
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <!-- Breadcrumbs / back -->
      <div class="flex items-center gap-2 text-sm text-base-content/60">
        <button class="link link-hover" @click="emit('back')">
          <Icon name="mingcute:left-line" class="inline" />
          К списку профилей
        </button>
        <span>/</span>
        <span class="font-semibold text-base-content truncate">{{ profile.name }}</span>
      </div>

      <!-- Name + badges -->
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div class="min-w-0 flex-1">
          <h1 class="text-2xl font-bold text-base-content truncate">{{ profile.name }}</h1>
          <p class="text-sm text-base-content/60 mt-1">
            Всего сессий: <strong>{{ profile.totalSessions }}</strong>
            · Аккаунтов: <strong>{{ profile.accounts.length }}</strong>
            · Тегов: <strong>{{ profile.tags.length }}</strong>
          </p>
        </div>
        <div class="flex flex-col items-end gap-1.5">
          <DeviceSyncStatusBadge :status="profile.syncStatus" :indigo-id="profile.indigoId" />
          <DeviceSessionStatusBadge
            :state="profile.sessionState"
            :port="profile.lastSessionPort"
          />
          <!-- Готовность для постинга: «Прогрет ✓» когда серверный агент держит
               профиль запущенным → poster-runner session_start найдёт его готовым. -->
          <DeviceSessionStatusBadge
            variant="warmup"
            size="sm"
            :state="profile.sessionState"
            :port="profile.lastSessionPort"
          />
          <span
            v-if="profile.proxy"
            class="badge badge-sm gap-1"
            :class="{
              'badge-success': profile.proxyCountryGuard === 'us_proxy_ok',
              'badge-warning': profile.proxyCountryGuard === 'wrong_country' || profile.proxyCountryGuard === 'unknown',
              'badge-error': profile.proxyCountryGuard === 'no_proxy',
            }"
          >
            <Icon name="mingcute:earth-line" class="text-xs" />
            <template v-if="profile.proxyCountryGuard === 'us_proxy_ok'">US Proxy</template>
            <template v-else-if="profile.proxyCountryGuard === 'wrong_country'">
              Не US ({{ profile.proxy.expectedCountry ?? "?" }})
            </template>
            <template v-else-if="profile.proxyCountryGuard === 'unknown'">Country?</template>
            <template v-else>Нет proxy</template>
          </span>
        </div>
      </div>

      <!-- IDs row -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
        <div class="flex items-center gap-1.5">
          <span class="text-base-content/50">Local id:</span>
          <code class="font-mono text-base-content/80 truncate">{{ profile.id }}</code>
          <button
            class="btn btn-xs btn-ghost btn-square"
            title="Копировать"
            @click="copyToClipboard(profile.id, 'id')"
          >
            <Icon :name="copied === 'id' ? 'mingcute:check-line' : 'mingcute:copy-2-line'" class="text-xs" />
          </button>
        </div>
        <div v-if="profile.indigoId" class="flex items-center gap-1.5">
          <span class="text-base-content/50">ID в облаке:</span>
          <code class="font-mono text-base-content/80 truncate">{{ profile.indigoId }}</code>
          <button
            class="btn btn-xs btn-ghost btn-square"
            title="Копировать"
            @click="copyToClipboard(profile.indigoId!, 'indigoId')"
          >
            <Icon :name="copied === 'indigoId' ? 'mingcute:check-line' : 'mingcute:copy-2-line'" class="text-xs" />
          </button>
        </div>
        <div v-if="profile.indigoFolderId" class="flex items-center gap-1.5">
          <span class="text-base-content/50">Folder id:</span>
          <code class="font-mono text-base-content/80 truncate">{{ profile.indigoFolderId }}</code>
          <button
            class="btn btn-xs btn-ghost btn-square"
            title="Копировать"
            @click="copyToClipboard(profile.indigoFolderId!, 'folderId')"
          >
            <Icon :name="copied === 'folderId' ? 'mingcute:check-line' : 'mingcute:copy-2-line'" class="text-xs" />
          </button>
        </div>
      </div>

      <div v-if="profile.lastSyncError" role="alert" class="alert alert-error alert-soft text-xs">
        <Icon name="mingcute:warning-line" />
        <span>{{ profile.lastSyncError }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Подключение аккаунта. Источник: пустое состояние «Аккаунтов нет» из макета 06.
 *
 * Список платформ не выдуман: официальный OAuth реализован только для Instagram
 * (`server/api/social/connect/[platform].get.ts` отвечает 501 на остальные).
 * Остальные две названы прямо, чтобы оператор не искал кнопку, которой нет.
 */
const props = defineProps<{ appId: number }>()

const open = ref(false)
const { connectAccount } = useAccountActions()

const PLATFORMS = [
  { value: 'instagram', label: 'Instagram', hint: 'через Meta Business OAuth', ready: true },
  { value: 'tiktok', label: 'TikTok', hint: 'TikTok for Developers — подключение ещё не реализовано', ready: false },
  { value: 'youtube', label: 'YouTube', hint: 'Google OAuth — подключение ещё не реализовано', ready: false },
]

function openModal() {
  open.value = true
}

function connect(platform: string) {
  open.value = false
  connectAccount(platform, props.appId)
}

defineExpose({ open: openModal })
</script>

<template>
  <UiModal :open="open" title="Подключить аккаунт" size="md" @close="open = false">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-muted">
        Подключение идёт только через официальный OAuth платформы. Логин и пароль
        мы не спрашиваем и не храним.
      </p>

      <div class="flex flex-col gap-2">
        <button
          v-for="p in PLATFORMS"
          :key="p.value"
          type="button"
          class="flex items-center gap-3 rounded-md border px-3 py-2.5 text-left"
          :class="p.ready
            ? 'cursor-pointer border-border bg-card hover:border-accent'
            : 'cursor-not-allowed border-dashed border-divider bg-surface'"
          :disabled="!p.ready"
          @click="p.ready && connect(p.value)"
        >
          <UiPlatformBadge :platform="p.value" />
          <span class="min-w-0 flex-1 text-sm" :class="p.ready ? 'text-muted' : 'text-subtle'">{{ p.hint }}</span>
          <Icon v-if="p.ready" name="mingcute:right-line" class="shrink-0 text-muted" />
        </button>
      </div>
    </div>

    <template #footer>
      <UiButton variant="ghost" @click="open = false">Отмена</UiButton>
    </template>
  </UiModal>
</template>

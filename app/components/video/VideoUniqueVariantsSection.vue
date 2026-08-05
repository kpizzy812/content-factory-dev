<script setup lang="ts">
/**
 * Уникализированные варианты ролика (Track F) — по одному на платформу.
 *
 * Оговорка про пределы уникализации стоит выше кнопок и не сворачивается:
 * сервис меняет file hash и базовые метаданные, но не обходит perceptual
 * hashing, и человек должен узнать это до того, как нажмёт.
 *
 * Список тянется только на клиенте (`server: false` в composable), поэтому
 * секция целиком за `ClientOnly`: иначе разметка сервера и клиента расходятся
 * и Vue бросает поддерево недорисованным.
 */
import type { VariantDto } from '~/composables/useVideoVariants'

const props = defineProps<{
  videoId: number
  videoFileUrl: string | null
}>()

const emit = defineEmits<{ created: [] }>()

type AllowedPlatform = 'tiktok' | 'youtube'

const TABS: Array<{ key: AllowedPlatform, label: string }> = [
  { key: 'tiktok', label: 'TikTok' },
  { key: 'youtube', label: 'YouTube' },
]

const activeTab = ref<AllowedPlatform>('tiktok')

const { data, pending, refresh } = useVideoVariants(() => props.videoId)
const { uniqifyVariant, isUniqifying, error } = useVideoVariantActions()

const variants = computed<VariantDto[]>(() => data.value?.data ?? [])

function variantFor(platform: AllowedPlatform): VariantDto | null {
  return variants.value.find(v => v.platform === platform) ?? null
}

const current = computed(() => variantFor(activeTab.value))

const currentProps = computed(() => {
  const v = current.value
  if (!v) return []
  const p = v.paramsJson
  return [
    { label: 'CRF', value: String(p.crf) },
    { label: 'Яркость', value: String(p.brightness) },
    { label: 'Контраст', value: String(p.contrast) },
    { label: 'Насыщенность', value: String(p.saturation) },
    { label: 'Скорость', value: String(p.speed) },
    { label: 'Обрезка, px', value: String(p.cropPx) },
    { label: 'Размер', value: `${(v.fileSize / 1024 / 1024).toFixed(2)} МБ` },
    { label: 'Длительность', value: `${v.durationSec.toFixed(2)} с` },
    { label: 'File hash', value: `${v.fileHash.slice(0, 16)}…` },
    { label: 'Params hash', value: v.paramsHash },
  ]
})

async function onCreate(platform: AllowedPlatform, force = false) {
  const result = await uniqifyVariant(props.videoId, platform, force)
  if (result) {
    await refresh()
    emit('created')
  }
}
</script>

<template>
  <ClientOnly>
    <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
      <h2 class="text-base font-semibold">Уникализированные варианты</h2>
      <span class="inline-flex h-5 items-center rounded-sm border border-warning-border bg-warning-bg px-1.5 text-micro text-warning">
        бета
      </span>
    </header>

    <div class="flex flex-col gap-3 p-3">
      <p class="rounded-md border border-info-border bg-info-bg p-2.5 text-sm text-muted">
        <span class="font-medium text-info">Что делает уникализация.</span>
        Меняет file hash и базовые метаданные — пережатие, лёгкие сдвиги яркости, контраста и
        тембра. Perceptual hashing TikTok и Meta это не обходит: от детектирования защищают
        творческие изменения — другой хук, другой CTA, другой монтаж.
      </p>

      <UiErrorState v-if="error" title="Уникализация не удалась" :message="error" @retry="refresh" />

      <div role="tablist" class="flex gap-0.5 border-b border-divider">
        <button
          v-for="t in TABS"
          :key="t.key"
          type="button"
          role="tab"
          :aria-selected="activeTab === t.key"
          class="flex h-8 cursor-pointer items-center gap-1.5 border-b-2 px-2.5 text-sm"
          :class="activeTab === t.key ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg'"
          @click="activeTab = t.key"
        >
          {{ t.label }}
          <UiStatusBadge v-if="variantFor(t.key)" status="done" size="xs" dot icon-only />
        </button>
      </div>

      <UiSkeleton v-if="pending && !variants.length" variant="details" :count="4" />

      <template v-else-if="current">
        <div class="flex flex-col gap-3 md:flex-row">
          <video
            :src="current.fileUrl"
            controls
            :autoplay="false"
            class="aspect-[9/16] w-full max-w-[236px] shrink-0 rounded-md border border-border bg-surface"
          >
            Ваш браузер не поддерживает воспроизведение видео.
          </video>

          <div class="min-w-0 flex-1">
            <UiKeyValue :items="currentProps" label-width="128px" />
          </div>
        </div>

        <div class="flex flex-wrap gap-1.5">
          <a :href="current.fileUrl" :download="`video-${videoId}-${activeTab}.mp4`">
            <UiButton variant="primary">
              <Icon name="mingcute:download-2-line" />
              Скачать
            </UiButton>
          </a>
          <UiButton :loading="isUniqifying" @click="onCreate(activeTab, true)">
            <Icon name="mingcute:refresh-2-line" />
            Перегенерировать
          </UiButton>
        </div>
      </template>

      <UiEmptyState
        v-else
        icon="mingcute:magic-1-line"
        :title="`Варианта для ${TABS.find(t => t.key === activeTab)?.label} ещё нет`"
        description="Создаётся из готового ролика за несколько секунд."
      >
        <UiButton
          variant="primary"
          :loading="isUniqifying"
          :disabled="!videoFileUrl"
          @click="onCreate(activeTab, false)"
        >
          Создать вариант
        </UiButton>
      </UiEmptyState>
    </div>
    </section>
  </ClientOnly>
</template>

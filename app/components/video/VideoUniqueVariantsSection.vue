<script setup lang="ts">
/**
 * Track F — секция уникализации видео для completed-видео.
 *
 * Показывает по одному варианту на платформу (tiktok / youtube).
 * При создании variant: POST /api/videos/[id]/uniqify → refresh list.
 * Force-перегенерация → uniqifyVariant(..., true).
 *
 * Disclaimer обязателен: сервис меняет только file hash + base metadata,
 * не обходит perceptual hashing.
 */

import type { VariantDto } from '~/composables/useVideoVariants'

interface Props {
  videoId: number
  videoFileUrl: string | null
}

const props = defineProps<Props>()
const emit = defineEmits<{ created: [] }>()

type AllowedPlatform = 'tiktok' | 'youtube'

const activeTab = ref<AllowedPlatform>('tiktok')

const { data, pending, refresh } = useVideoVariants(() => props.videoId)
const { uniqifyVariant, isUniqifying, error } = useVideoVariantActions()

const variants = computed<VariantDto[]>(() => data.value?.data ?? [])

const tiktokVariant = computed(() => variants.value.find(v => v.platform === 'tiktok') ?? null)
const youtubeVariant = computed(() => variants.value.find(v => v.platform === 'youtube') ?? null)

function variantFor(platform: AllowedPlatform): VariantDto | null {
  return platform === 'tiktok' ? tiktokVariant.value : youtubeVariant.value
}

async function onCreate(platform: AllowedPlatform, force = false) {
  const result = await uniqifyVariant(props.videoId, platform, force)
  if (result) {
    await refresh()
    emit('created')
  }
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatHash(hash: string): string {
  return `${hash.slice(0, 16)}…`
}

function formatDuration(sec: number): string {
  return `${sec.toFixed(2)} с`
}

const tabs: Array<{ key: AllowedPlatform; label: string; icon: string }> = [
  { key: 'tiktok', label: 'TikTok', icon: 'mingcute:tiktok-line' },
  { key: 'youtube', label: 'YouTube', icon: 'mingcute:youtube-line' },
]
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body space-y-3">
      <div class="flex items-center gap-2 flex-wrap">
        <h2 class="card-title text-base">
          <Icon name="mingcute:copy-2-line" class="text-base-content/60" />
          Уникализированные варианты
        </h2>
        <span class="badge badge-soft badge-warning badge-sm">бета</span>
      </div>

      <div role="alert" class="alert alert-info text-sm">
        <Icon name="mingcute:information-line" class="text-base" />
        <div class="space-y-1">
          <p class="font-medium">Что делает уникализация</p>
          <p class="text-xs opacity-90">
            Меняет file hash и базовые метаданные (re-encode, лёгкие сдвиги яркости/контраста/тембра).
            Не обходит perceptual hashing TikTok/Meta — реальная защита от детектирования
            делается творческими изменениями (новый хук, CTA, монтаж).
          </p>
        </div>
      </div>

      <div role="tablist" class="tabs tabs-lift">
        <a
          v-for="tab in tabs"
          :key="tab.key"
          role="tab"
          class="tab gap-1"
          :class="{ 'tab-active': activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          <Icon :name="tab.icon" class="text-sm" />
          {{ tab.label }}
          <span
            v-if="variantFor(tab.key)"
            class="badge badge-soft badge-success badge-xs ml-1"
          >есть</span>
        </a>
      </div>

      <div v-if="error" role="alert" class="alert alert-error text-sm">
        <Icon name="mingcute:warning-line" />
        <span>{{ error }}</span>
      </div>

      <div v-if="pending && !variants.length" class="flex justify-center py-6">
        <span class="loading loading-spinner loading-md" />
      </div>

      <template v-else>
        <div
          v-for="tab in tabs"
          v-show="activeTab === tab.key"
          :key="tab.key"
          class="space-y-3"
        >
          <template v-if="variantFor(tab.key)">
            <video
              :src="variantFor(tab.key)!.fileUrl"
              controls
              :autoplay="false"
              class="rounded-box bg-base-300 max-w-sm aspect-[9/16] mx-auto"
            >
              Ваш браузер не поддерживает воспроизведение видео.
            </video>

            <div class="overflow-x-auto">
              <table class="table table-xs">
                <tbody>
                  <tr>
                    <th class="w-1/3">CRF</th>
                    <td>{{ variantFor(tab.key)!.paramsJson.crf }}</td>
                  </tr>
                  <tr>
                    <th>Brightness</th>
                    <td>{{ variantFor(tab.key)!.paramsJson.brightness }}</td>
                  </tr>
                  <tr>
                    <th>Contrast</th>
                    <td>{{ variantFor(tab.key)!.paramsJson.contrast }}</td>
                  </tr>
                  <tr>
                    <th>Saturation</th>
                    <td>{{ variantFor(tab.key)!.paramsJson.saturation }}</td>
                  </tr>
                  <tr>
                    <th>Speed</th>
                    <td>{{ variantFor(tab.key)!.paramsJson.speed }}</td>
                  </tr>
                  <tr>
                    <th>Crop (px)</th>
                    <td>{{ variantFor(tab.key)!.paramsJson.cropPx }}</td>
                  </tr>
                  <tr>
                    <th>Размер файла</th>
                    <td>{{ formatBytes(variantFor(tab.key)!.fileSize) }}</td>
                  </tr>
                  <tr>
                    <th>Длительность</th>
                    <td>{{ formatDuration(variantFor(tab.key)!.durationSec) }}</td>
                  </tr>
                  <tr>
                    <th>File hash</th>
                    <td class="font-mono text-xs">{{ formatHash(variantFor(tab.key)!.fileHash) }}</td>
                  </tr>
                  <tr>
                    <th>Params hash</th>
                    <td class="font-mono text-xs">{{ variantFor(tab.key)!.paramsHash }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="flex flex-wrap gap-2">
              <a
                :href="variantFor(tab.key)!.fileUrl"
                :download="`video-${videoId}-${tab.key}.mp4`"
                class="btn btn-sm btn-primary gap-1"
              >
                <Icon name="mingcute:download-2-line" />
                Скачать
              </a>
              <button
                class="btn btn-sm btn-ghost gap-1"
                :disabled="isUniqifying"
                @click="onCreate(tab.key, true)"
              >
                <Icon name="mingcute:refresh-2-line" />
                Перегенерировать
              </button>
            </div>
          </template>

          <template v-else>
            <div class="flex flex-col items-center gap-3 py-6">
              <Icon name="mingcute:add-circle-line" class="text-3xl text-base-content/40" />
              <p class="text-sm text-base-content/70">
                Вариант для {{ tab.label }} ещё не создан
              </p>
              <button
                class="btn btn-sm btn-primary gap-1"
                :disabled="isUniqifying || !videoFileUrl"
                @click="onCreate(tab.key, false)"
              >
                <Icon name="mingcute:wand-line" />
                Создать вариант для {{ tab.label }}
              </button>
            </div>
          </template>
        </div>

        <div v-if="isUniqifying" class="flex items-center gap-2 text-sm text-base-content/60">
          <span class="loading loading-spinner loading-xs" />
          <span>Идёт уникализация — это займёт несколько секунд…</span>
        </div>
      </template>
    </div>
  </div>
</template>

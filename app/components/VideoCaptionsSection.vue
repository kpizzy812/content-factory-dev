<script setup lang="ts">
/**
 * Секция captions на странице /videos/[id].
 *
 * Показывает per-platform tabs (TikTok / YouTube / Instagram), позволяет
 * редактировать title/description/hashtags, перегенерировать через AI,
 * утверждать для постинга. При approved+fitsLimits Upload-нода подменит
 * placeholder на эти значения.
 */

import type { SocialPlatform } from '~~/shared/types/caption'

interface CaptionRow {
  id: string
  videoId: number
  platform: SocialPlatform
  title: string
  description: string | null
  hashtags: string[]
  charsTitle: number
  charsHashtagsTotal: number
  fitsLimits: boolean
  approvedAt: string | null
  modelVersion: string
  updatedAt: string
}

const props = defineProps<{
  videoId: number
}>()

const PLATFORMS: Array<{ value: SocialPlatform; label: string; icon: string }> = [
  { value: 'tiktok', label: 'TikTok', icon: 'mingcute:tiktok-line' },
  { value: 'youtube', label: 'YouTube', icon: 'mingcute:youtube-line' },
  { value: 'instagram', label: 'Instagram', icon: 'mingcute:ins-line' },
]

const PLATFORM_LIMITS: Record<SocialPlatform, { title: number; hashtagsBudget: number; hashtagsCount?: number }> = {
  tiktok: { title: 150, hashtagsBudget: 100, hashtagsCount: 5 },
  youtube: { title: 100, hashtagsBudget: 500, hashtagsCount: 15 },
  instagram: { title: 125, hashtagsBudget: 100, hashtagsCount: 30 },
}

const captions = ref<CaptionRow[]>([])
const loading = ref(false)
const generating = ref(false)
const errorMessage = ref<string | null>(null)
const activePlatform = ref<SocialPlatform>('tiktok')
const newHashtagInput = ref<Record<SocialPlatform, string>>({
  tiktok: '',
  youtube: '',
  instagram: '',
})

async function load() {
  loading.value = true
  errorMessage.value = null
  try {
    const res = await $fetch<{ data: CaptionRow[] }>(`/api/videos/${props.videoId}/captions`)
    captions.value = res.data
    if (captions.value.length > 0) {
      const first = captions.value[0]?.platform
      if (first) activePlatform.value = first
    }
  } catch (e: any) {
    errorMessage.value = e?.statusMessage ?? e?.message ?? 'Не удалось загрузить captions'
  } finally {
    loading.value = false
  }
}

const captionByPlatform = computed(() => {
  const map = new Map<SocialPlatform, CaptionRow>()
  for (const c of captions.value) map.set(c.platform, c)
  return map
})

const hasAnyCaption = computed(() => captions.value.length > 0)

function calcHashtagsLength(tags: string[]): number {
  if (tags.length === 0) return 0
  return tags.map((h) => `#${h}`).join(' ').length
}

async function generateAll() {
  generating.value = true
  errorMessage.value = null
  try {
    await $fetch(`/api/videos/${props.videoId}/captions`, {
      method: 'POST',
      body: { platforms: ['tiktok', 'youtube', 'instagram'], styleVariant: 'viral' },
    })
    await load()
  } catch (e: any) {
    errorMessage.value = e?.statusMessage ?? e?.message ?? 'Не удалось сгенерировать captions'
  } finally {
    generating.value = false
  }
}

async function regenerateOne(platform: SocialPlatform) {
  generating.value = true
  errorMessage.value = null
  try {
    await $fetch(`/api/videos/${props.videoId}/captions/regenerate`, {
      method: 'POST',
      body: { platforms: [platform] },
    })
    await load()
  } catch (e: any) {
    errorMessage.value = e?.statusMessage ?? e?.message ?? 'Не удалось перегенерировать'
  } finally {
    generating.value = false
  }
}

async function saveCaption(c: CaptionRow) {
  try {
    await $fetch(`/api/videos/${props.videoId}/captions/${c.platform}`, {
      method: 'PUT',
      body: {
        title: c.title,
        description: c.description,
        hashtags: c.hashtags,
      },
    })
    await load()
  } catch (e: any) {
    errorMessage.value = e?.statusMessage ?? e?.message ?? 'Не удалось сохранить'
  }
}

async function deleteCaption(c: CaptionRow) {
  if (!confirm(`Удалить caption для ${c.platform}? Upload вернётся к placeholder.`)) return
  try {
    await $fetch(`/api/videos/${props.videoId}/captions/${c.platform}`, {
      method: 'DELETE',
    })
    await load()
  } catch (e: any) {
    errorMessage.value = e?.statusMessage ?? e?.message ?? 'Не удалось удалить'
  }
}

async function toggleApprove(c: CaptionRow) {
  try {
    await $fetch(`/api/videos/${props.videoId}/captions/approve`, {
      method: 'PUT',
      body: { platform: c.platform, approve: !c.approvedAt },
    })
    await load()
  } catch (e: any) {
    errorMessage.value = e?.statusMessage ?? e?.message ?? 'Не удалось обновить статус утверждения'
  }
}

function addHashtag(c: CaptionRow) {
  const raw = newHashtagInput.value[c.platform].trim().replace(/^#+/, '')
  if (!raw || raw.includes(' ')) return
  if (c.hashtags.includes(raw)) return
  c.hashtags = [...c.hashtags, raw]
  newHashtagInput.value[c.platform] = ''
}

function removeHashtag(c: CaptionRow, h: string) {
  c.hashtags = c.hashtags.filter((x) => x !== h)
}

async function addHashtagAndSave(c: CaptionRow) {
  addHashtag(c)
  await saveCaption(c)
}

async function removeHashtagAndSave(c: CaptionRow, h: string) {
  removeHashtag(c, h)
  await saveCaption(c)
}

function copyAll(c: CaptionRow) {
  const text = [
    c.title,
    c.description ?? '',
    '',
    c.hashtags.map((h) => `#${h}`).join(' '),
  ]
    .filter(Boolean)
    .join('\n')
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {})
  }
}

onMounted(() => {
  load()
})
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 space-y-3">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <h2 class="card-title text-base flex items-center gap-2">
          <Icon name="mingcute:hashtag-line" class="text-secondary" />
          Описания и хэштеги
        </h2>
        <div class="flex gap-2 items-center">
          <button
            v-if="!hasAnyCaption"
            class="btn btn-sm btn-primary gap-1"
            :disabled="generating"
            @click="generateAll"
          >
            <span v-if="generating" class="loading loading-spinner loading-xs"></span>
            <Icon v-else name="mingcute:ai-line" />
            Сгенерировать AI
          </button>
        </div>
      </div>

      <div v-if="errorMessage" role="alert" class="alert alert-error py-2 text-xs">
        <Icon name="mingcute:warning-line" />
        <span>{{ errorMessage }}</span>
      </div>

      <div v-if="loading" class="flex justify-center py-4">
        <span class="loading loading-spinner loading-md"></span>
      </div>

      <div v-else-if="!hasAnyCaption" class="text-center py-6 text-sm text-base-content/60">
        Captions ещё не сгенерированы. Запустите AI, чтобы получить viral title и хэштеги для соцсетей.
      </div>

      <div v-else>
        <!-- Tabs -->
        <div role="tablist" class="tabs tabs-boxed bg-base-200 mb-3 w-fit">
          <button
            v-for="p in PLATFORMS"
            :key="p.value"
            role="tab"
            class="tab gap-1.5"
            :class="activePlatform === p.value ? 'tab-active' : ''"
            :disabled="!captionByPlatform.has(p.value)"
            @click="activePlatform = p.value"
          >
            <Icon :name="p.icon" class="text-xs" />
            <span class="text-xs">{{ p.label }}</span>
            <span
              v-if="captionByPlatform.has(p.value)"
              class="badge badge-xs"
              :class="
                captionByPlatform.get(p.value)?.approvedAt
                  ? 'badge-success'
                  : captionByPlatform.get(p.value)?.fitsLimits
                    ? 'badge-ghost'
                    : 'badge-error'
              "
            >
              {{
                captionByPlatform.get(p.value)?.approvedAt
                  ? '✓'
                  : captionByPlatform.get(p.value)?.fitsLimits
                    ? '–'
                    : '!'
              }}
            </span>
          </button>
        </div>

        <!-- Per-platform editor -->
        <template v-for="c in captions" :key="c.id">
          <div v-show="activePlatform === c.platform" class="space-y-3">
            <!-- Limits warning -->
            <div v-if="!c.fitsLimits" role="alert" class="alert alert-warning py-2 text-xs">
              <Icon name="mingcute:alert-fill" />
              <span>
                Не укладывается в лимиты {{ c.platform.toUpperCase() }}: title {{ c.charsTitle }}/{{
                  PLATFORM_LIMITS[c.platform].title
                }}, хэштеги {{ c.charsHashtagsTotal }}/{{ PLATFORM_LIMITS[c.platform].hashtagsBudget }}
                символов.
              </span>
            </div>

            <!-- Title -->
            <fieldset class="fieldset">
              <legend class="fieldset-legend flex items-center justify-between">
                <span>Title</span>
                <span
                  class="text-[10px]"
                  :class="c.title.length > PLATFORM_LIMITS[c.platform].title ? 'text-error' : 'text-base-content/50'"
                >
                  {{ c.title.length }} / {{ PLATFORM_LIMITS[c.platform].title }}
                </span>
              </legend>
              <input
                v-model="c.title"
                class="input input-sm w-full"
                @blur="saveCaption(c)"
              />
            </fieldset>

            <!-- Description (для YT/IG) -->
            <fieldset v-if="c.platform !== 'tiktok'" class="fieldset">
              <legend class="fieldset-legend">Description</legend>
              <textarea
                v-model="c.description"
                class="textarea textarea-sm w-full"
                rows="3"
                placeholder="Опционально"
                @blur="saveCaption(c)"
              ></textarea>
            </fieldset>

            <!-- Hashtags -->
            <fieldset class="fieldset">
              <legend class="fieldset-legend flex items-center justify-between">
                <span>Хэштеги</span>
                <span
                  class="text-[10px]"
                  :class="
                    calcHashtagsLength(c.hashtags) > PLATFORM_LIMITS[c.platform].hashtagsBudget
                      ? 'text-error'
                      : 'text-base-content/50'
                  "
                >
                  {{ c.hashtags.length }}{{
                    PLATFORM_LIMITS[c.platform].hashtagsCount
                      ? ` / ${PLATFORM_LIMITS[c.platform].hashtagsCount}`
                      : ''
                  }}
                  · {{ calcHashtagsLength(c.hashtags) }}/{{ PLATFORM_LIMITS[c.platform].hashtagsBudget }} символов
                </span>
              </legend>
              <div class="flex flex-wrap gap-1.5 mb-2">
                <span
                  v-for="h in c.hashtags"
                  :key="h"
                  class="badge badge-ghost gap-0.5 pr-0.5"
                >
                  #{{ h }}
                  <button
                    class="size-6 rounded-full inline-flex items-center justify-center text-base-content/40 hover:text-error hover:bg-base-300"
                    :aria-label="`Удалить хэштег #${h}`"
                    @click="removeHashtagAndSave(c, h)"
                  >
                    <Icon name="mingcute:close-line" class="text-sm" />
                  </button>
                </span>
              </div>
              <div class="flex gap-2">
                <input
                  v-model="newHashtagInput[c.platform]"
                  type="text"
                  class="input input-sm flex-1"
                  placeholder="без # и пробелов"
                  @keydown.enter.prevent="addHashtagAndSave(c)"
                />
                <button
                  class="btn btn-sm btn-primary"
                  :disabled="!newHashtagInput[c.platform].trim()"
                  @click="addHashtagAndSave(c)"
                >
                  Добавить
                </button>
              </div>
            </fieldset>

            <!-- Actions -->
            <div class="flex flex-wrap items-center gap-2 pt-1">
              <button
                class="btn btn-sm gap-1"
                :class="c.approvedAt ? 'btn-success' : 'btn-outline btn-success'"
                :disabled="!c.fitsLimits && !c.approvedAt"
                @click="toggleApprove(c)"
              >
                <Icon
                  :name="c.approvedAt ? 'mingcute:check-fill' : 'mingcute:check-line'"
                />
                {{ c.approvedAt ? 'Утверждено' : 'Утвердить для постинга' }}
              </button>
              <button
                class="btn btn-sm btn-ghost gap-1"
                :disabled="generating"
                @click="regenerateOne(c.platform)"
              >
                <span v-if="generating" class="loading loading-spinner loading-xs"></span>
                <Icon v-else name="mingcute:refresh-2-line" />
                Сгенерировать заново
              </button>
              <button
                class="btn btn-sm btn-ghost gap-1"
                @click="copyAll(c)"
              >
                <Icon name="mingcute:copy-2-line" />
                Скопировать
              </button>
              <button
                class="btn btn-sm btn-ghost text-error gap-1"
                @click="deleteCaption(c)"
              >
                <Icon name="mingcute:delete-2-line" />
                Удалить
              </button>
              <span class="text-[10px] text-base-content/40 ml-auto">
                {{ c.modelVersion }}
              </span>
            </div>
          </div>
        </template>

        <!-- Generate missing platforms -->
        <div
          v-if="captions.length < 3"
          class="mt-4 pt-3 border-t border-base-200 flex flex-wrap items-center gap-2"
        >
          <span class="text-xs text-base-content/60">Сгенерировать для других платформ:</span>
          <button
            v-for="p in PLATFORMS.filter((p) => !captionByPlatform.has(p.value))"
            :key="p.value"
            class="btn btn-xs btn-outline gap-1"
            :disabled="generating"
            @click="regenerateOne(p.value)"
          >
            <Icon :name="p.icon" />
            {{ p.label }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

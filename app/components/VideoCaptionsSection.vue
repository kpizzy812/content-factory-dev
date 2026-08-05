<script setup lang="ts">
/**
 * Описания и хэштеги ролика — по одному набору на платформу.
 *
 * Счётчики лимитов стоят у самих полей, а не общей плашкой сверху: правят
 * конкретное поле, и знать, сколько в нём осталось, нужно в момент правки.
 *
 * Утвердить можно только то, что укладывается в лимиты — иначе нода публикации
 * возьмёт заведомо обрезаемый текст.
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

const props = defineProps<{ videoId: number }>()

const PLATFORMS: Array<{ value: SocialPlatform, label: string }> = [
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'instagram', label: 'Instagram' },
]

const LIMITS: Record<SocialPlatform, { title: number, hashtagsBudget: number, hashtagsCount?: number }> = {
  tiktok: { title: 150, hashtagsBudget: 100, hashtagsCount: 5 },
  youtube: { title: 100, hashtagsBudget: 500, hashtagsCount: 15 },
  instagram: { title: 125, hashtagsBudget: 100, hashtagsCount: 30 },
}

const toast = useToast()

const captions = ref<CaptionRow[]>([])
const loading = ref(false)
const generating = ref(false)
const errorMessage = ref<string | null>(null)
const activePlatform = ref<SocialPlatform>('tiktok')
const newHashtag = ref<Record<SocialPlatform, string>>({ tiktok: '', youtube: '', instagram: '' })
const pendingDelete = ref<CaptionRow | null>(null)

const byPlatform = computed(() => new Map(captions.value.map(c => [c.platform, c])))
const hasAny = computed(() => captions.value.length > 0)
const active = computed(() => byPlatform.value.get(activePlatform.value) ?? null)
const missing = computed(() => PLATFORMS.filter(p => !byPlatform.value.has(p.value)))

function fail(e: unknown, fallback: string) {
  errorMessage.value = (e as { statusMessage?: string, message?: string })?.statusMessage
    ?? (e instanceof Error ? e.message : fallback)
}

async function load() {
  loading.value = true
  errorMessage.value = null
  try {
    const res = await $fetch<{ data: CaptionRow[] }>(`/api/videos/${props.videoId}/captions`)
    captions.value = res.data
    const first = captions.value[0]?.platform
    if (first && !byPlatform.value.has(activePlatform.value)) activePlatform.value = first
  }
  catch (e) { fail(e, 'Не удалось загрузить описания') }
  finally { loading.value = false }
}

function hashtagsLength(tags: string[]): number {
  return tags.length ? tags.map(h => `#${h}`).join(' ').length : 0
}

// Счётчики живут подсказкой под полем и краснеют ошибкой при переполнении —
// отдельной плашки сверху для этого не нужно.
const titleOverflow = computed(() =>
  !!active.value && active.value.title.length > LIMITS[active.value.platform].title)

const titleCounter = computed(() => {
  if (!active.value) return undefined
  return `${active.value.title.length} из ${LIMITS[active.value.platform].title}`
})

const hashtagOverflow = computed(() =>
  !!active.value && hashtagsLength(active.value.hashtags) > LIMITS[active.value.platform].hashtagsBudget)

const hashtagCounter = computed(() => {
  const c = active.value
  if (!c) return undefined
  const limit = LIMITS[c.platform]
  const count = limit.hashtagsCount ? `${c.hashtags.length} из ${limit.hashtagsCount}` : `${c.hashtags.length}`
  return `${count} · ${hashtagsLength(c.hashtags)} из ${limit.hashtagsBudget} символов`
})

async function generateAll() {
  generating.value = true
  errorMessage.value = null
  try {
    await $fetch(`/api/videos/${props.videoId}/captions`, {
      method: 'POST',
      body: { platforms: ['tiktok', 'youtube', 'instagram'], styleVariant: 'viral' },
    })
    await load()
  }
  catch (e) { fail(e, 'Не удалось сгенерировать описания') }
  finally { generating.value = false }
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
  }
  catch (e) { fail(e, 'Не удалось перегенерировать') }
  finally { generating.value = false }
}

async function saveCaption(c: CaptionRow) {
  try {
    await $fetch(`/api/videos/${props.videoId}/captions/${c.platform}`, {
      method: 'PUT',
      body: { title: c.title, description: c.description, hashtags: c.hashtags },
    })
    await load()
  }
  catch (e) { fail(e, 'Не удалось сохранить') }
}

async function confirmDelete() {
  const c = pendingDelete.value
  if (!c) return
  pendingDelete.value = null
  try {
    await $fetch(`/api/videos/${props.videoId}/captions/${c.platform}`, { method: 'DELETE' })
    await load()
  }
  catch (e) { fail(e, 'Не удалось удалить') }
}

async function toggleApprove(c: CaptionRow) {
  try {
    await $fetch(`/api/videos/${props.videoId}/captions/approve`, {
      method: 'PUT',
      body: { platform: c.platform, approve: !c.approvedAt },
    })
    await load()
  }
  catch (e) { fail(e, 'Не удалось изменить утверждение') }
}

async function addHashtag(c: CaptionRow) {
  const raw = newHashtag.value[c.platform].trim().replace(/^#+/, '')
  if (!raw || raw.includes(' ') || c.hashtags.includes(raw)) return
  c.hashtags = [...c.hashtags, raw]
  newHashtag.value[c.platform] = ''
  await saveCaption(c)
}

async function removeHashtag(c: CaptionRow, h: string) {
  c.hashtags = c.hashtags.filter(x => x !== h)
  await saveCaption(c)
}

function copyAll(c: CaptionRow) {
  const text = [c.title, c.description ?? '', '', c.hashtags.map(h => `#${h}`).join(' ')]
    .filter(Boolean)
    .join('\n')
  navigator.clipboard?.writeText(text).then(
    () => toast.success('Описание скопировано'),
    () => {},
  )
}

/** Статус набора в общем словаре: утверждён, не влезает, просто есть. */
function statusOf(c: CaptionRow) {
  if (c.approvedAt) return 'done' as const
  return c.fitsLimits ? ('draft' as const) : ('failed' as const)
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-3">
    <UiErrorState v-if="errorMessage" title="Описания" :message="errorMessage" @retry="load" />

    <UiSkeleton v-if="loading && !hasAny" variant="details" :count="5" />

    <UiEmptyState
      v-else-if="!hasAny"
      icon="mingcute:hashtag-line"
      title="Описаний ещё нет"
      description="Модель соберёт заголовок и хэштеги под каждую площадку из сценария ролика."
    >
      <UiButton variant="primary" :loading="generating" @click="generateAll">
        Сгенерировать
      </UiButton>
    </UiEmptyState>

    <template v-else>
      <div role="tablist" class="flex gap-0.5 border-b border-divider">
        <button
          v-for="p in PLATFORMS"
          :key="p.value"
          type="button"
          role="tab"
          :aria-selected="activePlatform === p.value"
          :disabled="!byPlatform.has(p.value)"
          class="flex h-8 items-center gap-1.5 border-b-2 px-2.5 text-sm"
          :class="[
            activePlatform === p.value ? 'border-accent font-medium text-fg' : 'border-transparent text-muted',
            byPlatform.has(p.value) ? 'cursor-pointer hover:text-fg' : 'cursor-not-allowed text-subtle',
          ]"
          @click="activePlatform = p.value"
        >
          {{ p.label }}
          <UiStatusBadge
            v-if="byPlatform.get(p.value)"
            :status="statusOf(byPlatform.get(p.value)!)"
            size="xs"
            dot
            icon-only
          />
        </button>
      </div>

      <template v-if="active">
        <p
          v-if="!active.fitsLimits"
          class="rounded-md border border-warning-border bg-warning-bg p-2.5 text-sm text-warning"
        >
          Не укладывается в лимиты {{ PLATFORMS.find(p => p.value === active!.platform)?.label }}:
          заголовок {{ active.charsTitle }} из {{ LIMITS[active.platform].title }},
          хэштеги {{ active.charsHashtagsTotal }} из {{ LIMITS[active.platform].hashtagsBudget }} символов.
          Утвердить такой набор нельзя.
        </p>

        <UiField
          label="Заголовок"
          :hint="titleCounter"
          :error="titleOverflow ? titleCounter : undefined"
        >
          <UiInput v-model="active.title" :invalid="titleOverflow" @blur="saveCaption(active!)" />
        </UiField>

        <UiField v-if="active.platform !== 'tiktok'" label="Описание">
          <UiTextarea
            v-model="active.description"
            :rows="3"
            placeholder="Необязательно"
            @blur="saveCaption(active!)"
          />
        </UiField>

        <UiField
          label="Хэштеги"
          :hint="hashtagCounter"
          :error="hashtagOverflow ? hashtagCounter : undefined"
        >
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="h in active.hashtags"
              :key="h"
              class="inline-flex h-[22px] items-center gap-1 rounded-sm border border-border bg-card pr-1 pl-2 text-sm text-muted"
            >
              #{{ h }}
              <button
                type="button"
                class="cursor-pointer text-subtle hover:text-danger"
                :aria-label="`Удалить хэштег #${h}`"
                @click="removeHashtag(active!, h)"
              >
                <Icon name="mingcute:close-line" />
              </button>
            </span>
            <span v-if="!active.hashtags.length" class="text-sm text-subtle">пока ни одного</span>
          </div>

          <div class="mt-2 flex gap-2">
            <UiInput
              v-model="newHashtag[active.platform]"
              placeholder="без решётки и пробелов"
              class="flex-1"
              @keydown.enter.prevent="addHashtag(active!)"
            />
            <UiButton :disabled="!newHashtag[active.platform].trim()" @click="addHashtag(active!)">
              Добавить
            </UiButton>
          </div>
        </UiField>

        <div class="flex flex-wrap items-center gap-1.5 border-t border-divider pt-2.5">
          <UiButton
            :variant="active.approvedAt ? 'primary' : 'secondary'"
            :disabled="!active.fitsLimits && !active.approvedAt"
            @click="toggleApprove(active!)"
          >
            <Icon name="mingcute:check-line" />
            {{ active.approvedAt ? 'Утверждено' : 'Утвердить для публикации' }}
          </UiButton>
          <UiButton :loading="generating" @click="regenerateOne(active!.platform)">
            Сгенерировать заново
          </UiButton>
          <UiButton variant="ghost" @click="copyAll(active!)">Скопировать</UiButton>
          <UiButton variant="ghost" @click="pendingDelete = active">Удалить</UiButton>
          <span class="ml-auto font-mono text-micro text-subtle">{{ active.modelVersion }}</span>
        </div>
      </template>

      <div v-if="missing.length" class="flex flex-wrap items-center gap-1.5 border-t border-divider pt-2.5">
        <span class="text-sm text-muted">Сгенерировать для других площадок:</span>
        <UiButton
          v-for="p in missing"
          :key="p.value"
          :loading="generating"
          @click="regenerateOne(p.value)"
        >
          {{ p.label }}
        </UiButton>
      </div>
    </template>

    <UiModal
      :open="pendingDelete !== null"
      title="Удалить описание?"
      size="sm"
      @close="pendingDelete = null"
    >
      <p class="text-sm text-muted">
        Набор для {{ PLATFORMS.find(p => p.value === pendingDelete?.platform)?.label }} будет удалён,
        и публикация вернётся к заготовке по умолчанию.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="pendingDelete = null">Отмена</UiButton>
        <UiButton variant="danger" @click="confirmDelete">Удалить</UiButton>
      </template>
    </UiModal>
  </div>
</template>

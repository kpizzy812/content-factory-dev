<script setup lang="ts">
import { uploadStatus, UPLOAD_STATUS_LABELS } from '~/components/upload/UploadStatusMap'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'social-upload' })

const route = useRoute()
const uploadId = computed(() => route.params.id as string)

const { data, pending, error, refresh } = useUploadDetail(uploadId)
const upload = computed(() => data.value?.data ?? null)

useHead({ title: computed(() => `${upload.value?.title ?? 'Публикация'} — публикация`) })

const PLATFORM_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return null
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// ─── Навигация по соседям ────────────────────────────────────────────────────
const filters = useUploadFiltersStore()
const { data: listData } = useUploads(computed(() => filters.query))

const siblings = computed(() => listData.value?.data?.map((u: { id: number }) => u.id) ?? [])
const currentIndex = computed(() => siblings.value.indexOf(Number(uploadId.value)))
const listMeta = computed(() => listData.value?.meta ?? null)
const inList = computed(() => currentIndex.value >= 0)

const hasPrev = computed(() => inList.value && (currentIndex.value > 0 || filters.page > 1))
const hasNext = computed(() => inList.value && (
  currentIndex.value < siblings.value.length - 1
  || (!!listMeta.value && filters.page < listMeta.value.totalPages)))

const position = computed(() => {
  if (!inList.value || !listMeta.value) return undefined
  const absolute = (filters.page - 1) * filters.perPage + currentIndex.value + 1
  return `${absolute} из ${listMeta.value.total}`
})

async function goSibling(delta: -1 | 1) {
  const next = siblings.value[currentIndex.value + delta]
  if (next != null) {
    await navigateTo(`/uploads/${next}`)
    return
  }
  const targetPage = filters.page + delta
  if (targetPage < 1 || (listMeta.value && targetPage > listMeta.value.totalPages)) return

  filters.page = targetPage
  await nextTick()
  const edge = delta === 1 ? siblings.value[0] : siblings.value[siblings.value.length - 1]
  if (edge != null) await navigateTo(`/uploads/${edge}`)
}

// ─── Свойства и связи ────────────────────────────────────────────────────────
const properties = computed(() => {
  const u = upload.value
  if (!u) return []
  return [
    { label: 'Аккаунт', value: u.socialAccount?.displayName, mono: false },
    { label: 'Платформа', value: u.socialAccount ? (PLATFORM_LABELS[u.socialAccount.platform] ?? u.socialAccount.platform) : null, mono: false },
    { label: 'Запланирована', value: fmtDate(u.scheduledAt) },
    { label: 'Создана', value: fmtDate(u.createdAt) },
    { label: 'Последняя попытка', value: fmtDate(u.lastAttemptAt) },
    { label: 'Попыток', value: u.attemptCount },
  ]
})

const relations = computed(() => {
  const u = upload.value
  if (!u) return []
  const chain: Array<{ label: string, title: string, to?: string, current?: boolean }> = []
  if (u.video?.scenario) {
    chain.push({ label: 'Сценарий', title: `scn_${u.video.scenario.id}`, to: `/scenarios/${u.video.scenario.id}` })
  }
  if (u.video) {
    chain.push({ label: 'Ролик', title: `vid_${u.video.id}`, to: `/videos/${u.video.id}` })
  }
  chain.push({ label: 'Публикация', title: `pub_${u.id}`, current: true })
  return chain
})

const ATTEMPT_TONE: Record<string, string> = {
  published: 'border-success-border bg-success-bg text-success',
  failed: 'border-danger-border bg-danger-bg text-danger',
  running: 'border-info-border bg-info-bg text-info',
}

const ATTEMPT_LABELS: Record<string, string> = {
  published: 'опубликована',
  failed: 'упала',
  running: 'идёт',
  pending: 'ожидает',
}
</script>

<template>
  <div>
    <UiSkeleton v-if="pending && !upload" variant="details" :count="5" />

    <UiErrorState
      v-else-if="error"
      title="Не удалось загрузить публикацию"
      :message="error.message"
      @retry="refresh"
    />

    <template v-else-if="upload">
      <DetailHeader
        :title="upload.title || 'Без названия'"
        :code="`pub_${upload.id}`"
        back-to="/uploads"
        back-label="К публикациям"
        :position="position"
        :has-prev="hasPrev"
        :has-next="hasNext"
        @prev="goSibling(-1)"
        @next="goSibling(1)"
      >
        <template #badges>
          <UiStatusBadge
            :status="uploadStatus(upload.status)"
            :title="UPLOAD_STATUS_LABELS[upload.status] ?? upload.status"
          />
          <UiPlatformBadge v-if="upload.socialAccount" :platform="upload.socialAccount.platform" />
        </template>

        <template #actions>
          <UploadActions
            :upload-id="upload.id"
            :status="upload.status"
            :platform-post-url="upload.platformPostUrl"
            :blocked-by-env="upload.blockedByEnv"
            :attempt-count="upload.attemptCount"
            @retried="refresh"
          />
        </template>
      </DetailHeader>

      <div class="flex flex-wrap items-center gap-4 px-1 pb-3 text-sm text-muted">
        <span class="flex items-center gap-1.5">
          Создана
          <span class="tnum font-mono">{{ fmtDate(upload.createdAt) }}</span>
        </span>
        <span v-if="upload.scheduledAt" class="flex items-center gap-1.5">
          Запланирована
          <span class="tnum font-mono text-fg">{{ fmtDate(upload.scheduledAt) }}</span>
        </span>
        <DetailRelations :chain="relations" class="ml-auto" />
      </div>

      <div class="grid items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_392px]">
        <div class="flex min-w-0 flex-col gap-3">
          <div
            v-if="upload.blockedByEnv"
            role="note"
            class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm"
          >
            <Icon name="mingcute:lock-line" class="mt-0.5 shrink-0 text-warning" />
            <span>
              <span class="font-medium text-warning">Постинг выключен.</span>
              Задача цела и уедет, когда включат <code class="font-mono">ENABLE_SOCIAL_POSTING</code>.
            </span>
          </div>

          <div
            v-else-if="upload.status === 'failed' && upload.errorMessage"
            role="alert"
            class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
          >
            <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
            <span>{{ upload.errorMessage }}</span>
          </div>

          <section class="rounded-lg border border-border bg-panel p-3.5">
            <h2 class="mb-2 text-micro tracking-[.06em] text-subtle uppercase">Текст публикации</h2>
            <p v-if="upload.description" class="text-sm whitespace-pre-line">{{ upload.description }}</p>
            <p v-else class="text-sm text-subtle">Описание не заполнено.</p>

            <div v-if="upload.hashtags?.length" class="mt-2.5 flex flex-wrap gap-1">
              <span
                v-for="tag in upload.hashtags"
                :key="tag"
                class="rounded-sm border border-divider px-1.5 py-0.5 font-mono text-micro text-muted"
              >
                #{{ tag }}
              </span>
            </div>
          </section>

          <section v-if="upload.attempts?.length" class="rounded-lg border border-border bg-panel p-3.5">
            <h2 class="mb-2 text-micro tracking-[.06em] text-subtle uppercase">
              Попытки публикации · {{ upload.attempts.length }}
            </h2>

            <div
              v-for="attempt in upload.attempts"
              :key="attempt.id"
              class="border-b border-divider py-2 last:border-b-0"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class="tnum font-mono text-sm">#{{ attempt.attemptNumber }}</span>
                <span
                  class="rounded-sm border px-1.5 py-0.5 text-micro"
                  :class="ATTEMPT_TONE[attempt.status] ?? 'border-divider text-muted'"
                >
                  {{ ATTEMPT_LABELS[attempt.status] ?? attempt.status }}
                </span>
                <span class="tnum ml-auto font-mono text-micro text-subtle">
                  {{ fmtDate(attempt.startedAt) }}
                  <template v-if="attempt.finishedAt"> → {{ fmtDate(attempt.finishedAt) }}</template>
                </span>
              </div>
              <p v-if="attempt.errorMessage" class="mt-0.5 text-sm text-danger">{{ attempt.errorMessage }}</p>
              <p v-if="attempt.externalPostId" class="mt-0.5 font-mono text-micro text-subtle">
                идентификатор поста: {{ attempt.externalPostId }}
              </p>
            </div>
          </section>
        </div>

        <div class="flex flex-col gap-3">
          <section class="rounded-lg border border-border bg-panel p-3.5">
            <h2 class="mb-2 text-micro tracking-[.06em] text-subtle uppercase">Свойства</h2>
            <UiKeyValue :items="properties" label-width="124px" />
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

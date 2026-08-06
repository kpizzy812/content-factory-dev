<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'script-generator' })

const route = useRoute()
const ideaId = computed(() => route.params.id as string)

const { data, pending, error, refresh, progress } = useIdeaDetail(ideaId)
const idea = computed(() => data.value?.data ?? null)

const toast = useToast()

useHead({ title: computed(() => `${idea.value?.title ?? 'Идея'} — идея`) })

// ─── Редактирование ──────────────────────────────────────────────────────────
const isEditing = ref(false)
const { updateIdea } = useIdeaActions()

const editForm = reactive({
  title: '',
  hook: '',
  body: '',
  cta: '',
  visualStyle: '',
  whyViral: '',
  operatorNotes: '',
  tags: '',
})

const isSaving = ref(false)
const editError = ref('')

function startEditing() {
  if (!idea.value) return
  editForm.title = idea.value.title ?? ''
  editForm.hook = idea.value.hook ?? ''
  editForm.body = idea.value.body ?? ''
  editForm.cta = idea.value.cta ?? ''
  editForm.visualStyle = idea.value.visualStyle ?? ''
  editForm.whyViral = idea.value.whyViral ?? ''
  editForm.operatorNotes = idea.value.operatorNotes ?? ''
  editForm.tags = (idea.value.tags ?? []).join(', ')
  isEditing.value = true
}

async function handleSave() {
  isSaving.value = true
  editError.value = ''
  try {
    await updateIdea(Number(ideaId.value), {
      title: editForm.title,
      hook: editForm.hook,
      body: editForm.body,
      cta: editForm.cta,
      visualStyle: editForm.visualStyle,
      whyViral: editForm.whyViral,
      operatorNotes: editForm.operatorNotes,
      tags: editForm.tags.split(',').map(t => t.trim()).filter(Boolean),
    })
    isEditing.value = false
    await refresh()
    toast.success('Идея сохранена')
  }
  catch {
    editError.value = 'Не удалось сохранить. Попробуйте ещё раз.'
  }
  finally {
    isSaving.value = false
  }
}

const EDIT_FIELDS = [
  { key: 'hook', label: 'Хук', rows: 3 },
  { key: 'body', label: 'Основная часть', rows: 5 },
  { key: 'cta', label: 'Призыв к действию', rows: 3 },
  { key: 'visualStyle', label: 'Визуальный стиль', rows: 3 },
  { key: 'whyViral', label: 'Почему залетело', rows: 3 },
  { key: 'operatorNotes', label: 'Заметки оператора', rows: 3 },
] as const

// ─── Вкладки ─────────────────────────────────────────────────────────────────
const tab = ref<'analysis' | 'reference' | 'transcript' | 'history' | 'sync'>('analysis')
const hasReferenceBreakdown = computed(() => !!idea.value?.analysis?.referenceBreakdown)

const tabs = computed(() => [
  { key: 'analysis' as const, label: 'Разбор' },
  { key: 'reference' as const, label: 'Референс', marked: hasReferenceBreakdown.value },
  { key: 'transcript' as const, label: 'Транскрипт' },
  { key: 'history' as const, label: 'История' },
  { key: 'sync' as const, label: 'Синхронизация', marked: !!idea.value?.syncStatus && idea.value.syncStatus !== 'none' },
])

// ─── Навигация по соседям ────────────────────────────────────────────────────
const filters = useIdeaFiltersStore()
const { data: listData } = useIdeas(computed(() => filters.query))

const siblings = computed(() => listData.value?.data?.map((i: { id: number }) => i.id) ?? [])
const currentIndex = computed(() => siblings.value.indexOf(Number(ideaId.value)))
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
    await navigateTo(`/ideas/${next}`)
    return
  }
  const targetPage = filters.page + delta
  if (targetPage < 1 || (listMeta.value && targetPage > listMeta.value.totalPages)) return

  filters.page = targetPage
  await nextTick()
  const edge = delta === 1 ? siblings.value[0] : siblings.value[siblings.value.length - 1]
  if (edge != null) await navigateTo(`/ideas/${edge}`)
}

// ─── Утилиты ─────────────────────────────────────────────────────────────────
const MEDIA_LABELS: Record<string, { label: string, icon: string }> = {
  video: { label: 'Видео', icon: 'mingcute:video-line' },
  image: { label: 'Изображение', icon: 'mingcute:pic-line' },
}

const ACTION_LABELS: Record<string, string> = {
  create: 'Создание',
  edit: 'Редактирование',
  delete: 'Удаление',
  restore: 'Восстановление',
  reanalyze: 'Повторный разбор',
  send_to_scenario: 'Отправка в сценарии',
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
</script>

<template>
  <div>
    <UiSkeleton v-if="pending && !idea" variant="details" :count="6" />

    <UiErrorState
      v-else-if="error"
      title="Не удалось загрузить идею"
      :message="error.message"
      @retry="refresh"
    />

    <template v-else-if="idea">
      <DetailHeader
        :title="idea.title || idea.sourceUrl || 'Идея'"
        :code="`idea_${idea.id}`"
        back-to="/ideas"
        back-label="К идеям"
        :position="position"
        :has-prev="hasPrev"
        :has-next="hasNext"
        @prev="goSibling(-1)"
        @next="goSibling(1)"
      >
        <template #badges>
          <IdeaStatusBadge :status="idea.status" :analysis-status="idea.analysisStatus" />
          <UiPlatformBadge v-if="idea.platform" :platform="idea.platform" />
        </template>

        <template #actions>
          <IdeaActions
            :idea-id="idea.id"
            :current-status="idea.status"
            :analysis-status="idea.analysisStatus"
            :reference-status="idea.referenceStatus"
            :has-reference-breakdown="hasReferenceBreakdown"
            @updated="isEditing = false; refresh()"
            @edit="startEditing"
            @deleted="navigateTo('/ideas')"
          />
        </template>
      </DetailHeader>

      <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 pb-3 text-sm text-muted">
        <IdeaSourceBadge :source="idea.source" :sync-status="idea.syncStatus" :external-id="idea.externalId" />
        <span v-if="idea.mediaType && MEDIA_LABELS[idea.mediaType]" class="flex items-center gap-1.5">
          <Icon :name="MEDIA_LABELS[idea.mediaType]!.icon" />
          {{ MEDIA_LABELS[idea.mediaType]!.label }}
        </span>
        <span v-if="idea.app" class="flex items-center gap-1.5">
          Приложение
          <span class="text-fg">{{ idea.app.name }}</span>
        </span>
        <span class="flex items-center gap-1.5">
          Создана
          <span class="tnum font-mono">{{ formatDate(idea.createdAt) }}</span>
        </span>
        <a
          v-if="idea.sourceUrl"
          :href="idea.sourceUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="flex min-w-0 items-center gap-1.5 hover:text-fg"
        >
          <Icon name="mingcute:link-line" class="shrink-0" />
          <span class="max-w-80 truncate font-mono text-micro">{{ idea.sourceUrl }}</span>
        </a>
      </div>

      <div class="flex flex-col gap-3">
        <div
          v-if="idea.status === 'failed'"
          role="alert"
          class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
        >
          <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
          <span>{{ idea.errorMessage || 'Идея не разобралась. Причину модель не сообщила.' }}</span>
        </div>

        <div
          v-if="idea.status === 'processing'"
          role="status"
          class="flex items-center gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-sm text-info"
        >
          <Icon name="mingcute:loading-line" class="shrink-0 animate-spin" />
          Идея разбирается.
        </div>

        <div v-if="idea.tags?.length" class="flex flex-wrap gap-1">
          <span
            v-for="tag in idea.tags"
            :key="tag"
            class="rounded-sm border border-divider px-1.5 py-0.5 text-micro text-muted"
          >
            {{ tag }}
          </span>
        </div>

        <section v-if="idea.operatorNotes && !isEditing" class="rounded-lg border border-border bg-surface p-3">
          <div class="mb-1 flex items-center gap-1.5 text-micro text-subtle">
            <Icon name="mingcute:notebook-line" />
            Заметки оператора
          </div>
          <p class="text-sm whitespace-pre-wrap">{{ idea.operatorNotes }}</p>
        </section>

        <!-- Редактор -->
        <section v-if="isEditing" class="overflow-hidden rounded-lg border border-border bg-panel">
          <header class="flex items-center gap-2 border-b border-border bg-card px-3.5 py-2.5">
            <Icon name="mingcute:edit-line" class="text-accent" />
            <h2 class="text-sm font-medium">Редактирование идеи</h2>
          </header>

          <div class="flex flex-col gap-3 p-3.5">
            <UiField label="Заголовок">
              <UiInput v-model="editForm.title" placeholder="Заголовок идеи" />
            </UiField>

            <UiField v-for="f in EDIT_FIELDS" :key="f.key" :label="f.label">
              <UiTextarea v-model="editForm[f.key]" :rows="f.rows" :placeholder="f.label" />
            </UiField>

            <UiField label="Теги" hint="Через запятую">
              <UiInput v-model="editForm.tags" placeholder="тренд, юмор, обзор" />
            </UiField>

            <div
              v-if="editError"
              role="alert"
              class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
            >
              <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
              <span>{{ editError }}</span>
            </div>

            <div class="flex justify-end gap-1.5">
              <UiButton variant="ghost" :disabled="isSaving" @click="isEditing = false">Отмена</UiButton>
              <UiButton variant="primary" :loading="isSaving" @click="handleSave">Сохранить</UiButton>
            </div>
          </div>
        </section>

        <!-- Вкладки -->
        <template v-else>
          <div role="tablist" class="flex flex-wrap gap-0.5 border-b border-border">
            <button
              v-for="t in tabs"
              :key="t.key"
              type="button"
              role="tab"
              :aria-selected="tab === t.key"
              class="flex h-[34px] cursor-pointer items-center gap-1.5 border-b-2 px-2.5 text-sm"
              :class="tab === t.key ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg'"
              @click="tab = t.key"
            >
              {{ t.label }}
              <span v-if="t.marked" class="size-1.5 rounded-full bg-accent" />
            </button>
          </div>

          <IdeaAnalysis v-if="tab === 'analysis'" :idea="idea" />

          <IdeaReferenceAnalysis
            v-else-if="tab === 'reference'"
            :reference-breakdown="idea.analysis?.referenceBreakdown ?? null"
            :reference-status="idea.referenceStatus"
            :analysis-progress="progress"
          />

          <section v-else-if="tab === 'transcript'" class="rounded-lg border border-border bg-panel p-3.5">
            <p v-if="idea.transcription" class="text-sm whitespace-pre-wrap">{{ idea.transcription }}</p>
            <UiEmptyState
              v-else
              title="Транскрипта нет"
              description="Он появляется, когда идею разбирали вместе с аудиодорожкой."
            />
          </section>

          <IdeaSyncInfo
            v-else-if="tab === 'sync'"
            :idea-id="idea.id"
            :external-id="idea.externalId ?? null"
            :sync-status="idea.syncStatus ?? 'none'"
            :sync-direction="idea.syncDirection ?? 'local'"
            :last-synced-at="idea.lastSyncedAt ?? null"
            :last-sync-error="idea.lastSyncError ?? null"
            :local-dirty="idea.localDirty ?? false"
            :remote-snapshot="idea.remoteSnapshot ?? null"
            @synced="refresh()"
          />

          <section v-else-if="tab === 'history'" class="rounded-lg border border-border bg-panel p-3.5">
            <div v-if="idea.operatorActions?.length" class="flex flex-col">
              <div
                v-for="action in idea.operatorActions"
                :key="action.id"
                class="flex flex-wrap items-baseline gap-2 border-b border-divider py-1.5 text-sm last:border-b-0"
              >
                <span class="rounded-sm border border-divider px-1.5 py-0.5 text-micro text-muted">
                  {{ ACTION_LABELS[action.actionType] ?? action.actionType }}
                </span>
                <span v-if="action.reason" class="min-w-0 flex-1 text-muted">{{ action.reason }}</span>
                <span class="tnum ml-auto font-mono text-micro text-subtle">{{ formatDate(action.createdAt) }}</span>
              </div>
            </div>
            <UiEmptyState v-else title="История пуста" description="С идеей ещё ничего не делали." />
          </section>
        </template>
      </div>
    </template>
  </div>
</template>

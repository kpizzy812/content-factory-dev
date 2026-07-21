<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'script-generator' })

const route = useRoute()
const ideaId = computed(() => route.params.id as string)

const { data, pending, error, refresh, progress } = useIdeaDetail(ideaId)
const idea = computed(() => data.value?.data ?? null)

useHead({
  title: computed(() => idea.value?.title ?? 'Идея'),
})

// === Editing ===
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
    const tags = editForm.tags
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)

    await updateIdea(Number(ideaId.value), {
      title: editForm.title,
      hook: editForm.hook,
      body: editForm.body,
      cta: editForm.cta,
      visualStyle: editForm.visualStyle,
      whyViral: editForm.whyViral,
      operatorNotes: editForm.operatorNotes,
      tags,
    })
    isEditing.value = false
    await refresh()
  } catch {
    editError.value = 'Не удалось сохранить. Попробуйте ещё раз.'
  } finally {
    isSaving.value = false
  }
}

async function onUpdated() {
  isEditing.value = false
  await refresh()
}

function onDeleted() {
  navigateTo('/ideas')
}

// === Detail tabs ===
const activeSection = ref<'analysis' | 'reference' | 'transcript' | 'history' | 'sync'>('analysis')

// Auto-switch to reference tab when reference analysis is available
const hasReferenceBreakdown = computed(() => !!idea.value?.analysis?.referenceBreakdown)

// === Utilities ===
const platformMap: Record<string, { label: string; icon: string }> = {
  youtube: { label: 'YouTube', icon: 'mingcute:youtube-line' },
  tiktok: { label: 'TikTok', icon: 'mingcute:tiktok-line' },
  instagram: { label: 'Instagram', icon: 'mingcute:instagram-line' },
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const actionTypeLabels: Record<string, string> = {
  create: 'Создание',
  edit: 'Редактирование',
  delete: 'Удаление',
  restore: 'Восстановление',
  reanalyze: 'Переанализ',
  send_to_scenario: 'Отправка в сценарии',
}
</script>

<template>
  <div class="space-y-4">
    <!-- Назад -->
    <NuxtLink to="/ideas" class="btn btn-ghost btn-sm gap-1">
      <Icon name="mingcute:arrow-left-line" />
      Назад к идеям
    </NuxtLink>

    <!-- Loading -->
    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <!-- Error -->
    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>Ошибка загрузки: {{ error.message }}</span>
    </div>

    <!-- Content -->
    <template v-else-if="idea">
      <!-- Ошибка обработки -->
      <div v-if="idea.status === 'failed'" role="alert" class="alert alert-error">
        <Icon name="mingcute:warning-line" />
        <span>{{ idea.errorMessage || 'Произошла ошибка при обработке' }}</span>
      </div>

      <!-- Processing -->
      <div v-if="idea.status === 'processing'" role="alert" class="alert alert-info">
        <span class="loading loading-spinner loading-sm" />
        <span>Идея обрабатывается, подождите...</span>
      </div>

      <!-- Мета-информация -->
      <div class="flex items-center gap-2 flex-wrap">
        <IdeaStatusBadge :status="idea.status" :analysis-status="idea.analysisStatus" />
        <IdeaSourceBadge
          :source="idea.source"
          :sync-status="idea.syncStatus"
          :external-id="idea.externalId"
        />
        <span
          v-if="idea.platform && platformMap[idea.platform]"
          class="badge badge-sm badge-ghost gap-1"
        >
          <Icon :name="platformMap[idea.platform!]!.icon" class="text-xs" />
          {{ platformMap[idea.platform!]!.label }}
        </span>
        <span
          v-if="idea.mediaType"
          class="badge badge-sm badge-ghost gap-1"
        >
          <Icon
            :name="idea.mediaType === 'video' ? 'mingcute:video-line' : idea.mediaType === 'image' ? 'mingcute:pic-line' : 'mingcute:file-line'"
            class="text-xs"
          />
          {{ idea.mediaType === 'video' ? 'Видео' : idea.mediaType === 'image' ? 'Изображение' : 'Медиа' }}
        </span>
        <span v-if="idea.app" class="text-sm text-base-content/60">
          {{ idea.app.name }}
        </span>
        <NuxtLink
          v-if="idea.sentToScenarioAt"
          to="/scenarios"
          class="badge badge-sm badge-outline badge-primary gap-1 hover:badge-primary hover:text-primary-content transition-colors"
        >
          <Icon name="mingcute:star-line" class="text-xs" />
          Перейти к сценариям
        </NuxtLink>
      </div>

      <h1 class="text-xl font-bold text-base-content">
        {{ idea.title || idea.sourceUrl || 'Идея' }}
      </h1>

      <!-- URL -->
      <div v-if="idea.sourceUrl" class="text-sm text-base-content/50 flex items-center gap-1">
        <Icon name="mingcute:link-line" class="text-xs" />
        <a
          :href="idea.sourceUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="link link-hover truncate"
        >
          {{ idea.sourceUrl }}
        </a>
      </div>

      <!-- Tags -->
      <div v-if="idea.tags?.length" class="flex gap-1 flex-wrap">
        <span
          v-for="tag in idea.tags"
          :key="tag"
          class="badge badge-sm badge-outline"
        >
          {{ tag }}
        </span>
      </div>

      <!-- Заметки оператора -->
      <div v-if="idea.operatorNotes && !isEditing" class="card bg-base-200/50">
        <div class="card-body p-3 gap-1">
          <div class="flex items-center gap-1 text-xs text-base-content/50">
            <Icon name="mingcute:note-line" class="text-sm" />
            Заметки оператора
          </div>
          <p class="text-sm whitespace-pre-wrap">{{ idea.operatorNotes }}</p>
        </div>
      </div>

      <!-- Действия -->
      <IdeaActions
        :idea-id="idea.id"
        :current-status="idea.status"
        :analysis-status="idea.analysisStatus"
        :reference-status="idea.referenceStatus"
        :has-reference-breakdown="hasReferenceBreakdown"
        @updated="onUpdated"
        @edit="startEditing"
        @deleted="onDeleted"
      />

      <!-- Редактор -->
      <div v-if="isEditing" class="card bg-base-100 shadow-sm">
        <div class="card-body p-4 gap-3">
          <h3 class="card-title text-sm">
            <Icon name="mingcute:edit-line" class="text-primary" />
            Редактирование идеи
          </h3>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Заголовок</legend>
            <input v-model="editForm.title" type="text" class="input w-full" placeholder="Заголовок">
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Хук</legend>
            <textarea v-model="editForm.hook" class="textarea w-full" rows="3" placeholder="Хук" />
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Основная часть</legend>
            <textarea v-model="editForm.body" class="textarea w-full" rows="5" placeholder="Основная часть" />
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Призыв к действию</legend>
            <textarea v-model="editForm.cta" class="textarea w-full" rows="3" placeholder="CTA" />
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Визуальный стиль</legend>
            <textarea v-model="editForm.visualStyle" class="textarea w-full" rows="3" placeholder="Визуальный стиль" />
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Почему залетело</legend>
            <textarea v-model="editForm.whyViral" class="textarea w-full" rows="3" placeholder="Почему залетело" />
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Заметки оператора</legend>
            <textarea v-model="editForm.operatorNotes" class="textarea w-full" rows="3" placeholder="Заметки, комментарии, контекст..." />
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Теги (через запятую)</legend>
            <input v-model="editForm.tags" type="text" class="input w-full" placeholder="тренд, юмор, обзор">
          </fieldset>

          <div v-if="editError" role="alert" class="alert alert-error alert-soft text-sm">
            <Icon name="mingcute:warning-line" />
            <span>{{ editError }}</span>
          </div>

          <div class="flex gap-2 justify-end">
            <button class="btn btn-sm btn-ghost" :disabled="isSaving" @click="isEditing = false">
              Отмена
            </button>
            <button class="btn btn-sm btn-primary" :disabled="isSaving" @click="handleSave">
              <span v-if="isSaving" class="loading loading-spinner loading-xs" />
              Сохранить
            </button>
          </div>
        </div>
      </div>

      <!-- Секции: Анализ / Транскрипт / История -->
      <template v-if="!isEditing">
        <div class="tabs tabs-bordered">
          <button
            class="tab"
            :class="{ 'tab-active': activeSection === 'analysis' }"
            @click="activeSection = 'analysis'"
          >
            <Icon name="mingcute:brain-line" class="mr-1" />
            Анализ
          </button>
          <button
            class="tab"
            :class="{ 'tab-active': activeSection === 'reference' }"
            @click="activeSection = 'reference'"
          >
            <Icon name="mingcute:search-line" class="mr-1" />
            Референс
            <span
              v-if="hasReferenceBreakdown"
              class="badge badge-xs badge-success ml-1"
            />
          </button>
          <button
            class="tab"
            :class="{ 'tab-active': activeSection === 'transcript' }"
            @click="activeSection = 'transcript'"
          >
            <Icon name="mingcute:text-line" class="mr-1" />
            Транскрипт
          </button>
          <button
            class="tab"
            :class="{ 'tab-active': activeSection === 'history' }"
            @click="activeSection = 'history'"
          >
            <Icon name="mingcute:time-line" class="mr-1" />
            История
          </button>
          <button
            class="tab"
            :class="{ 'tab-active': activeSection === 'sync' }"
            @click="activeSection = 'sync'"
          >
            <Icon name="mingcute:refresh-2-line" class="mr-1" />
            Синхронизация
            <span
              v-if="idea.syncStatus && idea.syncStatus !== 'none'"
              class="badge badge-xs ml-1"
              :class="{
                'badge-success': idea.syncStatus === 'synced',
                'badge-warning': idea.syncStatus === 'conflict',
                'badge-error': idea.syncStatus === 'error',
                'badge-info': idea.syncStatus === 'pending_export' || idea.syncStatus === 'pending_import',
              }"
            />
          </button>
        </div>

        <!-- Анализ -->
        <IdeaAnalysis v-if="activeSection === 'analysis'" :idea="idea" />

        <!-- Референс -->
        <IdeaReferenceAnalysis
          v-if="activeSection === 'reference'"
          :reference-breakdown="idea.analysis?.referenceBreakdown ?? null"
          :reference-status="idea.referenceStatus"
          :analysis-progress="progress"
        />

        <!-- Транскрипт -->
        <div v-if="activeSection === 'transcript'" class="card bg-base-100 shadow-sm">
          <div class="card-body p-4">
            <template v-if="idea.transcription">
              <p class="text-sm whitespace-pre-wrap text-base-content/80">
                {{ idea.transcription }}
              </p>
            </template>
            <div v-else class="text-center py-6 text-base-content/40">
              <Icon name="mingcute:text-line" class="text-3xl mb-2" />
              <p class="text-sm">Транскрибация отсутствует</p>
              <p class="text-xs mt-1">Транскрибация появится, если была выполнена обработка аудио</p>
            </div>
          </div>
        </div>

        <!-- Синхронизация -->
        <IdeaSyncInfo
          v-if="activeSection === 'sync'"
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

        <!-- История действий -->
        <div v-if="activeSection === 'history'" class="card bg-base-100 shadow-sm">
          <div class="card-body p-4">
            <template v-if="idea.operatorActions?.length">
              <div class="space-y-2">
                <div
                  v-for="action in idea.operatorActions"
                  :key="action.id"
                  class="flex items-start gap-3 text-sm"
                >
                  <span class="badge badge-xs badge-ghost mt-1 shrink-0">
                    {{ actionTypeLabels[action.actionType] ?? action.actionType }}
                  </span>
                  <div class="flex-1 min-w-0">
                    <span v-if="action.reason" class="text-base-content/70">{{ action.reason }}</span>
                    <span class="text-xs text-base-content/40 ml-2">
                      {{ formatDate(action.createdAt) }}
                    </span>
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="text-center py-6 text-base-content/40">
              <Icon name="mingcute:time-line" class="text-3xl mb-2" />
              <p class="text-sm">Нет записей в истории</p>
            </div>
          </div>
        </div>
      </template>

      <!-- Мета-данные -->
      <div class="text-xs text-base-content/30 flex gap-4">
        <span>ID: {{ idea.id }}</span>
        <span>Создано: {{ formatDate(idea.createdAt) }}</span>
        <span>Обновлено: {{ formatDate(idea.updatedAt) }}</span>
      </div>
    </template>
  </div>
</template>

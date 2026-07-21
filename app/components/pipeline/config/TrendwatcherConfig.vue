<script setup lang="ts">
import type { TrendwatcherProfile } from '~/composables/useTrendwatcherProfiles'

/**
 * Trendwatcher pipeline node — autonomous unit.
 *
 * Два режима:
 *  - linked: ссылка на сохранённый TrendwatcherProfile (shared с standalone модулем)
 *  - inline: конфиг целиком живёт в config ноды; executor материализует его в isInline-профиль
 *
 * Режимы переиспользуют одну доменную модель (TrendwatcherProfile), разные только lifecycle.
 */
const props = defineProps<{
  config: Record<string, any>
  /** Канвас-id ноды. Нужен для материализации inline-профилей и AI аудита. */
  nodeId?: string
  /** Id pipeline — пробрасывается в AI audit и inline-профиль. */
  pipelineId?: number
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const mode = computed<'linked' | 'inline'>(() => {
  return props.config.profileMode === 'inline' ? 'inline' : 'linked'
})

function setMode(v: 'linked' | 'inline') {
  emit('update', 'profileMode', v)
}

// ─── Загрузка профиля для summary ────────────────────────────────────
const { getProfile } = useTrendwatcherProfiles()
const selectedProfile = ref<TrendwatcherProfile | null>(null)
const loadingSelected = ref(false)

async function loadSelectedProfile(id: number | null) {
  if (!id) {
    selectedProfile.value = null
    return
  }
  loadingSelected.value = true
  try {
    selectedProfile.value = await getProfile(id)
  } finally {
    loadingSelected.value = false
  }
}

watch(() => props.config.profileId, (v) => loadSelectedProfile(v ? Number(v) : null), { immediate: true })

// ─── Editor modal ────────────────────────────────────────────────────
const editorOpen = ref(false)
const editorProfile = ref<TrendwatcherProfile | null>(null)

function openCreate() {
  editorProfile.value = null
  editorOpen.value = true
}

function openEdit(profile: TrendwatcherProfile) {
  editorProfile.value = profile
  editorOpen.value = true
}

function closeEditor() {
  editorOpen.value = false
  editorProfile.value = null
}

function onProfileSaved(profile: TrendwatcherProfile) {
  emit('update', 'profileId', profile.id)
  if (profile.appId && profile.appId !== Number(props.config.appId)) {
    emit('update', 'appId', profile.appId)
  }
  selectedProfile.value = profile
}

function onProfileSelected(id: number | null) {
  emit('update', 'profileId', id)
}

// ─── AI autofill apply ──────────────────────────────────────────────
// AI всегда генерирует inline-конфиг (actor, keywords, platforms, geo, ...).
// Если нода стояла в linked режиме, переключаем в inline — иначе поля заполнятся
// в config, но inline-форма не отрисуется и пользователь не увидит результата.
function applyAiSuggestion(suggestion: Record<string, unknown>) {
  if (mode.value !== 'inline') {
    emit('update', 'profileMode', 'inline')
  }
  for (const [k, v] of Object.entries(suggestion)) {
    emit('update', k, v)
  }
}

// ─── Save inline as profile (on-demand) ──────────────────────────────
const savingAsProfile = ref(false)
const saveAsProfileError = ref('')
const { createProfile } = useTrendwatcherProfiles()

async function saveInlineAsProfile() {
  if (!props.config.appId) {
    saveAsProfileError.value = 'Сначала выберите приложение'
    return
  }
  const platforms = Array.isArray(props.config.platforms) ? props.config.platforms : []
  if (platforms.length === 0) {
    saveAsProfileError.value = 'Выберите хотя бы одну платформу'
    return
  }
  const keywords = Array.isArray(props.config.keywords) ? props.config.keywords : []
  if (keywords.length === 0) {
    saveAsProfileError.value = 'Добавьте хотя бы одно ключевое слово'
    return
  }

  savingAsProfile.value = true
  saveAsProfileError.value = ''
  try {
    const name = (props.config.inlineName as string)?.trim() || `Из ноды ${props.nodeId ?? 'pipeline'}`
    const res = await createProfile({
      appId: Number(props.config.appId),
      name,
      actorId: props.config.actorId || undefined,
      keywords,
      platforms,
      language: props.config.language || undefined,
      geo: props.config.geo || undefined,
      viewCountMin: typeof props.config.viewCountMin === 'number' ? props.config.viewCountMin : null,
      viewCountMax: typeof props.config.viewCountMax === 'number' ? props.config.viewCountMax : null,
      maxItems: typeof props.config.maxItems === 'number' ? props.config.maxItems : 20,
    }) as { data: TrendwatcherProfile }
    // Переключаемся в linked режим с этим профилем
    emit('update', 'profileMode', 'linked')
    emit('update', 'profileId', res.data.id)
    selectedProfile.value = res.data
  } catch (e) {
    saveAsProfileError.value = e instanceof Error ? e.message : 'Не удалось сохранить'
  } finally {
    savingAsProfile.value = false
  }
}

const appIdNum = computed(() =>
  props.config.appId ? Number(props.config.appId) : null,
)
</script>

<template>
  <div class="space-y-3">
    <!-- AI autofill — вверху, как у других типов нод. Работает для обоих режимов. -->
    <PipelineConfigTrendwatcherAiAutofill
      :app-id="appIdNum"
      :current-config="config"
      :pipeline-id="pipelineId"
      :node-canvas-id="nodeId"
      @apply="applyAiSuggestion"
    />

    <!-- AI audit log — прямо под prompt-окном, консистентно с другими нодами. -->
    <PipelineAiAuditLog node-type="trendwatcher" />

    <!-- Приложение (общее для обоих режимов) -->
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Приложение</legend>
      <SharedAsyncSelect
        url="/api/admin/apps"
        label-field="name"
        value-field="id"
        :model-value="config.appId ?? null"
        placeholder="Выберите приложение"
        @update:model-value="(v) => emit('update', 'appId', v ? Number(v) : null)"
      />
      <SharedFieldHint text="Контекст приложения используется AI-автозаполнением и является ключом для фильтра профилей." />
    </fieldset>

    <!-- Mode toggle -->
    <div class="tabs tabs-boxed tabs-sm bg-base-200">
      <button
        type="button"
        class="tab"
        :class="mode === 'linked' ? 'tab-active' : ''"
        @click="setMode('linked')"
      >
        <Icon name="mingcute:bookmark-line" class="text-sm mr-1" />
        Профиль
      </button>
      <button
        type="button"
        class="tab"
        :class="mode === 'inline' ? 'tab-active' : ''"
        @click="setMode('inline')"
      >
        <Icon name="mingcute:edit-line" class="text-sm mr-1" />
        Встроенная настройка
      </button>
    </div>

    <!-- LINKED mode ─────────────────────────────────────────────── -->
    <template v-if="mode === 'linked'">
      <PipelineConfigTrendwatcherProfilePicker
        :app-id="appIdNum"
        :selected-profile-id="config.profileId ?? null"
        @update:selected-profile-id="onProfileSelected"
        @new="openCreate"
        @edit="openEdit"
      />

      <PipelineConfigTrendwatcherProfileSummary
        v-if="!loadingSelected"
        :profile="selectedProfile"
      />
      <div v-else class="text-xs text-base-content/60 flex items-center gap-1">
        <span class="loading loading-spinner loading-xs" />
        Загрузка профиля…
      </div>
    </template>

    <!-- INLINE mode ─────────────────────────────────────────────── -->
    <template v-else>
      <PipelineConfigTrendwatcherInlineForm
        :config="config"
        @update="(key, value) => emit('update', key, value)"
      />

      <button
        type="button"
        class="btn btn-sm btn-outline btn-primary w-full"
        :disabled="savingAsProfile"
        @click="saveInlineAsProfile"
      >
        <span v-if="savingAsProfile" class="loading loading-spinner loading-xs" />
        <Icon v-else name="mingcute:save-line" />
        Сохранить inline-конфиг как переиспользуемый профиль
      </button>
      <div v-if="saveAsProfileError" class="text-xs text-error">
        {{ saveAsProfileError }}
      </div>
    </template>

    <!-- Profile editor modal -->
    <PipelineConfigTrendwatcherProfileEditorModal
      :open="editorOpen"
      :profile="editorProfile"
      :lock-app-id="appIdNum ?? undefined"
      @close="closeEditor"
      @saved="onProfileSaved"
    />
  </div>
</template>

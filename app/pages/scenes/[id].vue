<script setup lang="ts">
import type { SceneBlock, SceneStatus } from '~~/shared/types/scene'
import { SCENE_STATUS_LABELS } from '~~/shared/types/scene'
import type { Character, CharacterReferenceImage } from '~~/shared/types/character'
import type { AppReferenceImage } from '~~/shared/types/app'
import type { SceneReferenceImage } from '~~/shared/types/scene'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'script-generator' })

const route = useRoute()
const id = computed(() => String(route.params.id))

const { data, pending, error, refresh } = useScene(id)
const detail = computed(() => data.value?.data ?? null)
const scene = computed(() => detail.value?.scene ?? null)

useHead({ title: () => (scene.value ? `${scene.value.name} — сцена` : 'Сцена') })

const toast = useToast()
const { update, generate, archive } = useSceneActions()

// ─── Черновик правок ─────────────────────────────────────────────────────────
// Блоки правятся локально, чтобы перетаскивание и ввод шли без задержки на сеть.
const draft = reactive({
  name: '',
  description: '',
  status: 'draft' as SceneStatus,
  blocks: [] as SceneBlock[],
})

const loadedSnapshot = ref('')

function snapshot() {
  return JSON.stringify({
    name: draft.name,
    description: draft.description,
    status: draft.status,
    blocks: draft.blocks,
  })
}

watch(detail, (d) => {
  if (!d) return
  draft.name = d.scene.name
  draft.description = d.scene.description ?? ''
  draft.status = d.scene.status
  draft.blocks = structuredClone(toRaw(d.blocks))
  loadedSnapshot.value = snapshot()
}, { immediate: true })

const isDirty = computed(() => snapshot() !== loadedSnapshot.value)

// ─── Персонажи и скрины приложения ───────────────────────────────────────────
// В детали сцены приходят только те, что уже использованы в блоках, а селектору
// нужен весь список приложения.
const appId = computed(() => scene.value?.appId)
const { data: appCharactersData } = useCharacters(computed(() => ({ appId: appId.value })))

const characters = computed<(Character & { referenceImages: CharacterReferenceImage[] })[]>(() => {
  const merged = new Map<string, Character & { referenceImages: CharacterReferenceImage[] }>()
  for (const c of detail.value?.characters ?? []) merged.set(c.id, c)
  for (const c of (appCharactersData.value?.data ?? []) as (Character & { referenceImages: CharacterReferenceImage[] })[]) {
    if (!merged.has(c.id)) merged.set(c.id, c)
  }
  return [...merged.values()]
})

// server:false — endpoint требует прав администратора, у SSR нет cookies сессии.
const { data: appScreensData } = useFetch<{ data: { referenceImages: AppReferenceImage[] } }>(
  () => `/api/admin/apps/${appId.value}/reference-images`,
  {
    server: false,
    immediate: false,
    watch: [appId],
    default: () => ({ data: { referenceImages: [] } }),
  },
)

const appScreens = computed<AppReferenceImage[]>(() => {
  const merged = new Map<string, AppReferenceImage>()
  for (const s of detail.value?.appScreens ?? []) merged.set(s.id, s)
  for (const s of appScreensData.value?.data?.referenceImages ?? []) {
    if (!merged.has(s.id)) merged.set(s.id, s)
  }
  return [...merged.values()]
})

// ─── Сохранение ──────────────────────────────────────────────────────────────
const saving = ref(false)
const errorMsg = ref('')

async function save(): Promise<boolean> {
  if (!scene.value) return false
  saving.value = true
  errorMsg.value = ''
  try {
    await update(scene.value.id, {
      name: draft.name.trim() || scene.value.name,
      description: draft.description.trim() || null,
      status: draft.status,
      blocks: draft.blocks,
    })
    await refresh()
    return true
  }
  catch (e) {
    errorMsg.value = (e as { data?: { message?: string }, message?: string })?.data?.message
      || (e as Error)?.message
      || 'Не удалось сохранить сцену'
    return false
  }
  finally {
    saving.value = false
  }
}

async function onSave() {
  if (await save()) toast.success('Сцена сохранена')
}

// ─── Генерация сценария ──────────────────────────────────────────────────────
// Платная операция: сначала сохраняем правки, чтобы сервер собрал промпт из того,
// что видно на экране, потом спрашиваем подтверждение.
const showGenerate = ref(false)
const generating = ref(false)
const generatedScenarioId = computed(() => scene.value?.generatedScenarioId ?? null)

async function onGenerate() {
  if (!scene.value) return
  generating.value = true
  errorMsg.value = ''
  try {
    if (isDirty.value && !(await save())) return
    const result = await generate(scene.value.id)
    showGenerate.value = false
    toast.success(`Создан сценарий #${result.scenarioId}`)
    await refresh()
  }
  catch (e) {
    errorMsg.value = (e as { data?: { message?: string }, message?: string })?.data?.message
      || (e as Error)?.message
      || 'Не удалось запустить генерацию'
    showGenerate.value = false
  }
  finally {
    generating.value = false
  }
}

// ─── Архив ───────────────────────────────────────────────────────────────────
const showArchive = ref(false)
const archiving = ref(false)

async function onArchive() {
  if (!scene.value) return
  archiving.value = true
  try {
    await archive(scene.value.id)
    await navigateTo('/scenes')
  }
  finally {
    archiving.value = false
    showArchive.value = false
  }
}

const menuItems = computed(() => [
  {
    key: 'generate',
    label: 'Собрать сценарий',
    icon: 'mingcute:flash-line',
    cost: 'платно',
    disabled: !draft.blocks.length || scene.value?.archived,
  },
  { key: 'archive', label: 'В архив', icon: 'mingcute:archive-line', danger: true },
])

function onMenuSelect(key: string) {
  if (key === 'generate') showGenerate.value = true
  if (key === 'archive') showArchive.value = true
}

// ─── Эталонные кадры ─────────────────────────────────────────────────────────
const sceneRefsCount = ref(0)
const regenerateModalOpen = ref(false)
const regenerateLastPrompt = ref('')
const generatorInitialPrompt = ref('')
const generatorKey = ref(0)

function onRefsUpdated(refs: SceneReferenceImage[]) {
  sceneRefsCount.value = refs.length
}

function onRegenerateClick(refImg: SceneReferenceImage) {
  regenerateLastPrompt.value = refImg.generationPrompt ?? ''
  if (!regenerateLastPrompt.value) return
  regenerateModalOpen.value = true
}

async function onRegenerateSame(promptText: string) {
  if (!scene.value || !promptText) return
  try {
    await $fetch(`/api/scenes/${scene.value.id}/generate-reference`, {
      method: 'POST',
      body: { prompt: promptText },
    })
    await refresh()
  }
  catch (e) {
    errorMsg.value = (e as { data?: { message?: string }, message?: string })?.data?.message
      || (e as Error)?.message
      || 'Не удалось перегенерировать кадр'
  }
}

function onRegenerateNew(promptText: string) {
  generatorInitialPrompt.value = promptText
  generatorKey.value++
  nextTick(() => {
    document.getElementById('scene-ref-generator')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

// ─── Навигация по соседям ────────────────────────────────────────────────────
const filters = useSceneFiltersStore()
const { data: listData } = useScenes(computed(() => filters.query))

// У /api/scenes нет постраничной выдачи — позиция считается по загруженному списку.
const siblings = computed(() => listData.value?.data?.map((s: { id: string }) => s.id) ?? [])
const currentIndex = computed(() => siblings.value.indexOf(id.value))
const inList = computed(() => currentIndex.value >= 0)

const hasPrev = computed(() => inList.value && currentIndex.value > 0)
const hasNext = computed(() => inList.value && currentIndex.value < siblings.value.length - 1)
const position = computed(() =>
  inList.value ? `${currentIndex.value + 1} из ${siblings.value.length}` : undefined)

async function goSibling(delta: -1 | 1) {
  const next = siblings.value[currentIndex.value + delta]
  if (next != null) await navigateTo(`/scenes/${next}`)
}

const statusOptions = (['draft', 'ready'] as SceneStatus[]).map(s => ({
  value: s,
  label: SCENE_STATUS_LABELS[s],
}))
</script>

<template>
  <!--
    Сцена грузится только в браузере: `useScene` ходит с `server: false`,
    поэтому на сервере страница всегда в состоянии загрузки, а на клиенте — уже
    нет. Без ClientOnly Vue ругается на расхождение и бросает поддерево.
  -->
  <ClientOnly>
    <template #fallback>
      <UiSkeleton variant="details" :count="5" />
    </template>

    <UiSkeleton v-if="pending && !scene" variant="details" :count="5" />

    <UiErrorState
      v-else-if="error"
      title="Не удалось загрузить сцену"
      :message="error.message"
      @retry="refresh"
    />

    <template v-else-if="scene && detail">
      <DetailHeader
        :title="draft.name || scene.name"
        :code="`scn_${scene.id.slice(0, 8)}`"
        back-to="/scenes"
        back-label="К сценам"
        :position="position"
        :has-prev="hasPrev"
        :has-next="hasNext"
        @prev="goSibling(-1)"
        @next="goSibling(1)"
      >
        <template #badges>
          <SceneStatusBadge :status="scene.status" />
          <span
            v-if="scene.archived"
            class="rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-micro text-warning"
          >
            архив
          </span>
        </template>

        <template #actions>
          <UiButton variant="primary" :disabled="!isDirty" :loading="saving" @click="onSave">
            <Icon v-if="!saving" name="mingcute:save-line" />
            Сохранить
          </UiButton>
          <UiActionMenu :items="menuItems" @select="onMenuSelect" />
        </template>

        <template v-if="isDirty" #unsaved>
          <p class="flex items-center gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-1.5 text-sm text-warning">
            <Icon name="mingcute:alert-line" class="shrink-0" />
            Правки не сохранены — до сохранения промпт собирается только в превью.
          </p>
        </template>
      </DetailHeader>

      <div
        v-if="errorMsg"
        role="alert"
        class="mb-3 flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        <span class="min-w-0 flex-1">{{ errorMsg }}</span>
        <UiButton variant="ghost" @click="errorMsg = ''">Закрыть</UiButton>
      </div>

      <div class="grid items-start gap-3.5 lg:grid-cols-[1fr_340px]">
        <div class="flex min-w-0 flex-col gap-3.5">
          <!-- Свойства -->
          <section class="flex flex-col gap-3 rounded-lg border border-border bg-panel p-3.5">
            <h2 class="text-micro tracking-[.06em] text-subtle uppercase">Свойства</h2>

            <SceneAiAutofill
              :current-values="{ name: draft.name, description: draft.description }"
              :app-id="scene.appId"
              :entity-id="scene.id"
              @apply="(f) => {
                if (typeof f.name === 'string') draft.name = f.name
                if (typeof f.description === 'string') draft.description = f.description
              }"
            />

            <div class="grid gap-3 sm:grid-cols-[1fr_180px]">
              <UiField label="Имя сцены">
                <UiInput v-model="draft.name" placeholder="Утренняя пробежка с другом" />
              </UiField>
              <UiField label="Статус">
                <UiSelect v-model="draft.status" :options="statusOptions" />
              </UiField>
            </div>

            <UiField label="Описание">
              <UiTextarea
                v-model="draft.description"
                :rows="2"
                placeholder="Что показываем в сцене"
              />
            </UiField>
          </section>

          <!-- Эталонные кадры -->
          <section class="flex flex-col gap-3 rounded-lg border border-border bg-panel p-3.5">
            <div class="flex items-center gap-2">
              <h2 class="text-micro tracking-[.06em] text-subtle uppercase">Эталонные кадры</h2>
              <span class="tnum font-mono text-micro text-subtle">{{ sceneRefsCount }}</span>
            </div>
            <p class="text-sm text-muted">
              Кадры уходят в генерацию: их разбор подмешивается в промпт, а сами картинки идут
              в image-to-video.
            </p>

            <SceneReferenceUploader
              :scene-id="scene.id"
              @updated="onRefsUpdated"
              @regenerate="onRegenerateClick"
            />

            <div id="scene-ref-generator">
              <SceneReferenceGenerator
                :key="generatorKey"
                :scene-id="scene.id"
                :app-id="scene.appId"
                :initial-prompt="generatorInitialPrompt"
                @generated="refresh"
              />
            </div>
          </section>

          <!-- Блоки -->
          <SceneComposer
            :blocks="draft.blocks"
            :characters="characters"
            :app-screens="appScreens"
            :scene-id="scene.id"
            @update:blocks="(b) => draft.blocks = b"
            @block-regenerated="refresh"
          />
        </div>

        <!-- Правая колонка -->
        <aside class="flex flex-col gap-3.5 lg:sticky lg:top-16">
          <ScenePromptPreview
            :blocks="draft.blocks"
            :characters="characters"
            :app-screens="appScreens"
          />

          <section class="flex flex-col gap-2 rounded-lg border border-border bg-panel p-3.5">
            <h2 class="text-micro tracking-[.06em] text-subtle uppercase">Дальше</h2>
            <p class="text-sm text-muted">
              «Собрать сценарий» в меню шапки создаёт сценарий из этой сцены — его можно открыть
              в разделе «Сценарии» и запустить рендер.
            </p>
            <NuxtLink v-if="generatedScenarioId" :to="`/scenarios/${generatedScenarioId}`">
              <UiButton class="w-full justify-center">
                Открыть сценарий #{{ generatedScenarioId }}
                <Icon name="mingcute:right-line" />
              </UiButton>
            </NuxtLink>
            <p class="text-micro text-subtle">
              Минимальный комплект блоков: персонаж, стиль, окружение, действие.
            </p>
          </section>
        </aside>
      </div>

      <SharedGenerateAgainModal
        v-model:open="regenerateModalOpen"
        :last-prompt="regenerateLastPrompt"
        @same="onRegenerateSame"
        @new="onRegenerateNew"
      />

      <UiModal :open="showGenerate" title="Собрать сценарий из сцены?" size="sm" @close="showGenerate = false">
        <p class="text-sm text-muted">
          Запускается платная модель: по блокам сцены собирается текстовый сценарий с вариантом.
          Несохранённые правки сохранятся автоматически.
        </p>
        <template #footer>
          <UiButton variant="ghost" @click="showGenerate = false">Отмена</UiButton>
          <UiButton variant="primary" :loading="generating" @click="onGenerate">Собрать · платно</UiButton>
        </template>
      </UiModal>

      <UiModal :open="showArchive" title="Убрать сцену в архив?" size="sm" @close="showArchive = false">
        <p class="text-sm text-muted">
          Сцена пропадёт из списка, но останется доступна по фильтру «Показать архив».
        </p>
        <template #footer>
          <UiButton variant="ghost" @click="showArchive = false">Отмена</UiButton>
          <UiButton variant="danger" :loading="archiving" @click="onArchive">В архив</UiButton>
        </template>
      </UiModal>
    </template>
  </ClientOnly>
</template>

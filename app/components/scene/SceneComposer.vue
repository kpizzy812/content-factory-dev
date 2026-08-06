<script setup lang="ts">
/**
 * SceneComposer — главный экран композитора сцены.
 *
 * Слева/сверху — библиотека блоков (BlockLibrary).
 * Центр — сборщик блоков (vue-draggable-plus список SceneBlockEditor'ов).
 * Справа — превью промпта и референс-картинок + кнопки "Сохранить" и "Сгенерировать видео".
 *
 * Состояние блоков — локальное (для интерактива без флика на сохранение),
 * синхронизация с сервером — через debounced PUT /api/scenes/:id.
 */
import { VueDraggable } from 'vue-draggable-plus'
import type { Scene, SceneBlock, SceneBlockKind, SceneStatus } from '~~/shared/types/scene'
import { SCENE_BLOCK_LABELS } from '~~/shared/types/scene'
import type { SceneReferenceImage } from '~~/shared/types/scene'
import type { Character, CharacterReferenceImage } from '~~/shared/types/character'
import type { AppReferenceImage } from '~~/shared/types/app'

const props = defineProps<{
  scene: Scene
  blocks: SceneBlock[]
  characters: (Character & { referenceImages: CharacterReferenceImage[] })[]
  appScreens: AppReferenceImage[]
  compiled: {
    prompt: string
    negativePrompt: string
    referenceImageUrls: string[]
    referenceImages: Array<{ source: 'character' | 'app_screen'; sourceId: string; url: string; kind?: string }>
    characterIds: string[]
  }
}>()

const emit = defineEmits<{
  refresh: []
}>()

// Свежие эталонные кадры сцены (SceneReferenceImage). Подгружаются отдельно от
// блоков, отдаются в превью промпта + в pipeline output через compileScene.
const localRefs = ref<any[]>([])
const localRefsCount = computed(() => localRefs.value.length)
function onRefsUpdated(refs: any[]) { localRefs.value = refs }

// Регенерация существующего AI-сгенерированного эталонного кадра.
const regenerateModalOpen = ref(false)
const regenerateLastPrompt = ref('')
const generatorInitialPrompt = ref<string>('')
const generatorKey = ref(0)

function onRegenerateRefClick(refImg: SceneReferenceImage) {
  regenerateLastPrompt.value = refImg.generationPrompt ?? ''
  if (!regenerateLastPrompt.value) return
  regenerateModalOpen.value = true
}

async function onRegenerateSame(promptText: string) {
  if (!promptText) return
  try {
    await $fetch(`/api/scenes/${props.scene.id}/generate-reference`, {
      method: 'POST',
      body: { prompt: promptText },
    })
    emit('refresh')
  } catch {
    // ошибки покажет генератор/uploader при следующем взаимодействии — здесь silent
  }
}

function onRegenerateNew(promptText: string) {
  generatorInitialPrompt.value = promptText
  generatorKey.value++
  nextTick(() => {
    document.getElementById('scene-ref-generator')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

function onSceneReferenceGenerated() {
  emit('refresh')
}

// Подтягиваем ПОЛНЫЙ список персонажей и screen'ов app для селектора в блоках,
// а не только тех, что уже использованы в scene.blocks.
const charactersQuery = computed(() => ({ appId: props.scene.appId }))
const { data: appCharactersData } = useCharacters(charactersQuery)
const allCharacters = computed<(Character & { referenceImages: CharacterReferenceImage[] })[]>(() => {
  const fromServer = (appCharactersData.value?.data ?? []) as any[]
  const merged = new Map<string, Character & { referenceImages: CharacterReferenceImage[] }>()
  for (const c of props.characters) merged.set(c.id, c)
  for (const c of fromServer) if (!merged.has(c.id)) merged.set(c.id, c)
  return Array.from(merged.values())
})

// server:false — endpoint требует auth/admin, SSR может не иметь cookies сессии,
// а CSR подхватит из браузерного контекста. Без флага был mismatch hydration.
const { data: appScreensData } = useFetch<{ data: { referenceImages: AppReferenceImage[] } }>(
  () => `/api/admin/apps/${props.scene.appId}/reference-images`,
  {
    server: false,
    default: () => ({ data: { referenceImages: [] } }) as any,
  },
)
const allAppScreens = computed<AppReferenceImage[]>(() => {
  const fromServer = appScreensData.value?.data?.referenceImages ?? []
  const merged = new Map<string, AppReferenceImage>()
  for (const s of props.appScreens) merged.set(s.id, s)
  for (const s of fromServer) if (!merged.has(s.id)) merged.set(s.id, s)
  return Array.from(merged.values())
})

// Локальные блоки — копия для редактирования.
const localBlocks = ref<SceneBlock[]>(structuredClone(toRaw(props.blocks)))
const localName = ref(props.scene.name)
const localDescription = ref(props.scene.description ?? '')
const localStatus = ref<SceneStatus>(props.scene.status)

watch(() => props.scene.id, () => {
  localBlocks.value = structuredClone(toRaw(props.blocks))
  localName.value = props.scene.name
  localDescription.value = props.scene.description ?? ''
  localStatus.value = props.scene.status
})

// "Live" preview — пересобираем prompt прямо в браузере без сервера для мгновенного отклика.
// Финальный compile делает сервер при PUT.
const livePreview = computed(() => {
  const sections: string[] = []
  const refs: { source: string; url: string }[] = []
  const characterBlocks = localBlocks.value.filter(b => b.kind === 'character') as any[]
  const styleBlocks = localBlocks.value.filter(b => b.kind === 'style') as any[]
  const envBlocks = localBlocks.value.filter(b => b.kind === 'environment') as any[]
  const actionBlocks = localBlocks.value.filter(b => b.kind === 'action') as any[]
  const ctxBlocks = localBlocks.value.filter(b => b.kind === 'app_context') as any[]
  const screenBlocks = localBlocks.value.filter(b => b.kind === 'app_screen') as any[]

  if (characterBlocks.length) {
    const lines = characterBlocks.map((b) => {
      const c = allCharacters.value.find(x => x.id === b.characterId)
      const role = b.roleOverride ?? c?.role ?? 'protagonist'
      const visual = c?.visualPrompt ?? c?.description ?? `character:${b.characterId}`
      const name = c?.name ?? '[unknown]'
      const a = b.action ? `, ${b.action}` : ''
      const e = b.emotion ? `, ${b.emotion}` : ''
      if (c) {
        for (const r of c.referenceImages) refs.push({ source: 'character', url: r.fileUrl })
      }
      return `${name} (${role}): ${visual}${a}${e}`
    })
    sections.push(`Characters: ${lines.join('; ')}.`)
  }
  if (actionBlocks.length) {
    sections.push(`Action: ${actionBlocks.map(b => b.description + (b.dialog ? ` Dialog: "${b.dialog}".` : '')).join(' ')}`)
  }
  if (envBlocks.length) {
    const lines = envBlocks.map(b => [b.location, b.timeOfDay, b.lighting, b.weather].filter(Boolean).join(', '))
    sections.push(`Environment: ${lines.join('; ')}.`)
  }
  if (styleBlocks.length) {
    const lines = styleBlocks.map(b => {
      const parts = [b.visualStyle]
      if (b.mood) parts.push(`mood: ${b.mood}`)
      if (b.camera) parts.push(`camera: ${b.camera}`)
      return parts.join(', ')
    })
    sections.push(`Style: ${lines.join('; ')}.`)
  }
  if (ctxBlocks.length) sections.push(`App context: ${ctxBlocks.map(b => b.focus).join('; ')}.`)
  if (screenBlocks.length) {
    for (const b of screenBlocks) {
      const s = allAppScreens.value.find(x => x.id === b.referenceImageId)
      if (s?.fileUrl) refs.push({ source: 'app_screen', url: s.fileUrl })
    }
    sections.push(`App screen reactions: ${screenBlocks.map(b => b.intent || 'reaction').join('; ')}.`)
  }
  return {
    prompt: sections.length ? sections.join(' ') : 'Пустая сцена — добавьте блоки.',
    refs,
  }
})

const { update, generate } = useSceneActions()

const aiCurrentValues = computed(() => ({
  name: localName.value,
  description: localDescription.value,
  // Tags не редактируются в композиторе — будут проигнорированы при apply
}))

function applyAiSuggestions(fields: Record<string, unknown>) {
  if (typeof fields.name === 'string') localName.value = fields.name
  if (typeof fields.description === 'string') localDescription.value = fields.description
  // tags игнорируем — нет UI в композиторе
}

const saving = ref(false)
const message = ref('')
const errorMsg = ref('')
const generating = ref(false)
const generatedScenarioId = ref<number | null>(props.scene.generatedScenarioId ?? null)

function newBlock(kind: SceneBlockKind): SceneBlock {
  const id = (globalThis.crypto?.randomUUID?.() ?? `blk_${Math.random().toString(36).slice(2, 10)}`)
  switch (kind) {
    case 'character':
      return { id, kind: 'character', characterId: allCharacters.value[0]?.id ?? '' }
    case 'style':
      return { id, kind: 'style', visualStyle: '' }
    case 'environment':
      return { id, kind: 'environment', location: '' }
    case 'action':
      return { id, kind: 'action', description: '' }
    case 'app_context':
      return { id, kind: 'app_context', focus: '' }
    case 'app_screen':
      return { id, kind: 'app_screen', referenceImageId: allAppScreens.value[0]?.id ?? '' }
  }
}

function onAdd(kind: SceneBlockKind) {
  localBlocks.value.push(newBlock(kind))
}

function onRemoveBlock(idx: number) {
  localBlocks.value.splice(idx, 1)
}

function onUpdateBlock(idx: number, updated: SceneBlock) {
  localBlocks.value.splice(idx, 1, updated)
}

// Сервер пересобрал compiledPrompt после AI-регенерации блока — обновим toast.
// Сам preview пересчитается из localBlocks (live).
function onAiCompiled(_prompt: string | null) {
  message.value = 'Блок перегенерирован'
  setTimeout(() => { message.value = '' }, 2000)
}

async function onSave() {
  saving.value = true
  message.value = ''
  errorMsg.value = ''
  try {
    await update(props.scene.id, {
      name: localName.value.trim() || props.scene.name,
      description: localDescription.value.trim() || null,
      blocks: localBlocks.value,
      status: localStatus.value,
    })
    message.value = 'Сохранено'
    setTimeout(() => { message.value = '' }, 1500)
    emit('refresh')
  } catch (e: any) {
    errorMsg.value = e?.data?.message || e?.message || 'Ошибка сохранения'
  } finally {
    saving.value = false
  }
}

async function onGenerate() {
  if (localBlocks.value.length === 0) {
    errorMsg.value = 'Сначала добавьте хотя бы один блок'
    return
  }
  generating.value = true
  errorMsg.value = ''
  try {
    // Сохраним перед генерацией, чтобы сервер взял свежие блоки.
    await update(props.scene.id, {
      name: localName.value.trim() || props.scene.name,
      description: localDescription.value.trim() || null,
      blocks: localBlocks.value,
    })
    const result = await generate(props.scene.id)
    generatedScenarioId.value = result.scenarioId
    message.value = `Создан сценарий #${result.scenarioId}`
    emit('refresh')
  } catch (e: any) {
    errorMsg.value = e?.data?.message || e?.message || 'Не удалось запустить генерацию'
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
    <!-- Левая колонка: библиотека + сборщик -->
    <div class="space-y-4">
      <section class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body p-4 space-y-3">
          <SceneAiAutofill
            :current-values="aiCurrentValues"
            :app-id="scene.appId"
            :entity-id="scene.id"
            @apply="applyAiSuggestions"
          />
          <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Имя сцены</legend>
              <input
                v-model="localName"
                type="text"
                class="input input-sm w-full"
                placeholder="Утренняя пробежка с другом"
              />
            </fieldset>
            <fieldset class="fieldset sm:w-44">
              <legend class="fieldset-legend">Статус</legend>
              <select v-model="localStatus" class="select select-sm w-full">
                <option value="draft">Черновик</option>
                <option value="ready">Готова</option>
              </select>
            </fieldset>
          </div>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Описание</legend>
            <textarea
              v-model="localDescription"
              class="textarea textarea-sm w-full"
              rows="2"
              placeholder="Что показываем в сцене"
            />
          </fieldset>
        </div>
      </section>

      <section class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body p-3 space-y-2">
          <h3 class="text-sm font-semibold flex items-center gap-2">
            <Icon name="mingcute:photo-album-line" class="size-4 text-primary" />
            Эталонные кадры сцены
            <span class="badge badge-sm badge-ghost">{{ localRefsCount }}</span>
          </h3>
          <p class="text-xs text-base-content/60">
            Эти фото реально уходят в pipeline видео-генерации: AI разбирает их (mood/lighting/композиция), их visualDescription инжектится в финальный prompt сцены, а самые подходящие подаются как image_url для kling/wan image-to-video.
          </p>
          <SceneReferenceUploader
            :scene-id="scene.id"
            @updated="onRefsUpdated"
            @regenerate="onRegenerateRefClick"
          />
          <div id="scene-ref-generator">
            <SceneReferenceGenerator
              :key="generatorKey"
              :scene-id="scene.id"
              :app-id="scene.appId"
              :initial-prompt="generatorInitialPrompt"
              @generated="onSceneReferenceGenerated"
            />
          </div>
        </div>
      </section>

      <SceneBlockLibrary @add="onAdd" />

      <section class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body p-3 space-y-2">
          <h3 class="text-sm font-semibold flex items-center gap-2">
            <Icon name="mingcute:layers-line" class="size-4 text-primary" />
            Сборка сцены
            <span class="badge badge-sm badge-ghost">{{ localBlocks.length }}</span>
          </h3>

          <p v-if="localBlocks.length === 0" class="text-sm text-base-content/50 text-center py-6">
            Сборщик пуст. Кликайте блоки из библиотеки выше, чтобы добавить.
          </p>

          <VueDraggable
            v-else
            v-model="localBlocks"
            :animation="150"
            handle=".cursor-move"
            class="space-y-2"
          >
            <SceneBlockEditor
              v-for="(blk, idx) in localBlocks"
              :key="blk.id"
              :block="blk"
              :characters="allCharacters"
              :app-screens="allAppScreens"
              :scene-id="scene.id"
              @update:block="(b) => onUpdateBlock(idx, b)"
              @remove="onRemoveBlock(idx)"
              @compiled-prompt="(p) => onAiCompiled(p)"
            />
          </VueDraggable>
        </div>
      </section>
    </div>

    <!-- Правая колонка: превью промпта + действия -->
    <aside class="space-y-3 lg:sticky lg:top-4 lg:self-start">
      <section class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body p-4 space-y-3">
          <h3 class="text-sm font-semibold flex items-center gap-2">
            <Icon name="mingcute:eye-2-line" class="size-4 text-primary" />
            Превью промпта
          </h3>
          <textarea
            class="textarea text-xs leading-relaxed min-h-32 font-mono"
            :value="livePreview.prompt"
            readonly
          />

          <div v-if="livePreview.refs.length" class="space-y-1">
            <h4 class="text-xs uppercase tracking-wider text-base-content/60 font-semibold">
              Референсы ({{ livePreview.refs.length }})
            </h4>
            <div class="grid grid-cols-4 gap-1">
              <img
                v-for="(r, i) in livePreview.refs.slice(0, 8)"
                :key="i"
                :src="r.url"
                :title="r.source"
                class="w-full aspect-square rounded object-cover border border-base-300"
              />
            </div>
          </div>
        </div>
      </section>

      <section class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body p-4 space-y-2">
          <button class="btn btn-sm btn-primary" :disabled="saving" @click="onSave">
            <span v-if="saving" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:save-line" class="size-4" />
            Сохранить
          </button>
          <button
            class="btn btn-sm btn-accent"
            :disabled="generating || localBlocks.length === 0"
            @click="onGenerate"
          >
            <span v-if="generating" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:flash-line" class="size-4" />
            Сгенерировать видео
          </button>

          <NuxtLink
            v-if="generatedScenarioId"
            :to="`/scenarios/${generatedScenarioId}`"
            class="btn btn-sm btn-ghost"
          >
            Открыть сценарий #{{ generatedScenarioId }}
          </NuxtLink>

          <p v-if="message" class="text-xs text-success">{{ message }}</p>
          <p v-if="errorMsg" class="text-xs text-error">{{ errorMsg }}</p>
        </div>
      </section>

      <section class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body p-4 space-y-1 text-xs text-base-content/60">
          <p class="font-semibold text-sm text-base-content/80">Подсказки</p>
          <p>• Персонаж + Стиль + Окружение + Действие — минимальный комплект.</p>
          <p>• Кнопка «Сгенерировать видео» создаёт shadow-сценарий, его можно открыть в /scenarios и запустить рендер.</p>
        </div>
      </section>
    </aside>

    <SharedGenerateAgainModal
      v-model:open="regenerateModalOpen"
      :last-prompt="regenerateLastPrompt"
      @same="onRegenerateSame"
      @new="onRegenerateNew"
    />
  </div>
</template>

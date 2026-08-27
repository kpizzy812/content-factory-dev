<script setup lang="ts">
import { formatMoney } from '~~/shared/utils/money'
import type { TrackRegenerationPreview } from '~~/shared/types/edit-console'
import { readSpokenScenes, REPLACEABLE_VIDEO_STATUSES } from './edit-console-model'
import {
  consoleErrorText,
  previewTrackRegeneration,
  regenerateTrack,
  replaceSegment,
} from './edit-console-api'

/**
 * Озвучка: правка одной фразы и перегенерация всего трека.
 *
 * Эти два действия отличаются по цене на два порядка, поэтому и выглядят
 * по-разному. Замена фразы — кнопка в строке, без подтверждения: копейки.
 * Перегенерация трека вынесена в отдельный блок с рамкой опасности, сумма стоит
 * на самой кнопке, и запрос не уходит, пока оператор не подтвердил списание.
 *
 * Макет: design-preview/catalog/09-edit-console.dc.html (секции «Консоль» и
 * «Дорогое действие»).
 */
const props = defineProps<{
  videoId: number
  /** Действующий сценарий ролика: `scriptOverrides`, иначе storyPlan варианта. */
  storyPlan?: unknown
  status: string
  isLocked?: boolean
}>()

const emit = defineEmits<{ changed: [] }>()

const toast = useToast()

const scenes = computed(() => readSpokenScenes(props.storyPlan))
const editable = computed(() => REPLACEABLE_VIDEO_STATUSES.includes(props.status) && !props.isLocked)

const blockedReason = computed(() => {
  if (props.isLocked) return 'Ролик заблокирован — идёт другая операция.'
  if (!REPLACEABLE_VIDEO_STATUSES.includes(props.status)) {
    return 'Правки принимаются у готового, упавшего, отменённого ролика и у ролика в ожидании решения.'
  }
  return null
})

// ─── Дёшево: замена одной фразы ──────────────────────────────────────────────
const openScene = ref<number | null>(null)
const draft = ref('')
const replacing = ref(false)
const replaceError = ref('')

function toggleScene(sceneOrder: number, text: string) {
  if (openScene.value === sceneOrder) {
    openScene.value = null
    return
  }
  openScene.value = sceneOrder
  draft.value = text
  replaceError.value = ''
}

async function submitReplace() {
  if (openScene.value == null || !draft.value.trim()) return
  replacing.value = true
  replaceError.value = ''
  try {
    const result = await replaceSegment($fetch, props.videoId, {
      sceneOrder: openScene.value,
      newText: draft.value.trim(),
    })
    const d = result.data
    const rebuilt = d.invalidatedSceneOrders?.length ?? 0
    toast.success(
      `Фраза заменена: пересобрать нужно ${rebuilt} ${rebuilt === 1 ? 'сцену' : 'сцен'}`
      + (d.costUsd ? ` · ${formatMoney(d.costUsd)}` : ''),
    )
    for (const warning of d.warnings ?? []) toast.warning(warning)
    openScene.value = null
    emit('changed')
  }
  catch (e) {
    replaceError.value = consoleErrorText(e, 'Не удалось заменить фразу')
  }
  finally {
    replacing.value = false
  }
}

// ─── Дорого: перегенерация всего трека ───────────────────────────────────────
const showRegenerate = ref(false)
const acknowledged = ref(false)
const preview = ref<TrackRegenerationPreview | null>(null)
const previewing = ref(false)
const regenerating = ref(false)
const regenerateError = ref('')
const noopReason = ref('')

/**
 * Открытие модалки — это ЗАПРОС СМЕТЫ, а не запуск работы: сервер отвечает на
 * него 400 и ничего не списывает. Сумму оператор узнаёт до того, как согласится.
 */
async function openRegenerate() {
  showRegenerate.value = true
  acknowledged.value = false
  regenerateError.value = ''
  noopReason.value = ''
  previewing.value = true
  try {
    const { preview: got, error } = await previewTrackRegeneration($fetch, props.videoId)
    preview.value = got
    if (!got && error) regenerateError.value = consoleErrorText(error, 'Не удалось получить смету')
  }
  finally {
    previewing.value = false
  }
}

async function confirmRegenerate() {
  regenerating.value = true
  regenerateError.value = ''
  try {
    const result = await regenerateTrack($fetch, props.videoId, { acknowledged: acknowledged.value })
    const data = (result as { data?: { regenerated?: boolean, reason?: string } })?.data
    if (data?.regenerated) {
      toast.success('Трек уходит на перегенерацию — кадры соберутся заново')
      showRegenerate.value = false
      emit('changed')
    }
    else {
      noopReason.value = data?.reason ?? 'Перегенерировать нечего'
    }
  }
  catch (e) {
    regenerateError.value = consoleErrorText(e, 'Не удалось перегенерировать трек')
  }
  finally {
    regenerating.value = false
  }
}
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="flex flex-wrap items-center gap-2.5 border-b border-border px-3 py-2.5">
      <h2 class="text-base font-semibold">Озвучка</h2>
      <span
        v-if="scenes.length"
        class="tnum inline-flex h-5 items-center rounded-sm border border-border bg-card px-1.5 font-mono text-micro text-muted"
      >
        {{ scenes.length }} фраз
      </span>
      <span class="flex-1" />
      <span class="hidden text-micro text-subtle sm:inline">
        Правка одной фразы пересобирает только сдвинувшиеся кадры
      </span>
    </header>

    <div
      v-if="blockedReason"
      role="alert"
      class="flex items-start gap-2 border-b border-divider bg-warning-bg px-3 py-2 text-sm text-warning"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      {{ blockedReason }}
    </div>

    <UiEmptyState
      v-if="!scenes.length"
      icon="mingcute:mic-line"
      title="Реплик в сценарии нет"
      description="Локальная замена работает по репликам сценария. У этого ролика их нет — заменять нечего."
      class="m-3.5"
    />

    <div v-else class="flex flex-col">
      <div
        v-for="scene in scenes"
        :key="scene.sceneOrder"
        class="border-b border-divider"
        :class="openScene === scene.sceneOrder ? 'bg-card' : ''"
      >
        <div class="grid h-9 grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-2.5 px-3">
          <span class="tnum font-mono text-micro text-subtle">сцена {{ scene.sceneOrder }}</span>
          <span class="truncate text-sm" :class="openScene === scene.sceneOrder ? 'text-muted' : ''">
            {{ scene.text }}
          </span>
          <UiButton :disabled="!editable" @click="toggleScene(scene.sceneOrder, scene.text)">
            {{ openScene === scene.sceneOrder ? 'Свернуть' : 'Заменить фразу' }}
          </UiButton>
        </div>

        <div v-if="openScene === scene.sceneOrder" class="px-3 pb-3 pl-[78px]">
          <UiField label="Новое звучание фразы">
            <UiTextarea v-model="draft" :rows="2" />
          </UiField>
          <div class="mt-2 flex flex-wrap items-center gap-2.5">
            <UiButton
              variant="primary"
              :loading="replacing"
              :disabled="!draft.trim()"
              @click="submitReplace"
            >
              Пересинтезировать фразу
            </UiButton>
            <span class="text-micro text-subtle">
              Синтезируется только эта фраза и вклеивается в трек по паузам.
              Уже оплаченный липсинк остальных кадров сохраняется.
            </span>
          </div>
          <p
            v-if="replaceError"
            role="alert"
            class="mt-2 flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
          >
            <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
            {{ replaceError }}
          </p>
        </div>
      </div>
    </div>

    <!-- Дорогое действие вынесено из потока, а не поставлено рядом с дешёвыми. -->
    <div class="m-3 rounded-md border border-danger-border bg-danger-bg p-3">
      <div class="flex items-center gap-2">
        <Icon name="mingcute:alert-line" class="shrink-0 text-danger" />
        <span class="font-semibold text-danger">Перегенерация всего трека</span>
      </div>
      <p class="mt-1.5 max-w-[720px] text-sm text-muted">
        Новый трек меняет отпечаток и обесценивает все кадры ролика: липсинк придётся
        оплатить второй раз. Правка одной фразы дешевле в разы — сначала попробуйте её.
      </p>
      <div class="mt-2.5 flex flex-wrap items-center gap-2.5">
        <UiButton variant="danger" :disabled="!editable" @click="openRegenerate">
          Показать смету и подтвердить
        </UiButton>
        <span class="text-micro text-subtle">
          Кнопка не запускает перегенерацию: сервер сперва отдаёт смету.
        </span>
      </div>
    </div>

    <UiModal
      :open="showRegenerate"
      title="Перегенерировать весь трек?"
      size="md"
      @close="showRegenerate = false"
    >
      <UiSkeleton v-if="previewing" variant="details" :count="3" />

      <template v-else-if="preview">
        <div class="mb-3 flex items-baseline gap-2.5 rounded-md border border-danger-border bg-danger-bg px-3 py-2.5">
          <span class="tnum font-mono text-2xl leading-none font-bold text-danger">
            {{ formatMoney(preview.estimatedCostUsd) }}
          </span>
          <span class="text-sm text-muted">верхняя оценка списания</span>
        </div>

        <UiKeyValue
          :items="[
            { label: 'Сцен в треке', value: String(preview.sceneCount) },
            { label: 'Символов', value: String(preview.characters) },
            { label: 'Кадров заново', value: String(preview.shotsToRebuild) },
            { label: 'Липсинк ещё раз', value: `${preview.lipSyncSecondsToRepay.toFixed(1)} с` },
            {
              label: 'Разошлись',
              value: preview.changedSceneOrders.length
                ? `сцены ${preview.changedSceneOrders.join(', ')}`
                : 'ничего',
            },
            { label: 'Голос менялся', value: preview.voiceChanged ? 'да' : 'нет' },
          ]"
        />

        <p
          v-if="preview.changedSceneOrders.length && preview.changedSceneOrders.length <= 3"
          class="mt-3 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-sm text-muted"
        >
          Разошлись всего {{ preview.changedSceneOrders.length }} сцен(ы). Замена этих фраз
          по отдельности обойдётся в копейки и сохранит уже оплаченный липсинк остальных кадров.
        </p>

        <label class="mt-3 flex cursor-pointer items-start gap-2.5 text-sm">
          <UiCheckbox v-model="acknowledged" />
          <span>
            Понимаю, что {{ preview.shotsToRebuild }} кадров будут собраны заново
            и это спишет до <b>{{ formatMoney(preview.estimatedCostUsd) }}</b>
          </span>
        </label>
      </template>

      <p v-else class="text-sm text-muted">Смету получить не удалось.</p>

      <p
        v-if="noopReason"
        class="mt-3 rounded-md border border-neutral-border bg-neutral-bg px-2.5 py-2 text-sm text-muted"
      >
        {{ noopReason }}
      </p>
      <p
        v-if="regenerateError"
        role="alert"
        class="mt-3 flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        {{ regenerateError }}
      </p>

      <template #footer>
        <UiButton variant="ghost" @click="showRegenerate = false">Отмена</UiButton>
        <UiButton
          variant="danger"
          :disabled="!acknowledged || !preview"
          :loading="regenerating"
          @click="confirmRegenerate"
        >
          Перегенерировать{{ preview ? ` за ${formatMoney(preview.estimatedCostUsd)}` : '' }}
        </UiButton>
      </template>
    </UiModal>
  </section>
</template>

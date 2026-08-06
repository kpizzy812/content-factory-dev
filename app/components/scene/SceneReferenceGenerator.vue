<script setup lang="ts">
/**
 * Генерация эталонного кадра сцены по промпту. Пара к SceneReferenceUploader:
 * тот принимает готовые файлы, этот рисует новые.
 *
 * Соотношение по умолчанию вертикальное: кадры сцены уходят в image-to-video
 * для вертикальных роликов.
 */
import type { SceneReferenceImage, SceneReferenceKind } from '~~/shared/types/scene'
import { SCENE_REFERENCE_KINDS, SCENE_REFERENCE_KIND_LABELS } from '~~/shared/types/scene'
import {
  IMAGE_GENERATION_MODELS,
  IMAGE_GENERATION_ASPECTS,
  estimateImageGenerationCostUsd,
  type ImageGenerationAspect,
} from '~~/shared/data/image-generation-models'

const props = defineProps<{
  sceneId: string
  appId: number
  /** Пре-заполнение промпта — приходит из «Сгенерировать снова». */
  initialPrompt?: string
}>()

const emit = defineEmits<{
  generated: [image: SceneReferenceImage]
}>()

const prompt = ref(props.initialPrompt ?? '')
const modelId = ref<string>(IMAGE_GENERATION_MODELS[0]!.id)
const kind = ref<SceneReferenceKind>('mood')
const aspect = ref<ImageGenerationAspect>('portrait')

const isOpen = ref(false)
const generating = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

watch(() => props.initialPrompt, (v) => {
  if (v) {
    prompt.value = v
    isOpen.value = true
  }
})

const estimatedCost = computed(() => estimateImageGenerationCostUsd(modelId.value, aspect.value))
const canGenerate = computed(() => !generating.value && prompt.value.trim().length > 0)
const modelHint = computed(() => IMAGE_GENERATION_MODELS.find(m => m.id === modelId.value)?.hint)

async function onGenerate() {
  if (!canGenerate.value) return
  generating.value = true
  errorMessage.value = ''
  successMessage.value = ''
  try {
    const res = await $fetch<{ data: { reference: SceneReferenceImage, deduplicated: boolean } }>(
      `/api/scenes/${props.sceneId}/generate-reference`,
      {
        method: 'POST',
        body: {
          prompt: prompt.value.trim(),
          modelId: modelId.value,
          kind: kind.value,
          aspect: aspect.value,
        },
      },
    )
    emit('generated', res.data.reference)
    successMessage.value = res.data.deduplicated
      ? 'Такой кадр уже был — добавили существующий'
      : 'Готово, разбираем кадр'
    setTimeout(() => { successMessage.value = '' }, 3000)
  }
  catch (e) {
    errorMessage.value = (e as { data?: { message?: string }, message?: string })?.data?.message
      || (e as Error)?.message
      || 'Не удалось сгенерировать'
  }
  finally {
    generating.value = false
  }
}
</script>

<template>
  <section class="overflow-hidden rounded-md border border-border">
    <div class="flex items-center gap-2 bg-card px-2.5 py-1.5">
      <button
        type="button"
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-sm font-medium"
        :aria-expanded="isOpen"
        @click="isOpen = !isOpen"
      >
        <Icon
          name="mingcute:right-line"
          class="shrink-0 text-subtle transition-transform duration-(--duration-fast)"
          :class="isOpen && 'rotate-90'"
        />
        <Icon name="mingcute:magic-2-line" class="shrink-0 text-accent" />
        Сгенерировать кадр по промпту
      </button>
      <span class="tnum shrink-0 font-mono text-micro text-subtle">≈ ${{ estimatedCost }}</span>
    </div>

    <div v-if="isOpen" class="flex flex-col gap-3 px-2.5 py-2.5">
      <UiField label="Промпт" :hint="modelHint">
        <UiTextarea
          v-model="prompt"
          :rows="3"
          placeholder="Утренняя кухня, мягкий свет из окна, чашка кофе на столе, тёплая гамма, кинематографичный кадр"
        />
      </UiField>

      <div class="grid gap-2 sm:grid-cols-3">
        <UiField label="Модель">
          <UiSelect
            v-model="modelId"
            :options="IMAGE_GENERATION_MODELS.map(m => ({ value: m.id, label: `${m.name} · $${m.pricePerMpUsd.toFixed(3)}/Mp` }))"
          />
        </UiField>

        <UiField label="Тип кадра">
          <UiSelect
            v-model="kind"
            :options="SCENE_REFERENCE_KINDS.map(k => ({ value: k, label: SCENE_REFERENCE_KIND_LABELS[k] }))"
          />
        </UiField>

        <UiField label="Соотношение">
          <UiSelect
            v-model="aspect"
            :options="IMAGE_GENERATION_ASPECTS.map(a => ({ value: a.id, label: a.label }))"
          />
        </UiField>
      </div>

      <div
        v-if="errorMessage"
        role="alert"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        <span>{{ errorMessage }}</span>
      </div>

      <div
        v-if="successMessage"
        role="status"
        class="flex items-start gap-2 rounded-md border border-success-border bg-success-bg px-2.5 py-2 text-sm text-success"
      >
        <Icon name="mingcute:check-line" class="mt-0.5 shrink-0" />
        <span>{{ successMessage }}</span>
      </div>

      <div class="flex justify-end">
        <UiButton variant="primary" :disabled="!canGenerate" :loading="generating" @click="onGenerate">
          <Icon v-if="!generating" name="mingcute:magic-2-line" />
          {{ generating ? 'Генерируем' : `Сгенерировать · ≈ $${estimatedCost}` }}
        </UiButton>
      </div>
    </div>
  </section>
</template>

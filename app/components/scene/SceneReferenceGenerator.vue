<script setup lang="ts">
/**
 * AI-генератор эталонных кадров сцены через fal.ai (FLUX Schnell / Dev).
 * Pair к SceneReferenceUploader: uploader = ручная загрузка, generator =
 * генерация по промту. Default aspect = portrait (9:16) — сцены идут на
 * TikTok/Reels image-to-video pipeline.
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

watch(() => props.initialPrompt, (v) => { if (v) { prompt.value = v; isOpen.value = true } })

const estimatedCost = computed(() => estimateImageGenerationCostUsd(modelId.value, aspect.value))
const canGenerate = computed(() => !generating.value && prompt.value.trim().length > 0)

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
      ? 'Такой же кадр уже есть — добавили существующий'
      : 'Сгенерировано! AI vision разбирает кадр…'
    setTimeout(() => { successMessage.value = '' }, 3000)
  } catch (e: any) {
    errorMessage.value = e?.data?.message || e?.message || 'Ошибка генерации'
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <div class="collapse collapse-arrow border border-base-300 bg-base-200/40 rounded-lg">
    <input v-model="isOpen" type="checkbox" />
    <div class="collapse-title text-sm font-medium flex items-center gap-2">
      <Icon name="mingcute:magic-2-line" class="size-4 text-secondary" />
      <span>Сгенерировать через AI (fal.ai)</span>
      <span class="badge badge-xs badge-soft badge-secondary">beta</span>
    </div>
    <div class="collapse-content space-y-3">
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Промт (RU/EN, mood/lighting/композиция)</legend>
        <textarea
          v-model="prompt"
          class="textarea textarea-sm w-full"
          rows="3"
          placeholder="Утренняя кухня с мягким светом из окна, чашка кофе на столе, тёплая цветовая гамма, кинематографичный кадр"
        />
      </fieldset>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Модель</legend>
          <select v-model="modelId" class="select select-sm w-full">
            <option v-for="m in IMAGE_GENERATION_MODELS" :key="m.id" :value="m.id">
              {{ m.name }} (${{ m.pricePerMpUsd.toFixed(3) }}/Mp)
            </option>
          </select>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Тип</legend>
          <select v-model="kind" class="select select-sm w-full">
            <option v-for="k in SCENE_REFERENCE_KINDS" :key="k" :value="k">
              {{ SCENE_REFERENCE_KIND_LABELS[k] }}
            </option>
          </select>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Соотношение</legend>
          <select v-model="aspect" class="select select-sm w-full">
            <option v-for="a in IMAGE_GENERATION_ASPECTS" :key="a.id" :value="a.id">
              {{ a.label }}
            </option>
          </select>
        </fieldset>
      </div>

      <div class="flex items-center gap-3 flex-wrap text-xs">
        <span class="text-base-content/60">Примерно <span class="font-semibold text-base-content">${{ estimatedCost }}</span> за генерацию</span>
        <span class="text-base-content/40">·</span>
        <span class="text-base-content/60">{{ IMAGE_GENERATION_MODELS.find(m => m.id === modelId)?.hint }}</span>
      </div>

      <div v-if="errorMessage" role="alert" class="alert alert-error alert-soft text-sm py-2">
        <Icon name="mingcute:warning-line" />
        <span>{{ errorMessage }}</span>
      </div>
      <div v-if="successMessage" role="alert" class="alert alert-success alert-soft text-sm py-2">
        <Icon name="mingcute:check-circle-line" />
        <span>{{ successMessage }}</span>
      </div>

      <div class="flex justify-end">
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="!canGenerate"
          @click="onGenerate"
        >
          <span v-if="generating" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:magic-2-line" class="size-4" />
          {{ generating ? 'Генерируем… ~5s' : 'Сгенерировать' }}
        </button>
      </div>
    </div>
  </div>
</template>

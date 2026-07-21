<script setup lang="ts">
/**
 * AI-генератор референс-изображений персонажа через fal.ai (FLUX Schnell / Dev).
 * Эта панель — pair к CharacterReferenceUploader на /characters/[id]:
 * uploader = ручная загрузка, generator = генерация по промту.
 *
 * Результат отправляется на POST /api/characters/[id]/generate-reference,
 * сервер сохраняет в GCS, создаёт CharacterReferenceImage и эмитит
 * 'generated' с записью (родитель обновляет галерею через refresh).
 *
 * UI — DaisyUI collapse (свёрнут по умолчанию, чтобы не съедать карточку).
 */
import type { CharacterReferenceImage, CharacterReferenceKind } from '~~/shared/types/character'
import { CHARACTER_REFERENCE_KINDS, CHARACTER_REFERENCE_KIND_LABELS } from '~~/shared/types/character'
import {
  IMAGE_GENERATION_MODELS,
  IMAGE_GENERATION_ASPECTS,
  estimateImageGenerationCostUsd,
  type ImageGenerationAspect,
} from '~~/shared/data/image-generation-models'

const props = defineProps<{
  characterId: string
  appId: number
  /** Если задан — pre-fill промта (used by "Сгенерировать снова" с тем же промтом). */
  initialPrompt?: string
}>()

const emit = defineEmits<{
  generated: [image: CharacterReferenceImage]
}>()

const prompt = ref(props.initialPrompt ?? '')
const modelId = ref<string>(IMAGE_GENERATION_MODELS[0]!.id)
const kind = ref<CharacterReferenceKind>('face')
const aspect = ref<ImageGenerationAspect>('square')

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
    const res = await $fetch<{ data: { reference: CharacterReferenceImage, deduplicated: boolean } }>(
      `/api/characters/${props.characterId}/generate-reference`,
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
      ? 'Такое же изображение уже есть — добавили существующее'
      : 'Сгенерировано! AI vision разбирает результат…'
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
        <legend class="fieldset-legend">Промт (RU/EN, что должно быть на фото)</legend>
        <textarea
          v-model="prompt"
          class="textarea textarea-sm w-full"
          rows="3"
          placeholder="Девушка 25 лет, выразительные глаза, темные волосы, мягкое освещение, кадр выше плеч, нейтральный фон"
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
            <option v-for="k in CHARACTER_REFERENCE_KINDS" :key="k" :value="k">
              {{ CHARACTER_REFERENCE_KIND_LABELS[k] }}
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

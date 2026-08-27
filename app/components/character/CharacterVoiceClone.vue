<script setup lang="ts">
import { formatMoney } from '~~/shared/utils/money'
import type { VoiceCloneResult } from '~~/shared/types/edit-console'
import { VOICE_CLONE_USD } from '~~/shared/types/edit-console'
import { voiceSampleRejection } from '~/components/video/edit-console-model'
import { cloneVoice, consoleErrorText } from '~/components/video/edit-console-api'

/**
 * Клон голоса персонажа.
 *
 * Единственное действие на карточке персонажа, которое стоит денег: прогон
 * клонирования списывает фиксированные 3 $. Поэтому сумма стоит прямо на
 * кнопке, подтверждение — отдельной галочкой, а запрос не уходит, пока сумма
 * не подтверждена: то же самое требует и сервер отдельным полем в теле.
 *
 * Макет: design-preview/catalog/09-edit-console.dc.html (секция «Клон голоса»).
 */
const props = defineProps<{
  characterId: string
  voiceId?: string | null
  voiceModelId?: string | null
  voiceSampleSha1?: string | null
}>()

const emit = defineEmits<{ changed: [] }>()

const toast = useToast()

/**
 * Голос обучается ПОД конкретную модель: тот же идентификатор в другой модели
 * не существует. Список короткий и осознанно захардкожен — реестр моделей
 * клиенту не отдаётся.
 */
const TARGET_MODELS = [
  { value: 'speech-02-turbo', label: 'speech-02-turbo' },
  { value: 'speech-02-hd', label: 'speech-02-hd' },
]

const targetModel = ref(props.voiceModelId || 'speech-02-turbo')
const noiseReduction = ref(true)
const volumeNormalization = ref(false)

const fileInput = ref<HTMLInputElement | null>(null)
const file = ref<File | null>(null)
const dragOver = ref(false)

const sampleError = computed(() => voiceSampleRejection(file.value))

const showConfirm = ref(false)
const acknowledged = ref(false)
const cloning = ref(false)
const error = ref('')

const cloned = computed(() => !!props.voiceId)

function pickFiles(files: FileList | null) {
  const next = files?.[0] ?? null
  if (!next) return
  file.value = next
  error.value = ''
}

function onDrop(event: DragEvent) {
  dragOver.value = false
  pickFiles(event.dataTransfer?.files ?? null)
}

function openConfirm() {
  if (!file.value || sampleError.value) return
  acknowledged.value = false
  error.value = ''
  showConfirm.value = true
}

async function submit() {
  if (!file.value) return
  cloning.value = true
  error.value = ''
  try {
    // Сумма передаётся ровно та, что подтвердил оператор: галочка снята —
    // сюда приходит 0, и запрос не уходит вовсе.
    const result = await cloneVoice($fetch, props.characterId, {
      file: file.value,
      targetModel: targetModel.value,
      confirmedUsd: acknowledged.value ? VOICE_CLONE_USD : 0,
      noiseReduction: noiseReduction.value,
      volumeNormalization: volumeNormalization.value,
    })
    const data = (result as { data?: VoiceCloneResult })?.data ?? null
    if (data?.source === 'cloned') toast.success(`Голос обучен · списано ${formatMoney(data.costUsd)}`)
    else toast.success('Этот образец уже обучался — голос переиспользован, списания нет')
    showConfirm.value = false
    file.value = null
    if (fileInput.value) fileInput.value.value = ''
    emit('changed')
  }
  catch (e) {
    error.value = consoleErrorText(e, 'Не удалось клонировать голос')
  }
  finally {
    cloning.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Готовый голос: видно, что обучено, под какую модель и когда. -->
    <div v-if="cloned" class="rounded-lg border border-border bg-card p-3">
      <div class="mb-2 flex items-center gap-2">
        <Icon name="mingcute:mic-line" class="text-success" />
        <span class="font-medium">Голос обучен</span>
        <span class="flex-1" />
        <span class="inline-flex h-5 items-center gap-1 rounded-sm border border-success-border bg-success-bg px-1.5 text-micro text-success">
          <Icon name="mingcute:check-line" />
          готов
        </span>
      </div>
      <UiKeyValue
        :items="[
          { label: 'voiceId', value: voiceId, mono: true },
          { label: 'Модель', value: voiceModelId, mono: true },
          { label: 'Образец', value: voiceSampleSha1 ? `sha1 ${voiceSampleSha1.slice(0, 12)}…` : null, mono: true },
        ]"
      />
      <p class="mt-2 text-micro text-subtle">
        Голос привязан к модели «{{ voiceModelId }}». В другой TTS-модели этого голоса
        не существует — переобучение будет стоить ещё {{ formatMoney(VOICE_CLONE_USD) }}.
      </p>
    </div>

    <!-- Образец -->
    <div
      class="cursor-pointer rounded-lg border-2 border-dashed p-5 transition-colors duration-(--duration-fast)"
      :class="dragOver ? 'border-accent bg-accent-bg' : 'border-border hover:border-subtle'"
      role="button"
      tabindex="0"
      @click="fileInput?.click()"
      @keydown.enter="fileInput?.click()"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="onDrop"
    >
      <input
        ref="fileInput"
        type="file"
        accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav"
        class="hidden"
        @change="pickFiles(($event.target as HTMLInputElement).files)"
      >
      <div class="flex flex-col items-center gap-1 text-center">
        <Icon name="mingcute:mic-line" class="text-2xl text-subtle" />
        <span class="text-sm font-medium">
          {{ file ? file.name : (cloned ? 'Заменить образец голоса' : 'Образец голоса') }}
        </span>
        <span class="text-micro text-subtle">
          MP3, M4A или WAV · от 10 секунд до 5 минут · до 20 МБ
        </span>
      </div>
    </div>

    <p
      v-if="sampleError"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      {{ sampleError }}
    </p>

    <div class="grid gap-3 sm:grid-cols-2">
      <UiField
        label="Целевая TTS-модель"
        hint="Голос обучается под конкретную модель — в другой его не существует."
      >
        <UiSelect v-model="targetModel" :options="TARGET_MODELS" />
      </UiField>
      <div class="flex flex-col justify-center gap-2">
        <UiCheckbox v-model="noiseReduction" label="Шумоподавление" />
        <UiCheckbox v-model="volumeNormalization" label="Нормализация громкости" />
      </div>
    </div>

    <!-- Дорогое действие: сумма на кнопке, а не в подписи сверху. -->
    <div class="rounded-md border border-danger-border bg-danger-bg p-3">
      <p class="mb-2 flex items-start gap-2 text-sm text-muted">
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-danger" />
        <span>
          Каждый успешный прогон клонирования списывает фиксированные
          <b class="text-danger">{{ formatMoney(VOICE_CLONE_USD) }}</b>.
          Повторная загрузка того же файла бесплатна — голос переиспользуется.
        </span>
      </p>
      <UiButton
        variant="danger"
        :disabled="!file || !!sampleError"
        class="w-full"
        @click="openConfirm"
      >
        Клонировать голос за {{ formatMoney(VOICE_CLONE_USD) }}
      </UiButton>
      <p v-if="!file" class="mt-1.5 text-center text-micro text-subtle">Сначала выберите образец</p>
    </div>

    <p
      v-if="error && !showConfirm"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      {{ error }}
    </p>

    <UiModal :open="showConfirm" title="Клонировать голос?" size="sm" @close="showConfirm = false">
      <div class="mb-3 flex items-baseline gap-2.5 rounded-md border border-danger-border bg-danger-bg px-3 py-2.5">
        <span class="tnum font-mono text-2xl leading-none font-bold text-danger">
          {{ formatMoney(VOICE_CLONE_USD) }}
        </span>
        <span class="text-sm text-muted">фиксированная цена прогона</span>
      </div>

      <UiKeyValue
        :items="[
          { label: 'Образец', value: file?.name ?? null, mono: true },
          { label: 'Размер', value: file ? `${(file.size / 1024 / 1024).toFixed(1)} МБ` : null, mono: true },
          { label: 'Модель', value: targetModel, mono: true },
        ]"
      />

      <label class="mt-3 flex cursor-pointer items-start gap-2.5 text-sm">
        <UiCheckbox v-model="acknowledged" />
        <span>Подтверждаю списание <b>{{ formatMoney(VOICE_CLONE_USD) }}</b> за этот прогон</span>
      </label>

      <p
        v-if="error"
        role="alert"
        class="mt-3 flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        {{ error }}
      </p>

      <template #footer>
        <UiButton variant="ghost" @click="showConfirm = false">Отмена</UiButton>
        <UiButton variant="danger" :disabled="!acknowledged" :loading="cloning" @click="submit">
          Клонировать за {{ formatMoney(VOICE_CLONE_USD) }}
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>

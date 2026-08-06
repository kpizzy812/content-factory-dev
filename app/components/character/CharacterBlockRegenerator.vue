<script setup lang="ts">
/**
 * Кнопка «AI пересобрать» рядом с описанием и визуальным промптом персонажа.
 * Модалка спрашивает, что именно поменять, и показывает результат до и после.
 */
type BlockType = 'description' | 'visualPrompt'

const props = defineProps<{
  characterId: string
  blockType: BlockType
  /** Текущее значение поля — показывается в модалке как «было». */
  currentValue?: string | null
}>()

const emit = defineEmits<{
  'update:value': [value: string]
  error: [message: string]
}>()

const open = ref(false)
const reasonText = ref('')
const isBusy = ref(false)
const errorMsg = ref('')
const lastNewValue = ref('')

const LABELS: Record<BlockType, { title: string, placeholder: string }> = {
  description: {
    title: 'Описание персонажа',
    placeholder: 'Например: добавь татуировку на руке, сделай характер сдержаннее',
  },
  visualPrompt: {
    title: 'Визуальный промпт',
    placeholder: 'Например: emphasize short curly hair, replace red jacket with black hoodie',
  },
}

const meta = computed(() => LABELS[props.blockType])

function show() {
  reasonText.value = ''
  errorMsg.value = ''
  isBusy.value = false
  lastNewValue.value = ''
  open.value = true
}

function close() {
  if (!isBusy.value) open.value = false
}

async function submit() {
  isBusy.value = true
  errorMsg.value = ''
  try {
    const res = await $fetch<{ data: { newValue: string, oldValue: string, blockType: BlockType } }>(
      `/api/characters/${props.characterId}/regenerate`,
      {
        method: 'POST',
        body: { blockType: props.blockType, reason: reasonText.value.trim() || undefined },
      },
    )
    lastNewValue.value = res.data.newValue
    emit('update:value', res.data.newValue)
  }
  catch (e) {
    const msg = (e as { data?: { message?: string }, message?: string })?.data?.message
      || (e as Error)?.message
      || 'Не удалось перегенерировать поле'
    errorMsg.value = msg
    emit('error', msg)
  }
  finally {
    isBusy.value = false
  }
}
</script>

<template>
  <span>
    <UiButton variant="ghost" title="Перегенерировать через AI" @click="show">
      <Icon name="mingcute:ai-line" class="text-accent" />
      AI пересобрать
    </UiButton>

    <UiModal :open="open" :title="`AI-регенерация: ${meta.title}`" @close="close">
      <div class="flex flex-col gap-3">
        <p class="text-sm text-muted">
          Можно ничего не писать — тогда AI пересоберёт поле по референс-фото и остальным
          свойствам персонажа.
        </p>

        <UiField v-if="currentValue" label="Сейчас">
          <UiTextarea :model-value="currentValue" :rows="3" disabled />
        </UiField>

        <UiField label="Что изменить" hint="Необязательно">
          <UiTextarea
            v-model="reasonText"
            :rows="3"
            :placeholder="meta.placeholder"
            :disabled="isBusy"
          />
        </UiField>

        <UiField v-if="lastNewValue" label="Стало — уже применено">
          <UiTextarea :model-value="lastNewValue" :rows="3" disabled />
        </UiField>

        <div
          v-if="errorMsg"
          role="alert"
          class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
        >
          <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
          <span>{{ errorMsg }}</span>
        </div>
      </div>

      <template #footer>
        <UiButton variant="ghost" :disabled="isBusy" @click="close">
          {{ lastNewValue ? 'Закрыть' : 'Отмена' }}
        </UiButton>
        <UiButton variant="primary" :loading="isBusy" @click="submit">
          <Icon v-if="!isBusy" name="mingcute:magic-2-line" />
          {{ lastNewValue ? 'Ещё раз' : 'Перегенерировать' }} · платно
        </UiButton>
      </template>
    </UiModal>
  </span>
</template>

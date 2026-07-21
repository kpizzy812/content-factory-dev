<script setup lang="ts">
/**
 * CharacterBlockRegenerator — кнопка "AI пересобрать" рядом с полем
 * Описание / Visual prompt на /characters/[id].
 *
 * Открывает модалку с textarea reason → POST /api/characters/:id/regenerate.
 * После успеха эмитит update:value (родитель обновляет form.{description|visualPrompt}).
 */
type BlockType = 'description' | 'visualPrompt'

const props = defineProps<{
  characterId: string
  blockType: BlockType
  /** Текущее значение поля — для UI «было / стало». */
  currentValue?: string | null
}>()

const emit = defineEmits<{
  'update:value': [value: string]
  error: [message: string]
}>()

const dialogRef = ref<HTMLDialogElement>()
const reasonText = ref('')
const isBusy = ref(false)
const errorMsg = ref('')
const lastOldValue = ref<string>('')
const lastNewValue = ref<string>('')

const labels: Record<BlockType, { title: string; placeholder: string }> = {
  description: {
    title: 'Описание персонажа',
    placeholder: 'Например: добавь упоминание татуировки на руке, сделай характер более интровертным…',
  },
  visualPrompt: {
    title: 'Visual prompt (EN)',
    placeholder: 'Например: emphasize short curly hair, replace red jacket with black hoodie…',
  },
}

const meta = computed(() => labels[props.blockType])

function open() {
  reasonText.value = ''
  errorMsg.value = ''
  isBusy.value = false
  lastOldValue.value = ''
  lastNewValue.value = ''
  dialogRef.value?.showModal()
}

function close() {
  if (isBusy.value) return
  dialogRef.value?.close()
}

async function submit() {
  isBusy.value = true
  errorMsg.value = ''
  try {
    const res = await $fetch<{ data: { newValue: string; oldValue: string; blockType: BlockType } }>(
      `/api/characters/${props.characterId}/regenerate`,
      {
        method: 'POST',
        body: { blockType: props.blockType, reason: reasonText.value.trim() || undefined },
      },
    )
    lastOldValue.value = res.data.oldValue
    lastNewValue.value = res.data.newValue
    emit('update:value', res.data.newValue)
  }
  catch (e: unknown) {
    const err = e as { data?: { message?: string }, message?: string }
    const msg = err?.data?.message || err?.message || 'Не удалось перегенерировать поле'
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
    <button
      type="button"
      class="btn btn-xs btn-ghost gap-1"
      title="Перегенерировать через AI"
      @click="open"
    >
      <Icon name="mingcute:ai-line" class="size-3.5 text-primary" />
      AI пересобрать
    </button>

    <dialog ref="dialogRef" class="modal" @close="close">
      <div class="modal-box max-w-xl">
        <h3 class="font-bold text-base mb-1">
          AI-регенерация: {{ meta.title }}
        </h3>
        <p class="text-xs text-base-content/60 mb-3">
          Опционально опишите, что именно изменить — AI учтёт reason и реф-фото персонажа.
        </p>

        <fieldset v-if="currentValue" class="fieldset">
          <legend class="fieldset-legend">Текущее значение</legend>
          <textarea
            class="textarea textarea-sm w-full font-mono text-xs"
            rows="3"
            :value="currentValue"
            readonly
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Что изменить (опц.)</legend>
          <textarea
            v-model="reasonText"
            class="textarea textarea-sm w-full"
            rows="3"
            :placeholder="meta.placeholder"
            :disabled="isBusy"
          />
        </fieldset>

        <div v-if="lastNewValue" class="mt-3 space-y-2">
          <fieldset class="fieldset">
            <legend class="fieldset-legend text-success">Новое значение (применено)</legend>
            <textarea
              class="textarea textarea-sm w-full font-mono text-xs border-success"
              rows="3"
              :value="lastNewValue"
              readonly
            />
          </fieldset>
        </div>

        <p v-if="errorMsg" role="alert" class="alert alert-error alert-soft mt-3 text-xs">
          <Icon name="mingcute:warning-line" class="size-4" />
          <span>{{ errorMsg }}</span>
        </p>

        <div class="modal-action">
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            :disabled="isBusy"
            @click="close"
          >
            {{ lastNewValue ? 'Закрыть' : 'Отмена' }}
          </button>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            :disabled="isBusy"
            @click="submit"
          >
            <span v-if="isBusy" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:magic-2-line" class="size-4" />
            {{ lastNewValue ? 'Сгенерировать ещё раз' : 'Перегенерировать' }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="close">close</button>
      </form>
    </dialog>
  </span>
</template>

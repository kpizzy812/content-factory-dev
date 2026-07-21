<script setup lang="ts">
/**
 * SceneBlockAiRegenerate — кнопка "🪄 AI" рядом с блоком сцены (action/style/environment).
 *
 * Клик открывает модалку с textarea reason → POST /api/scenes/:id/blocks/:blockId/regenerate.
 * После успеха эмитит update:block + (опц.) compiledPrompt, чтобы родитель синкнул UI.
 */
import type { SceneBlock } from '~~/shared/types/scene'

const props = defineProps<{
  sceneId: string
  block: SceneBlock
}>()

const emit = defineEmits<{
  'update:block': [block: SceneBlock]
  'compiled-prompt': [prompt: string | null]
  error: [message: string]
}>()

const dialogRef = ref<HTMLDialogElement>()
const reasonText = ref('')
const isBusy = ref(false)
const errorMsg = ref('')

function open() {
  reasonText.value = ''
  errorMsg.value = ''
  isBusy.value = false
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
    const res = await $fetch<{ data: { updatedBlock: SceneBlock; sceneCompiledPrompt: string | null } }>(
      `/api/scenes/${props.sceneId}/blocks/${props.block.id}/regenerate`,
      { method: 'POST', body: { reason: reasonText.value.trim() || undefined } },
    )
    emit('update:block', res.data.updatedBlock)
    emit('compiled-prompt', res.data.sceneCompiledPrompt ?? null)
    dialogRef.value?.close()
  }
  catch (e: unknown) {
    const err = e as { data?: { message?: string }, message?: string }
    const msg = err?.data?.message || err?.message || 'Не удалось перегенерировать блок'
    errorMsg.value = msg
    emit('error', msg)
  }
  finally {
    isBusy.value = false
  }
}

const supportedKinds = new Set(['action', 'style', 'environment'])
const isSupported = computed(() => supportedKinds.has(props.block.kind))
</script>

<template>
  <span v-if="isSupported">
    <button
      type="button"
      class="btn btn-xs btn-ghost gap-1"
      title="Перегенерировать блок через AI"
      @click="open"
    >
      <Icon name="mingcute:ai-line" class="size-3.5 text-primary" />
      AI
    </button>

    <dialog ref="dialogRef" class="modal" @close="close">
      <div class="modal-box max-w-lg">
        <h3 class="font-bold text-base mb-1">
          AI-регенерация блока «{{ block.kind }}»
        </h3>
        <p class="text-xs text-base-content/60 mb-3">
          Опционально опишите, что именно нужно изменить — AI учтёт reason и сохранит структуру блока.
        </p>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Что изменить (опц.)</legend>
          <textarea
            v-model="reasonText"
            class="textarea textarea-sm w-full"
            rows="3"
            placeholder="Например: добавь больше движения, замени время суток на ночь, сделай камеру crane shot…"
            :disabled="isBusy"
          />
        </fieldset>
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
            Отмена
          </button>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            :disabled="isBusy"
            @click="submit"
          >
            <span v-if="isBusy" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:magic-2-line" class="size-4" />
            Перегенерировать
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="close">close</button>
      </form>
    </dialog>
  </span>
</template>

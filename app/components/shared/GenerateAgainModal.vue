<script setup lang="ts">
/**
 * Модалка "Сгенерировать снова" — две кнопки:
 *   1. Тот же промт — emit('same') с lastPrompt.
 *   2. Новый промт — emit('new', lastPrompt) (родитель открывает форму генератора
 *      и заполняет textarea этим промтом, чтобы юзер мог отредактировать).
 *
 * Открытие — через v-model:open. DaisyUI <dialog>-based modal.
 */
const props = defineProps<{
  open: boolean
  lastPrompt: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  same: [prompt: string]
  new: [prompt: string]
}>()

const dialog = ref<HTMLDialogElement | null>(null)

watch(() => props.open, (open) => {
  const el = dialog.value
  if (!el) return
  if (open && !el.open) el.showModal()
  else if (!open && el.open) el.close()
})

function close() {
  emit('update:open', false)
}
function onSame() {
  emit('same', props.lastPrompt)
  close()
}
function onNew() {
  emit('new', props.lastPrompt)
  close()
}
</script>

<template>
  <dialog ref="dialog" class="modal" @close="close">
    <div class="modal-box">
      <h3 class="font-bold text-lg flex items-center gap-2">
        <Icon name="mingcute:refresh-2-line" class="size-5 text-secondary" />
        Сгенерировать снова
      </h3>
      <p class="text-sm text-base-content/70 mt-2">
        Хотите запустить с тем же промтом или сначала изменить его?
      </p>

      <div v-if="lastPrompt" class="mt-3 p-3 bg-base-200 rounded text-xs text-base-content/80 max-h-32 overflow-y-auto">
        {{ lastPrompt }}
      </div>

      <div class="modal-action flex-wrap gap-2">
        <button type="button" class="btn btn-ghost btn-sm" @click="close">
          Отмена
        </button>
        <button type="button" class="btn btn-outline btn-sm" @click="onNew">
          <Icon name="mingcute:edit-line" class="size-4" />
          Новый промт
        </button>
        <button type="button" class="btn btn-secondary btn-sm" @click="onSame">
          <Icon name="mingcute:magic-2-line" class="size-4" />
          Тот же промт
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>

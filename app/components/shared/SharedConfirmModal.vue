<script setup lang="ts">
type ConfirmVariant = 'danger' | 'warning' | 'primary'

const props = withDefaults(defineProps<{
  title?: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmVariant
}>(), {
  title: 'Подтвердить действие?',
  message: '',
  confirmLabel: 'Подтвердить',
  cancelLabel: 'Отмена',
  variant: 'danger',
})

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const dialogRef = ref<HTMLDialogElement>()
const isBusy = ref(false)

function open() {
  isBusy.value = false
  dialogRef.value?.showModal()
}

function close() {
  dialogRef.value?.close()
  emit('cancel')
}

function setBusy(value: boolean) {
  isBusy.value = value
}

defineExpose({ open, close, setBusy })

const confirmClass = computed(() => {
  switch (props.variant) {
    case 'danger': return 'btn btn-sm btn-error'
    case 'warning': return 'btn btn-sm btn-warning'
    case 'primary': return 'btn btn-sm btn-primary'
  }
  return 'btn btn-sm btn-primary'
})

function handleConfirm() {
  emit('confirm')
}
</script>

<template>
  <dialog ref="dialogRef" class="modal" @close="emit('cancel')">
    <div class="modal-box max-w-lg">
      <h3 class="font-bold text-lg mb-1">{{ title }}</h3>
      <p v-if="message" class="text-xs text-base-content/60 mb-4">{{ message }}</p>
      <div class="modal-action">
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          :disabled="isBusy"
          @click="close"
        >
          {{ cancelLabel }}
        </button>
        <button
          type="button"
          :class="confirmClass"
          :disabled="isBusy"
          @click="handleConfirm"
        >
          <span v-if="isBusy" class="loading loading-spinner loading-xs" />
          {{ confirmLabel }}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>

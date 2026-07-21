<script setup lang="ts">
const emit = defineEmits<{
  save: []
  discard: []
  cancel: []
}>()

const modalRef = ref<HTMLDialogElement | null>(null)
const intentHandled = ref(false)

function open() {
  intentHandled.value = false
  modalRef.value?.showModal()
}

function handleCancel() {
  intentHandled.value = true
  modalRef.value?.close()
  emit('cancel')
}

function handleDiscard() {
  intentHandled.value = true
  modalRef.value?.close()
  emit('discard')
}

function handleSave() {
  intentHandled.value = true
  emit('save')
  modalRef.value?.close()
}

function onClose() {
  if (!intentHandled.value) {
    emit('cancel')
  }
  intentHandled.value = false
}

defineExpose({ open })
</script>

<template>
  <dialog ref="modalRef" class="modal" @close="onClose">
    <div class="modal-box space-y-4">
      <h3 class="text-lg font-bold flex items-center gap-2">
        <Icon name="mingcute:warning-line" class="text-warning text-xl" />
        Несохраненные изменения
      </h3>

      <p class="text-base-content/70">
        У вас есть несохраненные изменения. Что вы хотите сделать?
      </p>

      <div role="alert" class="alert alert-warning alert-soft text-sm">
        <Icon name="mingcute:warning-line" />
        <span>Если вы уйдете без сохранения, все изменения будут потеряны.</span>
      </div>

      <div class="modal-action">
        <button class="btn btn-ghost" @click="handleCancel">
          Остаться
        </button>
        <button class="btn btn-warning btn-outline" @click="handleDiscard">
          Уйти без сохранения
        </button>
        <button class="btn btn-primary" @click="handleSave">
          <Icon name="mingcute:save-line" />
          Сохранить и уйти
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="emit('cancel')">close</button>
    </form>
  </dialog>
</template>

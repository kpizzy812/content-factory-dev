<script setup lang="ts">
const emit = defineEmits<{
  created: []
  close: []
}>()

const dialogRef = ref<HTMLDialogElement>()

function open() {
  dialogRef.value?.showModal()
}

function close() {
  dialogRef.value?.close()
  emit('close')
}

function onSaved() {
  emit('created')
  close()
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="dialogRef" class="modal">
    <div class="modal-box max-w-lg">
      <h3 class="font-bold text-lg mb-1">Новое приложение</h3>
      <p class="text-xs text-base-content/60 mb-4">
        Базовые параметры приложения. Сотрудников и аккаунты привяжите позже в карточке приложения.
      </p>
      <AdminAppForm @saved="onSaved" @cancel="close" />
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>

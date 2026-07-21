<script setup lang="ts">
const emit = defineEmits<{
  saved: []
  close: []
}>()

const dialogRef = ref<HTMLDialogElement>()
const accountId = ref<number | null>(null)
const accountName = ref('')

function open(payload: { accountId: number; accountName: string }) {
  accountId.value = payload.accountId
  accountName.value = payload.accountName
  dialogRef.value?.showModal()
}

function close() {
  dialogRef.value?.close()
  accountId.value = null
  emit('close')
}

function onSaved() {
  emit('saved')
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="dialogRef" class="modal" @close="emit('close')">
    <div class="modal-box max-w-3xl max-h-[90vh] flex flex-col p-0">
      <AccountStyleProfileEditor
        v-if="accountId"
        :account-id="accountId"
        :account-name="accountName"
        class="flex-1 overflow-y-auto p-6"
        @saved="onSaved"
        @close="close"
      />
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>

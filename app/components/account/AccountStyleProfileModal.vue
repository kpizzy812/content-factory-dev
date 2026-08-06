<script setup lang="ts">
/** Оболочка редактора стиль-профиля: заголовок и рамка, содержимое — в редакторе. */
const emit = defineEmits<{ saved: [], close: [] }>()

const isOpen = ref(false)
const accountId = ref<number | null>(null)
const accountName = ref('')

function open(payload: { accountId: number, accountName: string }) {
  accountId.value = payload.accountId
  accountName.value = payload.accountName
  isOpen.value = true
}

function close() {
  isOpen.value = false
  accountId.value = null
  emit('close')
}

defineExpose({ open, close })
</script>

<template>
  <UiModal :open="isOpen" size="lg" @close="close">
    <template #header>
      <span class="flex items-baseline gap-2">
        Стиль-профиль
        <span class="truncate font-mono text-sm font-normal text-subtle">{{ accountName }}</span>
      </span>
    </template>

    <AccountStyleProfileEditor
      v-if="accountId"
      :account-id="accountId"
      :account-name="accountName"
      @saved="emit('saved')"
      @close="close"
    />
  </UiModal>
</template>

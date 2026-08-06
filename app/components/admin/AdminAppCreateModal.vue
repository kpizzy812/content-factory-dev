<script setup lang="ts">
/**
 * Создание приложения. Форма общая с карточкой приложения — здесь только
 * оболочка модалки.
 */
const emit = defineEmits<{
  created: []
  close: []
}>()

const isOpen = ref(false)

function open() {
  isOpen.value = true
}

function close() {
  isOpen.value = false
  emit('close')
}

function onSaved() {
  emit('created')
  close()
}

defineExpose({ open, close })
</script>

<template>
  <UiModal :open="isOpen" title="Новое приложение" size="lg" @close="close">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-muted">
        Базовые параметры. Сотрудников и аккаунты привязывают позже, в карточке приложения.
      </p>
      <AdminAppForm @saved="onSaved" @cancel="close" />
    </div>
  </UiModal>
</template>

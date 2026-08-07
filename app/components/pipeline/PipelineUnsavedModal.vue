<script setup lang="ts">
/**
 * Несохранённые правки при уходе со страницы редактора.
 *
 * Открывается императивно из навигационного гарда: страница узнаёт о попытке
 * уйти раньше, чем успевает выставить проп.
 */
const emit = defineEmits<{
  save: []
  discard: []
  cancel: []
}>()

const isOpen = ref(false)

function open() {
  isOpen.value = true
}

function handleCancel() {
  isOpen.value = false
  emit('cancel')
}

function handleDiscard() {
  isOpen.value = false
  emit('discard')
}

function handleSave() {
  isOpen.value = false
  emit('save')
}

defineExpose({ open })
</script>

<template>
  <UiModal :open="isOpen" @close="handleCancel">
    <template #header>
      <span class="flex items-center gap-2">
        <Icon name="mingcute:warning-line" class="text-warning" />
        Несохранённые изменения
      </span>
    </template>

    <div class="flex flex-col gap-3">
      <p class="text-muted">
        У вас есть несохранённые изменения. Что вы хотите сделать?
      </p>

      <p class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-muted">
        <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0 text-warning" />
        <span>Если вы уйдёте без сохранения, все изменения будут потеряны.</span>
      </p>
    </div>

    <template #footer>
      <UiButton variant="ghost" size="md" @click="handleCancel">Остаться</UiButton>
      <UiButton variant="danger" size="md" @click="handleDiscard">Уйти без сохранения</UiButton>
      <UiButton variant="primary" size="md" @click="handleSave">
        <Icon name="mingcute:save-line" />
        Сохранить и уйти
      </UiButton>
    </template>
  </UiModal>
</template>

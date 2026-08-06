<script setup lang="ts">
/**
 * «Сгенерировать снова»: тем же промптом или сначала поправить его.
 * Открытие — через v-model:open.
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
  <UiModal :open="open" title="Сгенерировать снова" @close="close">
    <p class="text-sm text-muted">Запустить с тем же промптом или сначала изменить его?</p>

    <p v-if="lastPrompt" class="mt-2.5 max-h-32 overflow-y-auto rounded-md bg-surface p-3 text-sm">
      {{ lastPrompt }}
    </p>

    <template #footer>
      <UiButton variant="ghost" @click="close">Отмена</UiButton>
      <UiButton @click="onNew">
        <Icon name="mingcute:edit-line" />
        Изменить промпт
      </UiButton>
      <UiButton variant="primary" @click="onSame">
        <Icon name="mingcute:magic-2-line" />
        Тот же промпт · платно
      </UiButton>
    </template>
  </UiModal>
</template>

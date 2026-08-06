<script setup lang="ts">
/**
 * Удаление конвейера со словом-подтверждением.
 *
 * Операция необратима и уносит версии и историю запусков, поэтому недостаточно
 * кнопки: имя удаляемого написано прямо, а слово вводится руками.
 */
const emit = defineEmits<{ confirmed: [] }>()

const CONFIRM_WORD = 'УДАЛИТЬ'

const isOpen = ref(false)
const confirmText = ref('')
const pipelineName = ref('')

const isConfirmed = computed(() => confirmText.value.trim() === CONFIRM_WORD)

function open(name: string) {
  pipelineName.value = name
  confirmText.value = ''
  isOpen.value = true
}

function close() {
  isOpen.value = false
}

function handleConfirm() {
  if (!isConfirmed.value) return
  close()
  emit('confirmed')
}

defineExpose({ open, close })
</script>

<template>
  <UiModal :open="isOpen" size="sm" title="Удалить конвейер?" @close="close">
    <div class="flex flex-col gap-3">
      <p class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-fg">
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-danger" />
        <span>
          Конвейер «{{ pipelineName }}», его версии, расписание и вся история
          запусков удаляются навсегда. Отменить нельзя.
        </span>
      </p>

      <UiField :label="`Введите ${CONFIRM_WORD}, чтобы подтвердить`">
        <UiInput
          v-model="confirmText"
          :placeholder="CONFIRM_WORD"
          :invalid="!!confirmText && !isConfirmed"
          @keydown.enter.prevent="handleConfirm"
        />
      </UiField>
    </div>

    <template #footer>
      <UiButton variant="ghost" @click="close">Отмена</UiButton>
      <UiButton variant="danger" :disabled="!isConfirmed" @click="handleConfirm">
        Удалить навсегда
      </UiButton>
    </template>
  </UiModal>
</template>

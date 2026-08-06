<script setup lang="ts">
/**
 * Подтверждение удаления приложения.
 *
 * Слово вручную, а не просто кнопка: удаление необратимо и уносит метаданные,
 * историю обогащения и настройки. Связанные тренды, аккаунты и циклы удалить
 * не дадут — это проверяет сервер.
 */
const emit = defineEmits<{
  confirmed: []
}>()

const isOpen = ref(false)
const confirmText = ref('')
const appName = ref('')

const CONFIRM_WORD = 'УДАЛИТЬ'

const isConfirmed = computed(() => confirmText.value === CONFIRM_WORD)

function open(name: string) {
  appName.value = name
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
  <UiModal :open="isOpen" title="Удаление приложения" @close="close">
    <div class="flex flex-col gap-3">
      <p
        role="alert"
        class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm text-warning"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        <span>
          <span class="font-medium">Отменить не получится.</span>
          Приложение, его метаданные, история обогащения и настройки удаляются навсегда.
          Если есть связанные тренды, аккаунты или циклы — сервер откажет.
        </span>
      </p>

      <p class="text-sm text-muted">
        Удаляем приложение <span class="font-medium text-fg">{{ appName }}</span>.
      </p>

      <UiField :label="`Введите ${CONFIRM_WORD}, чтобы подтвердить`">
        <UiInput
          v-model="confirmText"
          :placeholder="CONFIRM_WORD"
          :invalid="Boolean(confirmText) && !isConfirmed"
          @keydown.enter.prevent="handleConfirm"
        />
      </UiField>
    </div>

    <template #footer>
      <UiButton variant="ghost" @click="close">Отмена</UiButton>
      <UiButton variant="danger" :disabled="!isConfirmed" @click="handleConfirm">
        <Icon name="mingcute:delete-2-line" />
        Удалить навсегда
      </UiButton>
    </template>
  </UiModal>
</template>

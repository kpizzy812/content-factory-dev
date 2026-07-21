<script setup lang="ts">
const emit = defineEmits<{
  confirmed: []
}>()

const modalRef = ref<HTMLDialogElement | null>(null)
const confirmText = ref('')
const appName = ref('')

const CONFIRM_WORD = 'УДАЛИТЬ'

const isConfirmed = computed(() => confirmText.value === CONFIRM_WORD)

function open(name: string) {
  appName.value = name
  confirmText.value = ''
  modalRef.value?.showModal()
}

function close() {
  modalRef.value?.close()
}

function handleConfirm() {
  if (!isConfirmed.value) return
  close()
  emit('confirmed')
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="modalRef" class="modal">
    <div class="modal-box">
      <h3 class="text-lg font-bold flex items-center gap-2">
        <Icon name="mingcute:delete-2-line" class="text-error" />
        Удаление приложения
      </h3>

      <div class="mt-4 space-y-4">
        <div role="alert" class="alert alert-warning">
          <Icon name="mingcute:warning-line" class="text-xl" />
          <div>
            <p class="font-semibold">Это действие нельзя отменить</p>
            <p class="text-sm opacity-80">
              Приложение, его метаданные, enrichment-история и все настройки будут удалены навсегда.
              Если у приложения есть связанные тренды, аккаунты или циклы — удаление будет отклонено сервером.
            </p>
          </div>
        </div>

        <p class="text-sm">
          Вы собираетесь удалить приложение
          <span class="font-bold">{{ appName }}</span>.
        </p>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">
            Введите <kbd class="kbd kbd-sm">{{ CONFIRM_WORD }}</kbd> для подтверждения
          </legend>
          <input
            v-model="confirmText"
            type="text"
            class="input input-error w-full"
            :placeholder="CONFIRM_WORD"
            autocomplete="off"
            @keydown.enter.prevent="handleConfirm"
          />
        </fieldset>
      </div>

      <div class="modal-action">
        <form method="dialog">
          <button class="btn">Отмена</button>
        </form>
        <button
          class="btn btn-error"
          :disabled="!isConfirmed"
          @click="handleConfirm"
        >
          <Icon name="mingcute:delete-2-line" />
          Удалить навсегда
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button>close</button>
    </form>
  </dialog>
</template>

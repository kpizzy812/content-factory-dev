<script setup lang="ts">
import { pipelineColors as availableColors, pipelineIcons as availableIcons, getPipelineColorClasses } from '~~/shared/utils/pipeline-meta'

const emit = defineEmits<{
  created: []
}>()

const { createPipeline, error } = usePipelineActions()

const modalRef = ref<HTMLDialogElement | null>(null)
const pipelineName = ref('')
const pipelineDescription = ref('')
const pipelineIcon = ref('')
const pipelineColor = ref('')
const pipelineTags = ref<string[]>([])
const isCreating = ref(false)
const showAdvanced = ref(false)

const selectedColorObj = computed(() => getPipelineColorClasses(pipelineColor.value))

const selectedIconObj = computed(() =>
  availableIcons.find(i => i.value === pipelineIcon.value) ?? availableIcons[0],
)

const previewColorClasses = computed(() => getPipelineColorClasses(pipelineColor.value))

function open() {
  pipelineName.value = ''
  pipelineDescription.value = ''
  pipelineIcon.value = ''
  pipelineColor.value = ''
  pipelineTags.value = []
  showAdvanced.value = false
  error.value = null
  modalRef.value?.showModal()
}

async function handleCreate() {
  if (!pipelineName.value.trim()) return
  isCreating.value = true

  try {
    const result = await $fetch<{ data: { id: number } }>('/api/pipelines', {
      method: 'POST',
      body: {
        name: pipelineName.value.trim(),
        description: pipelineDescription.value.trim() || undefined,
        icon: pipelineIcon.value || undefined,
        color: pipelineColor.value || undefined,
        tags: pipelineTags.value.length > 0 ? pipelineTags.value : undefined,
      },
    })
    modalRef.value?.close()
    emit('created')
    await navigateTo(`/pipeline/${result.data.id}`)
  }
  catch (e: any) {
    error.value = e?.data?.message || 'Ошибка создания конвейера'
  }
  finally {
    isCreating.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <dialog ref="modalRef" class="modal">
    <div class="modal-box max-w-lg">
      <h3 class="font-bold text-lg mb-1">Создать конвейер</h3>
      <p class="text-xs text-base-content/60 mb-4">
        Базовое имя и описание. Иконку, цвет и теги можно настроить в «Дополнительно».
      </p>

      <div class="space-y-3">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Название</legend>
          <input
            v-model="pipelineName"
            type="text"
            class="input input-sm w-full"
            placeholder="Мой конвейер"
            maxlength="255"
            @keydown.enter.prevent="handleCreate"
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Описание</legend>
          <textarea
            v-model="pipelineDescription"
            class="textarea textarea-sm w-full"
            placeholder="Описание конвейера (необязательно)"
            rows="3"
          />
        </fieldset>

        <!-- Advanced toggle -->
        <button
          class="btn btn-ghost btn-xs gap-1"
          @click="showAdvanced = !showAdvanced"
        >
          <Icon :name="showAdvanced ? 'mingcute:up-line' : 'mingcute:down-line'" class="text-xs" />
          {{ showAdvanced ? 'Скрыть' : 'Дополнительно' }}
        </button>

        <template v-if="showAdvanced">
          <!-- Icon picker with visual preview -->
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Иконка</legend>
            <div class="flex flex-wrap gap-1.5">
              <div
                v-for="icon in availableIcons"
                :key="icon.value"
                class="tooltip tooltip-top"
                :data-tip="icon.label"
              >
                <button
                  type="button"
                  class="btn btn-sm btn-square transition-all"
                  :class="pipelineIcon === icon.value ? 'btn-primary' : 'btn-ghost'"
                  @click="pipelineIcon = icon.value"
                >
                  <Icon :name="icon.icon" class="text-lg" />
                </button>
              </div>
            </div>
            <p v-if="selectedIconObj" class="label text-xs">
              {{ selectedIconObj.label }}
            </p>
          </fieldset>

          <!-- Color picker with visual preview -->
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Цвет</legend>
            <div class="flex flex-wrap gap-1.5">
              <div
                v-for="color in availableColors"
                :key="color.value"
                class="tooltip tooltip-top"
                :data-tip="color.label"
              >
                <button
                  type="button"
                  class="w-8 h-8 rounded-lg border-2 transition-all flex items-center justify-center"
                  :class="[
                    color.css,
                    pipelineColor === color.value
                      ? 'border-base-content scale-110 ring-2 ring-base-content/20'
                      : 'border-base-300 hover:border-base-content/30',
                  ]"
                  @click="pipelineColor = color.value"
                >
                  <Icon
                    v-if="pipelineColor === color.value"
                    name="mingcute:check-line"
                    class="text-sm"
                    :class="color.textContent"
                  />
                </button>
              </div>
            </div>
            <p class="label text-xs">
              {{ selectedColorObj?.label }}
            </p>
          </fieldset>

          <!-- Tags -->
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Теги</legend>
            <PipelineTagPicker v-model="pipelineTags" />
          </fieldset>

          <!-- Live preview -->
          <div v-if="pipelineName.trim()" class="flex items-center gap-3 p-3 bg-base-200/50 rounded-box">
            <div
              class="w-10 h-10 rounded-xl flex items-center justify-center"
              :class="previewColorClasses.bg20"
            >
              <Icon
                :name="pipelineIcon || 'mingcute:git-merge-line'"
                class="text-xl"
                :class="previewColorClasses.text"
              />
            </div>
            <div>
              <div class="font-semibold text-sm">{{ pipelineName }}</div>
              <div v-if="pipelineTags.length > 0" class="flex flex-wrap gap-1 mt-0.5">
                <span v-for="tag in pipelineTags" :key="tag" class="text-xs text-base-content/50">{{ tag }}</span>
              </div>
            </div>
          </div>
        </template>

        <div v-if="error" role="alert" class="alert alert-error text-sm py-2">
          <Icon name="mingcute:warning-line" />
          <span>{{ error }}</span>
        </div>
      </div>

      <div class="modal-action">
        <form method="dialog">
          <button class="btn btn-sm btn-ghost">Отмена</button>
        </form>
        <button
          class="btn btn-sm btn-primary"
          :disabled="!pipelineName.trim() || isCreating"
          @click="handleCreate"
        >
          <span v-if="isCreating" class="loading loading-spinner loading-xs" />
          Создать
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button>close</button>
    </form>
  </dialog>
</template>

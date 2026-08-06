<script setup lang="ts">
/**
 * Кнопка «AI пересобрать» у блока сцены. Зеркалит CharacterBlockRegenerator:
 * модалка спрашивает, что изменить, и после ответа сервер сам сохраняет блок
 * и пересобирает промпт сцены.
 *
 * Поддерживаются только action / style / environment — остальные блоки
 * состоят из ссылок на сущности, переписывать там нечего.
 */
import type { SceneBlock } from '~~/shared/types/scene'
import { SCENE_BLOCK_LABELS } from '~~/shared/types/scene'

const props = defineProps<{
  sceneId: string
  block: SceneBlock
}>()

const emit = defineEmits<{
  'update:block': [block: SceneBlock]
  'compiled-prompt': [prompt: string | null]
  error: [message: string]
}>()

const open = ref(false)
const reasonText = ref('')
const isBusy = ref(false)
const errorMsg = ref('')
const done = ref(false)

const SUPPORTED = new Set(['action', 'style', 'environment'])
const isSupported = computed(() => SUPPORTED.has(props.block.kind))
const blockLabel = computed(() => SCENE_BLOCK_LABELS[props.block.kind])

function show() {
  reasonText.value = ''
  errorMsg.value = ''
  isBusy.value = false
  done.value = false
  open.value = true
}

function close() {
  if (!isBusy.value) open.value = false
}

const { regenerateBlock } = useSceneActions()

async function submit() {
  isBusy.value = true
  errorMsg.value = ''
  try {
    const data = await regenerateBlock(props.sceneId, props.block.id, reasonText.value.trim() || undefined)
    emit('update:block', data.updatedBlock)
    emit('compiled-prompt', data.sceneCompiledPrompt ?? null)
    done.value = true
  }
  catch (e) {
    const msg = (e as { data?: { message?: string }, message?: string })?.data?.message
      || (e as Error)?.message
      || 'Не удалось перегенерировать блок'
    errorMsg.value = msg
    emit('error', msg)
  }
  finally {
    isBusy.value = false
  }
}
</script>

<template>
  <span v-if="isSupported">
    <UiButton variant="ghost" title="Перегенерировать блок через AI" @click="show">
      <Icon name="mingcute:ai-line" class="text-accent" />
      AI
    </UiButton>

    <UiModal :open="open" :title="`AI-регенерация: ${blockLabel}`" @close="close">
      <div class="flex flex-col gap-3">
        <p class="text-sm text-muted">
          Можно ничего не писать — тогда AI пересоберёт блок по остальной сцене. Структура блока
          сохраняется, меняется только содержимое полей.
        </p>

        <UiField label="Что изменить" hint="Необязательно">
          <UiTextarea
            v-model="reasonText"
            :rows="3"
            placeholder="Например: больше движения, ночь вместо утра, камера — crane shot"
            :disabled="isBusy"
          />
        </UiField>

        <p
          v-if="done"
          role="status"
          class="flex items-start gap-2 rounded-md border border-success-border bg-success-bg px-2.5 py-2 text-sm text-success"
        >
          <Icon name="mingcute:check-line" class="mt-0.5 shrink-0" />
          Блок пересобран и уже применён — промпт сцены пересчитан.
        </p>

        <div
          v-if="errorMsg"
          role="alert"
          class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
        >
          <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
          <span>{{ errorMsg }}</span>
        </div>
      </div>

      <template #footer>
        <UiButton variant="ghost" :disabled="isBusy" @click="close">
          {{ done ? 'Закрыть' : 'Отмена' }}
        </UiButton>
        <UiButton variant="primary" :loading="isBusy" @click="submit">
          <Icon v-if="!isBusy" name="mingcute:magic-2-line" />
          {{ done ? 'Ещё раз' : 'Перегенерировать' }} · платно
        </UiButton>
      </template>
    </UiModal>
  </span>
</template>

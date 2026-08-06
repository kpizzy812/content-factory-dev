<script setup lang="ts">
/**
 * Пулы ключевых слов прогрева. Макет: design-preview/catalog/08-settings-admin.dc.html
 *
 * Подсказка страницы переехала в кнопку «?» топбара вместе с остальными —
 * `SharedPageGuide` здесь больше не зовётся.
 */
import type { WarmupKeywordPoolDto } from '~~/shared/types/warmup'

definePageMeta({ middleware: ['admin-access'] })
useHead({ title: 'Пулы прогрева' })

const { pools, total, pending, refresh, deletePool, isProcessing, error } = useWarmupKeywords()

const editorRef = ref<{ open: (pool?: WarmupKeywordPoolDto) => void } | null>(null)
const toDelete = ref<WarmupKeywordPoolDto | null>(null)

async function confirmDelete() {
  const pool = toDelete.value
  toDelete.value = null
  if (pool) await deletePool(pool.id)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Пулы прогрева</h1>
      <span v-if="total" class="tnum font-mono text-sm text-subtle">{{ total }}</span>
      <span class="flex-1" />
      <UiButton :loading="pending" @click="refresh()">
        <Icon v-if="!pending" name="mingcute:refresh-2-line" />
        Обновить
      </UiButton>
      <UiButton variant="primary" @click="editorRef?.open()">
        <Icon name="mingcute:add-line" />
        Создать пул
      </UiButton>
    </div>

    <p class="max-w-3xl text-sm text-muted">
      Отсюда планировщик прогрева берёт, что искать и на кого подписываться.
      Выключенный пул остаётся в списке, но в план не попадает.
    </p>

    <p
      v-if="error"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span class="min-w-0 flex-1">{{ error }}</span>
    </p>

    <UiSkeleton v-if="pending && !pools.length" variant="details" :count="4" />

    <UiEmptyState
      v-else-if="!pools.length"
      variant="first"
      title="Пулов нет"
      description="Заведите первый — без него планировщик прогрева не найдёт, что искать."
    >
      <UiButton variant="primary" @click="editorRef?.open()">Создать пул</UiButton>
    </UiEmptyState>

    <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <WarmupKeywordPoolCard
        v-for="pool in pools"
        :key="pool.id"
        :pool="pool"
        @edit="editorRef?.open($event)"
        @delete="toDelete = $event"
      />
    </div>

    <WarmupKeywordPoolEditor ref="editorRef" @saved="refresh()" />

    <UiModal :open="!!toDelete" size="sm" title="Удалить пул?" @close="toDelete = null">
      <p class="text-sm text-muted">
        Пул «{{ toDelete?.name }}» и все его слова удалятся навсегда. Планировщик
        перестанет их использовать сразу; уже запланированные действия останутся.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="toDelete = null">Отмена</UiButton>
        <UiButton variant="danger" :loading="isProcessing" @click="confirmDelete">Удалить</UiButton>
      </template>
    </UiModal>
  </div>
</template>

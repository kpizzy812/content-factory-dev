<script setup lang="ts">
import type { WarmupKeywordPoolDto } from "~~/shared/types/warmup"

definePageMeta({
  middleware: ["admin-access"],
})
useHead({ title: "Пулы ключевых слов прогрева" })

const { pools, total, pending, refresh, deletePool, isProcessing, error } = useWarmupKeywords()

const editorRef = ref<{
  open: (pool?: WarmupKeywordPoolDto) => void
  close: () => void
}>()

function openCreate() {
  editorRef.value?.open()
}

function openEdit(pool: WarmupKeywordPoolDto) {
  editorRef.value?.open(pool)
}

async function onDelete(pool: WarmupKeywordPoolDto) {
  if (!confirm(`Удалить пул «${pool.name}»? Это действие нельзя отменить.`)) return
  await deletePool(pool.id)
}

const guide = pageGuides["warmup-keywords"]
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-start justify-between gap-2 flex-wrap">
      <div>
        <h1 class="text-2xl font-bold text-base-content">Пулы ключевых слов прогрева</h1>
        <p class="text-sm text-base-content/60 mt-1">
          Источник keyword для warmup planner — действий просмотра, поиска и подписок.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="btn btn-sm btn-ghost"
          :disabled="pending"
          @click="refresh()"
        >
          <Icon name="mingcute:refresh-3-line" :class="{ 'animate-spin': pending }" />
          Обновить
        </button>
        <button class="btn btn-sm btn-primary" @click="openCreate">
          <Icon name="mingcute:add-line" />
          Создать пул
        </button>
      </div>
    </div>

    <SharedPageGuide
      v-if="guide"
      guide-key="warmup-keywords"
      :title="guide.title"
      :steps="guide.steps"
      :tips="guide.tips"
    />

    <div v-if="error" class="alert alert-error text-sm">
      <Icon name="mingcute:alert-line" />
      {{ error }}
    </div>

    <div v-if="pending && pools.length === 0" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <div
      v-else-if="pools.length === 0"
      class="text-center text-base-content/50 py-12"
    >
      <Icon name="mingcute:inbox-line" class="text-5xl text-base-content/30" />
      <p class="mt-2 text-sm">Нет пулов. Создайте первый кнопкой «Создать пул».</p>
    </div>

    <div v-else>
      <p class="text-xs text-base-content/50 mb-2">Всего: {{ total }}</p>
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <WarmupKeywordPoolCard
          v-for="pool in pools"
          :key="pool.id"
          :pool="pool"
          @edit="openEdit"
          @delete="onDelete"
        />
      </div>
    </div>

    <WarmupKeywordPoolEditor ref="editorRef" @saved="refresh()" />

    <div v-if="isProcessing" class="toast toast-end">
      <div class="alert alert-info">
        <span class="loading loading-spinner loading-sm" />
        <span>Сохранение...</span>
      </div>
    </div>
  </div>
</template>

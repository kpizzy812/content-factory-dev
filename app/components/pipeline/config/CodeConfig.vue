<script setup lang="ts">
defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()
</script>

<template>
  <UiField label="JavaScript код">
    <UiTextarea
      :model-value="config.code || ''"
      :rows="8"
      placeholder="return input"
      class="font-mono text-sm"
      @update:model-value="(v) => emit('update', 'code', v)"
    />
    <SharedFieldHint text="Код для трансформации данных. Доступны: input (входные данные), config (конфигурация), стандартные JS объекты. Запрещены: сеть, файлы, async." />
  </UiField>

  <div class="flex flex-col gap-1.5 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-micro text-muted">
    <p class="font-semibold text-info">Режим: изолированная трансформация данных</p>
    <p>Только чистые операции без побочных эффектов. Код выполняется в отдельном потоке с жёстким лимитом по времени (5 с) и памяти (64 МБ).</p>

    <p class="mt-1 font-semibold text-fg">Доступно:</p>
    <ul class="list-inside list-disc space-y-0.5">
      <li><code class="font-mono text-accent-text">input</code> — данные от предыдущей ноды (только чтение)</li>
      <li><code class="font-mono text-accent-text">config</code> — конфигурация ноды (только чтение)</li>
      <li><code class="font-mono text-fg">Math, JSON, Date, Array, Object, String, Number, RegExp</code></li>
    </ul>

    <p class="mt-1 font-semibold text-fg">Запрещено:</p>
    <ul class="list-inside list-disc space-y-0.5 text-danger">
      <li>Сеть, файлы, БД, таймеры, async/await</li>
      <li>process, require, import, eval, fetch</li>
      <li>Любые побочные эффекты</li>
    </ul>

    <p class="mt-1 font-semibold text-fg">Защита:</p>
    <ul class="list-inside list-disc space-y-0.5 text-success">
      <li>Изолированный поток (worker_threads) — зависание не повлияет на сервер</li>
      <li>Принудительное завершение при бесконечном цикле (5 с)</li>
      <li>Лимит памяти 64 МБ</li>
    </ul>
  </div>
</template>

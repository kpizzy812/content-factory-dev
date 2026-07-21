<script setup lang="ts">
defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()
</script>

<template>
  <fieldset class="fieldset">
    <legend class="fieldset-legend">JavaScript код</legend>
    <textarea
      :value="config.code || ''"
      class="textarea textarea-sm w-full font-mono text-xs"
      rows="8"
      placeholder="return input"
      @input="emit('update', 'code', ($event.target as HTMLTextAreaElement).value)"
    />
    <SharedFieldHint text="Код для трансформации данных. Доступны: input (входные данные), config (конфигурация), стандартные JS объекты. Запрещены: сеть, файлы, async." />
  </fieldset>

  <div class="p-2 rounded-box bg-info/10 border border-info/20 text-[10px] text-base-content/60 space-y-1.5">
    <p class="font-semibold text-info">Режим: изолированная трансформация данных</p>
    <p>Только чистые операции без побочных эффектов. Код выполняется в отдельном потоке с жёстким лимитом по времени (5с) и памяти (64МБ).</p>
    <p class="font-semibold mt-1">Доступно:</p>
    <ul class="list-disc list-inside space-y-0.5">
      <li><code class="text-primary">input</code> — данные от предыдущей ноды (только чтение)</li>
      <li><code class="text-primary">config</code> — конфигурация ноды (только чтение)</li>
      <li><code class="text-base-content/80">Math, JSON, Date, Array, Object, String, Number, RegExp</code></li>
    </ul>
    <p class="font-semibold mt-1">Запрещено:</p>
    <ul class="list-disc list-inside space-y-0.5 text-error/70">
      <li>Сеть, файлы, БД, таймеры, async/await</li>
      <li>process, require, import, eval, fetch</li>
      <li>Любые побочные эффекты</li>
    </ul>
    <p class="font-semibold mt-1">Защита:</p>
    <ul class="list-disc list-inside space-y-0.5 text-success/70">
      <li>Изолированный поток (worker_threads) — зависание не повлияет на сервер</li>
      <li>Принудительное завершение при бесконечном цикле (5 сек)</li>
      <li>Лимит памяти 64 МБ</li>
    </ul>
  </div>
</template>

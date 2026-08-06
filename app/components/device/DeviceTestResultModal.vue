<script setup lang="ts">
/**
 * Результат проверки связи с облаком: что отправили, что вернули.
 *
 * Тела запроса и ответа показываются как есть — это диагностика, и любая
 * «причёсанная» подача здесь мешает: в поддержку уходит именно сырой ответ.
 */
import type { DeviceTestPushResult } from '~~/shared/types/device-profile'

const isOpen = ref(false)
const result = ref<DeviceTestPushResult | null>(null)
const toast = useToast()

function open(r: DeviceTestPushResult) {
  result.value = r
  isOpen.value = true
}

function close() {
  isOpen.value = false
}

defineExpose({ open, close })

const statusBadge = computed(() => {
  const r = result.value
  if (!r) return { tone: 'border-divider bg-card text-subtle', label: '—' }
  if (r.ok) return { tone: 'border-success-border bg-success-bg text-success', label: `${r.status} OK` }
  if (r.status === 0) {
    return {
      tone: 'border-warning-border bg-warning-bg text-warning',
      label: r.error ? 'не дошли' : 'таймаут',
    }
  }
  return { tone: 'border-danger-border bg-danger-bg text-danger', label: `ошибка ${r.status}` }
})

const actionLabel = computed(() => {
  const m = result.value?.method
  if (m === 'start') return 'Запуск профиля'
  if (m === 'stop') return 'Остановка профиля'
  return 'Проверка связи с облаком'
})

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${label} скопировано`)
  }
  catch {
    // Буфер обмена недоступен без защищённого соединения.
  }
}
</script>

<template>
  <UiModal :open="isOpen" size="lg" @close="close">
    <template #header>
      <span class="flex flex-wrap items-center gap-2">
        {{ actionLabel }}
        <span class="rounded-sm border px-1.5 py-0.5 text-micro" :class="statusBadge.tone">
          {{ statusBadge.label }}
        </span>
        <span
          v-if="result?.phase"
          class="rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-micro text-warning"
        >
          шаг: {{ result.phase }}
        </span>
      </span>
    </template>

    <div v-if="result" class="flex flex-col gap-3">
      <p
        :role="result.ok ? 'status' : 'alert'"
        class="flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm"
        :class="result.ok
          ? 'border-success-border bg-success-bg text-success'
          : 'border-danger-border bg-danger-bg text-danger'"
      >
        <Icon
          :name="result.ok ? 'mingcute:check-circle-line' : 'mingcute:close-circle-line'"
          class="mt-0.5 shrink-0"
        />
        <span>
          <template v-if="result.ok">
            Облако приняло запрос
            <template v-if="result.method === 'create'">— тестовый профиль создан и сразу удалён</template>.
          </template>
          <template v-else-if="result.error">Запрос не дошёл: {{ result.error }}</template>
          <template v-else>Облако вернуло ошибку {{ result.status }} — ответ ниже.</template>
        </span>
      </p>

      <p
        v-if="result.cleanup"
        :role="result.cleanup.didCleanup ? 'note' : 'alert'"
        class="flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm"
        :class="result.cleanup.didCleanup
          ? 'border-success-border bg-success-bg text-success'
          : 'border-warning-border bg-warning-bg text-warning'"
      >
        <Icon name="mingcute:broom-line" class="mt-0.5 shrink-0" />
        <span v-if="result.cleanup.didCleanup">
          Тестовый профиль {{ result.cleanup.createdIndigoId }} создан и сразу удалён из облака.
        </span>
        <span v-else>
          Профиль {{ result.cleanup.createdIndigoId }} создан в облаке, но удалить его не удалось —
          удалите вручную.
        </span>
      </p>

      <UiKeyValue
        :items="[
          { label: 'Метод', value: result.method },
          { label: 'URL', value: result.url },
        ]"
        label-width="72px"
      />

      <UiDisclosure title="Что отправили" icon="mingcute:upload-line" default-open>
        <template #header-extra>
          <UiButton variant="ghost" @click="copyToClipboard(formatJson(result.requestBody), 'Тело запроса')">
            <Icon name="mingcute:copy-2-line" />
            Копировать
          </UiButton>
        </template>
        <pre class="overflow-x-auto text-micro whitespace-pre-wrap break-all">{{ formatJson(result.requestBody) }}</pre>
      </UiDisclosure>

      <UiDisclosure title="Что вернули" icon="mingcute:download-line" default-open>
        <template #header-extra>
          <UiButton variant="ghost" @click="copyToClipboard(formatJson(result.responseBody), 'Тело ответа')">
            <Icon name="mingcute:copy-2-line" />
            Копировать
          </UiButton>
        </template>
        <pre class="overflow-x-auto text-micro whitespace-pre-wrap break-all">{{ formatJson(result.responseBody) }}</pre>
      </UiDisclosure>

      <UiDisclosure
        v-if="result.folderProbe"
        title="Поиск папки в облаке"
        icon="mingcute:folder-line"
        :default-open="!result.folderProbe.resolvedFolderId"
      >
        <div class="flex flex-col gap-2 text-sm">
          <p class="text-muted">
            Облако требует идентификатор папки. Перебирали адреса, пока не нашли первую папку.
          </p>
          <div class="overflow-x-auto">
            <table class="w-full text-micro">
              <thead>
                <tr class="text-left text-subtle">
                  <th class="py-1 pr-3 font-normal">Метод</th>
                  <th class="py-1 pr-3 font-normal">Адрес</th>
                  <th class="py-1 pr-3 font-normal">Ответ</th>
                  <th class="py-1 font-normal">Папок</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(a, i) in result.folderProbe.attempts" :key="i" class="border-t border-divider">
                  <td class="py-1 pr-3 font-mono">{{ a.method }}</td>
                  <td class="py-1 pr-3 font-mono break-all">{{ a.url }}</td>
                  <td class="py-1 pr-3">
                    <span
                      class="rounded-sm border px-1.5"
                      :class="a.ok
                        ? 'border-success-border bg-success-bg text-success'
                        : 'border-danger-border bg-danger-bg text-danger'"
                    >
                      {{ a.status || (a.error ? 'ошибка' : '—') }}
                    </span>
                  </td>
                  <td class="tnum py-1 font-mono">{{ a.foundFolders }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="!result.folderProbe.resolvedFolderId" class="text-warning">
            Папка не найдена. Создайте её в интерфейсе провайдера или прогоните синхронизацию.
          </p>
        </div>
      </UiDisclosure>
    </div>

    <p v-else class="text-sm text-subtle">Нет данных.</p>

    <template #footer>
      <UiButton @click="close">Закрыть</UiButton>
    </template>
  </UiModal>
</template>

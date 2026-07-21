<script setup lang="ts">
/**
 * Модалка результата dry-run test push в облако.
 *
 * Показывает:
 * - Статус (ok/fail) + HTTP code от провайдера
 * - Метод (create / partial_update) + URL
 * - Request body (collapsible JSON) — что мы отправили
 * - Response body (collapsible JSON) — что вернул провайдер (включая error body)
 * - Network error (если до провайдера не дошли — например credentials или timeout)
 *
 * Управление — через defineExpose({ open, close }) по примеру DeviceProfileLinkModal.
 */
import type { DeviceTestPushResult } from "~~/shared/types/device-profile"

const isOpen = ref(false)
const result = ref<DeviceTestPushResult | null>(null)

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
  if (!r) return { class: "badge-neutral", label: "—" }
  if (r.ok) return { class: "badge-success", label: `${r.status} OK` }
  if (r.status === 0) return { class: "badge-warning", label: r.error ? "Не дошли" : "Timeout" }
  return { class: "badge-error", label: `${r.status} Error` }
})

const actionLabel = computed(() => {
  const m = result.value?.method
  if (m === "start") return "Старт профиля на устройстве"
  if (m === "stop") return "Остановка профиля на устройстве"
  return "Тест push в облако"
})

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

async function copyToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(text)
  }
}
</script>

<template>
  <dialog class="modal" :class="{ 'modal-open': isOpen }">
    <div class="modal-box max-w-3xl">
      <div class="flex items-start justify-between gap-3 mb-3">
        <div class="flex items-center gap-2 flex-wrap">
          <h3 class="text-lg font-bold">{{ actionLabel }}</h3>
          <span class="badge badge-sm" :class="statusBadge.class">{{ statusBadge.label }}</span>
          <span v-if="result?.phase" class="badge badge-sm badge-soft badge-warning">
            phase: {{ result.phase }}
          </span>
        </div>
        <button class="btn btn-ghost btn-sm btn-circle" aria-label="Закрыть" @click="close">
          <Icon name="mingcute:close-line" />
        </button>
      </div>

      <div v-if="result" class="space-y-3 text-sm">
        <div role="alert" class="alert alert-soft" :class="result.ok ? 'alert-success' : 'alert-error'">
          <Icon
            :name="result.ok ? 'mingcute:check-circle-line' : 'mingcute:close-circle-line'"
            class="text-base"
          />
          <span>
            <template v-if="result.ok">
              Браузер принял payload ({{ result.method === "create" ? "профиль создан и сразу удалён - dry-run" : "обновлён" }}).
            </template>
            <template v-else-if="result.error">
              Запрос не дошёл: {{ result.error }}
            </template>
            <template v-else>
              Устройство DuoPlus вернул ошибку {{ result.status }}. Смотри Response body ниже.
            </template>
          </span>
        </div>

        <div
          v-if="result.cleanup"
          role="alert"
          class="alert alert-soft text-xs py-2"
          :class="result.cleanup.didCleanup ? 'alert-success' : 'alert-warning'"
        >
          <Icon
            :name="result.cleanup.didCleanup ? 'mingcute:broom-line' : 'mingcute:warning-line'"
            class="text-base"
          />
          <div class="flex flex-col gap-0.5">
            <span v-if="result.cleanup.didCleanup">
              Создан тестовый профиль {{ result.cleanup.createdIndigoId }} и сразу удалён из облака (honest dry-run).
            </span>
            <span v-else>
              Создан профиль {{ result.cleanup.createdIndigoId }} в облаке, но удалить его не получилось. Удали вручную в интерфейсе браузера.
            </span>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          <div class="flex flex-col">
            <span class="text-base-content/60">Метод</span>
            <code class="font-mono">{{ result.method }}</code>
          </div>
          <div class="flex flex-col">
            <span class="text-base-content/60">URL</span>
            <code class="font-mono break-all">{{ result.url }}</code>
          </div>
        </div>

        <details class="bg-base-200/40 border border-base-300 rounded-box" open>
          <summary class="cursor-pointer select-none px-4 py-2 text-sm font-medium list-none [&::-webkit-details-marker]:hidden flex items-center gap-2">
            <Icon name="mingcute:arrow-up-circle-line" />
            Request body
            <button
              class="btn btn-ghost btn-xs ml-auto"
              aria-label="Скопировать"
              @click.prevent.stop="copyToClipboard(formatJson(result.requestBody))"
            >
              <Icon name="mingcute:copy-2-line" />
              Копировать
            </button>
          </summary>
          <pre class="px-4 pb-3 text-xs overflow-x-auto whitespace-pre-wrap break-all">{{ formatJson(result.requestBody) }}</pre>
        </details>

        <details class="bg-base-200/40 border border-base-300 rounded-box" open>
          <summary class="cursor-pointer select-none px-4 py-2 text-sm font-medium list-none [&::-webkit-details-marker]:hidden flex items-center gap-2">
            <Icon name="mingcute:arrow-down-circle-line" />
            Response body
            <button
              class="btn btn-ghost btn-xs ml-auto"
              aria-label="Скопировать"
              @click.prevent.stop="copyToClipboard(formatJson(result.responseBody))"
            >
              <Icon name="mingcute:copy-2-line" />
              Копировать
            </button>
          </summary>
          <pre class="px-4 pb-3 text-xs overflow-x-auto whitespace-pre-wrap break-all">{{ formatJson(result.responseBody) }}</pre>
        </details>

        <details
          v-if="result.folderProbe"
          class="bg-base-200/40 border border-base-300 rounded-box"
          :open="!result.folderProbe.resolvedFolderId"
        >
          <summary class="cursor-pointer select-none px-4 py-2 text-sm font-medium list-none [&::-webkit-details-marker]:hidden flex items-center gap-2">
            <Icon name="mingcute:folder-line" />
            Folder probe
            <span
              class="badge badge-xs ml-2"
              :class="result.folderProbe.resolvedFolderId ? 'badge-success' : 'badge-warning'"
            >
              {{ result.folderProbe.resolvedFolderId ? `→ ${result.folderProbe.resolvedFolderId}` : "не найден" }}
            </span>
          </summary>
          <div class="px-4 pb-3 space-y-2 text-xs">
            <p class="text-base-content/70">
              Устройство DuoPlus требует folder_id обязательно. Пробовали несколько endpoints чтобы получить
              первый folder из облака.
            </p>
            <div class="overflow-x-auto">
              <table class="table table-xs">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>URL</th>
                    <th>Status</th>
                    <th>Folders</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(a, i) in result.folderProbe.attempts" :key="i">
                    <td class="font-mono">{{ a.method }}</td>
                    <td class="font-mono break-all">{{ a.url }}</td>
                    <td>
                      <span class="badge badge-xs" :class="a.ok ? 'badge-success' : 'badge-error'">
                        {{ a.status || (a.error ? "err" : "—") }}
                      </span>
                    </td>
                    <td>{{ a.foundFolders }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="!result.folderProbe.resolvedFolderId" class="text-warning">
              Не нашли folder. Зайди в интерфейс браузера, создай хотя бы одну папку или сделай синхронизацию,
              чтобы folder_id попал в БД.
            </p>
          </div>
        </details>
      </div>

      <div v-else class="text-sm text-base-content/60">Нет данных.</div>

      <div class="modal-action">
        <button class="btn btn-sm" @click="close">Закрыть</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>

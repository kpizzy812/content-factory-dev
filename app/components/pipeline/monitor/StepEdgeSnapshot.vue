<script setup lang="ts">
/**
 * Per-edge telemetry block (Этап 4 pipeline refactor).
 *
 * Показывает оператору в развёрнутой строке шага: какие upstream-ноды что
 * передали именно ЭТОЙ ноде. Backend пишет snapshot в `step.output._edgeSnapshot`
 * через `buildEdgeSnapshot` в `pipeline-engine.ts`. Этот компонент
 * сравнивает фактический набор ключей с required-inputs из `NODE_PORTS`
 * и подсвечивает mismatch'ы (например, scenario ждала `trends`, но loop
 * пробросил без них).
 *
 * Компонент НЕ рендерится если `edgeSnapshot` пустой или некорректный — это
 * нормально для entry-нод и для старых шагов до миграции на Этап 4.
 */
import { NODE_PORTS, isKnownNodeType } from '~~/shared/utils/pipeline-node-registry'

interface Props {
  /** Snapshot ключей upstream-нод, переданных текущему шагу. */
  edgeSnapshot: Record<string, string[]> | null | undefined
  /** Тип текущей ноды — нужен для определения ожидаемых required inputs. */
  currentNodeType: string
  /** Карта id→label для всех нод графа, чтобы заменить ID на человекочитаемое имя. */
  nodeLabels?: Map<string, string> | Record<string, string>
}
const props = defineProps<Props>()

/** Безопасный resolve label по nodeId — Map или plain object. */
function resolveLabel(nodeId: string): string {
  if (!props.nodeLabels) return nodeId
  if (props.nodeLabels instanceof Map) {
    return props.nodeLabels.get(nodeId) ?? nodeId
  }
  return props.nodeLabels[nodeId] ?? nodeId
}

const snapshot = computed<Record<string, string[]> | null>(() => {
  const s = props.edgeSnapshot
  if (!s || typeof s !== 'object') return null
  // Дополнительная защита: убедимся что значения — массивы строк
  const cleaned: Record<string, string[]> = {}
  for (const [sid, keys] of Object.entries(s)) {
    if (Array.isArray(keys)) cleaned[sid] = keys.filter(k => typeof k === 'string')
  }
  return Object.keys(cleaned).length > 0 ? cleaned : null
})

/** Required-inputs текущей ноды (без `any` — их валидировать нет смысла). */
const expectedKeys = computed<string[]>(() => {
  if (!isKnownNodeType(props.currentNodeType)) return []
  const ports = NODE_PORTS[props.currentNodeType]
  if (!ports) return []
  return ports.inputs
    .filter(p => p.required && p.type !== 'any')
    .map(p => p.key)
})

interface Row {
  sourceId: string
  sourceLabel: string
  providedKeys: string[]
  mismatch: boolean
  missingKeys: string[]
}

const rows = computed<Row[]>(() => {
  if (!snapshot.value) return []
  return Object.entries(snapshot.value).map(([sourceId, providedKeys]) => {
    const provided = new Set(providedKeys)
    // Один источник не обязан покрывать ВСЕ ожидаемые ключи (может быть несколько upstream).
    // Mismatch отмечаем когда среди upstream ни один не предоставил required key —
    // эту агрегацию делаем в overallMissing ниже. Здесь — per-source отсутствие.
    const missing = expectedKeys.value.filter(k => !provided.has(k))
    return {
      sourceId,
      sourceLabel: resolveLabel(sourceId),
      providedKeys,
      mismatch: missing.length > 0 && expectedKeys.value.length > 0,
      missingKeys: missing,
    }
  })
})

/** Ключи которые НИ ОДИН upstream не предоставил — это настоящая проблема. */
const overallMissing = computed<string[]>(() => {
  if (expectedKeys.value.length === 0) return []
  if (!snapshot.value) return []
  const allProvided = new Set<string>()
  for (const keys of Object.values(snapshot.value)) {
    for (const k of keys) allProvided.add(k)
  }
  return expectedKeys.value.filter(k => !allProvided.has(k))
})

const hasGlobalMismatch = computed(() => overallMissing.value.length > 0)
</script>

<template>
  <UiDisclosure
    v-if="snapshot && rows.length > 0"
    title="Что передали ноды выше"
    :icon="hasGlobalMismatch ? 'mingcute:alert-line' : undefined"
    :icon-tone="hasGlobalMismatch ? 'text-warning' : 'text-muted'"
    :count="rows.length"
    :default-open="hasGlobalMismatch"
  >
    <div class="flex flex-col gap-1.5">
      <!-- Ключ не пришёл ни от одного источника — это настоящая проблема -->
      <p
        v-if="hasGlobalMismatch"
        class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm text-fg"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-warning" />
        <span class="min-w-0 flex-1">
          Ожидаемые ключи не пришли ни от одной ноды выше:
          <span class="font-mono">{{ overallMissing.join(', ') }}</span>
        </span>
      </p>

      <div
        v-for="row in rows"
        :key="row.sourceId"
        class="flex items-start gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm"
      >
        <Icon
          :name="row.mismatch ? 'mingcute:alert-line' : 'mingcute:arrow-right-line'"
          class="mt-0.5 shrink-0"
          :class="row.mismatch ? 'text-warning' : 'text-subtle'"
        />
        <div class="min-w-0 flex-1">
          <div class="text-fg">
            «{{ row.sourceLabel }}» передала
            <span v-if="row.providedKeys.length === 0" class="text-subtle">— ничего</span>
          </div>
          <div v-if="row.providedKeys.length > 0" class="mt-1 flex flex-wrap gap-1">
            <span
              v-for="k in row.providedKeys"
              :key="k"
              class="inline-flex h-[18px] items-center rounded-sm border px-1.5 font-mono text-micro"
              :class="expectedKeys.includes(k)
                ? 'border-success-border bg-success-bg text-success'
                : 'border-border bg-panel text-muted'"
            >{{ k }}</span>
          </div>
          <div v-if="row.mismatch" class="mt-1 text-warning">
            не хватает: <span class="font-mono">{{ row.missingKeys.join(', ') }}</span>
          </div>
        </div>
      </div>

      <p v-if="expectedKeys.length > 0" class="text-micro text-subtle">
        Эта нода ждала: <span class="font-mono">{{ expectedKeys.join(', ') }}</span>
      </p>
    </div>
  </UiDisclosure>
</template>

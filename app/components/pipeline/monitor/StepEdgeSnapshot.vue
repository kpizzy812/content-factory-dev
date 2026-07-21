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
  <div v-if="snapshot && rows.length > 0" class="space-y-1.5">
    <div class="font-semibold text-base-content/70">
      Передача от upstream-нод:
    </div>

    <!-- Глобальное предупреждение: required-ключ не пришёл ни от одного источника -->
    <div
      v-if="hasGlobalMismatch"
      role="alert"
      class="alert alert-warning alert-soft py-1.5 text-[10px]"
    >
      <Icon name="mingcute:alert-line" class="text-xs" />
      <span>
        Ожидаемые ключи не пришли ни от одной upstream-ноды:
        <span
          v-for="k in overallMissing"
          :key="k"
          class="badge badge-xs badge-warning ml-0.5 font-mono"
        >{{ k }}</span>
      </span>
    </div>

    <div
      v-for="row in rows"
      :key="row.sourceId"
      class="flex items-start gap-2 bg-base-300 rounded-box p-1.5 text-[10px]"
    >
      <Icon
        :name="row.mismatch ? 'mingcute:alert-line' : 'mingcute:arrow-right-line'"
        class="text-xs mt-0.5 shrink-0"
        :class="row.mismatch ? 'text-warning' : 'text-base-content/40'"
      />
      <div class="flex-1 min-w-0">
        <div class="font-semibold text-base-content/80">
          Нода «{{ row.sourceLabel }}» передала:
          <span v-if="row.providedKeys.length === 0" class="text-base-content/40 font-normal">
            (нет ключей)
          </span>
        </div>
        <div v-if="row.providedKeys.length > 0" class="flex gap-1 flex-wrap mt-0.5">
          <span
            v-for="k in row.providedKeys"
            :key="k"
            class="badge badge-xs font-mono"
            :class="expectedKeys.includes(k) ? 'badge-success' : 'badge-ghost'"
          >{{ k }}</span>
        </div>
        <div
          v-if="row.mismatch"
          class="text-warning mt-0.5"
          :title="`Эта нода ожидала ключи: ${expectedKeys.join(', ')}; от этого источника пришли: ${row.providedKeys.join(', ') || '∅'}`"
        >
          Отсутствуют ожидаемые ключи:
          <span
            v-for="k in row.missingKeys"
            :key="k"
            class="badge badge-xs badge-warning badge-outline ml-0.5 font-mono"
          >{{ k }}</span>
        </div>
      </div>
    </div>

    <div v-if="expectedKeys.length > 0" class="text-base-content/50 pl-1 text-[10px]">
      Эта нода ждала:
      <span
        v-for="k in expectedKeys"
        :key="k"
        class="badge badge-xs badge-info badge-outline ml-0.5 font-mono"
      >{{ k }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  scenario: {
    id: number
    status: string
    selectedVariantId: number | null
    createdAt: string
    trend?: { id: number; title: string; platform: string } | null
    variants?: Array<{
      id: number
      variantIndex: number
      status: string
      title: string
      hook: string
    }>
    _count?: { reviewActions: number }
  }
}>()

const { deleteScenario } = useScenarioActions()
const isDeleting = ref(false)

const acceptedVariant = computed(() =>
  props.scenario.variants?.find(v => v.id === props.scenario.selectedVariantId)
  ?? props.scenario.variants?.[0],
)

const variantsCount = computed(() => props.scenario.variants?.length ?? 0)

function goToDetail() {
  navigateTo(`/scenarios/${props.scenario.id}`)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

async function handleDelete(e: Event) {
  e.stopPropagation()
  if (!confirm('Удалить сценарий? Это действие можно отменить.')) return
  isDeleting.value = true
  try {
    await deleteScenario(props.scenario.id)
    navigateTo('/scenarios')
  } catch {
    // ошибка
  } finally {
    isDeleting.value = false
  }
}
</script>

<template>
  <div
    class="card bg-base-100 shadow-sm cursor-pointer transition-shadow hover:shadow-md"
    @click="goToDetail"
  >
    <div class="card-body p-4 gap-2">
      <div class="flex items-center gap-2 flex-wrap">
        <ScenarioStatusBadge :status="scenario.status" />
        <span v-if="variantsCount" class="text-xs text-base-content/40">
          {{ variantsCount }} вар.
        </span>
        <span v-if="scenario.trend" class="text-xs text-base-content/50 truncate max-w-[150px]">
          {{ scenario.trend.title }}
        </span>
      </div>

      <h3 v-if="acceptedVariant" class="font-semibold text-base-content line-clamp-2 text-sm">
        {{ acceptedVariant.title }}
      </h3>
      <h3 v-else class="font-semibold text-base-content/60 text-sm">
        Сценарий #{{ scenario.id }}
      </h3>

      <p v-if="acceptedVariant" class="text-xs text-base-content/60 line-clamp-2">
        {{ acceptedVariant.hook }}
      </p>

      <div class="flex items-center justify-between mt-1">
        <span class="text-xs text-base-content/40">
          {{ formatDate(scenario.createdAt) }}
        </span>
        <button
          class="btn btn-ghost btn-xs text-error opacity-0 group-hover:opacity-100 transition-opacity"
          :disabled="isDeleting"
          title="Удалить"
          @click="handleDelete"
        >
          <Icon name="mingcute:delete-2-line" class="text-sm" />
        </button>
      </div>
    </div>
  </div>
</template>

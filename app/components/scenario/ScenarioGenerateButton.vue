<script setup lang="ts">
const { can } = usePermissions()

const props = defineProps<{
  trendId: number
  trendStatus: string
  hasApp: boolean
  hasExistingScenarios: boolean
  appId?: number | null
}>()

const emit = defineEmits<{
  generated: []
}>()

const { isGenerating, error, generate } = useGenerateScenarios()
const variantsCount = ref(3)
const selectedProfileId = ref<number | null>(null)

// Загружаем профили для выбранного приложения
const { data: profilesData } = useFetch<{ data: Array<{ id: number; name: string; description?: string | null; isDefault: boolean }> }>(
  () => props.appId ? `/api/scenarios/profiles?appId=${props.appId}` : '/api/scenarios/profiles',
  { key: `scenario-profiles-${props.appId ?? 'all'}`, default: () => ({ data: [] }) },
)

const profiles = computed(() => profilesData.value?.data ?? [])

// Автоматически выбираем default профиль
watch(profiles, (list) => {
  if (!selectedProfileId.value && list.length > 0) {
    const defaultProfile = list.find(p => p.isDefault)
    if (defaultProfile) selectedProfileId.value = defaultProfile.id
  }
}, { immediate: true })

const isDisabled = computed(() => {
  if (isGenerating.value) return true
  if (props.trendStatus !== 'reviewed' && props.trendStatus !== 'in_work') return true
  if (!props.hasApp) return true
  if (props.hasExistingScenarios) return true
  return false
})

const disabledReason = computed(() => {
  if (props.hasExistingScenarios) return 'Сценарии уже сгенерированы'
  if (props.trendStatus !== 'reviewed' && props.trendStatus !== 'in_work') {
    return 'Тренд должен быть в статусе "Просмотрен" или "В работе"'
  }
  if (!props.hasApp) return 'К тренду не привязано приложение'
  return ''
})

async function handleGenerate() {
  const result = await generate(props.trendId, variantsCount.value, selectedProfileId.value)
  if (result) {
    emit('generated')
  }
}
</script>

<template>
  <div v-if="can('canRunAgent')">
    <div class="flex gap-2 items-center">
      <select v-model="variantsCount" class="select select-sm w-20">
        <option :value="1">1</option>
        <option :value="3">3</option>
        <option :value="5">5</option>
      </select>
      <div
        :class="{ 'tooltip tooltip-bottom flex-1': isDisabled && !isGenerating }"
        :data-tip="disabledReason"
        class="flex-1"
      >
        <button
          class="btn btn-primary btn-sm w-full gap-1"
          :disabled="isDisabled"
          @click="handleGenerate"
        >
          <template v-if="isGenerating">
            <span class="loading loading-spinner loading-xs" />
            Генерация...
          </template>
          <template v-else>
            <Icon name="mingcute:sparkles-2-line" />
            Сгенерировать
          </template>
        </button>
      </div>
    </div>

    <!-- Профиль генерации -->
    <div v-if="profiles.length > 0" class="mt-2">
      <select v-model="selectedProfileId" class="select select-sm w-full">
        <option :value="null">Без профиля (стандартная генерация)</option>
        <option v-for="profile in profiles" :key="profile.id" :value="profile.id">
          {{ profile.name }}{{ profile.isDefault ? ' (по умолч.)' : '' }}
        </option>
      </select>
    </div>

    <p v-if="isGenerating" class="text-xs text-base-content/50 mt-1 text-center">
      Генерация {{ variantsCount }} вариантов — обычно 30-90 секунд
    </p>

    <div v-if="error" role="alert" class="alert alert-error alert-soft text-sm mt-2">
      <Icon name="mingcute:warning-line" />
      <div class="flex flex-col gap-1">
        <span>{{ error }}</span>
        <button class="btn btn-xs btn-outline" @click="handleGenerate">
          Попробовать снова
        </button>
      </div>
    </div>
  </div>
</template>

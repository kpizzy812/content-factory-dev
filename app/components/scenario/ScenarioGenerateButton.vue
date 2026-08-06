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

// Профили генерации привязаны к приложению; без него берём общий список.
const { data: profilesData } = useFetch<{ data: Array<{ id: number, name: string, description?: string | null, isDefault: boolean }> }>(
  () => props.appId ? `/api/scenarios/profiles?appId=${props.appId}` : '/api/scenarios/profiles',
  { key: `scenario-profiles-${props.appId ?? 'all'}`, default: () => ({ data: [] }) },
)

const profiles = computed(() => profilesData.value?.data ?? [])

const profileOptions = computed(() => [
  { value: '', label: 'Без профиля' },
  ...profiles.value.map(p => ({
    value: p.id,
    label: p.isDefault ? `${p.name} · по умолчанию` : p.name,
  })),
])

watch(profiles, (list) => {
  if (!selectedProfileId.value && list.length > 0) {
    const defaultProfile = list.find(p => p.isDefault)
    if (defaultProfile) selectedProfileId.value = defaultProfile.id
  }
}, { immediate: true })

const disabledReason = computed(() => {
  if (props.hasExistingScenarios) return 'Сценарии по этому тренду уже есть'
  if (props.trendStatus !== 'reviewed' && props.trendStatus !== 'in_work') {
    return 'Тренд должен быть просмотрен или взят в работу'
  }
  if (!props.hasApp) return 'К тренду не привязано приложение'
  return ''
})

const isDisabled = computed(() => isGenerating.value || !!disabledReason.value)

async function handleGenerate() {
  const result = await generate(props.trendId, variantsCount.value, selectedProfileId.value)
  if (result) emit('generated')
}
</script>

<template>
  <div v-if="can('canRunAgent')" class="flex flex-col gap-2">
    <div class="flex items-center gap-1.5">
      <UiSelect
        :model-value="variantsCount"
        class="w-[72px]"
        :options="[
          { value: 1, label: '1' },
          { value: 3, label: '3' },
          { value: 5, label: '5' },
        ]"
        @update:model-value="variantsCount = Number($event)"
      />
      <UiTooltip v-if="disabledReason" :text="disabledReason" placement="bottom" class="flex-1">
        <UiButton variant="primary" disabled class="w-full justify-center">
          <Icon name="mingcute:sparkles-2-line" />
          Сгенерировать
        </UiButton>
      </UiTooltip>
      <UiButton
        v-else
        variant="primary"
        class="flex-1 justify-center"
        :loading="isGenerating"
        :disabled="isDisabled"
        @click="handleGenerate"
      >
        <Icon v-if="!isGenerating" name="mingcute:sparkles-2-line" />
        {{ isGenerating ? 'Генерируем' : 'Сгенерировать' }}
      </UiButton>
    </div>

    <UiSelect
      v-if="profiles.length"
      :model-value="selectedProfileId ?? ''"
      :options="profileOptions"
      @update:model-value="selectedProfileId = $event ? Number($event) : null"
    />

    <p v-if="isGenerating" class="text-micro text-subtle">
      {{ variantsCount }} вариантов — обычно 30–90 секунд
    </p>

    <div
      v-if="error"
      role="alert"
      class="flex flex-col gap-1.5 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <span class="flex items-start gap-2">
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        {{ error }}
      </span>
      <UiButton class="w-fit" @click="handleGenerate">Повторить</UiButton>
    </div>
  </div>
</template>
